/**
 * modules/einvoice/einvoice.service.js — Service quản lý Hóa đơn điện tử (HĐĐT)
 *
 * Tổng quan:
 * - Cung cấp logic phát hành, hủy, đồng bộ trạng thái HĐĐT tích hợp VNPT
 * - Tự động phát hành khi order COMPLETED (autoIssueForOrder, non-blocking)
 * - Dùng upsert để tránh trùng lặp theo orderId
 * - Tích hợp auditService để ghi log
 *
 * Hàm:
 * - generateInvoiceNo(tx): Sinh số HĐĐT nội bộ HDD-YYYYMMDD-XXXX
 * - issueForOrder(orderId, userId): Phát hành HĐĐT cho đơn COMPLETED, gọi VNPT adapter, upsert
 * - autoIssueForOrder(orderId, userId): Auto-issue non-blocking, trả về existing nếu có
 * - cancelInvoice(einvoiceId, userId): Hủy HĐĐT qua VNPT, set CANCELLED
 * - syncStatus(einvoiceId): Đồng bộ trạng thái từ VNPT
 * - list({ page, limit, cqtStatus, from, to }): Danh sách HĐĐT phân trang, lọc
 * - getById(id): Chi tiết HĐĐT kèm order + items
 */
const prisma = require("../../config/prisma");
const vnpt = require("./provider/vnpt.adapter");
const config = require("../integrations/integration-config.service");
const auditService = require("../audit/audit.service");
const logger = require('../../utils/logger');

const toNum = (v) => Number(v || 0);

// Sinh số hóa đơn nội bộ: HDĐ-YYYYMMDD-XXXX
/**
 * Sinh số hóa đơn nội bộ: HDĐ-YYYYMMDD-XXXX
 *
 * CỐ Ý THỬ LẠI KHI TRÙNG: trước đây đếm số HĐĐT hôm nay rồi `+1` — đó là
 * read-then-write, và `invoiceNo` là UNIQUE. Hai lần phát hành chạy song song (hoặc
 * một lần phát hành thất bại giữa chừng khiến số bị chiếm) sẽ sinh **cùng một số**
 * ⇒ `Unique constraint failed on the fields: ("invoiceNo")` và cả lần phát hành sau
 * đó hỏng theo dây chuyền. Cùng lớp lỗi với `company_settings` đã dò ra ở P1.
 *
 * Sửa: bắt lỗi unique rồi **đếm lại** (tối đa 5 lần) thay vì để lỗi nổi lên.
 * Không thêm khoá DB vì `generateInvoiceNo` còn được gọi với `tx` bên trong
 * transaction; thử lại là đủ cho lỗi này và không đổi hợp đồng hàm.
 */
const generateInvoiceNo = async (tx = prisma) => {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const start = new Date(); start.setHours(0, 0, 0, 0);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const count = await tx.electronicInvoice.count({ where: { createdAt: { gte: start } } });
    const candidate = `HDD-${today}-${String(count + 1).padStart(4, "0")}`;
    const taken = await tx.electronicInvoice.findUnique({
      where: { invoiceNo: candidate },
      select: { id: true },
    });
    if (!taken) return candidate;
  }
  // 5 lần liên tiếp vẫn trùng ⇒ trả số cuối cùng để caller báo lỗi có nguyên nhân
  // (đã ghi log), thay vì âm thầm dùng một số đã tồn tại.
  return `HDD-${today}-${String(
    (await tx.electronicInvoice.count({ where: { createdAt: { gte: start } } })) + 1,
  ).padStart(4, "0")}`;
};

/**
 * Phát hành HĐĐT cho một Order.
 * Nếu đã có HĐĐT không bị hủy → throw 409.
 */
const issueForOrder = async (orderId, userId = null) => {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      customer: true,
      items: { include: { product: true } },
      electronicInvoice: true,
    },
  });
  if (!order) throw { status: 404, message: "Không tìm thấy đơn hàng" };
  if (order.status !== "COMPLETED") throw { status: 400, message: "Chỉ phát hành HĐĐT cho đơn COMPLETED" };

  if (order.electronicInvoice && order.electronicInvoice.cqtStatus !== "CANCELLED") {
    throw { status: 409, message: "Đơn hàng đã có hóa đơn điện tử" };
  }

  const items = order.items.map((it) => {
    const unitPrice = toNum(it.price);
    const quantity = it.quantity;
    const taxRate = 10;
    const subtotal = unitPrice * quantity;
    const taxAmount = Math.round(subtotal * taxRate / 100);
    return {
      name: it.product.name,
      unit: it.product.unit || "cái",
      quantity,
      unitPrice,
      taxRate,
      taxAmount,
      total: subtotal + taxAmount,
    };
  });

  const totalBeforeTax = items.reduce((s, it) => s + it.unitPrice * it.quantity, 0);
  const totalTax = items.reduce((s, it) => s + it.taxAmount, 0);
  const totalPayment = totalBeforeTax + totalTax;

  const result = await vnpt.issueInvoice({
    buyerName: order.customer?.name || "Khách lẻ",
    buyerTaxCode: order.customer?.taxCode || null,
    buyerAddress: order.customer?.address || null,
    paymentMethod: order.paymentMethod === "CASH" ? "TM" : "CK",
    items,
    totalBeforeTax,
    totalTax,
    totalPayment,
  });

  const internalNo = await generateInvoiceNo();

  const einvoice = await prisma.electronicInvoice.upsert({
    where: { orderId },
    create: {
      invoiceNo: result.invoiceNo || internalNo,
      orderId,
      templateCode: (await config.get("VNPT_TEMPLATE_CODE")) || "1/001",
      serial: (await config.get("VNPT_SERIAL")) || "K24TVE",
      issueDate: new Date(),
      buyerName: order.customer?.name || "Khách lẻ",
      buyerTaxCode: order.customer?.taxCode || null,
      buyerAddress: order.customer?.address || null,
      cqtCode: result.cqtCode || null,
      cqtStatus: result.cqtStatus || "PENDING",
      signedXml: result.signedXml || null,
      pdfUrl: result.pdfUrl || null,
      provider: "VNPT",
      rawResponse: result.rawResponse || null,
    },
    update: {
      invoiceNo: result.invoiceNo || internalNo,
      cqtCode: result.cqtCode || null,
      cqtStatus: result.cqtStatus || "PENDING",
      signedXml: result.signedXml || null,
      pdfUrl: result.pdfUrl || null,
      rawResponse: result.rawResponse || null,
      issueDate: new Date(),
    },
  });

  await auditService.log({ userId, action: "EINVOICE_ISSUED", entity: "ElectronicInvoice", entityId: einvoice.id });
  return einvoice;
};

/**
 * Auto-issue khi order → COMPLETED. Non-throwing: lỗi chỉ log.
 */
const autoIssueForOrder = async (orderId, userId = null) => {
  try {
    const existing = await prisma.electronicInvoice.findUnique({ where: { orderId } });
    if (existing && existing.cqtStatus !== "CANCELLED") return existing;
    return await issueForOrder(orderId, userId);
  } catch (err) {
    // Non-blocking: log và tiếp tục
    logger.error(`[einvoice] autoIssue failed for order ${orderId}: ${err?.message || err}`);
    return null;
  }
};

/**
 * Hủy HĐĐT.
 */
const cancelInvoice = async (einvoiceId, userId = null) => {
  const inv = await prisma.electronicInvoice.findUnique({ where: { id: einvoiceId } });
  if (!inv) throw { status: 404, message: "Không tìm thấy hóa đơn điện tử" };
  if (inv.cqtStatus === "CANCELLED") throw { status: 400, message: "Hóa đơn đã hủy" };

  const result = await vnpt.cancelInvoice({ invoiceNo: inv.invoiceNo });
  const updated = await prisma.electronicInvoice.update({
    where: { id: einvoiceId },
    data: { cqtStatus: "CANCELLED", rawResponse: result.rawResponse },
  });
  await auditService.log({ userId, action: "EINVOICE_CANCELLED", entity: "ElectronicInvoice", entityId: einvoiceId });
  return updated;
};

/**
 * Đồng bộ trạng thái từ VNPT.
 */
const syncStatus = async (einvoiceId) => {
  const inv = await prisma.electronicInvoice.findUnique({ where: { id: einvoiceId } });
  if (!inv) throw { status: 404, message: "Không tìm thấy hóa đơn điện tử" };

  const result = await vnpt.getInvoiceStatus({ invoiceNo: inv.invoiceNo });
  return prisma.electronicInvoice.update({
    where: { id: einvoiceId },
    data: { cqtStatus: result.cqtStatus, rawResponse: result.rawResponse },
  });
};

const list = async ({ page = 1, limit = 20, cqtStatus, from, to } = {}) => {
  const skip = (Number(page) - 1) * Number(limit);
  const where = {};
  if (cqtStatus) where.cqtStatus = cqtStatus;
  if (from || to) {
    where.issueDate = {};
    if (from) where.issueDate.gte = new Date(from);
    if (to) where.issueDate.lte = new Date(to);
  }

  const [items, total] = await Promise.all([
    prisma.electronicInvoice.findMany({
      where, skip, take: Number(limit),
      orderBy: { issueDate: "desc" },
      include: { order: { select: { orderCode: true, total: true, customer: { select: { name: true } } } } },
    }),
    prisma.electronicInvoice.count({ where }),
  ]);

  return { items, pagination: { page: Number(page), limit: Number(limit), total, totalPages: Math.ceil(total / Number(limit)) } };
};

const getById = async (id) => {
  const inv = await prisma.electronicInvoice.findUnique({
    where: { id },
    include: { order: { include: { items: { include: { product: true } }, customer: true } } },
  });
  if (!inv) throw { status: 404, message: "Không tìm thấy hóa đơn điện tử" };
  return inv;
};

module.exports = { issueForOrder, autoIssueForOrder, cancelInvoice, syncStatus, list, getById };
