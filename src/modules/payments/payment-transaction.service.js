/**
 * modules/payments/payment-transaction.service.js — Bản ghi thanh toán thống nhất
 *
 * Đã merged vào model Payment. Các hàm này redirect qua Payment model
 * với gateway fields (provider, providerTxId, txStatus, rawResponse, refundedAmount).
 */
const prisma = require('../../config/prisma');

async function list(filters = {}) {
  const where = {};
  if (filters.provider) where.provider = filters.provider;
  if (filters.txStatus) where.txStatus = filters.txStatus;
  if (filters.orderId) where.orderId = filters.orderId;
  return prisma.payment.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
}

// Tạo bản ghi PENDING khi tạo QR payment
async function createPending({ provider, providerTxId, orderId, amount }) {
  return prisma.payment.create({
    data: {
      orderId: orderId || '__pending__',
      amount,
      method: 'MOMO',
      provider,
      providerTxId,
      txStatus: 'PENDING',
      createdById: 'SYSTEM',
    },
  });
}

// Cập nhật khi webhook thành công — idempotent theo providerTxId
async function markSuccess(providerTxId, { rawResponse, orderId, amount }) {
  const existing = await prisma.payment.findFirst({ where: { providerTxId } });
  if (!existing) {
    return prisma.payment.create({
      data: {
        orderId: orderId || '__pending__',
        amount: amount || 0,
        method: 'MOMO',
        provider: 'MOMO',
        providerTxId,
        txStatus: 'SUCCESS',
        rawResponse,
        createdById: 'SYSTEM',
      },
    });
  }
  if (existing.txStatus === 'SUCCESS') return existing;
  return prisma.payment.update({
    where: { id: existing.id },
    data: { txStatus: 'SUCCESS', rawResponse, orderId: orderId || existing.orderId },
  });
}

// Refund
async function markRefunded(providerTxId, refundAmount, rawResponse) {
  const existing = await prisma.payment.findFirst({ where: { providerTxId } });
  if (!existing) return null;
  // A6: phải CỘNG DỒN (increment) — trước đây ghi đè, hoàn 300 rồi 200 → mất 300.
  const cumulativeRefunded = toNumber(existing.refundedAmount) + toNumber(refundAmount);
  return prisma.payment.update({
    where: { id: existing.id },
    data: {
      txStatus: cumulativeRefunded >= toNumber(existing.amount) ? 'REFUNDED' : 'PARTIAL_REFUND',
      refundedAmount: { increment: toNumber(refundAmount) },
      rawResponse,
    },
  });
}

const toNumber = (v) => Number(v || 0);

module.exports = { list, createPending, markSuccess, markRefunded };
