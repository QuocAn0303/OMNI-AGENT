// src/modules/einvoice/einvoice.service.js
const prisma = require("../../config/prisma");
const vnpt = require("./provider/vnpt.adapter");
const auditService = require("../audit/audit.service");

const toNum = (v) => Number(v || 0);

// Sinh số hóa đơn nội bộ: HDĐ-YYYYMMDD-XXXX
const generateInvoiceNo = async (tx = prisma) => {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const count = await tx.electronicInvoice.count({ where: { createdAt: { gte: start } } });
  return `HDD-${today}-${String(count + 1).padStart(4, "0")}`;
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
      templateCode: vnpt.TEMPLATE,
      serial: vnpt.SERIAL,
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
    console.error(`[einvoice] autoIssue failed for order ${orderId}:`, err?.message || err);
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
