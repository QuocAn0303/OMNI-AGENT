/**
 * HỢP ĐỒNG: dòng audit phải gắn được `tenantId` khi luồng ghi nó KHÔNG chạy
 * trong tenant context.
 *
 * Bối cảnh (đo trên DB phát triển, 2026-10-03): 124 dòng `audit_logs` có
 * `tenantId = NULL` đều `userId = NULL`, chia đúng 4 nhóm `action`:
 *
 *   CREATE_ADMIN_CAMPAIGN | AdminCampaign | 36
 *   SEND_ADMIN_CAMPAIGN   | AdminCampaign | 36   → 72 dòng: bảng NỀN TẢNG,
 *     không có `tenantId`, không thể gán — đúng theo thiết kế.
 *   REGISTER              | Tenant        | 26
 *   VERIFY_EMAIL          | User          | 26   → 52 dòng: **lỗi mã**.
 *
 * `audit.service.log` lấy `tenantId` từ AsyncLocalStorage (`getTenantId()`).
 * Đăng ký và xác minh email đều chạy NGOÀI tenant context, nên `getTenantId()`
 * là `null` dù tenant đã biết ⇒ dòng log không truy được về tenant nào.
 *
 * Hợp đồng ở đây:
 *   1. truyền `tenantId` tường minh  → dùng giá trị đó;
 *   2. không truyền                  → giữ nguyên hành vi cũ (`getTenantId()`);
 *   3. truyền `null` tường minh     → ghi NULL (dùng cho bảng nền tảng).
 */
const mockAuditLog = { create: jest.fn() };
let mockGetTenantId = jest.fn(() => null);

jest.mock("../src/config/prisma", () => ({ auditLog: mockAuditLog }));
jest.mock("../src/utils/logger", () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock("../src/config/tenantContext", () => ({
  getTenantId: () => mockGetTenantId(),
}));

const auditService = require("../src/modules/audit/audit.service");

const payload = (action, extra = {}) => ({ action, entity: "X", entityId: "e1", ...extra });

describe("audit.service — gắn tenantId khi ngoài tenant context", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetTenantId = jest.fn(() => null);
    mockAuditLog.create.mockResolvedValue({});
  });

  const written = () => mockAuditLog.create.mock.calls[0][0].data;

  test("không truyền tenantId thì lấy từ context (hành vi cũ)", async () => {
    mockGetTenantId = jest.fn(() => "ctx-tenant");
    await auditService.log(payload("CREATE_ORDER"));
    expect(written().tenantId).toBe("ctx-tenant");
  });

  test("truyền tenantId tường minh thì THẮNG giá trị của context", async () => {
    mockGetTenantId = jest.fn(() => "ctx-tenant");
    await auditService.log(payload("REGISTER", { tenantId: "new-tenant" }));
    expect(written().tenantId).toBe("new-tenant");
  });

  test("ngoài context + truyền tenantId thì KHÔNG ghi NULL (đường REGISTER/VERIFY_EMAIL)", async () => {
    mockGetTenantId = jest.fn(() => null);
    await auditService.log(payload("REGISTER", { tenantId: "new-tenant" }));
    expect(written().tenantId).toBe("new-tenant");
  });

  test("truyền null tường minh = log nền tảng, ghi NULL có chủ đích", async () => {
    mockGetTenantId = jest.fn(() => "ctx-tenant");
    await auditService.log(payload("CREATE_ADMIN_CAMPAIGN", { tenantId: null }));
    expect(written().tenantId).toBeNull();
  });

  test("lỗi ghi log KHÔNG làm hỏng luồng gọi (giữ nguyên hợp đồng không throw)", async () => {
    mockAuditLog.create.mockRejectedValue(new Error("db down"));
    await expect(auditService.log(payload("X"))).resolves.toBeUndefined();
  });
});