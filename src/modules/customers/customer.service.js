// src/modules/customers/customer.service.js
const prisma = require("../../config/prisma");
const auditService = require("../audit/audit.service");

//Lấy danh sách khách hàng

const getAll = async ({ page: rawPage = 1, limit: rawLimit = 10, search = "" }) => {
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
        createdAt: true,
        //isActive: true, Lệnh này chỉ trả về trạng thái hoạt đông của khách hàng, không trả về khách hàng đã bị xóa (isActive: false)
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.customer.count({ where }),
  ]);

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
  const { totalSpent, ...cleanData } = data;
  if (cleanData.phone === "") cleanData.phone = null;
  if (cleanData.email === "") cleanData.email = null;

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

module.exports = {
  getAll,
  create,
  update,
  remove,
};
