'use strict';

/**
 * modules/customers/churn-model.service.js — Mô hình dự đoán rời bỏ (AN.4)
 *
 * ============================================================================
 * VAI TRÒ
 * `clv-forecast.service.js` tính CLV và xác suất churn bằng CÔNG THỨC
 * (BG/NBD + hazard) — ổn định, chạy được với dữ liệu ít, nhưng không học từ dữ
 * liệu. Module này chấm điểm khách bằng mô hình ĐÃ HUẤN LUYỆN rồi hợp nhất với
 * công thức.
 *
 * ============================================================================
 * HAI MÔ HÌNH, THỨ TỰ ƯU TIÊN
 *   1. `churn-lgbm.json` — LightGBM, huấn luyện bằng Python (`scripts/ml/train-churn.py`),
 *      chấm điểm bằng Node thuần qua `churn-trees.service.js`. AUC test 0.6804,
 *      PR-AUC 0.3995, ngưỡng 0.166 chọn bằng OOF.
 *   2. `churn-logreg.json` — hồi quy logistic, huấn luyện bằng JavaScript
 *      (`scripts/ml/train-churn-logreg.js`). AUC test 0.6738.
 *
 * Vì sao phải nối thứ tự này: LightGBM chỉ thắng logistic khoảng 0.007 AUC, và sự
 * thắng nhỏ đó KHÔNG đáng để mất tính ổn định. Nhưng ở đồ án thì mô hình đọc được
 * quy tắc ( cây so sánh ngưỡng) có giá trị trình bày, nên dùng khi có, và giữ
 * logistic làm lưới an toàn cho môi trường chưa sinh tệp LightGBM.
 *
 * Hệ quả cần nhớ: `scoreCustomer` trả `engine` để biết mô hình nào đã chạy. Đừng
 * so sánh xác suất giữa hai engine — chúng khác thang nội bộ.
 *
 * ============================================================================
 * VÌ SAO CÓ FALLBACK
 * Mô hình được huấn luyện trên dữ liệu UCI Online Retail II — mô hình chỉ dùng
 * được khi khách có đủ 2 đơn hoàn tất trong 12 tháng (đúng điều kiện dựng
 * panel). Khách mới, khách không có lịch sử, hay khi file mô hình chưa được tạo
 * (ví dụ môi trường demo mới) thì HỆ THỐNG PHẢI vẫn chạy được ⇒ quay về công
 * thức cũ. Mọi lần chấm đều ghi lại engine đã dùng để tra vết.
 *
 * HÀNH VI TRẢ VỀ LUÔN CÓ `engine`:
 *   "lgbm-v1"    — cây quyết định LightGBM (ưu tiên)
 *   "logreg-v1"  — hồi quy logistic (dự phòng)
 *   "bnbd-formula" — công thức BG/NBD (khi không có mô hình nào)
 *
 * Ngưỡng quyết định: file mô hình lưu `decisionThreshold` đã chọn bằng OOF. TUYỆT
 * ĐỐI không dùng 0.5 ở production — kết quả thực tế sẽ lệch với đánh giá trong báo
 * cáo.
 */

const fs = require("fs");
const path = require("path");
const prisma = require("../../config/prisma");
const { getTenantId } = require("../../config/tenantContext");
const logger = require("../../utils/logger");

// Mô hình ưu tiên — chấm bằng Node thuần, không cần thư viện native.
const churnTrees = require("./churn-trees.service");

// Mô hình dự phòng — logistic, nạp trực tiếp tại đây vì cách chấm khác hẳn
// (trọng số tuyến tính + z-score) nên không dùng lại được bộ đi cây.
const MODEL_PATH = path.join(__dirname, "..", "..", "..", "data", "dataset", "churn", "churn-logreg.json");
const OBSERVATION_DAYS = 365;

// Ngưỡng của hệ thống (`churn-automation.service.js`): khách ≥ 0.70 mới sinh
// cảnh báo + voucher. Mô hình dùng ngưỡng riêng (≈0.166 cho LightGBM) vì thang xác
// suất khác nhau — xem `mapToSystemScale()` để ánh xạ tương đương.
const SYSTEM_CHURN_THRESHOLD = 0.7;

/** Cache mô hình logistic trong tiến trình: đọc + parse JSON mỗi lần gọi là lãng phí. */
let logregCache = { mtimeMs: 0, model: null };

/**
 * Nạp mô hình logistic dự phòng.
 *
 * `fs.statSync` cố ý đứng TRƯỚC kiểm tra cache: nếu đảo thứ tự, khi tệp bị xoá
 * trong lúc tiến trình đang chạy thì cache cũ vẫn được trả về và việc "thiếu mô
 * hình" không bao giờ lộ ra. Test `churn-model.service.test.js` chặn `statSync`
 * để kiểm tra đúng nhánh này.
 */
const loadLogisticModel = () => {
  try {
    const stat = fs.statSync(MODEL_PATH);
    if (logregCache.model && logregCache.mtimeMs === stat.mtimeMs) return logregCache.model;
    const model = JSON.parse(fs.readFileSync(MODEL_PATH, "utf8"));
    if (!model.weights || !Array.isArray(model.weights) || !Array.isArray(model.features)) {
      throw new Error("file mô hình thiếu weights/features");
    }
    logregCache = { mtimeMs: stat.mtimeMs, model };
    logger.info(
      `[churn-model] nạp mô hình ${model.version} — AUC test=${model.metrics?.aucTest}, ngưỡng=${model.decisionThreshold}`,
    );
    return model;
  } catch (e) {
    // Không ném lỗi: thiếu mô hình KHÔNG được làm hỏng dự báo churn.
    logregCache = { mtimeMs: 0, model: null };
    logger.warn(`[churn-model] không nạp được mô hình logistic (${e.message})`);
    return null;
  }
};

/**
 * Mô hình đang có hiệu lực: LightGBM nếu có, không thì logistic.
 *
 * Hàm này chỉ dùng để báo cáo trạng thái. Việc chấm điểm đi qua `scoreCustomer`.
 */
const loadModel = () => churnTrees.loadModel() || loadLogisticModel();

/** log1p — đặc trưng tiền phải qua log1p (xem giải thích ở build-churn-panel.js). */
const log1p = (v) => Math.log1p(Math.max(0, Number(v) || 0));

/** Chuẩn hoá đặc trưng đúng theo lúc train (thứ tự cột phải khớp `features`). */
const buildFeatures = (metrics, model) => {
  const out = {};
  for (const f of model.features) {
    switch (f) {
      case "recencyDays": out[f] = metrics.recencyDays ?? 0; break;
      case "frequency": out[f] = metrics.frequency ?? 0; break;
      // Tiền: log1p ở CẢ lúc train lẫn lúc chạy — dùng số tiền thô ở đây sẽ
      // làm z-score lệch (GBP khi train, VND khi chạy) và mọi xác suất dồn về 0.
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
 * Chấm điểm 1 khách bằng mô hình.
 *
 * @returns {{p:number, engine:string, threshold:number}|null} null khi thiếu dữ liệu
 */
const scoreCustomer = (customer, metrics) => {
  // Cùng điều kiện với lúc dựng panel: cần ≥ 2 đơn trong 12 tháng.
  if (!metrics || metrics.frequency < 2 || metrics.recencyDays == null) return null;

  // Ưu tiên cây quyết định. `churnTrees.predict` tự xử lý việc thiếu tệp mô hình
  // và trả null, nên không cần bọc try ở đây.
  const treeModel = churnTrees.loadModel();
  if (treeModel) {
    const p = churnTrees.predict(metrics);
    if (p != null) {
      return {
        p,
        engine: treeModel.version || "lgbm-v1",
        threshold: treeModel.decisionThreshold ?? 0.5,
      };
    }
  }

  const model = loadLogisticModel();
  if (!model) return null;

  const raw = buildFeatures(metrics, model);
  let z = model.bias;
  for (let i = 0; i < model.features.length; i += 1) {
    const f = model.features[i];
    const x = (raw[f] - model.scaler.mean[f]) / (model.scaler.std[f] || 1);
    z += model.weights[i] * x;
  }
  const p = 1 / (1 + Math.exp(-z));
  return {
    p: Number(p.toFixed(4)),
    engine: model.version || "logreg-v1",
    threshold: model.decisionThreshold ?? 0.5,
  };
};

/**
 * Quy đổi KẾT QUẢ mô hình sang thang của hệ thống (ngưỡng vận hành 0.70).
 *
 * VÌ SAO KHÔNG QUY ĐỔI NHƯ MỘT XÁC SUẤT THUẦN
 * Mô hình cho xác suất churn trong 90 ngày; hệ thống dùng ngưỡng 0.70 là ngưỡng
 * TUYỆT ĐỐI của quy tắc nghiệp vụ. Nếu đem nguyên xác suất của mô hình (ngưỡng
 * ≈0.166 cho LightGBM, ≈0.207 cho logistic) vào so với 0.70 thì:
 *   - mọi khách có ≥ 2 đơn đều vượt ngưỡng ⇒ gửi voucher cho tất cả, HOẶC
 *   - nếu chuẩn hoá tuyến tính cho "vừa đủ" thì mất hết khác biệt giữa các
 *     khách sắp rời bỏ.
 * Thử nghiệm đầu tiên đã cho ra đúng lỗi thứ nhất: 0 khách nào vượt 0.70.
 *
 * CÁCH LÀM ĐÚNG: mô hình là BẰNG CHỨNG BỔ SUNG, không phải thay thế.
 *   - Dưới ngưỡng mô hình ⇒ mô hình không thấy rủi ro ⇒ trả 0 (không nâng cảnh báo).
 *   - Từ ngưỡng mô hình trở lên ⇒ mô hình khẳng định khách sắp rời bỏ ⇒ trả
 *     0.70 (đủ để kích hoạt) và tăng dần tới 0.85 cho khách rất chắc chắn.
 * Hệ thống cuối cùng dùng `max(công thức, mô hình)` ⇒ công thức cũ không mất tác
 * dụng, mô hình bắt được phần khách mà công thức bỏ sót.
 *
 * @param {number} p xác suất của mô hình (thang 0…1)
 * @param {number} modelThreshold ngưỡng vận hành của mô hình
 * @returns {number} 0 hoặc trong [0.70, 0.85]
 */
const mapToSystemScale = (p, modelThreshold) => {
  if (!(modelThreshold > 0 && modelThreshold < 1)) return p >= modelThreshold ? 1 : 0;
  if (p < modelThreshold) return 0;
  const excess = (p - modelThreshold) / (1 - modelThreshold);
  return Number((SYSTEM_CHURN_THRESHOLD + 0.15 * Math.min(1, excess)).toFixed(4));
};

/** Hợp nhất công thức và mô hình — lấy giá trị cao hơn. */
const combine = (formulaProbability, modelProbability) => {
  const a = formulaProbability == null ? 0 : Number(formulaProbability);
  const b = modelProbability == null ? 0 : Number(modelProbability);
  return Math.max(a, b);
};

/**
 * Chấm điểm và GHI vào `customers.churnProbability` + log cơ sở.
 *
 * @param {string} customerId
 * @param {object} client Prisma client (truyền `tx` khi cần nhất quán transaction)
 * @returns {Promise<{churnProbability:number|null, engine:string}>}
 */
const scoreCustomerAndPersist = async (customerId, client = prisma) => {
  const customer = await client.customer.findUnique({
    where: { id: customerId },
    select: { id: true, churnProbability: true },
  });
  if (!customer) return { churnProbability: null, engine: "missing-customer" };

  const clvForecast = require("./clv-forecast.service");
  // Đặc trưng lấy từ đúng hàm mà `clv-forecast` dùng cho công thức ⇒ mô hình và
  // công thức nhìn cùng một dữ liệu, chỉ khác cách suy luận.
  const metrics = await clvForecast.deriveMetrics(customerId);
  const scored = metrics ? scoreCustomer(customer, metrics) : null;
  if (!scored) {
    return { churnProbability: customer.churnProbability ?? null, engine: "bnbd-formula" };
  }

  const systemProbability = mapToSystemScale(scored.p, scored.threshold);
  await client.customer.update({
    where: { id: customerId },
    data: { churnProbability: systemProbability, churnScoredAt: new Date() },
  });
  logger.info(
    `[churn-model] khách ${customerId}: p_model=${scored.p} → p_hệ_thống=${systemProbability} ` +
      `(ngưỡng mô hình ${scored.threshold}, engine=${scored.engine}, atRisk=${systemProbability >= SYSTEM_CHURN_THRESHOLD})`,
  );
  return { churnProbability: systemProbability, engine: scored.engine };
};

const isAvailable = () => loadModel() != null;

const getModelInfo = () => {
  const model = loadModel();
  if (!model) return { available: false, engine: "bnbd-formula" };
  return {
    available: true,
    engine: model.version || (model.kind === "lightgbm-trees" ? "lgbm-v1" : "logreg-v1"),
    // Báo rõ tệp nào đang được dùng — khi so sánh kết quả giữa hai môi trường,
    // phải biết mình đang chạy engine nào.
    modelFile: model.kind === "lightgbm-trees" ? "churn-lgbm.json" : "churn-logreg.json",
    features: model.features,
    decisionThreshold: model.decisionThreshold,
    metrics: model.metrics,
    trainedOn: model.trainedOn,
    limitations: model.limitations,
  };
};

module.exports = {
  loadModel,
  loadLogisticModel,
  scoreCustomer,
  scoreCustomerAndPersist,
  mapToSystemScale,
  combine,
  isAvailable,
  getModelInfo,
  MODEL_PATH,
  TREE_MODEL_PATH: churnTrees.MODEL_PATH,
  OBSERVATION_DAYS,
  SYSTEM_CHURN_THRESHOLD,
};
