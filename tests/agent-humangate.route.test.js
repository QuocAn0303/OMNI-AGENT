/**
 * tests/agent-humangate.route.test.js — HTTP-layer cho luồng phê duyệt human-gate
 *
 * tests/agent-humangate.contract.test.js đã chắc payload khớp schema Prisma.
 * File này chắc phần còn lại mà UI phụ thuộc:
 *   GET  /api/agent/human-gates              → chỉ trả gate PENDING
 *   POST /api/agent/human-gates/:id/decide   → decide bằng decidedById/decidedAt/decisionNote,
 *                                              đóng AgentSession, và KHÔNG trả success giả
 *                                              khi thao tác DB thất bại (bug cũ: .catch(() => {}))
 *
 * Dùng Express thật + fetch tới server ephemeral; mock Prisma + authenticate
 * (giống tests/agent-chat.route.test.js) nên không cần DB.
 */
const express = require("express");

let mockCurrentUser = { id: "u-admin", role: "ADMIN" };

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
  mockPrisma.agentHumanGate = {
    create: jest.fn().mockResolvedValue({ id: "gate-1" }),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  };
  mockPrisma.order = { count: jest.fn(), aggregate: jest.fn(), findMany: jest.fn(), findFirst: jest.fn() };
  mockPrisma.customer = { count: jest.fn(), findMany: jest.fn(), findFirst: jest.fn() };
  mockPrisma.user = { findMany: jest.fn() };
  mockPrisma.inventory = { findMany: jest.fn() };
  mockPrisma.churnAlert = { findMany: jest.fn() };
  mockPrisma.product = { findFirst: jest.fn(), findMany: jest.fn(), findUnique: jest.fn() };
  mockPrisma.goodsReceiptNote = { findMany: jest.fn().mockResolvedValue([]) };
  return mockPrisma;
});

jest.mock("../src/middleware/auth.middleware", () => ({
  authenticate: (req, res, next) => { req.user = mockCurrentUser; next(); },
  authorize: () => (req, res, next) => next(),
  requireSuperOmega: (req, res, next) => next(),
}));
jest.mock("../src/utils/logger", () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), truncateLog: (v) => String(v),
}));
jest.mock("../src/modules/orders/order.service", () => ({ create: jest.fn() }));

const prisma = require("../src/config/prisma");
const logger = require("../src/utils/logger");
const agentRoutes = require("../src/modules/ai/agent.routes");

let server;
let baseUrl;

beforeAll((done) => {
  const app = express();
  app.use(express.json());
  app.use("/api/agent", agentRoutes);
  // Mimic src/middleware/error.middleware.js: err.status/err.statusCode → status code
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

const FUTURE = new Date(Date.now() + 24 * 3600 * 1000).toISOString();

const pendingGate = (over = {}) => ({
  id: "gate-1",
  sessionId: "sess-1",
  actionType: "DATA_REQUEST",
  actionSummary: 'AI Agent xin doc du lieu nhay cam qua tool "search_customers" (role: CASHIER)',
  status: "PENDING",
  expiresAt: FUTURE,
  decidedAt: null,
  decidedById: null,
  decisionNote: null,
  ...over,
});

const decide = async (id = "gate-1", body = { decision: "APPROVED", note: "duyet" }) => {
  const res = await fetch(`${baseUrl}/api/agent/human-gates/${id}/decide`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentUser = { id: "u-admin", role: "ADMIN" };
  prisma.agentSession.update.mockResolvedValue({});
  prisma.agentHumanGate.update.mockResolvedValue(pendingGate({ status: "APPROVED" }));
});

describe("GET /api/agent/human-gates", () => {
  it("chỉ lấy gate PENDING (gate EXPIRED/APPROVED không được hiển thị)", async () => {
    prisma.agentHumanGate.findMany.mockResolvedValue([pendingGate()]);
    const res = await fetch(`${baseUrl}/api/agent/human-gates`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(prisma.agentHumanGate.findMany.mock.calls[0][0].where).toEqual({ status: "PENDING" });
  });

  it("gate trả về phải có actionSummary để UI hiển thị (không phải dòng rỗng)", async () => {
    prisma.agentHumanGate.findMany.mockResolvedValue([pendingGate()]);
    const res = await fetch(`${baseUrl}/api/agent/human-gates`);
    const body = await res.json();

    expect(typeof body.data[0].actionSummary).toBe("string");
    expect(body.data[0].actionSummary.length).toBeGreaterThan(0);
  });

  it("500 khi DB lỗi — không trả danh sách rỗng giả thành công", async () => {
    prisma.agentHumanGate.findMany.mockRejectedValue(new Error("db down"));
    const res = await fetch(`${baseUrl}/api/agent/human-gates`);
    expect(res.status).toBe(500);
  });
});


describe("POST /api/agent/human-gates/:id/decide", () => {
  it("APPROVED ghi đúng tên field của schema + đóng AgentSession", async () => {
    prisma.agentHumanGate.findUnique.mockResolvedValue(pendingGate());
    const { status, body } = await decide();

    expect(status).toBe(200);
    expect(body.success).toBe(true);

    const data = prisma.agentHumanGate.update.mock.calls[0][0].data;
    expect(data.status).toBe("APPROVED");
    expect(data.decidedById).toBe("u-admin");
    expect(data.decidedAt).toBeInstanceOf(Date);
    expect(data.decisionNote).toBe("duyet");
    // bug cũ: dùng resolvedAt/resolvedBy → PrismaClientValidationError ngay ở client
    expect(Object.keys(data)).not.toContain("resolvedAt");
    expect(Object.keys(data)).not.toContain("resolvedBy");
    expect(Object.keys(data)).not.toContain("resolvedNote");

    expect(prisma.agentSession.update).toHaveBeenCalledTimes(1);
    expect(prisma.agentSession.update.mock.calls[0][0].data.status).toBe("COMPLETED");
  });

  it("REJECTED không đóng session, không tự nhận đã duyệt", async () => {
    prisma.agentHumanGate.findUnique.mockResolvedValue(pendingGate());
    prisma.agentHumanGate.update.mockResolvedValue(pendingGate({ status: "REJECTED" }));
    const { status } = await decide("gate-1", { decision: "REJECTED", note: "khong duoc" });

    expect(status).toBe(200);
    expect(prisma.agentHumanGate.update.mock.calls[0][0].data.status).toBe("REJECTED");
    expect(prisma.agentSession.update).not.toHaveBeenCalled();
  });

  it("400 khi decision không hợp lệ (không chạm DB)", async () => {
    const { status, body } = await decide("gate-1", { decision: "MAYBE" });
    expect(status).toBe(400);
    expect(body.message).toMatch(/APPROVED or REJECTED/);
    expect(prisma.agentHumanGate.findUnique).not.toHaveBeenCalled();
  });

  it("404 khi gate không tồn tại", async () => {
    prisma.agentHumanGate.findUnique.mockResolvedValue(null);
    const { status } = await decide("gate-missing");
    expect(status).toBe(404);
  });

  it("400 khi gate đã được quyết định trước đó (chống double-decide)", async () => {
    prisma.agentHumanGate.findUnique.mockResolvedValue(pendingGate({ status: "APPROVED" }));
    const { status, body } = await decide();
    expect(status).toBe(400);
    expect(body.message).toMatch(/already APPROVED/);
    expect(prisma.agentHumanGate.update).not.toHaveBeenCalled();
  });

  it("400 khi gate PENDING nhưng quá hạn (trạng thái cron sweep sửa)", async () => {
    prisma.agentHumanGate.findUnique.mockResolvedValue(
      pendingGate({ expiresAt: new Date(Date.now() - 60_000).toISOString() }),
    );
    const { status, body } = await decide();
    expect(status).toBe(400);
    expect(body.message).toMatch(/expired/i);
    expect(prisma.agentHumanGate.update).not.toHaveBeenCalled();
  });

  it("REGRESSION: gate update lỗi → 500, không phải 200 'Đã phê duyệt' giả", async () => {
    prisma.agentHumanGate.findUnique.mockResolvedValue(pendingGate());
    prisma.agentHumanGate.update.mockRejectedValue(new Error("actionSummary cannot be null"));

    const { status, body } = await decide();
    expect(status).toBe(500);
    expect(body.success).toBe(false);
    expect(prisma.agentSession.update).not.toHaveBeenCalled();
  });

  it("gate đã lưu nhưng đóng session fail → vẫn 200 và PHẢI log có gate id (bug cũ: nuốt lỗi)", async () => {
    prisma.agentHumanGate.findUnique.mockResolvedValue(pendingGate());
    prisma.agentSession.update.mockRejectedValue(new Error("session row missing"));

    const { status } = await decide("gate-1");
    expect(status).toBe(200);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("gate-1"));
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("sess-1"));
  });
});

