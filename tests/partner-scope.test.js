/**
 * tests/partner-scope.test.js — Phân quyền và tích hợp của phân hệ đối tác (PRM)
 *
 * PRM là phân hệ đầu tiên trong dự án mà CẤU HÌNH CÓ TIỀN (tỷ lệ hoa hồng) được
 * tách quyền khỏi vận hành hằng ngày. Nếu CASHIER sửa được tỷ lệ hoa hồng thì toàn
 * bộ ý nghĩa của báo cáo lợi nhuận ròng là số do nhân viên tự chọn.
 *
 * Vì vậy file này khẳng định hai thứ:
 *   1. Ma trận vai trò không để lọt vai trò thấp vào cấu hình.
 *   2. Route thực sự dùng ma trận đó (không liệt kê role riêng ở từng route).
 */
const fs = require("fs");
const path = require("path");

jest.mock("../src/config/prisma", () => ({
  partner: {}, partnerReferral: {}, crmLead: {}, customer: {}, tenant: {},
}));
jest.mock("../src/utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const roles = require("../src/modules/partners/roles");

const ROUTE_DIR = path.join(__dirname, "..", "src", "modules", "partners");

describe("roles — ma trận vai trò PRM", () => {
  test("mọi nhóm đều có SUPER_OMEGA_ULTRA_ADMIN", () => {
    // Vai trò này bypass tenant-scoping; thiếu ở một nhóm nghĩa là nhóm đó mất
    // đường vào khi dùng tài khoản quản trị cấp cao nhất.
    for (const [name, list] of Object.entries(roles)) {
      expect(list).toContain("SUPER_OMEGA_ULTRA_ADMIN");
      expect(name).toMatch(/^PRM_[A-Z_]+$/);
    }
  });

  test("SUPER_OMEGA_ULTRA_ADMIN luôn đứng đầu danh sách", () => {
    for (const list of Object.values(roles)) {
      expect(list[0]).toBe("SUPER_OMEGA_ULTRA_ADMIN");
    }
  });

  test("cấu hình đối tác (khoá, ngừng hoạt động) không mở cho CASHIER", () => {
    expect(roles.PRM_ADMIN_ROLES).not.toContain("CASHIER");
    expect(roles.PRM_ADMIN_ROLES).not.toContain("WAREHOUSE");
  });

  test("tạo/sửa đối tác không mở cho CASHIER", () => {
    expect(roles.PRM_MANAGE_ROLES).not.toContain("CASHIER");
  });

  test("đọc báo cáo thì mở cho CASHIER — nhân viên cần xem khi gọi khách", () => {
    expect(roles.PRM_READ_ROLES).toContain("CASHIER");
  });

  // Ma trận phải THU HẸp dần theo độ nhạy cảm. Nếu nhóm nhạy cảm hơn lại rộng hơn
  // thì thứ tự bảo vệ bị đảo ngược.
  test("nhóm nhạy cảm hơn thì không được rộng hơn", () => {
    const superset = (big, small) => small.every((r) => big.includes(r));
    expect(superset(roles.PRM_READ_ROLES, roles.PRM_MANAGE_ROLES)).toBe(true);
    expect(superset(roles.PRM_MANAGE_ROLES, roles.PRM_ADMIN_ROLES)).toBe(true);
  });

  test("không có vai trò lạ ngoài bảy vai trò của hệ thống", () => {
    const VALID = new Set([
      "SUPER_OMEGA_ULTRA_ADMIN", "SUPER_ADMIN", "ADMIN", "MANAGER",
      "ACCOUNTANT", "CASHIER", "WAREHOUSE",
    ]);
    for (const list of Object.values(roles)) {
      for (const r of list) expect(VALID.has(r)).toBe(true);
    }
  });
});

describe("route — dùng ma trận vai trò, không tự liệt kê role", () => {
  const read = (f) => fs.readFileSync(path.join(ROUTE_DIR, f), "utf8");

  /**
   * Bỏ phần CHÚ THÍCH trước khi so khớp.
   *
   * Các file này giải thích khá dài vì sao chia quyền thế nào, mà trong chú thích có
   * đủ cả hai từ `authenticate` và `requireModule`. Không bỏ comment thì khẳng định
   * "index.js không bọc middleware" sẽ đỏ chỉ vì có dòng giải thích nói tới nó.
   */
  const codeOnly = (src) =>
    src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");

  // `crm/roles.js` tồn tại vì lý do đúng như thế: 12 file tự liệt kê role thì không
  // kiểm tra được bằng mắt và chắc chắn lệch ở lần sửa kế tiếp (CRM audit M1 liệt
  // kê 4 trường hợp lệch). PRM phải tuân theo cùng nguyên tắc.
  const routeFiles = ["partner.routes.js", "referral.routes.js", "roi.routes.js"];

  test.each(routeFiles)("%s không tự liệt kê role dạng chuỗi", (file) => {
    const src = codeOnly(read(file));
    // Cho phép truyền qua biến `...TÊN_NHÓM_ROLES`; cấm viết thẳng danh sách role.
    const inlineRoles = src.match(/authorize\(\s*["']/g);
    expect(inlineRoles).toBeNull();
  });

  test.each(routeFiles)("%s bọc authenticate và requireModule", (file) => {
    const src = codeOnly(read(file));
    expect(src).toMatch(/authenticate/);
    expect(src).toMatch(/requireModule\("crm"\)/);
  });

  test("index.js chỉ gom routes, không bọc thêm middleware", () => {
    const src = codeOnly(read("index.js"));
    expect(src).not.toMatch(/authenticate/);
    expect(src).not.toMatch(/requireModule/);
    // Nhưng vẫn phải gom đủ ba nhóm.
    expect(src).toMatch(/partner\.routes/);
    expect(src).toMatch(/referral\.routes/);
    expect(src).toMatch(/roi\.routes/);
  });

  test("PRM dùng CHUNG khóa gói với CRM, không tạo khóa mới", () => {
    // Khóa gói mới sẽ khoá module với các tenant cũ đã mua gói `crm` mà không có
    // `partners` trong danh sách, và phải backfill cho toàn bộ tenant cũ.
    for (const file of routeFiles) {
      const src = codeOnly(read(file));
      expect(src).toMatch(/requireModule\("crm"\)/);
      expect(src).not.toMatch(/requireModule\("(partners|prm)"\)/);
    }
  });

  test("bảng PRM có trong TENANT_SCOPED_MODELS", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "src", "config", "prisma.js"), "utf8");
    expect(src).toMatch(/"Partner"/);
    expect(src).toMatch(/"PartnerReferral"/);
  });

  test("mọi model có tenantId đều phải có trong TENANT_SCOPED_MODELS", () => {
    // Đây là hợp đồng mà `tenant-scoped-models.contract.test.js` kiểm; khẳng định
    // lại ở đây để lỗi đật vào PRM bị bắt ngay trong bộ test của chính phân hệ.
    const schema = fs.readFileSync(path.join(__dirname, "..", "prisma", "schema.prisma"), "utf8");
    const models = [...schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)];
    const withTenant = models
      .filter(([, , body]) => /^\s*tenantId\s+\w+/m.test(body))
      .map(([, name]) => name);

    const prismaSrc = fs.readFileSync(path.join(__dirname, "..", "src", "config", "prisma.js"), "utf8");
    const scoped = new Set([...prismaSrc.matchAll(/"([A-Z]\w+)"/g)].map((m) => m[1]));

    const missing = withTenant.filter((m) => !scoped.has(m));
    expect(missing).toEqual([]);
    expect(withTenant.length).toBeGreaterThan(100);
  });
});

describe("báo cáo — không đưa PII vào whitelist", () => {
  test("bảng PRM trong report-builder KHÔNG chứa SĐT/email người được giới thiệu", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "..", "src", "modules", "report-builder", "report-builder.service.js"),
      "utf8",
    );
    const block = src.slice(src.indexOf("partner_referrals: {"));
    const end = block.indexOf("},");
    const fields = block.slice(0, end);
    // Báo cáo xuất ra CSV/Excel cho người dùng cuối; đưa SĐT người được giới thiệu
    // vào đó là mở rộng rủi ro dữ liệu cá nhân không cần thiết để tính ROI.
    expect(fields).not.toMatch(/referredPhone/);
    expect(fields).not.toMatch(/referredEmail/);
    expect(fields).not.toMatch(/referredName/);
  });

  test("hai báo cáo PRM chỉ dùng bảng đã có trong whitelist", () => {
    const seed = require("../src/modules/report-builder/default-reports.seed");
    const r11 = seed.DEFAULT_REPORTS.find((r) => r.code === "R-11");
    const r12 = seed.DEFAULT_REPORTS.find((r) => r.code === "R-12");
    expect(r11.config.table).toBe("partner_referrals");
    expect(r12.config.table).toBe("partner_referrals");
  });
});