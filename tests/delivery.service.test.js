const deliveryService = require("../src/modules/delivery/delivery.service");

const mockOrderUpdateStatus = jest.fn();
jest.mock("../src/modules/orders/order.service", () => ({
  updateStatus: (...args) => mockOrderUpdateStatus(...args),
}));

jest.mock("../src/config/prisma", () => ({
  order: { findUnique: jest.fn() },
  delivery: {
    create: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
  },
  deliveryEvent: { create: jest.fn(), findMany: jest.fn(), findFirst: jest.fn().mockResolvedValue(null) },
  $transaction: jest.fn((fn) => fn({ deliveryEvent: { create: jest.fn().mockResolvedValue({ occurredAt: new Date() }) }, delivery: { update: jest.fn() }, order: { findUnique: jest.fn().mockResolvedValue({ status: "SHIPPING" }) } })),
}));

jest.mock("../src/modules/audit/audit.service", () => ({
  log: jest.fn().mockResolvedValue(true),
}));

const prisma = require("../src/config/prisma");

describe("delivery.service", () => {
  beforeEach(() => jest.clearAllMocks());

  test("createForOrder tạo delivery mới", async () => {
    prisma.order.findUnique.mockResolvedValue({ id: "ord1", customer: {} });
    const data = { provider: "GHN", address: "123 Nguyễn Huệ" };
    prisma.delivery.create.mockResolvedValue({ id: "d1", ...data, orderId: "ord1" });

    const result = await deliveryService.createForOrder("ord1", data, "user1");
    expect(result.provider).toBe("GHN");
    expect(prisma.delivery.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ orderId: "ord1" }) })
    );
  });

  test("getTrack trả về delivery kèm events", async () => {
    const delivery = { id: "d1", provider: "GHN", status: "PICKED_UP", events: [{ event: "PICKED_UP" }] };
    prisma.delivery.findUnique.mockResolvedValue(delivery);

    const result = await deliveryService.getTrack("d1");
    expect(result.provider).toBe("GHN");
    expect(result.events).toHaveLength(1);
  });

  test("getTrack throw 404 nếu không tìm thấy", async () => {
    prisma.delivery.findUnique.mockResolvedValue(null);
    await expect(deliveryService.getTrack("invalid"))
      .rejects.toMatchObject({ status: 404 });
  });

  test("updateDelivery cập nhật thông tin", async () => {
    prisma.delivery.findUnique.mockResolvedValue({ id: "d1", orderId: "ord1" });
    prisma.delivery.update.mockResolvedValue({ id: "d1", provider: "GHTK" });

    const result = await deliveryService.updateDelivery("d1", { provider: "GHTK" }, "user1");
    expect(result.provider).toBe("GHTK");
  });

  test("addEvent thêm event vào delivery", async () => {
    prisma.delivery.findUnique.mockResolvedValue({ id: "d1", orderId: "ord1" });

    const result = await deliveryService.addEvent("d1", { event: "DELIVERED", location: "HCMC" }, "user1");
    expect(result).toBeDefined();
  });

  test("handleWebhook GHTK cập nhật trạng thái", async () => {
    mockOrderUpdateStatus.mockResolvedValue({});
    prisma.delivery.findFirst.mockResolvedValue({ id: "d1", order: { id: "ord1", status: "SHIPPING" } });
    prisma.delivery.update.mockResolvedValue({ id: "d1" });

    const payload = { tracking_code: "GHTK001", status: "delivered" };
    const result = await deliveryService.handleWebhook(
      "GHTK",
      payload,
      "sig",
      JSON.stringify(payload)
    );
    expect(prisma.delivery.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ trackingCode: "GHTK001", provider: "GHTK" }) })
    );
    expect(result).toBeDefined();
  });

  test("handleWebhook thiếu tracking_code → reject 400", async () => {
    await expect(
      deliveryService.handleWebhook("GHTK", { status: "delivered" }, "sig", "{}")
    ).rejects.toMatchObject({ status: 400 });
  });

  test("handleWebhook GHN thiếu secret trong production → reject 401", async () => {
    const oldEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      await expect(
        deliveryService.handleWebhook("GHN", { trackingCode: "GHN001", status: "delivered" }, null, "{}", {})
      ).rejects.toMatchObject({ status: 401 });
    } finally {
      process.env.NODE_ENV = oldEnv;
    }
  });
});
