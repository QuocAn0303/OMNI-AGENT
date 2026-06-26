/**
 * modules/accounting/purchase.service.js — Service quản lý đơn nhập hàng (Purchase Order)
 * 
 * Tổng quan:
 * - Xử lý toàn bộ logic nghiệp vụ cho Purchase Order: tạo, gửi duyệt, phê duyệt,
 *   nhập kho, thanh toán, hủy.
 * - Hỗ trợ luồng: DRAFT → PENDING → APPROVED → RECEIVED → PAID (hoặc CANCELLED).
 * - Tích hợp: tự động sinh mã PO, tính thuế, cập nhật tồn kho theo weighted average cost,
 *   tạo công nợ tự động qua debtService, auto-post bút toán kế toán.
 * 
 * Hàm:
 * - generateCode(tx): Sinh mã PO dạng PO-YYYYMMDD-XXXX.
 * - computeItem(item, taxMap): Tính subtotal + taxAmount cho từng dòng hàng.
 * - list(query): Danh sách PO có phân trang, lọc.
 * - getById(id): Chi tiết PO kèm vendor, items, product.
 * - create(data, userId): Tạo PO trong transaction; support withCodeRetry.
 * - submit(id, userId): Gửi duyệt, chuyển DRAFT → PENDING.
 * - approve(id, approverRole, userId): Phê duyệt; kiểm tra hạn mức 50tr, chuyển PENDING → APPROVED.
 * - receive(id, userId): Nhập kho: update tồn kho (FIFO/weighted average cost), tạo inventoryTransaction,
 *   tạo công nợ vendor qua debtService, auto-post bút toán nhập kho.
 * - pay(id, {amount, method}, userId): Thanh toán PO: cập nhật paidAmount, ghi công nợ, auto-post payment entry.
 * - cancel(id, userId): Hủy PO (chỉ DRAFT/PENDING/APPROVED mới hủy được).
 */
// src/modules/accounting/purchase.service.js
const prisma = require("../../config/prisma");
const { getDefaultWarehouseId, findInventory } = require("../../utils/warehouse.helper");
const autopostService = require("./autopost.service");
const postingErrorService = require("./posting-error.service");
const { withCodeRetry } = require("./journal.service");
const auditService = require("../audit/audit.service");
const debtService = require("../debt/debt.service");

const toNum = (v) => Number(v || 0);
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

const PO_APPROVE_THRESHOLD = 50_000_000;

const generateCode = async (tx = prisma) => {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const count = await tx.purchaseOrder.count({ where: { createdAt: { gte: start } } });
  return `PO-${today}-${String(count + 1).padStart(4, "0")}`;
};

const computeItem = async (item, taxMap) => {
  const qty = Number(item.quantity || 0);
  const unitCost = round2(toNum(item.unitCost));
  const subtotal = round2(qty * unitCost);
  let taxAmount = 0;
  if (item.taxRateId && taxMap.has(item.taxRateId)) {
    taxAmount = round2((subtotal * Number(taxMap.get(item.taxRateId).rate)) / 100);
  }
  return { ...item, quantity: qty, unitCost, subtotal, taxAmount };
};

const list = async ({ page = 1, limit = 20, status, vendorId, from, to } = {}) => {
  const skip = (Number(page) - 1) * Number(limit);
  const where = {};
  if (status) where.status = status;
  if (vendorId) where.vendorId = vendorId;
  if (from || to) {
    where.date = {};
    if (from) where.date.gte = new Date(from);
    if (to) where.date.lte = new Date(to);
  }
  const [orders, total] = await Promise.all([
    prisma.purchaseOrder.findMany({
      where,
      skip,
      take: Number(limit),
      orderBy: { date: "desc" },
      include: {
        vendor: { select: { id: true, name: true } },
        items: { include: { product: { select: { id: true, name: true, sku: true } } } },
        createdBy: { select: { id: true, fullName: true } },
        approvedBy: { select: { id: true, fullName: true } },
      },
    }),
    prisma.purchaseOrder.count({ where }),
  ]);
  return {
    purchaseOrders: orders,
    pagination: { page: Number(page), limit: Number(limit), total, totalPages: Math.ceil(total / Number(limit)) },
  };
};

const getById = async (id) => {
  const po = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: {
      vendor: true,
      items: { include: { product: true, taxRate: true } },
      createdBy: { select: { id: true, fullName: true } },
      approvedBy: { select: { id: true, fullName: true } },
    },
  });
  if (!po) throw { status: 404, message: "Không tìm thấy phiếu nhập" };
  return po;
};

const create = async (data, userId) => {
  const { vendorId, items = [], expectedAt, note, invoiceNumber } = data;
  if (!items.length) throw { status: 400, message: "Phải có ít nhất 1 mặt hàng" };

  const taxIds = [...new Set(items.filter((i) => i.taxRateId).map((i) => i.taxRateId))];
  const taxes = await prisma.taxRate.findMany({ where: { id: { in: taxIds } } });
  const taxMap = new Map(taxes.map((t) => [t.id, t]));

  const computed = await Promise.all(items.map((it) => computeItem(it, taxMap)));
  const subtotal = round2(computed.reduce((s, i) => s + i.subtotal, 0));
  const taxAmount = round2(computed.reduce((s, i) => s + i.taxAmount, 0));
  const total = round2(subtotal + taxAmount);

  const po = await withCodeRetry(
    () => generateCode(),
    (code) =>
      prisma.purchaseOrder.create({
        data: {
          poCode: code,
          date: new Date(),
          vendorId,
          status: "DRAFT",
          paymentStatus: "UNPAID",
          subtotal,
          taxAmount,
          total,
          paidAmount: 0,
          expectedAt: expectedAt ? new Date(expectedAt) : null,
          invoiceNumber,
          note,
          createdById: userId,
          items: {
            create: computed.map((c) => ({
              productId: c.productId,
              quantity: c.quantity,
              unitCost: c.unitCost,
              taxRateId: c.taxRateId || null,
              taxAmount: c.taxAmount,
              subtotal: c.subtotal,
            })),
          },
        },
        include: { vendor: true, items: { include: { product: true } } },
      }),
  );

  await auditService
    .log({
      userId,
      action: "CREATE_PURCHASE_ORDER",
      entity: "PurchaseOrder",
      entityId: po.id,
      before: null,
      after: { poCode: po.poCode, status: po.status, total: po.total },
    })
    .catch(() => {});

  return po;
};

const submit = async (id, userId) => {
  const po = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: { items: true },
  });
  if (!po) throw { status: 404, message: "Không tìm thấy PO" };
  if (!po.items?.length) throw { status: 400, message: "PO cần ít nhất 1 dòng hàng để gửi duyệt" };
  if (po.status !== "DRAFT") throw { status: 400, message: "Chỉ PO nháp mới được gửi duyệt" };

  const updated = await prisma.purchaseOrder.update({
    where: { id },
    data: { status: "PENDING", submittedAt: new Date() },
    include: { vendor: true, items: true },
  });

  await auditService
    .log({
      userId,
      action: "PO_SUBMIT",
      entity: "PurchaseOrder",
      entityId: id,
      before: { status: "DRAFT" },
      after: { status: "PENDING" },
    })
    .catch(() => {});

  try {
    const notif = require("../notifications/notification.service");
    await notif.notifyPoSubmitted(updated);
  } catch (_) {}

  // Trigger workflow engine for PO_ABOVE workflows
  try {
    const workflowService = require("../workflow/workflow.service");
    await workflowService.trigger("PO_ABOVE", {
      entityType: "PurchaseOrder",
      entityId: id,
      data: { totalAmount: toNum(updated.total), poCode: updated.poCode, vendorId: updated.vendorId },
    });
  } catch (e) {
    console.error("[PO] workflow trigger error:", e.message);
  }

  return updated;
};

const approve = async (id, approverRole, userId) => {
  const po = await prisma.purchaseOrder.findUnique({ where: { id } });
  if (!po) throw { status: 404, message: "Không tìm thấy PO" };
  if (po.status !== "PENDING") throw { status: 400, message: "Chỉ PO chờ duyệt mới được duyệt" };
  if (toNum(po.total) >= PO_APPROVE_THRESHOLD && !["ADMIN", "MANAGER"].includes(approverRole)) {
    throw { status: 403, message: `PO từ ${PO_APPROVE_THRESHOLD.toLocaleString("vi-VN")}đ cần MANAGER trở lên duyệt` };
  }

  const updated = await prisma.purchaseOrder.update({
    where: { id },
    data: { status: "APPROVED", approvedById: userId },
    include: { vendor: true, items: { include: { product: true } } },
  });

  await auditService
    .log({
      userId,
      action: "PO_APPROVE",
      entity: "PurchaseOrder",
      entityId: id,
      before: { status: "PENDING" },
      after: { status: "APPROVED", approvedById: userId },
    })
    .catch(() => {});

  return updated;
};

const receive = async (id, userId) => {
  const postingPayloadHolder = { skip: false, payload: null };

  const updated = await prisma.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.findUnique({
        where: { id },
        include: { vendor: true, items: { include: { product: { include: { inventories: true } } } } },
      });
      if (!po) throw { status: 404, message: "Không tìm thấy PO" };

      if (po.status === "RECEIVED") {
        postingPayloadHolder.skip = true;
        return tx.purchaseOrder.findUnique({
          where: { id },
          include: { vendor: true, items: { include: { product: true } } },
        });
      }

      const r = await tx.purchaseOrder.updateMany({
        where: { id, status: "APPROVED" },
        data: { status: "RECEIVED", receivedAt: new Date() },
      });
      if (r.count === 0) {
        throw { status: 400, message: "PO phải ở trạng thái APPROVED để nhập kho" };
      }

      const whId = await getDefaultWarehouseId(tx);
      for (const item of po.items) {
        let inv = item.product.inventories?.find((i) => i.warehouseId === whId);
        if (!inv) {
          inv = await findInventory(tx, item.productId, whId);
        }
        if (!inv) {
          inv = await tx.inventory.create({
            data: { productId: item.productId, warehouseId: whId, quantity: 0, minStock: 10 },
          });
        }

        const oldQty = inv.quantity;
        const oldCost = toNum(item.product.costPrice);
        const addQty = item.quantity;
        const unitCost = toNum(item.unitCost);
        const newQty = oldQty + addQty;
        const newCost =
          newQty > 0 ? round2((oldQty * oldCost + addQty * unitCost) / newQty) : unitCost;

        await tx.inventory.update({
          where: { id: inv.id },
          data: { quantity: { increment: addQty } },
        });
        await tx.product.update({
          where: { id: item.productId },
          data: { costPrice: newCost },
        });
        await tx.inventoryTransaction.create({
          data: {
            inventoryId: inv.id,
            type: "IMPORT",
            quantity: addQty,
            note: `Nhập kho - PO ${po.poCode}`,
            unitCost: Math.round(unitCost * 100) / 100,
            createdById: userId,
          },
        });

        const poLotCode = `${po.poCode}-${item.product.sku || item.productId.slice(0, 8)}`;
        const existingLot = await tx.inventoryLot.findFirst({
          where: { lotCode: poLotCode, productId: item.productId, warehouseId: whId },
        });
        if (existingLot) {
          await tx.inventoryLot.update({
            where: { id: existingLot.id },
            data: { quantity: { increment: addQty } },
          });
        } else {
          await tx.inventoryLot.create({
            data: {
              lotCode: poLotCode,
              productId: item.productId,
              warehouseId: whId,
              quantity: addQty,
              originalQty: addQty,
              poId: po.id,
            },
          });
        }
      }

      const fresh = await tx.purchaseOrder.findUnique({
        where: { id },
        include: { vendor: true, items: { include: { product: true } } },
      });

      if (["UNPAID", "PARTIAL"].includes(fresh.paymentStatus || "UNPAID")) {
        await debtService.createPayableForPoInTx(tx, { po: fresh, userId });
      }

      postingPayloadHolder.payload = autopostService.buildPurchaseReceivedEntry({
        purchaseOrder: fresh,
        vendor: fresh.vendor,
        userId,
      });

      await auditService
        .log({
          userId,
          action: "PO_RECEIVE",
          entity: "PurchaseOrder",
          entityId: id,
          before: { status: "APPROVED" },
          after: { status: "RECEIVED", receivedAt: fresh.receivedAt },
        })
        .catch(() => {});

      return fresh;
    });

  if (!postingPayloadHolder.skip && postingPayloadHolder.payload) {
    await postingErrorService.tryPostOrQueue(
      () => autopostService.postPurchaseReceived({ purchaseOrder: updated, vendor: updated.vendor, userId }),
      { source: "PURCHASE", sourceId: updated.id, payload: postingPayloadHolder.payload },
    );
  }

  return updated;
};

const pay = async (id, { amount, method = "BANK_TRANSFER" }, userId) => {
  const parsedAmount = Number(amount);
  if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
    throw { status: 400, message: "Số tiền thanh toán không hợp lệ" };
  }
  const debt = await prisma.debt.findUnique({ where: { poId: id } });
  if (debt) {
    return debtService.recordDebtPayment(debt.id, { amount: parsedAmount, method, note: `Thanh toán PO` }, userId);
  }

  const result = await prisma.$transaction(async (tx) => {
    const po = await tx.purchaseOrder.findUnique({ where: { id }, include: { vendor: true } });
    if (!po) throw { status: 404, message: "Không tìm thấy PO" };
    if (!["RECEIVED", "PAID"].includes(po.status)) {
      throw { status: 400, message: "Chỉ có thể thanh toán PO đã nhập kho" };
    }
    const remaining = round2(toNum(po.total) - toNum(po.paidAmount));
    const payAmount = round2(toNum(amount));
    if (payAmount <= 0) throw { status: 400, message: "Số tiền thanh toán phải > 0" };
    if (payAmount > remaining) throw { status: 400, message: "Số tiền vượt quá còn nợ" };

    const newPaid = round2(toNum(po.paidAmount) + payAmount);
    const paymentStatus = require("../payments/payment.service").getPaymentStatus(toNum(po.total), newPaid);
    const newStatus = newPaid >= toNum(po.total) ? "PAID" : po.status;

    const updated = await tx.purchaseOrder.update({
      where: { id },
      data: { paidAmount: newPaid, status: newStatus, paymentStatus },
      include: { vendor: true },
    });

    await tx.vendor.update({
      where: { id: updated.vendorId },
      data: { totalDebt: { decrement: payAmount } },
    });

    return { updated, payAmount, method };
  });

  // Mỗi partial payment cần có ID duy nhất để journal entry idempotent.
  // Dùng `paidAmount` sau khi thanh toán (newPaid) — giá trị này luôn khác nhau
  // giữa các lần pay() trên cùng 1 PO (vì atomic update).
  const paymentId = `po-${result.updated.id}-paid-${result.updated.paidAmount}`;
  const postingPayload = autopostService.buildPurchasePaymentEntry({
    purchaseOrder: result.updated,
    vendor: result.updated.vendor,
    amount: result.payAmount,
    method: result.method,
    userId,
    paymentId,
  });
  await postingErrorService.tryPostOrQueue(
    () =>
      autopostService.postPurchasePayment({
        purchaseOrder: result.updated,
        vendor: result.updated.vendor,
        amount: result.payAmount,
        method: result.method,
        userId,
        paymentId,
      }),
    {
      source: "PURCHASE",
      sourceId: result.updated.id,
      payload: { ...postingPayload, paymentId },
    },
  );

  return result.updated;
};

const cancel = async (id, userId) => {
  const po = await prisma.purchaseOrder.findUnique({ where: { id } });
  if (!po) throw { status: 404, message: "Không tìm thấy PO" };
  if (!["DRAFT", "PENDING", "APPROVED"].includes(po.status)) {
    throw { status: 400, message: "Không thể hủy PO đã nhập kho / đã thanh toán" };
  }
  const updated = await prisma.purchaseOrder.update({ where: { id }, data: { status: "CANCELLED" } });
  await auditService
    .log({
      userId,
      action: "PO_CANCEL",
      entity: "PurchaseOrder",
      entityId: id,
      before: { status: po.status },
      after: { status: "CANCELLED" },
    })
    .catch(() => {});
  return updated;
};

module.exports = { list, getById, create, submit, approve, receive, pay, cancel };
