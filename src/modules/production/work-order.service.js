// src/modules/production/work-order.service.js
const prisma = require("../../config/prisma");
const auditService = require("../audit/audit.service");

const WO_LIST_SELECT = {
  id: true,
  code: true,
  quantity: true,
  producedQty: true,
  status: true,
  plannedStartDate: true,
  plannedEndDate: true,
  actualStartDate: true,
  actualEndDate: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
  product: { select: { id: true, sku: true, name: true, unit: true } },
  warehouse: { select: { id: true, code: true, name: true } },
  bom: { select: { id: true, code: true, version: true } },
  createdBy: { select: { id: true, fullName: true } },
  _count: { select: { items: true } },
};

const WO_DETAIL_SELECT = {
  ...WO_LIST_SELECT,
  items: {
    select: {
      id: true,
      requiredQty: true,
      consumedQty: true,
      component: {
        select: {
          id: true,
          sku: true,
          name: true,
          unit: true,
          inventories: {
            select: { warehouseId: true, quantity: true },
          },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  },
};

const generateCode = () => {
  const ts = Date.now().toString().slice(-8);
  const rand = Math.floor(Math.random() * 1000).toString().padStart(3, "0");
  return `WO-${ts}${rand}`;
};

const overview = async () => {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [totalWorkOrders, inProgress, completedThisMonth, activeBoms] = await Promise.all([
    prisma.workOrder.count(),
    prisma.workOrder.count({ where: { status: "IN_PROGRESS" } }),
    prisma.workOrder.count({
      where: { status: "COMPLETED", actualEndDate: { gte: monthStart } },
    }),
    prisma.bom.count({ where: { status: "ACTIVE" } }),
  ]);

  return { totalWorkOrders, inProgress, completedThisMonth, activeBoms };
};

const list = async ({ page = 1, limit = 20, status, productId, search } = {}) => {
  const p = Math.max(1, Number(page) || 1);
  const l = Math.max(1, Number(limit) || 20);

  const where = {};
  if (status) where.status = status;
  if (productId) where.productId = productId;
  if (search && search.trim()) {
    const s = search.trim();
    where.OR = [
      { code: { contains: s, mode: "insensitive" } },
      { product: { name: { contains: s, mode: "insensitive" } } },
    ];
  }

  const [items, total] = await Promise.all([
    prisma.workOrder.findMany({
      where,
      select: WO_LIST_SELECT,
      orderBy: { createdAt: "desc" },
      skip: (p - 1) * l,
      take: l,
    }),
    prisma.workOrder.count({ where }),
  ]);

  return {
    items,
    pagination: { page: p, limit: l, total, totalPages: Math.ceil(total / l) },
  };
};

const getById = async (id) => {
  const wo = await prisma.workOrder.findUnique({
    where: { id },
    select: WO_DETAIL_SELECT,
  });
  if (!wo) {
    const err = new Error("Lệnh sản xuất không tồn tại");
    err.status = 404;
    throw err;
  }
  // Reduce inventories[] to stock at this WO's warehouse only for clarity
  wo.items = wo.items.map((it) => {
    const inv = (it.component.inventories || []).find(
      (x) => x.warehouseId === wo.warehouse.id
    );
    return {
      ...it,
      component: {
        id: it.component.id,
        sku: it.component.sku,
        name: it.component.name,
        unit: it.component.unit,
      },
      availableQty: inv ? inv.quantity : 0,
    };
  });
  return wo;
};

const create = async (data, userId) => {
  if (!Number.isInteger(data.quantity) || data.quantity <= 0) {
    const err = new Error("Số lượng sản xuất phải > 0");
    err.status = 400;
    throw err;
  }

  const bom = await prisma.bom.findUnique({
    where: { id: data.bomId },
    select: {
      id: true,
      status: true,
      productId: true,
      items: { select: { componentId: true, quantity: true } },
    },
  });
  if (!bom) {
    const err = new Error("BOM không tồn tại");
    err.status = 404;
    throw err;
  }
  if (bom.status !== "ACTIVE") {
    const err = new Error("Chỉ có thể tạo WO từ BOM đang ACTIVE");
    err.status = 400;
    throw err;
  }
  if (bom.items.length === 0) {
    const err = new Error("BOM chưa có nguyên liệu");
    err.status = 400;
    throw err;
  }

  const warehouse = await prisma.warehouse.findUnique({
    where: { id: data.warehouseId },
    select: { id: true, isActive: true },
  });
  if (!warehouse || !warehouse.isActive) {
    const err = new Error("Kho không hợp lệ");
    err.status = 400;
    throw err;
  }

  const wo = await prisma.workOrder.create({
    data: {
      code: generateCode(),
      bomId: bom.id,
      productId: bom.productId,
      quantity: data.quantity,
      warehouseId: data.warehouseId,
      plannedStartDate: data.plannedStartDate ? new Date(data.plannedStartDate) : null,
      plannedEndDate: data.plannedEndDate ? new Date(data.plannedEndDate) : null,
      notes: data.notes || null,
      createdById: userId,
      items: {
        create: bom.items.map((it) => ({
          componentId: it.componentId,
          requiredQty: it.quantity * data.quantity,
        })),
      },
    },
    select: WO_DETAIL_SELECT,
  });

  auditService.log({
    userId,
    action: "CREATE_WORK_ORDER",
    entity: "WorkOrder",
    entityId: wo.id,
    after: { code: wo.code, bomId: bom.id, quantity: data.quantity },
  });

  return getById(wo.id);
};

const update = async (id, data, userId) => {
  const before = await prisma.workOrder.findUnique({
    where: { id },
    select: { id: true, status: true, quantity: true, bomId: true },
  });
  if (!before) {
    const err = new Error("Lệnh sản xuất không tồn tại");
    err.status = 404;
    throw err;
  }
  if (before.status !== "DRAFT") {
    const err = new Error("Chỉ có thể sửa WO ở trạng thái DRAFT");
    err.status = 400;
    throw err;
  }

  const patch = {};
  if (data.plannedStartDate !== undefined)
    patch.plannedStartDate = data.plannedStartDate ? new Date(data.plannedStartDate) : null;
  if (data.plannedEndDate !== undefined)
    patch.plannedEndDate = data.plannedEndDate ? new Date(data.plannedEndDate) : null;
  if (data.notes !== undefined) patch.notes = data.notes;
  if (data.warehouseId !== undefined) patch.warehouseId = data.warehouseId;

  // If quantity changed → recalculate required qty for items
  let newQuantity = before.quantity;
  if (data.quantity !== undefined) {
    if (!Number.isInteger(data.quantity) || data.quantity <= 0) {
      const err = new Error("Số lượng sản xuất phải > 0");
      err.status = 400;
      throw err;
    }
    patch.quantity = data.quantity;
    newQuantity = data.quantity;
  }

  await prisma.$transaction(async (tx) => {
    if (Object.keys(patch).length > 0) {
      await tx.workOrder.update({ where: { id }, data: patch });
    }
    if (data.quantity !== undefined && data.quantity !== before.quantity) {
      const bom = await tx.bom.findUnique({
        where: { id: before.bomId },
        select: { items: { select: { componentId: true, quantity: true } } },
      });
      // Recompute all WO items required qty from BOM × new WO quantity
      for (const it of bom.items) {
        await tx.workOrderItem.updateMany({
          where: { workOrderId: id, componentId: it.componentId },
          data: { requiredQty: it.quantity * newQuantity },
        });
      }
    }
  });

  auditService.log({
    userId,
    action: "UPDATE_WORK_ORDER",
    entity: "WorkOrder",
    entityId: id,
    before: { quantity: before.quantity },
    after: { quantity: newQuantity },
  });

  return getById(id);
};

const start = async (id, userId) => {
  const wo = await prisma.workOrder.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      warehouseId: true,
      items: {
        select: {
          requiredQty: true,
          componentId: true,
          component: { select: { sku: true, name: true } },
        },
      },
    },
  });
  if (!wo) {
    const err = new Error("Lệnh sản xuất không tồn tại");
    err.status = 404;
    throw err;
  }
  if (wo.status !== "DRAFT") {
    const err = new Error("Chỉ có thể bắt đầu WO ở trạng thái DRAFT");
    err.status = 400;
    throw err;
  }

  // Check stock availability for all components at warehouse
  const componentIds = wo.items.map((x) => x.componentId);
  const inventories = await prisma.inventory.findMany({
    where: { warehouseId: wo.warehouseId, productId: { in: componentIds } },
    select: { productId: true, quantity: true },
  });
  const stockMap = new Map(inventories.map((i) => [i.productId, i.quantity]));

  const shortages = [];
  for (const it of wo.items) {
    const have = stockMap.get(it.componentId) || 0;
    if (have < it.requiredQty) {
      shortages.push({
        component: `${it.component.sku} - ${it.component.name}`,
        required: it.requiredQty,
        available: have,
      });
    }
  }
  if (shortages.length > 0) {
    const msg = shortages
      .map((s) => `${s.component} (cần ${s.required}, còn ${s.available})`)
      .join("; ");
    const err = new Error(`Thiếu nguyên liệu: ${msg}`);
    err.status = 400;
    throw err;
  }

  const updated = await prisma.workOrder.update({
    where: { id },
    data: { status: "IN_PROGRESS", actualStartDate: new Date() },
    select: WO_LIST_SELECT,
  });

  auditService.log({
    userId,
    action: "START_WORK_ORDER",
    entity: "WorkOrder",
    entityId: id,
    after: { status: "IN_PROGRESS" },
  });

  return updated;
};

const complete = async (id, userId) => {
  const wo = await prisma.workOrder.findUnique({
    where: { id },
    select: {
      id: true,
      code: true,
      status: true,
      productId: true,
      warehouseId: true,
      quantity: true,
      items: {
        select: { id: true, componentId: true, requiredQty: true },
      },
    },
  });
  if (!wo) {
    const err = new Error("Lệnh sản xuất không tồn tại");
    err.status = 404;
    throw err;
  }
  if (wo.status !== "IN_PROGRESS") {
    const err = new Error("Chỉ có thể hoàn thành WO đang IN_PROGRESS");
    err.status = 400;
    throw err;
  }

  return prisma.$transaction(async (tx) => {
    // 1. Re-check + deduct material inventories
    for (const it of wo.items) {
      const inv = await tx.inventory.findUnique({
        where: { productId_warehouseId: { productId: it.componentId, warehouseId: wo.warehouseId } },
        select: { id: true, quantity: true },
      });
      if (!inv || inv.quantity < it.requiredQty) {
        const err = new Error("Tồn kho nguyên liệu không còn đủ. Vui lòng nhập kho trước.");
        err.status = 400;
        throw err;
      }
      await tx.inventory.update({
        where: { id: inv.id },
        data: { quantity: { decrement: it.requiredQty } },
      });
      await tx.inventoryTransaction.create({
        data: {
          inventoryId: inv.id,
          type: "EXPORT",
          quantity: it.requiredQty,
          note: `Tiêu thụ nguyên liệu cho WO ${wo.code}`,
          createdById: userId,
        },
      });
      await tx.workOrderItem.update({
        where: { id: it.id },
        data: { consumedQty: it.requiredQty },
      });
    }

    // 2. Add finished product to inventory (upsert)
    let finishedInv = await tx.inventory.findUnique({
      where: { productId_warehouseId: { productId: wo.productId, warehouseId: wo.warehouseId } },
      select: { id: true },
    });
    if (!finishedInv) {
      finishedInv = await tx.inventory.create({
        data: {
          productId: wo.productId,
          warehouseId: wo.warehouseId,
          quantity: wo.quantity,
        },
        select: { id: true },
      });
    } else {
      await tx.inventory.update({
        where: { id: finishedInv.id },
        data: { quantity: { increment: wo.quantity } },
      });
    }
    await tx.inventoryTransaction.create({
      data: {
        inventoryId: finishedInv.id,
        type: "IMPORT",
        quantity: wo.quantity,
        note: `Nhập kho thành phẩm từ WO ${wo.code}`,
        createdById: userId,
      },
    });

    // 3. Update WO
    const updated = await tx.workOrder.update({
      where: { id },
      data: {
        status: "COMPLETED",
        producedQty: wo.quantity,
        actualEndDate: new Date(),
      },
      select: WO_LIST_SELECT,
    });

    auditService.log({
      userId,
      action: "COMPLETE_WORK_ORDER",
      entity: "WorkOrder",
      entityId: id,
      after: { status: "COMPLETED", producedQty: wo.quantity },
    });

    return updated;
  });
};

const cancel = async (id, userId) => {
  const wo = await prisma.workOrder.findUnique({
    where: { id },
    select: { id: true, status: true, code: true },
  });
  if (!wo) {
    const err = new Error("Lệnh sản xuất không tồn tại");
    err.status = 404;
    throw err;
  }
  if (!["DRAFT", "IN_PROGRESS"].includes(wo.status)) {
    const err = new Error("Không thể hủy WO ở trạng thái này");
    err.status = 400;
    throw err;
  }

  const updated = await prisma.workOrder.update({
    where: { id },
    data: { status: "CANCELLED" },
    select: WO_LIST_SELECT,
  });

  auditService.log({
    userId,
    action: "CANCEL_WORK_ORDER",
    entity: "WorkOrder",
    entityId: id,
    before: { status: wo.status },
    after: { status: "CANCELLED" },
  });

  return updated;
};

const remove = async (id, userId) => {
  const wo = await prisma.workOrder.findUnique({
    where: { id },
    select: { id: true, code: true, status: true },
  });
  if (!wo) {
    const err = new Error("Lệnh sản xuất không tồn tại");
    err.status = 404;
    throw err;
  }
  if (wo.status !== "DRAFT") {
    const err = new Error("Chỉ có thể xóa WO ở trạng thái DRAFT");
    err.status = 400;
    throw err;
  }

  await prisma.workOrder.delete({ where: { id } });

  auditService.log({
    userId,
    action: "DELETE_WORK_ORDER",
    entity: "WorkOrder",
    entityId: id,
    before: { code: wo.code },
  });

  return { id };
};

module.exports = { overview, list, getById, create, update, start, complete, cancel, remove };
