/**
 * tests/grn.service.test.js — Test Phiếu nhập kho GRN (Mục 6.1/6.5 đặc tả SRM)
 *
 * Trọng tâm:
 * - Validate nhận hàng: PO phải APPROVED/ORDERED, item thuộc PO, KHÔNG nhận vượt.
 * - QC: passQty + rejectQty <= receivedQty.
 * - POSTED: chỉ nhập kho dòng passQty > 0 (reject KHÔNG vào tồn), tính onTime vs expectedAt.
 */
const mockTx = {
  goodsReceiptNote: { create: jest.fn(), update: jest.fn(), findUnique: jest.fn(), count: jest.fn() },
  goodsReceiptItem: { update: jest.fn(), aggregate: jest.fn().mockResolvedValue({ _sum: { receivedQty: 0 } }) },
  purchaseOrder: { update: jest.fn(), findUnique: jest.fn() },
  inventory: { create: jest.fn(), update: jest.fn(), findUnique: jest.fn() },
  inventoryTransaction: { create: jest.fn().mockResolvedValue({}) },
  inventoryLot: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn(), update: jest.fn() },
  product: { update: jest.fn() },
};

const mockClient = {
  purchaseOrder: { findUnique: jest.fn() },
  goodsReceiptItem: { findMany: jest.fn().mockResolvedValue([]) },
  goodsReceiptNote: { create: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), count: jest.fn() },
  $transaction: jest.fn((fn) => fn(mockTx)),
};

jest.mock("../src/config/prisma", () => mockClient);
jest.mock("../src/modules/accounting/journal.service", () => ({
  withCodeRetry: jest.fn(async (gen, fn) => fn(await gen())),
}));
jest.mock("../src/modules/audit/audit.service", () => ({ log: jest.fn().mockResolvedValue({}) }));

const service = require("../src/modules/accounting/grn.service");

const poFixture = {
  id: "po-1",
  poCode: "PO-260101-0001",
  status: "ORDERED",
  expectedAt: new Date("2026-01-10T00:00:00Z"),
  vendor: { id: "v1" },
  items: [{ id: "pi-1", quantity: 10, unitCost: 100_000 }],
};

describe("grn.service — Phiếu nhập kho (Mục 6.1)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockClient.goodsReceiptItem.findMany.mockResolvedValue([]);
    mockTx.goodsReceiptItem.aggregate.mockResolvedValue({ _sum: { receivedQty: 0 } });
    mockTx.inventoryLot.findFirst.mockResolvedValue(null);
    mockClient.$transaction.mockImplementation((fn) => fn(mockTx));
  });

  describe("create — validate nhận hàng", () => {
    test("không có dòng hàng → 400", async () => {
      await expect(service.create("po-1", { items: [] }, "u1")).rejects.toMatchObject({ status: 400 });
    });

    test("PO không tồn tại → 404", async () => {
      mockClient.purchaseOrder.findUnique.mockResolvedValue(null);
      await expect(
        service.create("po-x", { items: [{ purchaseItemId: "pi-1", productId: "p1", receivedQty: 1 }] }, "u1"),
      ).rejects.toMatchObject({ status: 404 });
    });

    test("PO chưa APPROVED/ORDERED → 400", async () => {
      mockClient.purchaseOrder.findUnique.mockResolvedValue({ ...poFixture, status: "PENDING_APPROVAL" });
      await expect(
        service.create("po-1", { items: [{ purchaseItemId: "pi-1", productId: "p1", receivedQty: 1 }] }, "u1"),
      ).rejects.toMatchObject({ status: 400 });
    });

    test("purchaseItemId không thuộc PO → 400", async () => {
      mockClient.purchaseOrder.findUnique.mockResolvedValue(poFixture);
      await expect(
        service.create("po-1", { items: [{ purchaseItemId: "pi-999", productId: "p1", receivedQty: 1 }] }, "u1"),
      ).rejects.toMatchObject({ status: 400 });
    });

    test("receivedQty < 1 → 400", async () => {
      mockClient.purchaseOrder.findUnique.mockResolvedValue(poFixture);
      await expect(
        service.create("po-1", { items: [{ purchaseItemId: "pi-1", productId: "p1", receivedQty: 0 }] }, "u1"),
      ).rejects.toMatchObject({ status: 400 });
    });

    test("nhận VƯỢT số lượng đặt → 400", async () => {
      mockClient.purchaseOrder.findUnique.mockResolvedValue(poFixture);
      await expect(
        service.create("po-1", { items: [{ purchaseItemId: "pi-1", productId: "p1", receivedQty: 11 }] }, "u1"),
      ).rejects.toMatchObject({ status: 400, message: expect.stringContaining("Nhận vượt") });
    });

    test("đã nhận 6/10 trước đó → nhận 5 sẽ vượt → 400", async () => {
      mockClient.purchaseOrder.findUnique.mockResolvedValue(poFixture);
      mockClient.goodsReceiptItem.findMany.mockResolvedValue([{ purchaseItemId: "pi-1", receivedQty: 6 }]);
      await expect(
        service.create("po-1", { items: [{ purchaseItemId: "pi-1", productId: "p1", receivedQty: 5 }] }, "u1"),
      ).rejects.toMatchObject({ status: 400 });
    });

    test("hợp lệ → tạo GRN DRAFT kèm mã GRN-YYYYMMDD-XXXX", async () => {
      mockClient.purchaseOrder.findUnique.mockResolvedValue(poFixture);
      mockClient.goodsReceiptNote.count.mockResolvedValue(0);
      mockClient.goodsReceiptNote.create.mockResolvedValue({ id: "grn-1", grnCode: "GRN-20260101-0001", status: "DRAFT" });

      const res = await service.create(
        "po-1",
        { items: [{ purchaseItemId: "pi-1", productId: "p1", receivedQty: 4 }] },
        "u1",
      );

      expect(res.status).toBe("DRAFT");
      const arg = mockClient.goodsReceiptNote.create.mock.calls[0][0].data;
      expect(arg.grnCode).toMatch(/^GRN-\d{8}-\d{4}$/);
      expect(arg.warehouseId).toBe("wh-test"); // từ setup.js mock
    });
  });
});
