/**
 * tests/purchase-invoice.service.test.js â€” Test 3-Way Matching (Má»¥c 6.3)
 *
 * Trá»ng tÃ¢m: biÃªn dung sai Â±1% (Ä‘Ãºng 1% â†’ MATCHED; vÆ°á»£t 1% â†’ VARIANCE_HOLD),
 * GRN chÆ°a nháº­n (grnAmount = 0) â†’ PENDING, vÃ  CHáº¶N táº¡o Debt khi VARIANCE_HOLD.
 */
const mockClient = {
  purchaseInvoiceRecord: {
    findUnique: jest.fn(),
    update: jest.fn(),
    create: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
  },
  purchaseOrder: { findUnique: jest.fn(), update: jest.fn() },
  goodsReceiptItem: { findMany: jest.fn().mockResolvedValue([]) },
  $transaction: jest.fn((fn) => fn(mockClient)),
};

jest.mock("../src/config/prisma", () => mockClient);
jest.mock("../src/modules/debt/debt.service", () => ({
  createPayableForPoInTx: jest.fn().mockResolvedValue({ id: "debt-1" }),
}));
jest.mock("../src/modules/notifications/notification.service", () => ({
  createOne: jest.fn().mockResolvedValue({}),
}));
jest.mock("../src/modules/audit/audit.service", () => ({ log: jest.fn().mockResolvedValue({}) }));

const service = require("../src/modules/accounting/purchase-invoice.service");
const debtService = require("../src/modules/debt/debt.service");
const notificationService = require("../src/modules/notifications/notification.service");

describe("purchase-invoice.service â€” 3-Way Matching (Má»¥c 6.3)", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("evaluateVariance â€” biÃªn dung sai Â±1%", () => {
    test("lá»‡ch ÄÃšNG 1% â†’ MATCHED (biÃªn trÃªn Ä‘Æ°á»£c cháº¥p nháº­n)", () => {
      const r = service.evaluateVariance(10_100_000, 10_000_000);
      expect(r.variancePct).toBe(0.01);
      expect(r.status).toBe("MATCHED");
    });

    test("lá»‡ch Vá»ªA DÆ¯á»šI 1% â†’ MATCHED", () => {
      const r = service.evaluateVariance(10_099_000, 10_000_000);
      expect(r.variancePct).toBeLessThan(0.01);
      expect(r.status).toBe("MATCHED");
    });

    test("lá»‡ch Vá»ªA TRÃŠN 1% â†’ VARIANCE_HOLD (cháº·n thanh toÃ¡n)", () => {
      const r = service.evaluateVariance(10_101_000, 10_000_000);
      expect(r.variancePct).toBeGreaterThan(0.01);
      expect(r.status).toBe("VARIANCE_HOLD");
    });

    test("lá»‡ch Ã¢m (hoÃ¡ Ä‘Æ¡n tháº¥p hÆ¡n GRN) â†’ dÃ¹ng trá»‹ tuyá»‡t Ä‘á»‘i", () => {
      const r = service.evaluateVariance(9_900_000, 10_000_000);
      expect(r.varianceAmount).toBe(100_000);
      expect(r.variancePct).toBe(0.01);
      expect(r.status).toBe("MATCHED");
    });

    test("khá»›p tuyá»‡t Ä‘á»‘i â†’ MATCHED, variance = 0", () => {
      const r = service.evaluateVariance(10_000_000, 10_000_000);
      expect(r.varianceAmount).toBe(0);
      expect(r.variancePct).toBe(0);
      expect(r.status).toBe("MATCHED");
    });

    test("grnAmount = 0 (chÆ°a nháº­n hÃ ng) â†’ PENDING, khÃ´ng káº¿t luáº­n lá»‡ch", () => {
      expect(service.evaluateVariance(5_000_000, 0)).toEqual({
        status: "PENDING",
        varianceAmount: null,
        variancePct: null,
      });
    });

    test("grnAmount null/undefined â†’ PENDING (khÃ´ng chia cho 0)", () => {
      expect(service.evaluateVariance(5_000_000, null).status).toBe("PENDING");
      expect(service.evaluateVariance(5_000_000, undefined).status).toBe("PENDING");
    });

    test("TOLERANCE = 0.01 theo Ä‘áº·c táº£", () => {
      expect(service.TOLERANCE).toBe(0.01);
    });
  });

  describe("computeGrnAmount â€” Î£ passQty Ã— unitCost cá»§a GRN POSTED", () => {
    test("tÃ­nh Ä‘Ãºng tá»•ng, bá» qua rejectQty", async () => {
      mockClient.goodsReceiptItem.findMany.mockResolvedValue([
        { passQty: 3, purchaseItem: { unitCost: 100_000 } },
        { passQty: 2, purchaseItem: { unitCost: 50_000 } },
      ]);
      expect(await service.computeGrnAmount("po-1", mockClient)).toBe(400_000);
    });

    test("khÃ´ng cÃ³ dÃ²ng GRN POSTED â†’ 0", async () => {
      mockClient.goodsReceiptItem.findMany.mockResolvedValue([]);
      expect(await service.computeGrnAmount("po-1", mockClient)).toBe(0);
    });

    test("chá»‰ láº¥y GRN Ä‘Ã£ POSTED cá»§a Ä‘Ãºng PO", async () => {
      mockClient.goodsReceiptItem.findMany.mockResolvedValue([]);
      await service.computeGrnAmount("po-9", mockClient);
      const where = mockClient.goodsReceiptItem.findMany.mock.calls[0][0].where;
      expect(where.grn).toEqual({ purchaseOrderId: "po-9", status: "POSTED" });
    });
  });

  describe("match â€” block thanh toÃ¡n khi VARIANCE_HOLD", () => {
    test("lá»‡ch > 1% â†’ VARIANCE_HOLD + KHÃ”NG táº¡o Debt + Notification ADMIN/ACCOUNTANT", async () => {
      mockClient.purchaseInvoiceRecord.findUnique.mockResolvedValue({
        id: "pir-1",
        purchaseOrderId: "po-1",
        invoiceNumber: "INV-001",
        invoiceAmount: 12_000_000,
        matchStatus: "PENDING",
        purchaseOrder: { poCode: "PO-001", total: 10_000_000 },
      });
      // grnAmount = 10.000.000 â†’ lá»‡ch 20%
      mockClient.goodsReceiptItem.findMany.mockResolvedValue([
        { passQty: 10, purchaseItem: { unitCost: 1_000_000 } },
      ]);
      mockClient.purchaseInvoiceRecord.update.mockResolvedValue({
        id: "pir-1",
        matchStatus: "VARIANCE_HOLD",
      });

      const res = await service.match("pir-1", "user-1");

      expect(res.matchStatus).toBe("VARIANCE_HOLD");
      // CHáº¶N thanh toÃ¡n: tuyá»‡t Ä‘á»‘i khÃ´ng táº¡o cÃ´ng ná»£ pháº£i tráº£
      expect(debtService.createPayableForPoInTx).not.toHaveBeenCalled();
      // Cáº£nh bÃ¡o ADMIN + ACCOUNTANT
      expect(notificationService.createOne).toHaveBeenCalledTimes(2);
      expect(notificationService.createOne).toHaveBeenCalledWith(
        expect.objectContaining({ severity: "CRITICAL" }),
      );
      const updateData = mockClient.purchaseInvoiceRecord.update.mock.calls[0][0].data;
      expect(updateData.matchStatus).toBe("VARIANCE_HOLD");
      expect(updateData.matchedAt).toBeNull();
    });

    test("lá»‡ch <= 1% â†’ MATCHED + táº¡o Debt PAYABLE qua debt.service", async () => {
      mockClient.purchaseInvoiceRecord.findUnique.mockResolvedValue({
        id: "pir-2",
        purchaseOrderId: "po-2",
        invoiceNumber: "INV-002",
        invoiceAmount: 10_050_000, // lá»‡ch 0.5%
        matchStatus: "PENDING",
        purchaseOrder: { poCode: "PO-002", total: 10_000_000 },
      });
      mockClient.goodsReceiptItem.findMany.mockResolvedValue([
        { passQty: 10, purchaseItem: { unitCost: 1_000_000 } },
      ]);
      mockClient.purchaseInvoiceRecord.update.mockResolvedValue({
        id: "pir-2",
        purchaseOrderId: "po-2",
        matchStatus: "MATCHED",
      });
      mockClient.purchaseOrder.findUnique.mockResolvedValue({
        id: "po-2",
        poCode: "PO-002",
        vendor: { id: "v1" },
        items: [],
      });

      const res = await service.match("pir-2", "user-1");

      expect(res.matchStatus).toBe("MATCHED");
      expect(debtService.createPayableForPoInTx).toHaveBeenCalled();
      expect(notificationService.createOne).not.toHaveBeenCalled();
    });

    test("chÆ°a cÃ³ GRN POSTED â†’ giá»¯ PENDING, khÃ´ng táº¡o Debt", async () => {
      mockClient.purchaseInvoiceRecord.findUnique.mockResolvedValue({
        id: "pir-3",
        purchaseOrderId: "po-3",
        invoiceNumber: "INV-003",
        invoiceAmount: 10_000_000,
        matchStatus: "PENDING",
        purchaseOrder: { poCode: "PO-003", total: 10_000_000 },
      });
      mockClient.goodsReceiptItem.findMany.mockResolvedValue([]);
      mockClient.purchaseInvoiceRecord.update.mockResolvedValue({
        id: "pir-3",
        matchStatus: "PENDING",
      });

      const res = await service.match("pir-3", "user-1");

      expect(res.matchStatus).toBe("PENDING");
      expect(debtService.createPayableForPoInTx).not.toHaveBeenCalled();
    });

    test("idempotent: record Ä‘Ã£ MATCHED â†’ tráº£ nguyÃªn tráº¡ng, khÃ´ng cháº¡y láº¡i", async () => {
      const existing = { id: "pir-5", matchStatus: "MATCHED", purchaseOrderId: "po-5" };
      mockClient.purchaseInvoiceRecord.findUnique.mockResolvedValue(existing);

      const res = await service.match("pir-5", "user-1");

      expect(res).toBe(existing);
      expect(mockClient.goodsReceiptItem.findMany).not.toHaveBeenCalled();
      expect(mockClient.purchaseInvoiceRecord.update).not.toHaveBeenCalled();
    });

    test("record khÃ´ng tá»“n táº¡i â†’ 404", async () => {
      mockClient.purchaseInvoiceRecord.findUnique.mockResolvedValue(null);
      await expect(service.match("missing", "user-1")).rejects.toMatchObject({ status: 404 });
    });
  });
});
