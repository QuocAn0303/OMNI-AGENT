/**
 * modules/tables/table.service.js — Quản lý bàn, khu vực, phiên bàn, đặt bàn
 *
 * Cung cấp:
 * - CRUD Area (khu vực sàn) + DinerTable (bàn) với qrToken tự sinh
 * - Mở/đóng TableSession (lượt khách ngồi)
 * - Ghép bàn, chuyển bàn, dọn bàn (status: AVAILABLE/OCCUPIED/DIRTY...)
 * - CRUD Reservation (đặt bàn trước)
 */
const prisma = require('../../config/prisma');
const crypto = require('crypto');
const auditService = require('../audit/audit.service');

// ==================== AREAS ====================

async function listAreas() {
  return prisma.area.findMany({
    where: { isActive: true },
    include: { tables: { orderBy: { code: 'asc' } } },
    orderBy: { sortOrder: 'asc' },
  });
}

async function createArea(data, userId = null) {
  const area = await prisma.area.create({ data: { name: data.name, sortOrder: data.sortOrder || 0 } });
  auditService.log({ userId, action: 'CREATE_AREA', entity: 'Area', entityId: area.id, after: { name: area.name } });
  return area;
}

async function updateArea(id, data, userId = null) {
  const area = await prisma.area.update({ where: { id }, data: { name: data.name, sortOrder: data.sortOrder, isActive: data.isActive } });
  auditService.log({ userId, action: 'UPDATE_AREA', entity: 'Area', entityId: id, after: { name: area.name } });
  return area;
}

async function deleteArea(id, userId = null) {
  const area = await prisma.area.update({ where: { id }, data: { isActive: false } });
  auditService.log({ userId, action: 'DELETE_AREA', entity: 'Area', entityId: id, before: { name: area.name } });
  return area;
}

// ==================== TABLES ====================

async function listTables(areaId) {
  return prisma.dinerTable.findMany({
    where: { areaId: areaId || undefined, isActive: true },
    include: { area: true },
    orderBy: { code: 'asc' },
  });
}

async function createTable(data, userId = null) {
  const qrToken = crypto.randomBytes(16).toString('hex');
  const table = await prisma.dinerTable.create({
    data: {
      areaId: data.areaId,
      code: data.code,
      capacity: data.capacity || 4,
      shape: data.shape || 'SQUARE',
      posX: data.posX || 0,
      posY: data.posY || 0,
      width: data.width || 100,
      height: data.height || 100,
      qrToken,
    },
  });
  auditService.log({ userId, action: 'CREATE_TABLE', entity: 'DinerTable', entityId: table.id, after: { code: table.code, areaId: table.areaId } });
  return table;
}

async function updateTable(id, data, userId = null) {
  const table = await prisma.dinerTable.update({
    where: { id },
    data: {
      code: data.code,
      capacity: data.capacity,
      shape: data.shape,
      posX: data.posX,
      posY: data.posY,
      width: data.width,
      height: data.height,
      status: data.status,
      isActive: data.isActive,
    },
  });
  auditService.log({ userId, action: 'UPDATE_TABLE', entity: 'DinerTable', entityId: id, after: { code: table.code, status: table.status } });
  return table;
}

async function deleteTable(id, userId = null) {
  const table = await prisma.dinerTable.update({ where: { id }, data: { isActive: false } });
  auditService.log({ userId, action: 'DELETE_TABLE', entity: 'DinerTable', entityId: id, before: { code: table.code } });
  return table;
}

// Cập nhật vị trí bàn (drag-drop floor plan)
async function updateTablePositions(positions, userId = null) {
  const result = await prisma.$transaction(
    positions.map((p) =>
      prisma.dinerTable.update({
        where: { id: p.id },
        data: { posX: p.posX, posY: p.posY, width: p.width, height: p.height },
      })
    )
  );
  auditService.log({ userId, action: 'UPDATE_TABLE_POSITIONS', entity: 'DinerTable', entityId: null, after: { count: result.length } });
  return result;
}

// ==================== TABLE SESSIONS ====================

// Mở session cho bàn = khách ngồi vào
async function openSession(tableId, guestCount = 1, userId = null) {
  const table = await prisma.dinerTable.findUnique({ where: { id: tableId } });
  if (!table) throw { status: 404, message: 'Không tìm thấy bàn' };
  if (table.status === 'OCCUPIED') throw { status: 400, message: 'Bàn đang có khách' };

  const session = await prisma.tableSession.create({
    data: { tableId, guestCount, status: 'OPEN' },
  });
  await prisma.dinerTable.update({
    where: { id: tableId },
    data: { status: 'OCCUPIED', currentSessionId: session.id },
  });
  auditService.log({ userId, action: 'OPEN_TABLE', entity: 'TableSession', entityId: session.id, after: { tableId, guestCount } });
  return session;
}

// Đóng session = khách thanh toán rời bàn
async function closeSession(tableId, userId = null) {
  const table = await prisma.dinerTable.findUnique({ where: { id: tableId } });
  if (!table || !table.currentSessionId) throw { status: 400, message: 'Bàn không có session đang mở' };

  const session = await prisma.tableSession.update({
    where: { id: table.currentSessionId },
    data: { status: 'CLOSED', closedAt: new Date() },
  });
  // Bàn -> DIRTY (cần dọn) thay vì AVAILABLE trực tiếp
  await prisma.dinerTable.update({
    where: { id: tableId },
    data: { status: 'DIRTY', currentSessionId: null },
  });
  auditService.log({ userId, action: 'CLOSE_TABLE', entity: 'TableSession', entityId: session.id, after: { tableId } });
  return session;
}

// Dọn bàn DIRTY -> AVAILABLE
async function clearTable(tableId, userId = null) {
  const table = await prisma.dinerTable.update({
    where: { id: tableId },
    data: { status: 'AVAILABLE' },
  });
  auditService.log({ userId, action: 'CLEAR_TABLE', entity: 'DinerTable', entityId: tableId, after: { status: 'AVAILABLE' } });
  return table;
}

// Ghép bàn: chuyển session + order từ fromTable sang toTable
async function mergeTables(fromTableId, toTableId, userId = null) {
  const from = await prisma.dinerTable.findUnique({ where: { id: fromTableId } });
  const to = await prisma.dinerTable.findUnique({ where: { id: toTableId } });
  if (!from || !to) throw { status: 404, message: 'Không tìm thấy bàn' };
  if (!from.currentSessionId) throw { status: 400, message: 'Bàn nguồn không có session' };

  const result = await prisma.$transaction(async (tx) => {
    // Chuyển session sang bàn đích
    if (to.currentSessionId) {
      // Bàn đích đã có session → gộp: đóng session nguồn, giữ session đích
      await tx.tableSession.update({
        where: { id: from.currentSessionId },
        data: { status: 'TRANSFERRED', closedAt: new Date(), note: 'Merged to ' + to.code },
      });
    } else {
      await tx.tableSession.update({
        where: { id: from.currentSessionId },
        data: { tableId: toTableId },
      });
      await tx.dinerTable.update({
        where: { id: toTableId },
        data: { status: 'OCCUPIED', currentSessionId: from.currentSessionId },
      });
    }
    // Bàn nguồn → dọn
    await tx.dinerTable.update({
      where: { id: fromTableId },
      data: { status: 'AVAILABLE', currentSessionId: null },
    });
    return { from, to };
  });
  auditService.log({ userId, action: 'MERGE_TABLE', entity: 'DinerTable', entityId: toTableId, after: { fromTableId, toTableId } });
  return result;
}

// Chuyển bàn (transfer): giống merge nhưng bàn nguồn cũng rỗng
async function transferTable(fromTableId, toTableId) {
  return mergeTables(fromTableId, toTableId);
}

// ==================== RESERVATIONS ====================

async function listReservations(date) {
  const where = {};
  if (date) {
    const d = new Date(date);
    const next = new Date(d.getTime() + 24 * 3600 * 1000);
    where.reservedAt = { gte: d, lt: next };
  }
  return prisma.reservation.findMany({ where, orderBy: { reservedAt: 'asc' } });
}

async function createReservation(data, userId = null) {
  const reservation = await prisma.reservation.create({ data });
  auditService.log({ userId, action: 'CREATE_RESERVATION', entity: 'Reservation', entityId: reservation.id, after: { customerName: data.customerName, phone: data.phone, time: data.time } });
  return reservation;
}

async function updateReservation(id, data, userId = null) {
  const reservation = await prisma.reservation.update({ where: { id }, data });
  auditService.log({ userId, action: 'UPDATE_RESERVATION', entity: 'Reservation', entityId: id, after: { customerName: data.customerName, status: data.status } });
  return reservation;
}

// Seat reservation → mở session
async function seatReservation(id, tableId, userId = null) {
  const r = await prisma.reservation.findUnique({ where: { id } });
  if (!r) throw { status: 404, message: 'Không tìm thấy đặt bàn' };
  const session = await openSession(tableId || r.tableId, r.guestCount, userId);
  await prisma.reservation.update({ where: { id }, data: { status: 'SEATED', tableId } });
  auditService.log({ userId, action: 'SEAT_RESERVATION', entity: 'Reservation', entityId: id, after: { tableId } });
  return session;
}

module.exports = {
  listAreas, createArea, updateArea, deleteArea,
  listTables, createTable, updateTable, deleteTable, updateTablePositions,
  openSession, closeSession, clearTable, mergeTables, transferTable,
  listReservations, createReservation, updateReservation, seatReservation,
};
