/**
 * tests/backtest-simulate.test.js — kiểm chứng TÍNH TAY mô phỏng tồn kho (T10).
 *
 * Vì sao phải có: giao thức §2.3 đặc tả 8 quy tắc mô phỏng. Nếu sai một quy
 * tắc (ví dụ đến hàng sớm 1 ngày) thì **mọi** con số trong báo cáo đều sai mà
 * vẫn trông hợp lệ — đúng loại lỗi mà giao thức §10 cấm. Vì vậy kịch bản dưới
 * đây được tính tay trên giấy, không lấy đầu ra của chính nó làm chuẩn.
 *
 * Kịch bản: 1 SKU, 8 ngày, nhu cầu 4 mỗi ngày, LT = 3, ATP đầu kỳ = 10,
 * giá vốn = 2/đơn vị, chính sách "đặt cho về đủ mức S = 10" (P4 với DOC/d_ref
 * cho ra đúng 10 ⇒ dùng DOC = 10, d_ref = 1, cùng đường rà soát cuối ngày).
 */
const { simulate, mainMetric } = require("../scripts/backtest/lib/simulate");
const { buildConfig } = require("../scripts/backtest/lib/policies");
const { assertSlice, wape, clusterBootstrap, mulberry32 } = require("../scripts/backtest/lib/metrics");
const { buildRollingWindows } = require("../scripts/backtest/lib/windows");
const { crostonExplicit, estimateDemand } = require("../scripts/backtest/lib/demand");
const { Z_BY_SERVICE_LEVEL, calcSafetyStock, calcRop } = require("../src/modules/replenishment/replenishment.calc");

const CONST_S10 = ({ position }) => (position <= 10 ? 10 - position : 0);

describe("mô phỏng tồn kho — tính tay theo S4", () => {
  const base = {
    nDays: 8,
    demand: [4, 4, 4, 4, 4, 4, 4, 4],
    policy: { orderQty: CONST_S10 },
    policyParams: {},
    leadTimeDays: 3,
    initialAtp: 10,
    costPerUnit: 2,
  };
  // positionMode = atpOnly: ngưỡng so với ATP thuần (đọc protocol §2.1 theo chữ).
  const simA = simulate({ ...base, positionMode: "atpOnly" });
  // positionMode = withOnOrder: ngưỡng so với ATP + hàng đang trên đường (mã sản phẩm).
  const simB = simulate({ ...base, positionMode: "withOnOrder" });

  it("đơn đặt ngày t tới nơi CUỐI ngày t+LT, dùng được từ ngày t+LT+1 (atpOnly)", () => {
    // Ngày 0: ATP 10, bán 4 -> còn 6, đặt 4 (về cuối ngày 3, dùng từ ngày 4).
    expect(simA.daily[0]).toMatchObject({ sold: 4, atpEnd: 6, ordered: 4 });
    expect(simA.daily[1]).toMatchObject({ atpEnd: 2, ordered: 8 });
    expect(simA.daily[2]).toMatchObject({ sold: 2, lost: 2, atpEnd: 0, ordered: 10 });
    expect(simA.daily[3]).toMatchObject({ sold: 0, lost: 4, atpEnd: 0 }); // đơn ngày 0 chưa dùng được
    expect(simA.daily[4]).toMatchObject({ sold: 4, atpEnd: 0 }); // +4
    expect(simA.daily[5]).toMatchObject({ atpEnd: 4 }); // +8
    expect(simA.daily[6]).toMatchObject({ atpEnd: 10 }); // +10
    expect(simA.daily[7]).toMatchObject({ atpEnd: 16 }); // +10
  });

  it("tổng số bán / mất / nhận / tồn cuối khớp tính tay (atpOnly)", () => {
    expect(simA.sold).toBe(26); // 4+4+2+0+4+4+4+4
    expect(simA.lostUnits).toBe(6); // ngày 2 mất 2, ngày 3 mất 4; ngày 4 hết hàng nhưng KHÔNG mất bán
    expect(simA.receivedUnits).toBe(32); // 4 + 8 + 10 + 10
    expect(simA.endAtp).toBe(16);
    expect(simA.orderUnits - simA.receivedUnits).toBe(16); // còn trên đường
    expect(simA.censoredDays).toBe(3); // ngày 2, 3, 4 — ngày 4 có hàng về nên bán được 4
    expect(simA.orderCount).toBe(6);
    expect(simA.purchaseCost).toBe(64); // 32 * 2
    expect(simA.endValue).toBe(32); // 16 * 2
    expect(simA.lostValue).toBe(12); // 6 * 2
  });

  it("chỉ số chính S5 = (nhập + tồn dư + mất bán) / số đơn vị đã bán (atpOnly)", () => {
    expect(simA.totalCost).toBe(108); // 64 + 32 + 12
    expect(mainMetric(simA)).toBeCloseTo(108 / 26, 10);
  });

  it("tính tay (withOnOrder): ngưỡng so ATP+onOrder nên đặt ít hơn, tồn cuối bằng 0", () => {
    // pos = atp + onOrder: ngày 0 pos 6 -> đặt 4; ngày 1 pos 2+4=6 -> đặt 4;
    // ngày 2 pos 0+8=8 -> đặt 2; ngày 3 pos 10 -> đặt 0; ngày 4 pos 0+6=6 -> đặt 4...
    expect(simB.daily.map((d) => d.ordered)).toEqual([4, 4, 2, 0, 4, 4, 2, 0]);
    expect(simB.sold).toBe(20);
    expect(simB.lostUnits).toBe(12);
    expect(simB.receivedUnits).toBe(10);
    expect(simB.endAtp).toBe(0);
    expect(simB.censoredDays).toBe(6);
    expect(simB.totalCost).toBe(44); // 20 + 0 + 24
    expect(mainMetric(simB)).toBeCloseTo(44 / 20, 10);
    // Hai cách đọc ATP cho ra kết quả KHÁC NHAU — đó là lý do cả hai đều phải báo.
    expect(mainMetric(simB)).not.toBeCloseTo(mainMetric(simA), 6);
  });

  it("thiếu hàng = mất bán, KHÔNG ghi nợ (tồn không bao giờ âm)", () => {
    for (const s of [simA, simB]) {
      expect(s.daily.every((d) => d.atpEnd >= 0)).toBe(true);
      expect(s.sold + s.lostUnits).toBe(8 * 4);
    }
  });
});

describe("ngưỡng đặt hàng", () => {
  it("P1: SKU có d_ref = 0 thì KHÔNG BAO GIỜ đặt (protocol §2.2)", () => {
    const p1 = buildConfig("P1", { leadTimeDays: 7 }, { demandPerDay: 0, sigmaDaily: 0 });
    expect(p1.threshold).toBe(0);
    expect(p1.orderQty({ atp: 0, onOrder: 0, position: 0, leadTimeDays: 7 })).toBe(0);
  });

  it("P1: giữ nguyên công thức hiện trạng max(1, ceil((2*minStock − ATP) × 1.2))", () => {
    const p1 = buildConfig("P1", { leadTimeDays: 7 }, { demandPerDay: 2, sigmaDaily: 1 });
    expect(p1.threshold).toBe(28); // ceil(14 * 2)
    // ATP = 30 > 28 => không đặt
    expect(p1.orderQty({ atp: 30, onOrder: 0, position: 30, leadTimeDays: 7 })).toBe(0);
    // ATP = 28 => ceil((56-28)*1.2) = ceil(33.6) = 34
    expect(p1.orderQty({ atp: 28, onOrder: 0, position: 28, leadTimeDays: 7 })).toBe(34);
  });

  it("P4: đặt cho về đủ S = ceil(DOC × d_ref)", () => {
    const p4 = buildConfig("P4", { leadTimeDays: 7, doc: 21 }, { demandPerDay: 1.5, sigmaDaily: 3 });
    expect(p4.threshold).toBe(32); // ceil(21*1.5) = ceil(31.5)
    expect(p4.orderQty({ atp: 32, onOrder: 0, position: 32, leadTimeDays: 7 })).toBe(0);
    expect(p4.orderQty({ atp: 20, onOrder: 0, position: 20, leadTimeDays: 7 })).toBe(12);
  });

  it("P2/P3: ROP và SS lấy đúng từ công thức sản phẩm, và z đủ 4 mức của lưới S12", () => {
    for (const sl of [0.8, 0.85, 0.9, 0.95]) {
      expect(Z_BY_SERVICE_LEVEL[sl]).toBeGreaterThan(0);
      const p2 = buildConfig("P2", { leadTimeDays: 7, serviceLevel: sl }, { demandPerDay: 2, sigmaDaily: 3 });
      const ss = calcSafetyStock({ sigmaDaily: 3, leadTimeDays: 7, serviceLevel: sl });
      const rop = calcRop({ demandPerDay: 2, leadTimeDays: 7, safetyStock: ss.safetyStock });
      expect(p2.threshold).toBe(rop.rop);
      expect(p2.safetyStock).toBe(ss.safetyStock);
    }
  });

  it("P3 dùng Croston, P2 dùng trung bình — khác nhau khi chuỗi gián đoạn", () => {
    const p = { demandPerDay: 2, sigmaDaily: 3, crostonDemand: 0.5, leadTimeDays: 7, serviceLevel: 0.9 };
    const p2 = buildConfig("P2", { leadTimeDays: 7, serviceLevel: 0.9 }, p);
    const p3 = buildConfig("P3", { leadTimeDays: 7, serviceLevel: 0.9 }, p);
    expect(p3.threshold).toBeLessThan(p2.threshold);
  });
});

describe("nhu cầu + censored (S3)", () => {
  it("nhánh A hiệu chỉnh ngày hết hàng lên mức trung bình ngày không censored", () => {
    const series = [0, 0, 10, 0, 0];
    const censored = [true, true, false, true, true];
    const a = estimateDemand(series, censored, { branch: "A", alphas: [0.1] });
    // mean(observed=[10]) = 10 => ngày censored thành max(0,10)=10
    expect(a.demandPerDay).toBe(10);
    expect(a.censoredDays).toBe(4);
    const b = estimateDemand(series, censored, { branch: "B", alphas: [0.1] });
    expect(b.demandPerDay).toBe(10);
    expect(b.nonCensoredDays).toBe(1);
  });

  it("nhánh B loại hẳn ngày censored nên mẫu nhỏ hơn nhánh A", () => {
    const series = [0, 5, 0, 7];
    const censored = [true, false, true, false];
    const a = estimateDemand(series, censored, { branch: "A", alphas: [0.1] });
    const b = estimateDemand(series, censored, { branch: "B", alphas: [0.1] });
    expect(a.totalDays).toBe(4);
    expect(b.totalDays).toBe(2);
    expect(b.demandPerDay).toBe(6); // (5+7)/2
    expect(a.demandPerDay).toBe(6); // mean(10,5,10,7)=6
  });

  it("Croston với alpha tường minh: alpha nhỏ bám giá trị cũ hơn, chuỗi đều thì bằng trung bình", () => {
    const flat = [5, 5, 5, 5];
    expect(crostonExplicit(flat, 0.1)).toBeCloseTo(5, 10);
    expect(crostonExplicit(flat, 0.3)).toBeCloseTo(5, 10);
    // size=100, interval=4; lần 2: size = a*10 + (1-a)*100, interval = 4
    const spike = [100, 0, 0, 0, 10];
    expect(crostonExplicit(spike, 0.1)).toBeCloseTo(91 / 4, 10);
    expect(crostonExplicit(spike, 0.3)).toBeCloseTo(73 / 4, 10);
    expect(crostonExplicit(spike, 0.1)).toBeGreaterThan(crostonExplicit(spike, 0.3));
  });

  it("SKU bán thưa được đánh dấu để dùng Croston (ngưỡng 10 ngày có bán)", () => {
    const sparse = estimateDemand([1, 0, 0, 0, 1], [false, false, false, false, false], { branch: "A" });
    expect(sparse.sparse).toBe(true);
    const dense = estimateDemand(new Array(20).fill(3), new Array(20).fill(false), { branch: "A" });
    expect(dense.sparse).toBe(false);
  });
});

describe("chặn số lấy từ tập giữa (S2 / §3.2)", () => {
  it("hàm báo cáo từ chối slice khác 'test'", () => {
    expect(() => assertSlice("mid")).toThrow(/tap kiem dinh/);
    expect(() => wape({ actual: [1], predicted: [1], slice: "train" })).toThrow();
    expect(() => clusterBootstrap({ perSku: [], slice: "mid" })).toThrow();
    expect(assertSlice("test")).toBe(true);
  });

  it("WAPE = Σ|y−ŷ| / Σy", () => {
    expect(wape({ actual: [10, 0, 5], predicted: [8, 2, 5], slice: "test" })).toBeCloseTo(4 / 15, 10);
  });

  it("bootstrap tất định: cùng seed cho cùng CI", () => {
    const perSku = Array.from({ length: 40 }, (_, i) => ({
      a: { totalCost: 100 + i, sold: 10 },
      b: { totalCost: 120 + i, sold: 10 },
    }));
    const r1 = clusterBootstrap({ perSku, resamples: 200, slice: "test" });
    const r2 = clusterBootstrap({ perSku, resamples: 200, slice: "test" });
    expect(r1).toEqual(r2);
    expect(r1.point).toBeLessThan(0); // phương án rẻ hơn baseline
    expect(r1.ciHigh).toBeLessThan(0); // CI không chứa 0
    expect(r1.winRatio).toBe(1);
  });

  it("PRNG tất định theo seed", () => {
    const a = Array.from({ length: 5 }, mulberry32(20261003));
    const b = Array.from({ length: 5 }, mulberry32(20261003));
    expect(a).toEqual(b);
    expect(a[0]).not.toBe(mulberry32(1)());
  });
});

describe("cửa sổ trượt (S6)", () => {
  const dates = [];
  for (let y = 2011, m = 1; m <= 12; m += 1) {
    for (let d = 1; d <= new Date(Date.UTC(y, m, 0)).getUTCDate(); d += 1) {
      dates.push(`${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
    }
  }

  it("lấy N tháng đầy đủ gần nhất làm test, tháng trước làm mid", () => {
    const w = buildRollingWindows(dates, { count: 3 });
    expect(w).toHaveLength(3);
    expect(w.map((x) => x.testMonth)).toEqual(["2011-12", "2011-11", "2011-10"]);
    expect(w.map((x) => x.midMonth)).toEqual(["2011-11", "2011-10", "2011-09"]);
    expect(w[0].trainEndDate).toBe("2011-10-01");
    expect(w[0].testStartDate).toBe("2011-12-01");
    expect(w[0].testEndDate).toBe("2011-12-31");
    expect(w[2].trainEndDate).toBe("2011-08-01");
  });

  it("từ chối khi không đủ tháng", () => {
    expect(() => buildRollingWindows(dates.slice(0, 70), { count: 3 })).toThrow(/thang day du/);
  });
});
