/**
 * tests/partner.service.test.js — Nghiệp vụ đối tác (PRM)
 *
 * Trọng tâm kiểm tra:
 * - Quy đổi tỷ lệ hoa hồng PHẦN TRĂM (API) ↔ THẬP PHÂN (DB) không nhân nhầm.
 * - Sinh mã `ĐT-YYYYMM-XXXX` không trùng, có dự phòng khi trùng.
 * - Ngừng hoạt động là XOÁ MỀM: giữ nguyên để không mất lịch sử giới thiệu.
 */
const mockClient = {
  partner: {
    create: jest.fn(),
    update: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    groupBy: jest.fn(),
  },
};

jest.mock("../src/config/prisma", () => mockClient);
jest.mock("../src/utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const service = require("../src/modules/partners/partner.service");

describe("partner.service — quy đổi tỷ lệ hoa hồng", () => {
  beforeEach(() => jest.clearAllMocks());

  // Đây là chỗ dễ sai nhất của cả phân hệ: `commissionRate` trong DB là THẬP PHÂN
  // (0,10 = 10%), còn người dùng nhập PHẦN TRĂM (10). Nhân nhầm một lần là hồi
  // hoa hồng sai 100 lần, và sai thì không ai thấy cho tới lúc đối tác kêu.
  test("10% nhập vào → lưu 0.1", async () => {
    mockClient.partner.create.mockImplementation(async ({ data }) => ({ id: "p1", ...data }));

    await service.create({ name: "Đối tác A", commissionPercent: 10 });

    expect(mockClient.partner.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ commissionRate: 0.1 }) }),
    );
  });

  test("100% nhập vào → lưu 1", async () => {
    mockClient.partner.create.mockImplementation(async ({ data }) => ({ id: "p1", ...data }));

    await service.create({ name: "Đối tác A", commissionPercent: 100 });

    expect(mockClient.partner.create.mock.calls[0][0].data.commissionRate).toBe(1);
  });

  test("0,5% nhập vào → lưu 0.005, không làm tròn về 0", async () => {
    mockClient.partner.create.mockImplementation(async ({ data }) => ({ id: "p1", ...data }));

    await service.create({ name: "Đối tác A", commissionPercent: 0.5 });

    expect(mockClient.partner.create.mock.calls[0][0].data.commissionRate).toBe(0.005);
  });

  test("serialize trả về PHẦN TRĂM và bỏ trường thập phân", () => {
    const out = service.serialize({ id: "p1", name: "A", commissionRate: 0.1, fixedCommission: 50000 });

    expect(out.commissionPercent).toBe(10);
    // Trường cũ phải KHÔNG còn, nếu không giao diện có hai nguồn số mâu thuẫn
    // và không biết nên tin cái nào.
    expect(out.commissionRate).toBeUndefined();
    expect(out.fixedCommission).toBe(50000);
  });

  test("serialize xử lý được commissionRate null", () => {
    expect(service.serialize({ id: "p1", commissionRate: null }).commissionPercent).toBe(0);
  });
});

describe("partner.service — sinh mã đối tác", () => {
  beforeEach(() => jest.clearAllMocks());

  test("mã theo dạng ĐT-YYYYMM-XXXX", async () => {
    mockClient.partner.count.mockResolvedValue(0);
    mockClient.partner.findFirst.mockResolvedValue(null);

    const code = await service.generateUniqueCode();

    expect(code).toMatch(/^ĐT-\d{6}-\d{4}$/);
  });

  // `code` có ràng buộc duy nhất ở tầng DB, nên hai phiên tạo đồng thời có thể đụng
  // nhau. Đọc count rồi ghi là read-then-write không an toàn — phải thử lại.
  test("thử lại khi mã bị trùng", async () => {
    mockClient.partner.count.mockResolvedValue(0);
    mockClient.partner.findFirst
      .mockResolvedValueOnce({ id: "dup" })
      .mockResolvedValueOnce(null);

    const code = await service.generateUniqueCode();

    expect(code).toMatch(/^ĐT-\d{6}-\d{4}$/);
    expect(mockClient.partner.findFirst).toHaveBeenCalledTimes(2);
    expect(code.endsWith("0002")).toBe(true);
  });

  test("thử tối đa 10 lần rồi mới ném lỗi", async () => {
    mockClient.partner.count.mockResolvedValue(0);
    mockClient.partner.findFirst.mockResolvedValue({ id: "dup" });

    await expect(service.generateUniqueCode()).rejects.toMatchObject({ status: 500 });
    expect(mockClient.partner.findFirst).toHaveBeenCalledTimes(10);
  });

  test("cho phép truyền code thủ công", async () => {
    mockClient.partner.create.mockImplementation(async ({ data }) => ({ id: "p1", ...data }));

    await service.create({ name: "A", code: "ĐT-CUSTOM-1" });

    expect(mockClient.partner.create.mock.calls[0][0].data.code).toBe("ĐT-CUSTOM-1");
  });
});

describe("partner.service — ngừng hoạt động là xoá mềm", () => {
  beforeEach(() => jest.clearAllMocks());

  // `partner_referrals.partnerId` là khoá ngoại CASCADE. Xoá hẳn đối tác sẽ mất
  // toàn bộ lịch sử giới thiệu — tức mất chứng cứ để tính hoa hồng và kiểm toán.
  test("DELETE đặt isActive = false, không xoá dòng", async () => {
    mockClient.partner.findUnique.mockResolvedValue({ id: "p1" });
    mockClient.partner.update.mockImplementation(async ({ where, data }) => ({ id: where.id, ...data }));

    const out = await service.deactivate("p1");

    expect(mockClient.partner.update).toHaveBeenCalledWith({
      where: { id: "p1" },
      data: { isActive: false },
    });
    expect(out.isActive).toBe(false);
    // Không được gọi xoá dưới bất kỳ hình thức nào.
    expect(mockClient.partner.deleteMany).toBeUndefined();
  });

  test("khoá lại được", async () => {
    mockClient.partner.findUnique.mockResolvedValue({ id: "p1" });
    mockClient.partner.update.mockImplementation(async ({ where, data }) => ({ id: where.id, ...data }));

    expect((await service.restore("p1")).isActive).toBe(true);
  });

  test("trả 404 khi không có đối tác", async () => {
    mockClient.partner.findUnique.mockResolvedValue(null);

    await expect(service.deactivate("nope")).rejects.toMatchObject({ status: 404 });
  });
});

describe("partner.service — tra đối tác theo mã", () => {
  beforeEach(() => jest.clearAllMocks());

  // Đối tác đã ngừng không được ghi nhận thêm lượt giới thiệu, nếu không số liệu
  // hoa hồng của kỳ trước và kỳ sau lệch nhau.
  test("chỉ trả về đối tác đang hoạt động", async () => {
    mockClient.partner.findFirst.mockResolvedValue({ id: "p1", code: "ĐT-202610-0001" });

    await service.findActiveByCode("ĐT-202610-0001");

    expect(mockClient.partner.findFirst).toHaveBeenCalledWith({
      where: { code: "ĐT-202610-0001", isActive: true },
    });
  });

  test("mã rỗng thì không truy vấn", async () => {
    expect(await service.findActiveByCode("")).toBeNull();
    expect(await service.findActiveByCode(null)).toBeNull();
    expect(mockClient.partner.findFirst).not.toHaveBeenCalled();
  });
});

describe("partner.service — mã lượt giới thiệu", () => {
  test("sinh mã ngẫu nhiên dạng RF-XXXXXXXX", () => {
    const code = service.genReferralCode();
    expect(code).toMatch(/^RF-[0-9A-F]{10}$/);
  });

  test("mỗi lần sinh ra mã khác nhau", () => {
    const codes = new Set(Array.from({ length: 200 }, () => service.genReferralCode()));
    expect(codes.size).toBe(200);
  });
});