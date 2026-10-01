/**
 * modules/customers/customer.service.js — Service xử lý nghiệp vụ khách hàng
 *
 * Tổng quan:
 * - Cung cấp các hàm CRUD cho khách hàng (customer)
 * - Tích hợp audit log cho mọi thao tác
 * - Hỗ trợ truy vấn Customer 360° tổng hợp đơn hàng, công nợ, loyalty, ghi chú, tags, RFM
 *
 * Hàm:
 * - getAll({ page, limit, search, segmentId }): Lấy danh sách khách hàng có phân trang, hỗ trợ tìm kiếm theo name/phone/email, lọc theo phân khúc (segmentId), flatten tags, chỉ lấy isActive: true
 * - create(data, userId): Tạo khách hàng mới, clean phone/email rỗng thành null, ghi audit log
 * - update(id, data, userId): Cập nhật thông tin khách hàng, kiểm tra tồn tại & isActive, ghi audit log before/after
 * - remove(id, userId): Soft delete (isActive = false), kiểm tra ràng buộc đơn hàng đang xử lý hoặc còn nợ, ghi audit log
 * - getCustomer360(id): Trả về tổng hợp dữ liệu khách hàng gồm thông tin cơ bản, 10 đơn gần nhất, 10 công nợ, 5 loyalty giao dịch, 10 ghi chú, tags, chỉ số RFM (recency/frequency/monetary)
 */
const prisma = require("../../config/prisma");
const auditService = require("../audit/audit.service");
const segmentsService = require("../crm/segments.service");

//Trần số id khi phải liệt kê thành viên segment (fallback cho rule orderCount)
const SEGMENT_ID_CAP = 20000;

//Lấy danh sách khách hàng

const getAll = async ({ page: rawPage = 1, limit: rawLimit = 10, search = "", segmentId = "" }) => {
  const page = Math.max(1, Number(rawPage) || 1);
  const limit = Math.max(1, Number(rawLimit) || 10);
  const skip = (page - 1) * limit;

  const where = {               //Sửa lại điều kiện truy vấn để chỉ lấy khách hàng đang hoạt động
    isActive: true,
  };

  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { phone: { contains: search, mode: "insensitive" } },
      { email: { contains: search, mode: "insensitive" } },
    ];
  }

  // Lọc theo phân khúc (deep-link từ Segments.jsx: /customers?segment=<id>)
  if (segmentId) {
    const { where: segWhere, postFilter, rules } = await segmentsService.buildWhereForSegment(segmentId);

    if (postFilter) {
      // Rule orderCount không biểu diễn được bằng Prisma where → phải liệt kê id
      const { customers, total } = await segmentsService.evaluateSegment(rules);
      if (total > SEGMENT_ID_CAP) {
        const err = new Error(
          `Phân khúc có ${total} khách hàng — vượt giới hạn ${SEGMENT_ID_CAP}. Hãy thu hẹp điều kiện lọc.`,
        );
        err.status = 400;
        throw err;
      }
      where.id = { in: customers.map((c) => c.id) };
    } else {
      // Gộp điều kiện segment với điều kiện tìm kiếm bằng AND ở top-level
      // (tránh đụng nhau ở khoá AND/OR cấp gốc)
      const searchPart = where.OR ? { OR: where.OR } : null;
      delete where.OR;
      where.AND = searchPart ? [segWhere, searchPart] : [segWhere];
    }
  }

  const [customers, total] = await Promise.all([
    prisma.customer.findMany({
      where,
      skip,
      take: Number(limit),
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
        address: true,
        totalSpent: true,
        totalDebt: true,
        createdAt: true,
        tags: { select: { tag: { select: { id: true, name: true, color: true } } } },
        //isActive: true, Lệnh này chỉ trả về trạng thái hoạt đông của khách hàng, không trả về khách hàng đã bị xóa (isActive: false)
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.customer.count({ where }),
  ]);

  // Flatten tags
  for (const c of customers) {
    c.tags = (c.tags || []).map((t) => t.tag);
  }

  return {
    customers,
    pagination: {
      page: Number(page),
      limit: Number(limit),
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
};

//Thêm khách hàng mới

const create = async (data, userId = null) => {
  const cleanData = { ...data };
  if (cleanData.phone === "") cleanData.phone = null;
  if (cleanData.email === "") cleanData.email = null;
  if (cleanData.zaloUserId === "") cleanData.zaloUserId = null;

  const customer = await prisma.customer.create({ data: cleanData });

  auditService.log({
    userId,
    action: "CREATE_CUSTOMER",
    entity: "Customer",
    entityId: customer.id,
    after: { name: customer.name, phone: customer.phone, email: customer.email },
  });

  return customer;
};

//Cập nhật thông tin khách hàng

const update = async (id, data, userId = null) => {
  const { totalSpent, totalDebt, creditLimit, ...cleanData } = data;
  if (cleanData.phone === "") cleanData.phone = null;
  if (cleanData.email === "") cleanData.email = null;
  if (cleanData.zaloUserId === "") cleanData.zaloUserId = null;

  const before = await prisma.customer.findUnique({ where: { id }, select: { name: true, phone: true, email: true, isActive: true } });
  if (!before) throw { status: 404, message: "Khách hàng không tồn tại" };
  if (!before.isActive) throw { status: 400, message: "Không thể cập nhật khách hàng đã bị vô hiệu hóa" };
  const updated = await prisma.customer.update({ where: { id }, data: cleanData });

  auditService.log({
    userId,
    action: "UPDATE_CUSTOMER",
    entity: "Customer",
    entityId: id,
    before,
    after: { name: updated.name, phone: updated.phone, email: updated.email },
  });

  return updated;
};

//Xóa khách hàng (Soft Delete)
const remove = async (id, userId = null) => {
  // 1. Kiểm tra xem khách hàng có tồn tại không
  const customer = await prisma.customer.findUnique({ where: { id } });
  if (!customer) {
    const err = new Error("Không tìm thấy khách hàng này trong hệ thống.");
    err.status = 404; // Báo cho Error Handler đây là lỗi Not Found vì lỗi cú báo 500 sẽ nghĩ là lỗi server.
    throw err;
  }

  // 2. Ràng buộc: Có đơn hàng đang xử lý hoặc nợ tiền không?
  const blockingOrder = await prisma.order.findFirst({
    where: {
      customerId: id,
      OR: [
        { status: { in: ["PENDING", "CONFIRMED", "SHIPPING"] } },
        { paymentStatus: { in: ["UNPAID", "PARTIAL"] } },
      ],
    },
  });

  if (blockingOrder) {
    const err = new Error("Không thể xóa! Khách hàng đang có đơn hàng chưa hoàn tất hoặc công nợ.");
    err.status = 400; // Báo cho Error Handler đây là lỗi do dữ liệu (Bad Request)
    throw err;
  }

  // 3. Thực hiện Soft Delete: Đổi isActive thành false
  const deleted = await prisma.customer.update({ where: { id }, data: { isActive: false } });

  auditService.log({
    userId,
    action: "DELETE_CUSTOMER",
    entity: "Customer",
    entityId: id,
    before: { name: customer.name },
  });

  return deleted;
};

// Customer 360°: tổng hợp toàn bộ dữ liệu liên quan tới 1 khách hàng
const getCustomer360 = async (id) => {
  const customer = await prisma.customer.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      address: true,
      // CRM Phase 4 — mục 5: hiển thị Zalo user_id ở CustomerDetail (không sửa được
      // từ trang chi tiết vì form edit nằm ở Customers.jsx).
      zaloUserId: true,
      totalSpent: true,
      totalDebt: true,
      creditLimit: true,
      storeCredit: true,
      tier: true,
      loyaltyPoints: true,
      // RFM/CLV/churn đã có sẵn trên Customer — Phase 4 mục 1 đưa vào dashboard
      rfmSegment: true,
      rfmRecencyDays: true,
      rfmFrequency: true,
      rfmMonetary: true,
      clvPredicted: true,
      churnProbability: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  if (!customer) {
    const err = new Error("Khách hàng không tồn tại");
    err.status = 404;
    throw err;
  }

  const [recentOrders, debts, loyaltyTxs, notes, tags, orderStats] =
    await Promise.all([
      prisma.order.findMany({
        where: { customerId: id },
        select: {
          id: true,
          orderCode: true,
          status: true,
          paymentStatus: true,
          total: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),
      prisma.debt.findMany({
        where: { customerId: id },
        select: {
          id: true,
          amount: true,
          paidAmount: true,
          dueDate: true,
          status: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),
      prisma.loyaltyTransaction.findMany({
        where: { customerId: id },
        select: {
          id: true,
          points: true,
          type: true,
          note: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
        take: 5,
      }),
      prisma.customerNote.findMany({
        where: { customerId: id },
        select: {
          id: true,
          content: true,
          type: true,
          createdAt: true,
          createdBy: { select: { id: true, fullName: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),
      prisma.customerTagOnCustomer.findMany({
        where: { customerId: id },
        select: { tag: { select: { id: true, name: true, color: true } } },
      }),
      prisma.order.aggregate({
        where: { customerId: id, status: { not: "CANCELLED" } },
        _count: { _all: true },
        _max: { createdAt: true },
      }),
    ]);

  const orderCount = orderStats._count._all || 0;
  const lastOrderAt = orderStats._max.createdAt;
  const recencyDays = lastOrderAt
    ? Math.floor((Date.now() - new Date(lastOrderAt).getTime()) / 86400000)
    : null;

  return {
    customer,
    recentOrders,
    debts,
    loyaltyTxs,
    notes,
    tags: tags.map((t) => t.tag),
    rfm: {
      recencyDays,
      frequency: orderCount,
      monetary: Number(customer.totalSpent || 0),
      lastOrderAt,
    },
  };
};

const updateCreditLimit = async (id, creditLimit, userId = null) => {
  const before = await prisma.customer.findUnique({
    where: { id },
    select: { creditLimit: true, totalDebt: true, isActive: true },
  });
  if (!before) throw { status: 404, message: "Khách hàng không tồn tại" };
  if (!before.isActive) throw { status: 400, message: "Không thể cập nhật khách hàng đã bị vô hiệu hóa" };
  if (Number(creditLimit) < 0) throw { status: 400, message: "Hạn mức tín dụng không được âm" };
  if (Number(creditLimit) > 0 && Number(creditLimit) < Number(before.totalDebt)) {
    throw { status: 400, message: "Hạn mức tín dụng không được thấp hơn công nợ hiện tại" };
  }

  const updated = await prisma.customer.update({
    where: { id },
    data: { creditLimit },
  });

  auditService.log({
    userId,
    action: "UPDATE_CUSTOMER_CREDIT_LIMIT",
    entity: "Customer",
    entityId: id,
    before: { creditLimit: before.creditLimit },
    after: { creditLimit },
  });

  return updated;
};

module.exports = {
  getAll,
  create,
  update,
  remove,
  getCustomer360,
  updateCreditLimit,
};
