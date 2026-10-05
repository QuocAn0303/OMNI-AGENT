/**
 * tests/user-support-impersonation.security.test.js — C1 regression
 *
 * Lỗi gốc: support-impersonation token mang `id` THẬT của SUPER_OMEGA_ULTRA_ADMIN
 * (mượn để ghi log) với `role: "ADMIN"`. `authenticate` không re-read role cho
 * nhánh này, còn `user.service.getActor()` đọc lại DB theo id → phục hồi role
 * SUPER_OMEGA → mọi guard chống leo quyền bị bypass.
 *
 * Hậu quả trước khi sửa:
 * - POST /api/users { role: "SUPER_ADMIN" } → tạo tài khoản tenantId=null (vĩnh viễn)
 * - PUT /api/users/:id / DELETE /api/users/:id trên user của tenant KHÁC
 *
 * Test:
 * - A. getActor hạ quyền theo JWT khi có supportSessionId (không đọc DB)
 * - B. create chặn tạo/gán vai trò SUPER qua support session
 * - C. update/remove chặn chạm user ngoài tenant của support session
 * - D. H4: reset mật khẩu phải bump tokenVersion + thu hồi refresh token
 */
jest.mock("../src/config/prisma", () => ({
  user: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  refreshToken: { updateMany: jest.fn() },
}));
jest.mock("../src/modules/audit/audit.service", () => ({ log: jest.fn() }));
jest.mock("../src/utils/logger", () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const prisma = require("../src/config/prisma");
const userService = require("../src/modules/users/user.service");

const SUPER_OMEGA_ID = "u-super-omega";
const SUPPORT_TENANT = "t-target";

// req.user sau khi qua authenticate() với support token
const supportActor = {
  id: SUPER_OMEGA_ID, // id THẬT của super admin — kẻ thù dùng chính id này
  email: "omega@candory.com",
  role: "ADMIN", // đã bị ép hạ
  tenantId: SUPPORT_TENANT,
  supportSessionId: "sess-1",
};

beforeEach(() => {
  jest.clearAllMocks();
  // DB trả về quyền thật của user đó id — đây chính là nguồn leo quyền
  prisma.user.findUnique.mockResolvedValue({
    id: SUPER_OMEGA_ID,
    role: "SUPER_OMEGA_ULTRA_ADMIN",
    tenantId: null,
  });
  prisma.user.create.mockResolvedValue({ id: "new-1", tenantId: SUPPORT_TENANT });
  prisma.user.update.mockResolvedValue({ id: "u-victim", email: "v@t.com", fullName: "Victim", role: "CASHIER", isActive: false });
  prisma.refreshToken.updateMany.mockResolvedValue({ count: 2 });
});

describe("A. getActor không phục hồi quyền SUPER từ DB khi là support session", () => {
  test("trả về role ADMIN của tenant hỗ trợ, không phải SUPER từ DB", async () => {
    await expect(userService.create(
      { email: "a@t.com", password: "secret123", fullName: "NV Moi", role: "CASHIER" },
      supportActor,
    )).resolves.toBeDefined();

    // create() chỉ chạy được vì actor.tenantId = tenant đích, KHÔNG phải null
    expect(prisma.user.create.mock.calls[0][0].data.tenantId).toBe(SUPPORT_TENANT);
    expect(prisma.user.create.mock.calls[0][0].data.role).toBe("CASHIER");
  });

  test("actor hợp lệ (không phải support session) vẫn lấy role từ DB như cũ", async () => {
    const actor = { id: SUPER_OMEGA_ID, role: "SUPER_OMEGA_ULTRA_ADMIN", tenantId: null };
    const created = await userService.create(
      { email: "boss@erp.com", password: "secret123", fullName: "Boss", role: "SUPER_ADMIN" },
      actor,
    );
    expect(created).toBeDefined();
    // SUPER_ADMIN → tenantId null, đúng hành vi gốc
    expect(prisma.user.create.mock.calls[0][0].data.tenantId).toBeNull();
  });
});

describe("B. Support session không được tạo/gán tài khoản cấp SUPER", () => {
  test.each(["SUPER_ADMIN", "SUPER_OMEGA_ULTRA_ADMIN"])(
    "POST /api/users với role %s → 403",
    async (role) => {
      await expect(userService.create(
        { email: "evil@erp.com", password: "secret123", fullName: "Evil", role },
        supportActor,
      )).rejects.toMatchObject({ status: 403 });
      expect(prisma.user.create).not.toHaveBeenCalled();
    },
  );

  test("PUT /api/users/:id gán role SUPER_ADMIN → 403", async () => {
    prisma.user.findUnique.mockImplementation(async ({ where }) =>
      where.id === "u-victim"
        ? { id: "u-victim", email: "v@t.com", fullName: "V", role: "CASHIER", isActive: true, tenantId: SUPPORT_TENANT }
        : { id: where.id, role: "SUPER_OMEGA_ULTRA_ADMIN", tenantId: null },
    );

    await expect(userService.update("u-victim", { role: "SUPER_ADMIN" }, supportActor))
      .rejects.toMatchObject({ status: 403 });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});

describe("C. Support session không chạm được user ngoài tenant / cấp SUPER", () => {
  beforeEach(() => {
    prisma.user.findUnique.mockImplementation(async ({ where }) =>
      where.id === "u-other-tenant"
        ? { id: "u-other-tenant", email: "o@other.com", fullName: "Khac", role: "CASHIER", isActive: true, tenantId: "t-KHAC" }
        : { id: where.id, role: "SUPER_OMEGA_ULTRA_ADMIN", tenantId: null },
    );
  });

  test("PUT user của tenant khác → 403", async () => {
    await expect(userService.update("u-other-tenant", { fullName: "Hacked" }, supportActor))
      .rejects.toMatchObject({ status: 403 });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  test("DELETE user của tenant khác → 403", async () => {
    await expect(userService.remove("u-other-tenant", supportActor))
      .rejects.toMatchObject({ status: 403 });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  test("DELETE tài khoản SUPER của shop đang hỗ trợ → 403", async () => {
    prisma.user.findUnique.mockImplementation(async ({ where }) =>
      where.id === "u-super-in-tenant"
        ? { id: "u-super-in-tenant", email: "s@t.com", fullName: "S", role: "SUPER_ADMIN", tenantId: null }
        : { id: where.id, role: "SUPER_OMEGA_ULTRA_ADMIN", tenantId: null },
    );
    await expect(userService.remove("u-super-in-tenant", supportActor))
      .rejects.toMatchObject({ status: 403 });
  });
});

describe("D. H4 — reset mật khẩu phải vô hiệu hoá phiên cũ", () => {
  beforeEach(() => {
    prisma.user.findUnique.mockImplementation(async ({ where }) =>
      where.id === "u-victim"
        ? { id: "u-victim", email: "v@t.com", fullName: "V", role: "CASHIER", isActive: true, tenantId: SUPPORT_TENANT }
        : { id: where.id, role: "SUPER_OMEGA_ULTRA_ADMIN", tenantId: null },
    );
  });

  test("bump tokenVersion khi có password mới", async () => {
    await userService.update("u-victim", { password: "mat-khau-moi-123" }, supportActor);
    const data = prisma.user.update.mock.calls[0][0].data;
    expect(data.tokenVersion).toEqual({ increment: 1 });
    expect(data.password).toEqual(expect.stringMatching(/^\$2[aby]\$/));
  });

  test("thu hồi toàn bộ refresh token của user bị reset", async () => {
    await userService.update("u-victim", { password: "mat-khau-moi-123" }, supportActor);
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: "u-victim", isRevoked: false },
      data: { isRevoked: true },
    });
  });

  test("lệnh thu hồi chạy NGOÀI tenant scope (không inject tenantId)", async () => {
    // Regression: `createRefreshToken` chạy ở login — trước khi authenticate dựng
    // tenant context — nên mọi dòng refresh_token có tenantId = NULL, trong khi
    // `RefreshToken` nằm trong TENANT_SCOPED_MODELS. Nếu extension còn inject
    // tenantId của admin vào `where`, updateMany không khớp dòng nào → refresh
    // token của kẻ tấn công sống sót và lấy lại được access token mới.
    const { getTenantId } = require("../src/config/tenantContext");
    let tenantIdSeenByQuery = "NOT_SET";
    prisma.refreshToken.updateMany.mockImplementation(async () => {
      tenantIdSeenByQuery = getTenantId();
      return { count: 2 };
    });

    await userService.update("u-victim", { password: "mat-khau-moi-123" }, supportActor);
    expect(tenantIdSeenByQuery).toBeNull();
  });

  test("KHÔNG bump tokenVersion khi chỉ sửa tên (không đổi mật khẩu)", async () => {
    await userService.update("u-victim", { fullName: "Ten Moi" }, supportActor);
    const data = prisma.user.update.mock.calls[0][0].data;
    expect(data.tokenVersion).toBeUndefined();
    expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
  });

  test("khoá tài khoản cũng thu hồi refresh token", async () => {
    await userService.remove("u-victim", supportActor);
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: "u-victim", isRevoked: false },
      data: { isRevoked: true },
    });
  });
});