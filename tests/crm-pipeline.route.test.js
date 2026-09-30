/**
 * tests/crm-pipeline.route.test.js — HTTP-layer của CRM Sales Pipeline
 *
 * Unit test service (crm-leads / crm-deals / crm-convert) đã chắc nghiệp vụ.
 * File này chắc hợp đồng HTTP mà frontend Phase 3 sẽ dựa vào:
 *   - Hợp đồng response `{ success, data, pagination }` chuẩn của utils/response
 *   - ZodError → 400 với danh sách lỗi field
 *   - ApiError 404/409/403 từ service được trả nguyên status
 *   - `requireModule("crm")` và `authorize` thực sự chạy (không bị bypass)
 *   - PII masking: CASHIER không nhận được SĐT/email gốc của lead
 *
 * Dùng Express thật + fetch tới server ephemeral; mock Prisma + authenticate
 * (giống tests/agent-humangate.route.test.js) nên không cần DB.
 */
const express = require("express");

let mockCurrentUser = { id: "u-cashier", role: "CASHIER" };

jest.mock("../src/config/prisma", () => ({
  crmLead: { findMany: jest.fn(), findUnique: jest.fn(), count: jest.fn(), update: jest.fn(), create: jest.fn() },
  crmDeal: { findMany: jest.fn(), findUnique: jest.fn(), count: jest.fn(), update: jest.fn(), updateMany: jest.fn(), delete: jest.fn() },
  crmOrganization: { findMany: jest.fn(), findUnique: jest.fn(), count: jest.fn(), create: jest.fn(), update: jest.fn() },
  crmContact: { findMany: jest.fn(), findUnique: jest.fn(), count: jest.fn(), create: jest.fn(), update: jest.fn() },
  crmPipelineStage: { findMany: jest.fn(), findUnique: jest.fn(), createMany: jest.fn(), create: jest.fn(), update: jest.fn() },
  crmCommunication: { findMany: jest.fn(), count: jest.fn(), create: jest.fn(), deleteMany: jest.fn() },
  crmDealItem: { deleteMany: jest.fn(), createMany: jest.fn() },
  product: { findMany: jest.fn() },
  customer: { findFirst: jest.fn(), create: jest.fn() },
  $transaction: jest.fn(),
}));

jest.mock("../src/config/tenantContext", () => ({
  getTenantId: () => "tenant-1",
  isBypassTenant: () => false,
  runWithTenant: (_t, fn) => fn(),
}));

jest.mock("../src/middleware/auth.middleware", () => ({
  authenticate: (req, res, next) => { req.user = mockCurrentUser; next(); },
  authorize: (...roles) => (req, res, next) => (
    !req.user || !roles.includes(req.user.role)
      ? next({ status: 403, message: "Bạn không có quyền thực hiện hành động này" })
      : next()
  ),
  requireSuperOmega: (req, res, next) => next(),
}));

// Ghi lại key đã requireModule — requireModule chạy LÚC LOAD ROUTER nên không
// dùng jest.fn() (beforeEach clearAllMocks sẽ xoá lịch sử). Mảng tên mock* được
// phép tham chiếu trong factory.
const mockRequiredModules = [];
jest.mock("../src/middleware/plan.middleware", () => ({
  requireModule: (key) => {
    mockRequiredModules.push(key);
    return (req, res, next) => next();
  },
  checkFeature: () => (req, res, next) => next(),
}));

jest.mock("../src/modules/audit/audit.service", () => ({ log: jest.fn() }));
jest.mock("../src/modules/notifications/notification.service", () => ({ createOne: jest.fn().mockResolvedValue({}) }));
jest.mock("../src/modules/orders/order.service", () => ({ create: jest.fn() }));

const prisma = require("../src/config/prisma");
const crmRouter = require("../src/modules/crm");

let server;
let baseUrl;

beforeAll((done) => {
  const app = express();
  app.use(express.json());
  app.use("/api/crm", crmRouter);
  // Mimic error.middleware: ApiError / object error / ZodError
  app.use((err, req, res, next) => {
    if (err?.name === "ZodError") {
      return res.status(400).json({
        success: false,
        message: "Dữ liệu không hợp lệ",
        errors: err.errors.map((e) => ({ field: e.path.join("."), message: e.message })),
      });
    }
    return res.status(err?.status || 500).json({ success: false, message: err?.message || "Lỗi" });
  });
  server = app.listen(0, () => {
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    done();
  });
});

afterAll(async () => {
  await new Promise((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentUser = { id: "u-cashier", role: "CASHIER" };
  prisma.crmLead.count.mockResolvedValue(0);
  prisma.crmLead.findMany.mockResolvedValue([]);
  prisma.crmDeal.count.mockResolvedValue(0);
  prisma.crmDeal.findMany.mockResolvedValue([]);
  prisma.crmPipelineStage.findMany.mockResolvedValue([]);
  prisma.crmPipelineStage.createMany.mockResolvedValue({ count: 0 });
  prisma.user = { findMany: jest.fn().mockResolvedValue([]) };
});

const api = (path, opts = {}) =>
  fetch(`${baseUrl}/api/crm${path}`, {
    method: opts.method || "GET",
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
  });

describe("GET /api/crm/leads — hợp đồng response + phân quyền", () => {
  test("200 + { success, data, pagination }", async () => {
    prisma.crmLead.findMany.mockResolvedValue([{ id: "lead-1", leadName: "A", mobileNo: "0901234567" }]);
    prisma.crmLead.count.mockResolvedValue(1);

    const res = await api("/leads");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(body.pagination).toMatchObject({ page: 1, limit: 20, total: 1, totalPages: 1 });
  });

  test("CASHIER bị ép scope theo owner ở tầng query", async () => {
    await api("/leads");
    expect(prisma.crmLead.findMany.mock.calls[0][0].where.leadOwnerId).toBe("u-cashier");
  });

  test("PII masking: CASHIER không nhận SĐT gốc", async () => {
    prisma.crmLead.findMany.mockResolvedValue([{ id: "lead-1", leadName: "A", mobileNo: "0901234567", email: "a@example.com" }]);
    const body = await (await api("/leads")).json();
    expect(body.data[0].mobileNo).not.toBe("0901234567");
    expect(body.data[0].email).not.toBe("a@example.com");
  });

  test("MANAGER nhận PII gốc", async () => {
    mockCurrentUser = { id: "u-manager", role: "MANAGER" };
    prisma.crmLead.findMany.mockResolvedValue([{ id: "lead-1", mobileNo: "0901234567" }]);
    const body = await (await api("/leads")).json();
    expect(body.data[0].mobileNo).toBe("0901234567");
  });

  test("mọi route pipeline đều gắn requireModule('crm')", () => {
    // 6 sub-router mới của Sales Pipeline đều phải khai báo module "crm"
    expect(mockRequiredModules.filter((k) => k === "crm").length).toBeGreaterThanOrEqual(6);
  });
});

describe("POST /api/crm/leads — validate + create", () => {
  test("201 khi payload hợp lệ", async () => {
    prisma.crmLead.create = jest.fn().mockResolvedValue({ id: "lead-new", leadName: "A" });
    const res = await api("/leads", { method: "POST", body: { leadName: "Nguyễn Văn A", mobileNo: "0901234567" } });
    expect(res.status).toBe(201);
    expect((await res.json()).success).toBe(true);
  });

  test("400 + errors[] khi thiếu leadName", async () => {
    const res = await api("/leads", { method: "POST", body: { mobileNo: "0901234567" } });
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.errors.some((e) => e.field === "leadName")).toBe(true);
  });

  test("400 khi email sai định dạng", async () => {
    const res = await api("/leads", { method: "POST", body: { leadName: "A", email: "khong-phai-email" } });
    expect(res.status).toBe(400);
  });

  test("400 khi stageId không phải uuid", async () => {
    const res = await api("/leads", { method: "POST", body: { leadName: "A", stageId: "abc" } });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/crm/leads/:id — 404/403 từ service", () => {
  test("404 khi lead không tồn tại", async () => {
    prisma.crmLead.findUnique.mockResolvedValue(null);
    const res = await api("/leads/11111111-1111-1111-1111-111111111111");
    expect(res.status).toBe(404);
    expect((await res.json()).success).toBe(false);
  });

  test("403 khi CASHIER mở lead của người khác", async () => {
    prisma.crmLead.findUnique.mockResolvedValue({ id: "l1", leadName: "A", leadOwnerId: "u-other" });
    const res = await api("/leads/11111111-1111-1111-1111-111111111111");
    expect(res.status).toBe(403);
  });
});

describe("PATCH /api/crm/deals/:id/stage — validate enum", () => {
  const dealId = "22222222-2222-2222-2222-222222222222";

  test("400 khi stageId null thiếu (bắt buộc có stageId)", async () => {
    const res = await api(`/deals/${dealId}/stage`, { method: "PATCH", body: { } });
    expect(res.status).toBe(400);
  });

  test("409 khi deal đã tạo đơn hàng", async () => {
    prisma.crmDeal.findUnique.mockResolvedValue({ id: dealId, dealName: "X", orderId: "o1", dealOwnerId: "u-cashier" });
    const res = await api(`/deals/${dealId}/stage`, {
      method: "PATCH",
      body: { stageId: "33333333-3333-3333-3333-333333333333" },
    });
    expect(res.status).toBe(409);
  });

  test("200 khi đổi stage hợp lệ", async () => {
    prisma.crmDeal.findUnique.mockResolvedValue({ id: dealId, dealName: "X", orderId: null, dealOwnerId: "u-cashier", kind: "ONGOING", closedAt: null, lostReason: null, stage: { label: "Mới" } });
    prisma.crmPipelineStage.findUnique.mockResolvedValue({ id: "s1", entityType: "DEAL", label: "Đàm phán", kind: "ONGOING", probability: 75 });
    prisma.crmDeal.update.mockResolvedValue({ id: dealId, kind: "ONGOING", probability: 75 });

    const res = await api(`/deals/${dealId}/stage`, {
      method: "PATCH",
      body: { stageId: "33333333-3333-3333-3333-333333333333" },
    });
    expect(res.status).toBe(200);
  });
});

describe("Phân quyền theo role (authorize)", () => {
  test("CASHIER không được sửa cấu hình stage", async () => {
    const res = await api("/stages", {
      method: "POST",
      body: { entityType: "DEAL", label: "Test" },
    });
    expect(res.status).toBe(403);
  });

  test("MANAGER được sửa cấu hình stage", async () => {
    mockCurrentUser = { id: "u-manager", role: "MANAGER" };
    prisma.crmPipelineStage.create = jest.fn().mockResolvedValue({ id: "s-new" });
    const res = await api("/stages", { method: "POST", body: { entityType: "DEAL", label: "Test" } });
    expect(res.status).toBe(201);
  });

  test("role ngoài danh sách (ACCOUNTANT) bị chặn ở tầng router", async () => {
    mockCurrentUser = { id: "u-acc", role: "ACCOUNTANT" };
    const res = await api("/leads");
    expect(res.status).toBe(403);
  });
});

describe("GET /api/crm/deals/board + /forecast", () => {
  test("board trả columns[] + summary", async () => {
    const res = await api("/deals/board");
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(Array.isArray(body.data.columns)).toBe(true);
    expect(body.data.summary).toHaveProperty("totalValue");
  });

  test("forecast trả summary có weightedValue", async () => {
    const res = await api("/deals/forecast?months=3");
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.summary).toHaveProperty("weightedValue");
    expect(body.data.summary).toHaveProperty("winRate");
  });
});

describe("GET /api/crm/stages — lazy-seed", () => {
  test("gọi createMany skipDuplicates trước khi trả danh sách", async () => {
    prisma.crmPipelineStage.findMany.mockResolvedValue([{ id: "s1", label: "Mới" }]);
    const res = await api("/stages?entityType=DEAL");
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(prisma.crmPipelineStage.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ skipDuplicates: true }),
    );
    expect(body.data.entityType).toBe("DEAL");
  });
});
