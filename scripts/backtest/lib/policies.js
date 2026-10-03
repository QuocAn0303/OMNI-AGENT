/**
 * scripts/backtest/lib/policies.js — 5 phương án chính sách tồn kho.
 *
 * Ngưỡng và ngữ cảnh trạng thái lấy từ `src/modules/replenishment/calc`:
 *   calcSafetyStock → SS = ceil(z × σ_ngày × √LT)
 *   calcRop         → ROP = ceil(d × LT + SS)
 *   calcOrderQty    → qty = ceil(max(0, S − ATP)) (packMultiple = 1, không MOQ)
 * Ở đây `position` thay cho ATP (xem `simulate.js` về `positionMode`).
 *
 * P5 — "hành vi quan sát (mua thực tế trong dataset)" — **không chạy được**:
 * UCI Online Retail II chỉ có bán ra, không có phiếu mua/PO, nên không có hành
 * vi nhập hàng quan sát được. Ghi `SKIPPED` thay vì bịa (protocol §1 P5 + §12).
 */
const { calcSafetyStock, calcRop } = require("../../../src/modules/replenishment/replenishment.calc");

/** DOC_P1 = 14 là hằng số chốt trước (protocol §2.2, S1) — không nằm trong lưới. */
const DOC_P1 = 14;
const REVIEW_PERIOD_DAYS = 7;

/** P1 — ngưỡng tồn tối thiểu cố định (hiện trạng), công thức giữ nguyên theo §2.2. */
const buildP1 = (p) => {
  const minStock = Math.ceil(DOC_P1 * p.demandPerDay);
  return {
    name: "P1",
    threshold: minStock,
    orderQty: ({ position }) => {
      // d_ref = 0 ⇒ minStock = 0 ⇒ P1 không bao giờ đặt (protocol §2.2).
      if (minStock <= 0) return 0;
      if (position > minStock) return 0;
      return Math.max(1, Math.ceil((2 * minStock - position) * 1.2));
    },
  };
};

/** P2 — trung bình trượt + ROP, rà soát (R,S) chu kỳ 7 ngày. */
const buildRopPolicy = (name, p) => {
  const ss = calcSafetyStock({
    sigmaDaily: p.sigmaDaily,
    leadTimeDays: p.leadTimeDays,
    serviceLevel: p.serviceLevel,
  });
  const rop = calcRop({
    demandPerDay: p.demandPerDay,
    leadTimeDays: p.leadTimeDays,
    safetyStock: ss.safetyStock,
  });
  const orderUpTo = Math.ceil(rop.rop + p.demandPerDay * REVIEW_PERIOD_DAYS);
  return {
    name,
    threshold: rop.rop,
    safetyStock: ss.safetyStock,
    z: ss.z,
    orderUpToLevel: orderUpTo,
    orderQty: ({ position }) => (position <= rop.rop ? orderUpTo - position : 0),
  };
};

/** P4 — days-of-cover cố định, `DOC` là tham số duy nhất. */
const buildP4 = (p) => {
  const level = Math.ceil(p.doc * p.demandPerDay);
  return {
    name: "P4",
    threshold: level,
    orderQty: ({ position }) => (position <= level ? level - position : 0),
  };
};

const SERVICE_LEVEL_GRID = [0.8, 0.85, 0.9, 0.95];
const DOC_GRID = [7, 14, 21, 28];

/**
 * Lưới cấu hình. S12 liệt kê P3 = serviceLevel × alpha = 12 cấu hình, nhưng S2
 * bắt buộc "mỗi phương án tối đa 4 cấu hình, tổng số lần chạy trên tập giữa
 * bằng nhau". S2 thắng ⇒ P3 chỉ lưới `serviceLevel`, `alpha` cố định 0.1
 * (giá trị mặc định của `crostonDemandPerDay`). Xem D-P5-06.
 */
const P3_ALPHA_FIXED = 0.1;

const buildConfig = (policyName, params, p) => {
  const withLt = { ...p, ...params };
  switch (policyName) {
    case "P1":
      return buildP1(withLt);
    case "P2":
      return buildRopPolicy("P2", withLt);
    case "P3":
      return buildRopPolicy("P3", { ...withLt, demandPerDay: p.crostonDemand });
    case "P4":
      return buildP4(withLt);
    default:
      throw new Error(`Khong biet phuong an ${policyName}`);
  }
};

/** Lưới cấu hình theo thứ tự cố định (S6: hoà thì ưu tiên cấu hình đơn giản hơn). */
const configGrid = (policyName) => {
  switch (policyName) {
    case "P1":
      return [{ kind: "P1", label: "P1(DOC=14)" }];
    case "P2":
      return SERVICE_LEVEL_GRID.map((sl) => ({ kind: "P2", serviceLevel: sl, label: `P2(z=${sl})` }));
    case "P3":
      return SERVICE_LEVEL_GRID.map((sl) => ({
        kind: "P3",
        serviceLevel: sl,
        alpha: P3_ALPHA_FIXED,
        label: `P3(z=${sl},a=${P3_ALPHA_FIXED})`,
      }));
    case "P4":
      return DOC_GRID.map((doc) => ({ kind: "P4", doc, label: `P4(DOC=${doc})` }));
    default:
      throw new Error(`Khong biet phuong an ${policyName}`);
  }
};

/** Thứ tự ưu tiên khi hoà (S2): P1 < P4 < P2 < P3. */
const SIMPLICITY_ORDER = { P1: 0, P4: 1, P2: 2, P3: 3 };

const BASELINE_POLICIES = ["P1", "P4"];

module.exports = {
  DOC_P1,
  REVIEW_PERIOD_DAYS,
  SERVICE_LEVEL_GRID,
  DOC_GRID,
  P3_ALPHA_FIXED,
  buildConfig,
  configGrid,
  SIMPLICITY_ORDER,
  BASELINE_POLICIES,
};
