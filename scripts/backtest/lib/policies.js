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
  // Thí nghiệm 1 (protocol §2.2) khoá `DOC_P1 = 14`. Thí nghiệm 2 (protocol
  // §13.2.2) mở lưới `DOC ∈ {7,14,21,28}` để P1 cũng "tune dưới ràng buộc
  // dịch vụ" — cấu hình DOC=14 chính là P1 của thí nghiệm 1.
  const doc = p.doc === undefined ? DOC_P1 : p.doc;
  const minStock = Math.ceil(doc * p.demandPerDay);
  return {
    name: "P1",
    doc,
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

/**
 * Thí nghiệm 2 (protocol §13.2.2) — cùng lưới như thí nghiệm 1, **trừ P1** được mở
 * `DOC ∈ {7,14,21,28}` để chịu cùng ràng buộc dịch vụ. Ngân sách vẫn 4 cấu hình mỗi
 * phương án (S2).
 */
const constrainedGrid = (policyName) => {
  if (policyName === "P1") return DOC_GRID.map((doc) => ({ kind: "P1", doc, label: `P1(DOC=${doc})` }));
  return configGrid(policyName);
};

/**
 * Sắp xếp theo ràng buộc dịch vụ (protocol §13.2.1), chốt trước khi chạy:
 *   1. cấu hình nào `fillRate_mid >= MIN_FILL_RATE` (feasible) được xếp trước;
 *   2. trong feasible: `z`/`DOC` NHỎ nhất trước (mức phục vụ thấp nhất vẫn thoả);
 *   3. hoà z: chi phí chuẩn hoá nhỏ hơn; hoà tiếp: phương án đơn giản hơn (S2);
 *   4. hoàn toàn không feasible ⇒ `fillRate_mid` CAO nhất, rồi chi phí nhỏ nhất.
 * Không bao giờ nới `MIN_FILL_RATE`, không thêm mức ngoài lưới.
 */
const pickConstrained = (candidates, minFillRate) => {
  if (!candidates.length) return { best: null, infeasible: true };
  const level = (c) => (c.config.serviceLevel !== undefined ? c.config.serviceLevel : c.config.doc);
  const feasible = candidates.filter((c) => c.fillRateMid !== null && c.fillRateMid >= minFillRate);
  const infeasible = feasible.length === 0;
  const pool = infeasible ? candidates : feasible;
  const sorted = pool.slice().sort((a, b) => {
    if (infeasible) {
      const d = (b.fillRateMid ?? -1) - (a.fillRateMid ?? -1);
      if (Math.abs(d) > 1e-12) return d;
    } else {
      const d = level(a) - level(b);
      if (Math.abs(d) > 1e-12) return d;
    }
    const dObj = a.objectiveMid - b.objectiveMid;
    if (Math.abs(dObj) > 1e-9) return dObj;
    return a.simplicity - b.simplicity;
  });
  return { best: sorted[0], infeasible };
};

const BASELINE_POLICIES = ["P1", "P4"];

module.exports = {
  DOC_P1,
  REVIEW_PERIOD_DAYS,
  SERVICE_LEVEL_GRID,
  DOC_GRID,
  P3_ALPHA_FIXED,
  buildConfig,
  configGrid,
  constrainedGrid,
  pickConstrained,
  SIMPLICITY_ORDER,
  BASELINE_POLICIES,
};
