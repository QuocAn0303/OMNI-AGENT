/**
 * tests/customer-360.service.test.js — AN.2: hồ sơ khách 360 phải đủ 4 khối
 *
 * DoD của R2: "mở khách bất kỳ thấy đủ giao dịch + tương tác + ticket + 2 chỉ số".
 * Test ở đây ghim đúng 4 khối đó, và ghim cả cách SỐ DỮ LIỆU đi tìm tương tác:
 * `CrmCommunication` không có `customerId` ⇒ phải đi qua contact/deal/lead.
 */
const customerService = require("../src/modules/customers/customer.service");

jest.mock("../src/config/prisma", () => ({
  customer: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    count: jest.fn().mockResolvedValue(0),
    create: jest.fn(),
    update: jest.fn(),
  },
  order: {
    findMany: jest.fn().mockResolvedValue([{ id: "o1", orderCode: "P1-1", total: 500000, status: "COMPLETED" }]),
    findFirst: jest.fn().mockResolvedValue(null),
    aggregate: jest.fn().mockResolvedValue({
      _count: { _all: 4 },
      _max: { createdAt: new Date("2026-10-01") },
      _sum: { total: 2000000 },
    }),
    count: jest.fn().mockResolvedValue(0),
  },
  debt: { findMany: jest.fn().mockResolvedValue([]) },
  loyaltyTransaction: { findMany: jest.fn().mockResolvedValue([]) },
  customerNote: { findMany: jest.fn().mockResolvedValue([]) },
  customerTagOnCustomer: { findMany: jest.fn().mockResolvedValue([]) },
  customerTask: { findMany: jest.fn().mockResolvedValue([]) },
  crmCommunication: { findMany: jest.fn().mockResolvedValue([]) },
  crmContact: { findMany: jest.fn().mockResolvedValue([]) },
  crmDeal: { findMany: jest.fn().mockResolvedValue([]) },
  crmLead: { findMany: jest.fn().mockResolvedValue([]) },
  $transaction: jest.fn((fn) => fn({})),
}));

jest.mock("../src/modules/audit/audit.service", () => ({ log: jest.fn().mockResolvedValue(true) }));
jest.mock("../src/modules/crm/segments.service", () => ({
  buildWhereForSegment: jest.fn(),
  evaluateSegment: jest.fn(),
}));

const prisma = require("../src/config/prisma");

const CUSTOMER = {
  id: "c1",
  name: "Nguyễn Thị A",
  totalSpent: 2000000,
  rfmSegment: "At-Risk",
  rfmScoredAt: new Date("2026-10-02"),
  clvPredicted: 18000000,
  churnProbability: 0.81,
  clvScoredAt: new Date("2026-10-02"),
};

describe("getCustomer360 — hồ sơ 360 đầy đủ (AN.2)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.customer.findUnique.mockResolvedValue(CUSTOMER);
    prisma.order.findMany.mockResolvedValue([{ id: "o1", orderCode: "P1-1", total: 500000, status: "COMPLETED" }]);
    prisma.order.aggregate.mockResolvedValue({
      _count: { _all: 4 },
      _max: { createdAt: new Date("2026-10-01") },
      _sum: { total: 2000000 },
    });
    prisma.debt.findMany.mockResolvedValue([]);
    prisma.loyaltyTransaction.findMany.mockResolvedValue([]);
    prisma.customerNote.findMany.mockResolvedValue([]);
    prisma.customerTagOnCustomer.findMany.mockResolvedValue([]);
    prisma.customerTask.findMany.mockResolvedValue([]);
    prisma.crmCommunication.findMany.mockResolvedValue([]);
    prisma.crmContact.findMany.mockResolvedValue([]);
    prisma.crmDeal.findMany.mockResolvedValue([]);
    prisma.crmLead.findMany.mockResolvedValue([]);
  });

  test("trả đủ 4 khối: giao dịch + tương tác + ticket + 2 chỉ số", async () => {
    prisma.customerTask.findMany.mockResolvedValue([
      { id: "t1", title: "Gọi lại khách", status: "PENDING", priority: "HIGH", assignedTo: { id: "u1", fullName: "NV" } },
    ]);
    prisma.crmContact.findMany.mockResolvedValue([{ id: "ct1", fullName: "Nguyễn Thị A" }]);
    prisma.crmCommunication.findMany.mockResolvedValue([
      { id: "m1", type: "CALL", content: "Gọi xác nhận nhu cầu", createdAt: new Date() },
    ]);

    const out = await customerService.getCustomer360("c1");

    // 1) giao dịch
    expect(out.recentOrders).toHaveLength(1);
    // 2) tương tác
    expect(out.communications).toHaveLength(1);
    // 3) ticket / công việc CSKH
    expect(out.tasks).toHaveLength(1);
    // 4) hai chỉ số
    expect(out.metrics.rfm.segment).toBe("At-Risk");
    expect(out.metrics.value.clvPredicted).toBe(18000000);
    expect(out.metrics.value.churnProbability).toBeCloseTo(0.81);
  });

  test("tìm tương tác qua cả 3 đường: contact, deal, lead", async () => {
    prisma.crmContact.findMany.mockResolvedValue([{ id: "ct1" }, { id: "ct2" }]);
    prisma.crmDeal.findMany.mockResolvedValue([{ id: "d1" }]);
    prisma.crmLead.findMany.mockResolvedValue([{ id: "l1" }]);

    await customerService.getCustomer360("c1");

    const call = prisma.crmCommunication.findMany.mock.calls[0][0];
    expect(call.where.OR).toEqual([
      { contactId: { in: ["ct1", "ct2"] } },
      { dealId: { in: ["d1"] } },
      { leadId: { in: ["l1"] } },
    ]);
  });

  test("không có quan hệ CRM thì KHÔNG query tương tác (tránh where rỗng)", async () => {
    const out = await customerService.getCustomer360("c1");
    expect(prisma.crmCommunication.findMany).not.toHaveBeenCalled();
    expect(out.communications).toEqual([]);
  });

  test("lead lấy qua contact của khách — CrmLead không có customerId", async () => {
    await customerService.getCustomer360("c1");
    expect(prisma.crmLead.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { contact: { customerId: "c1" } } }),
    );
  });

  test("chưa đủ dữ liệu CLV thì báo insufficientData, KHÔNG trả 0", async () => {
    prisma.customer.findUnique.mockResolvedValue({ ...CUSTOMER, clvPredicted: null, churnProbability: null });
    const out = await customerService.getCustomer360("c1");
    expect(out.metrics.value.clvPredicted).toBeNull();
    expect(out.metrics.value.insufficientData).toBe(true);
  });

  test("metrics.totals đếm đúng đơn / doanh thu / ticket đang mở", async () => {
    prisma.customerTask.findMany.mockResolvedValue([
      { id: "t1", status: "PENDING" },
      { id: "t2", status: "DONE" },
      { id: "t3", status: "CANCELLED" },
    ]);
    prisma.crmCommunication.findMany.mockResolvedValue([{ id: "m1" }, { id: "m2" }]);
    prisma.crmContact.findMany.mockResolvedValue([{ id: "ct1" }]);

    const out = await customerService.getCustomer360("c1");

    expect(out.metrics.totals.orders).toBe(4);
    expect(out.metrics.totals.revenue).toBe(2000000);
    expect(out.metrics.totals.tasks).toBe(3);
    expect(out.metrics.totals.openTasks).toBe(1);
    expect(out.metrics.totals.communications).toBe(2);
  });

  test("rfm ở top-level vẫn còn để không phá client cũ", async () => {
    const out = await customerService.getCustomer360("c1");
    expect(out.rfm).toEqual(out.metrics.rfm);
  });

  test("khách không tồn tại → 404", async () => {
    prisma.customer.findUnique.mockResolvedValue(null);
    await expect(customerService.getCustomer360("nope")).rejects.toMatchObject({ status: 404 });
  });
});
