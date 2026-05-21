const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");
const cloudinary = require("cloudinary").v2;
const prisma = require("../../config/prisma");
const paymentService = require("../payments/payment.service");
const auditService = require("../audit/audit.service");
const { numberToVietnameseWords } = require("../../utils/vietnameseMoneyWords");

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const formatMoney = (value) => Number(value || 0).toLocaleString("vi-VN");
const VAT_RATE = Number(process.env.INVOICE_VAT_RATE || 10);

const FONT_DIR = path.join(__dirname, "../../assets/fonts");
const FONT_REGULAR = path.join(FONT_DIR, "Roboto-Regular.ttf");
const FONT_BOLD = path.join(FONT_DIR, "Roboto-Bold.ttf");

const generateInvoiceCode = async () => {
  const year = new Date().getFullYear();
  const count = await prisma.invoice.count({
    where: { invoiceCode: { startsWith: `HD-${year}-` } },
  });
  return `HD-${year}-${String(count + 1).padStart(4, "0")}`;
};

const registerFonts = (doc) => {
  if (fs.existsSync(FONT_REGULAR)) {
    doc.registerFont("VN", FONT_REGULAR);
    if (fs.existsSync(FONT_BOLD)) doc.registerFont("VN-Bold", FONT_BOLD);
    return { body: "VN", bold: fs.existsSync(FONT_BOLD) ? "VN-Bold" : "VN" };
  }
  return { body: "Helvetica", bold: "Helvetica-Bold" };
};

const buildPdfBuffer = async (order, balance, invoiceCode) => {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 48, size: "A4" });
    const fonts = registerFonts(doc);
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const subtotal = Number(order.subtotal);
    const discount = Number(order.discount) + Number(order.promotionDiscount) + Number(order.loyaltyDiscount || 0);
    const beforeVat = subtotal - discount;
    const vat = Math.round((beforeVat * VAT_RATE) / 100);
    const grandTotal = beforeVat + vat;

    doc.font(fonts.bold).fontSize(16).text(process.env.COMPANY_NAME || "MINI ERP STORE", { align: "center" });
    doc.font(fonts.body).fontSize(10);
    doc.text(process.env.COMPANY_ADDRESS || "", { align: "center" });
    doc.text(`MST: ${process.env.COMPANY_TAX_ID || ""}`, { align: "center" });
    doc.moveDown();
    doc.font(fonts.bold).fontSize(14).text("HÓA ĐƠN BÁN HÀNG", { align: "center" });
    doc.font(fonts.body).fontSize(10);
    doc.text(`Số: ${invoiceCode}`, { align: "center" });
    doc.moveDown();

    doc.text(`Mã đơn: ${order.orderCode}`);
    doc.text(`Ngày: ${new Date(order.createdAt).toLocaleString("vi-VN")}`);
    doc.text(`Thu ngân: ${order.createdBy?.fullName || "-"}`);
    doc.moveDown(0.5);
    doc.text(`Khách hàng: ${order.invoice?.companyName || order.customer?.name || "Khách lẻ"}`);
    if (order.invoice?.taxCode) doc.text(`MST khách: ${order.invoice.taxCode}`);
    doc.text(`Điện thoại: ${order.customer?.phone || "-"}`);
    doc.text(`Địa chỉ: ${order.customer?.address || "-"}`);
    doc.moveDown();

    const cols = [48, 90, 250, 310, 370, 450];
    const headerY = doc.y;
    doc.font(fonts.bold);
    doc.text("STT", cols[0], headerY);
    doc.text("Tên hàng", cols[1], headerY);
    doc.text("SKU", cols[2], headerY);
    doc.text("SL", cols[3], headerY);
    doc.text("Đơn giá", cols[4], headerY);
    doc.text("Thành tiền", cols[5], headerY, { width: 90, align: "right" });
    doc.moveDown(0.4).font(fonts.body);
    doc.moveTo(48, doc.y).lineTo(560, doc.y).stroke();

    order.items.forEach((item, index) => {
      const y = doc.y + 6;
      doc.text(String(index + 1), cols[0], y);
      doc.text(item.product?.name || "-", cols[1], y, { width: 150 });
      doc.text(item.product?.sku || "-", cols[2], y, { width: 55 });
      doc.text(String(item.quantity), cols[3], y);
      doc.text(formatMoney(item.price), cols[4], y, { width: 70, align: "right" });
      doc.text(formatMoney(item.subtotal), cols[5], y, { width: 90, align: "right" });
      doc.y = y + 22;
    });

    doc.moveTo(48, doc.y).lineTo(560, doc.y).stroke();
    doc.moveDown();
    doc.text(`Tạm tính: ${formatMoney(subtotal)} đ`, { align: "right" });
    doc.text(`Giảm giá: ${formatMoney(discount)} đ`, { align: "right" });
    doc.text(`VAT (${VAT_RATE}%): ${formatMoney(vat)} đ`, { align: "right" });
    doc.font(fonts.bold).text(`Tổng cộng: ${formatMoney(grandTotal)} đ`, { align: "right" });
    doc.font(fonts.body);
    doc.text(`Đã thanh toán: ${formatMoney(balance.paid)} đ`, { align: "right" });
    doc.text(`Còn lại: ${formatMoney(balance.remaining)} đ`, { align: "right" });
    doc.moveDown();
    doc.text(`Bằng chữ: ${numberToVietnameseWords(grandTotal)}`, { width: 500 });
    doc.moveDown();
    doc.fontSize(8).text("Hóa đơn bán hàng nội bộ — không phải hóa đơn điện tử.", { align: "center" });
    doc.end();
  });
};

const uploadPdf = async (buffer, invoiceCode) => {
  if (!process.env.CLOUDINARY_CLOUD_NAME) return null;
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: "erp_invoices", resource_type: "raw", public_id: invoiceCode },
      (err, result) => (err ? reject(err) : resolve(result?.secure_url)),
    );
    stream.end(buffer);
  });
};

const generateInvoice = async (orderId, opts = {}, userId = null) => {
  const existing = await prisma.invoice.findUnique({ where: { orderId } });
  if (existing?.pdfUrl) return { invoice: existing, buffer: null, immutable: true };

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      customer: true,
      createdBy: { select: { fullName: true } },
      items: { include: { product: true } },
    },
  });
  if (!order) throw { status: 404, message: "Không tìm thấy đơn hàng" };

  const balance = await paymentService.getOrderBalance(orderId);
  const invoiceCode = existing?.invoiceCode || (await generateInvoiceCode());
  const buffer = await buildPdfBuffer(order, balance, invoiceCode);
  let pdfUrl = existing?.pdfUrl;
  try {
    pdfUrl = pdfUrl || (await uploadPdf(buffer, invoiceCode));
  } catch (e) {
    console.warn("[invoice] Cloudinary upload skipped:", e.message);
  }

  const invoice = await prisma.invoice.upsert({
    where: { orderId },
    create: {
      orderId,
      invoiceCode,
      pdfUrl,
      taxCode: opts.taxCode,
      companyName: opts.companyName,
    },
    update: {
      ...(existing ? {} : { taxCode: opts.taxCode, companyName: opts.companyName }),
      ...(pdfUrl && !existing?.pdfUrl ? { pdfUrl } : {}),
    },
  });

  await auditService.log({
    userId,
    action: "GENERATE_INVOICE",
    entity: "Invoice",
    entityId: invoice.id,
    after: { invoiceCode, orderId },
  });

  return { invoice, buffer, order };
};

const generateInvoicePDF = async (orderId) => {
  const { buffer, order } = await generateInvoice(orderId);
  if (buffer) return { buffer, order };
  const inv = await prisma.invoice.findUnique({ where: { orderId } });
  if (inv?.pdfUrl) {
    return { buffer: null, order, redirectUrl: inv.pdfUrl };
  }
  const regen = await buildPdfBuffer(
    await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        customer: true,
        createdBy: { select: { fullName: true } },
        items: { include: { product: true } },
        invoice: true,
      },
    }),
    await paymentService.getOrderBalance(orderId),
    inv.invoiceCode,
  );
  return { buffer: regen, order };
};

const getById = async (id) => {
  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: { order: { select: { orderCode: true, total: true } } },
  });
  if (!invoice) throw { status: 404, message: "Không tìm thấy hóa đơn" };
  return invoice;
};

const sendEmail = async (invoiceId, userId) => {
  const invoice = await getById(invoiceId);
  const order = await prisma.order.findUnique({
    where: { id: invoice.orderId },
    include: { customer: true },
  });
  const to = order.customer?.email;
  if (!to) throw { status: 400, message: "Khách hàng chưa có email" };

  if (!process.env.SMTP_HOST) {
    throw { status: 503, message: "Chưa cấu hình SMTP (SMTP_HOST, SMTP_USER, SMTP_PASS)" };
  }

  let nodemailer;
  try {
    nodemailer = require("nodemailer");
  } catch {
    throw { status: 503, message: "Cài đặt nodemailer để gửi email" };
  }

  const { buffer } = await generateInvoicePDF(invoice.orderId);
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.COMPANY_NAME,
    to,
    subject: `Hóa đơn ${invoice.invoiceCode} — ${order.orderCode}`,
    text: `Kính gửi ${order.customer.name},\nĐính kèm hóa đơn ${invoice.invoiceCode}.`,
    attachments: buffer
      ? [{ filename: `${invoice.invoiceCode}.pdf`, content: buffer }]
      : [],
  });

  const updated = await prisma.invoice.update({
    where: { id: invoiceId },
    data: { emailSentAt: new Date() },
  });

  await auditService.log({
    userId,
    action: "SEND_INVOICE_EMAIL",
    entity: "Invoice",
    entityId: invoiceId,
    after: { to },
  });

  return updated;
};

module.exports = {
  generateInvoice,
  generateInvoicePDF,
  getById,
  sendEmail,
};
