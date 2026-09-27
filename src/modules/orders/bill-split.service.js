/**
 * modules/orders/bill-split.service.js — Tách tiền F&B (bill splitting)
 *
 * 3 mode:
 * - ITEM: chia theo món (mỗi nhóm chứa 1 số item)
 * - EVEN: chia đều cho N người
 * - CUSTOM: chia theo số tiền tùy chỉnh
 */
const prisma = require('../../config/prisma');
const auditService = require('../audit/audit.service');

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

async function splitBill(orderId, mode, splits, userId = null) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: true },
  });
  if (!order) throw { status: 404, message: 'Không tìm thấy đơn' };
  if (order.status === 'CANCELLED') throw { status: 400, message: 'Đơn đã hủy' };

  // Xóa split cũ (nếu re-split)
  await prisma.billSplit.deleteMany({ where: { orderId } });

  const activeItems = order.items.filter((i) => i.status !== 'VOIDED');
  const total = Number(order.total);

  if (mode === 'EVEN') {
    const n = Math.max(1, parseInt(splits) || 1);
    const each = Math.round((total / n) / 1000) * 1000;
    let acc = 0;
    const created = [];
    for (let i = 0; i < n; i++) {
      const amount = i === n - 1 ? total - acc : each;
      acc += amount;
      created.push(await prisma.billSplit.create({
        data: { orderId, label: `Nhóm ${i + 1}`, amount, items: { create: [] } },
      }));
    }
    await prisma.order.update({ where: { id: orderId }, data: { splitMode: 'EVEN' } });
    auditService.log({ userId, action: 'SPLIT_BILL', entity: 'BillSplit', entityId: null, after: { orderId, mode, count: created.length } });
    return created;
  }

  if (mode === 'ITEM') {
    const created = [];
    for (const s of splits) {
      // s = { label, itemIds: [orderItemId], quantities: { itemId: qty } }
      let amount = 0;
      const items = [];
      for (const itemId of s.itemIds) {
        const oi = activeItems.find((i) => i.id === itemId);
        if (!oi) continue;
        const qty = s.quantities?.[itemId] || oi.quantity;
        // A9: round2 — trước đây ra số lẻ vô hạn (float), tiền tách lệch
        const lineAmount = round2(Number(oi.subtotal) * (qty / oi.quantity));
        amount = round2(amount + lineAmount);
        items.push({ orderItemId: itemId, quantity: qty, amount: lineAmount });
      }
      created.push(await prisma.billSplit.create({
        data: { orderId, label: s.label || 'Nhóm', amount, items: { create: items } },
        include: { items: true },
      }));
    }
    await prisma.order.update({ where: { id: orderId }, data: { splitMode: 'ITEM' } });
    auditService.log({ userId, action: 'SPLIT_BILL', entity: 'BillSplit', entityId: null, after: { orderId, mode, count: created.length } });
    return created;
  }

  if (mode === 'CUSTOM') {
    const created = [];
    for (const s of splits) {
      created.push(await prisma.billSplit.create({
        data: { orderId, label: s.label || 'Nhóm', amount: s.amount },
      }));
    }
    await prisma.order.update({ where: { id: orderId }, data: { splitMode: 'CUSTOM' } });
    auditService.log({ userId, action: 'SPLIT_BILL', entity: 'BillSplit', entityId: null, after: { orderId, mode, count: created.length } });
    return created;
  }

  throw { status: 400, message: 'Mode không hợp lệ (ITEM | EVEN | CUSTOM)' };
}

async function listSplits(orderId) {
  return prisma.billSplit.findMany({
    where: { orderId },
    include: { items: true },
    orderBy: { createdAt: 'asc' },
  });
}

// Mark 1 split đã thanh toán
async function markSplitPaid(splitId, paymentMethod, userId = null) {
  const split = await prisma.billSplit.update({
    where: { id: splitId },
    data: { paid: true, paymentMethod },
  });
  auditService.log({ userId, action: 'MARK_SPLIT_PAID', entity: 'BillSplit', entityId: splitId, after: { paymentMethod, amount: Number(split.amount) } });
  return split;
}

module.exports = { splitBill, listSplits, markSplitPaid };
