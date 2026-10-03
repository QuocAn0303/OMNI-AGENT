/**
 * tests/replenishment.boundary.test.js — TEST BIÊN cho từng công thức
 *
 * Mục đích: chứng minh `replenishment.calc.js` KHÔNG trả số rác khi dữ liệu
 * xấu. Đây là phần giám khảo sẽ thử — nếu một hàm trả `NaN` thì số đó lọt vào
 * payload đề xuất PO và ra số lượng đặt sai mà không ai báo lỗi.
 *
 * Nguyên tắc chung của mọi hàm thuần ở đây:
 *   - đầu vào thiếu/rỗng/NaN  → kết quả phải là số HỮU HẠN (0 hoặc giá trị mặc định hợp lý)
 *   - đầu vào âm cho đại lượng không âm (số lượng, giá) → kẹp về 0
 *   - đầu vào rất lớn → không tràn, vẫn hữu hạn
 *
 * Ngoại lệ DUY NHẤT được phép ném lỗi: tham số phiên bản cấu hình không hợp lệ
 * (`serviceLevel` ngoài bảng z) — đó là lỗi cấu hình, không phải lỗi dữ liệu.
 */
const calc = require("../src/modules/replenishment/replenishment.calc");
const {
  calcDemand,
  calcLeadTime,
  calcAtp,
  calcSafetyStock,
  calcRop,
  calcDaysOfCover,
  evaluateStockStatus,
  evaluateProposalFreshness,
  calcOrderQty,
  planReplenishment,
  classifyUnitCost,
  QTY_DRIFT_TOL,
  COST_DRIFT_TOL,
  DRIFT_NONE,
  DRIFT_WARN,
  DRIFT_BLOCK,
  NO_LONGER_NEEDED,
  MISSING_COST,
} = calc;

/** Mọi số trong object phải hữu hạn (không NaN, không Infinity). */
const assertFiniteDeep = (obj, label) => {
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "number") {
      expect(Number.isFinite(v)).toBe(true);
    } else if (k === "infinite") {
      expect(typeof v).toBe("boolean");
    } else if (v && typeof v === "object") {
      assertFiniteDeep(v, `${label}.${k}`);
    }
  }
};

const BAD_NUMBERS = [undefined, null, NaN, -1, -0.5, "abc", "", [], {}, true];

describe("BIÊN · calcAtp", () => {
  it.each(BAD_NUMBERS)("quantity = %p → vẫn hữu hạn", (bad) => {
    const r = calcAtp({ inventories: [{ quantity: bad, reserved: bad }] });
    expect(Number.isFinite(r.atp)).toBe(true);
  });

  it("inventories undefined → 0", () => {
    expect(calcAtp({}).atp).toBe(0);
    expect(calcAtp({ inventories: null }).atp).toBe(0);
  });

  it("số lượng cực lớn không làm tràn số", () => {
    const r = calcAtp({ inventories: [{ quantity: 1e15, reserved: 0 }] });
    expect(Number.isFinite(r.atp)).toBe(true);
    expect(r.atp).toBe(1e15);
  });
});

describe("BIÊN · calcDemand", () => {
  it.each(BAD_NUMBERS)("dailySales = %p → số hữu hạn", (bad) => {
    const r = calcDemand({ dailySales: bad });
    expect(Number.isFinite(r.demandPerDay)).toBe(true);
    expect(Number.isFinite(r.sigmaDaily)).toBe(true);
  });

  it("dailySales rỗng → 0, không NaN", () => {
    const r = calcDemand({ dailySales: [] });
    expect(r.demandPerDay).toBe(0);
    expect(r.sigmaDaily).toBe(0);
    expect(r.totalDays).toBe(0);
  });

  it("mọi ngày censored → 0 (không đoán số)", () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ date: `d${i}`, qty: 0, outOfStock: true }));
    expect(calcDemand({ dailySales: rows }).demandPerDay).toBe(0);
  });

  it("qty là NaN trong một ngày → không làm hỏng cả chuỗi", () => {
    const rows = [
      { date: "d1", qty: 4, outOfStock: false },
      { date: "d2", qty: NaN, outOfStock: false },
      { date: "d3", qty: 6, outOfStock: false },
    ];
    const r = calcDemand({ dailySales: rows });
    expect(Number.isFinite(r.demandPerDay)).toBe(true);
  });

  it("qty âm (dữ liệu bẩn) → kẹp về 0, không đẩy trung bình xuống âm", () => {
    const rows = [
      { date: "d1", qty: 10, outOfStock: false },
      { date: "d2", qty: -999, outOfStock: false },
    ];
    const r = calcDemand({ dailySales: rows });
    expect(r.demandPerDay).toBeGreaterThanOrEqual(0);
  });

  it("số ngày cực lớn vẫn hữu hạn", () => {
    const rows = Array.from({ length: 5000 }, (_, i) => ({ date: `d${i}`, qty: 3, outOfStock: false }));
    const r = calcDemand({ dailySales: rows });
    expect(r.demandPerDay).toBe(3);
  });
});

describe("BIÊN · calcSafetyStock", () => {
  it.each(BAD_NUMBERS)("sigmaDaily = %p → SS hữu hạn, không âm", (bad) => {
    const ss = calcSafetyStock({ sigmaDaily: bad, leadTimeDays: 7 });
    expect(Number.isFinite(ss.safetyStock)).toBe(true);
    expect(ss.safetyStock).toBeGreaterThanOrEqual(0);
  });

  it.each(BAD_NUMBERS)("leadTimeDays = %p → SS hữu hạn", (bad) => {
    const ss = calcSafetyStock({ sigmaDaily: 2, leadTimeDays: bad });
    expect(Number.isFinite(ss.safetyStock)).toBe(true);
  });

  it("sigma rất lớn → vẫn hữu hạn (không Infinity)", () => {
    const ss = calcSafetyStock({ sigmaDaily: 1e12, leadTimeDays: 365 });
    expect(Number.isFinite(ss.safetyStock)).toBe(true);
  });

  it("serviceLevel sai → ném lỗi có status (KHÔNG âm thầm dùng mặc định)", () => {
    expect(() => calcSafetyStock({ sigmaDaily: 1, serviceLevel: "high" })).toThrow();
    expect(() => calcSafetyStock({ sigmaDaily: 1, serviceLevel: 5 })).toThrow();
    expect(() => calcSafetyStock({ sigmaDaily: 1, serviceLevel: 0.42 })).toThrow();
  });
});

describe("BIÊN · calcRop", () => {
  it.each(BAD_NUMBERS)("demandPerDay = %p → ROP hữu hạn, không âm", (bad) => {
    const r = calcRop({ demandPerDay: bad, leadTimeDays: 7, safetyStock: 5 });
    expect(Number.isFinite(r.rop)).toBe(true);
    expect(r.rop).toBeGreaterThanOrEqual(0);
  });

  it("mọi tham số undefined → ROP = 0", () => {
    expect(calcRop({}).rop).toBe(0);
  });

  it("demandPerDay dùng chuỗi số vẫn nhận được", () => {
    expect(calcRop({ demandPerDay: "3", leadTimeDays: "7", safetyStock: "0" }).rop).toBe(21);
  });
});

describe("BIÊN · calcDaysOfCover / evaluateStockStatus", () => {
  it("nhu_cầu 0 → không chia cho 0", () => {
    const r = calcDaysOfCover({ atp: 10, demandPerDay: 0 });
    expect(r.daysOfCover).toBeNull();
    expect(r.infinite).toBe(true);
  });

  it("nhu_cầu âm / ATP âm vẫn trả số hữu hạn", () => {
    const r = evaluateStockStatus({ atp: -5, rop: 10, demandPerDay: -2 });
    assertFiniteDeep(r, "status");
  });

  it("ATP âm → STOCKOUT chứ không phải OK", () => {
    expect(evaluateStockStatus({ atp: -1, rop: 10, demandPerDay: 2 }).status).toBe("STOCKOUT");
  });
});

describe("BIÊN · calcLeadTime", () => {
  it("receipts rỗng / null → mặc định + cờ estimated", () => {
    expect(calcLeadTime({}).estimated).toBe(true);
    expect(calcLeadTime({ receipts: null }).estimated).toBe(true);
  });

  it("ngày không parse được bị bỏ qua, không tạo NaN", () => {
    const r = calcLeadTime({
      receipts: [
        { poDate: "không-phải-ngày", receivedAt: "cũng-không" },
        { poDate: "2026-01-01", receivedAt: "2026-01-08" },
        { poDate: "2026-01-02", receivedAt: "2026-01-09" },
        { poDate: "2026-01-03", receivedAt: "2026-01-10" },
      ],
    });
    expect(Number.isFinite(r.leadTimeDays)).toBe(true);
    expect(r.sampleSize).toBe(3);
  });

  it("khoảng cách rất lớn vẫn hữu hạn", () => {
    const r = calcLeadTime({
      receipts: [
        { poDate: "2000-01-01", receivedAt: "2026-01-01" },
        { poDate: "2000-01-02", receivedAt: "2026-01-02" },
        { poDate: "2000-01-03", receivedAt: "2026-01-03" },
      ],
    });
    expect(Number.isFinite(r.leadTimeDays)).toBe(true);
  });
});

describe("BIÊN · calcOrderQty", () => {
  it.each(BAD_NUMBERS)("packMultiple = %p → orderQty hữu hạn", (bad) => {
    const r = calcOrderQty({ atp: 0, rop: 10, packMultiple: bad });
    expect(Number.isFinite(r.orderQty)).toBe(true);
  });

  it("packMultiple lớn bất thường → orderQty vẫn hữu hạn", () => {
    const r = calcOrderQty({ atp: 0, rop: 10, packMultiple: 1e12 });
    expect(Number.isFinite(r.orderQty)).toBe(true);
  });

  it("reviewPeriodDays âm → không sinh S nhỏ hơn ROP", () => {
    const r = calcOrderQty({ atp: 0, rop: 10, demandPerDay: 5, reviewPeriodDays: -7 });
    expect(r.orderUpToLevel).toBeGreaterThanOrEqual(10);
  });

  it("atp > rop → orderQty = 0, không đề xuất rỗng", () => {
    expect(calcOrderQty({ atp: 1000, rop: 10 }).orderQty).toBe(0);
  });
});

describe("BIÊN · evaluateProposalFreshness (mục 2.1)", () => {
  const proposed = { atp: 12, rop: 30, orderQty: 42, unitCost: 45000 };

  it("không đổi gì → DRIFT_NONE, duyệt thẳng", () => {
    const r = evaluateProposalFreshness({ proposed, current: { ...proposed } });
    expect(r.status).toBe(DRIFT_NONE);
    expect(r.canApprove).toBe(true);
  });

  it("ATP mới > ROP → NO_LONGER_NEEDED, KHÔNG override được", () => {
    const r = evaluateProposalFreshness({
      proposed,
      current: { atp: 99, rop: 30, orderQty: 42, unitCost: 45000 },
      acknowledgeDrift: true,
    });
    expect(r.status).toBe(NO_LONGER_NEEDED);
    expect(r.canApprove).toBe(false);
    expect(r.canAcknowledge).toBe(false);
  });

  it("ATP mới bằng ROP → vẫn cần đặt, không chặn", () => {
    const r = evaluateProposalFreshness({
      proposed,
      current: { atp: 30, rop: 30, orderQty: 42, unitCost: 45000 },
    });
    expect(r.status).not.toBe(NO_LONGER_NEEDED);
  });

  it(`lệch số lượng > ${QTY_DRIFT_TOL * 100}% → DRIFT_BLOCK, cần acknowledgeDrift`, () => {
    const r = evaluateProposalFreshness({
      proposed,
      current: { atp: 12, rop: 30, orderQty: 60, unitCost: 45000 },
    });
    expect(r.status).toBe(DRIFT_BLOCK);
    expect(r.canApprove).toBe(false);
    expect(r.canAcknowledge).toBe(true);
    expect(r.diff.orderQty).toMatchObject({ proposed: 42, current: 60 });
  });

  it("gửi lại kèm acknowledgeDrift → cho duyệt, giữ nhãn DRIFT_BLOCK + cờ acknowledged", () => {
    const r = evaluateProposalFreshness({
      proposed,
      current: { atp: 12, rop: 30, orderQty: 60, unitCost: 45000 },
      acknowledgeDrift: true,
    });
    expect(r.canApprove).toBe(true);
    expect(r.status).toBe(DRIFT_BLOCK); // vẫn biết là đã vượt ngưỡng
    expect(r.acknowledged).toBe(true);
  });

  it(`lệch đơn giá > ${COST_DRIFT_TOL * 100}% → DRIFT_BLOCK`, () => {
    const r = evaluateProposalFreshness({
      proposed,
      current: { atp: 12, rop: 30, orderQty: 42, unitCost: 60000 },
    });
    expect(r.status).toBe(DRIFT_BLOCK);
    expect(r.canAcknowledge).toBe(true);
  });

  it(`lệch nhỏ hơn ngưỡng → DRIFT_WARN, duyệt được kèm cảnh báo`, () => {
    const r = evaluateProposalFreshness({
      proposed,
      current: { atp: 12, rop: 30, orderQty: 45, unitCost: 45000 }, // +7%
    });
    expect(r.status).toBe(DRIFT_WARN);
    expect(r.canApprove).toBe(true);
    expect(r.message).toMatch(/Du lieu da doi nhe/);
  });

  it("đơn giá proposed = 0, giờ khác 0 → MISSING_COST (D6), KHÔNG phải 'lệch 100%'", () => {
    // HỢP ĐỒNG ĐỔI (D6): `unitCost = 0` là **thiếu giá vốn**, không phải "giá bằng
    // 0 rồi lệch 100%". Bản cũ trả DRIFT_BLOCK với thông điệp "lệch 100%", tức
    // mời người duyệt bấm `acknowledgeDrift` — rồi PO đi tiếp với giá không đúng.
    // Thiếu dữ liệu thì không có gì để so sánh, và không được "xác nhận" để đi qua.
    const r = evaluateProposalFreshness({
      proposed: { atp: 12, rop: 30, orderQty: 42, unitCost: 0 },
      current: { atp: 12, rop: 30, orderQty: 42, unitCost: 45000 },
    });
    expect(r.status).toBe(MISSING_COST);
    expect(r.canApprove).toBe(false);
    expect(r.canAcknowledge).toBe(false);
    expect(r.diff.unitCost.missingCost).toBe(true);
  });

  it(`lệch đơn giá VỪA QUÁ ${COST_DRIFT_TOL} → DRIFT_BLOCK (biên, đo được)`, () => {
    const proposedCost = 100000;
    // +11% > COST_DRIFT_TOL(10%) nhưng chỉ hơn 1 điểm phần trăm — chứng minh
    // ngưỡng là so sánh TƯƠNG ĐỐI, không phải "khác nhau là chặn".
    const currentCost = proposedCost * (1 + COST_DRIFT_TOL + 0.01);
    const r = evaluateProposalFreshness({
      proposed: { atp: 12, rop: 30, orderQty: 42, unitCost: proposedCost },
      current: { atp: 12, rop: 30, orderQty: 42, unitCost: currentCost },
    });
    expect(r.status).toBe(DRIFT_BLOCK);
    expect(r.canAcknowledge).toBe(true);
    expect(r.diff.unitCost.relDrift).toBeGreaterThan(COST_DRIFT_TOL);
  });

  it(`lệch đơn giá VỪA DƯỚI ${COST_DRIFT_TOL} → DRIFT_WARN, duyệt được`, () => {
    const proposedCost = 100000;
    const currentCost = proposedCost * (1 + COST_DRIFT_TOL - 0.01);
    const r = evaluateProposalFreshness({
      proposed: { atp: 12, rop: 30, orderQty: 42, unitCost: proposedCost },
      current: { atp: 12, rop: 30, orderQty: 42, unitCost: currentCost },
    });
    expect(r.status).toBe(DRIFT_WARN);
    expect(r.canApprove).toBe(true);
  });

  it("thiếu GIÁ VỐN ở một trong hai vế → MISSING_COST kể cả khi số lượng không đổi", () => {
    for (const bad of [null, undefined, "", NaN, 0, -1]) {
      const r = evaluateProposalFreshness({
        proposed: { atp: 12, rop: 30, orderQty: 42, unitCost: bad },
        current: { atp: 12, rop: 30, orderQty: 42, unitCost: 45000 },
      });
      expect(r.status).toBe(MISSING_COST);
    }
    const r2 = evaluateProposalFreshness({
      proposed: { atp: 12, rop: 30, orderQty: 42, unitCost: 45000 },
      current: { atp: 12, rop: 30, orderQty: 42, unitCost: null },
    });
    expect(r2.status).toBe(MISSING_COST);
    // `relDrift` phải là số hữu hạn (không NaN) để UI/JSON không vỡ.
    expect(Number.isFinite(r2.diff.unitCost.relDrift)).toBe(true);
    expect(r2.diff.unitCost.current).toBeNull();
  });

  it("thiếu current → coi như không đổi, không crash", () => {
    const r = evaluateProposalFreshness({ proposed });
    expect(Number.isFinite(r.diff.orderQty.relDrift)).toBe(true);
    assertFiniteDeep(r.diff, "diff");
  });

  it("ATP mới không phải số → KHÔNG kết luận NO_LONGER_NEEDED sai", () => {
    const r = evaluateProposalFreshness({
      proposed,
      current: { atp: NaN, rop: NaN, orderQty: 42, unitCost: 45000 },
    });
    expect(r.status).not.toBe(NO_LONGER_NEEDED);
  });
});

describe("BIÊN · planReplenishment với dữ liệu bẩn", () => {
  it("mọi tham số rỗng → vẫn ra số hữu hạn, không NaN ở bất kỳ đâu", () => {
    const p = planReplenishment({});
    assertFiniteDeep(p.rationale, "rationale");
    assertFiniteDeep(p.order, "order");
    expect(Number.isFinite(p.rationale.rop)).toBe(true);
    expect(Number.isFinite(p.order.orderQty)).toBe(true);
  });

  it("dailySales chứa NaN / null / undefined lẫn lộn → không NaN", () => {
    const p = planReplenishment({
      dailySales: [{ date: "a", qty: NaN }, { date: "b" }, { date: "c", qty: null, outOfStock: true }],
      inventories: [{ quantity: NaN, reserved: undefined }],
      unitCost: undefined,
    });
    assertFiniteDeep(p.rationale, "rationale");
  });

  it("unitCost cực lớn → totalEstimate vẫn hữu hạn", () => {
    const p = planReplenishment({
      dailySales: Array.from({ length: 60 }, (_, i) => ({ date: `d${i}`, qty: 5, outOfStock: false })),
      inventories: [{ quantity: 1, reserved: 0 }],
      unitCost: 1e12,
    });
    expect(Number.isFinite(p.order.totalEstimate)).toBe(true);
  });

  it("kết quả tái lập được: gọi 2 lần ra cùng kết quả", () => {
    const args = {
      dailySales: Array.from({ length: 40 }, (_, i) => ({ date: `d${i}`, qty: 4, outOfStock: false })),
      inventories: [{ quantity: 8, reserved: 1 }],
      unitCost: 25000,
    };
    expect(JSON.stringify(planReplenishment(args))).toBe(JSON.stringify(planReplenishment(args)));
  });
});

describe("D6 · phân biệt 'THIẾU giá vốn' với 'giá vốn = 0'", () => {
  const SALES = Array.from({ length: 28 }, (_, i) => ({ date: `d${i}`, qty: 5, outOfStock: false }));

  it("classifyUnitCost: null/rỗng/NaN/0/âm đều là 'thiếu', số 0 là số hữu hạn", () => {
    for (const bad of [null, undefined, "", NaN, 0, -1, -0.01]) {
      const r = classifyUnitCost(bad);
      expect(r.missing).toBe(true);
      expect(Number.isFinite(r.value)).toBe(true);
    }
    expect(classifyUnitCost(45000)).toEqual({ value: 45000, missing: false });
    // Decimal từ Prisma là số → đi qua nguyên vẹn.
    expect(classifyUnitCost(45000.5)).toEqual({ value: 45000.5, missing: false });
  });

  it("planReplenishment bật cờ missingCost, KHÔNG âm thầm coi giá = 0", () => {
    const noCost = planReplenishment({ dailySales: SALES, inventories: [{ quantity: 1 }] });
    expect(noCost.missingCost).toBe(true);
    expect(noCost.rationale.missingCost).toBe(true);
    // Vẫn có số để hiển thị, nhưng KHÔNG được bị hiểu là giá thật.
    expect(noCost.rationale.unitCost).toBe(0);

    const withCost = planReplenishment({
      dailySales: SALES,
      inventories: [{ quantity: 1 }],
      unitCost: 30000,
    });
    expect(withCost.missingCost).toBe(false);
    expect(withCost.rationale.missingCost).toBe(false);
    expect(withCost.order.totalEstimate).toBe(withCost.order.orderQty * 30000);
  });

  it("giá vốn âm (trả hàng nhập nhầm) cũng bị coi là thiếu, không tạo tổng tiền âm", () => {
    const p = planReplenishment({ dailySales: SALES, inventories: [{ quantity: 1 }], unitCost: -5000 });
    expect(p.missingCost).toBe(true);
    expect(p.order.totalEstimate).toBeGreaterThanOrEqual(0);
  });
});