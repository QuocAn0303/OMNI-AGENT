#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ml/compare-churn-models.py — So sánh công khai các thuật toán dự đoán rời bỏ

Mục đích
--------
Tài liệu thiết kế `docs/phase6/3.1-churn-model.md` chốt hồi quy logistic vì máy
dev không có scikit-learn và dự án chọn Node thuần. Tài liệu này kiểm chứng lại
quyết định đó bằng CÙNG một cách tách tập và CÙNG bộ chỉ số đo, thay vì chấp
nhận giả định "mô hình phức tạp hơn thì tốt hơn".

Nguyên tắc giữ nguyên từ bản Node
---------------------------------
1. Tách tập THEO THỜI GIAN, không tách ngẫu nhiên: mốc <= 132 vào tập train,
   mốc > 132 vào tập test. Tách ngẫu nhiên để cùng một khách xuất hiện ở cả hai
   tập => AUC nói dối.
2. Không quét lưới siêu tham số trên tập test. Tham số dùng ở đây là thiết lập
   mặc định của thư viện, người đọc có thể tự đổi.
3. Ngưỡng quyết định chọn theo CHI PHÍ: giữ những ngưỡng có precision >= 0.35,
   trong đó chọn ngưỡng có recall cao nhất. Voucher win-back là chi phí thật.
4. Đo thêm công thức đối chứng đang chạy trong hệ thống
   (`1 - exp(-recencyDays/120)`) để có mốc so sánh.

Cách chạy
---------
    python scripts/ml/compare-churn-models.py
    python scripts/ml/compare-churn-models.py --repeat 5

Ghi kết quả
-----------
    data/dataset/churn/model-comparison.json
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time
from dataclasses import dataclass, field
from typing import Callable, Sequence

import numpy as np
import pandas as pd

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
PANEL = os.path.join(ROOT, "data", "dataset", "churn", "panel.csv")
META = os.path.join(ROOT, "data", "dataset", "churn", "panel-meta.json")
OUT = os.path.join(ROOT, "data", "dataset", "churn", "model-comparison.json")

# Giữ đúng hằng số của scripts/ml/train-churn-logreg.js
TRAIN_CUTOFF_MONTH = 132
MIN_PRECISION = 0.35
FEATURES = [
    "recencyDays",
    "frequency",
    "logMonetary",
    "avgGapDays",
    "tenureDays",
    "logAvgOrderValue",
    "monthsIdle",
]
LABEL = "label"
SEED = 42

# Ràng buộc đơn điệu — PHẢI giống hệt `train-churn.py::MONOTONE` để bảng so sánh
# đo đúng mô hình đang chạy thật. Thứ tự phải khớp FEATURES.
#   +1 = biến tăng thì xác suất rời bỏ không giảm; -1 = ngược lại.
MONOTONE = (1, -1, 0, 0, 0, 0, 1)


# ---------------------------------------------------------------------------
# Chỉ số đo — cài lại thay vì dùng thư viện, để không lệch với bản Node
# ---------------------------------------------------------------------------
def roc_auc(y_true: np.ndarray, scores: np.ndarray) -> float:
    """ROC-AUC bằng phương pháp thứ hạng (Mann-Whitney U), xử lý điểm trùng."""
    order = np.argsort(scores, kind="mergesort")
    sorted_scores = scores[order]
    ranks = np.empty(len(scores), dtype=float)
    i = 0
    while i < len(scores):
        j = i
        while j + 1 < len(scores) and sorted_scores[j + 1] == sorted_scores[i]:
            j += 1
        ranks[order[i : j + 1]] = (i + j) / 2.0 + 1.0
        i = j + 1
    n_pos = int(y_true.sum())
    n_neg = len(y_true) - n_pos
    if n_pos == 0 or n_neg == 0:
        return float("nan")
    return float((ranks[y_true == 1].sum() - n_pos * (n_pos + 1) / 2.0) / (n_pos * n_neg))


def average_precision(y_true: np.ndarray, scores: np.ndarray) -> float:
    """PR-AUC (average precision)."""
    if y_true.sum() == 0:
        return float("nan")
    order = np.argsort(-scores, kind="mergesort")
    y_sorted = y_true[order]
    tp = np.cumsum(y_sorted)
    fp = np.cumsum(1 - y_sorted)
    precision = tp / np.maximum(1, tp + fp)
    recall = tp / y_true.sum()
    prev_recall = np.concatenate([[0.0], recall[:-1]])
    return float(((recall - prev_recall) * precision).sum())


def confusion(y_true: np.ndarray, scores: np.ndarray, threshold: float) -> dict:
    pred = (scores >= threshold).astype(int)
    tp = int(((pred == 1) & (y_true == 1)).sum())
    fp = int(((pred == 1) & (y_true == 0)).sum())
    tn = int(((pred == 0) & (y_true == 0)).sum())
    fn = int(((pred == 0) & (y_true == 1)).sum())
    precision = tp / max(1, tp + fp)
    recall = tp / max(1, tp + fn)
    return {
        "threshold": round(float(threshold), 4),
        "tp": tp,
        "fp": fp,
        "tn": tn,
        "fn": fn,
        "precision": round(precision, 4),
        "recall": round(recall, 4),
        "specificity": round(tn / max(1, tn + fp), 4),
        "f1": round(2 * precision * recall / max(1e-12, precision + recall), 4),
        "accuracy": round((tp + tn) / max(1, len(y_true)), 4),
    }


def pick_threshold(y_true: np.ndarray, scores: np.ndarray, min_precision: float) -> dict:
    """Chọn ngưỡng theo chi phí: precision >= min_precision, trong đó recall cao nhất.

    Cài lại đúng `pickThreshold` của bản Node, kể cả đường dự phòng khi không
    ngưỡng nào đạt ngưỡng precision tối thiểu.
    """
    candidates = np.unique(np.round(scores, 3))
    best = {"threshold": 0.5, "recall": -1.0, "precision": 0.0}
    fallback = {"threshold": 0.5, "recall": -1.0, "precision": 0.0}
    for t in candidates:
        pred = (scores >= t).astype(int)
        tp = int(((pred == 1) & (y_true == 1)).sum())
        fp = int(((pred == 1) & (y_true == 0)).sum())
        fn = int(((pred == 0) & (y_true == 1)).sum())
        precision = tp / max(1, tp + fp)
        recall = tp / max(1, tp + fn)
        if recall > fallback["recall"]:
            fallback = {"threshold": float(t), "recall": recall, "precision": precision}
        if precision >= min_precision and recall > best["recall"]:
            best = {"threshold": float(t), "recall": recall, "precision": precision}
    return best if best["recall"] >= 0 else fallback


def evaluate(name: str, y_true: np.ndarray, scores: np.ndarray, extra: dict | None = None) -> dict:
    threshold = pick_threshold(y_true, scores, MIN_PRECISION)
    row = {
        "model": name,
        "aucTest": round(roc_auc(y_true, scores), 4),
        "prAuc": round(average_precision(y_true, scores), 4),
        **confusion(y_true, scores, threshold["threshold"]),
    }
    if extra:
        row.update(extra)
    return row


# ---------------------------------------------------------------------------
# Các thuật toán
# ---------------------------------------------------------------------------
@dataclass
class Fitted:
    """Kết quả một mô hình đã huấn luyện, kèm hàm chấm điểm."""

    name: str
    predict: Callable[[pd.DataFrame], np.ndarray]
    importance: list[dict] = field(default_factory=list)
    note: str = ""
    params: dict = field(default_factory=dict)


def fit_logreg(X_train, y_train, X_test, seed: int) -> Fitted:
    """Hồi quy logistic chuẩn hoá, tương đương bản Node nhưng dùng thư viện."""
    from sklearn.linear_model import LogisticRegression
    from sklearn.pipeline import Pipeline
    from sklearn.preprocessing import StandardScaler

    pipe = Pipeline(
        [
            ("scaler", StandardScaler()),
            ("clf", LogisticRegression(max_iter=1000, C=1.0, random_state=seed)),
        ]
    )
    pipe.fit(X_train, y_train)
    coef = pipe.named_steps["clf"].coef_[0]
    imp = [
        {"feature": f, "weight": round(float(c), 5)} for f, c in sorted(zip(FEATURES, coef), key=lambda kv: -abs(kv[1]))
    ]
    return Fitted(
        name="logistic-regression",
        predict=lambda df: pipe.predict_proba(df)[:, 1],
        importance=imp,
        note="Tuyến tính, trọng số đọc được. Cùng họ mô hình với bản Node.",
        params={"C": 1.0, "max_iter": 1000},
    )


def fit_lightgbm(X_train, y_train, X_test, seed: int, num_leaves: int) -> Fitted:
    import lightgbm as lgb

    clf = lgb.LGBMClassifier(
        n_estimators=300,
        learning_rate=0.05,
        num_leaves=num_leaves,
        max_depth=-1,
        min_child_samples=40,
        subsample=0.9,
        subsample_freq=1,
        colsample_bytree=0.9,
        reg_lambda=1.0,
        is_unbalance=False,
        random_state=seed,
        n_jobs=1,
        # Giữ đúng ràng buộc đơn điệu của `train-churn.py`, nếu không bảng so sánh
        # này đo một mô hình khác với mô hình đang chạy thật và kết luận về nó
        # là vô nghĩa. Giải thích về lý do ràng buộc ở MONOTONE_CONSTRAINTS trong
        # train-churn.py.
        monotone_constraints=MONOTONE,
        verbose=-1,
    )
    clf.fit(X_train, y_train, categorical_feature=[])
    imp = [
        {"feature": f, "weight": round(float(g), 5)}
        for f, g in sorted(zip(FEATURES, clf.booster_.feature_importance("gain")), key=lambda kv: -kv[1])
    ]
    return Fitted(
        name=f"lightgbm-{num_leaves}leaves",
        predict=lambda df: clf.predict_proba(df)[:, 1],
        importance=imp,
        note="Cây tăng cường, bắt được tương tác phi tuyến; ràng buộc đơn điệu theo quy tắc nghiệp vụ.",
        params={
            "n_estimators": 300,
            "learning_rate": 0.05,
            "num_leaves": num_leaves,
            "min_child_samples": 40,
            "monotone_constraints": {f: MONOTONE[i] for i, f in enumerate(FEATURES) if MONOTONE[i] != 0},
        },
    )


def fit_random_forest(X_train, y_train, X_test, seed: int) -> Fitted:
    from sklearn.ensemble import RandomForestClassifier

    clf = RandomForestClassifier(
        n_estimators=300,
        min_samples_leaf=20,
        max_features="sqrt",
        random_state=seed,
        n_jobs=1,
    )
    clf.fit(X_train, y_train)
    imp = [
        {"feature": f, "weight": round(float(g), 5)}
        for f, g in sorted(zip(FEATURES, clf.feature_importances_), key=lambda kv: -kv[1])
    ]
    return Fitted(
        name="random-forest",
        predict=lambda df: clf.predict_proba(df)[:, 1],
        importance=imp,
        note="Rừng cây quyết định, ít cần chuẩn hoá đặc trưng.",
        params={"n_estimators": 300, "min_samples_leaf": 20},
    )


def fit_gbdt(X_train, y_train, X_test, seed: int) -> Fitted:
    """Gradient boosting cơ bản để tách hiệu ứng 'cây' khỏi hiệu ứng 'tăng cường'."""
    from sklearn.ensemble import HistGradientBoostingClassifier

    clf = HistGradientBoostingClassifier(
        max_iter=300, learning_rate=0.05, max_leaf_nodes=31, min_samples_leaf=40, random_state=seed
    )
    clf.fit(X_train, y_train)
    return Fitted(
        name="sklearn-hist-gbdt",
        predict=lambda df: clf.predict_proba(df)[:, 1],
        note="Boosting sâu hơn LightGBM, hiệu năng thường gần nhau.",
        params={"max_iter": 300, "learning_rate": 0.05, "max_leaf_nodes": 31},
    )


def baseline_scores(df_test: pd.DataFrame) -> np.ndarray:
    """Công thức đối chứng đang chạy trong clv-forecast.service.js."""
    return (1.0 - np.exp(-df_test["recencyDays"].to_numpy(dtype=float) / 120.0)).astype(float)


# ---------------------------------------------------------------------------
# Kiểm tra độ ổn định: dữ liệu panel lặp lại theo khách, tách ngẫu nhiên sẽ rò
# ---------------------------------------------------------------------------
def split_rolling(df: pd.DataFrame, n_folds: int = 3) -> list[tuple[np.ndarray, np.ndarray]]:
    """Tách cuộn theo thời gian: mỗi lần train trên quá khứ, đo trên giai đoạn kế."""
    months = sorted(df["cutoffMonth"].unique())
    # Cần dữ liệu trước để huấn luyện, nên chia thành các khối liên tiếp
    block = max(2, len(months) // (n_folds + 1))
    folds = []
    for k in range(n_folds):
        train_max = months[block * (k + 1) - 1]
        test_start = months[block * (k + 1)]
        test_end_idx = min(len(months) - 1, block * (k + 2) - 1)
        test_end = months[test_end_idx]
        tr = df[df["cutoffMonth"] <= train_max].index.to_numpy()
        te = df[(df["cutoffMonth"] >= test_start) & (df["cutoffMonth"] <= test_end)].index.to_numpy()
        if len(tr) and len(te):
            folds.append((tr, te))
    return folds


def main() -> int:
    ap = argparse.ArgumentParser(description="So sánh các mô hình dự đoán rời bỏ khách hàng")
    ap.add_argument("--repeat", type=int, default=1, help="số lần lặp để đo độ ổn định")
    ap.add_argument("--leaves", type=int, default=15, help="num_leaves của LightGBM")
    args = ap.parse_args()

    if not os.path.exists(PANEL):
        print(f"Thiếu {os.path.relpath(PANEL, ROOT)} — chạy: npm run ml:panel", file=sys.stderr)
        return 1

    df = pd.read_csv(PANEL)
    missing = [c for c in FEATURES + [LABEL, "cutoffMonth"] if c not in df.columns]
    if missing:
        print(f"panel.csv thiếu cột: {missing}", file=sys.stderr)
        return 1

    # 1. Tách theo thời gian — GIỮ NGUYÊN cách của bản Node
    train = df[df["cutoffMonth"] <= TRAIN_CUTOFF_MONTH]
    test = df[df["cutoffMonth"] > TRAIN_CUTOFF_MONTH]
    X_train, y_train = train[FEATURES], train[LABEL].to_numpy()
    X_test, y_test = test[FEATURES], test[LABEL].to_numpy()

    print("=" * 78)
    print("SO SÁNH THUẬT TOÁN DỰ ĐOÁN RỜI BỎ")
    print("=" * 78)
    print(f"Tập train : {len(train):,} mẫu, tỷ lệ rời bỏ {train[LABEL].mean() * 100:.2f}%")
    print(f"Tập test  : {len(test):,} mẫu, tỷ lệ rời bỏ {test[LABEL].mean() * 100:.2f}%")
    print(f"Mốc tách  : cutoffMonth = {TRAIN_CUTOFF_MONTH} (tách theo thời gian, không ngẫu nhiên)")
    print(f"Đặc trưng : {', '.join(FEATURES)}")
    print(f"Ngưỡng    : precision >= {MIN_PRECISION}, trong đó chọn recall cao nhất")
    print("-" * 78)

    # 2. Công thức đối chứng
    rows = [evaluate("cong-thuc-doi-chung (đang chạy)", y_test, baseline_scores(test))]
    print(f"{'mô hình':<34}{'AUC':>8}{'PR-AUC':>9}{'ngưỡng':>8}{'prec':>8}{'recall':>9}{'F1':>8}")
    print(f"{rows[0]['model']:<34}{rows[0]['aucTest']:>8.4f}{rows[0]['prAuc']:>9.4f}"
          f"{rows[0]['threshold']:>8.3f}{rows[0]['precision']:>8.4f}{rows[0]['recall']:>9.4f}{rows[0]['f1']:>8.4f}")

    # 3. Các mô hình học có giám sát
    factories: list[tuple[str, Callable]] = [
        ("logistic-regression", fit_logreg),
        ("random-forest", fit_random_forest),
        ("sklearn-hist-gbdt", fit_gbdt),
        (f"lightgbm-{args.leaves}leaves", lambda a, b, c, s: fit_lightgbm(a, b, c, s, args.leaves)),
    ]
    fitted: dict[str, Fitted] = {}
    for label, factory in factories:
        t0 = time.perf_counter()
        try:
            model = factory(X_train, y_train, X_test, SEED)
        except Exception as exc:  # noqa: BLE001 — thư viện thiếu thì báo, không làm hỏng cả lượt chạy
            print(f"{label:<34} BỎ QUA — {exc}")
            continue
        elapsed = time.perf_counter() - t0
        scores = model.predict(X_test)
        row = evaluate(label, y_test, scores, {"trainSeconds": round(elapsed, 2)})
        rows.append(row)
        fitted[label] = model
        print(f"{label:<34}{row['aucTest']:>8.4f}{row['prAuc']:>9.4f}"
              f"{row['threshold']:>8.3f}{row['precision']:>8.4f}{row['recall']:>9.4f}{row['f1']:>8.4f}")

    # 4. Độ ổn định qua các lần lặp và các lần tách cuộn
    print("-" * 78)
    print("ĐỘ ỔN ĐỊNH")
    folds = split_rolling(df)
    stability: dict[str, list[float]] = {label: [] for label, _ in factories}
    for tr_idx, te_idx in folds:
        Xtr, ytr = df.loc[tr_idx, FEATURES], df.loc[tr_idx, LABEL].to_numpy()
        Xte, yte = df.loc[te_idx, FEATURES], df.loc[te_idx, LABEL].to_numpy()
        for label, factory in factories:
            try:
                m = factory(Xtr, ytr, Xte, SEED)
            except Exception:  # noqa: BLE001
                continue
            stability[label].append(roc_auc(yte, m.predict(Xte)))
    for label, vals in stability.items():
        if vals:
            mean = sum(vals) / len(vals)
            spread = max(vals) - min(vals)
            print(f"  {label:<34} AUC trung bình {mean:.4f} trên {len(vals)} lần tách, trải rộng {spread:.4f}")

    if args.repeat > 1:
        print(f"  (lặp {args.repeat} lần với các hạt giống khác nhau để đo biến động)")
        for seed in range(SEED + 1, SEED + args.repeat):
            for label, factory in factories:
                try:
                    m = factory(X_train, y_train, X_test, seed)
                except Exception:  # noqa: BLE001
                    continue
                auc = roc_auc(y_test, m.predict(X_test))
                stability[label].append(auc)
        for label, vals in stability.items():
            if len(vals) > len(folds):
                mean = sum(vals) / len(vals)
                print(f"  {label:<34} AUC {mean:.4f} ± {(max(vals) - min(vals)) / 2:.4f} trên {len(vals)} lần chạy")

    # 5. Kết luận và gợi ý chọn
    print("-" * 78)
    supervised = [r for r in rows if r["model"] != "cong-thuc-doi-chung (đang chạy)"]
    if supervised:
        best_auc = max(supervised, key=lambda r: r["aucTest"])
        best_pr = max(supervised, key=lambda r: r["prAuc"])
        print(f"AUC cao nhất    : {best_auc['model']} ({best_auc['aucTest']:.4f})")
        print(f"PR-AUC cao nhất : {best_pr['model']} ({best_pr['prAuc']:.4f})")
        lgb_rows = [r for r in supervised if "lightgbm" in r["model"]]
        lr_rows = [r for r in supervised if r["model"] == "logistic-regression"]
        if lgb_rows and lr_rows:
            delta_auc = lgb_rows[0]["aucTest"] - lr_rows[0]["aucTest"]
            delta_pr = lgb_rows[0]["prAuc"] - lr_rows[0]["prAuc"]
            print(f"Chênh lệch LightGBM so với hồi quy logistic: AUC {delta_auc:+.4f}, PR-AUC {delta_pr:+.4f}")
            if delta_pr < 0.01:
                print("Kết luận: chênh lệch dưới 0.01, xem là không đáng kể trên tập này.")

    # 6. Mức tăng giả của doanh nghiệp
    print("-" * 78)
    print("MỨC TĂNG GIẢ CỦA DOANH NGHIỆP")
    for label, model in fitted.items():
        if not model.importance:
            continue
        top = ", ".join(f"{d['feature']} {d['weight']:+.4f}" for d in model.importance[:3])
        print(f"  {label:<34} {top}")

    # 7. Ghi kết quả
    meta = {}
    if os.path.exists(META):
        with open(META, encoding="utf-8") as fh:
            meta = json.load(fh)
    payload = {
        "generatedAt": pd.Timestamp.now(tz="UTC").isoformat(),
        "panel": {
            "file": os.path.relpath(PANEL, ROOT).replace("\\", "/"),
            "rows": int(len(df)),
            "customers": int(meta.get("customers", df["customer"].nunique())),
            "samples": int(len(df)),
            "churnSamples": int(df[LABEL].sum()),
            "churnRate": round(float(df[LABEL].mean()), 4),
            "trainSamples": int(len(train)),
            "testSamples": int(len(test)),
            "trainCutoffMonth": TRAIN_CUTOFF_MONTH,
            "splitStrategy": "theo thời gian (mốc <= T_cutoff vào tập train)",
            "horizonDays": meta.get("horizonDays", 90),
            "labelDefinition": "label = 1 nếu khách không mua lại trong 90 ngày sau mốc",
        },
        "features": FEATURES,
        "thresholdRule": f"precision >= {MIN_PRECISION}, trong đó chọn recall cao nhất",
        "results": rows,
        "stabilityAuc": {k: [round(v, 4) for v in vals] for k, vals in stability.items() if vals},
    }
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)
    print(f"\nĐã ghi {os.path.relpath(OUT, ROOT).replace(chr(92), '/')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())