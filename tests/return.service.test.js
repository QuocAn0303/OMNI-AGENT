const returnService = require("../src/modules/returns/return.service");

jest.mock("../src/config/prisma", () => ({
  order: { findUnique: jest.fn() },
  orderItem: { findMany: jest.fn(), findUnique: jest.fn() },
  orderReturn: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    count: jest.fn().mockResolvedValue(0),
    create: jest.fn(),
    update: jest.fn(),
    aggregate: jest.fn(),
    updateMany: jest.fn(),
  },
  returnLineItem: {
    createMany: jest.fn(),
    findMany: jest.fn(),
    aggregate: jest.fn().mockResolvedValue({ _sum: { quantity: 0 } }),
  },
  inventory: { findUnique: jest.fn(), update: jest.fn() },
  inventoryTransaction: { create: jest.fn() },
  payment: { findMany: jest.fn(), create: jest.fn() },
  refund: { create: jest.fn() },
  $transaction: jest.fn((fn) => fn({
    orderReturn: {
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    returnLineItem: { aggregate: jest.fn().mockResolvedValue({ _sum: { quantity: 0 } }), createMany: jest.fn() },
    orderItem: { findUnique: jest.fn() },
    inventory: { findUnique: jest.fn(), update: jest.fn() },
    inventoryTransaction: { create: jest.fn() },
    payment: { create: jest.fn().mockResolvedValue({ id: "pmt1" }) },
    refund: { create: jest.fn() },
    debt: { findMany: jest.fn().mockResolvedValue([]) },
  })),
}));

jest.mock("../src/modules/audit/audit.service", () => ({
  log: jest.fn().mockResolvedValue(true),
}));

jest.mock("../src/modules/payments/payment.service", () => ({
  create: jest.fn().mockResolvedValue({ id: "pmt1" }),
  getPaidAmount: jest.fn().mockResolvedValue(100000),
  getPaymentStatus: jest.fn().mockReturnValue("PAID"),
}));

jest.mock("../src/utils/warehouse.helper", () => ({
  findInventory: jest.fn().mockResolvedValue({ id: "inv1", quantity: 10 }),
}));

jest.mock("../src/modules/accounting/autopost.service", () => ({
  postReturn: jest.fn().mockResolvedValue({}),
  buildOrderReturnEntry: jest.fn().mockReturnValue({}),
  postReturnEntry: jest.fn().mockResolvedValue({}),
  postOrderReturn: jest.fn().mockResolvedValue({}),
}));

jest.mock("../src/modules/accounting/posting-error.service", () => ({
  record: jest.fn().mockResolvedValue({}),
  tryPostOrQueue: jest.fn().mockResolvedValue({}),
}));

jest.mock("../src/modules/accounting/expense-auto.service", () => ({
  autoCreateExpense: jest.fn().mockResolvedValue({}),
  fromReturnRefund: jest.fn().mockResolvedValue({}),
}));

jest.mock("../src/modules/accounting/journal.service", () => ({
  withCodeRetry: jest.fn((_gen, callback) => callback("RET-001")),
}));

const prisma = require("../src/config/prisma");

describe("return.service", () => {
  beforeEach(() => jest.clearAllMocks());

  test("generateReturnCode tạo mã trả hàng", async () => {
    const code = await returnService.generateReturnCode();
    expect(code).toMatch(/^RET-\d{8}-\d{4}$/);
  });

  test("getReturnableItems trả về items có thể trả", async () => {
    const order = {
      id: "ord1",
      orderCode: "ORD-001",
      status: "COMPLETED",
      createdAt: new Date(),
      items: [
        { id: "item1", product: { name: "SP1" }, quantity: 2, unitPrice: 50000 },
      ],
    };
    prisma.order.findUnique.mockResolvedValue(order);
    prisma.orderReturn.findMany.mockResolvedValue([]);
    prisma.returnLineItem.aggregate = jest.fn().mockResolvedValue({ _sum: { quantity: 0 } });

    const result = await returnService.getReturnableItems("ord1");
    expect(result.items).toHaveLength(1);
  });

  test("getReturnableItems throw nếu đơn hàng không tồn tại", async () => {
    prisma.order.findUnique.mockResolvedValue(null);
    await expect(returnService.getReturnableItems("invalid"))
      .rejects.toMatchObject({ status: 404 });
  });

  test("create tạo yêu cầu trả hàng", async () => {
    prisma.order.findUnique.mockResolvedValue({
      id: "ord1",
      status: "COMPLETED",
      createdAt: new Date(),
      orderCode: "ORD-001",
      items: [{ id: "item1", product: { name: "SP1" }, quantity: 2, unitPrice: 50000, subtotal: 100000 }],
      payments: [{ id: "pmt1", amount: 100000 }],
      customerId: "c1",
      subtotal: 100000,
      discountAmount: 0,
      total: 100000,
      paymentStatus: "PAID",
      customer: { id: "c1", name: "Test" },
    });
    prisma.orderItem.findUnique.mockResolvedValue({
      id: "item1", product: { name: "SP1" }, quantity: 2, unitPrice: 50000,
    });
    prisma.orderReturn.findMany.mockResolvedValue([{ id: "ret1", status: "PENDING", totalRefundAmount: 0 }]);
    prisma.orderReturn.aggregate = jest.fn().mockResolvedValue({ _sum: { refundAmount: 0 } });
    prisma.orderReturn.create.mockResolvedValue({ id: "ret1", returnCode: "RET-001", status: "PENDING" });
    prisma.returnLineItem.aggregate = jest.fn().mockResolvedValue({ _sum: { quantity: 0 } });

    const data = { orderId: "ord1", reason: "DEFECTIVE", refundMethod: "CASH", lineItems: [{ type: "RETURN", orderItemId: "item1", productId: "p1", quantity: 1 }] };
    const result = await returnService.create(data, "user1");
    expect(result.status).toBe("PENDING");
  });

  test("create throw nếu order không tồn tại", async () => {
    prisma.order.findUnique.mockResolvedValue(null);
    await expect(returnService.create({ orderId: "invalid" }, "user1"))
      .rejects.toMatchObject({ status: 404 });
  });

  test("getAll trả về danh sách trả hàng", async () => {
    prisma.orderReturn.findMany.mockResolvedValue([{ id: "ret1", returnCode: "RET-001" }]);
    prisma.orderReturn.count.mockResolvedValue(1);

    const result = await returnService.getAll({ page: 1, limit: 20 });
    expect(result.returns).toHaveLength(1);
  });

  test("getById throw 404 nếu không tìm thấy", async () => {
    prisma.orderReturn.findUnique.mockResolvedValue(null);
    await expect(returnService.getById("invalid"))
      .rejects.toMatchObject({ status: 404 });
  });

  test("getByOrderId trả về returns của order", async () => {
    prisma.orderReturn.findMany.mockResolvedValue([{ id: "ret1", returnCode: "RET-001" }]);
    const result = await returnService.getByOrderId("ord1");
    expect(result).toHaveLength(1);
  });

  test("approve duyệt yêu cầu trả hàng", async () => {
    prisma.orderReturn.findUnique.mockResolvedValue({ id: "ret1", status: "PENDING", orderId: "ord1", order: { status: "COMPLETED" } });
    prisma.orderReturn.update.mockResolvedValue({ id: "ret1", status: "APPROVED" });

    const result = await returnService.approve("ret1", "user1", "ADMIN");
    expect(result.status).toBe("APPROVED");
  });

  test("complete hoàn tất trả hàng", async () => {
    prisma.orderReturn.findUnique.mockResolvedValue({ id: "ret1", status: "APPROVED", orderId: "ord1", order: { status: "COMPLETED", customerId: "c1" }, lineItems: [{ type: "RETURN", orderItemId: "item1", productId: "p1", quantity: 1 }] });
    prisma.$transaction.mockImplementation(async (fn) => fn({
      orderReturn: {
        findUnique: jest.fn()
          .mockResolvedValueOnce({
            id: "ret1", status: "APPROVED", orderId: "ord1", returnCode: "RET-001", refundAmount: 50000, refundMethod: "CASH", restockable: true,
            order: { status: "COMPLETED", customerId: "c1", warehouseId: "w1", debt: null },
            lineItems: [{ type: "RETURN", orderItemId: "item1", productId: "p1", quantity: 1, subtotal: 50000, refundAmount: 50000, orderItem: { id: "item1", product: { id: "p1", name: "SP1", inventories: [{ id: "inv1", quantity: 10 }] } }, product: { id: "p1", name: "SP1" } }],
          })
          .mockResolvedValueOnce({
            id: "ret1", status: "COMPLETED", orderId: "ord1", returnCode: "RET-001", refundAmount: 50000, refundMethod: "CASH", restockable: true,
            order: { status: "COMPLETED", customerId: "c1", debt: null, total: 100000 },
            lineItems: [{ type: "RETURN", orderItemId: "item1", productId: "p1", quantity: 1, orderItem: { id: "item1", product: { id: "p1", name: "SP1" } }, product: { id: "p1", name: "SP1" } }],
          }),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      returnLineItem: { aggregate: jest.fn().mockResolvedValue({ _sum: { quantity: 0 } }) },
      orderItem: { findUnique: jest.fn().mockResolvedValue({ id: "item1", productId: "p1" }) },
      inventory: { findUnique: jest.fn().mockResolvedValue({ id: "inv1", quantity: 10 }), update: jest.fn() },
      inventoryTransaction: { create: jest.fn() },
      payment: { findMany: jest.fn().mockResolvedValue([]), create: jest.fn() },
      refund: { create: jest.fn() },
      customer: { update: jest.fn() },
      order: { update: jest.fn() },
      debt: { findMany: jest.fn().mockResolvedValue([]), updateMany: jest.fn() },
    }));
    prisma.orderReturn.findMany.mockResolvedValue([]);

    const result = await returnService.complete("ret1", "user1");
    expect(result.status).toBe("COMPLETED");
  });

  test("reject từ chối yêu cầu trả hàng", async () => {
    prisma.orderReturn.findUnique.mockResolvedValue({ id: "ret1", status: "PENDING", orderId: "ord1" });
    prisma.orderReturn.update.mockResolvedValue({ id: "ret1", status: "REJECTED" });

    const result = await returnService.reject("ret1", "user1");
    expect(result.status).toBe("REJECTED");
  });
});
