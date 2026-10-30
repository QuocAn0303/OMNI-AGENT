/**
 * tests/replenishment-rules.test.js
 *
 * KHOÁ HÀNH VI: quy tắc nhập hàng cấu hình theo (sản phẩm × kho) phải THỰC SỰ
 * đổi kết quả tính — không phải chỉ lưu vào DB cho có.
 *
 * BỐI CẢNH: trước 2026-10-13, `leadTimeDays`, `packMultiple`, `serviceLevel`,
 * `maxStock` KHÔNG tồn tại trong schema — engine ROP dùng hằng số cứng
 * (7 ngày / 1 / 0,95). Người dùng không cấu hình được gì cho từng SKU, khác
 * Odoo vốn có `Reordering Rules` với `days_to_purchase`.
 *
 * RỦI RO CHÍNH: thêm cột mà không nối vào engine ⇒ đọc hình thì có nhưng tính
 * vẫn dùng hằng số cũ. Các test dưới đây chống đúng điều đó.
 */

const calc = require("../src/modules/replenishment/replenishment.calc");

/**
 * 60 ngày bán đều 10 cái/ngày, không hết hàng.
 *
 * LƯU Ý: dùng dữ liệu bán HOÀN HẢO không hợp cho test tồn tối thiểu — nhu cầu
 * không biến động ⇒ `sigmaDaily = 0` ⇒ tồn tối thiểu luôn bằng 0 ở MỌI mức
 * phục vụ, và `z` trở nên vô nghĩa. Test đầu tiên đã vấp đúng chỗ này.
 * Xem `varyingDemand` bên dưới cho các test so sánh tồn tối thiểu.
 */
const steadyDemand = (qty = 10, days = 60) =>
  Array.from({ length: days }, (_, i) => ({
    date: `2026-01-${String((i % 28) + 1).padStart(2, "0")}`,
    qty,
    outOfStock: false,
  }));

/** Nhu cầu có BIẾN ĐỘNG thực tế ⇒ `sigmaDaily > 0` ⇒ tồn tối thiểu có ý nghĩa. */
const varyingDemand = (days = 60) => {
  const pattern = [4, 7, 12, 9, 16, 6, 11, 14, 8, 5];
  return Array.from({ length: days }, (_, i) => ({
    date: `2026-${String(Math.floor(i / 28) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`,
    qty: pattern[i % pattern.length],
    outOfStock: false,
  }));
};

const plan = (over = {}) =>
  calc.planReplenishment({
    dailySales: steadyDemand(),
    inventories: [{ quantity: 100, reserved: 0 }],
    unitCost: 10_000,
    ...over,
  });

describe("Quy tắc nhập hàng thay đổi kết quả tính", () => {
  test("leadTimeDays CẤU HÌNH thay đổi ROP và tồn tối thiểu", () => {
    const macDinh = plan({ defaultLeadTimeDays: 7 });
    const cauHinh7 = plan({ configuredLeadTimeDays: 7 });
    const cauHinh30 = plan({ configuredLeadTimeDays: 30 });

    // Cấu hình = 7 ngày phải cho KẾT QUẢ GIỐNG HỆT mặc định 7 ngày.
    expect(cauHinh7.rop.rop).toBe(macDinh.rop.rop);
    // Lead time dài hơn ⇒ phải đặt dự phòng nhiều hơn ⇒ ROP CAO hơn.
    expect(cauHinh30.rop.rop).toBeGreaterThan(cauHinh7.rop.rop);
    expect(cauHinh30.lead.leadTimeDays).toBe(30);
  });

  test("NGUỒN lead time được ghi rõ: CONFIGURED / MEASURED / ESTIMATED", () => {
    expect(plan({ configuredLeadTimeDays: 21 }).lead.source).toBe("CONFIGURED");
    // Không cấu hình + không đủ mẫu PO→GRN ⇒ ước lượng.
    expect(plan({ receipts: [] }).lead.source).toBe("ESTIMATED");
    // Đủ mẫu ⇒ đo được.
    const receipts = Array.from({ length: 6 }, (_, i) => ({
      poDate: new Date(2026, 0, 1 + i).toISOString(),
      receivedAt: new Date(2026, 0, 11 + i).toISOString(),
    }));
    expect(plan({ receipts }).lead.source).toBe("MEASURED");
  });

  test("packMultiple làm tròn số lượng đặt lên bội số của nhà cung cấp", () => {
    const le = plan({ packMultiple: 1 });
    const thung = plan({ packMultiple: 12 });
    expect(le.order.orderQty % 12).not.toBe(0); // số lẻ thì không tròn
    expect(thung.order.orderQty % 12).toBe(0);
    expect(thung.order.orderQty).toBeGreaterThanOrEqual(le.order.orderQty);
  });

  test("serviceLevel CẤU HÌNH đổi tồn tối thiểu (z cao hơn ⇒ dự phòng nhiều hơn)", () => {
    // Dùng nhu cầu BIẾN ĐỘNG — nếu bán đều tuyệt đối thì σ = 0 và tồn tối
    // thiểu bằng 0 ở mọi mức phục vụ, test sẽ pass vì sai lý do.
    const thap = calc.planReplenishment({
      dailySales: varyingDemand(), inventories: [{ quantity: 100, reserved: 0 }],
      unitCost: 10_000, serviceLevel: 0.8,
    });
    const cao = calc.planReplenishment({
      dailySales: varyingDemand(), inventories: [{ quantity: 100, reserved: 0 }],
      unitCost: 10_000, serviceLevel: 0.99,
    });
    expect(cao.demand.sigmaDaily).toBeGreaterThan(0);
    expect(thap.demand.sigmaDaily).toBeGreaterThan(0);
    expect(cao.safety.safetyStock).toBeGreaterThan(thap.safety.safetyStock);
    expect(cao.rop.rop).toBeGreaterThanOrEqual(thap.rop.rop);
  });

  test("maxStock KHÔNG ép vào công thức — chỉ cảnh báo tồn quá cao", () => {
    // Đây là ranh giới quan trọng: nếu ép trần vào `orderQty`, tồn cao sẽ cho
    // orderQty = 0 và hệ thống im lặng cả mất cảnh báo thiếu hàng.
    const tonCao = plan({
      inventories: [{ quantity: 5_000, reserved: 0 }],
      maxStock: 100,
    });
    expect(tonCao.rules.overStock).toBe(true);
    expect(tonCao.rules.excessQty).toBe(4_900);
    // Trạng thái vẫn phải là "OK", và KHÔNG âm thầm đặt hàng.
    expect(tonCao.needsReplenishment).toBe(false);
    expect(tonCao.order.orderQty).toBe(0);

    // Chưa cấu hình maxStock ⇒ không cảnh báo, không bịa giá trị.
    const khongCauHinh = plan({ inventories: [{ quantity: 5_000, reserved: 0 }] });
    expect(khongCauHinh.rules.overStock).toBe(false);
    expect(khongCauHinh.rules.maxStock).toBeNull();
    expect(khongCauHinh.rules.excessQty).toBe(0);
  });

  test("`rules.configured` phản ánh đúng việc người dùng có cấu hình hay không", () => {
    expect(plan().rules.configured).toBe(false);
    expect(plan({ configuredLeadTimeDays: 10 }).rules.configured).toBe(true);
    expect(plan({ maxStock: 500 }).rules.configured).toBe(true);
  });

  test("rationale (khối LLM được đọc) có đủ số và KHÔNG tự bịa giá trị", () => {
    const p = plan({ configuredLeadTimeDays: 12 });
    // LLM chỉ được thấy khối rationale — phải có `leadTimeSource` để nó không bịa
    // rằng lead time là "đo được" khi thực ra là cấu hình.
    expect(p.rationale.leadTimeSource).toBe("CONFIGURED");
    expect(p.rationale.leadTimeDays).toBe(12);
    for (const k of ["atp", "rop", "safetyStock", "orderQty", "totalEstimate", "daysOfCoverLeft"]) {
      expect(p.rationale).toHaveProperty(k);
    }
  });

  test("đường mặc định KHÔNG đổi khi không cấu hình gì (hồi quy cũ)", () => {
    // Khoá: mọi SKU chưa cấu hình phải cho ĐÚNG kết quả như trước khi thêm cột.
    const p = plan();
    expect(p.lead.leadTimeDays).toBe(calc.DEFAULT_LEAD_TIME_DAYS);
    expect(p.safety.serviceLevel).toBe(calc.DEFAULT_SERVICE_LEVEL);
    expect(p.order.packMultiple).toBe(1);
    expect(p.rules.configured).toBe(false);
  });
});