/**
 * modules/qr-ordering/qr-ordering.service.js — Khách tự order qua QR
 *
 * Public flow (không auth, dùng table.qrToken):
 * 1. getMenu(qrToken) → menu + table info
 * 2. placeOrder(qrToken, items) → tạo QrOrderSession + Order QR_SELF + tự gửi bếp (KDS)
 * 3. trackStatus(publicToken) → theo dõi trạng thái
 * 4. callWaiter / submitFeedback
 * 5. getPaymentInfo(publicToken) → VietQR thanh toán
 */
const prisma = require('../../config/prisma');
const crypto = require('crypto');
const { runWithTenant } = require('../../config/tenantContext');
const { emitToRole } = require('../../realtime/socket');
const auditService = require('../audit/audit.service');
const kdsService = require('../kds/kds.service');
const logger = require('../../utils/logger');

const BANK_BINS = {
  VCB: '970436', TCB: '970407', MB: '970422', BIDV: '970418',
  ACB: '970416', VPBank: '970432', VietinBank: '970415', Sacombank: '970403',
};

// Lấy menu theo qrToken của bàn
async function getMenu(qrToken) {
  const table = await prisma.dinerTable.findUnique({
    where: { qrToken },
    include: { area: true },
  });
  if (!table) throw { status: 404, message: 'QR không hợp lệ' };

  // Set tenant context từ table → Prisma extension auto-scope products
  return runWithTenant(table.tenantId, () => _getMenuInner(table));
}

async function _getMenuInner(table) {
  const products = await prisma.product.findMany({
    where: { isActive: true },
    include: {
      category: true,
      modifierGroups: {
        where: { isActive: true },
        include: { options: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } } },
        orderBy: { sortOrder: 'asc' },
      },
    },
    orderBy: { name: 'asc' },
  });

  const byCategory = {};
  for (const p of products) {
    const cat = p.category?.name || 'Khác';
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(p);
  }

  return {
    menu: byCategory,
    table: {
      id: table.id,
      code: table.code,
      capacity: table.capacity,
      status: table.status,
      areaName: table.area?.name || null,
    },
  };
}

// Khách đặt món qua QR
async function placeOrder(qrToken, payload) {
  const table = await prisma.dinerTable.findUnique({ where: { qrToken } });
  if (!table) throw { status: 404, message: 'QR không hợp lệ' };

  // Set tenant context cho toàn bộ order creation
  return runWithTenant(table.tenantId, () => _placeOrderInner(table, payload));
}

async function _placeOrderInner(table, payload) {
  const { items, customerName, note } = payload;
  if (!items || items.length === 0) throw { status: 400, message: 'Giỏ hàng trống' };

  const publicToken = crypto.randomBytes(16).toString('hex');

  // Tạo QrOrderSession + Order QR_SELF (status PENDING, chưa thanh toán)
  const session = await prisma.qrOrderSession.create({
    data: {
      publicToken,
      tableId: table.id,
      tableName: table.code,
      customerName: customerName || 'Khách QR',
      status: 'PLACED',
    },
  });

  // Load products + modifier options theo optionIds để tính giá chính xác
  const productIds = items.map((i) => i.productId);
  const products = await prisma.product.findMany({ where: { id: { in: productIds } } });
  const productMap = {};
  for (const p of products) productMap[p.id] = p;

  const allOptionIds = [...new Set(items.flatMap((it) => it.modifiers?.flatMap((m) => m.optionIds) || []))];
  const options = allOptionIds.length
    ? await prisma.modifierOption.findMany({ where: { id: { in: allOptionIds } } })
    : [];
  const optionMap = {};
  for (const o of options) optionMap[o.id] = o;

  let subtotal = 0;
  const orderItems = [];
  for (const it of items) {
    const p = productMap[it.productId];
    if (!p) continue;

    let adjust = 0;
    const modifiers = [];
    for (const mod of it.modifiers || []) {
      for (const optionId of mod.optionIds) {
        const opt = optionMap[optionId];
        if (!opt) continue;
        adjust += Number(opt.priceAdjust);
        modifiers.push({ modifierOptionId: optionId, quantity: 1, priceAdjust: Number(opt.priceAdjust) });
      }
    }

    const unitPrice = Number(p.price) + adjust;
    const lineSub = unitPrice * it.quantity;
    subtotal += lineSub;
    orderItems.push({
      productId: it.productId,
      quantity: it.quantity,
      price: unitPrice,
      subtotal: lineSub,
      courseId: it.courseId || 1,
      modifiers: modifiers.length ? { create: modifiers } : undefined,
    });
  }

  if (orderItems.length === 0) throw { status: 400, message: 'Giỏ hàng không có món hợp lệ' };

  // Order.createdById bắt buộc là User — QR không có user thật, lấy user đầu tiên của tenant
  const owner = await prisma.user.findFirst({
    where: { tenantId: table.tenantId },
    select: { id: true },
  });
  if (!owner) throw { status: 400, message: 'Quán chưa có tài khoản nhân viên, không thể đặt món' };

  // Tạo Order QR_SELF
  const order = await prisma.order.create({
    data: {
      orderCode: `QR-${Date.now()}-${Math.floor(Math.random() * 900 + 100)}`,
      status: 'PENDING',
      paymentMethod: 'BANK_TRANSFER',
      paymentStatus: 'UNPAID',
      subtotal,
      total: subtotal,
      orderType: 'QR_SELF',
      tableId: table.id,
      channel: 'QR',
      channelOrderId: session.id,
      note: note || null,
      createdById: owner.id,
      items: { create: orderItems },
    },
  });

  await prisma.qrOrderSession.update({
    where: { id: session.id },
    data: { orderId: order.id },
  });

  // Tự gửi bếp: sinh KDS ticket cho món có station (bỏ qua VOIDED/không station)
  let firedCount = 0;
  try {
    const tickets = await kdsService.generateTicketsForOrder(order.id);
    firedCount = tickets.length;
  } catch (e) {
    logger.warn('[qr-ordering] auto-fire KDS failed:', e.message);
  }

  // Cập nhật order status CONFIRMED nếu có món đã gửi bếp — món không có station
  // vẫn giữ PENDING (khách theo dõi qua orderItem.status)
  if (firedCount > 0) {
    await prisma.order.update({ where: { id: order.id }, data: { status: 'CONFIRMED' } });
  }

  emitToRole('CASHIER', 'public:order-placed', {
    orderId: order.id,
    table: table.code,
    itemCount: orderItems.length,
    amount: subtotal,
    tenantId: table.tenantId,
    timestamp: new Date().toISOString(),
  }, table.tenantId);

  auditService.log({ action: 'QR_PLACE_ORDER', entity: 'Order', entityId: order.id, after: { tableId: table.id, publicToken, itemCount: orderItems.length, firedCount } });
  return { publicToken, orderId: order.id, status: 'PLACED', firedCount };
}

// Theo dõi trạng thái đơn QR
async function trackStatus(publicToken) {
  const session = await prisma.qrOrderSession.findUnique({
    where: { publicToken },
    include: {
      order: {
        include: {
          items: {
            include: {
              product: true,
              modifiers: { include: { modifierOption: true } },
            },
            orderBy: { createdAt: 'asc' },
          },
        },
      },
    },
  });
  if (!session) throw { status: 404, message: 'Không tìm thấy đơn' };
  return session;
}

// Gọi nhân viên
async function callWaiter(publicToken, payload) {
  const session = await prisma.qrOrderSession.findUnique({ where: { publicToken } });
  if (!session) throw { status: 404, message: 'Không tìm thấy đơn' };
  emitToRole('CASHIER', 'notify:waiter-called', {
    table: session.tableName,
    note: payload?.note,
    tenantId: session.tenantId,
    timestamp: new Date().toISOString(),
  }, session.tenantId);
  auditService.log({ action: 'QR_CALL_WAITER', entity: 'QrOrderSession', entityId: session.id, after: { table: session.tableName, note: payload?.note } });
  return { ok: true, table: session.tableName, note: payload?.note };
}

// Feedback sau bữa ăn
async function submitFeedback(publicToken, payload) {
  const session = await prisma.qrOrderSession.findUnique({ where: { publicToken } });
  if (!session) throw { status: 404, message: 'Không tìm thấy đơn' };
  // Lưu feedback vào note của order
  if (session.orderId) {
    await prisma.order.update({
      where: { id: session.orderId },
      data: { note: `Feedback: ${payload.rating}/5 - ${payload.comment || ''}` },
    });
  }
  auditService.log({ action: 'QR_FEEDBACK', entity: 'QrOrderSession', entityId: session.id, after: { rating: payload.rating } });
  return { ok: true };
}

// Tạo VietQR thanh toán cho đơn QR (khách tự quét chuyển khoản)
async function getPaymentInfo(publicToken) {
  const session = await prisma.qrOrderSession.findUnique({
    where: { publicToken },
    include: { order: true },
  });
  if (!session) throw { status: 404, message: 'Không tìm thấy đơn' };
  if (!session.order) throw { status: 400, message: 'Đơn chưa được tạo' };

  const bankAccount = await prisma.bankAccount.findFirst({
    where: { isDefault: true, isActive: true },
    select: { accountNumber: true, bankName: true, accountName: true },
  });

  const amount = Number(session.order.total) - Number(session.order.tipAmount || 0);
  const description = `Thanh toan ban ${session.tableName} - QR`;
  let qrString = null;

  if (bankAccount) {
    try {
      const { buildVietQRString } = require('../../utils/vietqr');
      const bankBin = BANK_BINS[bankAccount.bankName] || '970436';
      qrString = buildVietQRString({
        bankBin,
        accountNumber: bankAccount.accountNumber,
        amount,
        description,
        accountName: bankAccount.accountName,
      });
    } catch (e) {
      logger.warn('[qr-ordering] VietQR generation failed:', e.message);
    }
  }

  return {
    orderId: session.order.id,
    total: amount,
    paymentStatus: session.order.paymentStatus,
    qrString,
    bankInfo: bankAccount ? {
      bankName: bankAccount.bankName,
      accountNumber: bankAccount.accountNumber,
      accountName: bankAccount.accountName,
    } : null,
  };
}

module.exports = { getMenu, placeOrder, trackStatus, callWaiter, submitFeedback, getPaymentInfo };
