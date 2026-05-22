// src/modules/production/routing.service.js
const prisma = require("../../config/prisma");

const list = (params = {}) =>
  prisma.routing.findMany({
    where: params.productId ? { productId: params.productId } : {},
    include: {
      product: { select: { name: true, sku: true } },
      operations: { include: { workCenter: { select: { code: true, name: true } } }, orderBy: { sequence: "asc" } },
    },
    orderBy: { code: "asc" },
  });

const getById = (id) =>
  prisma.routing.findUniqueOrThrow({
    where: { id },
    include: { operations: { include: { workCenter: true }, orderBy: { sequence: "asc" } } },
  });

const create = async ({ code, name, productId, bomId, notes, operations = [] }) => {
  if (!code || !name || !productId) throw { status: 400, message: "Cần code, name, productId" };
  return prisma.routing.create({
    data: {
      code, name, productId, bomId: bomId || null, notes,
      operations: {
        create: operations.map((op, i) => ({
          sequence: op.sequence ?? i + 1,
          name: op.name,
          workCenterId: op.workCenterId || null,
          durationMinutes: op.durationMinutes ?? 60,
          notes: op.notes,
        })),
      },
    },
    include: { operations: { orderBy: { sequence: "asc" } } },
  });
};

const update = async (id, { name, notes, isActive, operations }) => {
  const routing = await prisma.routing.findUniqueOrThrow({ where: { id } });
  return prisma.$transaction(async (tx) => {
    if (operations !== undefined) {
      await tx.routingOperation.deleteMany({ where: { routingId: id } });
      await tx.routingOperation.createMany({
        data: operations.map((op, i) => ({
          routingId: id,
          sequence: op.sequence ?? i + 1,
          name: op.name,
          workCenterId: op.workCenterId || null,
          durationMinutes: op.durationMinutes ?? 60,
          notes: op.notes,
        })),
      });
    }
    return tx.routing.update({
      where: { id },
      data: { name, notes, isActive },
      include: { operations: { orderBy: { sequence: "asc" } } },
    });
  });
};

module.exports = { list, getById, create, update };
