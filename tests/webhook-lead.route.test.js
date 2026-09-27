/**
 * tests/webhook-lead.route.test.js — E2E route-level POST /api/webhook/crm-lead
 *
 * Express thật + fetch (không cần DB): mock lead-capture.service để kiểm tra
 * hợp đồng HTTP của webhook public:
 * - 401 khi thiếu/sai X-Tenant-Key
 * - 400 khi payload sai schema (ZodError)
 * - 201 khi ghi nhận lead mới
 * - 200 + duplicate khi Idempotency-Key trùng (retry an toàn)
 * - header Idempotency-Key được truyền xuống service
 */
const express = require("express");

jest.mock("../src/modules/crm/lead-capture.service", () => ({
  resolveTenant: jest.fn(),
  captureLead: jest.fn(),
  generateApiKey: jest.fn(),
  listApiKey: jest.fn(),
}));
jest.mock("../src/middleware/auth.middleware", () => ({
  authenticate: (req, res, next) => next(),
  authorize: () => (req, res, next) => next(),
}));
jest.mock("../src/utils/logger", () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const service = require("../src/modules/crm/lead-capture.service");
const router = require("../src/modules/crm/webhook-lead.routes");

let server;
let baseUrl;

beforeAll((done) => {
  const app = express();
  app.use(express.json());
  app.use("/api/webhook", router);
  // Mimic error.middleware: ZodError → 400, err.status → status
  app.use((err, req, res, next) => {
    if (err?.name === "ZodError") return res.status(400).json({ success: false, message: "Dữ liệu không hợp lệ" });
    res.status(err?.status || 500).json({ success: false, message: err?.message || "Lỗi" });
  });
  server = app.listen(0, () => {
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    done();
  });
});

afterAll(async () => {
  await new Promise((resolve) => server.close(() => resolve()));
});

beforeEach(() => jest.clearAllMocks());

const postLead = (body, headers = {}) =>
  fetch(`${baseUrl}/api/webhook/crm-lead`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

const VALID = { source: "Affiliate_Partner_01", fullName: "Nguyễn Văn A", phone: "0901234567" };

describe("POST /api/webhook/crm-lead — E2E route", () => {
  test("401 khi thiếu X-Tenant-Key", async () => {
    service.resolveTenant.mockResolvedValue(null);
    const res = await postLead(VALID);
    expect(res.status).toBe(401);
    expect(service.captureLead).not.toHaveBeenCalled();
  });

  test("401 khi X-Tenant-Key sai", async () => {
    service.resolveTenant.mockResolvedValue(null);
    const res = await postLead(VALID, { "X-Tenant-Key": "bad-key" });
    expect(res.status).toBe(401);
    expect(service.resolveTenant).toHaveBeenCalledWith("bad-key");
  });

  test("400 khi payload sai schema (thiếu phone)", async () => {
    service.resolveTenant.mockResolvedValue("tenant-1");
    const res = await postLead({ source: "Facebook", fullName: "A" }, { "X-Tenant-Key": "k" });
    expect(res.status).toBe(400);
    expect(service.captureLead).not.toHaveBeenCalled();
  });

  test("201 + truyền idempotencyKey=null khi không có header", async () => {
    service.resolveTenant.mockResolvedValue("tenant-1");
    service.captureLead.mockResolvedValue({ customerId: "cus-1", isNew: true, assignedToId: "staff-1" });

    const res = await postLead(VALID, { "X-Tenant-Key": "k" });
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.data.customerId).toBe("cus-1");
    expect(service.captureLead).toHaveBeenCalledWith("tenant-1", expect.objectContaining({ phone: "0901234567" }), null);
  });

  test("header Idempotency-Key được truyền xuống service", async () => {
    service.resolveTenant.mockResolvedValue("tenant-1");
    service.captureLead.mockResolvedValue({ customerId: "cus-1", isNew: true, assignedToId: "staff-1" });

    const res = await postLead(VALID, { "X-Tenant-Key": "k", "Idempotency-Key": "wh-evt-0001" });

    expect(res.status).toBe(201);
    expect(service.captureLead).toHaveBeenCalledWith("tenant-1", expect.any(Object), "wh-evt-0001");
  });

  test("retry cùng Idempotency-Key → 200 duplicate, không tạo record mới", async () => {
    service.resolveTenant.mockResolvedValue("tenant-1");
    service.captureLead.mockResolvedValue({ customerId: "cus-1", isNew: true, assignedToId: "staff-1", duplicate: true });

    const res = await postLead(VALID, { "X-Tenant-Key": "k", "Idempotency-Key": "wh-evt-0001" });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.duplicate).toBe(true);
  });
});
