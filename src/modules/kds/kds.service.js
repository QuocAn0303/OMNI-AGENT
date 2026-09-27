/**
 * modules/kds/kds.service.js — Kitchen Display System
 *
 * Cung cấp:
 * - CRUD KdsStation (Bếp chính / Bar / Trà sữa)
 * - Tự sinh KdsTicket khi order CONFIRMED (route mỗi món theo product.kdsStationId)
 * - Bump ticket: NEW → COOKING → READY → SERVED
 * - Recall, đo prepTimeSec
 * - List ticket theo station cho màn hình bếp
 */
const prisma = require('../../config/prisma');
const auditService = require('../audit/audit.service');

// ==================== STATIONS ====================

async function listStations() {
  return prisma.kdsStation.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: 'asc' },
  });
}

async function createStation(data, userId = null) {
  const station = await prisma.kdsStation.create({ data: { name: data.name, printerId: data.printerId, sortOrder: data.sortOrder || 0 } });
  auditService.log({ userId, action: 'CREATE_KDS_STATION', entity: 'KdsStation', entityId: station.id, after: { name: station.name } });
  return station;
}

async function updateStation(id, data, userId = null) {
  const station = await prisma.kdsStation.update({ where: { id }, data: { name: data.name, printerId: data.printerId, sortOrder: data.sortOrder, isActive: data.isActive } });
  auditService.log({ userId, action: 'UPDATE_KDS_STATION', entity: 'KdsStation', entityId: id, after: { name: station.name } });
  return station;
}

async function deleteStation(id, userId = null) {
  const station = await prisma.kdsStation.update({ where: { id }, data: { isActive: false } });
  auditService.log({ userId, action: 'DELETE_KDS_STATION', entity: 'KdsStation', entityId: id, before: { name: station.name } });
  return station;
}

// ==================== TICKETS ====================

// Lấy ticket cho 1 station (chưa served)
async function getTicketsByStation(stationId) {
  return prisma.kdsTicket.findMany({
    where: { stationId, status: { in: ['NEW', 'COOKING', 'READY', 'RECALLED'] } },
    include: {
      orderItem: { include: { product: true, modifiers: { include: { modifierOption: true } } } },
    },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  });
}

// Lấy tất cả ticket active cho toàn bộ station (cho dashboard bếp tổng)
async function getAllActiveTickets() {
  return prisma.kdsTicket.findMany({
    where: { status: { in: ['NEW', 'COOKING', 'READY', 'RECALLED'] } },
    include: { orderItem: { include: { product: true, modifiers: { include: { modifierOption: true } } } }, station: true },
    orderBy: [{ stationId: 'asc' }, { createdAt: 'asc' }],
  });
}

// Sinh ticket cho order khi CONFIRMED — route theo product.kdsStationId
// Bỏ qua item đã VOIDED hoặc không có station
async function generateTicketsForOrder(orderId, userId = null) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: { include: { product: true, modifiers: { include: { modifierOption: true } } } } },
  });
  if (!order) throw { status: 404, message: 'Không tìm thấy đơn' };

  const tickets = [];
  for (const item of order.items) {
    if (item.status === 'VOIDED') continue;
    const stationId = item.product.kdsStationId;
    if (!stationId) continue; // món không gán station → không hiện KDS

    // Idempotent: kiểm tra đã có ticket cho orderItemId chưa
    const existing = await prisma.kdsTicket.findUnique({ where: { orderItemId: item.id } });
    if (existing) continue;

    const ticket = await prisma.kdsTicket.create({
      data: {
        orderItemId: item.id,
        orderId,
        stationId,
        status: 'NEW',
        firedAt: new Date(),
      },
    });
    tickets.push(ticket);

    // Cập nhật OrderItem.status = FIRED
    await prisma.orderItem.update({ where: { id: item.id }, data: { status: 'FIRED' } });
  }
  auditService.log({ userId, action: 'GENERATE_KDS_TICKETS', entity: 'KdsTicket', entityId: null, after: { orderId, count: tickets.length } });
  return tickets;
}

// Bump: NEW → COOKING → READY → SERVED
async function bumpTicket(ticketId, userId = null) {
  const ticket = await prisma.kdsTicket.findUnique({ where: { id: ticketId } });
  if (!ticket) throw { status: 404, message: 'Không tìm thấy ticket' };

  const flow = { NEW: 'COOKING', COOKING: 'READY', READY: 'SERVED' };
  const next = flow[ticket.status];
  if (!next) throw { status: 400, message: `Không thể bump ticket ở trạng thái ${ticket.status}` };

  const now = new Date();
  const updateData = { status: next, bumpCount: { increment: 1 } };
  if (next === 'READY') updateData.readyAt = now;
  if (next === 'SERVED') {
    updateData.servedAt = now;
    if (ticket.firedAt) updateData.prepTimeSec = Math.round((now - ticket.firedAt) / 1000);
    // Cập nhật OrderItem.status = SERVED
    await prisma.orderItem.update({ where: { id: ticket.orderItemId }, data: { status: 'SERVED' } });
  }

  const updated = await prisma.kdsTicket.update({ where: { id: ticketId }, data: updateData });
  auditService.log({ userId, action: 'BUMP_KDS_TICKET', entity: 'KdsTicket', entityId: ticketId, before: { status: ticket.status }, after: { status: next } });
  return updated;
}

// Recall: SERVED/READY → RECALLED (chef gọi lại, món có vấn đề)
async function recallTicket(ticketId, userId = null) {
  const ticket = await prisma.kdsTicket.update({
    where: { id: ticketId },
    data: { status: 'RECALLED' },
  });
  auditService.log({ userId, action: 'RECALL_KDS_TICKET', entity: 'KdsTicket', entityId: ticketId, after: { status: 'RECALLED' } });
  return ticket;
}

// Void ticket (khi OrderItem void)
async function voidTicket(ticketId, userId = null) {
  const ticket = await prisma.kdsTicket.update({
    where: { id: ticketId },
    data: { status: 'VOIDED' },
  });
  auditService.log({ userId, action: 'VOID_KDS_TICKET', entity: 'KdsTicket', entityId: ticketId, after: { status: 'VOIDED' } });
  return ticket;
}

module.exports = {
  listStations, createStation, updateStation, deleteStation,
  getTicketsByStation, getAllActiveTickets,
  generateTicketsForOrder, bumpTicket, recallTicket, voidTicket,
};
