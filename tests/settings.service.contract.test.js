/**
 * HỢP ĐỒNG: đọc cài đặt công ty phải XÁC ĐỊNH và TỰ HỘI TỤ về một dòng.
 *
 * Bối cảnh (đo trên DB phát triển, Mốc 10): tenant demo `CANDORY SCENT` có
 * **36 dòng `company_settings`** cho một tenant thiết kế 1-1. 35 dòng tên
 * `E2E Test <timestamp>` là rác test; 1 dòng là dòng gốc tạo 02/06.
 *
 * Hệ quả: `companySettings.findFirst()` không có `orderBy` trả về dòng tuỳ ý
 * theo thứ tự vật lý, và `poApprovalThreshold` quyết định PO có cần duyệt tài
 * chính lần hai hay không ⇒ hành vi nghiệp vụ phụ thuộc thứ tự heap.
 *
 * Ngoài ra `findFirst → create` là race read-then-write và bảng **chưa** có
 * UNIQUE(tenantId) (backlog, không thêm migration ở Vòng 2) ⇒ hai request song
 * song có thể tạo hai dòng. Hàm `getOrCreate` vì vậy phải hội tụ về đúng một.
 */
const mockCompanySettings = {
  findFirst: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
};
const mockLogger = { warn: jest.fn(), error: jest.fn() };

jest.mock("../src/config/prisma", () => ({ companySettings: mockCompanySettings }));
jest.mock("../src/utils/logger", () => mockLogger);

const svc = require("../src/modules/settings/settings.service");

const row = (id, createdAt) => ({
  id,
  tenantId: "t1",
  name: "x",
  createdAt,
  poApprovalThreshold: null,
});

describe("settings.service — đọc xác định", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCompanySettings.delete.mockResolvedValue({});
  });

  test("findCanonical luôn có orderBy (dòng tạo sớm nhất là dòng gốc)", async () => {
    mockCompanySettings.findFirst.mockResolvedValue(row("r1", "2026-06-02T00:00:00Z"));
    await svc.getOrCreate();
    const args = mockCompanySettings.findFirst.mock.calls[0][0];
    // PHẢI có hai khoá: chỉ `createdAt` thì hai dòng cùng mili-giây có thể đảo thứ
    // tự, quay lại trạng thái không xác định.
    expect(args.orderBy).toEqual([{ createdAt: "asc" }, { id: "asc" }]);
  });

  test("getOrCreate trả dòng đã có, không tạo thêm", async () => {
    mockCompanySettings.findFirst.mockResolvedValue(row("r1", "2026-06-02T00:00:00Z"));
    const s = await svc.getOrCreate();
    expect(s.id).toBe("r1");
    expect(mockCompanySettings.create).not.toHaveBeenCalled();
  });

  test("thiếu dòng → tạo, và dòng tạo ra LÀ dòng gốc thì giữ lại", async () => {
    mockCompanySettings.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(row("new", "2026-10-02T00:00:00Z"));
    mockCompanySettings.create.mockResolvedValue(row("new", "2026-10-02T00:00:00Z"));
    const s = await svc.getOrCreate();
    expect(s.id).toBe("new");
    expect(mockCompanySettings.delete).not.toHaveBeenCalled();
  });

  test("đua lệnh tạo trùng → xoá dòng vừa tạo, trả về dòng gốc", async () => {
    // Lần đọc 1: chưa có. Lần đọc 2 (sau create): đã có dòng gốc cũ hơn.
    mockCompanySettings.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(row("canon", "2026-06-02T00:00:00Z"));
    mockCompanySettings.create.mockResolvedValue(row("dup", "2026-10-02T00:00:00Z"));
    const s = await svc.getOrCreate();
    expect(s.id).toBe("canon");
    expect(mockCompanySettings.delete).toHaveBeenCalledWith({ where: { id: "dup" } });
  });

  test("xoá dòng thừa thất bại thì KHÔNG làm hỏng luồng đọc", async () => {
    mockCompanySettings.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(row("canon", "2026-06-02T00:00:00Z"));
    mockCompanySettings.create.mockResolvedValue(row("dup", "2026-10-02T00:00:00Z"));
    mockCompanySettings.delete.mockRejectedValue(new Error("FK restrict"));
    const s = await svc.getOrCreate();
    expect(s.id).toBe("canon");
    expect(mockLogger.error).toHaveBeenCalled();
  });
});

describe("settings.service — ngưỡng duyệt PO", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("mặc định là 5.000.000", () => {
    expect(svc.DEFAULT_PO_APPROVAL_THRESHOLD).toBe(5_000_000);
  });

  test("thiếu dòng settings → trả mặc định, không ném lỗi", async () => {
    mockCompanySettings.findFirst.mockResolvedValue(null);
    expect(await svc.getPoApprovalThreshold()).toBe(5_000_000);
  });

  test("`poApprovalThreshold` NULL (trạng thái thật của cả 36 dòng) → mặc định", async () => {
    mockCompanySettings.findFirst.mockResolvedValue(row("r1", "2026-06-02T00:00:00Z"));
    expect(await svc.getPoApprovalThreshold()).toBe(5_000_000);
  });

  test("giá trị 0 hoặc âm không phải ngưỡng hợp lệ → mặc định", async () => {
    for (const bad of [0, -1]) {
      mockCompanySettings.findFirst.mockResolvedValue({ ...row("r1"), poApprovalThreshold: bad });
      expect(await svc.getPoApprovalThreshold()).toBe(5_000_000);
    }
  });

  test("có giá trị hợp lệ → dùng giá trị đó", async () => {
    mockCompanySettings.findFirst.mockResolvedValue({ ...row("r1"), poApprovalThreshold: 25_000_000 });
    expect(await svc.getPoApprovalThreshold()).toBe(25_000_000);
  });

  test("lỗi DB → ghi log rồi dùng mặc định, KHÔNG nuốt lỗi im lặng", async () => {
    mockCompanySettings.findFirst.mockRejectedValue(new Error("db down"));
    expect(await svc.getPoApprovalThreshold()).toBe(5_000_000);
    expect(mockLogger.warn).toHaveBeenCalled();
  });
});
