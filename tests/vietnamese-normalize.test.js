/**
 * tests/vietnamese-normalize.test.js — Bỏ dấu tiếng Việt cho so khớp
 *
 * Bug gốc: `resolveIntent` so khớp bằng `includes` thẳng giữa câu hỏi của người
 * dùng và pattern viết trong mã. Hai bên dùng hai kiểu viết khác nhau nên không
 * gặp nhau, và đã tạo ra các lỗi sau (đo được trước khi sửa):
 *
 *     "sap het"  → search_inventory   đúng
 *     "sắp hết" → null               sai, hội đồng bảo "chưa hiểu câu hỏi"
 *     "hoa don"  → search_invoices    đúng
 *     "hóa đơn"  → search_orders      sai, 'đơn' khớp chuỗi con trong "hóa đơn"
 *
 * Lưu ý lỗi thứ hai: viết KHÔNG DẤU lại che lỗi chứ không gây lỗi. Đó là lý do
 * phải chuẩn hoá cả hai vế thay vì chọn một kiểu viết.
 */
const { stripDiacritics } = require("../src/utils/vietnamese");
const { resolveIntent, extractParams, resolvePartnerIntent } = require("../src/modules/ai/db-agent.service");

describe("utils/vietnamese — bỏ dấu", () => {
  test("bỏ được dấu thanh, dấu phụ và dấu câu", () => {
    expect(stripDiacritics("sắp hết")).toBe("sap het");
    expect(stripDiacritics("Nguyễn Việt Hùng")).toBe("Nguyen Viet Hung");
    expect(stripDiacritics("lợi nhuận ròng")).toBe("loi nhuan rong");
  });

  // ĐÂY là chỗ mà `normalize('NFD')` một mình KHÔNG đủ: `đ` là một chữ cái riêng
  // (U+0111), không phải dấu phụ tổ hợp, nên NFD không tách nó thành `d`.
  // Nếu thiếu phép thay này thì "đối tác" → "đoi tac" và regex /\bdoi tac/ không khớp.
  test("chữ đ Đ phải thành d D — NFD một mình không làm được", () => {
    expect(stripDiacritics("đối tác")).toBe("doi tac");
    expect(stripDiacritics("Đối tác")).toBe("Doi tac");
    // Chứng minh vấn đề: NFD một mình giữ nguyên `đ`.
    expect("đối tác".normalize("NFD").replace(/[̀-ͯ]/g, "")).toContain("đ");
  });

  test("mã đối tác giữ nguyên cấu trúc", () => {
    expect(stripDiacritics("ĐT-202610-0001")).toBe("DT-202610-0001");
  });

  test("giữ khoảng trắng, gạch nối, dấu chấm", () => {
    expect(stripDiacritics("PO-2024 / 01.02")).toBe("PO-2024 / 01.02");
  });

  test("null và undefined không ném lỗi", () => {
    expect(stripDiacritics(null)).toBe("");
    expect(stripDiacritics(undefined)).toBe("");
  });
});

describe("resolveIntent — câu có dấu và không dấu cho cùng kết quả", () => {
  // Mỗi cặp là một hành vi phải GIỐNG NHAU dù gõ kiểu nào.
  const pairs = [
    ["sap het", "sắp hết", "search_inventory"],
    ["hoa don", "hóa đơn", "search_invoices"],
    ["hoa don ncc", "hóa đơn NCC", "search_purchase_invoices"],
    ["don hang", "đơn hàng", "search_orders"],
    ["doi tac", "đối tác", "search_partner_performance"],
    ["bang luong", "bảng lương", "search_hr"],
    ["con no", "công nợ", "search_debts"],
    ["tra hang", "trả hàng", "search_returns"],
    ["khach sap mat", "khách sắp mất", "search_churn_alerts"],
    ["hang ton", "hàng tồn", "search_inventory"],
    ["nguon khach", "nguồn khách", "search_leads"],
    ["don nhap", "đơn nhập", "search_purchase_orders"],
    ["cham cong", "chấm công", "search_hr"],
  ];

  test.each(pairs)("%s và %s đều ra %s", (noAccent, withAccent, expected) => {
    expect(resolveIntent(noAccent)).toBe(expected);
    expect(resolveIntent(withAccent)).toBe(expected);
  });

  test("mã đối tác nhận được cả ba kiểu gõ", () => {
    expect(resolveIntent("ĐT-202610-0001")).toBe("search_partner_performance");
    expect(resolveIntent("đt-202610-0001")).toBe("search_partner_performance");
    expect(resolveIntent("DT-202610-0001")).toBe("search_partner_performance");
  });

  // `đ` không thuộc [A-Za-z0-9_] nên `\bđ` không tạo ra ranh giới từ — regex có
  // `\b` trước `đ` sẽ không bao giờ khớp. Test này chặn việc thêm lại `\b`.
  test("mã đối tác khớp được ngay đầu chuỗi", () => {
    expect(resolveIntent("ĐT-202610-0001 hiệu quả thế nào")).toBe("search_partner_performance");
  });

  // "hóa **đơn**" là hỏi về hóa đơn, nhưng chuỗi con 'đơn' từng khớp nhóm đơn bán
  // đứng trước. Pattern trần 'đơn' đã bị gỡ vì lý do này.
  test("hóa đơn không bị nhóm đơn bán bắt mất", () => {
    expect(resolveIntent("hóa đơn")).toBe("search_invoices");
    expect(resolveIntent("hóa đơn tháng 5")).toBe("search_invoices");
  });

  test("hóa đơn NCC vẫn ra đúng nhóm hóa đơn mua", () => {
    expect(resolveIntent("hóa đơn NCC")).toBe("search_purchase_invoices");
  });

  test("nhà cung cấp và đối tác không lẫn vào nhau", () => {
    expect(resolveIntent("Kraljic nhà cung cấp nào rẻ nhất")).toBe("search_vendor_performance");
    expect(resolveIntent("hoa hồng đối tác nào cao nhất")).toBe("search_partner_performance");
  });
});

describe("extractParams — tham số không phụ thuộc dấu", () => {
  test("khoảng thời gian", () => {
    expect(extractParams("hom nay", "x").period).toBe("today");
    expect(extractParams("hôm nay", "x").period).toBe("today");
    expect(extractParams("thang truoc", "x").period).toBe("last_month");
    expect(extractParams("tháng trước", "x").period).toBe("last_month");
    expect(extractParams("tuần này", "x").period).toBe("this_week");
  });

  test("trạng thái thanh toán", () => {
    expect(extractParams("chua thanh toan", "x").paymentStatus).toBe("UNPAID");
    expect(extractParams("chưa thanh toán", "x").paymentStatus).toBe("UNPAID");
  });

  // Mã đối tác phải luôn trả về DẠNG CÓ DẤU, vì `roi.service.js` tra cứu theo mã
  // gốc trong cơ sở dữ liệu. Trả "DT-..." sẽ không tìm thấy dòng "ĐT-...".
  test("mã đối tác chuẩn hoá về dạng có dấu", () => {
    expect(extractParams("ĐT-202610-0001", "x").partnerCode).toBe("ĐT-202610-0001");
    expect(extractParams("đt-202610-0001", "x").partnerCode).toBe("ĐT-202610-0001");
    expect(extractParams("DT-202610-0001", "x").partnerCode).toBe("ĐT-202610-0001");
  });

  test("mã đối tác lấy được kể cả khi câu không có từ khoá đối tác", () => {
    expect(extractParams("ĐT-202610-0001 hiệu quả thế nào", "x").partnerCode).toBe("ĐT-202610-0001");
  });

  test("thứ tự ưu tiên của sortBy", () => {
    expect(extractParams("đối tác nào có doanh thu cao", "x").sortBy).toBe("revenue");
    expect(extractParams("đối tác nào có tỷ lệ chuyển đổi cao", "x").sortBy).toBe("conversion");
    expect(extractParams("đối tác nào tốt nhất", "x").sortBy).toBe("profit");
  });

  // Cắt chuỗi tìm kiếm trên ĐÚNG bản mà tìm thấy. Trước đây tìm vị trí trên bản
  // đã bỏ dấu rồi lại cắt trên bản còn dấu — độ dài lệch nhau nên câu ra rác.
  test("từ khoá tìm kiếm giữ nguyên chữ người dùng gõ", () => {
    expect(extractParams("sản phẩm Cà phê", "x").search).toBe("Cà phê");
    expect(extractParams("san pham Ca phe", "x").search).toBe("ca phe");
  });
});

describe("resolvePartnerIntent", () => {
  test("câu có mã đối tác thì gọi tool chi tiết", () => {
    expect(resolvePartnerIntent("ĐT-202610-0001 hiệu quả")).toBe("search_partner_referrals");
    expect(resolvePartnerIntent("dt-202610-0001")).toBe("search_partner_referrals");
  });

  test("câu chung chung thì gọi tool xếp hạng", () => {
    expect(resolvePartnerIntent("đối tác nào tốt nhất")).toBe("search_partner_performance");
    expect(resolvePartnerIntent("doi tac nao tot nhat")).toBe("search_partner_performance");
  });

  test("không liên quan đối tác thì trả null", () => {
    expect(resolvePartnerIntent("sản phẩm nào bán chạy")).toBeNull();
  });
});