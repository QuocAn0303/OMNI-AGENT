'use strict';

/**
 * modules/customers/churn-trees.service.js — Chấm điểm cây quyết định bằng Node thuần
 *
 * ============================================================================
 * VÌ SAO CÓ TỆP NÀY
 * Mô hình dự đoán rời bỏ được huấn luyện bằng Python (LightGBM, xem
 * `scripts/ml/train-churn.py`) nhưng hệ thống chạy Node. Ta không cài LightGBM vào
 * Node vì đó là phụ thuộc native, mà cây quyết định thì chỉ là so sánh ngưỡng rồi
 * rẽ nhánh — đi cây được bằng JavaScript thuần.
 *
 * Nói cách khác: phần HUẤN LUYỆN viết bằng Python cho dễ đọc, phần DỰ ĐOÁN viết
 * bằng Node cho không cần cài gì. Ranh giới nằm ở tệp JSON mô hình.
 *
 * ============================================================================
 * ĐỊNH DẠNG TỆP MÔ HÌNH (`data/dataset/churn/churn-lgbm.json`)
 * {
 *   "kind": "lightgbm-trees",
 *   "features": ["recencyDays", "frequency", ...],
 *   "thresholdOperator": "<=",
 *   "trees": [
 *     { "nodes": {
 *         "0": { "f": "frequency", "i": 1, "t": 4.5, "l": "1", "r": "3" },
 *         "1": { "leaf": -0.9087 }
 *     }}
 *   ],
 *   "decisionThreshold": 0.166
 * }
 *
 * `i` là CHỈ SỐ CỘT trong `features`, `l`/`r` là nút con trái/phải. Nút lá chỉ có
 * `leaf`. Quy tắc rẽ nhánh: giá trị `<= t` sang trái — khớp `decision_type` của
 * LightGBM cho bài toán nhị phân, và được ghi thành `thresholdOperator` ở tệp để
 * phía Node không phải đoán.
 *
 * ============================================================================
 * XỬ LÝ THIẾU DỮ LIỆU
 * `buildFeatures` giống hệt hàm cùng tên của `churn-model.service.js`: tiền đi
 * qua log1p, `monthsIdle` làm tròn từ số ngày tái mua. Đặc trưng thiếu thì điền 0
 * và cho cây rẽ nhánh bình thường — KHÔNG ném lỗi, vì một khách thiếu dữ liệu
 * không được làm sập cả luồng dự báo.
 *
 * ============================================================================
 * CACHE
 * Theo thời gian sửa file, giống `churn-model.service.js`. Đọc và phân tích JSON
 * 341 KB mỗi lần gọi là lãng phí, còn mô hình trong tiến trình thì không.
 */

const fs = require("fs");
const path = require("path");
const logger = require("../../utils/logger");

const MODEL_PATH = path.join(
  __dirname, "..", "..", "..", "data", "dataset", "churn", "churn-lgbm.json",
);

let cache = { mtimeMs: 0, model: null };

/** Nạp mô hình. Trả về null thay vì ném lỗi — thiếu mô hình không được làm hỏng dự báo. */
const loadModel = () => {
  try {
    const stat = fs.statSync(MODEL_PATH);
    if (cache.model && cache.mtimeMs === stat.mtimeMs) return cache.model;
    const model = JSON.parse(fs.readFileSync(MODEL_PATH, "utf8"));
    if (model.kind !== "lightgbm-trees" || !Array.isArray(model.trees) || !Array.isArray(model.features)) {
      throw new Error("tệp mô hình không đúng định dạng cây quyết định");
    }
    // Chuẩn bị sẵn dạng { root, nodes } để dự đoán chỉ cần một phép tra cứu
    // thuộc tính. Dựng lại bảng nút mỗi lần gọi `predict` là lãng phí O(n) cho mỗi
    // cây, mà `predict` chạy cho từng khách hàng.
    const prepared = model.trees.map((tree) => {
      const nodes = tree.nodes || {};
      const ids = Object.keys(nodes);
      // Nút gốc là nút không được nhắc tới làm con của nút nào.
      const childIds = new Set();
      for (const id of ids) {
        const n = nodes[id];
        if (n.l !== undefined) childIds.add(n.l);
        if (n.r !== undefined) childIds.add(n.r);
      }
      const root = ids.find((id) => !childIds.has(id)) ?? ids[0];
      return { root, nodes };
    });
    cache = { mtimeMs: stat.mtimeMs, model: { ...model, preparedTrees: prepared } };
    logger.info(
      `[churn-trees] nạp mô hình ${model.version} — ${model.trees.length} cây, ` +
        `ngưỡng=${model.decisionThreshold}`,
    );
    return cache.model;
  } catch (e) {
    cache = { mtimeMs: 0, model: null };
    logger.warn(`[churn-trees] không nạp được mô hình (${e.message})`);
    return null;
  }
};

const log1p = (v) => Math.log1p(Math.max(0, Number(v) || 0));

/**
 * Đặc trưng theo đúng thứ tự `features` của mô hình.
 * Phải khớp `scripts/ml/train-churn.py::FEATURES` — lệch thứ tự là dự đoán sai
 * mà không có lỗi nào báo ra.
 */
const buildFeatures = (metrics, model) => {
  const out = {};
  for (const f of model.features) {
    switch (f) {
      case "recencyDays": out[f] = metrics.recencyDays ?? 0; break;
      case "frequency": out[f] = metrics.frequency ?? 0; break;
      case "logMonetary": out[f] = log1p(metrics.monetary); break;
      case "avgGapDays": out[f] = metrics.avgGap ?? 0; break;
      case "tenureDays": out[f] = metrics.tenureDays ?? 0; break;
      case "logAvgOrderValue": out[f] = log1p(metrics.avgOrderValue); break;
      case "monthsIdle": out[f] = Math.floor((metrics.recencyDays ?? 0) / 30.44); break;
      default: out[f] = 0;
    }
  }
  return out;
};

/**
 * Đi một cây, trả giá trị lá (log-odds của cây đó).
 *
 * Vì sao dùng `row[node.f]` (theo TÊN đặc trưng) mà không dùng `row[node.i]`
 * (theo chỉ số): `buildFeatures` trả về đối tượng lấy theo tên, và dùng tên khiến
 * lỗi đặt tên lộ ra ngay khi ra giá trị NaN thay vì im lặng dùng nhầm cột khác.
 */
const walkTree = (nodesById, rootId, row) => {
  let current = nodesById[rootId];
  let guard = 0;
  while (current && current.leaf === undefined) {
    // Cây có tối đa num_leaves lá nên số nút là hữu hạn; guard chỉ chống dữ liệu
    // hỏng tạo vòng lặp vô hạn làm treo tiến trình.
    guard += 1;
    if (guard > 256) {
      logger.warn("[churn-trees] guard-trip: cây có thể hỏng (vòng lặp >256), trả 0 cho cây này");
      return 0;
    }
    const value = row[current.f];
    const next = value <= current.t ? current.l : current.r;
    current = nodesById[next];
  }
  if (!current || typeof current.leaf !== "number") {
    logger.warn("[churn-trees] nút lá thiếu/không số, trả 0 cho cây này");
    return 0;
  }
  return current.leaf;
};

/** Hàm logit nghịch đảo: chuỗi xác suất của LightGBM về xác suất. */
const sigmoid = (z) => 1 / (1 + Math.exp(-z));

/**
 * Dự đoán xác suất rời bỏ.
 *
 * @param {object} metrics đặc trưng thô (recencyDays, frequency, monetary, avgGap,
 *                         tenureDays, avgOrderValue)
 * @returns {number|null} xác suất 0…1, hoặc null khi thiếu mô hình
 */
const predict = (metrics) => {
  const model = loadModel();
  if (!model) return null;
  const row = buildFeatures(metrics, model);
  let sum = 0;
  for (const tree of model.preparedTrees) {
    if (!tree.root) continue;
    sum += walkTree(tree.nodes, tree.root, row);
  }
  // CỘNG dồn rồi mới đưa qua sigmoid — KHÔNG chia trung bình trước. Đã đối chiếu
  // với `predict_proba` của LightGBM: sigmoid(tổng lá) khớp tuyệt đối, còn
  // sigmoid(tổng/300) cho ra mọi xác suất dồn quanh 0,5 và hỏng hoàn toàn.
  return Number(sigmoid(sum).toFixed(6));
};

/** Thông tin mô hình cho giao diện tra cứu. */
const getModelInfo = () => {
  const model = loadModel();
  if (!model) return { available: false, engine: "bnbd-formula" };
  return {
    available: true,
    engine: model.version || "lgbm-v1",
    kind: model.kind,
    treeCount: model.trees.length,
    nodeCount: (model.trainedOn && model.trainedOn.nodeCount) || null,
    features: model.features,
    decisionThreshold: model.decisionThreshold,
    thresholdSource: model.thresholdSource || null,
    params: model.params,
    metrics: model.metrics,
    trainedOn: model.trainedOn,
    featureImportance: model.featureImportance,
    limitations: model.limitations,
  };
};

const isAvailable = () => loadModel() != null;

module.exports = { loadModel, predict, getModelInfo, isAvailable, MODEL_PATH, buildFeatures };