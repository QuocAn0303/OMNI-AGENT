/**
 * modules/rfq/rfq.service.js — RFQ và so sánh báo giá nhà cung cấp
 *
 * TƯƠNG ỨNG ODOO: `purchase.order` ở trạng thái `RFQ`/`sent` — người dùng gửi
 * yêu cầu báo giá, nhận giá từ nhiều NCC, so sánh rồi mới chốt. Ở đây gộp nhiều
 * NCC vào MỘT RFQ để so sánh cùng lúc, vì mục tiêu là *chọn được* chứ không
 * phải *gửi được*.
 *
 * VÌ SAO CẦN (đo 2026-10-13):
 * Chuỗi mua hàng cũ là `Vendor → PurchaseOrder` thẳng. `replenishment.suggest`
 * tự chọn NCC từ PO gần nhất, và khi không có PO nào thì trả `needVendor` để
 * người dùng tự nhập. Không có bước hỏi giá, không có bằng chứng vì sao chọn
 * NCC này. Đây cũng là chỗ khác biết rõ với KiotViet/Sapo — họ có bước so
 * sánh báo giá.
 *
 * NGUYÊN TẮC:
 *   - KHÔNG tự gọi NCC (không có API). `draftVendorMessage` trả `requiresHumanSend`
 *     ⇒ người dùng tự gửi. Nói rõ trong kết quả để không ai tưởng đã gửi.
 *   - Chốt NCC KHÔNG tự tạo PO khi PO cần duyệt theo ngưỡng: PO sinh ra đi qua
 *     đúng `purchaseService.create` nên vẫn qua quy tắc duyệt và có thể tạo
 *     human-gate như mọi PO khác. RFQ chỉ là bước chọn NCC, không phải đường vòng
 *     duyệt.
 *   - Mỗi lần chốt đều ghi lại con số so sánh, để sau này giải thích được vì sao
 *     chọn NCC đắt hơn mà vẫn chọn.
 */
const prisma = require("../../config/prisma");
const { withCodeRetry } = require("../accounting/journal.service");
const auditService = require("../audit/audit.service");
const purchaseService = require("../accounting/purchase.service");
const logger = require("../../utils/logger");

const toNum = (v) => Number(v || 0);
const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;

/** Mã RFQ-YYYYMMDD-XXXX, tăng dần trong ngày. */
const generateRfqCode = async (tx) => {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const count = await tx.rfq.count({ where: { rfqCode: { startsWith: `RFQ-${ymd}-` } } });
  return `RFQ-${ymd}-${String(count + 1).padStart(4, "0")}`;
};

const itemSchema = ({ z }) => ({
  productId: z.string().uuid().nullable().optional(),
  description: z.string().min(1).max(500).nullable().optional(),
  quantity: z.number().int().positive(),
  unit: z.string().max(20).nullable().optional(),
});

/**
 * Tạo RFQ kèm danh sách NCC được hỏi.
 *
 * Dòng hàng phải có `productId` HOẶC `description` — không có cả hai thì không
 * biết mua gì, và không nên đoán.
 */
const create = async ({ vendorIds = [], deadlineAt = null, note = null, items = [] }, userId, client = prisma) => {
  if (!items.length) throw { status: 400, message: "RFQ cần ít nhất 1 dòng hàng" };
  for (const it of items) {
    if (!it.productId && !it.description) {
      throw { status: 400, message: "Mỗi dòng cần có mã sản phẩm hoặc mô tả hàng" };
    }
  }
  // Trùng mã NCC trong cùng một lần hỏi sẽ vi phạm `@@unique([rfqId, vendorId])`.
  const uniqueVendors = [...new Set(vendorIds.filter(Boolean))];
  if (!uniqueVendors.length) throw { status: 400, message: "Cần ít nhất 1 nhà cung cấp để hỏi giá" };

  const vendors = await client.vendor.findMany({
    where: { id: { in: uniqueVendors }, isActive: true },
    select: { id: true, name: true },
  });
  if (vendors.length !== uniqueVendors.length) {
    const found = new Set(vendors.map((v) => v.id));
    const missing = uniqueVendors.filter((id) => !found.has(id));
    throw { status: 400, message: `Nhà cung cấp không tồn tại hoặc đã ngừng hoạt động: ${missing.join(", ")}` };
  }

  const grp = await withCodeRetry(
    () => generateRfqCode(client),
    (rfqCode) =>
      client.rfq.create({
        data: {
          rfqCode,
          status: "OPEN",
          deadlineAt: deadlineAt ? new Date(deadlineAt) : null,
          note,
          createdById: userId,
          items: {
            create: items.map((it, i) => ({
              productId: it.productId || null,
              description: it.description || null,
              quantity: it.quantity,
              unit: it.unit || null,
              sortOrder: i,
            })),
          },
          quotes: { create: vendors.map((v) => ({ vendorId: v.id, status: "PENDING" })) },
        },
        include: { items: true, quotes: true },
      }),
  );

  await auditService.log({
    userId,
    action: "CREATE_RFQ",
    entity: "Rfq",
    entityId: grp.id,
    after: { rfqCode: grp.rfqCode, itemCount: grp.items.length, vendorCount: grp.quotes.length },
  });

  // Nói rõ: chưa gửi cho ai cả. Không có API gửi cho NCC trong hệ thống này.
  return { ...grp, requiresHumanSend: true, sentCount: 0 };
};

/**
 * Ghi nhận báo giá của một NCC.
 *
 * `availableQty` cho phép NCC báo không đủ số lượng — hiện thực tế rất hay xảy ra
 * và là lý do nhiều RFQ bị "chết". Không ép bằng số lượng yêu cầu vì sẽ thu được
 * thông tin sai.
 */
const recordQuote = async (rfqId, vendorId, { lines = [], promisedAt = null, note = null } = {}, userId, client = prisma) => {
  const rfq = await client.rfq.findUnique({
    where: { id: rfqId },
    include: { items: true },
  });
  if (!rfq) throw { status: 404, message: "Không tìm thấy RFQ" };
  if (rfq.status !== "OPEN") {
    throw { status: 400, message: `RFQ đang ở trạng thái ${rfq.status} — không nhận báo giá mới` };
  }
  const quote = await client.rfqQuote.findUnique({ where: { rfqId_vendorId: { rfqId, vendorId } } });
  if (!quote) throw { status: 400, message: "Nhà cung cấp này không nằm trong danh sách hỏi của RFQ" };
  if (!lines.length) throw { status: 400, message: "Báo giá cần ít nhất 1 dòng giá" };

  const itemIds = new Set(rfq.items.map((i) => i.id));
  for (const l of lines) {
    if (!itemIds.has(l.rfqItemId)) {
      throw { status: 400, message: `Dòng hàng ${l.rfqItemId} không thuộc RFQ này` };
    }
    if (!(toNum(l.unitCost) > 0)) {
      throw { status: 400, message: "Đơn giá phải lớn hơn 0" };
    }
  }

  const updated = await client.$transaction(async (tx) => {
    for (const l of lines) {
      // Ghi đè giá của lần trước của cùng dòng — NCC sửa báo giá là chuyện thường.
      await tx.rfqQuoteLine.upsert({
        where: { quoteId_rfqItemId: { quoteId: quote.id, rfqItemId: l.rfqItemId } },
        create: {
          quoteId: quote.id, rfqItemId: l.rfqItemId,
          unitCost: round2(l.unitCost),
          availableQty: l.availableQty ?? null,
        },
        update: { unitCost: round2(l.unitCost), availableQty: l.availableQty ?? null },
      });
    }
    return tx.rfqQuote.update({
      where: { id: quote.id },
      data: { status: "QUOTED", promisedAt: promisedAt ? new Date(promisedAt) : null, note },
      include: { lines: true },
    });
  });

  await auditService.log({
    userId,
    action: "RECORD_RFQ_QUOTE",
    entity: "RfqQuote",
    entityId: updated.id,
    after: { rfqId, vendorId, lineCount: lines.length, promisedAt },
  });

  return updated;
};

/** NCC từ chối báo giá — phải có lý do để sau giải thích được. */
const declineQuote = async (rfqId, vendorId, declineReason, userId, client = prisma) => {
  if (!declineReason || !String(declineReason).trim()) {
    throw { status: 400, message: "Cần ghi lý do từ chối để đối chiếu sau" };
  }
  const quote = await client.rfqQuote.findUnique({ where: { rfqId_vendorId: { rfqId, vendorId } } });
  if (!quote) throw { status: 400, message: "Nhà cung cấp này không nằm trong danh sách hỏi của RFQ" };
  const updated = await client.rfqQuote.update({
    where: { id: quote.id },
    data: { status: "DECLINED", declineReason },
  });
  await auditService.log({
    userId, action: "DECLINE_RFQ_QUOTE", entity: "RfqQuote", entityId: updated.id,
    after: { rfqId, vendorId, declineReason },
  });
  return updated;
};

/**
 * Bảng so sánh các báo giá.
 *
 * CHỈ tính trên báo giá đã trả đủ giá cho MỌI dòng hàng — báo giá thiếu dòng thì
 * tổng tiền không so sánh được, nếu cứ tính sẽ ra con số đẹp bằng 0 cho dòng
 * thiếu và khiến NCC rẻ hơn trông hấp dẫn giả. Báo giá thiếu được đánh dấu
 * `incomplete` để người dùng tự thấy.
 */
const comparison = async (rfqId, client = prisma) => {
  const rfq = await client.rfq.findUnique({
    where: { id: rfqId },
    include: {
      items: { orderBy: { sortOrder: "asc" } },
      quotes: { include: { vendor: { select: { id: true, code: true, name: true, otifScore: true, vendorGrade: true } }, lines: true } },
    },
  });
  if (!rfq) throw { status: 404, message: "Không tìm thấy RFQ" };

  const lineByItem = new Map();
  for (const q of rfq.quotes) {
    for (const l of q.lines) lineByItem.set(`${q.id}|${l.rfqItemId}`, l);
  }

  const rows = rfq.quotes.map((q) => {
    const priced = q.lines.filter((l) => toNum(l.unitCost) > 0);
    const incomplete = priced.length !== rfq.items.length;

    let total = 0;
    let perLine = [];
    if (!incomplete) {
      perLine = rfq.items.map((it) => {
        const l = q.lines.find((x) => x.rfqItemId === it.id);
        const sub = toNum(l.unitCost) * it.quantity;
        total += sub;
        return {
          rfqItemId: it.id,
          productId: it.productId,
          description: it.description,
          quantity: it.quantity,
          unitCost: round2(toNum(l.unitCost)),
          lineTotal: round2(sub),
          availableQty: l.availableQty,
          short: l.availableQty != null && Number(l.availableQty) < it.quantity,
        };
      });
    }

    return {
      quoteId: q.id,
      vendorId: q.vendorId,
      vendorName: q.vendor.name,
      vendorCode: q.vendor.code,
      vendorGrade: q.vendorGrade ?? q.vendor.vendorGrade,
      otifScore: q.otifScore ?? q.vendor.otifScore,
      status: q.status,
      promisedAt: q.promisedAt,
      note: q.note,
      declineReason: q.declineReason,
      // Đủ giá cho mọi dòng? Không thì KHÔNG so sánh được.
      incomplete,
      pricedLineCount: priced.length,
      totalLineCount: rfq.items.length,
      total: incomplete ? null : round2(total),
      lines: perLine,
    };
  });

  // Chỉ những báo giá ĐỦ và không từ chối mới được xếp hạng.
  const comparable = rows
    .filter((r) => !r.incomplete && r.status !== "DECLINED")
    .sort((a, b) => a.total - b.total);

  comparable.forEach((r, i) => {
    r.rank = i + 1;
    r.savingVsCheapest = i === 0 ? 0 : round2(r.total - comparable[0].total);
    r.savingVsCheapestPct = i === 0 ? 0 : round2(((r.total - comparable[0].total) / comparable[0].total) * 100);
  });

  return {
    rfq: {
      id: rfq.id, rfqCode: rfq.rfqCode, status: rfq.status,
      deadlineAt: rfq.deadlineAt, note: rfq.note,
      awardedVendorId: rfq.awardedVendorId, awardedAt: rfq.awardedAt,
      purchaseOrderId: rfq.purchaseOrderId,
    },
    items: rfq.items,
    quotes: rows,
    // Mang theo mức chênh lệch để UI không phải tự tính lại (và để khỏi mất số
// như đã xảy ra: ban đầu chỉ trả rank/total, mất `savingVsCheapestPct`).
    ranking: comparable.map((r) => ({
      quoteId: r.quoteId,
      vendorId: r.vendorId,
      vendorName: r.vendorName,
      rank: r.rank,
      total: r.total,
      savingVsCheapest: r.savingVsCheapest,
      savingVsCheapestPct: r.savingVsCheapestPct,
      otifScore: r.otifScore,
    })),
    cheapestQuoteId: comparable[0]?.quoteId || null,
    // Rẻ nhất KHÔNG phải lúc nào cũng nên chọn — nói thẳng ra để không bị dùng
    // máy trắng trợn khi giá rẻ nhưng NCC từ chối hoặc thiếu hàng.
    caveat: comparable.length === 0
      ? "Chưa có báo giá nào đủ giá cho mọi dòng hàng — chưa so sánh được."
      : "Giá rẻ nhất KHÔNG đồng nghĩa phù hợp nhất: còn phải xem NCC có giao đúng hạn không.",
  };
};

/**
 * Chốt một NCC và tạo PO.
 *
 * Đi qua `purchaseService.create` (KHÔNG gọi `prisma.purchaseOrder.create` trực
 * tiếp) để PO mới có đúng hành vi của PO ngoài RFQ: ngưỡng duyệt theo
 * `companySettings`, workflow PO_ABOVE, audit log.
 */
const award = async (rfqId, vendorId, userId, { note = null } = {}) => {
  const rfq = await prisma.rfq.findUnique({
    where: { id: rfqId },
    include: { items: true, quotes: true },
  });
  if (!rfq) throw { status: 404, message: "Không tìm thấy RFQ" };
  if (rfq.status === "AWARDED") {
    throw { status: 400, message: `RFQ đã chốt cho nhà cung cấp khác — không chốt lại được` };
  }
  if (rfq.status === "CANCELLED") throw { status: 400, message: "RFQ đã huỷ" };

  const quote = rfq.quotes.find((q) => q.vendorId === vendorId);
  if (!quote) throw { status: 400, message: "Nhà cung cấp này không nằm trong danh sách hỏi của RFQ" };

  const lines = await prisma.rfqQuoteLine.findMany({ where: { quoteId: quote.id } });
  if (lines.length !== rfq.items.length) {
    throw {
      status: 400,
      message: `Báo giá chỉ có ${lines.length}/${rfq.items.length} dòng — không thể tạo PO từ báo giá thiếu dòng`,
    };
  }

  // Số lượng đặt = số NCC thực sự có hàng. Nếu NCC báo thiếu thì chỉ đặt phần có,
  // KHÔNG tự đặt đủ rồi ghi sổ — đặt phần vượt khả năng giao là tạo nợ mà không
  // có hàng. Phần thiếu ghi rõ ra để người dùng biết RFQ chưa đáp ứng nhu cầu.
  const items = rfq.items.map((it) => {
    const l = lines.find((x) => x.rfqItemId === it.id);
    const qty = l.availableQty != null ? Math.min(it.quantity, Number(l.availableQty)) : it.quantity;
    return {
      productId: it.productId,
      quantity: qty,
      unitCost: toNum(l.unitCost),
    };
  });
  if (items.some((i) => !i.productId)) {
    throw {
      status: 400,
      message: "RFQ có dòng hàng chưa gắn mã sản phẩm — phải tạo mã sản phẩm trước khi chốt PO",
    };
  }

  const po = await purchaseService.create({ vendorId, note: note || `Từ RFQ ${rfq.rfqCode}`, items }, userId);

  await prisma.$transaction([
    prisma.rfqQuote.updateMany({
      where: { rfqId },
      data: { status: "PENDING" },
    }),
    prisma.rfqQuote.update({ where: { id: quote.id }, data: { status: "SELECTED" } }),
    prisma.rfq.update({
      where: { id: rfqId },
      data: {
        status: "AWARDED",
        awardedVendorId: vendorId,
        awardedAt: new Date(),
        awardedById: userId,
        purchaseOrderId: po.id,
      },
    }),
  ]);

  await auditService.log({
    userId,
    action: "AWARD_RFQ",
    entity: "Rfq",
    entityId: rfqId,
    after: {
      rfqCode: rfq.rfqCode,
      vendorId,
      poCode: po.poCode,
      poId: po.id,
      poStatus: po.status,
      poTotal: toNum(po.total),
    },
  });

  return { rfqId, rfqCode: rfq.rfqCode, purchaseOrder: po };
};

const cancel = async (rfqId, userId, reason = null) => {
  const rfq = await prisma.rfq.findUnique({ where: { id: rfqId }, select: { id: true, status: true, rfqCode: true } });
  if (!rfq) throw { status: 404, message: "Không tìm thấy RFQ" };
  if (rfq.status === "AWARDED") {
    throw { status: 400, message: "RFQ đã chốt thành PO — hủy PO trước, không hủy RFQ" };
  }
  const updated = await prisma.rfq.update({ where: { id: rfqId }, data: { status: "CANCELLED" } });
  await auditService.log({
    userId, action: "CANCEL_RFQ", entity: "Rfq", entityId: rfqId,
    after: { rfqCode: rfq.rfqCode, reason },
  });
  return updated;
};

const list = async ({ status, page = 1, limit = 20 } = {}, client = prisma) => {
  const where = {};
  if (status) where.status = status;
  const skip = (Number(page) - 1) * Number(limit);
  const [items, total] = await Promise.all([
    client.rfq.findMany({
      where, skip, take: Number(limit), orderBy: { createdAt: "desc" },
      include: {
        items: { select: { id: true, quantity: true, productId: true, description: true } },
        quotes: { include: { vendor: { select: { id: true, name: true } } } },
        createdBy: { select: { id: true, fullName: true, email: true } },
      },
    }),
    client.rfq.count({ where }),
  ]);
  return {
    rfqs: items,
    pagination: { page: Number(page), limit: Number(limit), total, totalPages: Math.ceil(total / Number(limit)) },
  };
};

const getById = async (rfqId, client = prisma) => {
  const rfq = await client.rfq.findUnique({
    where: { id: rfqId },
    include: {
      items: { orderBy: { sortOrder: "asc" }, include: { product: { select: { sku: true, name: true, unit: true } } } },
      quotes: { include: { vendor: true, lines: true } },
      awardedBy: { select: { id: true, fullName: true, email: true } },
      createdBy: { select: { id: true, fullName: true, email: true } },
    },
  });
  if (!rfq) throw { status: 404, message: "Không tìm thấy RFQ" };
  return rfq;
};

module.exports = { create, recordQuote, declineQuote, comparison, award, cancel, list, getById, itemSchema };