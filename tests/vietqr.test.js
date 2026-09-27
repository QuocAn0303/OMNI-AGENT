/**
 * tests/vietqr.test.js
 * Phase C: VietQR Payment Verification tests
 */
jest.mock("../src/config/prisma", () => {
  const m = {};
  m.order = { findFirst: jest.fn(), findMany: jest.fn() };
  m.debt = { findFirst: jest.fn(), findUnique: jest.fn(), update: jest.fn() };
  m.payment = { findFirst: jest.fn(), findMany: jest.fn() };
  m.debtPayment = { create: jest.fn().mockResolvedValue({}) };
  m.user = { findFirst: jest.fn().mockResolvedValue({ id: "sys-user" }) };
  return m;
});
jest.mock("../src/modules/payments/payment.service", () => ({
  recordPayment: jest.fn(),
  getOrderBalance: jest.fn(),
}));
jest.mock("../src/config/payos", () => ({
  verifyWebhook: jest.fn(),
}));

const prisma = require("../src/config/prisma");
const { processWebhook, matchTransaction } = require("../src/modules/vietqr/vietqr.service");
const paymentService = require("../src/modules/payments/payment.service");

// Webhook hợp lệ từ Casso/SePay đã được route verify → processWebhook(body, provider, true)
const verified = true;

describe("vietqr — webhook processing", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.user.findFirst.mockResolvedValue({ id: "sys-user" });
  });

  // ════════════════ WEBOOK VALIDATION ════════════════
  describe("processWebhook — validation", () => {
    test("should reject unverified webhook (no verified flag)", async () => {
      const result = await processWebhook({ amount: 500000, description: "test" }, "casso");
      expect(result.success).toBe(false);
      expect(result.message).toBe("Verification failed");
      expect(paymentService.recordPayment).not.toHaveBeenCalled();
    });

    test("should reject zero amount transaction", async () => {
      const result = await processWebhook({ amount: 0, description: "test" }, "casso", verified);
      expect(result.success).toBe(false);
      expect(result.message).toContain("amount");
    });

    test("should reject negative amount transaction", async () => {
      const result = await processWebhook({ amount: -100000, description: "test" }, "casso", verified);
      expect(result.success).toBe(false);
    });

    test("should reject transaction with no amount field", async () => {
      const result = await processWebhook({ description: "test" }, "casso", verified);
      expect(result.success).toBe(false);
    });

    test("should skip already-processed reference", async () => {
      prisma.payment.findFirst.mockResolvedValue({ id: "existing", reference: "TXN-123" });

      const result = await processWebhook({
        amount: 500000, description: "Payment", reference: "TXN-123",
      }, "casso", verified);

      expect(result.alreadyProcessed).toBe(true);
      expect(paymentService.recordPayment).not.toHaveBeenCalled();
    });
  });

  // ════════════════ TRANSACTION MATCHING ════════════════
  describe("matchTransaction", () => {
    test("should match by order code in description", async () => {
      prisma.order.findMany.mockResolvedValue([
        {
          id: "order1", orderCode: "ORD-20260625-0001", total: 1000000, paymentStatus: "UNPAID", tenantId: "tenant-1",
        },
      ]);

      const matches = await matchTransaction({
        amount: 500000, description: "TT đơn hàng ORD-20260625-0001", reference: "T1",
      });

      expect(matches).toHaveLength(1);
      expect(matches[0].type).toBe("ORDER");
      expect(matches[0].id).toBe("order1");
      expect(matches[0].tenantId).toBe("tenant-1");
    });

    test("should disambiguate same order code across tenants by amount", async () => {
      prisma.order.findMany.mockResolvedValue([
        { id: "orderA", orderCode: "ORD-20260625-0001", total: 900000, paymentStatus: "UNPAID", tenantId: "tenant-a" },
        { id: "orderB", orderCode: "ORD-20260625-0001", total: 500000, paymentStatus: "UNPAID", tenantId: "tenant-b" },
      ]);
      paymentService.getOrderBalance
        .mockResolvedValueOnce({ total: 900000, paid: 0, remaining: 900000 })
        .mockResolvedValueOnce({ total: 500000, paid: 0, remaining: 500000 });

      const matches = await matchTransaction({
        amount: 500000, description: "TT don ORD-20260625-0001", reference: "T1",
      });

      expect(matches).toHaveLength(1);
      expect(matches[0].id).toBe("orderB");
      expect(matches[0].tenantId).toBe("tenant-b");
    });

    test("should match by debt code in description", async () => {
      prisma.order.findMany.mockResolvedValue([]);
      prisma.debt.findFirst.mockResolvedValue({
        id: "debt-123-abc", customerId: "c1", amount: 2000000, paidAmount: 0, tenantId: "tenant-1",
      });

      const matches = await matchTransaction({
        amount: 500000, description: "Tra no DEBT-123", reference: "T2",
      });

      expect(matches).toHaveLength(1);
      expect(matches[0].type).toBe("DEBT");
    });

    test("should match by amount with 5% tolerance", async () => {
      prisma.order.findMany.mockResolvedValue([]);
      prisma.debt.findFirst.mockResolvedValue(null);
      prisma.order.findMany.mockResolvedValue([
        { id: "order2", orderCode: "ORD-001", total: 500000, paymentStatus: "UNPAID", tenantId: "tenant-1" },
      ]);
      paymentService.getOrderBalance.mockResolvedValue({ total: 500000, paid: 0, remaining: 500000 });

      const matches = await matchTransaction({
        amount: 502000, description: "Chuyen tien", reference: "T3",
      });

      expect(matches).toHaveLength(1);
      expect(matches[0].id).toBe("order2");
    });

    test("should return empty if no match found", async () => {
      prisma.order.findMany.mockResolvedValue([]);
      prisma.debt.findFirst.mockResolvedValue(null);
      prisma.order.findMany.mockResolvedValue([]);

      const matches = await matchTransaction({
        amount: 123456, description: "Random transfer", reference: "T99",
      });

      expect(matches).toHaveLength(0);
    });
  });

  // ════════════════ PAYMENT RECORDING ════════════════
  describe("processWebhook — payment recording", () => {
    test("should record payment for matched order", async () => {
      prisma.order.findMany.mockResolvedValue([
        {
          id: "order1", orderCode: "ORD-20260625-0001", total: 1000000, paymentStatus: "UNPAID", tenantId: "tenant-1",
        },
      ]);
      paymentService.recordPayment.mockResolvedValue({
        id: "pay1", order: { orderCode: "ORD-20260625-0001" },
      });
      prisma.payment.findFirst.mockResolvedValue(null);

      const result = await processWebhook({
        amount: 500000, description: "TT don ORD-20260625-0001", reference: "TXN-NEW",
      }, "casso", verified);

      expect(result.success).toBe(true);
      expect(result.matched).toBe(true);
      expect(paymentService.recordPayment).toHaveBeenCalledWith(
        expect.objectContaining({
          orderId: "order1",
          amount: 500000,
          method: "BANK_TRANSFER",
        }),
        "sys-user"
      );
    });

    test("should not crash when payment match yields no user", async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      prisma.order.findMany.mockResolvedValue([
        {
          id: "order1", orderCode: "ORD-20260625-0001", total: 1000000, paymentStatus: "UNPAID", tenantId: "tenant-1",
        },
      ]);
      paymentService.recordPayment.mockResolvedValue({
        id: "pay1", order: { orderCode: "ORD-20260625-0001" },
      });
      prisma.payment.findFirst.mockResolvedValue(null);

      const result = await processWebhook({
        amount: 500000, description: "TT ORD-20260625-0001", reference: "TXN-456",
      }, "casso", verified);

      // Should still work but with null userId
      expect(result.success).toBe(true);
    });

    test("should mark as unmatched when no matching order/debt", async () => {
      prisma.order.findMany.mockResolvedValue([]);
      prisma.debt.findFirst.mockResolvedValue(null);
      prisma.payment.findFirst.mockResolvedValue(null);

      const result = await processWebhook({
        amount: 987654, description: "Unknown transfer", reference: "TXN-U",
      }, "casso", verified);

      expect(result.unmatched).toBe(true);
    });
  });

  // ════════════════ MULTI-MATCH SCENARIOS ════════════════
  describe("processWebhook — complex scenarios", () => {
    test("description with both order code and debt code — order takes priority", async () => {
      prisma.order.findMany.mockResolvedValue([
        {
          id: "order1", orderCode: "ORD-20260625-0001", total: 1000000, paymentStatus: "UNPAID", tenantId: "tenant-1",
        },
      ]);
      paymentService.recordPayment.mockResolvedValue({
        id: "pay1", order: { orderCode: "ORD-20260625-0001" },
      });
      prisma.payment.findFirst.mockResolvedValue(null);

      const result = await processWebhook({
        amount: 500000, description: "TT don ORD-20260625-0001 va DEBT-123", reference: "TXN-X",
      }, "casso", verified);

      expect(result.results).toHaveLength(1);
      expect(result.results[0].type).toBe("ORDER");
    });

    test("very large payment amount — should still match", async () => {
      prisma.order.findMany.mockResolvedValue([
        {
          id: "orderB", orderCode: "ORD-20260625-9999", total: 500_000_000, paymentStatus: "UNPAID", tenantId: "tenant-1",
        },
      ]);
      paymentService.recordPayment.mockResolvedValue({
        id: "payB", order: { orderCode: "ORD-20260625-9999" },
      });
      prisma.payment.findFirst.mockResolvedValue(null);

      const result = await processWebhook({
        amount: 500_000_000, description: "TT ORD-20260625-9999", reference: "TXN-BIG",
      }, "casso", verified);

      expect(result.success).toBe(true);
      expect(result.matched).toBe(true);
    });

    test("payment matching a debt should update debt status", async () => {
      prisma.order.findMany.mockResolvedValue([]);
      prisma.debt.findFirst.mockResolvedValue({
        id: "debt-x", customerId: "c1", amount: 1000000, paidAmount: 0, status: "OPEN", tenantId: "tenant-1",
      });
      prisma.debt.findUnique.mockResolvedValue({
        id: "debt-x", customerId: "c1", amount: 1000000, paidAmount: 0,
      });
      prisma.payment.findFirst.mockResolvedValue(null);

      const result = await processWebhook({
        amount: 1000000, description: "Tra no DEBT-X", reference: "TXN-DEBT",
      }, "casso", verified);

      expect(result.matched).toBe(true);
      expect(prisma.debt.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "CLOSED" }),
        })
      );
    });

    test("partial debt payment should set status to PARTIAL", async () => {
      prisma.order.findMany.mockResolvedValue([]);
      prisma.debt.findFirst.mockResolvedValue({
        id: "debt-p", customerId: "c2", amount: 5000000, paidAmount: 0, status: "OPEN", tenantId: "tenant-1",
      });
      prisma.debt.findUnique.mockResolvedValue({
        id: "debt-p", customerId: "c2", amount: 5000000, paidAmount: 0,
      });
      prisma.payment.findFirst.mockResolvedValue(null);

      const result = await processWebhook({
        amount: 2000000, description: "Tra no DEBT-debt-p", reference: "TXN-PART",
      }, "casso", verified);

      expect(prisma.debt.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "PARTIAL", paidAmount: 2000000 }),
        })
      );
    });
  });
});
