/**
 * modules/food-delivery/food-delivery.service.js — Order inbox đa kênh food delivery
 *
 * Gộp đơn từ GrabFood / ShopeeFood / BeFood → 1 queue, route vào KDS.
 * Bản đầu: nhận đơn push từ webhook (đơn giản), staff duyệt → tạo Order + KDS ticket.
 */
const prisma = require('../../config/prisma');
const auditService = require('../audit/audit.service');

async function listInbox(filters = {}) {
  const where = {};
  if (filters.provider) where.provider = filters.provider;
  if (filters.status) where.status = filters.status;
  return prisma.foodDeliveryOrder.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
}

// Nhận đơn từ aggregator (webhook hoặc pull adapter)
async function receiveOrder(payload) {
  const { provider, providerOrderId, customerName, customerPhone, customerAddress, items, subtotal, deliveryFee, total } = payload;
  // Idempotent: kiểm tra providerOrderId đã có chưa
  const existing = await prisma.foodDeliveryOrder.findUnique({ where: { providerOrderId } });
  if (existing) return existing;

  const fd = await prisma.foodDeliveryOrder.create({
    data: {
      provider,
      providerOrderId,
      customerName,
      customerPhone,
      customerAddress,
      items: items || [],
      subtotal: subtotal || 0,
      deliveryFee: deliveryFee || 0,
      total: total || 0,
      status: 'NEW',
    },
  });
  auditService.log({ action: 'RECEIVE_FOOD_DELIVERY', entity: 'FoodDeliveryOrder', entityId: fd.id, after: { provider, providerOrderId } });
  return fd;
}

// Staff duyệt đơn → tạo Order + KDS ticket
async function acceptOrder(id, userId) {
  const fd = await prisma.foodDeliveryOrder.findUnique({ where: { id } });
  if (!fd) throw { status: 404, message: 'Không tìm thấy đơn delivery' };

  const result = await prisma.$transaction(async (tx) => {
    // Tạo Order từ food delivery
    const order = await tx.order.create({
      data: {
        orderCode: `${fd.provider.slice(0, 3)}-${Date.now()}`,
        status: 'CONFIRMED',
        paymentMethod: 'BANK_TRANSFER',
        paymentStatus: 'UNPAID',
        subtotal: fd.subtotal,
        total: fd.total,
        orderType: 'DELIVERY',
        channel: fd.provider,
        channelOrderId: fd.providerOrderId,
        createdById: userId,
      },
    });
    await tx.foodDeliveryOrder.update({
      where: { id },
      data: { status: 'ACCEPTED', orderId: order.id },
    });
    return { order, foodDelivery: fd };
  });
  auditService.log({ userId, action: 'ACCEPT_FOOD_DELIVERY', entity: 'FoodDeliveryOrder', entityId: id, after: { orderId: result.order.id } });
  return result;
}

async function rejectOrder(id, userId = null) {
  const fd = await prisma.foodDeliveryOrder.update({
    where: { id },
    data: { status: 'REJECTED' },
  });
  auditService.log({ userId, action: 'REJECT_FOOD_DELIVERY', entity: 'FoodDeliveryOrder', entityId: id, after: { status: 'REJECTED' } });
  return fd;
}

module.exports = { listInbox, receiveOrder, acceptOrder, rejectOrder };
