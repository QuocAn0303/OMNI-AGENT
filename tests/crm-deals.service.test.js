/**
 * tests/crm-deals.service.test.js — Test nghiệp vụ Deal của CRM Sales Pipeline
 *
 * Trọng tâm:
 * - Tính tiền dòng sản phẩm (`calcItemAmount`) + discount không vượt quá giá trị dòng.
 * - `changeStage` denormalize kind/probability/closedAt; bắt buộc có lý do thua.
 * - `upsertItems` chỉ tự tính lại `value` khi deal chưa gán giá thủ công.
 * - `getBoard` gom cột theo stage + cột "Chưa phân giai đoạn".
 * - `getForecast` tính weighted forecast + win rate.
 * - Record-level permission: CASHIER không đọc/sửa/xóa deal của người khác.
 */
const mockClient = {
  crmDeal: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    delete: jest.fn(),
    groupBy: jest.fn(),
  },
  crmDealItem: { deleteMany: jest.fn(), createMany: jest.fn() },
  crmPipelineStage: { findMany: jest.fn(), findUnique: jest.fn() },
  crmCommunication: { create: jest.fn(), deleteMany: jest.fn() },
  product: { findMany: jest.fn() },
  $transaction: jest.fn(),
};

jest.mock("../src/config/prisma", () => mockClient);
jest.mock("../src/modules/audit/audit.service", () => ({ log: jest.fn() }));
jest.mock("../src/modules/notifications/notification.service", () => ({ createOne: jest.fn().mockResolvedValue({}) }));
jest.mock("../src/modules/crm/communication.service", () => ({ logSystemEvent: jest.fn().mockResolvedValue({}) }));
jest.mock("../src/modules/crm/stages.service", () => ({
  ensureDefaultStages: jest.fn().mockResolvedValue([]),
  firstOngoingStage: jest.fn(),
  list: jest.fn(),
}));
jest.mock("../src/modules/orders/order.service", () => ({
  create: jest.fn().mockResolvedValue({ id: "order-1", orderCode: "ORD-20260930-0001", total: 900000, currency: "VND" }),
}));

const dealsService = require("../src/modules/crm/deals.service");

const CASHIER = { id: "u-cashier", role: "CASHIER" };
const MANAGER = { id: "u-manager", role: "MANAGER" };

const STAGE_DEAL = (over = {}) => ({
  id: "stage-d1", entityType: "DEAL", label: "Mới", kind: "ONGOING", probability: 10, isActive: true, ...over,
});

const baseDeal = (over = {}) => ({
  id: "deal-1",
  dealName: "Hợp đồng 2026",
  stageId: "stage-d1",
  kind: "ONGOING",
  value: 5000000,
  currency: "VND",
  probability: 10,
  closedAt: null,
  lostReason: null,
  orderId: null,
  customerId: null,
  contactId: null,
  leadId: null,
  dealOwnerId: "u-cashier",
  stage: { id: "stage-d1", label: "Mới" },
  ...over,
});

describe("crm/deals.service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockClient.crmDeal.findMany.mockResolvedValue([]);
    mockClient.crmDeal.count = jest.fn().mockResolvedValue(0);
    mockClient.crmPipelineStage.findMany.mockResolvedValue([]);
    mockClient.$transaction.mockImplementation(async (arg) => (typeof arg === "function" ? arg(mockClient) : arg));
  });

  describe("calcItemAmount", () => {
    test("quantity × unitPrice − discount", () => {
      expect(dealsService.calcItemAmount({ quantity: 3, unitPrice: 100000, discount: 50000 })).toBe(250000);
    });

    test("discount lớn hơn giá trị dòng → không âm", () => {
      expect(dealsService.calcItemAmount({ quantity: 1, unitPrice: 1000, discount: 99999 })).toBe(0);
    });

    test("thiếu dữ liệu → 0", () => {
      expect(dealsService.calcItemAmount({})).toBe(0);
    });
  });

  describe("list — record-level permission", () => {
    test("CASHIER → ép dealOwnerId = mình, kể cả khi truyền owner khác", async () => {
      await dealsService.list({ dealOwnerId: "u-other" }, CASHIER);
      expect(mockClient.crmDeal.findMany.mock.calls[0][0].where.dealOwnerId).toBe("u-cashier");
    });

    test("MANAGER được lọc theo owner bất kỳ", async () => {
      await dealsService.list({ dealOwnerId: "u-other" }, MANAGER);
      expect(mockClient.crmDeal.findMany.mock.calls[0][0].where.dealOwnerId).toBe("u-other");
    });

    test("MANAGER không truyền owner → không giới hạn", async () => {
      await dealsService.list({}, MANAGER);
      expect(mockClient.crmDeal.findMany.mock.calls[0][0].where.dealOwnerId).toBeUndefined();
    });
  });

  describe("getById", () => {
    test("CASHIER đọc deal người khác → 403", async () => {
      mockClient.crmDeal.findUnique.mockResolvedValue(baseDeal({ dealOwnerId: "u-other" }));
      await expect(dealsService.getById("deal-1", CASHIER)).rejects.toMatchObject({ status: 403 });
    });

    test("deal không tồn tại → 404", async () => {
      mockClient.crmDeal.findUnique.mockResolvedValue(null);
      await expect(dealsService.getById("nope", MANAGER)).rejects.toMatchObject({ status: 404 });
    });
  });

  describe("create", () => {
    beforeEach(() => {
      // create() giờ đọc lại deal bằng findUnique trong transaction (C3)
      mockClient.crmDeal.findUnique.mockResolvedValue(baseDeal());
      mockClient.crmDeal.create.mockResolvedValue({ id: "deal-1" });
      mockClient.crmDealItem.createMany.mockResolvedValue({ count: 0 });
    });

    test("chưa chọn stage → kind ONGOING, probability 0, không có closedAt", async () => {
      mockClient.crmPipelineStage.findUnique.mockResolvedValue(null);
      mockClient.crmDeal.create.mockResolvedValue({ id: "deal-1" });
      mockClient.crmDeal.findUnique.mockResolvedValue(baseDeal({ stageId: null }));

      await dealsService.create({ dealName: "Deal mới" }, "u-manager", MANAGER);

      const data = mockClient.crmDeal.create.mock.calls[0][0].data;
      expect(data.kind).toBe("ONGOING");
      expect(data.probability).toBe(0);
      expect(data.closedAt).toBeNull();
    });

    test("chọn stage WON → kind=WON + closedAt, value tính từ items khi không truyền", async () => {
      mockClient.crmPipelineStage.findUnique.mockResolvedValue(STAGE_DEAL({ id: "stage-w", kind: "WON", probability: 100, label: "Thắng" }));
      mockClient.product.findMany.mockResolvedValue([{ id: "p1", name: "SP", isActive: true }]);
      mockClient.crmDeal.create.mockResolvedValue({ id: "deal-1" });
      mockClient.crmDeal.findUnique.mockResolvedValue(baseDeal({ kind: "WON", value: 200000 }));

      await dealsService.create(
        { dealName: "Deal thắng", stageId: "stage-w", items: [{ productId: "p1", quantity: 2, unitPrice: 100000 }] },
        "u1",
        MANAGER,
      );

      const data = mockClient.crmDeal.create.mock.calls[0][0].data;
      expect(data.kind).toBe("WON");
      expect(data.closedAt).toBeInstanceOf(Date);
      expect(data.value).toBe(200000);
    });

    // C3: nested write làm dòng crm_deal_items có tenantId = NULL → upsertItems
    // deleteMany (bị tenant-scope) không xoá được → danh sách nhân đôi.
    test("C3: KHÔNG dùng nested write cho items, phải createMany top-level", async () => {
      mockClient.crmPipelineStage.findUnique.mockResolvedValue(STAGE_DEAL());
      mockClient.product.findMany.mockResolvedValue([{ id: "p1", name: "SP", isActive: true }]);

      await dealsService.create(
        { dealName: "Deal có SP", stageId: "stage-d1", items: [{ productId: "p1", quantity: 2, unitPrice: 100000 }] },
        "u1",
        MANAGER,
      );

      // Nested write = deal.items.create trong payload của crmDeal.create
      expect(mockClient.crmDeal.create.mock.calls[0][0].data.items).toBeUndefined();
      expect(mockClient.crmDealItem.createMany).toHaveBeenCalledTimes(1);
      const row = mockClient.crmDealItem.createMany.mock.calls[0][0].data[0];
      expect(row.dealId).toBe("deal-1");
      expect(row.amount).toBe(200000);
      // tenantId do Prisma extension inject khi createMany top-level — không set tay
      expect(row.tenantId).toBeUndefined();
    });

    test("item trỏ sản phẩm không tồn tại → 400", async () => {
      mockClient.crmPipelineStage.findUnique.mockResolvedValue(null);
      mockClient.product.findMany.mockResolvedValue([]);
      await expect(
        dealsService.create({ dealName: "X", items: [{ productId: "p-x", quantity: 1, unitPrice: 1 }] }, "u1", MANAGER),
      ).rejects.toMatchObject({ status: 400 });
    });

    test("item không có productId lẫn description → 400", async () => {
      mockClient.crmPipelineStage.findUnique.mockResolvedValue(null);
      await expect(
        dealsService.create({ dealName: "X", items: [{ quantity: 1, unitPrice: 1 }] }, "u1", MANAGER),
      ).rejects.toMatchObject({ status: 400 });
    });
  });

  describe("changeStage", () => {
    test("sang stage ONGOING → kind ONGOING, probability theo stage, closedAt null", async () => {
      mockClient.crmDeal.findUnique.mockResolvedValue(baseDeal({ kind: "LOST", closedAt: new Date(), lostReason: "Giá cao" }));
      mockClient.crmPipelineStage.findUnique.mockResolvedValue(STAGE_DEAL({ id: "stage-p", kind: "ONGOING", probability: 50 }));
      mockClient.crmDeal.update.mockResolvedValue(baseDeal({ stageId: "stage-p", probability: 50 }));

      await dealsService.changeStage("deal-1", { stageId: "stage-p" }, "u1", MANAGER);

      const data = mockClient.crmDeal.update.mock.calls[0][0].data;
      expect(data.kind).toBe("ONGOING");
      expect(data.probability).toBe(50);
      expect(data.closedAt).toBeNull();
    });

    test("sang stage LOST mà chưa có lý do thua → 400, chặn trước khi update", async () => {
      mockClient.crmDeal.findUnique.mockResolvedValue(baseDeal());
      mockClient.crmPipelineStage.findUnique.mockResolvedValue(STAGE_DEAL({ id: "stage-l", kind: "LOST", probability: 0 }));
      await expect(
        dealsService.changeStage("deal-1", { stageId: "stage-l" }, "u1", MANAGER),
      ).rejects.toMatchObject({ status: 400 });
      expect(mockClient.crmDeal.update).not.toHaveBeenCalled();
    });

    test("sang stage LOST có lý do thua → OK, ghi lostReason", async () => {
      mockClient.crmDeal.findUnique.mockResolvedValue(baseDeal());
      mockClient.crmPipelineStage.findUnique.mockResolvedValue(STAGE_DEAL({ id: "stage-l", kind: "LOST", probability: 0 }));
      mockClient.crmDeal.update.mockResolvedValue(baseDeal({ kind: "LOST", lostReason: "Giá cao" }));

      await dealsService.changeStage("deal-1", { stageId: "stage-l", lostReason: "Giá cao" }, "u1", MANAGER);
      expect(mockClient.crmDeal.update.mock.calls[0][0].data.lostReason).toBe("Giá cao");
    });

    test("deal đã có đơn hàng → 409, không cho đổi stage", async () => {
      mockClient.crmDeal.findUnique.mockResolvedValue(baseDeal({ orderId: "order-1" }));
      await expect(
        dealsService.changeStage("deal-1", { stageId: "stage-p" }, "u1", MANAGER),
      ).rejects.toMatchObject({ status: 409 });
    });

    test("bỏ stage (stageId=null) → về ONGOING, probability 0", async () => {
      mockClient.crmDeal.findUnique.mockResolvedValue(baseDeal());
      mockClient.crmPipelineStage.findUnique.mockResolvedValue(null);
      mockClient.crmDeal.update.mockResolvedValue(baseDeal({ stageId: null }));

      await dealsService.changeStage("deal-1", { stageId: null }, "u1", MANAGER);
      const data = mockClient.crmDeal.update.mock.calls[0][0].data;
      expect(data.kind).toBe("ONGOING");
      expect(data.probability).toBe(0);
    });
  });

  describe("upsertItems", () => {
    test("thay toàn bộ dòng cũ, deal value=0 → tự tính lại value", async () => {
      mockClient.crmDeal.findUnique.mockResolvedValue(baseDeal({ value: 0 }));
      mockClient.product.findMany.mockResolvedValue([{ id: "p1", name: "SP", isActive: true }]);
      mockClient.crmDeal.update.mockResolvedValue(baseDeal({ value: 300000 }));

      await dealsService.upsertItems(
        "deal-1",
        [{ productId: "p1", quantity: 3, unitPrice: 100000, discount: 0 }],
        "u1",
        MANAGER,
      );

      expect(mockClient.crmDealItem.deleteMany).toHaveBeenCalledWith({ where: { dealId: "deal-1" } });
      const created = mockClient.crmDealItem.createMany.mock.calls[0][0].data;
      expect(created[0].amount).toBe(300000);
      expect(mockClient.crmDeal.update.mock.calls[0][0].data).toEqual({ value: 300000 });
    });

    test("deal đã gán value tay → KHÔNG ghi đè", async () => {
      mockClient.crmDeal.findUnique.mockResolvedValue(baseDeal({ value: 9999999 }));
      mockClient.product.findMany.mockResolvedValue([{ id: "p1", name: "SP", isActive: true }]);
      mockClient.crmDeal.update.mockResolvedValue(baseDeal());

      await dealsService.upsertItems("deal-1", [{ productId: "p1", quantity: 1, unitPrice: 100 }], "u1", MANAGER);
      expect(mockClient.crmDeal.update.mock.calls[0][0].data).toEqual({});
    });

    test("deal đã có đơn hàng → 409", async () => {
      mockClient.crmDeal.findUnique.mockResolvedValue(baseDeal({ orderId: "order-1" }));
      await expect(dealsService.upsertItems("deal-1", [], "u1", MANAGER)).rejects.toMatchObject({ status: 409 });
    });
  });

  describe("getBoard", () => {
    test("mặc định chỉ lấy deal ONGOING + gom cột theo stage", async () => {
      const stagesService = require("../src/modules/crm/stages.service");
      stagesService.list.mockResolvedValue([
        { id: "stage-d1", label: "Mới", color: "#111", kind: "ONGOING", probability: 10 },
        { id: "stage-d2", label: "Đàm phán", color: "#222", kind: "ONGOING", probability: 75 },
      ]);
      mockClient.crmDeal.findMany
        .mockResolvedValueOnce([
          baseDeal({ id: "a", stageId: "stage-d1", value: 1000000, probability: 10 }),
          baseDeal({ id: "b", stageId: "stage-d2", value: 4000000, probability: 75 }),
        ])
        .mockResolvedValueOnce([]);

      const res = await dealsService.getBoard(MANAGER);

      expect(mockClient.crmDeal.findMany.mock.calls[0][0].where.kind).toBe("ONGOING");
      expect(res.columns).toHaveLength(2);
      expect(res.columns[1].count).toBe(1);
      expect(res.columns[1].totalValue).toBe(4000000);
      expect(res.columns[1].weightedValue).toBe(3000000);
      expect(res.summary.totalValue).toBe(5000000);
    });

    test("deal chưa gán stage → thêm cột 'Chưa phân giai đoạn'", async () => {
      const stagesService = require("../src/modules/crm/stages.service");
      stagesService.list.mockResolvedValue([{ id: "stage-d1", label: "Mới", color: "#111", kind: "ONGOING", probability: 10 }]);
      mockClient.crmDeal.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([baseDeal({ stageId: null, value: 700 })]);

      const res = await dealsService.getBoard(MANAGER);
      expect(res.columns[1].stage.label).toBe("Chưa phân giai đoạn");
      expect(res.columns[1].count).toBe(1);
    });

    test("CASHIER → scope deal theo owner", async () => {
      const stagesService = require("../src/modules/crm/stages.service");
      stagesService.list.mockResolvedValue([]);
      await dealsService.getBoard(CASHIER);
      expect(mockClient.crmDeal.findMany.mock.calls[0][0].where.dealOwnerId).toBe("u-cashier");
    });
  });

  describe("getForecast", () => {
    test("weightedValue = Σ(value × probability/100) trên deal ONGOING", async () => {
      mockClient.crmDeal.findMany
        .mockResolvedValueOnce([
          { id: "a", value: 1000000, probability: 50, expectedCloseDate: null, stage: { id: "s", label: "Đề xuất", color: "#1" } },
          { id: "b", value: 2000000, probability: 25, expectedCloseDate: null, stage: { id: "s", label: "Đề xuất", color: "#1" } },
        ])
        .mockResolvedValueOnce([]);

      const res = await dealsService.getForecast(MANAGER);
      expect(res.summary.weightedValue).toBe(1000000);
      expect(res.summary.totalValue).toBe(3000000);
      expect(res.byStage[0].count).toBe(2);
    });

    test("win rate + avg deal size tính trên deal đã đóng trong kỳ", async () => {
      mockClient.crmDeal.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          { id: "w1", value: 1000000, kind: "WON", closedAt: new Date(), lostReason: null },
          { id: "w2", value: 3000000, kind: "WON", closedAt: new Date(), lostReason: null },
          { id: "l1", value: 1000000, kind: "LOST", closedAt: new Date(), lostReason: "Giá cao" },
        ]);

      const res = await dealsService.getForecast(MANAGER);
      expect(res.summary.winRate).toBeCloseTo(66.67, 1);
      expect(res.summary.avgDealSize).toBe(2000000);
      expect(res.summary.wonValue).toBe(4000000);
      expect(res.lostReasons).toEqual([{ reason: "Giá cao", count: 1 }]);
      expect(res.byMonth[0].wonCount).toBe(2);
      expect(res.byMonth[0].lostCount).toBe(1);
    });

    test("chưa có deal nào đóng → winRate 0, avgDealSize 0 (không NaN)", async () => {
      mockClient.crmDeal.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      const res = await dealsService.getForecast(MANAGER);
      expect(res.summary.winRate).toBe(0);
      expect(res.summary.avgDealSize).toBe(0);
      expect(res.byMonth).toEqual([]);
    });
  });

  describe("remove", () => {
    test("deal đã tạo đơn hàng → 409 (giữ dấu vết doanh thu)", async () => {
      mockClient.crmDeal.findUnique.mockResolvedValue({ id: "deal-1", dealName: "X", orderId: "order-1", dealOwnerId: "u1", kind: "WON" });
      await expect(dealsService.remove("deal-1", "u1", MANAGER)).rejects.toMatchObject({ status: 409 });
    });

    test("deal thường → xóa kèm timeline", async () => {
      mockClient.crmDeal.findUnique.mockResolvedValue({ id: "deal-1", dealName: "X", orderId: null, dealOwnerId: "u1", kind: "ONGOING" });
      const res = await dealsService.remove("deal-1", "u1", MANAGER);
      expect(res).toEqual({ id: "deal-1" });
      expect(mockClient.crmCommunication.deleteMany).toHaveBeenCalledWith({ where: { dealId: "deal-1" } });
    });
  });
});
