/**
 * tests/portal.test.js
 * Phase E: Customer Portal tests (self-order, VietQR pay, rewards, validation)
 */
jest.mock("../src/config/prisma", () => {
  const m = {};
  m.$transaction = jest.fn(async (arg) => {
    if (typeof arg === "function") return arg(m);
    return arg;
  });

  m.product = {
    findUnique: jest.fn(),
    findMany: jest.fn(),
  };
  m.customer = {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
  };
  m.order = {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
  };
  m.debt = {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
  };
  m.bankAccount = {
    findFirst: jest.fn(),
    findMany: jest.fn(),
  };
  m.electronicInvoice = {
    findMany: jest.fn(),
    findUnique: jest.fn(),
  };
  m.portalOtp = {
    findFirst: jest.fn(),
    updateMany: jest.fn().mockResolvedValue({}),
    update: jest.fn().mockResolvedValue({}),
    create: jest.fn().mockResolvedValue({}),
  };
  m.portalSession = {
    findUnique: jest.fn(),
    create: jest.fn().mockResolvedValue({}),
  };
  m.promotion = {
    findMany: jest.fn(),
  };
  m.loyaltyTransaction = {
    findMany: jest.fn(),
    create: jest.fn().mockResolvedValue({}),
  };
  m.workflowRun = {
    findMany: jest.fn().mockResolvedValue([]),
    findUnique: jest.fn(),
  };
  return m;
});
jest.mock("../src/utils/sms", () => ({ sendSms: jest.fn() }));
jest.mock("../src/modules/orders/order.service", () => ({
  create: jest.fn(),
}));
jest.mock("../src/modules/notifications/notification.service", () => ({
  notifyRoles: jest.fn().mockResolvedValue({}),
}));
jest.mock("../src/modules/workflow/workflow.service", () => ({
  trigger: jest.fn().mockResolvedValue([]),
}));
jest.mock("../src/utils/vietqr", () => ({
  buildVietQRString: jest.fn().mockReturnValue("00020101021238570010A00000072701270008VCB"),
}));

const prisma = require("../src/config/prisma");
const {
  createMyOrder,
  payMyDebt,
  getMyRewards,
  redeemReward,
  requestOtp,
  verifyOtp,
} = require("../src/modules/portal/portal.service");
const orderService = require("../src/modules/orders/order.service");
const workflowService = require("../src/modules/workflow/workflow.service");
const { buildVietQRString } = require("../src/utils/vietqr");

describe("portal — customer self-service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ════════════════ SELF-ORDER (B2B) ════════════════
  describe("createMyOrder", () => {
    test("should create order with valid items", async () => {
      prisma.product.findMany.mockResolvedValue([
        { id: "p1", name: "Sản phẩm A", price: 200000, isActive: true },
      ]);
      orderService.create.mockResolvedValue({
        orderCode: "ORD-20260625-0010", total: 400000, items: [],
      });

      const result = await createMyOrder("c1", {
        items: [{ productId: "p1", quantity: 2 }],
        paymentMethod: "BANK_TRANSFER",
        note: "Dat hang qua portal",
      });

      expect(result.orderCode).toBe("ORD-20260625-0010");
      expect(result.total).toBe(400000);
      expect(orderService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          customerId: "c1",
          paymentMethod: "BANK_TRANSFER",
          items: [{ productId: "p1", quantity: 2, price: 200000 }],
        }),
        null
      );
    });

    test("should reject order with no items", async () => {
      await expect(
        createMyOrder("c1", { items: [] })
      ).rejects.toEqual(expect.objectContaining({ status: 400 }));
    });

    test("should reject order with non-existent product", async () => {
      prisma.product.findMany.mockResolvedValue([]);

      await expect(
        createMyOrder("c1", {
          items: [{ productId: "ghost", quantity: 1 }],
        })
      ).rejects.toEqual(expect.objectContaining({ status: 404 }));
    });

    test("should reject order with inactive product", async () => {
      prisma.product.findMany.mockResolvedValue([]);

      await expect(
        createMyOrder("c1", {
          items: [{ productId: "p-disabled", quantity: 1 }],
        })
      ).rejects.toEqual(expect.objectContaining({ status: 404 }));
    });

    test("should enforce minimum quantity of 1", async () => {
      prisma.product.findMany.mockResolvedValue([
        { id: "p1", name: "A", price: 100000, isActive: true },
      ]);
      orderService.create.mockResolvedValue({
        orderCode: "ORD-001", total: 100000, items: [],
      });

      const result = await createMyOrder("c1", {
        items: [{ productId: "p1", quantity: -5 }],
      });

      // quantity should be clamped to 1
      expect(orderService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          items: [{ productId: "p1", quantity: 1, price: 100000 }],
        }),
        null
      );
    });

    test("should handle multiple items in one order", async () => {
      prisma.product.findMany.mockResolvedValue([
        { id: "p1", name: "A", price: 100000, isActive: true },
        { id: "p2", name: "B", price: 200000, isActive: true },
      ]);
      orderService.create.mockResolvedValue({
        orderCode: "ORD-MULTI", total: 500000, items: [],
      });

      const result = await createMyOrder("c1", {
        items: [
          { productId: "p1", quantity: 1 },
          { productId: "p2", quantity: 2 },
        ],
      });

      expect(result.items).toBe(2);
    });
  });

  // ════════════════ PAY DEBT VIA VIETQR ════════════════
  describe("payMyDebt", () => {
    test("should return zero when no debts", async () => {
      prisma.debt.findMany.mockResolvedValue([]);

      const result = await payMyDebt("c1");

      expect(result.totalOwed).toBe(0);
      expect(result.qrCode).toBeNull();
      expect(result.message).toContain("Không có công nợ");
    });

    test("should calculate total owed from multiple debts", async () => {
      prisma.debt.findMany.mockResolvedValue([
        { id: "d1", amount: 5000000, paidAmount: 2000000, status: "OPEN", dueDate: new Date(), type: "RECEIVABLE", payments: [] },
        { id: "d2", amount: 3000000, paidAmount: 0, status: "PARTIAL", dueDate: new Date(), type: "RECEIVABLE", payments: [] },
      ]);

      const result = await payMyDebt("c1");

      expect(result.totalOwed).toBe(6000000);
    });

    test("should generate VietQR with bank account info", async () => {
      prisma.debt.findMany.mockResolvedValue([
        { id: "d1", amount: 1000000, paidAmount: 0, status: "OPEN", dueDate: new Date(), type: "RECEIVABLE", payments: [] },
      ]);
      prisma.bankAccount.findFirst.mockResolvedValue({
        accountNumber: "1234567890", bankName: "VCB", accountName: "Cty ERP",
      });

      const result = await payMyDebt("c1");

      expect(result.qrCode).toBeDefined();
      expect(result.bankInfo.bankName).toBe("VCB");
      expect(result.bankInfo.accountNumber).toBe("1234567890");
      expect(buildVietQRString).toHaveBeenCalledWith(
        expect.objectContaining({
          bankBin: "970436",
          accountNumber: "1234567890",
          amount: 1000000,
        })
      );
    });

    test("should return null QR when no bank account configured", async () => {
      prisma.debt.findMany.mockResolvedValue([
        { id: "d1", amount: 500000, paidAmount: 0, status: "OPEN", dueDate: new Date(), type: "RECEIVABLE", payments: [] },
      ]);
      prisma.bankAccount.findFirst.mockResolvedValue(null);

      const result = await payMyDebt("c1");

      expect(result.qrCode).toBeNull();
      expect(result.bankInfo).toBeNull();
    });

    test("should handle debt with partial payments correctly", async () => {
      prisma.debt.findMany.mockResolvedValue([
        { id: "d1", amount: 10000000, paidAmount: 7500000, status: "PARTIAL", dueDate: new Date(), type: "RECEIVABLE", payments: [] },
      ]);

      const result = await payMyDebt("c1");

      expect(result.totalOwed).toBe(2500000);
      expect(result.debts[0].remaining).toBe(2500000);
    });
  });

  // ════════════════ LOYALTY REWARDS ════════════════
  describe("getMyRewards", () => {
    test("should return rewards based on points", async () => {
      prisma.customer.findUnique.mockResolvedValue({
        loyaltyPoints: 750, tier: "GOLD", totalSpent: 50000000,
      });
      prisma.promotion.findMany.mockResolvedValue([]);
      prisma.loyaltyTransaction.findMany.mockResolvedValue([]);

      const result = await getMyRewards("c1");

      expect(result.points).toBe(750);
      expect(result.tier).toBe("GOLD");
      // 100-point reward should be redeemable
      expect(result.availableRewards[0].canRedeem).toBe(true);
      // 500-point reward should be redeemable
      expect(result.availableRewards[1].canRedeem).toBe(true);
      // 1000-point reward NOT generated (not enough points)
    });

    test("should return only redeemable rewards for low-points customer", async () => {
      prisma.customer.findUnique.mockResolvedValue({
        loyaltyPoints: 120, tier: "BRONZE", totalSpent: 500000,
      });
      prisma.promotion.findMany.mockResolvedValue([]);
      prisma.loyaltyTransaction.findMany.mockResolvedValue([]);

      const result = await getMyRewards("c1");

      // 120 points → only 100-point reward is generated
      expect(result.availableRewards).toHaveLength(1);
      expect(result.availableRewards[0].canRedeem).toBe(true);
    });

    test("should include active promotions", async () => {
      prisma.customer.findUnique.mockResolvedValue({
        loyaltyPoints: 200, tier: "SILVER", totalSpent: 10000000,
      });
      prisma.promotion.findMany.mockResolvedValue([
        { id: "promo1", code: "SUMMER2026", name: "Summer Sale", type: "PERCENTAGE", value: 15, scope: "ORDER" },
      ]);
      prisma.loyaltyTransaction.findMany.mockResolvedValue([]);

      const result = await getMyRewards("c1");

      expect(result.activePromotions).toHaveLength(1);
    });
  });

  // ════════════════ REDEEM REWARDS ════════════════
  describe("redeemReward", () => {
    test("should deduct points and log transaction", async () => {
      prisma.customer.findUnique.mockResolvedValue({
        id: "c1", loyaltyPoints: 600,
      });

      const result = await redeemReward("c1", "reward_10k");

      expect(result.success).toBe(true);
      expect(prisma.customer.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { loyaltyPoints: { decrement: 100 } },
        })
      );
      expect(prisma.loyaltyTransaction.create).toHaveBeenCalled();
    });

    test("should reject when not enough points", async () => {
      prisma.customer.findUnique.mockResolvedValue({
        id: "c1", loyaltyPoints: 50,
      });

      await expect(
        redeemReward("c1", "reward_10k")
      ).rejects.toEqual(expect.objectContaining({ status: 400 }));
    });

    test("should reject invalid reward ID", async () => {
      prisma.customer.findUnique.mockResolvedValue({
        id: "c1", loyaltyPoints: 5000,
      });

      await expect(
        redeemReward("c1", "nonexistent")
      ).rejects.toEqual(expect.objectContaining({ status: 404 }));
    });

    test("should redeem highest-tier reward when eligible", async () => {
      prisma.customer.findUnique.mockResolvedValue({
        id: "c1", loyaltyPoints: 1500,
      });

      const result = await redeemReward("c1", "reward_100k");

      expect(result.success).toBe(true);
      expect(result.remainingPoints).toBe(500);
      expect(prisma.customer.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { loyaltyPoints: { decrement: 1000 } },
        })
      );
    });
  });

  // ════════════════ OTP AUTH ════════════════
  describe("requestOtp", () => {
    test("should send OTP to existing customer", async () => {
      prisma.customer.findFirst.mockResolvedValue({
        id: "c1", phone: "0901234567",
      });

      const result = await requestOtp("0901234567");

      expect(result.message).toContain("OTP");
      expect(prisma.portalOtp.create).toHaveBeenCalled();
    });

    test("should reject non-existent phone", async () => {
      prisma.customer.findFirst.mockResolvedValue(null);

      await expect(
        requestOtp("0999999999")
      ).rejects.toEqual(expect.objectContaining({ status: 404 }));
    });

    test("should invalidate old OTPs", async () => {
      prisma.customer.findFirst.mockResolvedValue({
        id: "c1", phone: "0901234567",
      });

      await requestOtp("0901234567");

      expect(prisma.portalOtp.updateMany).toHaveBeenCalled();
    });
  });

  describe("verifyOtp", () => {
    const crypto = require("crypto");
    const hash = (otp) => crypto.createHash("sha256").update(otp).digest("hex");

    test("should verify valid OTP and create session", async () => {
      prisma.portalOtp.findFirst.mockResolvedValue({
        id: "otp1", phone: "0901234567", otp: hash("123456"), used: false, attempts: 0,
        expiresAt: new Date(Date.now() + 300000),
      });
      prisma.customer.findFirst.mockResolvedValue({
        id: "c1", name: "Test KH", tenantId: "tenant-1",
      });

      const result = await verifyOtp("0901234567", "123456");

      expect(result.token).toBeDefined();
      expect(result.tenantId).toBe("tenant-1");
      expect(prisma.portalSession.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ customerId: "c1", tenantId: "tenant-1" }),
        })
      );
    });

    test("should reject wrong OTP", async () => {
      prisma.portalOtp.findFirst.mockResolvedValue(null);
      prisma.customer.findFirst.mockResolvedValue({ id: "c1", tenantId: "tenant-1" });

      await expect(
        verifyOtp("0901234567", "999999")
      ).rejects.toEqual(expect.objectContaining({ status: 401 }));
    });

    test("should increment attempts on wrong OTP", async () => {
      prisma.portalOtp.findFirst.mockResolvedValue({
        id: "otp1", phone: "0901234567", otp: hash("123456"), used: false, attempts: 0,
        expiresAt: new Date(Date.now() + 300000),
      });
      prisma.customer.findFirst.mockResolvedValue({ id: "c1", tenantId: "tenant-1" });

      await expect(
        verifyOtp("0901234567", "000000")
      ).rejects.toEqual(expect.objectContaining({ status: 401 }));

      expect(prisma.portalOtp.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ attempts: 1 }) })
      );
    });

    test("should block OTP after 5 wrong attempts", async () => {
      prisma.portalOtp.findFirst.mockResolvedValue({
        id: "otp1", phone: "0901234567", otp: hash("123456"), used: false, attempts: 4,
        expiresAt: new Date(Date.now() + 300000),
      });
      prisma.customer.findFirst.mockResolvedValue({ id: "c1", tenantId: "tenant-1" });

      await expect(
        verifyOtp("0901234567", "000000")
      ).rejects.toEqual(expect.objectContaining({ status: 429 }));

      expect(prisma.portalOtp.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ attempts: 5, used: true, blockedUntil: expect.any(Date) }),
        })
      );
    });

    test("should reject while OTP is blocked", async () => {
      prisma.portalOtp.findFirst.mockResolvedValue({
        id: "otp1", phone: "0901234567", otp: hash("123456"), used: false, attempts: 5,
        blockedUntil: new Date(Date.now() + 600000),
        expiresAt: new Date(Date.now() + 300000),
      });
      prisma.customer.findFirst.mockResolvedValue({ id: "c1", tenantId: "tenant-1" });

      await expect(
        verifyOtp("0901234567", "123456")
      ).rejects.toEqual(expect.objectContaining({ status: 429 }));
      expect(prisma.portalSession.create).not.toHaveBeenCalled();
    });
  });
});
