/**
 * tests/agent-chat.route.test.js — E2E route-level POST /api/agent/chat (không cần DB thật)
 *
 * Dùng Express thật + fetch tới server ephemeral, mock authenticate (inject req.user)
 * và mock Prisma. Mục tiêu:
 * - fast-path intent read → reply từ TOOL_HANDLERS
 * - sensitive tool + role thấp → DATA_REQUEST + human-gate PENDING
 * - write intent: chỉ ADMIN/MANAGER, và phải được match TRƯỚC read intent
 * - 5 intents CRM/SRM mới chạy qua route thật
 */
const express = require("express");

jest.mock("../src/config/prisma", () => {
  const mockPrisma = {};
  mockPrisma.agentSession = {
    create: jest.fn().mockResolvedValue({ id: "sess-1" }),
    update: jest.fn().mockResolvedValue({}),
    findUnique: jest.fn(),
    count: jest.fn(),
  };
  mockPrisma.agentStep = { create: jest.fn().mockResolvedValue({}), aggregate: jest.fn() };
  mockPrisma.agentFeedback = { create: jest.fn(), groupBy: jest.fn() };
  mockPrisma.agentHumanGate = { create: jest.fn().mockResolvedValue({}), findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() };
  mockPrisma.order = { count: jest.fn(), aggregate: jest.fn(), findMany: jest.fn(), findFirst: jest.fn() };
  mockPrisma.customer = { count: jest.fn(), findMany: jest.fn(), findFirst: jest.fn() };
  mockPrisma.user = { findMany: jest.fn() };
  mockPrisma.inventory = { findMany: jest.fn() };
  mockPrisma.churnAlert = { findMany: jest.fn() };
  mockPrisma.product = { findFirst: jest.fn(), findMany: jest.fn(), findUnique: jest.fn() };
  mockPrisma.goodsReceiptNote = { findMany: jest.fn().mockResolvedValue([]) };
  return mockPrisma;
});

// req.user được điều khiển qua biến này để test các role khác nhau
let mockCurrentUser = { id: "u-admin", role: "ADMIN" };
jest.mock("../src/middleware/auth.middleware", () => ({
  authenticate: (req, res, next) => { req.user = mockCurrentUser; next(); },
  authorize: () => (req, res, next) => next(),
  requireSuperOmega: (req, res, next) => next(),
}));
jest.mock("../src/utils/logger", () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), truncateLog: (v) => String(v),
}));
jest.mock("../src/modules/orders/order.service", () => ({
  create: jest.fn().mockResolvedValue({
    id: "order1", orderCode: "ORD-20260625-0001", total: 500000,
    items: [{ productId: "p1", product: { name: "Áo Polo" } }],
  }),
}));

const prisma = require("../src/config/prisma");
const agentRoutes = require("../src/modules/ai/agent.routes");

let server;
let baseUrl;

beforeAll((done) => {
  const app = express();
  app.use(express.json());
  app.use("/api/agent", agentRoutes);
  // Mimic error.middleware: err.status/err.statusCode → status code
  app.use((err, req, res, next) => {
    res.status(err?.status || err?.statusCode || 500).json({ success: false, message: err?.message || "Lỗi" });
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
  mockCurrentUser = { id: "u-admin", role: "ADMIN" };
  prisma.agentSession.create.mockResolvedValue({ id: "sess-1" });
});

const chat = async (content, user) => {
  if (user) mockCurrentUser = user;
  const res = await fetch(`${baseUrl}/api/agent/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content }] }),
  });
  return { status: res.status, body: await res.json() };
};

describe("POST /api/agent/chat — E2E route", () => {
  test("400 khi thiếu messages", async () => {
    const res = await fetch(`${baseUrl}/api/agent/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400); // throw { status: 400 } → error handler
  });

  test("fast-path doanh thu → reply từ tool + lưu step path fast_path", async () => {
    prisma.order.aggregate.mockResolvedValue({ _sum: { total: 12000000 }, _count: { id: 12 } });
    const { status, body } = await chat("doanh thu tháng này");
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.response).toContain("Doanh thu");
    expect(prisma.agentStep.create.mock.calls[0][0].data.path).toBe("fast_path");
    expect(prisma.agentSession.update).toHaveBeenCalled();
  });

  test("ADMIN + customerLookup → reply danh sách khách hàng", async () => {
    prisma.customer.findMany.mockResolvedValue([
      { name: "Nguyễn Văn A", phone: "0901234567", email: "a@x.vn", totalSpent: 5000000, totalDebt: 0 },
    ]);
    const { status, body } = await chat("khách hàng Nguyễn Văn A");
    expect(status).toBe(200);
    expect(body.data.response).toContain("Nguyễn Văn A");
    expect(prisma.agentHumanGate.create).not.toHaveBeenCalled();
  });

  test("CASHIER + tool nhạy cảm → tạo DATA_REQUEST chờ phê duyệt", async () => {
    const { status, body } = await chat("khách hàng Nguyễn Văn A", { id: "u-cashier", role: "CASHIER" });
    expect(status).toBe(200);
    expect(body.data.response).toContain("phê duyệt");
    expect(prisma.agentHumanGate.create).toHaveBeenCalledTimes(1);
    expect(prisma.agentHumanGate.create.mock.calls[0][0].data.actionType).toBe("DATA_REQUEST");
    expect(prisma.customer.findMany).not.toHaveBeenCalled();
  });

  test("CASHIER + write intent → từ chối quyền (không mutate)", async () => {
    const { status, body } = await chat("tạo đơn hàng cho khách A 2 cái", { id: "u-cashier", role: "CASHIER" });
    expect(status).toBe(200);
    expect(body.data.response).toContain("không có quyền");
  });

  test("Write intent được match TRƯỚC read intent 'đơn hàng' (ADMIN)", async () => {
    prisma.customer.findFirst.mockResolvedValue({ id: "c1", name: "A", isActive: true });
    prisma.product.findFirst.mockResolvedValue({ id: "p1", name: "Áo Polo", sku: "AP001", price: 200000, isActive: true });
    const { status, body } = await chat("tạo đơn hàng cho khách A 2 cái áo polo");
    expect(status).toBe(200);
    expect(body.data.response).toContain("ORD-20260625-0001");
    // fast-path write: toolName = createOrder
    expect(prisma.agentStep.create.mock.calls[0][0].data.toolName).toBe("createOrder");
  });

  test("intent CRM mới — churn alerts chạy qua route thật", async () => {
    prisma.churnAlert.findMany.mockResolvedValue([
      { riskLevel: "HIGH", churnScore: 0.9, status: "TRIGGERED",
        customer: { id: "c1", name: "Trần Thị B", phone: "0902", churnProbability: 0.9, rfmSegment: "At-Risk" } },
    ]);
    const { status, body } = await chat("cảnh báo churn khách hàng");
    expect(status).toBe(200);
    expect(body.data.response).toContain("Trần Thị B");
  });

  test("intent CRM mới — leads (PII) bị gate với role thấp", async () => {
    prisma.churnAlert.findMany.mockResolvedValue([]);
    const { status, body } = await chat("danh sách lead mới", { id: "u-cashier", role: "CASHIER" });
    expect(status).toBe(200);
    expect(body.data.response).toContain("phê duyệt");
    expect(prisma.agentHumanGate.create).toHaveBeenCalled();
  });

  test("intent CRM mới — RFM/CLV với ADMIN trả phân khúc", async () => {
    prisma.customer.findMany.mockResolvedValue([
      { name: "Lê Văn C", rfmSegment: "Champions", rfmRecencyDays: 5, rfmFrequency: 12,
        clvPredicted: 25000000, churnProbability: 0.05 },
    ]);
    const { status, body } = await chat("phân khúc khách hàng theo RFM");
    expect(status).toBe(200);
    expect(body.data.response).toContain("Champions");
  });

  test("intent CRM mới — GRN (không PII) chạy với mọi role", async () => {
    prisma.goodsReceiptNote.findMany.mockResolvedValue([
      { grnCode: "GRN-20260623-0001", status: "POSTED", receivedAt: new Date("2026-06-23"),
        purchaseOrder: { poCode: "PO-1", vendor: { name: "NCC Hà Nội" } } },
    ]);
    const { status, body } = await chat("phiếu nhập kho hôm nay", { id: "u-wh", role: "WAREHOUSE" });
    expect(status).toBe(200);
    expect(body.data.response).toContain("GRN-20260623-0001");
  });
});

