/**
 * tests/agent-gate-po.contract.test.js — P0-3: gate đề xuất PO CÓ hiệu lực
 *
 * Đây là test quan trọng nhất của Vòng 2. Trước P0-3, `buildWriteActionGate`
 * ghi status='APPROVED' CỨNG *sau khi* hành động đã xong — tức gate chỉ là audit,
 * không chặn được gì. Test #1 và #2 ở đây biến nó thành ràng buộc thật.
 *
 * Chạy Express thật + mock Prisma/purchase.service. Không cần DB.
 */
const express = require("express");

let mockCurrentUser = { id: "u-admin", role: "ADMIN" };

// ── Mock prisma ────────────────────────────────────────────────────────
const mockAgentHumanGate = {
  findFirst: jest.fn(),
  findUnique: jest.fn(),
  updateMany: jest.fn(),
  update: jest.fn(),
  create: jest.fn(),
};
const mockAgentSession = { update: jest.fn() };
const mockPurchaseOrder = { findFirst: jest.fn() };
const mockOrderItem = { findMany: jest.fn() };
const mockPurchaseItem = { findMany: jest.fn() };
const mockVendor = { findFirst: jest.fn() };
const mockInventory = { findMany: jest.fn() };

jest.mock("../src/config/prisma", () => ({
  agentHumanGate: mockAgentHumanGate,
  agentSession: mockAgentSession,
  purchaseOrder: mockPurchaseOrder,
  orderItem: mockOrderItem,
  purchaseItem: mockPurchaseItem,
  vendor: mockVendor,
  inventory: mockInventory,
  product: {},
  user: {},
  order: {},
  customer: {},
  agentStep: {},
  agentFeedback: {},
  goodsReceiptNote: { findMany: jest.fn().mockResolvedValue([]) },
}));

jest.mock("../src/middleware/auth.middleware", () => {
  const actual = jest.requireActual("../src/middleware/auth.middleware");
  return {
    ...actual,
    authenticate: (req, res, next) => { req.user = mockCurrentUser; next(); },
  };
});

jest.mock("../src/utils/logger", () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
  truncateLog: (v) => String(v),
}));

const mockAuditLog = jest.fn().mockResolvedValue(undefined);
jest.mock("../src/modules/audit/audit.service", () => ({ log: (...a) => mockAuditLog(...a) }));

// purchase.service.create là hàm DUY NHẤT được phép tạo PO.
const mockPurchaseCreate = jest.fn();
jest.mock("../src/modules/accounting/purchase.service", () => ({
  create: (...a) => mockPurchaseCreate(...a),
}));
jest.mock("../src/modules/accounting/autopost.service", () => ({ autoPost: jest.fn() }));
jest.mock("../src/modules/accounting/posting-error.service", () => ({ record: jest.fn() }));
jest.mock("../src/modules/orders/order.service", () => ({ create: jest.fn() }));

const { PO_PROPOSAL } = require("../src/modules/ai/agent.humangate");
const gateExec = require("../src/modules/ai/agent.gate.exec");
const agentRoutes = require("../src/modules/ai/agent.routes");

const FUTURE = new Date(Date.now() + 3600_000).toISOString();

/**
 * Gate đề xuất PO hợp lệ.
 *
 * QUAN TRỌNG — fixture phải NHẤT QUÁN với `beforeEach`:
 *   Lịch sử 28 ngày × 3/ngày, σ = 0 ⇒ ROP = 3×7 + 0 = 21.
 *   S = ROP + demand×7 = 21 + 21 = 42.  ATP = 12 ⇒ orderQty = 42 − 12 = 30.
 * Nếu để `quantity: 42` trong khi `planReplenishment` tính ra 30 thì
 * `evaluateProposalFreshness` báo lệch 29% > QTY_DRIFT_TOL(25%) và chặn — đó là
 * hành vi ĐÚNG, chỉ là fixture sai. Đề xuất thật luôn do `planRepleninement`
 * sinh ra nên không bao giờ lệch ngay tại thời điểm tạo.
 */
const poGate = (over = {}) => ({
  id: "gate-po-1",
  actionType: PO_PROPOSAL,
  status: "PENDING",
  expiresAt: FUTURE,
  resultRef: null,
  sessionId: "sess-1",
  actionPayload: {
    kind: PO_PROPOSAL,
    proposalKey: "PROPOSAL:p1:v1",
    items: [{ productId: "p1", sku: "SKU-1", productName: "Nến", quantity: 30, unitCost: 45000 }],
    vendorId: "v1",
    vendorName: "NCC A",
    totalEstimate: 1350000,
    rationale: { atp: 12, rop: 21, demandPerDay: 3, leadTimeDays: 7, leadTimeEstimated: true },
  },
  session: { userId: "u-other", triggerSource: "SYSTEM_EVENT" },
  ...over,
});

/** ATP thấp hơn ROP ⇒ vẫn cần đặt. */
const inventoryLow = [{ quantity: 12, reserved: 0 }];

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentUser = { id: "u-admin", role: "ADMIN" };
  mockVendor.findFirst.mockResolvedValue({ id: "v1", isActive: true });
  mockInventory.findMany.mockResolvedValue(inventoryLow);
  // Lịch sử bán 28 ngày: 3/ngày ⇒ ROP ≈ 3×7 + SS = 21+ > ATP 12 ⇒ vẫn cần đặt.
  mockOrderItem.findMany.mockResolvedValue(
    Array.from({ length: 28 }, (_, i) => ({
      quantity: 3,
      order: { createdAt: new Date(Date.now() - i * 86400000) },
    })),
  );
  mockPurchaseItem.findMany.mockResolvedValue([]);
  mockPurchaseOrder.findFirst.mockResolvedValue(null); // chưa có PO nào từ gate
  mockPurchaseCreate.mockResolvedValue({ id: "po-1", poCode: "PO-20261002-0001", total: 1890000 });
  mockAgentHumanGate.updateMany.mockResolvedValue({ count: 1 });
  mockAgentHumanGate.update.mockImplementation(async () => ({}));
  mockAgentSession.update.mockResolvedValue({});
});

describe("P0-3 · revalidate — kiểm lại lúc duyệt", () => {
  test("gate không phải đề xuất PO bị từ chối", async () => {
    mockAgentHumanGate.findFirst.mockResolvedValue(
      poGate({ actionType: "DATA_REQUEST", status: "APPROVED" }),
    );
    await expect(gateExec.executeGate("g1", "u1")).rejects.toMatchObject({ status: 400 });
    expect(mockPurchaseCreate).not.toHaveBeenCalled();
  });

  test("gate chưa APPROVED → không execute, purchase.create 0 lần", async () => {
    mockAgentHumanGate.findFirst.mockResolvedValue(poGate({ status: "PENDING" }));
    await expect(gateExec.executeGate("g1", "u1")).rejects.toMatchObject({ status: 400 });
    expect(mockPurchaseCreate).not.toHaveBeenCalled();
  });

  test("gate APPROVED nhưng thiếu dòng hàng → 400, 0 lần create", async () => {
    mockAgentHumanGate.findFirst.mockResolvedValue(
      poGate({ status: "APPROVED", actionPayload: { items: [] } }),
    );
    await expect(gateExec.executeGate("g1", "u1")).rejects.toMatchObject({ status: 400 });
    expect(mockPurchaseCreate).not.toHaveBeenCalled();
  });

  test("thiếu vendorId → 400", async () => {
    const g = poGate({ status: "APPROVED" });
    delete g.actionPayload.vendorId;
    mockAgentHumanGate.findFirst.mockResolvedValue(g);
    await expect(gateExec.executeGate("g1", "u1")).rejects.toMatchObject({ status: 400 });
    expect(mockPurchaseCreate).not.toHaveBeenCalled();
  });

  test("NCC không còn tồn tại → 400, 0 lần create", async () => {
    mockAgentHumanGate.findFirst.mockResolvedValue(poGate({ status: "APPROVED" }));
    mockVendor.findFirst.mockResolvedValue(null);
    await expect(gateExec.executeGate("g1", "u1")).rejects.toMatchObject({ status: 400 });
    expect(mockPurchaseCreate).not.toHaveBeenCalled();
  });

  test("NCC đã vô hiệu hoá → 400, 0 lần create", async () => {
    mockAgentHumanGate.findFirst.mockResolvedValue(poGate({ status: "APPROVED" }));
    mockVendor.findFirst.mockResolvedValue({ id: "v1", isActive: false });
    await expect(gateExec.executeGate("g1", "u1")).rejects.toMatchObject({ status: 400 });
    expect(mockPurchaseCreate).not.toHaveBeenCalled();
  });
});

describe("P0-3 · NO_LONGER_NEEDED / DRIFT (mục 2.1)", () => {
  test("ATP mới > ROP → 409, KHÔNG override được kể cả khi acknowledgeDrift", async () => {
    mockAgentHumanGate.findFirst.mockResolvedValue(poGate({ status: "APPROVED" }));
    mockInventory.findMany.mockResolvedValue([{ quantity: 5000, reserved: 0 }]); // ATP >> ROP

    await expect(
      gateExec.executeGate("g1", "u1", { acknowledgeDrift: true }),
    ).rejects.toMatchObject({ status: 409, drift: "NO_LONGER_NEEDED" });
    expect(mockPurchaseCreate).not.toHaveBeenCalled();
  });

test("số lượng lệch quá ngưỡng → 409 kèm diff, chưa acknowledge thì không tạo PO", async () => {
    mockAgentHumanGate.findFirst.mockResolvedValue(poGate({ status: "APPROVED" }));
    // Giả lập dữ liệu đã đổi mạnh: nhu cầu tăng gấp đôi ⇒ orderQty tính lại lệch > 25%.
    mockOrderItem.findMany.mockResolvedValue(
      Array.from({ length: 28 }, (_, i) => ({
        quantity: 12, order: { createdAt: new Date(Date.now() - i * 86400000) },
      })),
    );

    await expect(gateExec.executeGate("g1", "u1")).rejects.toMatchObject({
      status: 409, drift: "DRIFT_BLOCK",
    });
    expect(mockPurchaseCreate).not.toHaveBeenCalled();
  });

  test("acknowledgeDrift cho phép chạy (đây KHÔNG phải override tự động)", async () => {
    mockAgentHumanGate.findFirst.mockResolvedValue(poGate({ status: "APPROVED" }));
    mockOrderItem.findMany.mockResolvedValue(
      Array.from({ length: 28 }, (_, i) => ({
        quantity: 12, order: { createdAt: new Date(Date.now() - i * 86400000) },
      })),
    );

    const res = await gateExec.executeGate("g1", "u1", { acknowledgeDrift: true });

    expect(res.po.id).toBe("po-1");
    expect(mockPurchaseCreate).toHaveBeenCalledTimes(1);
    // PO vẫn dùng số lượng trong payload mà người duyệt đã nhìn thấy.
    expect(mockPurchaseCreate.mock.calls[0][0].items[0].quantity).toBe(30);
  });
});

describe("P0-3 · chống tạo PO TRÙNG (điều kiện quan trọng nhất của A′)", () => {
  test("ghi mốc gate vào note để tra ngược được", async () => {
    expect(gateExec.GATE_MARKER("gate-1")).toBe("[gate:gate-1]");
    const note = gateExec.buildNote("gate-1", "ghi chú của tôi");
    expect(note).toContain("[gate:gate-1]");
    expect(note).toContain("ghi chú của tôi");
  });

  test("PO đã tồn tại (ghi resultRef lỗi) → LIÊN KẾT LẠI, không tạo PO thứ hai", async () => {
    const existingPo = { id: "po-OLD", poCode: "PO-20261002-0007", total: 1890000 };
    mockAgentHumanGate.findFirst.mockResolvedValue(poGate({ status: "APPROVED" }));
    mockPurchaseOrder.findFirst.mockResolvedValue(existingPo);

    const res = await gateExec.executeGate("g1", "u1");

    expect(res.linked).toBe(true);
    expect(res.po.id).toBe("po-OLD");
    expect(mockPurchaseCreate).not.toHaveBeenCalled(); // ← điểm mấu chốt
  });

  test("resultRef đã có và trỏ tới PO thật → không tạo thêm", async () => {
    mockAgentHumanGate.findFirst.mockResolvedValue(poGate({ status: "APPROVED", resultRef: "po-1" }));
    mockPurchaseOrder.findFirst.mockResolvedValue({ id: "po-1", poCode: "PO-1" });
    const res = await gateExec.executeGate("g1", "u1");
    expect(res.linked).toBe(true);
    expect(mockPurchaseCreate).not.toHaveBeenCalled();
  });

  test("mô phỏng lỗi SAU khi PO đã tạo: ghi resultRef hỏng → thử lại chỉ ra 1 PO", async () => {
    // Lần 1: PO tạo được nhưng ghi resultRef ném lỗi.
    mockAgentHumanGate.findFirst.mockResolvedValue(poGate({ status: "APPROVED" }));
    mockAgentHumanGate.update.mockRejectedValueOnce(new Error("connection reset khi ghi resultRef"));
    await expect(gateExec.executeGate("g1", "u1")).rejects.toThrow(/resultRef/);
    expect(mockPurchaseCreate).toHaveBeenCalledTimes(1);

    // Lần 2 (thử lại): tra theo mốc note tìm thấy PO cũ → KHÔNG tạo thêm.
    mockPurchaseCreate.mockClear();
    mockAgentHumanGate.update.mockResolvedValue({});
    mockPurchaseOrder.findFirst.mockResolvedValue({
      id: "po-1", poCode: "PO-20261002-0001", total: 1890000,
    });
    const res = await gateExec.executeGate("g1", "u1");

    expect(res.linked).toBe(true);
    expect(mockPurchaseCreate).not.toHaveBeenCalled();
    expect(mockPurchaseCreate).not.toHaveBeenCalled(); // vẫn 0 — không có PO thứ hai
  });
});

describe("P0-3 · purchase.create ném lỗi", () => {
  test("ghi audit AGENT_PO_GATE_EXECUTION_FAILED, không trả success giả", async () => {
    mockAgentHumanGate.findFirst.mockResolvedValue(poGate({ status: "APPROVED" }));
    mockPurchaseCreate.mockRejectedValue(new Error("Thiếu nhà cung cấp"));

    await expect(gateExec.executeGate("g1", "u1")).rejects.toThrow(/Thiếu nhà cung cấp/);

    const failed = mockAuditLog.mock.calls.filter((c) => c[0].action === "AGENT_PO_GATE_EXECUTION_FAILED");
    expect(failed).toHaveLength(1);
    expect(failed[0][0].entityId).toBe("g1");
  });

  test("không nuốt lỗi audit (quy ước AGENTS.md)", async () => {
    mockAgentHumanGate.findFirst.mockResolvedValue(poGate({ status: "APPROVED" }));
    mockPurchaseCreate.mockRejectedValue(new Error("lỗi PO"));
    mockAuditLog.mockRejectedValueOnce(new Error("audit cũng lỗi"));
    await expect(gateExec.executeGate("g1", "u1")).rejects.toThrow(/lỗi PO/);
  });
});

describe("P0-3 · retryExecution — thao tác cố ý", () => {
  test("chỉ nhận gate APPROVED + resultRef null", async () => {
    mockAgentHumanGate.findFirst.mockResolvedValue(null);
    await expect(gateExec.retryExecution("g1", "u1")).rejects.toMatchObject({ status: 409 });
    expect(mockPurchaseCreate).not.toHaveBeenCalled();
  });

  test("gate đã có resultRef → 409, không tạo thêm", async () => {
    mockAgentHumanGate.findFirst.mockResolvedValue(null); // không khớp bộ lọc
    await expect(gateExec.retryExecution("g1", "u1")).rejects.toMatchObject({ status: 409 });
    expect(mockPurchaseCreate).not.toHaveBeenCalled();
  });

  test("truy vấn retry lọc đủ BA điều kiện để không tính nhầm gate khác", async () => {
    mockAgentHumanGate.findFirst.mockResolvedValue(null);
    await expect(gateExec.retryExecution("g1", "u1")).rejects.toMatchObject({ status: 409 });

    // `resultRef IS NULL` một mình KHÔNG đủ — DATA_REQUEST cũng có resultRef null.
    const where = mockAgentHumanGate.findFirst.mock.calls[0][0].where;
    expect(where).toMatchObject({ status: "APPROVED", resultRef: null });
    expect(where.actionType).toBe(PO_PROPOSAL);
  });

  test("DATA_REQUEST đã APPROVED (resultRef null) KHÔNG bị coi là trạng thái lỗi", async () => {
    // Mock trả về gate loại khác ⇒ chứng minh điều kiện actionType là bắt buộc.
    mockAgentHumanGate.findFirst.mockResolvedValue({
      id: "g-data", actionType: "DATA_REQUEST", status: "APPROVED",
      resultRef: null, sessionId: "s1", actionPayload: {},
      expiresAt: FUTURE, session: { userId: "u", triggerSource: "USER_CHAT" },
    });
    // Nhưng thực tế `retryExecution` không lấy được gate này (where lọc actionType)
    // nên ở đây ta kiểm tra executor từ chối khi actionType sai.
    await expect(gateExec.executeGate("g-data", "u1")).rejects.toMatchObject({ status: 400 });
    expect(mockPurchaseCreate).not.toHaveBeenCalled();
  });
});

// ── HTTP layer ──────────────────────────────────────────────────────────
let server;
let baseUrl;

beforeAll((done) => {
  const app = express();
  app.use(express.json());
  app.use("/api/agent", agentRoutes);
  app.use((err, req, res, next) => {
    res.status(err?.status || err?.statusCode || 500).json({ success: false, message: err?.message || "Lỗi" });
  });
  server = app.listen(0, () => { baseUrl = `http://127.0.0.1:${server.address().port}`; done(); });
});
afterAll(async () => { await new Promise((r) => server.close(r)); });

const decide = (body, id = "gate-po-1") =>
  fetch(`${baseUrl}/api/agent/human-gates/${id}/decide`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });

describe("P0-3 · HTTP decide", () => {
  test("APPROVED đề xuất PO → trả mã PO, selfApproved=false cho SYSTEM_EVENT", async () => {
    mockAgentHumanGate.findFirst.mockImplementation(async ({ where }) =>
      where.id ? poGate({ status: "APPROVED" }) : poGate({ status: "APPROVED" }),
    );
    mockAgentHumanGate.findFirst
      .mockResolvedValueOnce(poGate())            // lần đọc đầu (PENDING)
      .mockResolvedValueOnce(poGate({ status: "APPROVED" })); // đọc lại sau updateMany

    const res = await decide({ decision: "APPROVED", note: "ok" });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.po.poCode).toBe("PO-20261002-0001");
    expect(json.data.selfApproved).toBe(false); // triggerSource SYSTEM_EVENT
    expect(mockPurchaseCreate).toHaveBeenCalledTimes(1);
  });

  test("đảo trạng thái dùng updateMany CÓ ĐIỀU KIỆN, không dùng update()", async () => {
    mockAgentHumanGate.findFirst.mockResolvedValue(poGate());
    mockAgentHumanGate.updateMany.mockResolvedValue({ count: 0 });

    const res = await decide({ decision: "APPROVED", note: "ok" });

    expect(res.status).toBe(409);
    const call = mockAgentHumanGate.updateMany.mock.calls[0][0];
    expect(call.where).toMatchObject({ status: "PENDING" });
    expect(mockPurchaseCreate).not.toHaveBeenCalled();
  });

  test("REJECTED không có lý do → 400", async () => {
    const res = await decide({ decision: "REJECTED", note: "  " });
    expect(res.status).toBe(400);
  });

  test("REJECTED có lý do → 200, không tạo PO", async () => {
    mockAgentHumanGate.findFirst.mockResolvedValue(poGate());
    const res = await decide({ decision: "REJECTED", note: "NCC này tồn kho kém" });
    expect(res.status).toBe(200);
    expect(mockPurchaseCreate).not.toHaveBeenCalled();
  });

  test("role thấp bị 403", async () => {
    mockCurrentUser = { id: "u-cashier", role: "CASHIER" };
    const res = await decide({ decision: "APPROVED", note: "ok" });
    expect(res.status).toBe(403);
    expect(mockPurchaseCreate).not.toHaveBeenCalled();
    mockCurrentUser = { id: "u-admin", role: "ADMIN" };
  });
});

describe("P0-3 · hồi quy gate khác (mục 2.6)", () => {
  test("DATA_REQUEST vẫn duyệt bình thường, không gọi purchase.create", async () => {
    mockAgentHumanGate.findFirst
      .mockResolvedValueOnce({
        id: "g-data", actionType: "DATA_REQUEST", status: "PENDING",
        expiresAt: FUTURE, sessionId: "sess-1", actionPayload: { tool: "x" },
        session: { userId: "u-cashier", triggerSource: "USER_CHAT" },
      })
      .mockResolvedValueOnce({ id: "g-data", status: "APPROVED", actionType: "DATA_REQUEST" });

    const res = await decide({ decision: "APPROVED", note: "ok" }, "g-data");
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.po).toBeNull();
    expect(mockPurchaseCreate).not.toHaveBeenCalled();
  });
});