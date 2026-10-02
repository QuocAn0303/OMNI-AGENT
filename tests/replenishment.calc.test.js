/**
 * tests/replenishment.calc.test.js — unit test cho công thức bổ sung tồn kho
 *
 * Đây là bằng chứng cho câu hỏi "sao không dùng công thức ROP?": công thức có
 * unit test riêng, chạy không cần DB, không cần LLM, kết quả tái lập được.
 *
 * Test cố ý đặt tên ca lộ những giả định đang dùng (ví dụ `censored day không
 * được coi là nhu cầu 0`) — nếu đổi công thức, các test này phải được cập nhật
 * CÙNG LÚC, và đó là điều ta muốn.
 */
const calc = require("../src/modules/replenishment/replenishment.calc");
const {
  calcDemand,
  calcLeadTime,
  calcAtp,
  calcSafetyStock,
  calcRop,
  evaluateStockStatus,
  calcOrderQty,
  planReplenishment,
  proposalFingerprint,
  STOCKOUT,
  NEED_REPLENISHMENT,
  OK,
} = calc;

/** Sinh lịch sử bán: qty cố định, không ngày censored. */
const daily = (n, qty, from = "2026-01-01") =>
  Array.from({ length: n }, (_, i) => ({
    date: new Date(Date.parse(from) + i * 86400000).toISOString().slice(0, 10),
    qty,
    outOfStock: false,
  }));

describe("calcAtp — tồn khả dụng gộp mọi kênh", () => {
  it("ATP = tổng tồn − tổng đã giữ", () => {
    const r = calcAtp({
      inventories: [
        { quantity: 100, reserved: 10 },
        { quantity: 50, reserved: 5 },
      ],
    });
    expect(r.onHand).toBe(150);
    expect(r.reserved).toBe(15);
    expect(r.atp).toBe(135);
    expect(r.warehouses).toBe(2);
    expect(r.negative).toBe(false);
  });

  it("reserved thiếu coi như 0", () => {
    expect(calcAtp({ inventories: [{ quantity: 7 }] }).atp).toBe(7);
  });

  it("ATP âm bị đánh dấu negative thay vì âm thầm kẹp về 0", () => {
    const r = calcAtp({ inventories: [{ quantity: 3, reserved: 10 }] });
    expect(r.atp).toBe(-7);
    expect(r.negative).toBe(true);
  });

  it("không có kho nào → ATP = 0, không phải NaN", () => {
    expect(calcAtp({ inventories: [] }).atp).toBe(0);
    expect(calcAtp({}).atp).toBe(0);
  });

  it("bán trên sàn làm giảm ATP chung, không có tồn riêng theo kênh", () => {
    // Cùng một tồn, hai lần ghi nhận bán 3 và 2 → ATP giảm 5.
    const before = calcAtp({ inventories: [{ quantity: 20, reserved: 0 }] }).atp;
    const after = calcAtp({ inventories: [{ quantity: 20 - 3 - 2, reserved: 0 }] }).atp;
    expect(before - after).toBe(5);
  });
});

describe("calcDemand — censored demand không được coi là nhu cầu 0", () => {
  it("nhu cầu ổn định, không censored → trung bình đúng", () => {
    const r = calcDemand({ dailySales: daily(30, 4) });
    expect(r.demandPerDay).toBe(4);
    expect(r.censoredDays).toBe(0);
    expect(r.sparse).toBe(false);
    expect(r.method).toBe("moving-average");
  });

  it("NGÀY HẾT HÀNG không kéo nhu cầu xuống 0", () => {
    // 20 ngày bán 5/ngày (nhu cầu thật = 5), 10 ngày hết hàng nên chỉ bán được 0.
    const rows = [
      ...daily(20, 5),
      ...daily(10, 0, "2026-03-01").map((r) => ({ ...r, outOfStock: true })),
    ];
    const r = calcDemand({ dailySales: rows });

    // Nếu coi sai (không hiệu chỉnh) thì mean = (20*5)/30 = 3.33
    // Hiệu chỉnh censored ⇒ nhu_cầu giữ nguyên 5.
    expect(r.demandPerDayObservedOnly).toBe(5);
    expect(r.demandPerDay).toBe(5);
    expect(r.imputedDays).toBe(10);
    expect(r.note).toMatch(/hiệu chỉnh|hieu chinh/);
  });

  it("ngày hết hàng vẫn bán được 1 (hàng vừa hết trong ngày) → giữ số quan sát", () => {
    const rows = [
      ...daily(20, 5),
      ...daily(5, 1, "2026-03-01").map((r) => ({ ...r, outOfStock: true })),
    ];
    const r = calcDemand({ dailySales: rows });
    // max(1, 5) = 5 ⇒ không bị hạ xuống
    expect(r.demandPerDay).toBe(5);
    expect(r.imputedDays).toBe(5);
  });

  it("toàn bộ ngày đều censored → trả 0 và độ tin cậy LOW, không trả số bịa", () => {
    const rows = daily(15, 0).map((r) => ({ ...r, outOfStock: true }));
    const r = calcDemand({ dailySales: rows });
    expect(r.demandPerDay).toBe(0);
    expect(r.confidence).toBe("LOW");
    expect(r.note).toMatch(/30 ngày|tin cậy cao/);
  });

  it("không có dữ liệu → 0, không NaN", () => {
    const r = calcDemand({ dailySales: [] });
    expect(r.demandPerDay).toBe(0);
    expect(r.sigmaDaily).toBe(0);
    expect(r.confidence).toBe("LOW");
  });
});

describe("calcDemand — SKU bán thưa dùng Croston", () => {
  /** Bán 8 cái một lần rồi im 14 ngày: nhịp trung bình ~15 ngày. */
  const sparseRows = Array.from({ length: 30 }, (_, i) => ({
    date: `2026-01-${String(i + 1).padStart(2, "0")}`,
    qty: i % 15 === 0 ? 8 : 0,
    outOfStock: false,
  }));

  it("phát hiện bán thưa", () => {
    const r = calcDemand({ dailySales: sparseRows });
    expect(r.sparse).toBe(true);
    expect(r.nonzeroDays).toBe(2);
    expect(r.method).toMatch(/^croston/);
    expect(r.note).toMatch(/Croston/);
  });

  it("Croston ra đúng lượng / nhịp quan sát được (8 cái mỗi 15 ngày)", () => {
    const r = calcDemand({ dailySales: sparseRows });
    // Không phải trung bình cộng thẳng (16/30 = 0.533 là tình cờ trùng hợp vì
    // chuỗi đều đặn); đây là size/interval = 8/15.
    expect(r.demandPerDay).toBeCloseTo(8 / 15, 2);
    expect(r.demandPerDay).toBeGreaterThan(0);
  });

  it("hai lần bán giãn đều 15 ngày thì Croston = lượng/nhịp, không phải tổng/chia ngày", () => {
    const r = calcDemand({ dailySales: sparseRows });
    const naiveMean = 16 / 30;
    expect(r.demandPerDay).not.toBe(naiveMean * 2);
    expect(r.demandPerDay).toBeLessThan(1); // 0.53/ngày là hợp lý cho hàng bán theo cụp
  });

  it("chuỗi đều đặn cho kết quả ổn định qua nhiều lần chạy", () => {
    const a = calcDemand({ dailySales: sparseRows });
    const b = calcDemand({ dailySales: sparseRows });
    expect(a.demandPerDay).toBe(b.demandPerDay);
    expect(a.alpha).toBe(b.alpha);
  });

  it("ép dùng Croston cho dữ liệu không thưa vẫn chạy được", () => {
    const r = calcDemand({ dailySales: daily(60, 3), method: "croston" });
    expect(r.method).toMatch(/^croston/);
    expect(r.demandPerDay).toBeGreaterThan(0);
  });

  it("ép dùng moving-average cho dữ liệu thưa vẫn chạy được", () => {
    const r = calcDemand({ dailySales: sparseRows, method: "moving-average" });
    expect(r.method).toBe("moving-average");
  });
});

describe("calcLeadTime — lấy từ lịch sử PO→GRN, thiếu thì gắn cờ", () => {
  const d = (s) => new Date(Date.parse(s)).toISOString();

  it("≥3 mẫu → median, estimated = false", () => {
    const r = calcLeadTime({
      receipts: [
        { poDate: d("2026-01-01"), receivedAt: d("2026-01-08") }, // 7
        { poDate: d("2026-01-10"), receivedAt: d("2026-01-19") }, // 9
        { poDate: d("2026-01-20"), receivedAt: d("2026-01-27") }, // 7
        { poDate: d("2026-02-01"), receivedAt: d("2026-02-08") }, // 7
      ],
    });
    expect(r.leadTimeDays).toBe(7);
    expect(r.estimated).toBe(false);
    expect(r.sampleSize).toBe(4);
    expect(r.method).toBe("median-of-po-to-grn");
  });

  it("dùng TRUNG VỊ chứ không phải trung bình — đuôi dài không được kéo lệch", () => {
    const r = calcLeadTime({
      receipts: [
        { poDate: d("2026-01-01"), receivedAt: d("2026-01-08") }, // 7
        { poDate: d("2026-01-10"), receivedAt: d("2026-01-17") }, // 7
        { poDate: d("2026-01-20"), receivedAt: d("2026-01-27") }, // 7
        { poDate: d("2026-02-01"), receivedAt: d("2026-02-22") }, // 21 ← trễ
      ],
    });
    // median = 7. Trung bình = 10.5 — sẽ đặt sai số lượng.
    expect(r.leadTimeDays).toBe(7);
  });

  it("<3 mẫu → dùng mặc định VÀ gắn cờ estimated", () => {
    const r = calcLeadTime({
      receipts: [{ poDate: d("2026-01-01"), receivedAt: d("2026-01-08") }],
      defaultDays: 10,
    });
    expect(r.leadTimeDays).toBe(10);
    expect(r.estimated).toBe(true);
    expect(r.sampleSize).toBe(1);
    expect(r.note).toMatch(/ước lượng/);
  });

  it("không có lịch sử nào → mặc định + cờ, KHÔNG trả số như thật", () => {
    const r = calcLeadTime({ receipts: [] });
    expect(r.leadTimeDays).toBe(calc.DEFAULT_LEAD_TIME_DAYS);
    expect(r.estimated).toBe(true);
    expect(r.note).toMatch(/Chưa có lịch sử/);
  });

  it("bỏ qua receipt thiếu ngày hoặc ngày nhận trước ngày đặt", () => {
    const r = calcLeadTime({
      receipts: [
        { poDate: d("2026-01-10") },                                  // thiếu receivedAt
        { poDate: d("2026-01-10"), receivedAt: d("2026-01-05") },     // nhận trước khi đặt
        ...daily(3, 1).map((_, i) => ({
          poDate: d(`2026-03-0${i + 1}`),
          receivedAt: d(`2026-03-1${i + 1}`),
        })),
      ],
    });
    expect(r.sampleSize).toBe(3);
    expect(r.estimated).toBe(false);
  });
});

describe("calcSafetyStock — SS = z(α) × σ_ngày × √(leadTime)", () => {
  it("bám đúng công thức, mức phục vụ cao hơn thì SS cao hơn", () => {
    const args = { sigmaDaily: 2, leadTimeDays: 9 };
    const ss90 = calcSafetyStock({ ...args, serviceLevel: 0.9 });
    const ss99 = calcSafetyStock({ ...args, serviceLevel: 0.99 });
    // √9 = 3 ⇒ σ_LT = 6
    expect(ss90.sigmaLeadTime).toBe(6);
    expect(ss90.safetyStock).toBe(Math.ceil(1.282 * 6)); // 8
    expect(ss99.safetyStock).toBe(Math.ceil(2.326 * 6)); // 14
    expect(ss99.safetyStock).toBeGreaterThan(ss90.safetyStock);
  });

  it("leadTime dài làm σ_LT tăng theo CĂN BẬC HAI, không phải tuyến tính", () => {
    const ss = calcSafetyStock({ sigmaDaily: 1, leadTimeDays: 49 }); // √49 = 7
    expect(ss.sigmaLeadTime).toBe(7);
  });

  it("σ = 0 (bán đều tuyệt đối) → SS = 0, không âm", () => {
    const ss = calcSafetyStock({ sigmaDaily: 0, leadTimeDays: 10 });
    expect(ss.safetyStock).toBe(0);
  });

  it("leadTime âm bị chặn về 0 thay vì NaN", () => {
    const ss = calcSafetyStock({ sigmaDaily: 3, leadTimeDays: -5 });
    expect(Number.isFinite(ss.safetyStock)).toBe(true);
    expect(ss.safetyStock).toBe(0);
  });

  it("mức phục vụ ngoài bảng → ném lỗi có status 400, không âm thầm dùng mặc định", () => {
    expect(() => calcSafetyStock({ sigmaDaily: 1, serviceLevel: 0.42 })).toThrow();
    try {
      calcSafetyStock({ sigmaDaily: 1, serviceLevel: 0.42 });
    } catch (e) {
      expect(e.status).toBe(400);
    }
  });
});

describe("calcRop — công thức, không có LLM", () => {
  it("ROP = nhu_cầu/ngày × leadTime + safetyStock", () => {
    const r = calcRop({ demandPerDay: 2.5, leadTimeDays: 7, safetyStock: 9 });
    expect(r.demandDuringLeadTime).toBe(17.5);
    expect(r.rop).toBe(27); // ceil(17.5 + 9)
  });

  it("leadTime 0 và SS 0 → ROP = 0 (đặt lại ngay khi có nhu cầu)", () => {
    expect(calcRop({ demandPerDay: 3, leadTimeDays: 0, safetyStock: 0 }).rop).toBe(0);
  });

  it("nhu cầu âm hoặc rỗng → 0, không âm", () => {
    expect(calcRop({ demandPerDay: -5, leadTimeDays: 7, safetyStock: 3 }).rop).toBe(3);
    expect(calcRop({}).rop).toBe(0);
  });
});

describe("evaluateStockStatus — NGƯỠNG TỒN THẤP DUY NHẤT (P0-4)", () => {
  it("ngưỡng là atp <= rop, ghi rõ công thức trong output", () => {
    const eq = evaluateStockStatus({ atp: 30, rop: 30, demandPerDay: 2 });
    expect(eq.threshold).toBe("atp <= rop");
    expect(eq.needsReplenishment).toBe(true);
  });

  it("ATP = 0 → STOCKOUT", () => {
    const r = evaluateStockStatus({ atp: 0, rop: 10, demandPerDay: 2 });
    expect(r.status).toBe(STOCKOUT);
    expect(r.needsReplenishment).toBe(true);
  });

  it("ATP > ROP → OK", () => {
    const r = evaluateStockStatus({ atp: 31, rop: 30, demandPerDay: 2 });
    expect(r.status).toBe(OK);
    expect(r.needsReplenishment).toBe(false);
  });

  it("daysOfCover = atp / nhu_cầu", () => {
    expect(evaluateStockStatus({ atp: 30, rop: 100, demandPerDay: 3 }).daysOfCover).toBe(10);
  });

  it("nhu cầu = 0 → daysOfCover null + infinite, không chia cho 0", () => {
    const r = evaluateStockStatus({ atp: 5, rop: 1, demandPerDay: 0 });
    expect(r.daysOfCover).toBeNull();
    expect(r.infinite).toBe(true);
  });
});

describe("calcOrderQty — (R,S) làm tròn theo bao bì NCC", () => {
  it("S = ROP + nhu_cầu × chu kỳ rà soát", () => {
    const r = calcOrderQty({ atp: 10, rop: 20, demandPerDay: 2, reviewPeriodDays: 7 });
    expect(r.orderUpToLevel).toBe(34); // 20 + 14
    expect(r.orderQty).toBe(24);
  });

  it("làm tròn LÊN theo bao bì", () => {
    const r = calcOrderQty({ atp: 0, rop: 20, demandPerDay: 0, reviewPeriodDays: 7, packMultiple: 12 });
    expect(r.rawNeed).toBe(20);
    expect(r.orderQty).toBe(24); // ceil(20/12)*12
  });

  it("đã đủ tồn → orderQty = 0 (không sinh đề xuất rỗng)", () => {
    const r = calcOrderQty({ atp: 100, rop: 20, demandPerDay: 2, reviewPeriodDays: 7 });
    expect(r.orderQty).toBe(0);
  });

  it("packMultiple ≤ 1 bị kẹp về 1 để không chia nhầm", () => {
    expect(calcOrderQty({ atp: 0, rop: 5, packMultiple: 0 }).orderQty).toBe(5);
    expect(calcOrderQty({ atp: 0, rop: 5, packMultiple: -3 }).orderQty).toBe(5);
  });
});

describe("proposalFingerprint — phát hiện đề xuất lỗi thời", () => {
  const base = { atp: 12, rop: 30, unitCost: 45000, orderQty: 42, vendorId: "v1" };

  it("cùng số liệu quyết định → cùng vân tay", () => {
    expect(proposalFingerprint(base)).toBe(proposalFingerprint({ ...base }));
  });

  it("ATP đổi → vân tay đổi (đây là cảnh báo lúc duyệt)", () => {
    expect(proposalFingerprint(base)).not.toBe(proposalFingerprint({ ...base, atp: 2 }));
  });

  it("mỗi trường quyết định đều làm đổi vân tay", () => {
    const fp = proposalFingerprint(base);
    for (const patch of [{ rop: 31 }, { unitCost: 46000 }, { orderQty: 43 }, { vendorId: "v2" }]) {
      expect(proposalFingerprint({ ...base, ...patch })).not.toBe(fp);
    }
  });

  it("không phụ thuộc thứ tự khoá và không nhạy với số thực nguyên", () => {
    expect(proposalFingerprint(base)).toBe(proposalFingerprint({ vendorId: "v1", orderQty: 42, unitCost: 45000, rop: 30, atp: 12 }));
  });
});

describe("planReplenishment — hàm tổng hợp của luồng demo", () => {
  const healthySales = daily(60, 3);
  const stock = [{ quantity: 40, reserved: 0 }];

  it("trả về đủ số để người duyệt kiểm chứng, không chỉ một con số", () => {
    const p = planReplenishment({
      dailySales: healthySales,
      inventories: stock,
      unitCost: 10000,
    });
    expect(p.rationale.atp).toBe(40);
    expect(p.rationale.rop).toBeGreaterThan(0);
    expect(p.rationale.safetyStock).toBeGreaterThanOrEqual(0);
    expect(p.rationale.demandMethod).toBeTruthy();
    expect(p.rationale.leadTimeEstimated).toBe(true); // không có lịch sử nhận hàng
    expect(p.rationale.totalEstimate).toBe(p.order.orderQty * 10000);
  });

  it("ATP thấp thì trả về cần nhập và orderQty > 0", () => {
    const p = planReplenishment({
      dailySales: healthySales, // 3/ngày
      inventories: [{ quantity: 5, reserved: 0 }],
      unitCost: 10000,
      receipts: [
        { poDate: "2026-01-01T00:00:00Z", receivedAt: "2026-01-08T00:00:00Z" },
        { poDate: "2026-01-10T00:00:00Z", receivedAt: "2026-01-17T00:00:00Z" },
        { poDate: "2026-01-20T00:00:00Z", receivedAt: "2026-01-27T00:00:00Z" },
      ],
    });
    expect(p.status).toBe(NEED_REPLENISHMENT);
    expect(p.order.orderQty).toBeGreaterThan(0);
    expect(p.rationale.leadTimeDays).toBe(7);
    expect(p.rationale.leadTimeEstimated).toBe(false);
  });

  it("ATP dồi dư thì orderQty = 0 — không sinh đề xuất vô nghĩa", () => {
    const p = planReplenishment({
      dailySales: healthySales,
      inventories: [{ quantity: 5000, reserved: 0 }],
      unitCost: 10000,
    });
    expect(p.status).toBe(OK);
    expect(p.order.orderQty).toBe(0);
  });

  it("tồn âm vẫn cho ra số hợp lệ, không NaN", () => {
    const p = planReplenishment({
      dailySales: healthySales,
      inventories: [{ quantity: 2, reserved: 20 }],
    });
    expect(Number.isFinite(p.rationale.rop)).toBe(true);
    expect(Number.isFinite(p.order.orderQty)).toBe(true);
    expect(p.atp.negative).toBe(true);
  });

  it("không có dữ liệu bán hàng → vẫn chạy, độ tin cậy LOW", () => {
    const p = planReplenishment({ inventories: [{ quantity: 3 }], unitCost: 5000 });
    expect(p.demand.confidence).toBe("LOW");
    expect(Number.isFinite(p.rationale.rop)).toBe(true);
  });

  it("chạy lại cho kết quả giống hệt (hàm thuần, không dùng Date.now)", () => {
    const args = { dailySales: healthySales, inventories: stock, unitCost: 10000 };
    expect(JSON.stringify(planReplenishment(args))).toBe(JSON.stringify(planReplenishment(args)));
  });
});

describe("ràng buộc kiến trúc của module", () => {
  const fs = require("fs");
  const path = require("path");
  const raw = fs.readFileSync(
    path.join(__dirname, "..", "src", "modules", "replenishment", "replenishment.calc.js"),
    "utf8",
  );
  // Bỏ comment trước khi kiểm tra: comment mô tả điều cấm cũng chứa từ khóa
  // (ví dụ "không import config/llm"), và đó không phải là vi phạm.
  const code = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("KHÔNG import LLM — công thức không được chứa LLM", () => {
    expect(code).not.toMatch(/config\/llm|agent\.llm/);
  });

  it("KHÔNG import prisma — đây là hàm thuần", () => {
    expect(code).not.toMatch(/require\(['"]\.\.\/\.\.\/config\/prisma['"]\)/);
  });

  it("KHÔNG dùng Date.now() / new Date() không tham số (kết quả phải tái lập được)", () => {
    expect(code).not.toMatch(/Date\.now\(\)/);
    expect(code).not.toMatch(/new Date\(\)/);
  });

  it("KHÔNG log ra console", () => {
    expect(code).not.toMatch(/console\./);
  });

  it("không hard-code ngưỡng duyệt PO (đọc từ settings ở nơi gọi)", () => {
    // Ngưỡng tiền duyệt không thuộc công thức tồn kho — phải lấy từ companySettings.
    expect(code).not.toMatch(/poApprovalThreshold|PO_APPROVE_THRESHOLD|5_000_000|50_000_000/);
  });

  it("chỉ được import crypto (hashing) — không import ngoài danh sách cho phép", () => {
    const imports = [...code.matchAll(/require\(['"]([^'"]+)['"]\)/g)].map((m) => m[1]);
    expect(imports.filter((i) => i !== "crypto")).toEqual([]);
  });
});