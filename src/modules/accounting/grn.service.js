/**
 * modules/accounting/grn.service.js — Phiếu nhập kho từ PO (Goods Receipt Note) — Mục 6.1
 *
 * Tổng quan:
 * - Luồng: DRAFT (nhận hàng) → recordQc (pass/reject) → QC_DONE → post (POSTED).
 * - Khi POSTED: cập nhật Inventory theo giá vốn bình quân gia quyền + InventoryTransaction
 *   IMPORT + InventoryLot — TÁI DÙNG helper `findInventory`/`getDefaultWarehouseId`
 *   và pattern giống `purchase.service.receive` (không viết lại phép cộng tồn kho).
 * - KHÔNG tạo Debt tại đây: công nợ phải trả sinh ở bước 3-Way Matching khi
 *   PurchaseInvoiceRecord MATCHED (xem purchase-invoice.service.js). Hàm
 *   `debtService.createPayableForPoInTx` là idempotent (poId unique) nên legacy
 *   luồng `receive` tạo Debt trước không gây duplicate.
 * - PO chuyển RECEIVED khi tổng receivedQty của các GRN POSTED >= tổng orderedQty.
 *
 * Hàm:
 * - create(poId, {warehouseId, receivedAt, items}, userId): tạo GRN DRAFT (validate over-receipt)
 * - recordQc(id, items, userId): ghi nhận passQty/rejectQty từng line → QC_DONE
 * - post(id, userId): POSTED — nhập kho + tính onTime + cập nhật PO RECEIVED khi đủ hàng
 * - list({poId, status, page, limit}) / getById(id)
 */
const prisma = require("../../config/prisma");
const { getDefaultWarehouseId, findInventory } = require("../../utils/warehouse.helper");
const { withCodeRetry } = require("./journal.service");
const auditService = require("../audit/audit.service");
const logger = require("../../utils/logger");
// Nối kế toán: GRN POSTED phải ghi Nợ 156 / Có 331, nếu không hàng vào kho mà
// sổ cái không có tài sản. KHÔNG có vòng require: `autopost` chỉ cần
// `journal.service`, `debt.service` không cần `grn.service`.
const autopostService = require("./autopost.service");
const debtService = require("../debt/debt.service");
const postingErrorService = require("./posting-error.service");

const toNum = (v) => Number(v || 0);
const round2 = (v) => Math.round(v * 100) / 100;

// Mã GRN-YYYYMMDD-XXXX (tăng dần trong ngày, dùng withCodeRetry chống trùng)
const generateGrnCode = async (tx) => {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const count = await tx.goodsReceiptNote.count({
    where: { grnCode: { startsWith: `GRN-${ymd}-` } },
  });
  return `GRN-${ymd}-${String(count + 1).padStart(4, "0")}`;
};

// Tạo GRN DRAFT cho 1 PO — validate: PO APPROVED/ORDERED, item thuộc PO, không nhận vượt
const create = async (poId, { warehouseId = null, receivedAt = null, items = [] } = {}, userId, client = prisma) => {
  if (!items.length) throw { status: 400, message: "GRN cần ít nhất 1 dòng hàng" };

  const po = await client.purchaseOrder.findUnique({
    where: { id: poId },
    include: { items: true },
  });
  if (!po) throw { status: 404, message: "Không tìm thấy PO" };
  if (!["APPROVED", "ORDERED"].includes(po.status)) {
    throw { status: 400, message: "PO phải ở trạng thái APPROVED/ORDERED để nhận hàng" };
  }

  // Số lượng đã nhận (GRN POSTED) theo từng PurchaseItem
  const postedItems = await client.goodsReceiptItem.findMany({
    where: { grn: { purchaseOrderId: poId, status: "POSTED" } },
    select: { purchaseItemId: true, receivedQty: true },
  });
  const receivedByItem = {};
  for (const it of postedItems) {
    receivedByItem[it.purchaseItemId] = (receivedByItem[it.purchaseItemId] || 0) + it.receivedQty;
  }

  for (const item of items) {
    const pi = po.items.find((i) => i.id === item.purchaseItemId);
    if (!pi) throw { status: 400, message: `purchaseItemId ${item.purchaseItemId} không thuộc PO này` };
    const remaining = pi.quantity - (receivedByItem[pi.id] || 0);
    if (item.receivedQty < 1) {
      throw { status: 400, message: `receivedQty phải >= 1 (${pi.id})` };
    }
    if (item.receivedQty > remaining) {
      throw {
        status: 400,
        message: `Nhận vượt số lượng đặt: đặt ${pi.quantity}, còn thiếu ${remaining}`,
      };
    }
  }

  const whId = warehouseId || (await getDefaultWarehouseId(client));
  const code = await withCodeRetry(
    () => generateGrnCode(client),
    (grnCode) =>
      client.goodsReceiptNote.create({
        data: {
          grnCode,
          purchaseOrderId: poId,
          warehouseId: whId,
          status: "DRAFT",
          receivedAt: receivedAt ? new Date(receivedAt) : new Date(),
          createdById: userId,
          items: {
            create: items.map((item) => ({
              productId: item.productId,
              purchaseItemId: item.purchaseItemId,
              receivedQty: item.receivedQty,
              lotCode: item.lotCode || null,
              expiryDate: item.expiryDate ? new Date(item.expiryDate) : null,
            })),
          },
        },
        include: { items: true },
      }),
  );

  auditService.log({
    userId,
    action: "CREATE_GRN",
    entity: "GoodsReceiptNote",
    entityId: code.id,
    before: null,
    after: { grnCode: code.grnCode, purchaseOrderId: poId },
  }).catch(() => {});

  return code;
};

// Ghi nhận QC từng line: passQty + rejectQty <= receivedQty → QC_DONE
// Nhận client (PrismaClient scoped) để đúng multi-tenant isolation.
const recordQc = async (id, qcItems = [], userId, client = prisma) => {
  if (!qcItems.length) throw { status: 400, message: "Cần ít nhất 1 dòng QC" };
  const grn = await client.goodsReceiptNote.findUnique({
    where: { id },
    include: { items: true },
  });
  if (!grn) throw { status: 404, message: "Không tìm thấy GRN" };
  if (!["DRAFT", "QC_PENDING"].includes(grn.status)) {
    throw { status: 400, message: "Chỉ GRN DRAFT/QC_PENDING mới được ghi nhận QC" };
  }

  for (const qc of qcItems) {
    const item = grn.items.find((i) => i.id === qc.itemId);
    if (!item) throw { status: 400, message: `Item ${qc.itemId} không thuộc GRN này` };
    if (qc.passQty < 0 || qc.rejectQty < 0 || qc.passQty + qc.rejectQty > item.receivedQty) {
      throw {
        status: 400,
        message: `passQty + rejectQty phải <= receivedQty (${item.receivedQty})`,
      };
    }
  }

  const updated = await client.$transaction(async (tx) => {
    for (const qc of qcItems) {
      await tx.goodsReceiptItem.update({
        where: { id: qc.itemId },
        data: { passQty: qc.passQty, rejectQty: qc.rejectQty },
      });
    }
    return tx.goodsReceiptNote.update({
      where: { id },
      data: { status: "QC_DONE" },
      include: { items: true },
    });
  });

  auditService.log({
    userId,
    action: "GRN_QC",
    entity: "GoodsReceiptNote",
    entityId: id,
    before: { status: grn.status },
    after: { status: "QC_DONE" },
  }).catch(() => {});

  return updated;
};

/**
 * Tổng giá trị hàng ĐÃ NHẬN (đạt) của PO, tính trên TẤT CẢ GRN đã POSTED.
 *
 * Cần cho công nợ: PO nhập từng phần thì mỗi lần gọi chỉ biết giá trị lần này,
 * còn sổ công nợ phải phản ánh TỔNG đã nhận. Dùng `passQty` (hàng đạt QC) ×
 * `unitCost`, cộng thuế theo tỷ lệ nhận/đặt — cùng công thức với
 * `buildGoodsReceiptEntry` để bút toán và công nợ không lệch nhau.
 *
 * Gọi TRONG transaction sau khi `status = POSTED` đã được ghi, nên GRN vừa post
 * đã nằm trong tập tính.
 */
const totalPostedReceiptValue = async (client, purchaseOrderId) => {
  const posted = await client.goodsReceiptNote.findMany({
    where: { purchaseOrderId, status: "POSTED" },
    select: {
      items: {
        select: {
          passQty: true,
          purchaseItem: { select: { quantity: true, unitCost: true, taxAmount: true } },
        },
      },
    },
  });
  let subtotal = 0;
  let tax = 0;
  for (const g of posted) {
    for (const i of g.items) {
      const qty = Number(i.passQty || 0);
      if (qty <= 0) continue;
      subtotal += qty * Number(i.purchaseItem?.unitCost || 0);
      const ordered = Number(i.purchaseItem?.quantity || 0);
      if (ordered > 0) tax += Number(i.purchaseItem?.taxAmount || 0) * (qty / ordered);
    }
  }
  return round2(subtotal + tax);
};

/**
 * POSTED: nhập kho (bình quân gia quyền + lot), tính onTime vs expectedAt,
 * chuyển PO sang RECEIVED khi tổng nhận đủ, và GHI BÚT TOÁN + CÔNG NỢ.
 *
 * BÚT TOÁN (thêm 2026-10-12): trước đây `post` chỉ cộng tồn kho mà không ghi
 * sổ cái. Đo trên DB phát triển 2026-10-12: **39 PO của tenant demo nhập kho qua
 * GRN mà 0 bút toán** — tồn kho thật có hàng, sổ cái không có tài sản. Đây là
 * lệch dữ liệu, không phải thiếu tính năng. Bút toán ghi SAU transaction (như
 * `purchase.service.receive`) vì `postingErrorService` và `journal.service` dùng
 * `prisma` ngoài transaction; nếu ghi bên trong, lỗi hạch kế toán sẽ rollback
 * cả phần kho đã nhập.
 */
const post = async (id, userId, client = prisma) => {
  const grn = await client.goodsReceiptNote.findUnique({
    where: { id },
    include: {
      items: { include: { product: true, purchaseItem: true } },
      purchaseOrder: { include: { vendor: true, items: true } },
    },
  });
  if (!grn) throw { status: 404, message: "Không tìm thấy GRN" };
  if (grn.status === "POSTED") throw { status: 400, message: "GRN đã POSTED" };
  if (grn.status !== "QC_DONE") {
    throw { status: 400, message: "GRN phải ở trạng thái QC_DONE trước khi POSTED" };
  }

  // Hoản cảnh báo lỗi hạch kế toán ra khỏi transaction: giữ cho phần kho đã nhập
  // không bị rollback, rồi `tryPostOrQueue` ghi hoặc xếp hàng ghi lại.
  let postingPayload = null;

  const updated = await client.$transaction(async (tx) => {
    for (const item of grn.items) {
      if (item.passQty <= 0) continue;
      let inv = await findInventory(tx, item.productId, grn.warehouseId);
      if (!inv) {
        inv = await tx.inventory.create({
          data: { productId: item.productId, warehouseId: grn.warehouseId, quantity: 0, minStock: 10 },
        });
      }
      const oldQty = inv.quantity;
      const oldCost = toNum(item.product.costPrice);
      const addQty = item.passQty;
      const unitCost = toNum(item.purchaseItem.unitCost);
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
          note: `Nhập kho - GRN ${grn.grnCode} (PO ${grn.purchaseOrder.poCode})`,
          unitCost: round2(unitCost),
          createdById: userId,
        },
      });

      // Lot: GRN-<code>-<sku> hoặc lotCode nhập tay từ QC
      const lotCode = item.lotCode || `${grn.grnCode}-${item.product.sku || item.productId.slice(0, 8)}`;
      const existingLot = await tx.inventoryLot.findFirst({
        where: { lotCode, productId: item.productId, warehouseId: grn.warehouseId },
      });
      if (existingLot) {
        // Cùng mã lot nhưng giá nhập mới có thể khác (NCC tăng giá). Ghi đè
        // `unitCost` theo giá vừa nhập để FIFO lấy đúng giá vốn của lô hàng mới,
        // thay vì giữ giá của lần nhập đầu tiên mãi mãi.
        await tx.inventoryLot.update({
          where: { id: existingLot.id },
          data: { quantity: { increment: addQty }, unitCost: round2(unitCost) },
        });
      } else {
        await tx.inventoryLot.create({
          data: {
            lotCode,
            productId: item.productId,
            warehouseId: grn.warehouseId,
            quantity: addQty,
            originalQty: addQty,
            unitCost: round2(unitCost),
            // `GoodsReceiptItem` dùng `expiryDate` nhưng `InventoryLot` dùng
            // `expDate` — gộp nhầm tên làm nhánh "tạo lot mới" luôn ném
            // PrismaClientValidationError, tức GRN chỉ chạy được khi lot đã tồn tại.
            expDate: item.expiryDate || null,
            poId: grn.purchaseOrder.id,
          },
        });
      }
    }

    // onTime so với expectedAt của PO (null nếu PO không đặt ngày giao)
    const onTime = grn.purchaseOrder.expectedAt
      ? new Date(grn.receivedAt) <= new Date(grn.purchaseOrder.expectedAt)
      : null;

    const posted = await tx.goodsReceiptNote.update({
      where: { id },
      data: { status: "POSTED", onTime },
    });

    // Đủ hàng → PO RECEIVED (chỉ từ APPROVED/ORDERED)
    const agg = await tx.goodsReceiptItem.aggregate({
      where: { grn: { purchaseOrderId: grn.purchaseOrderId, status: "POSTED" } },
      _sum: { receivedQty: true },
    });
    const ordered = grn.purchaseOrder.items.reduce((s, i) => s + i.quantity, 0);
    if ((agg._sum?.receivedQty ?? 0) >= ordered && ["APPROVED", "ORDERED"].includes(grn.purchaseOrder.status)) {
      await tx.purchaseOrder.update({
        where: { id: grn.purchaseOrderId },
        data: { status: "RECEIVED", receivedAt: new Date() },
      });
    }

    // ---- ĐÓNG VÒNG MUA HÀNG: công nợ + bút toán ----------------------------
    // Giá trị hàng THỰC NHẬN (chỉ `passQty`) — GRN cho phép nhập từng phần và QC
    // loại hàng, nên không thể dùng tổng PO.
    postingPayload = autopostService.buildGoodsReceiptEntry({
      grn,
      purchaseOrder: grn.purchaseOrder,
      vendor: grn.purchaseOrder.vendor,
      userId,
    });
    if (postingPayload) {
      // Công nợ phải trả theo TỔNG giá trị đã nhận TÍCH LUỮY của PO (mọi GRN
      // POSTED), không phải riêng lần nhận này — `createPayableForPoInTx` tự
      // nới công nợ tới mức đó và idempotent theo `poId`.
      const receivedValue = await totalPostedReceiptValue(tx, grn.purchaseOrderId);
      await debtService.createPayableForPoInTx(tx, {
        po: grn.purchaseOrder,
        userId,
        amount: receivedValue,
      });
    }
    return posted;
  });

  // Ghi bút toán SAU transaction (xem chú thích hàm).
  let postedEntry = null;
  if (postingPayload) {
    // `postGoodsReceipt` nhận `{grn, purchaseOrder, vendor}` rồi TỰ dựng lại
    // payload — ở đây đã dựng xong trong transaction nên gọi thẳng
    // `postBuiltEntry(payload)`. Gọi nhầm `postGoodsReceipt(payload)` khiến nó
    // coi payload là input và đọc `undefined.items` → lỗi bị `tryPostOrQueue`
    // nuốt, kho vẫn tăng nhưng SỔ CÁI KHÔNG CÓ GÌ.
    const { goodsReceiptValue, ...entryPayload } = postingPayload;
    postedEntry = await postingErrorService.tryPostOrQueue(() => autopostService.postBuiltEntry(entryPayload), {
      source: "PURCHASE",
      sourceId: grn.purchaseOrderId,
      operation: `GRN:${id}`,
      payload: entryPayload,
    });
  }

  auditService.log({
    userId,
    action: "GRN_POST",
    entity: "GoodsReceiptNote",
    entityId: id,
    before: { status: "QC_DONE" },
    after: { status: "POSTED" },
  }).catch(() => {});

  // ---- TỔNG KẾT VÒNG ĐÃ ĐÓNG ---------------------------------------------
  // Trả về cho UI để người dùng THẤY được chuỗi hệ quả thay vì chỉ "Đã nhập kho":
  // hàng vào kho bao nhiêu, còn thiếu bao nhiêu, bút toán và công nợ ra sao.
  // Đây cũng là bằng chứng máy đọc được cho "vòng mua hàng đóng kín".
  const [poNow, debtNow, acceptedLines] = await Promise.all([
    client.purchaseOrder.findUnique({
      where: { id: grn.purchaseOrderId },
      select: { id: true, poCode: true, status: true, expectedAt: true },
    }),
    client.debt.findFirst({ where: { poId: grn.purchaseOrderId } }),
    client.goodsReceiptItem.aggregate({
      where: { grn: { purchaseOrderId: grn.purchaseOrderId, status: "POSTED" } },
      _sum: { receivedQty: true, passQty: true },
    }),
  ]);

  const orderedQty = grn.purchaseOrder.items.reduce((s, i) => s + i.quantity, 0);
  const receivedQty = acceptedLines._sum.receivedQty ?? 0;
  const fullyReceived = receivedQty >= orderedQty;

  return {
    ...updated,
    // Số liệu của RIÊNG lần nhập này.
    acceptedQty: grn.items.reduce((s, i) => s + (Number(i.passQty) || 0), 0),
    receivedValue: postingPayload ? postingPayload.goodsReceiptValue : 0,
    // Số liệu TÍCH LUỸ của cả PO.
    purchaseOrder: poNow,
    orderedQty,
    receivedQty,
    fullyReceived,
    remainingQty: Math.max(0, orderedQty - receivedQty),
    onTime: updated.onTime,
    // Bút toán + công nợ: có thể `null` nếu hạch lỗi (đã vào outbox) hoặc không
    // có hàng đạt. Trả null TRUNG THỰC thay vì báo thành công giả.
    journalEntry: postedEntry
      ? { entryCode: postedEntry.entryCode, totalDebit: toNum(postedEntry.totalDebit) }
      : null,
    payable: debtNow
      ? {
          id: debtNow.id,
          amount: toNum(debtNow.amount),
          paidAmount: toNum(debtNow.paidAmount),
          dueDate: debtNow.dueDate,
        }
      : null,
  };
};

// Danh sách GRN (filter poId/status)
const list = async ({ poId, status, page = 1, limit = 20 } = {}, client = prisma) => {
  const where = {};
  if (poId) where.purchaseOrderId = poId;
  if (status) where.status = status;
  const skip = (Number(page) - 1) * Number(limit);
  const [items, total] = await Promise.all([
    client.goodsReceiptNote.findMany({
      where,
      skip,
      take: Number(limit),
      orderBy: { createdAt: "desc" },
      include: {
        items: {
          include: {
            product: { select: { id: true, sku: true, name: true } },
            purchaseItem: { select: { id: true, unitCost: true } },
          },
        },
        purchaseOrder: {
          select: { id: true, poCode: true, expectedAt: true, vendor: { select: { id: true, name: true } } },
        },
        warehouse: { select: { id: true, name: true } },
      },
    }),
    client.goodsReceiptNote.count({ where }),
  ]);
  return {
    grns: items,
    pagination: { page: Number(page), limit: Number(limit), total, totalPages: Math.ceil(total / Number(limit)) },
  };
};

const getById = async (id, client = prisma) => {
  const grn = await client.goodsReceiptNote.findUnique({
    where: { id },
    include: {
      items: { include: { product: { select: { id: true, sku: true, name: true } }, purchaseItem: true } },
      purchaseOrder: {
        select: {
          id: true, poCode: true, expectedAt: true, status: true,
          vendor: { select: { id: true, name: true } },
        },
      },
      warehouse: { select: { id: true, name: true } },
    },
  });
  if (!grn) throw { status: 404, message: "Không tìm thấy GRN" };
  return grn;
};

module.exports = { create, recordQc, post, list, getById };
