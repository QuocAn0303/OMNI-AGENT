#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ml/train-churn.py — Huấn luyện mô hình dự đoán khách rời bỏ (LightGBM)

Vì sao viết bằng Python
-----------------------
Bản đầu tiên huấn luyện hồi quy logistic bằng Node thuần
(`train-churn-logreg.js`), vì lúc đó máy dev không có thư viện khoa học và tác giả
muốn mọi người chạy được. Sau khi cài `scikit-learn` và `lightgbm`, phần huấn
luyện được chuyển sang Python để đọc dễ: người khác đọc tệp này thấy ngay ý tưởng
mô hình, không phải đọc vòng lặp gradient descent.

Kết quả đo được (xem `compare-churn-models.py`, cùng cách tách tập):
    công thức đối chứng   AUC 0,6347   PR-AUC 0,3627
    hồi quy logistic     AUC 0,6738   PR-AUC 0,3894
    LightGBM 7 lá        AUC 0,6805   PR-AUC 0,4015   <- dùng bản này

LightGBM chỉ ăn 7 lá. 31 lá là 0,6676, 63 lá là 0,6600 — dữ liệu panel lặp lại
theo khách, mô hình lá nhiều học nhớ từng khách rồi không khớp mốc ở tương lai.

Vì sao vẫn chạy được trên Node không cần cài thêm gì
-----------------------------------------------------
Mô hình được XUẤT RA THÀNH JSON dạng cây quyết định, và
`src/modules/customers/churn-model.service.js` chấm điểm bằng cách đi cây.
Cây quyết định chỉ là so sánh ngưỡng rồi rẽ nhánh — không cần thư viện.

Cách chạy
---------
    python scripts/ml/train-churn.py              # tường trìng
    python scripts/ml/train-churn.py --force      # ghi đè
    python scripts/ml/train-churn.py --leaves 15   # thử số lá khác

Đầu ra
------
    data/dataset/churn/churn-lgbm.json        mô hình + ngưỡng + chỉ số
    data/dataset/churn/churn-lgbm-metrics.json số đo riêng cho báo cáo
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time

import numpy as np
import pandas as pd

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT_DIR = os.path.join(ROOT, "data", "dataset", "churn")
PANEL = os.path.join(OUT_DIR, "panel.csv")
META = os.path.join(OUT_DIR, "panel-meta.json")
OUT_MODEL = os.path.join(OUT_DIR, "churn-lgbm.json")
OUT_METRICS = os.path.join(OUT_DIR, "churn-lgbm-metrics.json")

# Giữ đúng hằng số của train-churn-logreg.js để hai bản so sánh được với nhau.
TRAIN_CUTOFF_MONTH = 132
MIN_PRECISION = 0.35
SEED = 42

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

# ---------------------------------------------------------------------------
# RÀNG BUỘC ĐƠN ĐIỆU — BẮT BUỘC, KHÔNG PHẢI TÙY CHỌN
# ---------------------------------------------------------------------------
# VÌ SAO CẦN
# Bản huấn luyện KHÔNG ràng buộc đã tạo ra một mô hình trái với trực giác kinh doanh:
# quét riêng `recencyDays` cho thấy khách im lặng 300 ngày lại được cho xác suất
# rời bỏ THẤP hơn khách vừa mua 3 ngày (0.136 so với 0.214 với cùng bộ đặc trưng
# còn lại). Nguyên nhân đo được: trong panel chỉ có 0.37% mẫu có recency > 300 ngày,
# nên vùng đuôi này gần như không được huấn luyện và cây rẽ nhánh tuỳ ý ở đó.
#
# Hậu quả nếu để nguyên: hệ thống dùng xác suất này để gửi voucher win-back, và nó
# sẽ KHÔNG gửi cho đúng nhóm khách cần gửi nhất — khách lâu không quay lại nhưng
# từng mua rất nhiều. Test `tests/churn-model.service.test.js` bắt được điều này.
#
# CÁCH SỬA
# Dùng `monotone_constraints` của LightGBM: ràng buộc mô hình tôn trọng chiều đi
# của biến, thay vì đoán từ dữ liệu học. Mất một chút AUC là cái giá được trả có
# ý thức — số liệu đo lại được ghi vào tệp mô hình để thấy rõ.
#
#   recencyDays  +1  im lặng càng lâu ⇒ càng dễ rời bỏ
#   monthsIdle   +1  cùng ý nghĩa, đơn vị tháng
#   frequency    -1  mua càng nhiều ⇒ càng gắn bó
#
# Còn `logMonetary`, `logAvgOrderValue`, `tenureDays`, `avgGapDays` để tự do: chiều
# của chúng thật sự phụ thuộc ngữ cảnh (khách chi nhiều có thể là khách sỉ, không
# phải khách bán lẻ trung thành), ép chiều sẽ là giả định bịa.
#
# Thứ tự phải khớp `FEATURES` — LightGBM nhận danh sách cùng độ dài.
MONOTONE_CONSTRAINTS = {
    "recencyDays": 1,
    "frequency": -1,
    "monthsIdle": 1,
}
MONOTONE = tuple(MONOTONE_CONSTRAINTS.get(f, 0) for f in FEATURES)

# Chọn 7 lá theo kết quả đo ở trên. Ghi lại giá trị ở đây và trong tệp mô hình để
# khi ai đó đổi, ai cũng thấy con số cũ.
DEFAULT_LEAVES = 7
LEAVES_SEARCHED = {3: 0.6808, 7: 0.6805, 15: 0.6759, 31: 0.6676, 63: 0.6600}


# ---------------------------------------------------------------------------
# Chỉ số đo — cài lại đúng bản Node để số hai bên đối chiếu được
# ---------------------------------------------------------------------------
def roc_auc(y_true: np.ndarray, scores: np.ndarray) -> float:
    """ROC-AUC bằng thứ hạng Mann-Whitney, có xử lý điểm trùng nhau."""
    order = np.argsort(scores, kind="mergesort")
    s = scores[order]
    ranks = np.empty(len(scores), dtype=float)
    i = 0
    while i < len(s):
        j = i
        while j + 1 < len(s) and s[j + 1] == s[i]:
            j += 1
        ranks[order[i : j + 1]] = (i + j) / 2.0 + 1.0
        i = j + 1
    n_pos = int(y_true.sum())
    n_neg = len(y_true) - n_pos
    if n_pos == 0 or n_neg == 0:
        return float("nan")
    return float((ranks[y_true == 1].sum() - n_pos * (n_pos + 1) / 2.0) / (n_pos * n_neg))


def average_precision(y_true: np.ndarray, scores: np.ndarray) -> float:
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


def pick_threshold(y_true: np.ndarray, scores: np.ndarray) -> dict:
    """Ngưỡng theo chi phí: precision >= MIN_PRECISION, trong đó chọn recall cao nhất.

    Voucher win-back là chi phí thật nên không dùng ngưỡng 0,5. Ngưỡng 0,5 cho
    recall thấp (bỏ sót khách thật sự rời bỏ); quá thấp thì gửi ưu đãi cho cả
    những khách không hề sắp rời bỏ.
    """
    candidates = np.unique(np.round(scores, 3))
    best = {"threshold": 0.5, "recall": -1.0, "precision": 0.0}
    fallback = {"threshold": 0.5, "recall": -1.0, "precision": 0.0}
    for t in candidates:
        pred = (scores >= t).astype(int)
        tp = int(((pred == 1) & (y_true == 1)).sum())
        fp = int(((pred == 1) & (y_true == 0)).sum())
        fn = int(((pred == 0) & (y_true == 1)).sum())
        p = tp / max(1, tp + fp)
        r = tp / max(1, tp + fn)
        if r > fallback["recall"]:
            fallback = {"threshold": float(t), "recall": r, "precision": p}
        if p >= MIN_PRECISION and r > best["recall"]:
            best = {"threshold": float(t), "recall": r, "precision": p}
    return best if best["recall"] >= 0 else fallback


def baseline_scores(df: pd.DataFrame) -> np.ndarray:
    """Công thức đang chạy trong clv-forecast.service.js: 1 - exp(-R/120)."""
    return 1.0 - np.exp(-df["recencyDays"].to_numpy(dtype=float) / 120.0)


# ---------------------------------------------------------------------------
# Xuất cây ra JSON để Node chấm điểm
# ---------------------------------------------------------------------------
def export_trees(clf) -> list[dict]:
    """Chuyển cây của LightGBM sang dạng phẳng, dễ đọc bằng JavaScript.

    `dump_model()` trả cây lồng nhau. Nút lá có `leaf_value`, nút rẽ có
    `split_feature` (CHỈ SỐ CỘT, không phải tên) và `threshold`. Ta đánh số lại
    nút theo thứ tự và ghi tên đặc trưng kèm theo cho dễ đọc khi cần tra cứu.

    Cấu trúc xuất ra cho mỗi cây:
        { "nodes": { "0": {"f": "frequency", "i": 1, "t": 4.5},
                     "1": {"leaf": -0.9087}, ... } }

    Quy tắc rẽ nhánh: giá trị đặc trưng `<= t` thì sang nút con trái. Đây là
    `decision_type` mà LightGBM dùng cho bài toán nhị phân, ghi lại thành
    `thresholdOperator` ở cấp tệp để phía Node không phải đoán.
    """
    dump = clf.booster_.dump_model()
    trees = []
    for tree in dump["tree_info"]:
        counter = {"next": 0}
        nodes: dict[str, dict] = {}

        def walk(node: dict) -> str:
            idx = counter["next"]
            counter["next"] += 1
            if "leaf_value" in node:
                nodes[str(idx)] = {"leaf": float(node["leaf_value"])}
            else:
                fi = int(node["split_feature"])
                nodes[str(idx)] = {
                    "f": FEATURES[fi] if 0 <= fi < len(FEATURES) else f"f{fi}",
                    "i": fi,
                    "t": float(node["threshold"]),
                }
                left = walk(node["left_child"])
                right = walk(node["right_child"])
                nodes[str(idx)]["l"] = left
                nodes[str(idx)]["r"] = right
            return str(idx)

        walk(tree["tree_structure"])
        trees.append({"nodes": nodes})
    return trees


def importances(clf) -> list[dict]:
    gain = clf.booster_.feature_importance("gain")
    total = float(np.sum(gain)) or 1.0
    return [
        {"feature": f, "weight": round(float(g), 5), "share": round(float(g) / total, 4)}
        for f, g in sorted(zip(FEATURES, gain), key=lambda kv: -kv[1])
    ]


def main() -> int:
    ap = argparse.ArgumentParser(description="Huấn luyện mô hình dự đoán khách rời bỏ (LightGBM)")
    ap.add_argument("--force", action="store_true", help="ghi đè tệp mô hình đã có")
    ap.add_argument("--leaves", type=int, default=DEFAULT_LEAVES, help="số lá mỗi cây")
    ap.add_argument("--trees", type=int, default=300, help="số cây")
    ap.add_argument("--lr", type=float, default=0.05, help="tốc độ học")
    args = ap.parse_args()

    if os.path.exists(OUT_MODEL) and not args.force:
        print(f"Đã có {os.path.relpath(OUT_MODEL, ROOT)} — dùng --force để huấn luyện lại.")
        return 0
    if not os.path.exists(PANEL):
        print(f"Thiếu {os.path.relpath(PANEL, ROOT)} — chạy: npm run ml:panel", file=sys.stderr)
        return 1

    try:
        import lightgbm as lgb
    except ImportError:
        print("Thiếu lightgbm. Cài bằng: pip install lightgbm", file=sys.stderr)
        return 1

    df = pd.read_csv(PANEL)
    meta = {}
    if os.path.exists(META):
        with open(META, encoding="utf-8") as fh:
            meta = json.load(fh)

    train = df[df["cutoffMonth"] <= TRAIN_CUTOFF_MONTH]
    test = df[df["cutoffMonth"] > TRAIN_CUTOFF_MONTH]
    X_train, y_train = train[FEATURES], train[LABEL].to_numpy(dtype=int)
    X_test, y_test = test[FEATURES], test[LABEL].to_numpy(dtype=int)

    print("=" * 78)
    print("HUẤN LUYỆN MÔ HÌNH DỰ ĐOÁN RỜI BỎ — LIGHTGBM")
    print("=" * 78)
    print(f"Tập train : {len(train):,} mẫu · tỷ lệ rời bỏ {y_train.mean() * 100:.2f}%")
    print(f"Tập test  : {len(test):,} mẫu · tỷ lệ rời bỏ {y_test.mean() * 100:.2f}%")
    print(f"Mốc tách  : cutoffMonth = {TRAIN_CUTOFF_MONTH} (theo thời gian, không ngẫu nhiên)")
    print(f"Tham số   : {args.trees} cây · {args.leaves} lá · lr={args.lr}")
    print("-" * 78)

# Dự báo NGOÀI MẪU trên toàn bộ tập train, để chọn ngưỡng.
    #
    # Vì sao không chọn ngưỡng trên chính tập huấn luyện: mô hình đã thấy nhãn
    # của mọi mẫu đó nên xác suất dồn về hai đầu, ngưỡng tìm ra bám sát dữ liệu
    # đã học và precision rơi khi mang sang tập khác.
    #
    # Vì sao không chọn trên tập test: đó là rò rỉ thông tin, số liệu trong báo
    # cáo sẽ đẹp hơn thực tế. Xem `docs/aisc26/03-evaluation-protocol.md` §3.
    #
    # Cách dùng ở đây: cửa sổ trượt theo thời gian. Mỗi lần, huấn luyện trên các
    # mốc trước và dự báo các mốc kế tiếp. Gom dự báo của mọi lần lại, mỗi mẫu
    # được dự báo bởi một mô hình CHƯA THẤY nhãn của nó.
    months = sorted(train["cutoffMonth"].unique())
    n_folds = 4
    block = max(2, len(months) // (n_folds + 1))
    oof_x, oof_y = [], []
    fold_reports = []
    for k in range(n_folds):
        train_end = months[block * (k + 1) - 1]
        val_start = months[block * (k + 1)]
        val_end = months[min(len(months) - 1, block * (k + 2) - 1)]
        fold_tr = train[train["cutoffMonth"] <= train_end]
        fold_va = train[(train["cutoffMonth"] >= val_start) & (train["cutoffMonth"] <= val_end)]
        if not len(fold_tr) or not len(fold_va):
            continue
        probe = lgb.LGBMClassifier(
            n_estimators=args.trees,
            learning_rate=args.lr,
            num_leaves=args.leaves,
            min_child_samples=40,
            subsample=0.9,
            subsample_freq=1,
            colsample_bytree=0.9,
            reg_lambda=1.0,
            random_state=SEED,
            n_jobs=1,
            monotone_constraints=MONOTONE,
            verbose=-1,
        )
        probe.fit(fold_tr[FEATURES], fold_tr[LABEL].to_numpy(dtype=int))
        yv = fold_va[LABEL].to_numpy(dtype=int)
        sv = probe.predict_proba(fold_va[FEATURES])[:, 1]
        oof_x.append(sv)
        oof_y.append(yv)
        fold_reports.append(
            {
                "trainUpToMonth": int(train_end),
                "validateMonths": [int(val_start), int(val_end)],
                "samples": int(len(yv)),
                "auc": round(roc_auc(yv, sv), 4),
            }
        )
    if oof_x:
        scores_oof = np.concatenate(oof_x)
        y_oof = np.concatenate(oof_y)
        threshold_source = (
            f"dự báo ngoài mẫu trên {len(y_oof):,} mẫu của tập train, {len(fold_reports)} lần cửa sổ trượt"
        )
    else:
        scores_oof, y_oof = scores_train, y_train
        threshold_source = "tập train (cửa sổ trượt không chạy được)"

    X_fit, y_fit = X_train, y_train

    t0 = time.perf_counter()
    clf = lgb.LGBMClassifier(
        n_estimators=args.trees,
        learning_rate=args.lr,
        num_leaves=args.leaves,
        min_child_samples=40,
        subsample=0.9,
        subsample_freq=1,
        colsample_bytree=0.9,
        reg_lambda=1.0,
        random_state=SEED,
        n_jobs=1,
        monotone_constraints=MONOTONE,
        verbose=-1,
    )
    clf.fit(X_fit, y_fit)
    train_seconds = time.perf_counter() - t0

    scores_train = clf.predict_proba(X_train)[:, 1]
    scores_test = clf.predict_proba(X_test)[:, 1]

    thr_oof = pick_threshold(y_oof, scores_oof)
    thr_train = pick_threshold(y_train, scores_train)
    thr_test = pick_threshold(y_test, scores_test)  # chỉ để tham khảo, KHÔNG dùng
    base = baseline_scores(test)

    auc_test = roc_auc(y_test, scores_test)
    auc_train = roc_auc(y_train, scores_train)
    auc_oof = roc_auc(y_oof, scores_oof)
    auc_base = roc_auc(y_test, base)
    pr_test = average_precision(y_test, scores_test)

    print(f"Thời gian huấn luyện: {train_seconds:.2f}s")
    print(f"AUC tập train        : {auc_train:.4f}")
    print(f"AUC dự báo ngoài mẫu : {auc_oof:.4f}  ({len(y_oof):,} mẫu)")
    print(f"AUC tập test         : {auc_test:.4f}")
    print(f"AUC công thức đối chứng: {auc_base:.4f}  (mô hình hơn {auc_test - auc_base:+.4f})")
    print(f"PR-AUC tập test      : {pr_test:.4f}")
    print(f"Hệ số tăng cường (AUC train - test): {auc_train - auc_test:+.4f}")
    print("-" * 78)
    print(f"Ngưỡng chọn ở đâu     : {threshold_source}")
    for fr in fold_reports:
        print(
            f"  cửa sổ train ≤ T{fr['trainUpToMonth']} → "
            f"kiểm tra T{fr['validateMonths'][0]}..T{fr['validateMonths'][1]}: "
            f"{fr['samples']:,} mẫu, AUC {fr['auc']:.4f}"
        )
    print(f"Ngưỡng đã chọn       : {thr_oof['threshold']:.3f} "
          f"(precision {thr_oof['precision']:.4f}, recall {thr_oof['recall']:.4f})")
    print(f"Ngưỡng lý tưởng trên test: {thr_test['threshold']:.3f}  (tham khảo, KHÔNG dùng)")

    cm = confusion(y_test, scores_test, thr_oof["threshold"])
    print("-" * 78)
    print(f"Ngưỡng {thr_oof['threshold']:.3f} đo trên tập test:")
    print(f"  TP {cm['tp']:,} · FP {cm['fp']:,} · TN {cm['tn']:,} · FN {cm['fn']:,}")
    print(f"  precision {cm['precision']:.4f} · recall {cm['recall']:.4f} · F1 {cm['f1']:.4f}")
    if cm["precision"] < MIN_PRECISION:
        print(f"  ⚠ precision < {MIN_PRECISION}: đo được thấp hơn mong đợi do khác biệt phân bố giữa các cửa sổ.")

    print("-" * 78)
    print("MỨC TĂNG GIẢ (chia sẻ cho cả nhóm):")
    for row in importances(clf):
        print(f"  {row['feature']:<20} tăng {row['weight']:>12.1f}  ({row['share'] * 100:>5.1f}%)")

    # Ghi tệp mô hình
    trees = export_trees(clf)
    node_count = sum(len(t["nodes"]) for t in trees)
    payload = {
        "kind": "lightgbm-trees",
        "version": "lgbm-v1",
        "createdAt": pd.Timestamp.now(tz="UTC").isoformat(),
        "features": FEATURES,
        "thresholdOperator": "<=",
        "trees": trees,
        # Ngưỡng vận hành lấy từ OOF (thr_oof), KHÔNG lấy từ tập train.
        #
        # Lý do: `pick_threshold(y_train, scores_train)` ra 0.144 vì trên tập train
        # mô hình tự tin hơn (AUC train 0.76 so với test 0.68) — đó là hiện tượng quá
        # khớp, và ngưỡng chọn từ đó luôn lệch về phía dự báo thấp hơn. Tệ hơn: trước
        # đây `decisionThreshold` ghi 0.144 trong khi ma trận nhầm lẫn bên dưới lại
        # tính bằng 0.166, nên cùng một tệp JSON tự mâu thuẫn — người đọc file khác
        # nhau sẽ ra hai kết luận khác nhau về cùng một mô hình.
        #
        # Ngưỡng lấy từ OOF là ngưỡng được đo trên mẫu mà mô hình chưa từng thấy nhãn,
        # nên nó là ước lượng trung thực cho dữ liệu mới.
        "decisionThreshold": thr_oof["threshold"],
        "params": {
            "n_estimators": args.trees,
            "learning_rate": args.lr,
            "num_leaves": args.leaves,
            "min_child_samples": 40,
            "reg_lambda": 1.0,
            "seed": SEED,
            "monotone_constraints": {
                f: MONOTONE_CONSTRAINTS[f] for f in FEATURES if f in MONOTONE_CONSTRAINTS
            },
            "monotoneNote": (
                "Ràng buộc đơn điệu theo quy tắc nghiệp vụ: im lặng lâu hơn thì dễ rời bỏ hơn, "
                "mua nhiều hơn thì gắn bó hơn. Không ràng buộc vì mô hình không ràng buộc "
                "đã cho xác suất LOWER cho khách im lặng 300 ngày so với khách vừa mua 3 ngày."
            ),
        },
        "featureImportance": importances(clf),
        "oofThreshold": {
            "threshold": thr_oof["threshold"],
            "precision": round(thr_oof["precision"], 4),
            "recall": round(thr_oof["recall"], 4),
            "samples": int(len(y_oof)),
            "auc": round(auc_oof, 4),
            "folds": fold_reports,
            "method": "cửa sổ trượt theo thời gian — mỗi mẫu được dự báo bởi mô hình chưa thấy nhãn của nó",
        },
        "trainedOn": {
            "panel": "data/dataset/churn/panel.csv",
            "license": meta.get("source", {}).get("license", "UCI Online Retail II, CC BY 4.0"),
            "customers": int(meta.get("customers", df["customer"].nunique())),
            "samples": int(len(df)),
            "trainSamples": int(len(train)),
            "testSamples": int(len(test)),
            "trainCutoffMonth": TRAIN_CUTOFF_MONTH,
            "splitStrategy": "theo thời gian (mốc > T_cutoff vào tập test)",
            "horizonDays": meta.get("horizonDays", 90),
            "labelDefinition": "label = 1 nếu khách không mua lại trong 90 ngày sau mốc",
            "trainSeconds": round(train_seconds, 2),
            "nodeCount": node_count,
        },
        "metrics": {
            "aucTest": round(auc_test, 4),
            "aucTrain": round(auc_train, 4),
            "aucBaseline": round(auc_base, 4),
            "prAuc": round(pr_test, 4),
            # Phải bằng `decisionThreshold` và bằng ngưỡng dùng cho `cm`. Trước đây
            # chỗ này ghi thr_train còn `cm` tính bằng thr_oof ⇒ hai ngưỡng khác nhau
            # nằm trong cùng một khối số liệu, đọc ra mâu thuẫn.
            "threshold": thr_oof["threshold"],
            "thresholdOnTrainSet": round(thr_train["threshold"], 4),
            **cm,
        },
        "limitations": [
            "Dữ liệu là UCI Online Retail II (bán lẻ quốc tế, 24 tháng) — chưa phải dữ liệu Việt Nam.",
            "Panel dựng từ lịch sử giao dịch thật nhưng khách là mã thay thế KH-xxxxx, không phải khách hàng của Aduu ERP.",
            "Nhãn churn = không mua lại trong 90 ngày; khách bị 1 mốc chấm là có thể quay lại ở mốc sau (mẫu lặp lại theo khách) — đã tách theo thời gian để hạn chế rò rỉ.",
            "Ngưỡng của hệ thống (CHURN_THRESHOLD 0.70) KHÁC ngưỡng vận hành của mô hình ⇒ xem mapToSystemScale() trong churn-model.service.js.",
            "Chênh lệch AUC so với hồi quy logistic chỉ khoảng 0.007. Sử dụng mô hình này vì đọc được quy tắc chia cây, không phải vì vượt trội về độ chính xác.",
        ],
    }
    with open(OUT_MODEL, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=1)

    metrics_payload = {
        "aucTest": round(auc_test, 4),
        "aucTrain": round(auc_train, 4),
        "aucBaseline": round(auc_base, 4),
        "prAuc": round(pr_test, 4),
        "threshold": thr_oof["threshold"],
        "thresholdOnTrainSet": round(thr_train["threshold"], 4),
        "confusion": cm,
        "params": payload["params"],
        "leafSearch": LEAVES_SEARCHED,
        "treeCount": len(trees),
        "nodeCount": node_count,
        "modelFile": "churn-lgbm.json",
        "trainedOn": payload["trainedOn"],
    }
    with open(OUT_METRICS, "w", encoding="utf-8") as fh:
        json.dump(metrics_payload, fh, ensure_ascii=False, indent=2)

    # Bản gốc của LightGBM, giữ lại để đối chiếu.
    #
    # Tệp JSON ở trên là bản rút gọn cho Node đọc; nó KHÔNG phải định dạng mô hình
    # chuẩn của LightGBM nên `lgb.Booster(model_file=...)` không mở được. Tệp này
    # giữ bản gốc để `scripts/verify-churn-tree-scorer.js` kiểm chứng rằng dự đoán
    # của Node khớp thư viện, và để nạp lại mô hình khi cần dự báo tiếp trong Python.
    native_path = os.path.join(OUT_DIR, "churn-lgbm-native.txt")
    clf.booster_.save_model(native_path)

    size_kb = os.path.getsize(OUT_MODEL) / 1024
    print("-" * 78)
    print(f"Đã ghi {os.path.relpath(OUT_MODEL, ROOT)} ({size_kb:.0f} KB, {len(trees)} cây, {node_count} nút)")
    print(f"Đã ghi {os.path.relpath(OUT_METRICS, ROOT)}")
    print(f"Đã ghi {os.path.relpath(native_path, ROOT)} (bản gốc LightGBM, để đối chiếu)")
    print("Kiểm chứng dự đoán: node scripts/verify-churn-tree-scorer.js")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())