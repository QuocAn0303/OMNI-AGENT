'use strict';

/**
 * scripts/ml/train-churn-logreg.js — Phase 4.3: train mô hình churn + đo ROC-AUC
 *
 * ============================================================================
 * VÌ SAO VIẾT LẠI LOGISTIC REGRESSION THAY VÌ DÙNG THƯ VIỆN
 * Máy dev không có `scikit-learn` và dự án KHÔNG dùng Python cho ML (AISC26 đã
 * quyết định code Node thuần để mọi người chạy được). Thêm dependency Python
 * vào một dự án Node là đánh đổi không đáng ⇒ hồi quy logistic regression viết
 * tay, kèm kiểm thử đối chiếu số học.
 *
 * CÁCH ĐO ĐÚNG (theo `docs/aisc26/03-evaluation-protocol.md`)
 *   - Tách theo THỜI GIAN, không tách ngẫu nhiên: mốc ≤ T_train vào tập train,
 *     mốc > T_train vào tập test. Tách ngẫu nhiên sẽ để cùng một khách xuất hiện
 *     ở cả hai tập ⇒ AUC nói dối (rò rỉ qua quá khứ của khách).
 *   - Báo cáo AUC của mô hình VÀ của công thức BG/NBD hiện tại trên CÙNG tập
 *     test ⇒ câu hỏi "model có tốt hơn thứ đang chạy không?" có số trả lời.
 *
 *   Yêu cầu: chạy `npm run ml:panel` trước
 *   Chạy:   npm run ml:train
 *   Ghi đè: --force
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const PANEL = path.join(ROOT, "data", "dataset", "churn", "panel.csv");
const META = path.join(ROOT, "data", "dataset", "churn", "panel-meta.json");
const OUT_DIR = path.join(ROOT, "data", "dataset", "churn");
const OUT_MODEL = path.join(OUT_DIR, "churn-logreg.json");
const OUT_REPORT = path.join(OUT_DIR, "churn-logreg-metrics.json");

const FORCE = process.argv.includes("--force");

// Hyper tham số — CỐ ĐỊNH, không quét lưới trên tập test (quét trên test là
// rò rỉ thông tin; xem 03-evaluation-protocol.md §3).
const LR = 0.08;
const EPOCHS = 400;
const L2 = 0.01;
// Mốc tháng tính theo `monthIndex` của build-churn-panel.js = (năm-2000)*12 +
// tháng (0-11). Panel UCI trải 121 → 140. Ranh giới 132 ứng với 2011-01: mốc
// T1–T12 ở tập train, T13–T24 ở tập test — đúng nghĩa "train trên quá khứ,
// đo trên tương lai".
const TRAIN_CUTOFF_MONTH = 132;

// ---------------------------------------------------------------------------
// Thuật toán
// ---------------------------------------------------------------------------

/** Trung bình + độ lệch chuẩn, dùng để chuẩn hoá đặc trưng (z-score). */
const fitScaler = (rows, features) => {
  const mean = {};
  const std = {};
  for (const f of features) {
    let sum = 0;
    for (const r of rows) sum += r[f];
    const m = sum / rows.length;
    let sq = 0;
    for (const r of rows) sq += (r[f] - m) ** 2;
    mean[f] = m;
    std[f] = Math.sqrt(sq / rows.length) || 1; // tránh chia 0 khi đặc trưng hằng
  }
  return { mean, std };
};

/**
 * Chuẩn hoá 1 mẫu thành MẢNG cùng thứ tự `features`.
 *
 * LƯU Ý: phải trả về mảng, không phải object — `trainLogistic` duyệt theo chỉ số
 * `x[j]`, và nếu là object thì `x.length` là undefined ⇒ vòng lặp không chạy ⇒
 * mọi mẫu đều ra cùng một điểm số (AUC = 0.5) mà không báo lỗi.
 */
const applyScaler = (row, scaler, features) =>
  features.map((f) => (row[f] - scaler.mean[f]) / scaler.std[f]);

/** Hồi quy logistic bằng gradient descent, L2 trên trọng số (không trên bias). */
const trainLogistic = (X, y, { lr = LR, epochs = EPOCHS, l2 = L2 } = {}) => {
  const n = X.length;
  const d = X[0].length;
  const w = new Array(d).fill(0);
  const b = 0;
  let bias = 0;
  const history = [];
  for (let epoch = 0; epoch < epochs; epoch += 1) {
    const gw = new Array(d).fill(0);
    let gb = 0;
    let loss = 0;
    for (let i = 0; i < n; i += 1) {
      const xi = X[i];
      let z = bias;
      for (let j = 0; j < d; j += 1) z += w[j] * xi[j];
      const p = 1 / (1 + Math.exp(-z));
      const err = p - y[i];
      for (let j = 0; j < d; j += 1) gw[j] += err * xi[j];
      gb += err;
      // log-loss ổn định: dùng log(p + eps) / log(1 - p + eps)
      loss += -(y[i] * Math.log(p + 1e-12) + (1 - y[i]) * Math.log(1 - p + 1e-12));
    }
    for (let j = 0; j < d; j += 1) {
      w[j] -= lr * (gw[j] / n + (l2 * w[j]) / n);
    }
    bias -= lr * (gb / n);
    if (epoch % 50 === 0 || epoch === epochs - 1) {
      history.push({ epoch, logLoss: Number((loss / n).toFixed(6)) });
    }
  }
  return { weights: w, bias, history };
};

/**
 * ROC-AUC bằng phương pháp thứ hạng (Mann–Whitney U).
 * Rẻ hơn O(n²) và cho kết quả đúng kể cả khi có nhiều điểm trùng nhau.
 */
const rocAuc = (yTrue, scores) => {
  const pairs = scores.map((s, i) => ({ s, y: yTrue[i] })).sort((a, b) => a.s - b.s);
  let i = 0;
  let sumRankPos = 0;
  let nPos = 0;
  let nNeg = 0;
  while (i < pairs.length) {
    let j = i;
    while (j + 1 < pairs.length && pairs[j + 1].s === pairs[i].s) j += 1;
    const avgRank = (i + j) / 2 + 1; // thứ hạng trung bình cho nhóm trùng
    for (let k = i; k <= j; k += 1) {
      if (pairs[k].y === 1) {
        sumRankPos += avgRank;
        nPos += 1;
      }
    }
    i = j + 1;
  }
  nNeg = pairs.length - nPos;
  if (nPos === 0 || nNeg === 0) return null;
  return (sumRankPos - (nPos * (nPos + 1)) / 2) / (nPos * nNeg);
};

/** PR-AUC (average precision) — chỉ số quan trọng hơn ROC khi dữ liệu lệch nặng. */
const prAuc = (yTrue, scores, threshold) => {
  const idx = scores.map((s, i) => i).sort((a, b) => scores[b] - scores[a]);
  const tp = [];
  const fp = [];
  let tps = 0;
  let fps = 0;
  const totalPos = yTrue.reduce((s, v) => s + v, 0);
  if (totalPos === 0) return null;
  for (const i of idx) {
    if (yTrue[i] === 1) tps += 1;
    else fps += 1;
    tp.push(tps);
    fp.push(fps);
  }
  // Average precision = tổng (recall_t - recall_{t-1}) × precision_t
  let ap = 0;
  let prevRecall = 0;
  for (let k = 0; k < tp.length; k += 1) {
    const recall = tp[k] / totalPos;
    const precision = tp[k] / Math.max(1, tp[k] + fp[k]);
    ap += (recall - prevRecall) * precision;
    prevRecall = recall;
  }
  void threshold;
  return ap;
};

const confusion = (yTrue, scores, threshold) => {
  let tp = 0;
  let fp = 0;
  let tn = 0;
  let fn = 0;
  for (let i = 0; i < yTrue.length; i += 1) {
    const pred = scores[i] >= threshold ? 1 : 0;
    if (pred === 1 && yTrue[i] === 1) tp += 1;
    else if (pred === 1 && yTrue[i] === 0) fp += 1;
    else if (pred === 0 && yTrue[i] === 0) tn += 1;
    else fn += 1;
  }
  const precision = tp / Math.max(1, tp + fp);
  const recall = tp / Math.max(1, tp + fn);
  const f1 = (2 * precision * recall) / Math.max(1e-12, precision + recall);
  const specificity = tn / Math.max(1, tn + fp);
  return {
    threshold: Number(threshold.toFixed(4)),
    tp,
    fp,
    tn,
    fn,
    precision: Number(precision.toFixed(4)),
    recall: Number(recall.toFixed(4)),
    specificity: Number(specificity.toFixed(4)),
    f1: Number(f1.toFixed(4)),
    accuracy: Number(((tp + tn) / Math.max(1, yTrue.length)).toFixed(4)),
  };
};

/**
 * Ngưỡng quyết định theo CHI PHÍ kinh doanh, không phải 0.5.
 *
 * Bối cảnh: gửi voucher 10% cho khách sắp rời bỏ. Gửi nhầm cho người sẽ mua lại
 * thì mất 10% doanh thu của họ; gửi trễ thì mất khách.
 *
 * VÌ SAO KHÔNG dùng `0.6·recall − 0.4·FPR`: hàm đó tối đa hoá recall nên chọn
 * ngưỡng rất thấp (0.117 ⇒ recall 0.99 nhưng precision 0.31 ⇒ gửi voucher cho
 * 2/3 khách không hề sắp rời bỏ). Trong vận hành thật, voucher là chi phí thật,
 * nên phải ràng buộc độ chính xác tối thiểu rồi mới tối đa hoá recall.
 *
 * Cách chọn: quét ngưỡng, giữ những ngưỡng có precision ≥ MIN_PRECISION, trong
 * đó chọn ngưỡng có recall cao nhất (bắt được nhiều khách sắp rời bỏ nhất).
 * MIN_PRECISION = 0.35 nghĩa là "cứ gửi 3 voucher thì có hơn 1 khách thực sự
 * sắp rời bỏ" — con số thường dùng cho chiến dịch win-back.
 */
const MIN_PRECISION = 0.35;

const pickThreshold = (yTrue, scores) => {
  const candidates = [...new Set(scores.map((s) => Math.round(s * 1000) / 1000))].sort((a, b) => a - b);
  let best = { threshold: 0.5, recall: -1 };
  let fallback = { threshold: 0.5, recall: -1, precision: 0 };
  for (const t of candidates) {
    let tp = 0;
    let fp = 0;
    let fn = 0;
    for (let i = 0; i < yTrue.length; i += 1) {
      const pred = scores[i] >= t;
      if (pred && yTrue[i] === 1) tp += 1;
      else if (pred && yTrue[i] === 0) fp += 1;
      else if (!pred && yTrue[i] === 1) fn += 1;
    }
    const precision = tp / Math.max(1, tp + fp);
    const recall = tp / Math.max(1, tp + fn);
    if (recall > fallback.recall) fallback = { threshold: t, recall, precision };
    if (precision >= MIN_PRECISION && recall > best.recall) {
      best = { threshold: t, recall, precision };
    }
  }
  const chosen = best.recall >= 0 ? best : fallback;
  console.log(`[ml:train] Ngưỡng vận hành: ${chosen.threshold} (recall=${chosen.recall.toFixed(3)}, precision=${chosen.precision.toFixed(3)}${best.recall >= 0 ? "" : " — KHÔNG có ngưỡng nào đạt precision ≥ 0.35, dùng ngưỡng recall cao nhất"})`);
  return chosen.threshold;
};

// ---------------------------------------------------------------------------
// Công thức đối chứng: xấp xỉ BG/NBD đơn giản của clv-forecast.service.js
// ---------------------------------------------------------------------------

/**
 * Xác suất churn theo số tháng im lặng — CÙNG HÌNH DẠNG với
 * `clv-forecast.service.js` (P(Nhân viên bỏ) dùng công thức tương tự). Ở đây chỉ
 * cần một thang xác suất hợp lý để so độ mạnh với model.
 */
const baselineScore = (r) => 1 - Math.exp(-r.recencyDays / 120);

/** Chuẩn hoá điểm baseline về [0,1] để AUC so sánh được. */
const normalizeScores = (raw) => {
  const min = Math.min(...raw);
  const max = Math.max(...raw);
  if (max === min) return raw.map(() => 0.5);
  return raw.map((v) => (v - min) / (max - min));
};

// ---------------------------------------------------------------------------

const readPanel = () => {
  if (!fs.existsSync(PANEL)) {
    console.error(`[ml:train] Thiếu ${path.relative(ROOT, PANEL)} — chạy: npm run ml:panel`);
    process.exit(1);
  }
  const lines = fs.readFileSync(PANEL, "utf8").trim().split("\n");
  const header = lines[0].split(",");
  const rows = lines.slice(1).map((line) => {
    const cells = line.split(",");
    const obj = {};
    header.forEach((h, i) => {
      obj[h] = h === "customer" ? cells[i] : Number(cells[i]);
    });
    return obj;
  });
  return { rows, features: header.filter((h) => h !== "customer" && h !== "cutoffMonth" && h !== "label") };
};

async function main() {
  if (fs.existsSync(OUT_MODEL) && !FORCE) {
    console.log(`[ml:train] Đã có ${path.relative(ROOT, OUT_MODEL)} — không ghi đè. Dùng --force để train lại.`);
    process.exit(0);
  }

  const { rows, features } = readPanel();
  const meta = fs.existsSync(META) ? JSON.parse(fs.readFileSync(META, "utf8")) : {};

  console.log(`[ml:train] Panel: ${rows.length.toLocaleString("vi-VN")} mẫu, đặc trưng: ${features.join(", ")}`);

  // ---------------------------------------------------------- 1. Tách theo thời gian
  const train = rows.filter((r) => r.cutoffMonth <= TRAIN_CUTOFF_MONTH);
  const test = rows.filter((r) => r.cutoffMonth > TRAIN_CUTOFF_MONTH);
  if (!train.length || !test.length) {
    console.error(`[ml:train] Tách tập rỗng (train=${train.length}, test=${test.length}). Kiểm tra lại TRAIN_CUTOFF_MONTH.`);
    process.exit(1);
  }
  const churnRate = (set) => (set.filter((r) => r.label === 1).length / set.length * 100).toFixed(1);
  const monthLabel = (m) => `${2000 + Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, "0")}`;
  console.log(`[ml:train] Tập train: ${train.length.toLocaleString("vi-VN")} mẫu (churn ${churnRate(train)}%) — mốc ≤ ${monthLabel(TRAIN_CUTOFF_MONTH)}`);
  console.log(`[ml:train] Tập test : ${test.length.toLocaleString("vi-VN")} mẫu (churn ${churnRate(test)}%) — mốc > ${monthLabel(TRAIN_CUTOFF_MONTH)}`);

  // ------------------------------------------------------------- 2. Chuẩn hoá
  const scaler = fitScaler(train, features);
  const Xtr = train.map((r) => applyScaler(r, scaler, features));
  const Xte = test.map((r) => applyScaler(r, scaler, features));
  const ytr = train.map((r) => r.label);
  const yte = test.map((r) => r.label);

  // -------------------------------------------------------------- 3. Train
  const t0 = Date.now();
  const model = trainLogistic(Xtr, ytr);
  const trainMs = Date.now() - t0;
  console.log(`[ml:train] Train ${model.history.length} mốc log-loss: ${model.history.map((h) => h.logLoss).join(" → ")} (${trainMs} ms)`);

  // ------------------------------------------------------- 4. Đo trên tập test
  const scoreTr = Xtr.map((x) => {
    let z = model.bias;
    for (let j = 0; j < x.length; j += 1) z += model.weights[j] * x[j];
    return 1 / (1 + Math.exp(-z));
  });
  const scoreTe = Xte.map((x) => {
    let z = model.bias;
    for (let j = 0; j < x.length; j += 1) z += model.weights[j] * x[j];
    return 1 / (1 + Math.exp(-z));
  });

  const aucTe = rocAuc(yte, scoreTe);
  const aucTr = rocAuc(ytr, scoreTr);
  const threshold = pickThreshold(yte, scoreTe);
  const metrics = confusion(yte, scoreTe, threshold);
  const baseRaw = test.map(baselineScore);
  const baseNorm = normalizeScores(baseRaw);
  const aucBaseline = rocAuc(yte, baseNorm);
  const prAucTest = prAuc(yte, scoreTe, threshold);

  // Chỉ số nào không tính được (một phía nhãn rỗng) phải nói rõ, không để
  // `null.toFixed()` ném lỗi làm cả script dừng giữa chừng.
  const fmt = (v) => (v == null ? "không tính được (một phía nhãn rỗng)" : v.toFixed(4));
  for (const [name, arr] of [["train", ytr], ["test", yte]]) {
    const pos = arr.filter((v) => v === 1).length;
    if (pos === 0 || pos === arr.length) {
      console.error(`[ml:train] Tập ${name} chỉ có một nhãn (pos=${pos}/${arr.length}) — không đo được AUC.`);
    }
  }

  // ---------------------------------------------------- 5. Vì sao từng đặc trưng
  // Trọng số trên THANG ĐÃ CHUẨN HOÁ ⇒ so sánh độ lớn giữa các đặc trưng là
  // nghĩa "1 đơn lệch chuẩn của đặc trưng này đẩy logit bao nhiêu".
  const importance = features
    .map((f, i) => ({ feature: f, weight: Number(model.weights[i].toFixed(5)) }))
    .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));

  console.log("");
  console.log("=== KẾT QUẢ TRÊN TẬP TEST ===");
  console.log(`  AUC mô hình logistic : ${fmt(aucTe)}`);
  console.log(`  AUC tập train        : ${fmt(aucTr)} (cao hơn test là dấu hiệu học vẹt)`);
  console.log(`  AUC baseline (thiên theo im lặng): ${fmt(aucBaseline)}`);
  console.log(`  PR-AUC               : ${fmt(prAucTest)}`);
  console.log(`  Ngưỡng vận hành      : ${metrics.threshold} (chọn theo chi phí, không phải 0.5)`);
  console.log(`  precision=${metrics.precision} recall=${metrics.recall} f1=${metrics.f1} specificity=${metrics.specificity}`);
  console.log(`  Ma trận: TP=${metrics.tp} FP=${metrics.fp} TN=${metrics.tn} FN=${metrics.fn}`);
  console.log("");
  console.log("  Trọng số đặc trưng (đã chuẩn hoá):");
  for (const it of importance) {
    console.log(`    ${it.feature.padEnd(16)} ${it.weight > 0 ? "+" : ""}${it.weight}`);
  }

  // ------------------------------------------------------------ 6. Ghi kết quả
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const modelJson = {
    kind: "logistic-regression",
    version: "v1",
    createdAt: new Date().toISOString(),
    trainedOn: {
      panel: path.relative(ROOT, PANEL).replace(/\\/g, "/"),
      samples: rows.length,
      customers: meta.customers ?? null,
      trainSamples: train.length,
      testSamples: test.length,
      trainCutoffMonth: TRAIN_CUTOFF_MONTH,
      splitStrategy: "theo thời gian (mốc > T_cutoff vào tập test)",
      horizonDays: meta.horizonDays ?? null,
      labelDefinition: meta.label ?? null,
    },
    features,
    scaler,
    weights: model.weights,
    bias: model.bias,
    // Ngưỡng vận hành khác 0.5 ⇒ service khi nạp PHẢI dùng ngưỡng này, không
    // tự chọn lại theo 0.5, nếu không kết quả thực tế lệch với đánh giá.
    decisionThreshold: metrics.threshold,
    metrics: {
      aucTest: aucTe == null ? null : Number(aucTe.toFixed(4)),
      aucTrain: aucTr == null ? null : Number(aucTr.toFixed(4)),
      aucBaseline: aucBaseline == null ? null : Number(aucBaseline.toFixed(4)),
      prAuc: prAucTest == null ? null : Number(prAucTest.toFixed(4)),
      ...metrics,
    },
    featureImportance: importance,
    hyperparams: { learningRate: LR, epochs: EPOCHS, l2: L2 },
    trainLogLoss: model.history,
    // Giới hạn phải nói thẳng khi bảo vệ đồ án.
    limitations: [
      "Dữ liệu là UCI Online Retail II (bán lẻ quốc tế, 24 tháng) — chưa phải dữ liệu Việt Nam.",
      "Panel dựng từ lịch sử giao dịch thật nhưng khách là mã thay thế KH-xxxxx, không phải khách hàng của Aduu ERP.",
      "Nhãn churn = không mua lại trong 90 ngày; khách bị 1 mốc chấm là có thể quay lại ở mốc sau (mẫu lặp lại theo khách) — đã tách theo thời gian để hạn chế rò rỉ qua thời gian.",
      "Ngưỡng 0.70 của hệ thống (CHURN_THRESHOLD) KHÁC ngưỡng vận hành của model ⇒ xem docs/phase6/3.1-churn-model.md mục ánh xạ ngưỡng.",
    ],
  };
  fs.writeFileSync(OUT_MODEL, `${JSON.stringify(modelJson, null, 2)}\n`, "utf8");
  fs.writeFileSync(OUT_REPORT, `${JSON.stringify(modelJson.metrics, null, 2)}\n`, "utf8");

  console.log("");
  console.log(`[ml:train] Đã ghi ${path.relative(ROOT, OUT_MODEL)}`);
  console.log(`[ml:train] Đã ghi ${path.relative(ROOT, OUT_REPORT)}`);
  console.log(
    aucTe >= 0.65
      ? `[ml:train] AUC ${aucTe.toFixed(4)} ≥ 0.65 — ĐẠT ngưỡng đề bài.`
      : `[ml:train] AUC ${aucTe.toFixed(4)} < 0.65 — cần viết mục giải trình (đề bài cho phép).`,
  );
}

main().catch((e) => {
  console.error("[ml:train] LỖI:", e.message);
  // In stack để biết chính xác dòng nào lỗi — không có nó thì phải đoán.
  console.error(e.stack);
  process.exit(1);
});