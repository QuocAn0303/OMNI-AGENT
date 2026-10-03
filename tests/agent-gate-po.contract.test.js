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
const mockProduct = { findFirst: jest.fn() };

jest.mock("../src/config/prisma", () => ({
  agentHumanGate: mockAgentHumanGate,
  agentSession: mockAgentSession,
  purchaseOrder: mockPurchaseOrder,
  orderItem: mockOrderItem,
  purchaseItem: mockPurchaseItem,
  vendor: mockVendor,
  inventory: mockInventory,
  // `recomputeCurrent` đọc giá vốn hiện tại từ Product để bắt COST_DRIFT.
  product: mockProduct,
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

// Đề xuất và kiểm tra lại PHẢI dùng chung một hàm nạp dữ liệu (00b §2 / P0-2 mục 2).
// Test này mock đúng loader đó, nên nếu ai đó tách thành hai nơi nạp khác nhau thì
// "drift giả" sẽ quay lại mà test này không bắt được — đó là điểm cần nhớ.
const mockLoadInput = jest.fn();
const mockLoadReceipts = jest.fn().mockResolvedValue([]);
jest.mock("../src/modules/replenishment/replenishment.suggest", () => ({
  loadReplenishmentInput: (...a) => mockLoadInput(...a),
  loadLeadTimeReceipts: (...a) => mockLoadReceipts(...a),
}));

const { PO_PROPOSAL } = require("../src/modules/ai/agent.humangate");
const gateExec = require("../src/modules/ai/agent.gate.exec");
const agentRoutes = require("../src/modules/ai/agent.routes");

const FUTURE = new Date(Date.now() + 3600_000).toISOString();

/**
 * PO đã tạo từ gate, khớp đủ điều kiện xác minh (mục 3D):
 * cùng NCC, cùng dòng hàng, đúng người tạo, tạo sau thời điểm duyệt.
 */
const verifiedPo = (over = {}) => ({
  id: "po-1",
  poCode: "PO-20261002-0001",
  total: 1350000,
  vendorId: "v1",
  // các test gọi executeGate(gateId, "u1") ⇒ decidedById = "u1"
  createdById: "u1",
  createdAt: new Date(),
  items: [{ productId: "p1", quantity: 30 }],
  ...over,
});

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
    rationale: { atp: 12, onOrder: 0, inventoryPosition: 12, rop: 21, demandPerDay: 3, leadTimeDays: 7, leadTimeEstimated: true },
  },
  session: { userId: "u-other", triggerSource: "SYSTEM_EVENT" },
  ...over,
});

/** ATP thấp hơn ROP ⇒ vẫn cần đặt. */
const inventoryLow = [{ quantity: 12, reserved: 0 }];

/**
 * Đổi bộ dữ liệu nạp (tức đổi ATP / nhu cầu / onOrder) như NẾU thời gian trôi qua
 * giữa lúc đề xuất và lúc duyệt.
 */
const setRecomputedInput = ({ inventories = inventoryLow, qtyPerDay = 3, onOrder = 0 }) => {
  mockLoadInput.mockImplementation(async (ids) =>
    new Map(ids.map((id) => [id, {
      dailySales: Array.from({ length: 28 }, (_, i) => ({
        date: new Date(Date.now() - i * 86400000).toISOString().slice(0, 10),
        qty: qtyPerDay, outOfStock: false,
      })),
      inventories,
      onOrder,
    }])),
  );
};

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentUser = { id: "u-admin", role: "ADMIN" };
  mockVendor.findFirst.mockResolvedValue({ id: "v1", isActive: true });
  mockInventory.findMany.mockResolvedValue(inventoryLow);
  // Loader dùng chung: 28 ngày × 3/ngày, σ = 0 ⇒ ROP = 21, onOrder = 0.
  setRecomputedInput({});
  mockLoadReceipts.mockResolvedValue([]);
  mockPurchaseOrder.findFirst.mockResolvedValue(null); // chưa có PO nào từ gate
  mockPurchaseCreate.mockResolvedValue({ id: "po-1", poCode: "PO-20261002-0001", total: 1890000 });
  mockAgentHumanGate.updateMany.mockResolvedValue({ count: 1 });
  mockAgentHumanGate.update.mockImplementation(async () => ({}));
  mockAgentSession.update.mockResolvedValue({});
  // Mặc định khớp `unitCost` trong fixture `poGate` (45000) ⇒ KHÔNG drift.
  // Test COST_DRIFT sẽ override lại bằng giá khác.
  mockProduct.findFirst.mockResolvedValue({ costPrice: 45000 });
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
    setRecomputedInput({ inventories: [{ quantity: 5000, reserved: 0 }] }); // ATP >> ROP

    await expect(
      gateExec.executeGate("g1", "u1", { acknowledgeDrift: true }),
    ).rejects.toMatchObject({ status: 409, drift: "NO_LONGER_NEEDED" });
    expect(mockPurchaseCreate).not.toHaveBeenCalled();
  });

test("số lượng lệch quá ngưỡng → 409 kèm diff, chưa acknowledge thì không tạo PO", async () => {
    mockAgentHumanGate.findFirst.mockResolvedValue(poGate({ status: "APPROVED" }));
    // Giả lập dữ liệu đã đổi mạnh: nhu cầu tăng gấp đôi ⇒ orderQty tính lại lệch > 25%.
    setRecomputedInput({ qtyPerDay: 12 });

    await expect(gateExec.executeGate("g1", "u1")).rejects.toMatchObject({
      status: 409, drift: "DRIFT_BLOCK",
    });
    expect(mockPurchaseCreate).not.toHaveBeenCalled();
  });

  test("acknowledgeDrift cho phép chạy (đây KHÔNG phải override tự động)", async () => {
    mockAgentHumanGate.findFirst.mockResolvedValue(poGate({ status: "APPROVED" }));
    setRecomputedInput({ qtyPerDay: 12 });

    const res = await gateExec.executeGate("g1", "u1", { acknowledgeDrift: true });

    expect(res.po.id).toBe("po-1");
    expect(mockPurchaseCreate).toHaveBeenCalledTimes(1);
    // PO vẫn dùng số lượng trong payload mà người duyệt đã nhìn thấy.
    expect(mockPurchaseCreate.mock.calls[0][0].items[0].quantity).toBe(30);
  });
});

describe("D6 · THIẾU GIÁ VỐN → 409 MISSING_COST, KHÔNG tạo PO giá 0", () => {
  // Bối cảnh: `Product.costPrice` là Decimal và CÓ THỂ NULL. Trước D6,
  // `recomputeCurrent` lấy đè bằng giá lúc đề xuất nên PO đi tiếp âm thầm; còn
  // `suggestForProduct` ép `null` thành 0 nên tổng tiền đề xuất bằng 0 — hai
  // đường đều cho ra một con số SAI mà nhìn vẫn hợp lý.
  test("costPrice = NULL → 409 MISSING_COST, purchase.create KHÔNG được gọi", async () => {
    mockAgentHumanGate.findFirst.mockResolvedValue(poGate({ status: "APPROVED" }));
    mockProduct.findFirst.mockResolvedValue({ costPrice: null });

    await expect(gateExec.executeGate("g1", "u1")).rejects.toMatchObject({
      status: 409, code: "MISSING_COST", missingCost: true,
    });
    expect(mockPurchaseCreate).not.toHaveBeenCalled();
  });

  test("costPrice = 0 hoặc âm → 409 MISSING_COST (0 không phải giá vốn hợp lệ)", async () => {
    for (const bad of [0, -1]) {
      mockAgentHumanGate.findFirst.mockResolvedValue(poGate({ status: "APPROVED" }));
      mockProduct.findFirst.mockResolvedValue({ costPrice: bad });
      await expect(gateExec.executeGate("g1", "u1")).rejects.toMatchObject({
        status: 409, code: "MISSING_COST",
      });
    }
    expect(mockPurchaseCreate).not.toHaveBeenCalled();
  });

  test("acknowledgeDrift KHÔNG mở đường cho MISSING_COST (không có gì để so sánh)", async () => {
    mockAgentHumanGate.findFirst.mockResolvedValue(poGate({ status: "APPROVED" }));
    mockProduct.findFirst.mockResolvedValue({ costPrice: null });

    await expect(
      gateExec.executeGate("g1", "u1", { acknowledgeDrift: true }),
    ).rejects.toMatchObject({ status: 409, code: "MISSING_COST" });
    expect(mockPurchaseCreate).not.toHaveBeenCalled();
  });

  test("đề xuất sinh lúc SKU CHƯA có giá vốn, người dùng bổ sung sau → đi tiếp với GIÁ HIỆN TẠI", async () => {
    const gate = poGate({ status: "APPROVED" });
    // Đề xuất cũ không có giá vốn: payload mang cờ + đơn giá 0.
    gate.actionPayload.missingCost = true;
    gate.actionPayload.items[0].unitCost = 0;
    mockAgentHumanGate.findFirst.mockResolvedValue(gate);
    // Người dùng đã điền giá vốn 45.000 ⇒ KHÔNG chặn nữa.
    mockProduct.findFirst.mockResolvedValue({ costPrice: 45000 });

    const res = await gateExec.executeGate("g1", "u1");

    expect(res.costSubstituted).toBe(true);
    expect(res.po.id).toBe("po-1");
    // PO phải mang giá 45.000, KHÔNG phải giá 0 của đề xuất.
    expect(mockPurchaseCreate.mock.calls[0][0].items[0].unitCost).toBe(45000);
  });

  test("đề xuất có giá vốn hợp lệ → không thay số, PO dùng đúng giá người duyệt đã thấy", async () => {
    mockAgentHumanGate.findFirst.mockResolvedValue(poGate({ status: "APPROVED" }));
    mockProduct.findFirst.mockResolvedValue({ costPrice: 45000 });
    const res = await gateExec.executeGate("g1", "u1");
    expect(res.costSubstituted).toBe(false);
    expect(mockPurchaseCreate.mock.calls[0][0].items[0].unitCost).toBe(45000);
  });

  test("giá vốn hợp lệ → đi tiếp bình thường (không chặn nhầm)", async () => {
    mockAgentHumanGate.findFirst.mockResolvedValue(poGate({ status: "APPROVED" }));
    mockProduct.findFirst.mockResolvedValue({ costPrice: 45000 });
    const res = await gateExec.executeGate("g1", "u1");
    expect(res.po.id).toBe("po-1");
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
    const existingPo = verifiedPo({ id: "po-OLD", poCode: "PO-20261002-0007" });
    mockAgentHumanGate.findFirst.mockResolvedValue(poGate({ status: "APPROVED" }));
    mockPurchaseOrder.findFirst.mockResolvedValue(existingPo);

    const res = await gateExec.executeGate("g1", "u1");

    expect(res.linked).toBe(true);
    expect(res.po.id).toBe("po-OLD");
    expect(mockPurchaseCreate).not.toHaveBeenCalled(); // ← điểm mấu chốt
  });

  test("resultRef đã có và trỏ tới PO thật → không tạo thêm", async () => {
    mockAgentHumanGate.findFirst.mockResolvedValue(poGate({ status: "APPROVED", resultRef: "po-1" }));
    mockPurchaseOrder.findFirst.mockResolvedValue(verifiedPo({ id: "po-1", poCode: "PO-1" }));
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
    mockPurchaseOrder.findFirst.mockResolvedValue(verifiedPo({ id: "po-1", poCode: "PO-20261002-0001" }));
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

describe("P0-3 · làm cứng findPoByGate (mục 3D: mốc trong `note` do người sửa được)", () => {
  const approve = () => mockAgentHumanGate.findFirst.mockResolvedValue(
    poGate({ status: 'APPROVED', decidedAt: new Date(Date.now() - 60000) }),
  );

  test("verifyPoBelongsToGate chấp nhận PO khớp đủ", () => {
    const { verifyPoBelongsToGate } = gateExec;
    const gate = poGate({ status: "APPROVED", decidedAt: new Date(Date.now() - 60000) });
    const item = gate.actionPayload.items[0];
    const r = verifyPoBelongsToGate(verifiedPo(), { gate, item, vendorId: "v1", decidedById: "u1" });
    expect(r.ok).toBe(true);
  });

  test.each([
    ["khac-ncc", { vendorId: "v-NOCC-KHAC" }],
    ["khac-san-pham", { items: [{ productId: "p-OTHER", quantity: 30 }] }],
    ["khac-so-luong", { items: [{ productId: "p1", quantity: 999 }] }],
    ["khac-nguoi-tao", { createdById: "u-khac" }],
    ["tao-truoc-khi-duyet", { createdAt: new Date(Date.now() - 86400000) }],
  ])("PO lệch (%s) → KHÔNG liên kết, KHÔNG tạo PO thứ hai", async (reason, patch) => {
    approve();
    mockPurchaseOrder.findFirst.mockResolvedValue(verifiedPo(patch));

    await expect(gateExec.executeGate("g1", "u1")).rejects.toMatchObject({ status: 409 });
    expect(mockPurchaseCreate).not.toHaveBeenCalled();
  });

  test("PO không có dòng hàng → không liên kết", async () => {
    approve();
    mockPurchaseOrder.findFirst.mockResolvedValue(verifiedPo({ items: [] }));
    await expect(gateExec.executeGate("g1", "u1")).rejects.toMatchObject({ status: 409 });
    expect(mockPurchaseCreate).not.toHaveBeenCalled();
  });

  test("GIỚI HẠN ĐÃ BIẾT: mốc bị XOÁ khỏi note → KHÔNG phát hiện được, sẽ tạo PO mới", () => {
    // Ghi rõ giới hạn thay vì hứa hơn mức làm được: khi marker đã mất thì truy vấn
    // `note contains` không trả về gì, hệ thống coi như chưa từng tạo PO và tạo mới.
    // Ngăn chặn việc này cần một cột riêng trên PurchaseOrder (ngoài phạm vi đã duyệt).
    const queryWhere = { note: { contains: "[gate:g1]" } };
    const poNoteDaXoa = "[gate-g1-v0-cu] abc"; // không chứa marker
    expect(poNoteDaXoa).not.toMatch(/\[gate:g1\]/);
    expect(queryWhere.note.contains).toBe("[gate:g1]");
    // Không có cơ chế nào trong phạm vi hiện tại phát hiện trường hợp này.
    expect(gateExec.verifyPoBelongsToGate).toBeInstanceOf(Function);
  });
});

describe("P0-3 · onOrder — vị thế tồn (mục 3A)", () => {
  test("có hàng đang đặt thì không cần đặt thêm nữa", async () => {
    // ATP = 12, nhưng đang đặt 60 ⇒ vị thế tồn = 72 > ROP 21 ⇒ KHÔNG cần nhập.
    setRecomputedInput({ inventories: [{ quantity: 12, reserved: 0 }], onOrder: 60 });
    const { verifyPoBelongsToGate } = gateExec;
    const gate = poGate({ status: "APPROVED" });
    const item = gate.actionPayload.items[0];
    const plan = require("../src/modules/replenishment/replenishment.calc").planReplenishment({
      dailySales: Array.from({ length: 28 }, (_, i) => ({
        date: `d${i}`, qty: 3, outOfStock: false,
      })),
      inventories: [{ quantity: 12, reserved: 0 }],
      onOrder: 60,
    });
    expect(plan.atp.atp).toBe(12);
    expect(plan.atp.onOrder).toBe(60);
    expect(plan.atp.position).toBe(72);
    expect(plan.status).toBe("OK");           // không đề xuất lần nữa
    expect(plan.order.orderQty).toBe(0);
    expect(verifyPoBelongsToGate).toBeInstanceOf(Function);
  });

  test("lúc duyệt cũng phải thấy onOrder — nếu không sẽ 'thấy cần' dù đã có PO đi đường", async () => {
    mockAgentHumanGate.findFirst.mockResolvedValue(poGate({ status: "APPROVED" }));
    // onOrder lớn ⇒ sau khi quyệt PO cũ, vị thế tồn đủ ⇒ không phát sinh drift giả.
    setRecomputedInput({ inventories: [{ quantity: 12, reserved: 0 }], onOrder: 9999 });
    // Đề xuất nói ATP=12/ROP=21 (cần nhập), hiện tại position=10011 (không cần) ⇒
    // NO_LONGER_NEEDED, chặn đúng — không phải DRIFT giả.
    await expect(gateExec.executeGate("g1", "u1")).rejects.toMatchObject({
      status: 409, drift: "NO_LONGER_NEEDED",
    });
    expect(mockPurchaseCreate).not.toHaveBeenCalled();
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