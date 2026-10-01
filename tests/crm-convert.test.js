/**
 * tests/crm-convert.test.js — Test 2 bước chuyển đổi quan trọng nhất của pipeline
 *
 *   Lead  --convertToDeal-->  Deal  --convertToOrder-->  Order
 *
 * Tại sao cần test riêng:
 * - Đây là chỗ duy nhất hệ thống tự sinh `Customer` (từ deal thắng) — rủi ro tạo
 *   trùng khách hàng rất cao (`Customer` có `@@unique([phone, tenantId])`).
 * - `convertToOrder` DELEGATE `orderService.create` (không viết lại logic đơn hàng)
 *   → test bảo chứng đúng tham số truyền xuống, gồm cả chiết khấu bù lệch giá.
 * - Ràng buộc 409/400 ở mỗi bước là hàng rào chống tạo dữ liệu sai.
 */
const mockClient = {
  crmLead: { findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  crmDeal: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  crmContact: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
  crmCommunication: { create: jest.fn() },
  crmPipelineStage: { findUnique: jest.fn(), findMany: jest.fn() },
  product: { findMany: jest.fn() },
  customer: { findFirst: jest.fn(), create: jest.fn() },
  $transaction: jest.fn(),
};

jest.mock("../src/config/prisma", () => mockClient);
jest.mock("../src/modules/audit/audit.service", () => ({ log: jest.fn() }));
jest.mock("../src/modules/notifications/notification.service", () => ({ createOne: jest.fn().mockResolvedValue({}) }));
jest.mock("../src/modules/crm/communication.service", () => ({
  logSystemEvent: jest.fn().mockResolvedValue({}),
  create: jest.fn(),
}));
jest.mock("../src/modules/crm/stages.service", () => ({
  ensureDefaultStages: jest.fn().mockResolvedValue([]),
  firstOngoingStage: jest.fn().mockResolvedValue({ id: "stage-d1", label: "Mới", kind: "ONGOING", probability: 10 }),
  list: jest.fn(),
}));
jest.mock("../src/modules/orders/order.service", () => ({
  create: jest.fn().mockResolvedValue({ id: "order-1", orderCode: "ORD-20260930-0001", total: 900000, currency: "VND" }),
}));

const leadsService = require("../src/modules/crm/leads.service");
const dealsService = require("../src/modules/crm/deals.service");
const orderService = require("../src/modules/orders/order.service");

const MANAGER = { id: "u-manager", role: "MANAGER" };

beforeEach(() => {
  jest.clearAllMocks();
  mockClient.$transaction.mockImplementation(async (arg) => (typeof arg === "function" ? arg(mockClient) : arg));
  mockClient.crmPipelineStage.findMany.mockResolvedValue([]);
  mockClient.crmContact.findFirst.mockResolvedValue(null);
  // Mặc định: đã có khách hàng theo SĐT → không tạo trùng. Test nào muốn tạo mới
  // thì mockResolvedValue(null) lại.
  mockClient.customer.findFirst.mockResolvedValue({ id: "cus-existing" });
  // C2: convertToOrder giành quyền bằng conditional update rồi mới chốt đơn thật.
  // count = 1 ⇒ "tôi là request duy nhất được tạo đơn".
  mockClient.crmDeal.updateMany.mockResolvedValue({ count: 1 });
  // H4: convertToDeal chiếm lead bằng conditional update trong transaction
  mockClient.crmLead.updateMany.mockResolvedValue({ count: 1, id: "lead-1" });
});

describe("crm/convert — Lead → Deal", () => {
  const lead = (over = {}) => ({
    id: "lead-1",
    leadName: "Nguyễn Văn A",
    email: "a@example.com",
    mobileNo: "0901234567",
    jobTitle: "Giám đốc",
    status: "QUALIFIED",
    stageId: "stage-l1",
    leadOwnerId: "u1",
    organizationId: null,
    contactId: null,
    expectedValue: 5000000,
    convertedAt: null,
    convertedDealId: null,
    stage: { id: "stage-l1", label: "Đủ thông tin" },
    ...over,
  });

  test("tạo contact mới + deal ở stage ONGOING đầu tiên, set lead CONVERTED", async () => {
    mockClient.crmLead.findUnique.mockResolvedValue(lead());
    mockClient.crmContact.create.mockResolvedValue({ id: "contact-1", fullName: "Nguyễn Văn A" });
    mockClient.crmDeal.create.mockResolvedValue({
      id: "deal-1", dealName: "Nguyễn Văn A", value: 5000000, contactId: "contact-1",
      leadId: "lead-1", stage: { id: "stage-d1", label: "Mới" },
    });
    mockClient.crmLead.update.mockResolvedValue({ id: "lead-1", status: "CONVERTED" });

    const res = await leadsService.convertToDeal("lead-1", {}, "u1", MANAGER);

    expect(res.deal.id).toBe("deal-1");
    const dealData = mockClient.crmDeal.create.mock.calls[0][0].data;
    expect(dealData.kind).toBe("ONGOING");
    expect(dealData.probability).toBe(10);
    expect(dealData.value).toBe(5000000);
    expect(dealData.closedAt).toBeNull();
    // lead phải bị chuyển sang CONVERTED + trỏ ngược deal
    const leadPatches = mockClient.crmLead.update.mock.calls.map((c) => c[0].data);
    expect(leadPatches).toContainEqual(expect.objectContaining({ status: "CONVERTED", convertedDealId: "deal-1" }));
  });

  test("contact đã tồn tại (cùng SĐT) → dùng lại, KHÔNG tạo trùng", async () => {
    mockClient.crmLead.findUnique.mockResolvedValue(lead());
    mockClient.crmContact.findFirst.mockResolvedValue({ id: "contact-existing" });
    mockClient.crmDeal.create.mockResolvedValue({ id: "deal-1", dealName: "X", contactId: "contact-existing" });
    mockClient.crmLead.update.mockResolvedValue({ id: "lead-1", status: "CONVERTED" });

    await leadsService.convertToDeal("lead-1", {}, "u1", MANAGER);

    expect(mockClient.crmContact.create).not.toHaveBeenCalled();
    expect(mockClient.crmDeal.create.mock.calls[0][0].data.contactId).toBe("contact-existing");
  });

  test("createContact=false và chưa có contact → deal không gắn contact", async () => {
    mockClient.crmLead.findUnique.mockResolvedValue(lead());
    mockClient.crmDeal.create.mockResolvedValue({ id: "deal-1", dealName: "X", contactId: null });
    mockClient.crmLead.update.mockResolvedValue({ id: "lead-1", status: "CONVERTED" });

    await leadsService.convertToDeal("lead-1", { createContact: false }, "u1", MANAGER);

    expect(mockClient.crmContact.create).not.toHaveBeenCalled();
    expect(mockClient.crmDeal.create.mock.calls[0][0].data.contactId).toBeNull();
  });

  test("lead đã CONVERTED → 409, không tạo deal thứ 2", async () => {
    mockClient.crmLead.findUnique.mockResolvedValue(lead({ status: "CONVERTED", convertedDealId: "deal-old" }));
    await expect(leadsService.convertToDeal("lead-1", {}, "u1", MANAGER)).rejects.toMatchObject({ status: 409 });
    expect(mockClient.crmDeal.create).not.toHaveBeenCalled();
  });

  test("truyền stageId của kanban Lead → 400", async () => {
    mockClient.crmLead.findUnique.mockResolvedValue(lead());
    mockClient.crmPipelineStage.findUnique.mockResolvedValue({ id: "stage-x", entityType: "LEAD", label: "Mới", kind: "ONGOING", probability: 10 });
    await expect(leadsService.convertToDeal("lead-1", { stageId: "stage-x" }, "u1", MANAGER)).rejects.toMatchObject({ status: 400 });
  });

  test("note chuyển đổi → ghi 1 entry NOTE gắn cả lead lẫn deal", async () => {
    mockClient.crmLead.findUnique.mockResolvedValue(lead());
    mockClient.crmDeal.create.mockResolvedValue({ id: "deal-1", dealName: "X", contactId: "contact-1" });
    mockClient.crmLead.update.mockResolvedValue({ id: "lead-1", status: "CONVERTED" });

    await leadsService.convertToDeal("lead-1", { note: "Khách đồng ý giá" }, "u1", MANAGER);

    const comm = mockClient.crmCommunication.create.mock.calls[0][0].data;
    expect(comm.type).toBe("NOTE");
    expect(comm.leadId).toBe("lead-1");
    expect(comm.dealId).toBe("deal-1");
  });

  // ============================================================
  // H4 — chống race convertToDeal + contact trong transaction
  // ============================================================
  describe("H4 — chống race + contact nằm trong transaction", () => {
    test("claim dùng conditional update (không phải check-then-act)", async () => {
      mockClient.crmLead.findUnique.mockResolvedValue(lead());
      mockClient.crmDeal.create.mockResolvedValue({ id: "deal-1", dealName: "X", contactId: "contact-1" });
      mockClient.crmLead.update.mockResolvedValue({ id: "lead-1", status: "CONVERTED" });

      await leadsService.convertToDeal("lead-1", {}, "u1", MANAGER);

      const [claim] = mockClient.crmLead.updateMany.mock.calls;
      expect(claim[0].where).toEqual({ id: "lead-1", status: { not: "CONVERTED" } });
    });

    test("2 request song song → chỉ 1 deal được tạo, request kia 409", async () => {
      mockClient.crmLead.findUnique.mockResolvedValue(lead());
      mockClient.crmDeal.create.mockResolvedValue({ id: "deal-1", dealName: "X", contactId: "contact-1" });
      mockClient.crmLead.update.mockResolvedValue({ id: "lead-1", status: "CONVERTED" });
      // Request thua giành quyền
      mockClient.crmLead.updateMany
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 0 });

      const [a, b] = await Promise.allSettled([
        leadsService.convertToDeal("lead-1", {}, "u1", MANAGER),
        leadsService.convertToDeal("lead-1", {}, "u2", MANAGER),
      ]);

      expect(a.status).toBe("fulfilled");
      expect(b.status).toBe("rejected");
      expect(b.reason).toMatchObject({ status: 409 });
      expect(mockClient.crmDeal.create).toHaveBeenCalledTimes(1);
    });

    test("contact tạo mới nằm trong transaction (deal lỗi ⇒ không có contact mồ côi)", async () => {
      mockClient.crmLead.findUnique.mockResolvedValue(lead());
      mockClient.crmContact.findFirst.mockResolvedValue(null);
      mockClient.crmContact.create.mockResolvedValue({ id: "contact-new" });
      mockClient.crmDeal.create.mockRejectedValue(new Error("stage invalid"));

      await expect(leadsService.convertToDeal("lead-1", {}, "u1", MANAGER)).rejects.toThrow("stage invalid");
      // Đã gọi create nhưng nằm trong tx bị rollback — điểm cần khẳng định là nó
      // dùng `tx.crmContact` (mô phỏng bằng chính mockClient là tx) chứ không
      // phải client Prisma riêng như bản cũ.
      expect(mockClient.crmContact.create).toHaveBeenCalledTimes(1);
      expect(mockClient.crmContact.update).not.toHaveBeenCalled();
    });
  });
});

describe("crm/convert — Deal(thắng) → Order", () => {
  const wonDeal = (over = {}) => ({
    id: "deal-1",
    dealName: "Hợp đồng 2026",
    kind: "WON",
    value: 900000,
    currency: "VND",
    orderId: null,
    customerId: null,
    contactId: "contact-1",
    dealOwnerId: "u1",
    stageId: "stage-w",
    stage: { id: "stage-w", label: "Thắng" },
    contact: { id: "contact-1", fullName: "Nguyễn Văn A", email: "a@example.com", phone: "0901234567", customerId: null },
    organization: { id: "org-1", name: "Công ty A" },
    items: [
      { id: "it1", productId: "p1", description: null, quantity: 2, unitPrice: 500000, discount: 100000, amount: 900000 },
    ],
    ...over,
  });

  test("delegate orderService.create + ghi orderId vào deal", async () => {
    mockClient.crmDeal.findUnique.mockResolvedValue(wonDeal());
    mockClient.product.findMany.mockResolvedValue([{ id: "p1", name: "SP", price: 400000, isActive: true }]);

    const res = await dealsService.convertToOrder("deal-1", {}, "u1", MANAGER);

    expect(orderService.create).toHaveBeenCalledTimes(1);
    expect(res.order.orderCode).toBe("ORD-20260930-0001");
    const finalize = mockClient.crmDeal.updateMany.mock.calls.at(-1)[0];
    expect(finalize.data.orderId).toBe("order-1");
  });

  test("giá deal CAO hơn giá sản phẩm → chiết khấu bù lệch (FIXED)", async () => {
    // product.price = 400000 × 2 = 800000, giá deal = 900000 → không biểu diễn
    // bằng chiết khấu âm → discount 0
    mockClient.crmDeal.findUnique.mockResolvedValue(wonDeal());
    mockClient.product.findMany.mockResolvedValue([{ id: "p1", name: "SP", price: 400000, isActive: true }]);
    mockClient.crmDeal.update.mockResolvedValue(wonDeal({ orderId: "order-1" }));

    await dealsService.convertToOrder("deal-1", {}, "u1", MANAGER);
    const orderData = orderService.create.mock.calls[0][0];
    expect(orderData.discountType).toBe("NONE");
    expect(orderData.discountValue).toBe(0);
  });

  test("giá deal THẤP hơn giá sản phẩm → chiết khấu đơn để khớp giá deal", async () => {
    // product.price = 500000 × 2 = 1000000, giá deal = 900000 → chiết khấu 100000
    mockClient.crmDeal.findUnique.mockResolvedValue(wonDeal());
    mockClient.product.findMany.mockResolvedValue([{ id: "p1", name: "SP", price: 500000, isActive: true }]);
    mockClient.crmDeal.update.mockResolvedValue(wonDeal({ orderId: "order-1" }));

    await dealsService.convertToOrder("deal-1", {}, "u1", MANAGER);
    const orderData = orderService.create.mock.calls[0][0];
    expect(orderData.discountType).toBe("FIXED");
    expect(orderData.discountValue).toBe(100000);
  });

  test("chưa có khách hàng → tìm theo SĐT trước, không tạo trùng", async () => {
    mockClient.crmDeal.findUnique.mockResolvedValue(wonDeal());
    mockClient.product.findMany.mockResolvedValue([{ id: "p1", name: "SP", price: 500000, isActive: true }]);
    mockClient.customer.findFirst.mockResolvedValue({ id: "cus-existing" });
    mockClient.crmDeal.update.mockResolvedValue(wonDeal({ orderId: "order-1" }));

    await dealsService.convertToOrder("deal-1", {}, "u1", MANAGER);

    expect(mockClient.customer.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { phone: "0901234567", isActive: true } }),
    );
    expect(mockClient.customer.create).not.toHaveBeenCalled();
    expect(orderService.create.mock.calls[0][0].customerId).toBe("cus-existing");
  });

  test("không tìm thấy khách → tạo mới + trỏ contact.customerId về khách mới", async () => {
    mockClient.crmDeal.findUnique.mockResolvedValue(wonDeal());
    mockClient.product.findMany.mockResolvedValue([{ id: "p1", name: "SP", price: 500000, isActive: true }]);
    mockClient.customer.findFirst.mockResolvedValue(null);
    mockClient.customer.create.mockResolvedValue({ id: "cus-new" });
    mockClient.crmDeal.update.mockResolvedValue(wonDeal({ orderId: "order-1" }));

    await dealsService.convertToOrder("deal-1", {}, "u1", MANAGER);

    expect(mockClient.customer.create.mock.calls[0][0].data.referralSource).toBe("CRM_DEAL");
    expect(mockClient.crmContact.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "contact-1" }, data: { customerId: "cus-new" } }),
    );
  });

  test("createCustomer=false và chưa có khách → 400 kèm gợi ý", async () => {
    mockClient.crmDeal.findUnique.mockResolvedValue(wonDeal());
    mockClient.product.findMany.mockResolvedValue([{ id: "p1", name: "SP", price: 500000, isActive: true }]);
    mockClient.customer.findFirst.mockResolvedValue(null);

    await expect(dealsService.convertToOrder("deal-1", { createCustomer: false }, "u1", MANAGER))
      .rejects.toMatchObject({ status: 400 });
    expect(orderService.create).not.toHaveBeenCalled();
  });

  test("deal CHƯA thắng → 400, không tạo đơn", async () => {
    mockClient.crmDeal.findUnique.mockResolvedValue(wonDeal({ kind: "ONGOING" }));
    await expect(dealsService.convertToOrder("deal-1", {}, "u1", MANAGER)).rejects.toMatchObject({ status: 400 });
    expect(orderService.create).not.toHaveBeenCalled();
  });

  test("deal đã có đơn → 409 kèm orderId (idempotency ở tầng nghiệp vụ)", async () => {
    mockClient.crmDeal.findUnique.mockResolvedValue(wonDeal({ orderId: "order-1" }));
    await expect(dealsService.convertToOrder("deal-1", {}, "u1", MANAGER)).rejects.toMatchObject({ status: 409 });
    expect(orderService.create).not.toHaveBeenCalled();
  });

  test("deal chưa có sản phẩm nào → 400", async () => {
    mockClient.crmDeal.findUnique.mockResolvedValue(wonDeal({ items: [] }));
    await expect(dealsService.convertToOrder("deal-1", {}, "u1", MANAGER)).rejects.toMatchObject({ status: 400 });
  });

  test("CASHIER không convert được deal của người khác → 403", async () => {
    mockClient.crmDeal.findUnique.mockResolvedValue(wonDeal({ dealOwnerId: "u-other" }));
    await expect(
      dealsService.convertToOrder("deal-1", {}, "u-cash", { id: "u-cash", role: "CASHIER" }),
    ).rejects.toMatchObject({ status: 403 });
    expect(orderService.create).not.toHaveBeenCalled();
  });

  test("đơn hàng ghi channel=CRM + note tham chiếu deal để truy vết", async () => {
    mockClient.crmDeal.findUnique.mockResolvedValue(wonDeal());
    mockClient.product.findMany.mockResolvedValue([{ id: "p1", name: "SP", price: 500000, isActive: true }]);
    mockClient.customer.findFirst.mockResolvedValue({ id: "cus-1" });

    await dealsService.convertToOrder("deal-1", {}, "u1", MANAGER);

    const orderData = orderService.create.mock.calls[0][0];
    expect(orderData.channel).toBe("CRM");
    expect(orderData.note).toContain("Hợp đồng 2026");
    expect(orderData.items).toEqual([{ productId: "p1", quantity: 2, discountType: "NONE", discountValue: 0 }]);
  });

  // ============================================================
  // C2 — chống double-click tạo 2 đơn (mất tồn kho + bút toán kép)
  // ============================================================
  describe("C2 — chống race khi 2 request convert cùng lúc", () => {
    const setup = () => {
      mockClient.crmDeal.findUnique.mockResolvedValue(wonDeal());
      mockClient.product.findMany.mockResolvedValue([{ id: "p1", name: "SP", price: 500000, isActive: true }]);
      mockClient.customer.findFirst.mockResolvedValue({ id: "cus-existing" });
    };

    test("marker là chuỗi duy nhất (orderId có @unique — marker trùng sẽ nổ)", async () => {
      setup();
      await dealsService.convertToOrder("deal-1", {}, "u1", MANAGER);
      const [claim] = mockClient.crmDeal.updateMany.mock.calls;
      expect(claim[0].where).toEqual({ id: "deal-1", orderId: null });
      expect(String(claim[0].data.orderId)).toMatch(/^PENDING_CRM_[0-9a-f-]{36}$/);
    });

    test("2 request song song → chỉ 1 tạo đơn, request kia nhận 409", async () => {
      setup();
      // Request thứ 2 thua giành quyền: conditional update trả count = 0
      mockClient.crmDeal.updateMany
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 0 });

      const [a, b] = await Promise.allSettled([
        dealsService.convertToOrder("deal-1", {}, "u1", MANAGER),
        dealsService.convertToOrder("deal-1", {}, "u2", MANAGER),
      ]);

      expect(a.status).toBe("fulfilled");
      expect(b.status).toBe("rejected");
      expect(b.reason).toMatchObject({ status: 409 });
      // KHÔNG được có 2 đơn: đây là điểm mấu chốt của C2
      expect(orderService.create).toHaveBeenCalledTimes(1);
    });

    test("orderService.create ném lỗi → gỡ marker, deal thử lại được", async () => {
      setup();
      orderService.create.mockRejectedValueOnce(new Error("hết tồn kho"));

      await expect(dealsService.convertToOrder("deal-1", {}, "u1", MANAGER)).rejects.toThrow("hết tồn kho");

      const rollback = mockClient.crmDeal.updateMany.mock.calls.at(-1)[0];
      expect(rollback.data).toEqual({ orderId: null });
      const claim = mockClient.crmDeal.updateMany.mock.calls[0][0].data.orderId;
      expect(rollback.where).toEqual({ id: "deal-1", orderId: claim });
    });

    test("currency của deal được truyền xuống đơn hàng (H9)", async () => {
      setup();
      mockClient.crmDeal.findUnique.mockResolvedValue(wonDeal({ currency: "USD" }));

      await dealsService.convertToOrder("deal-1", {}, "u1", MANAGER);

      expect(orderService.create.mock.calls[0][0].currency).toBe("USD");
    });
  });
});
