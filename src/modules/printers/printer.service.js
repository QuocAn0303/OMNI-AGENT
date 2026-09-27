/**
 * modules/printers/printer.service.js — Cấu hình máy in ESC/POS cho F&B
 *
 * Phân luồng in: món nước in ở bar, món ăn in ở bếp chính, bill in ở quầy.
 * Tích hợp với utils/thermalPrinter.js (đã có ESC/POS Bluetooth 58/80mm).
 */
const prisma = require('../../config/prisma');
const auditService = require('../audit/audit.service');

async function listPrinters() {
  return prisma.printer.findMany({ orderBy: { createdAt: 'asc' } });
}

async function createPrinter(data, userId = null) {
  const printer = await prisma.printer.create({
    data: {
      name: data.name,
      stationId: data.stationId,
      connectionType: data.connectionType || 'BLUETOOTH',
      macAddress: data.macAddress,
      ipAddress: data.ipAddress,
      paperWidth: data.paperWidth || 58,
    },
  });
  auditService.log({ userId, action: 'CREATE_PRINTER', entity: 'Printer', entityId: printer.id, after: { name: printer.name } });
  return printer;
}

async function updatePrinter(id, data, userId = null) {
  const printer = await prisma.printer.update({
    where: { id },
    data: {
      name: data.name,
      stationId: data.stationId,
      connectionType: data.connectionType,
      macAddress: data.macAddress,
      ipAddress: data.ipAddress,
      paperWidth: data.paperWidth,
      isActive: data.isActive,
    },
  });
  auditService.log({ userId, action: 'UPDATE_PRINTER', entity: 'Printer', entityId: id, after: { name: printer.name } });
  return printer;
}

async function deletePrinter(id, userId = null) {
  const printer = await prisma.printer.update({ where: { id }, data: { isActive: false } });
  auditService.log({ userId, action: 'DELETE_PRINTER', entity: 'Printer', entityId: id, before: { name: printer.name } });
  return printer;
}

module.exports = { listPrinters, createPrinter, updatePrinter, deletePrinter };
