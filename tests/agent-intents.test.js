/**
 * tests/agent-intents.test.js — AI Agent: intents & tools theo đặc tả §3.3
 *
 * Trọng tâm:
 * - 15 intents trong agent.routes.js (đọc source — INTENTS không export).
 * - ≥17 database query tool handlers trong db-agent HANDLERS (17 read cũ + 6 CRM/SRM mới).
 * - resolveIntent map đúng câu hỏi CRM/SRM mới → tool mới.
 * - 6 tools mới trả message định dạng, lọc enum invalid → where rỗng.
 */
jest.mock("../src/config/prisma", () => {
  const mockPrisma = {};
  mockPrisma.churnAlert = { findMany: jest.fn() };
  mockPrisma.customer = { findMany: jest.fn() };
  mockPrisma.goodsReceiptNote = { findMany: jest.fn() };
  mockPrisma.purchaseInvoiceRecord = { findMany: jest.fn() };
  mockPrisma.vendor = { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn() };
  mockPrisma.order = { findMany: jest.fn(), findFirst: jest.fn(), count: jest.fn(), aggregate: jest.fn() };
  mockPrisma.product = { findMany: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn(), count: jest.fn() };
  mockPrisma.inventory = { findMany: jest.fn(), count: jest.fn(), aggregate: jest.fn() };
  mockPrisma.invoice = { findMany: jest.fn(), count: jest.fn() };
  mockPrisma.delivery = { findMany: jest.fn() };
  mockPrisma.orderReturn = { findMany: jest.fn() };
  mockPrisma.debt = { findMany: jest.fn(), update: jest.fn() };
  mockPrisma.purchaseOrder = { findMany: jest.fn(), count: jest.fn() };
  mockPrisma.employee = { findMany: jest.fn(), count: jest.fn() };
  mockPrisma.payroll = { findMany: jest.fn() };
  mockPrisma.shift = { findMany: jest.fn() };
  mockPrisma.user = { findMany: jest.fn() };
  mockPrisma.workOrder = { findMany: jest.fn() };
  mockPrisma.bom = { findMany: jest.fn() };
  mockPrisma.inventoryLot = { findMany: jest.fn() };
  mockPrisma.project = { findMany: jest.fn() };
  mockPrisma.promotion = { findMany: jest.fn() };
  mockPrisma.expense = { findMany: jest.fn(), count: jest.fn() };
  mockPrisma.journalEntry = { findMany: jest.fn(), count: jest.fn() };
  mockPrisma.account = { findMany: jest.fn() };
  mockPrisma.notification = { create: jest.fn() };
  mockPrisma.agentHumanGate = { create: jest.fn() };
  mockPrisma.agentSession = { create: jest.fn() };
  mockPrisma.category = { findMany: jest.fn() };
  mockPrisma.warehouse = { findMany: jest.fn() };
  return mockPrisma;
});
jest.mock("../src/utils/logger", () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), truncateLog: (v) => String(v),
}));
jest.mock("../src/modules/notifications/notification.service", () => ({ notifyRoles: jest.fn() }));
jest.mock("../src/modules/orders/order.service", () => ({
  create: jest.fn().mockResolvedValue({
    id: "order1", orderCode: "ORD-20260625-0001", total: 500000, items: [],
  }),
}));
jest.mock("../src/modules/accounting/purchase.service", () => ({
  create: jest.fn().mockResolvedValue({ id: "po1", poCode: "PO-20260625-0001", total: 1000000, vendor: { name: "NCC" } }),
}));
jest.mock("../src/modules/accounting/vendor.service", () => ({
  getById: jest.fn(),
  findFirst: jest.fn(),
  list: jest.fn(),
}));

const fs = require("fs");
const path = require("path");
const { resolveIntent, processQuery, HANDLERS } = require("../src/modules/ai/db-agent.service");
const prisma = require("../src/config/prisma");

describe("db-agent — đặc tả §3.3: 15 intents / 17+ tools", () => {
  beforeEach(() => jest.clearAllMocks());

  test("HANDLERS có ít nhất 17 database query tool handlers", () => {
    const readTools = Object.keys(HANDLERS).filter(
      (t) => !["create_order", "create_po", "send_reminder"].includes(t),
    );
    expect(readTools.length).toBeGreaterThanOrEqual(17);
  });

  test("6 tools CRM/SRM mới có mặt trong HANDLERS", () => {
    [
      "search_churn_alerts",
      "search_customer_rfm",
      "search_leads",
      "search_grn",
      "search_purchase_invoices",
      "search_vendor_performance",
    ].forEach((t) => expect(typeof HANDLERS[t]).toBe("function"));
  });

  test("agent.routes.js INTENTS có đúng 15 intents (3 write lên đầu)", () => {
    const src = fs.readFileSync(path.join(__dirname, "../src/modules/ai/agent.routes.js"), "utf8");
    const block = src.slice(src.indexOf("const INTENTS = [") + "const INTENTS = ".length);
    const arraySrc = block.slice(0, block.indexOf("\n];") + 3);
    const tools = [...arraySrc.matchAll(/tool: '(\w+)'/g)].map((m) => m[1]);
    expect(tools).toHaveLength(15);
    // Write intents MUST come first — không bị read intent nuốt ("tạo đơn hàng" chứa "đơn hàng")
    expect(tools[0]).toBe("createOrder");
    expect(tools[1]).toBe("createPO");
    expect(tools[2]).toBe("sendReminder");
    expect(tools).toEqual(expect.arrayContaining([
      "queryChurnAlerts", "queryRfmSegments", "queryLeads", "queryGrn", "queryPurchaseInvoices",
    ]));
  });

  describe("resolveIntent — CRM/SRM patterns", () => {
    test("churn → search_churn_alerts (không nuốt bởi 'khách hàng')", () => {
      expect(resolveIntent("có khách nào churn không")).toBe("search_churn_alerts");
      expect(resolveIntent("danh sách khách sắp mất")).toBe("search_churn_alerts");
    });

    test("rfm/clv → search_customer_rfm", () => {
      expect(resolveIntent("phân khúc khách hàng theo RFM")).toBe("search_customer_rfm");
      expect(resolveIntent("giá trị vòng đời khách hàng CLV")).toBe("search_customer_rfm");
    });

    test("lead → search_leads", () => {
      expect(resolveIntent("danh sách lead mới")).toBe("search_leads");
      expect(resolveIntent("lead từ webhook")).toBe("search_leads");
    });

    test("phiếu nhập kho → search_grn (không nuốt bởi 'nhập hàng' PO)", () => {
      expect(resolveIntent("phiếu nhập kho hôm nay")).toBe("search_grn");
      expect(resolveIntent("xem GRN")).toBe("search_grn");
    });

    test("hóa đơn mua/3-way → search_purchase_invoices (không nuốt bởi 'hóa đơn')", () => {
      expect(resolveIntent("đối soát hóa đơn mua")).toBe("search_purchase_invoices");
      expect(resolveIntent("hóa đơn nào vượt dung sai 3-way")).toBe("search_purchase_invoices");
    });

    test("kraljic/scorecard → search_vendor_performance (không nuốt bởi 'nhà cung cấp')", () => {
      expect(resolveIntent("bảng Kraljic nhà cung cấp")).toBe("search_vendor_performance");
      expect(resolveIntent("OTIF scorecard NCC")).toBe("search_vendor_performance");
    });

    test("patterns cũ không bị regression", () => {
      expect(resolveIntent("tồn kho còn bao nhiêu")).toBe("search_inventory");
      expect(resolveIntent("doanh thu tháng này")).toBe("get_revenue");
      expect(resolveIntent("tạo đơn hàng cho khách A")).toBe("create_order");
      expect(resolveIntent("nhắc nợ khách hàng")).toBe("send_reminder");
    });
  });


  describe("createPO extract — parse tiền Việt Nam (regression)", () => {
    // Bối cảnh: "tạo PO giá 5 triệu" từng cho lỗi
    // "Không tìm thấy sản phẩm 'giá triệu'" vì regex cũ thiếu đơn vị "triệu".
    const { extractPO } = require("../src/modules/ai/agent.routes");

    test("'tạo PO giá 5 triệu' → 5.000.000đ, KHÔNG còn tên SP 'giá triệu'", () => {
      const r = extractPO("tạo PO giá 5 triệu");
      expect(r.unitCost).toBe(5_000_000);
      expect(r.productName.toLowerCase()).not.toContain("triệu");
      expect(r.productName.trim()).toBe("");
    });

    test("'tạo PO nến thơm giá 5 triệu' → giữ đúng tên sản phẩm", () => {
      const r = extractPO("tạo PO nến thơm giá 5 triệu");
      expect(r.unitCost).toBe(5_000_000);
      expect(r.productName.toLowerCase()).toContain("nến thơm");
      expect(r.productName.toLowerCase()).not.toContain("triệu");
    });

    test("số lượng có đơn vị KHÔNG bị tính thành tiền", () => {
      const r = extractPO("tạo PO cho nến thơm 3 cái");
      expect(r.quantity).toBe("3");
      expect(r.unitCost).toBe(0);
      expect(r.productName.toLowerCase()).toBe("nến thơm");
    });

    test("số tiền KHÔNG bị tính thành số lượng", () => {
      const r = extractPO("tạo PO giá 5 triệu");
      expect(r.quantity).toBe(1);
      expect(r.unitCost).toBe(5_000_000);
    });

    test("số lượng + tiền trong cùng câu", () => {
      const r = extractPO("tạo PO cho nến thơm 3 cái giá 5 triệu");
      expect(r.quantity).toBe("3");
      expect(r.unitCost).toBe(5_000_000);
      expect(r.productName.toLowerCase()).toBe("nến thơm");
    });

    test("vẫn bóc được NCC", () => {
      const r = extractPO("tạo PO nến thơm từ Công ty ABC giá 5 triệu");
      expect(r.vendorName).toContain("ABC");
      expect(r.unitCost).toBe(5_000_000);
    });

    test("PO > 5 triệu vẫn tạo được (không vưỡng ngưỡng duyệt của purchase.service)", () => {
      // Ngưỡng 5tr là quyết định của purchase.service.create, không phải parser.
      const r = extractPO("tạo PO nến thơm giá 8 triệu");
      expect(r.unitCost).toBe(8_000_000);
      expect(r.unitCost).toBeGreaterThanOrEqual(5_000_000);
    });
  });


  describe("create_po — vendor bắt buộc & unitCost không bị bỏ (regression)", () => {
    // Bug gốc: "tạo PO nến thơm giá 5 triệu" (không nêu NCC) gọi
    // purchaseService.create với vendorId=undefined → Prisma 500
    // "Argument `vendor` is missing"; đồng thời unitCost 5.000.000 bị rơi
    // về product.costPrice (27.000) vì productItems không gắn unitCost.
    const purchaseService = require("../src/modules/accounting/purchase.service");
    const vendorService = require("../src/modules/accounting/vendor.service");

    beforeEach(() => {
      prisma.vendor.findMany.mockResolvedValue([
        { name: "Cơ sở Sáp nến Việt Hưng" },
        { name: "Công ty TNHH Nguyên liệu Hương Liệu" },
      ]);
      prisma.product.findFirst.mockResolvedValue({
        id: "prod1", name: "Nến thơm", costPrice: 27000,
      });
      vendorService.list.mockResolvedValue({ items: [{ id: "vendor1" }] });
      purchaseService.create.mockClear();
    });

    test("thiếu NCC → báo hỏi lại, KHÔNG gọi purchaseService.create", async () => {
      const r = await HANDLERS.create_po({ productName: "nến thơm", quantity: 1 }, "user1");
      expect(purchaseService.create).not.toHaveBeenCalled();
      expect(r.summary).toMatch(/nhà cung cấp/i);
      expect(r.summary).toContain("Việt Hưng"); // gợi ý NCC có sẵn
      expect(r.data).toBeNull();
    });

    test("có NCC → tạo PO thành công", async () => {
      const r = await HANDLERS.create_po(
        { vendorName: "Việt Hưng", productName: "nến thơm", quantity: 1, unitCost: 5_000_000 }, "user1",
      );
      expect(purchaseService.create).toHaveBeenCalledTimes(1);
      expect(r.summary).toMatch(/Đã tạo đơn nhập hàng/);
    });

    test("unitCost 5.000.000 KHÔNG bị rơi về product.costPrice (27.000)", async () => {
      await HANDLERS.create_po(
        { vendorName: "Việt Hưng", productName: "nến thơm", quantity: 1, unitCost: 5_000_000 }, "user1",
      );
      const [payload] = purchaseService.create.mock.calls[0];
      expect(payload.items[0].unitCost).toBe(5_000_000);
      expect(payload.items[0].unitCost).not.toBe(27_000);
    });

    test("không nêu giá → vẫn dùng costPrice của sản phẩm", async () => {
      await HANDLERS.create_po({ vendorName: "Việt Hưng", productName: "nến thơm", quantity: 1 }, "user1");
      const [payload] = purchaseService.create.mock.calls[0];
      expect(payload.items[0].unitCost).toBe(27_000);
    });

    test("không tìm thấy sản phẩm → báo tên SP, không gọi purchaseService.create", async () => {
      prisma.product.findFirst.mockResolvedValue(null);
      const r = await HANDLERS.create_po(
        { vendorName: "Việt Hưng", productName: "xyz không có", quantity: 1 }, "user1",
      );
      expect(purchaseService.create).not.toHaveBeenCalled();
      expect(r.summary).toContain("xyz không có");
    });

    test("không mutate params.items của caller", async () => {
      const params = { vendorName: "Việt Hưng", productName: "nến thơm", quantity: 2, unitCost: 1000 };
      await HANDLERS.create_po(params, "user1");
      expect(params.items).toBeUndefined();
    });
  });

  describe("6 tools mới — format & filter", () => {
    test("search_churn_alerts trả message list", async () => {
      prisma.churnAlert.findMany.mockResolvedValue([
        { riskLevel: "HIGH", churnScore: 0.87, status: "PENDING",
          customer: { id: "c1", name: "Nguyễn Văn A", phone: "0901234567", churnProbability: 0.87, rfmSegment: "At-Risk" } },
      ]);
      const r = await HANDLERS.search_churn_alerts({});
      expect(r.total).toBe(1);
      expect(r.message).toContain("Nguyễn Văn A");
      expect(r.message).toContain("HIGH");
    });

    test("search_churn_alerts lọc enum invalid → where không có status", async () => {
      prisma.churnAlert.findMany.mockResolvedValue([]);
      await HANDLERS.search_churn_alerts({ status: "CANCELLED", riskLevel: "INVALID" });
      const where = prisma.churnAlert.findMany.mock.calls[0][0].where;
      expect(where.status).toBeUndefined();
      expect(where.riskLevel).toBeUndefined();
    });

    test("search_customer_rfm lọc segment hợp lệ + rỗng → summary hướng dẫn", async () => {
      prisma.customer.findMany.mockResolvedValue([]);
      const empty = await HANDLERS.search_customer_rfm({ segment: "Champions" });
      expect(empty.summary).toContain("RFM");
      expect(prisma.customer.findMany.mock.calls[0][0].where.rfmSegment).toBe("Champions");

      await HANDLERS.search_customer_rfm({ segment: "hack'--" });
      expect(prisma.customer.findMany.mock.calls[1][0].where.rfmSegment).toBeUndefined();
    });

    test("search_leads chỉ lấy khách có referralSource", async () => {
      prisma.customer.findMany.mockResolvedValue([
        { id: "c1", name: "Lead A", phone: "0911", email: null, leadStatus: "NEW", referralSource: "Facebook", createdAt: new Date() },
      ]);
      const r = await HANDLERS.search_leads({ leadStatus: "NEW" });
      expect(prisma.customer.findMany.mock.calls[0][0].where.referralSource).toEqual({ not: null });
      expect(r.message).toContain("Facebook");
    });

    test("search_grn join purchaseOrder + vendor", async () => {
      prisma.goodsReceiptNote.findMany.mockResolvedValue([
        { grnCode: "GRN-20260623-0001", status: "POSTED", receivedAt: new Date("2026-06-23"),
          purchaseOrder: { poCode: "PO-20260620-0001", vendor: { name: "NCC Hà Nội" } } },
      ]);
      const r = await HANDLERS.search_grn({ status: "POSTED" });
      expect(r.message).toContain("GRN-20260623-0001");
      expect(r.message).toContain("NCC Hà Nội");
      expect(prisma.goodsReceiptNote.findMany.mock.calls[0][0].where.status).toBe("POSTED");
    });

    test("search_purchase_invoices hiển thị variance", async () => {
      prisma.purchaseInvoiceRecord.findMany.mockResolvedValue([
        { invoiceNumber: "INV-001", invoiceAmount: 1050000, matchStatus: "VARIANCE_HOLD", variancePct: 1.5,
          purchaseOrder: { poCode: "PO-1", vendor: { name: "NCC X" } } },
      ]);
      const r = await HANDLERS.search_purchase_invoices({ matchStatus: "VARIANCE_HOLD" });
      expect(r.message).toContain("INV-001");
      expect(r.message).toContain("VARIANCE_HOLD");
      expect(r.message).toContain("1.50%");
    });

    test("search_vendor_performance hiển thị Kraljic/grade/OTIF", async () => {
      prisma.vendor.findMany.mockResolvedValue([
        { id: "v1", code: "NCC-0001", name: "NCC Strategic", kraljicCategory: "STRATEGIC",
          otifScore: 92.5, defectRate: 1.2, vendorGrade: "A", paymentTerms: 30 },
      ]);
      const r = await HANDLERS.search_vendor_performance({});
      expect(r.message).toContain("NCC Strategic");
      expect(r.message).toContain("STRATEGIC");
      expect(r.message).toContain("92.5");
    });

    test("empty results → summary đúng, data rỗng", async () => {
      prisma.goodsReceiptNote.findMany.mockResolvedValue([]);
      const r = await HANDLERS.search_grn({});
      expect(r.data).toEqual([]);
      expect(r.summary).toContain("Không có phiếu nhập kho");
    });
  });

  describe("processQuery — CRM/SRM end-to-end (không LLM)", () => {
    test("câu churn → success + tool đúng", async () => {
      prisma.churnAlert.findMany.mockResolvedValue([]);
      const r = await processQuery("khách hàng nào có nguy cơ churn");
      expect(r.success).toBe(true);
      expect(r.tool).toBe("search_churn_alerts");
    });

    test("câu GRN → success + tool đúng", async () => {
      prisma.goodsReceiptNote.findMany.mockResolvedValue([]);
      const r = await processQuery("phiếu nhập kho chờ QC");
      expect(r.success).toBe(true);
      expect(r.tool).toBe("search_grn");
    });

    test("câu Kraljic → search_vendor_performance", async () => {
      prisma.vendor.findMany.mockResolvedValue([]);
      const r = await processQuery("bảng Kraljic nhà cung cấp");
      expect(r.success).toBe(true);
      expect(r.tool).toBe("search_vendor_performance");
    });
  });
});

