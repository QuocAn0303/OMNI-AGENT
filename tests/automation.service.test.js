jest.mock("../src/config/prisma", () => {  const mockPrisma = {};  const handlers = {};  mockPrisma.$transaction = jest.fn(async (fn) => fn(mockPrisma));  mockPrisma.inventory = {    findMany: jest.fn(),    findUnique: jest.fn(),    count: jest.fn(),    update: jest.fn(),  };  mockPrisma.product = {    findFirst: jest.fn(),    findUnique: jest.fn(),  };  mockPrisma.purchaseOrder = {
    create: jest.fn(),
    update: jest.fn(),
    findFirst: jest.fn(),    count: jest.fn(),    aggregate: jest.fn(),  };  mockPrisma.purchaseItem = {    findFirst: jest.fn(),  };  mockPrisma.payroll = {    findFirst: jest.fn(),  };  mockPrisma.debt = {    findMany: jest.fn(),    findFirst: jest.fn(),    findUnique: jest.fn(),    update: jest.fn(),    count: jest.fn(),  };  mockPrisma.customer = {    findFirst: jest.fn(),    count: jest.fn(),    findMany: jest.fn(),  };  mockPrisma.customerNote = {    create: jest.fn().mockResolvedValue({ id: "note1" }),  };  mockPrisma.notification = {    findFirst: jest.fn().mockResolvedValue(null),    create: jest.fn().mockResolvedValue({ id: "notif1" }),  };  mockPrisma.order = {    count: jest.fn(),    aggregate: jest.fn(),    findUnique: jest.fn(),  };  mockPrisma.expense = {    aggregate: jest.fn(),  };  mockPrisma.user = {    findFirst: jest.fn(),  };  mockPrisma.agentHumanGate = {    create: jest.fn(),  };  mockPrisma.agentSession = {    create: jest.fn(),  };  return mockPrisma;});jest.mock("../src/modules/notifications/notification.service", () => ({  notifyRoles: jest.fn(),}));jest.mock("../src/modules/hr/hr.service", () => ({  generatePayrollForMonth: jest.fn(),}));jest.mock("../src/modules/accounting/journal.service", () => ({  postEntry: jest.fn(),}));jest.mock("../src/modules/audit/audit.service", () => ({  log: jest.fn(),}));const prisma = require("../src/config/prisma");const {  checkAutoReorder,
  AUTO_REORDER_DELAY_MS,
  AUTO_REORDER_DEDUPE_WINDOW_MS,
  _resetAutoReorderDedupeForTest,
  debtAutoCollection,  morningBriefing,  anomalyDetection,} = require("../src/modules/automation/automation.service");const notif = require("../src/modules/notifications/notification.service");
// P0-2: đường auto-reorder phải KHÔNG tạo PO → chặn module suggest để assert được.
const mockSuggestForProductInTenant = jest.fn();
jest.mock("../src/modules/replenishment/replenishment.suggest", () => ({
  suggestForProductInTenant: (...a) => mockSuggestForProductInTenant(...a),
}));
const logger = require("../src/utils/logger");
jest.mock("../src/utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), truncateLog: (v) => String(v) }));

describe("automation.service", () => {  beforeEach(() => {    jest.clearAllMocks();  });  /**
   * P0-2: HỢP ĐỒNG MỚI của `checkAutoReorder`.
   *
   * Trước đây hàm này gọi thẳng `prisma.purchaseOrder.create` và tự đặt
   * `status: 'APPROVED'` khi tổng tiền < 5tr (ngưỡng hard-code). Đó là đường né
   * kiểm soát — nó tạo PO ĐÃ ĐƯỢC DUYỆT mà không ai bấm duyệt.
   *
   * Nay: cờ `AUTO_REORDER_PROPOSAL` mặc định OFF, và kể cả khi BẬT cũng chỉ sinh
   * ĐỀ XUẤT qua `mockSuggestForProductInTenant` — không bao giờ tạo PO.
   *
   * Các test cũ ("should create PO with auto-approve…") ĐÃ BỊ XOÁ vì khẳng định
   * hành vi vốn là lỗi. Chúng không được sửa thành "vẫn tạo PO" — nếu còn chúng ở
   * đây thì P0-2 chưa làm xong.
   */
  describe("checkAutoReorder (P0-2)", () => {
    const inv = (over = {}) => ({
      id: "inv1", tenantId: "t1", productId: "p1", warehouseId: "w1",
      quantity: 2, reserved: 0, minStock: 10,
      product: { id: "p1", name: "Test", sku: "SKU1", costPrice: 10000, isActive: true },
      ...over,
    });

    // D6: `checkAutoReorder` có khoá debounce theo (tenant, SKU) nằm trong bộ nhớ
    // của tiến trình. Xoá trước mỗi test để các test gọi cùng một SKU vẫn chạy.
    beforeEach(() => _resetAutoReorderDedupeForTest());

    afterEach(() => { delete process.env.AUTO_REORDER_PROPOSAL; });

    test("MẶC ĐỊNH OFF: không tạo PO, không gọi suggest, chỉ log lý do bỏ qua", async () => {
      delete process.env.AUTO_REORDER_PROPOSAL;
      prisma.inventory.findMany.mockResolvedValue([inv()]);

      await checkAutoReorder(["p1"], "w1");

      expect(prisma.purchaseOrder.create).not.toHaveBeenCalled();
      expect(mockSuggestForProductInTenant).not.toHaveBeenCalled();
      // Phải có log giải thích, không bỏ qua im lặng (quy ước AGENTS.md).
      expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining("AUTO_REORDER_PROPOSAL"));
    });

    test("BẬT: đi qua suggest, KHÔNG BAO GIỜ tạo PO trực tiếp", async () => {
      process.env.AUTO_REORDER_PROPOSAL = "1";
      prisma.inventory.findMany.mockResolvedValue([inv()]);
      mockSuggestForProductInTenant.mockResolvedValue({ gate: { id: "g1" } });

      await checkAutoReorder(["p1"], "w1");

      expect(mockSuggestForProductInTenant).toHaveBeenCalledWith({ tenantId: "t1", productId: "p1" });
      expect(prisma.purchaseOrder.create).not.toHaveBeenCalled();
      // Ràng buộc cứng: không được tự đặt trạng thái APPROVED ở bất kỳ đâu trong file.
      expect(prisma.purchaseOrder.update).not.toHaveBeenCalled();
    });

    // Không lọc bằng `minStock`: ngưỡng quyết định là ATP+onOrder <= ROP, thuộc
    // `calc.js`. Lọc ở đây bằng `minStock` sẽ bỏ sót SKU còn cần nhập.
    test("BẬT: tồn cao hơn minStock vẫn được đưa vào loader để calc.js quyết định", async () => {
      process.env.AUTO_REORDER_PROPOSAL = "1";
      prisma.inventory.findMany.mockResolvedValue([inv({ quantity: 100, minStock: 5 })]);

      await checkAutoReorder(["p1"], "w1");

      expect(mockSuggestForProductInTenant).toHaveBeenCalledTimes(1);
    });

    test("BẬT: sản phẩm không active thì bỏ qua", async () => {
      process.env.AUTO_REORDER_PROPOSAL = "1";
      prisma.inventory.findMany.mockResolvedValue([
        inv({ product: { id: "p1", name: "X", sku: "S", costPrice: 1, isActive: false } }),
      ]);

      await checkAutoReorder(["p1"], "w1");

      expect(mockSuggestForProductInTenant).not.toHaveBeenCalled();
    });

    test("thiếu tenantId → bỏ qua và log lỗi (CDC chạy ngoài tenant context)", async () => {
      process.env.AUTO_REORDER_PROPOSAL = "1";
      prisma.inventory.findMany.mockResolvedValue([inv({ tenantId: null })]);

      await checkAutoReorder(["p1"], "w1");

      expect(mockSuggestForProductInTenant).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("tenantId"));
    });

    test("chưa có NCC → ghi log chờ người chọn, không tự đặt hàng", async () => {
      process.env.AUTO_REORDER_PROPOSAL = "1";
      prisma.inventory.findMany.mockResolvedValue([inv()]);
      mockSuggestForProductInTenant.mockResolvedValue({ needVendor: true, sku: "SKU1" });

      await checkAutoReorder(["p1"], "w1");

      expect(prisma.purchaseOrder.create).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("NCC"));
    });

    test("lỗi trong suggest không làm chết cron — được bắt và log", async () => {
      process.env.AUTO_REORDER_PROPOSAL = "1";
      prisma.inventory.findMany.mockResolvedValue([inv()]);
      mockSuggestForProductInTenant.mockRejectedValue(new Error("db down"));

      await expect(checkAutoReorder(["p1"], "w1")).resolves.toBeUndefined();
      expect(logger.error).toHaveBeenCalled();
    });

    // D6: một SKU bán thường xuyên sẽ bắn `onOrderCompleted` liên tục. Không có
    // khoá thì mỗi đơn lại chạy một vòng loader 28 ngày mà không đổi kết luận.
    test("debounce theo (tenant, SKU): gọi lại ngay trong cửa sổ thì KHÔNG đánh giá lại", async () => {
      process.env.AUTO_REORDER_PROPOSAL = "1";
      prisma.inventory.findMany.mockResolvedValue([inv()]);
      mockSuggestForProductInTenant.mockResolvedValue({ gate: { id: "g1" } });

      await checkAutoReorder(["p1"], "w1");
      await checkAutoReorder(["p1"], "w1");
      await checkAutoReorder(["p1"], "w1");

      expect(mockSuggestForProductInTenant).toHaveBeenCalledTimes(1);
      expect(prisma.purchaseOrder.create).not.toHaveBeenCalled();
    });

    test("debounce KHÔNG chặn tenant khác: cùng SKU ở 2 tenant thì cả 2 được đánh giá", async () => {
      process.env.AUTO_REORDER_PROPOSAL = "1";
      prisma.inventory.findMany
        .mockResolvedValueOnce([inv()])
        .mockResolvedValueOnce([inv({ tenantId: "t2" })]);
      mockSuggestForProductInTenant.mockResolvedValue({ gate: { id: "g1" } });

      await checkAutoReorder(["p1"], "w1");
      await checkAutoReorder(["p1"], "w1");

      expect(mockSuggestForProductInTenant).toHaveBeenCalledTimes(2);
      expect(mockSuggestForProductInTenant.mock.calls.map((c) => c[0].tenantId).sort()).toEqual(["t1", "t2"]);
    });

    test("hằng số debounce được ĐẶT TÊN và là số hữu hạn dương", () => {
      expect(Number.isFinite(AUTO_REORDER_DELAY_MS)).toBe(true);
      expect(AUTO_REORDER_DELAY_MS).toBeGreaterThan(0);
      expect(Number.isFinite(AUTO_REORDER_DEDUPE_WINDOW_MS)).toBe(true);
      expect(AUTO_REORDER_DEDUPE_WINDOW_MS).toBeGreaterThan(0);
    });
  });  describe("debtAutoCollection", () => {    test("should skip when no debts found", async () => {      prisma.debt.findMany.mockResolvedValue([]);      await debtAutoCollection();      expect(notif.notifyRoles).not.toHaveBeenCalled();    });    test("should notify MANAGER for upcoming debts (≤3 days)", async () => {      const mockDebt = {        id: "d1",        amount: 1000000,        paidAmount: 0,        status: "OPEN",        type: "RECEIVABLE",        dueDate: new Date(Date.now() + 2 * 86400000),        customer: { id: "c1", name: "Test Customer", phone: "0909123456" },        vendor: null,      };      prisma.debt.findMany.mockResolvedValueOnce([mockDebt]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);      prisma.notification.findFirst.mockResolvedValue(null);      await debtAutoCollection();      expect(notif.notifyRoles).toHaveBeenCalledWith(        ["MANAGER"],        expect.objectContaining({          type: "DEBT_OVERDUE",          severity: "WARNING",        })      );    });    test("should escalate to ADMIN for 7-day overdue debts", async () => {      const mockDebt = {        id: "d2",        amount: 5000000,        paidAmount: 0,        status: "OPEN",        type: "RECEIVABLE",        dueDate: new Date(Date.now() - 10 * 86400000),        customer: { id: "c2", name: "Late Customer" },        vendor: null,      };      prisma.debt.findMany        .mockResolvedValueOnce([])        .mockResolvedValueOnce([mockDebt])        .mockResolvedValueOnce([]);      prisma.notification.findFirst.mockResolvedValue(null);      await debtAutoCollection();      expect(notif.notifyRoles).toHaveBeenCalledWith(        ["ADMIN"],        expect.objectContaining({          severity: "CRITICAL",        })      );      expect(prisma.debt.update).toHaveBeenCalledWith(        expect.objectContaining({          data: { status: "OVERDUE" },        })      );    });    test("should debounce duplicate notifications within 24h", async () => {      const mockDebt = {        id: "d3",        amount: 1000000,        paidAmount: 0,        status: "OPEN",        type: "RECEIVABLE",        dueDate: new Date(Date.now() + 1 * 86400000),        customer: { id: "c3", name: "Debounced" },        vendor: null,      };      prisma.debt.findMany        .mockResolvedValueOnce([mockDebt])        .mockResolvedValueOnce([])        .mockResolvedValueOnce([]);      prisma.notification.findFirst.mockResolvedValue({ id: "existing-notif" });      await debtAutoCollection();      expect(notif.notifyRoles).not.toHaveBeenCalled();    });  });  describe("morningBriefing", () => {    test("should generate briefing with revenue data", async () => {      prisma.order.count.mockResolvedValue(5);      prisma.order.aggregate        .mockResolvedValueOnce({ _sum: { total: 5000000 } })        .mockResolvedValueOnce({ _sum: { total: 3000000 } })        .mockResolvedValueOnce({ _sum: { total: 15000000 } })        .mockResolvedValueOnce({ _sum: { total: 12000000 } });      prisma.inventory.count.mockResolvedValue(3);      prisma.purchaseOrder.count.mockResolvedValue(2);      prisma.debt.count.mockResolvedValue(4);      prisma.customer.count.mockResolvedValueOnce(100).mockResolvedValueOnce(12);      const result = await morningBriefing();      expect(result.success).toBe(true);      expect(notif.notifyRoles).toHaveBeenCalledWith(        ["ADMIN", "MANAGER"],        expect.objectContaining({          type: "SYSTEM",          severity: "INFO",        })      );    });    test("should mark as WARNING when anomalies detected", async () => {      prisma.order.count.mockResolvedValue(2);      prisma.order.aggregate        .mockResolvedValueOnce({ _sum: { total: 1000000 } })        .mockResolvedValueOnce({ _sum: { total: 5000000 } })        .mockResolvedValueOnce({ _sum: { total: 5000000 } });      prisma.inventory.count.mockResolvedValue(25);      prisma.purchaseOrder.count.mockResolvedValue(8);      prisma.debt.count.mockResolvedValue(15);      prisma.customer.count.mockResolvedValueOnce(50).mockResolvedValueOnce(5);      const result = await morningBriefing();      expect(result.anomaly).toBe(true);      expect(notif.notifyRoles).toHaveBeenCalledWith(        ["ADMIN", "MANAGER"],        expect.objectContaining({          severity: "WARNING",        })      );    });    test("should handle errors gracefully", async () => {      prisma.order.count.mockRejectedValue(new Error("DB Error"));      const result = await morningBriefing();      expect(result.success).toBe(false);    });  });  describe("anomalyDetection", () => {    test("should detect revenue drop >50%", async () => {      prisma.order.aggregate        .mockResolvedValueOnce({ _sum: { total: 1000000 }, _count: { id: 4 } })        .mockResolvedValueOnce({ _sum: { total: 10000000 }, _count: { id: 10 } });      prisma.expense.aggregate        .mockResolvedValueOnce({ _sum: { amount: 5000000 } })        .mockResolvedValueOnce({ _sum: { amount: 5000000 } });      prisma.customer.count.mockResolvedValue(5);      const result = await anomalyDetection();      expect(result.alerts).toBeGreaterThan(0);      expect(notif.notifyRoles).toHaveBeenCalled();    });    test("should detect expense spike >50%", async () => {      prisma.order.aggregate        .mockResolvedValueOnce({ _sum: { total: 10000000 }, _count: { id: 10 } })        .mockResolvedValueOnce({ _sum: { total: 10000000 }, _count: { id: 10 } });      prisma.expense.aggregate        .mockResolvedValueOnce({ _sum: { amount: 30000000 } })        .mockResolvedValueOnce({ _sum: { amount: 10000000 } });      prisma.customer.count.mockResolvedValue(5);      const result = await anomalyDetection();      expect(result.alerts).toBeGreaterThan(0);    });    test("should detect dormant customers", async () => {      prisma.order.aggregate        .mockResolvedValueOnce({ _sum: { total: 10000000 }, _count: { id: 10 } })        .mockResolvedValueOnce({ _sum: { total: 10000000 }, _count: { id: 10 } });      prisma.expense.aggregate        .mockResolvedValueOnce({ _sum: { amount: 10000000 } })        .mockResolvedValueOnce({ _sum: { amount: 10000000 } });      prisma.customer.count.mockResolvedValue(15);      const result = await anomalyDetection();      expect(result.alerts).toBeGreaterThan(0);    });    test("should return 0 alerts when everything normal", async () => {      prisma.order.aggregate        .mockResolvedValueOnce({ _sum: { total: 10000000 }, _count: { id: 10 } })        .mockResolvedValueOnce({ _sum: { total: 10000000 }, _count: { id: 10 } });      prisma.expense.aggregate        .mockResolvedValueOnce({ _sum: { amount: 10000000 } })        .mockResolvedValueOnce({ _sum: { amount: 10000000 } });      prisma.customer.count.mockResolvedValue(5);      const result = await anomalyDetection();      expect(result.alerts).toBe(0);    });    test("should handle errors gracefully", async () => {      prisma.order.aggregate.mockRejectedValue(new Error("DB Error"));      const result = await anomalyDetection();      expect(result.success).toBe(false);    });  });});
