/**
 * modules/petty-cash/petty-cash.service.js — Quỹ lẻ F&B (trà đá, vắt mũ, tip)
 */
const prisma = require('../../config/prisma');

async function list(filters = {}) {
  const where = {};
  if (filters.type) where.type = filters.type;
  if (filters.from || filters.to) {
    where.createdAt = {};
    if (filters.from) where.createdAt.gte = new Date(filters.from);
    if (filters.to) where.createdAt.lte = new Date(filters.to);
  }
  return prisma.pettyCashTransaction.findMany({ where, orderBy: { createdAt: 'desc' }, take: 200 });
}

async function create({ type, amount, description, userId }) {
  return prisma.pettyCashTransaction.create({
    data: { type, amount, description, receivedById: userId },
  });
}

async function getBalance() {
  const txs = await prisma.pettyCashTransaction.findMany();
  const balance = txs.reduce((sum, t) => sum + (t.type === 'IN' ? Number(t.amount) : -Number(t.amount)), 0);
  return { balance, totalIn: txs.filter((t) => t.type === 'IN').reduce((s, t) => s + Number(t.amount), 0), totalOut: txs.filter((t) => t.type === 'OUT').reduce((s, t) => s + Number(t.amount), 0) };
}

module.exports = { list, create, getBalance };
