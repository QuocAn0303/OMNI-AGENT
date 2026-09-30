/**
 * modules/crm/deals.service.js — Nghiệp vụ Deal của CRM Sales Pipeline
 *
 * Tổng quan:
 * - `CrmDeal` là cơ hội bán hàng (doctype "CRM Deal" của Frappe CRM), nằm sau
 *   bước "convert lead". Deal có thể tồn tại mà chưa có `customerId` — chỉ khi
 *   deal THẮNG (stage kind=WON) mới sinh `Customer`/đơn hàng.
 * - `kind` (ONGOING/WON/LOST) là bản denormalize từ `CrmPipelineStage.kind` để
 *   query pipeline/forecast không cần join stage.
 * - `probability` là snapshot của `CrmPipelineStage.probability` tại thời điểm
 *   deal vào stage — dùng cho weighted forecast (Σ value × probability/100).
 * - `orderId` có `@unique` ở DB: 1 deal chỉ sinh tối đa 1 đơn hàng.
 * - `CrmDealItem` là dòng sản phẩm của deal; khi convert sang đơn hàng chính là
 *   danh sách item của đơn.
 *
 * Hàm:
 * - list(query, user): danh sách deal phân trang + filter (record-level theo owner)
 * - getById(id, user): chi tiết + items + lead/organization/contact/order
 * - create(data, userId, user), update(id, data, userId, user), remove(id, userId, user)
 * - changeStage(id, data, userId, user): đổi stage (kanban drag-drop), cập nhật kind/closedAt
 * - upsertItems(dealId, items, userId, user): thay toàn bộ dòng sản phẩm + tính lại value
 * - getBoard(user, opts): dữ liệu kanban (cột theo stage, count + tổng value)
 * - getForecast(user, opts): weighted forecast + win rate + TB deal + won/lost theo tháng
 * - convertToOrder(id, payload, userId, user): deal thắng → Order (delegate orderService)
 */
const prisma = require("../../config/prisma");
const auditService = require("../audit/audit.service");
const notif = require("../notifications/notification.service");
const logger = require("../../utils/logger");
const ApiError = require("../../utils/apiError");
const stagesService = require("./stages.service");
const communicationService = require("./communication.service");
const { ownerScope, assertAccess, isManager } = require("./scope");

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

const DEAL_SELECT = {
  id: true,
  dealName: true,
  organizationId: true,
  contactId: true,
  leadId: true,
  customerId: true,
  stageId: true,
  kind: true,
  value: true,
  currency: true,
  probability: true,
  expectedCloseDate: true,
  nextStep: true,
  dealOwnerId: true,
  closedAt: true,
  lostReason: true,
  orderId: true,
  createdAt: true,
  updatedAt: true,
  stage: { select: { id: true, label: true, color: true, sortOrder: true, kind: true, probability: true } },
  dealOwner: { select: { id: true, fullName: true, role: true } },
  organization: { select: { id: true, name: true } },
  contact: { select: { id: true, fullName: true, email: true, phone: true } },
  lead: { select: { id: true, leadName: true, status: true } },
  customer: { select: { id: true, name: true, phone: true } },
  order: { select: { id: true, orderCode: true, status: true, total: true } },
};

const ITEM_SELECT = {
  id: true,
  productId: true,
  description: true,
  quantity: true,
  unitPrice: true,
  discount: true,
  amount: true,
  product: { select: { id: true, name: true, sku: true, price: true, unit: true, isActive: true } },
};

const toDate = (v) => {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

const list = async (query = {}, user) => {
  const p = Math.max(1, Number(query.page) || 1);
  const l = Math.max(1, Math.min(200, Number(query.limit) || 20));

  const where = { ...ownerScope(user, "dealOwnerId") };
  if (query.kind) where.kind = query.kind;
  if (query.stageId) where.stageId = query.stageId;
  // QUAN TRỌNG: chỉ role quản lý mới được lọc theo owner khác. Gán SAU ownerScope
  // để không bao giờ ghi đè ràng buộc "CASHIER chỉ thấy deal của mình".
  if (query.dealOwnerId && isManager(user)) where.dealOwnerId = query.dealOwnerId;
  if (query.organizationId) where.organizationId = query.organizationId;
  if (query.contactId) where.contactId = query.contactId;
  if (query.leadId) where.leadId = query.leadId;
  if (query.customerId) where.customerId = query.customerId;
  if (query.converted === "1" || query.converted === true) where.orderId = { not: null };
  if (query.fromDate || query.toDate) {
    where.createdAt = {
      ...(query.fromDate ? { gte: new Date(query.fromDate) } : {}),
      ...(query.toDate ? { lte: new Date(query.toDate) } : {}),
    };
  }
  if (query.search) {
    where.OR = [
      { dealName: { contains: query.search, mode: "insensitive" } },
      { nextStep: { contains: query.search, mode: "insensitive" } },
      { lostReason: { contains: query.search, mode: "insensitive" } },
      { organization: { name: { contains: query.search, mode: "insensitive" } } },
      { contact: { fullName: { contains: query.search, mode: "insensitive" } } },
    ];
  }

  const [rows, total] = await Promise.all([
    prisma.crmDeal.findMany({
      where,
      select: DEAL_SELECT,
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      skip: (p - 1) * l,
      take: l,
    }),
    prisma.crmDeal.count({ where }),
  ]);

  return { deals: rows, pagination: { page: p, limit: l, total, totalPages: Math.ceil(total / l) } };
};

const getById = async (id, user) => {
  const deal = await prisma.crmDeal.findUnique({
    where: { id },
    select: { ...DEAL_SELECT, items: { select: ITEM_SELECT, orderBy: { createdAt: "asc" } } },
  });
  assertAccess(user, deal, "dealOwnerId", "Deal");
  return deal;
};

/** Stage phải thuộc entityType DEAL */
const assertDealStage = async (stageId) => {
  if (!stageId) return null;
  const stage = await prisma.crmPipelineStage.findUnique({
    where: { id: stageId },
    select: { id: true, entityType: true, label: true, kind: true, probability: true, isActive: true },
  });
  if (!stage) throw new ApiError(404, "Giai đoạn không tồn tại");
  if (stage.entityType !== "DEAL") throw new ApiError(400, "Giai đoạn này thuộc kanban Lead, không dùng cho Deal");
  return stage;
};

/** Tính amount của 1 dòng: quantity × unitPrice − discount (discount là số tiền) */
const calcItemAmount = (item) => {
  const gross = round2((Number(item.quantity) || 0) * (Number(item.unitPrice) || 0));
  const discount = Math.min(gross, Number(item.discount) || 0);
  return round2(gross - discount);
};

/** Chuẩn hoá + validate items, trả về rows đã có amount tính sẵn */
const normalizeItems = async (items) => {
  if (!Array.isArray(items) || items.length === 0) return [];
  const productIds = items.map((i) => i.productId).filter(Boolean);
  const products = productIds.length
    ? await prisma.product.findMany({
        where: { id: { in: [...new Set(productIds)] } },
        select: { id: true, name: true, isActive: true },
      })
    : [];
  const map = new Map(products.map((p) => [p.id, p]));

  for (const it of items) {
    if (it.productId) {
      const p = map.get(it.productId);
      if (!p) throw new ApiError(400, `Sản phẩm ${it.productId} không tồn tại`);
      if (p.isActive === false) throw new ApiError(400, `Sản phẩm "${p.name}" đã ngừng kinh doanh`);
    } else if (!it.description) {
      throw new ApiError(400, "Dòng deal cần có productId hoặc description");
    }
  }

  return items.map((it) => {
    const quantity = Number(it.quantity) || 0;
    const unitPrice = Number(it.unitPrice) || 0;
    const discount = Number(it.discount) || 0;
    return {
      productId: it.productId ?? null,
      description: it.description ?? null,
      quantity,
      unitPrice,
      discount,
      amount: calcItemAmount({ quantity, unitPrice, discount }),
    };
  });
};

const create = async (data, userId, user) => {
  const stage = await assertDealStage(data.stageId);
  const items = await normalizeItems(data.items);
  const ownerId = data.dealOwnerId ?? (!isManager(user) && user ? user.id : null);
  const kind = stage?.kind === "WON" || stage?.kind === "LOST" ? stage.kind : "ONGOING";

  const value = data.value ?? round2(items.reduce((s, i) => s + i.amount, 0));

  const deal = await prisma.crmDeal.create({
    data: {
      dealName: data.dealName.trim(),
      organizationId: data.organizationId ?? null,
      contactId: data.contactId ?? null,
      leadId: data.leadId ?? null,
      stageId: stage?.id ?? null,
      kind,
      value,
      currency: data.currency || "VND",
      probability: data.probability ?? stage?.probability ?? 0,
      expectedCloseDate: toDate(data.expectedCloseDate) ?? null,
      nextStep: data.nextStep ?? null,
      dealOwnerId: ownerId,
      lostReason: data.lostReason ?? null,
      closedAt: kind === "WON" || kind === "LOST" ? new Date() : null,
      ...(items.length ? { items: { create: items } } : {}),
    },
    select: { ...DEAL_SELECT, items: { select: ITEM_SELECT, orderBy: { createdAt: "asc" } } },
  });

  auditService.log({
    userId,
    action: "CREATE_CRM_DEAL",
    entity: "CrmDeal",
    entityId: deal.id,
    after: { dealName: deal.dealName, value: deal.value, kind: deal.kind, stageId: deal.stageId, dealOwnerId: deal.dealOwnerId },
  });

  await communicationService.logSystemEvent({
    dealId: deal.id,
    leadId: deal.leadId,
    contactId: deal.contactId,
    content: `Tạo deal "${deal.dealName}"${stage ? ` tại giai đoạn ${stage.label}` : ""}`,
    createdById: userId,
  });

  if (ownerId && ownerId !== userId) {
    await notif
      .createOne({
        type: "SYSTEM",
        severity: "INFO",
        title: "Deal mới được giao cho bạn",
        message: deal.dealName,
        link: `/crm/deals/${deal.id}`,
        userId: ownerId,
        meta: { dealId: deal.id },
      })
      .catch(() => null);
  }

  return deal;
};

const update = async (id, data, userId, user) => {
  const before = await prisma.crmDeal.findUnique({ where: { id }, select: DEAL_SELECT });
  assertAccess(user, before, "dealOwnerId", "Deal");
  if (before.orderId && data.customerId === undefined) {
    // Deal đã sinh đơn → vẫn cho sửa mô tả, nhưng cảnh báo qua audit
    logger.warn(`[crm] update deal đã có order: dealId=${id}, orderId=${before.orderId}`);
  }
  const stage = data.stageId !== undefined ? await assertDealStage(data.stageId) : null;

  const patch = {};
  if (data.dealName !== undefined) patch.dealName = String(data.dealName).trim();
  if (data.organizationId !== undefined) patch.organizationId = data.organizationId;
  if (data.contactId !== undefined) patch.contactId = data.contactId;
  if (data.customerId !== undefined) patch.customerId = data.customerId;
  if (data.value !== undefined) patch.value = data.value;
  if (data.currency !== undefined) patch.currency = data.currency;
  if (data.probability !== undefined) patch.probability = data.probability;
  if (data.expectedCloseDate !== undefined) patch.expectedCloseDate = toDate(data.expectedCloseDate);
  if (data.nextStep !== undefined) patch.nextStep = data.nextStep;
  if (data.dealOwnerId !== undefined) patch.dealOwnerId = data.dealOwnerId;
  if (data.lostReason !== undefined) patch.lostReason = data.lostReason;
  if (data.stageId !== undefined) {
    patch.stageId = data.stageId;
    if (stage) {
      patch.kind = stage.kind;
      if (data.probability === undefined) patch.probability = stage.probability;
      patch.closedAt = stage.kind === "WON" || stage.kind === "LOST" ? before.closedAt ?? new Date() : null;
    } else {
      patch.kind = "ONGOING";
      patch.closedAt = null;
    }
  }

  const deal = await prisma.crmDeal.update({ where: { id }, data: patch, select: DEAL_SELECT });

  auditService.log({
    userId,
    action: "UPDATE_CRM_DEAL",
    entity: "CrmDeal",
    entityId: id,
    before: { dealName: before.dealName, value: before.value, kind: before.kind, stageId: before.stageId, dealOwnerId: before.dealOwnerId },
    after: { dealName: deal.dealName, value: deal.value, kind: deal.kind, stageId: deal.stageId, dealOwnerId: deal.dealOwnerId },
  });

  if (patch.dealOwnerId && patch.dealOwnerId !== before.dealOwnerId) {
    await communicationService.logSystemEvent({
      dealId: id,
      content: `Chuyển người phụ trách: ${before.dealOwner?.fullName || "—"} → ${deal.dealOwner?.fullName || "—"}`,
      createdById: userId,
    });
    if (patch.dealOwnerId !== userId) {
      await notif
        .createOne({
          type: "SYSTEM",
          severity: "INFO",
          title: "Deal được chuyển cho bạn",
          message: deal.dealName,
          link: `/crm/deals/${id}`,
          userId: patch.dealOwnerId,
          meta: { dealId: id },
        })
        .catch(() => null);
    }
  }

  return deal;
};

/** Xóa deal — chặn nếu đã sinh đơn hàng (orderId unique → giữ dấu vết doanh thu) */
const remove = async (id, userId, user) => {
  const deal = await prisma.crmDeal.findUnique({
    where: { id },
    select: { id: true, dealName: true, orderId: true, dealOwnerId: true, kind: true },
  });
  assertAccess(user, deal, "dealOwnerId", "Deal");
  if (deal.orderId) {
    throw new ApiError(409, "Deal đã tạo đơn hàng — không xóa được để giữ dấu vết doanh thu");
  }

  // items có onDelete: Cascade; communication thì xóa tay (không có FK cascade)
  await prisma.$transaction([
    prisma.crmCommunication.deleteMany({ where: { dealId: id } }),
    prisma.crmDeal.delete({ where: { id } }),
  ]);

  auditService.log({
    userId,
    action: "DELETE_CRM_DEAL",
    entity: "CrmDeal",
    entityId: id,
    before: { dealName: deal.dealName, kind: deal.kind },
  });
  return { id };
};

/**
 * Đổi stage deal — endpoint cho drag-drop kanban.
 * Đồng bộ `kind`/`probability`/`closedAt` theo stage mới; deal thắng cần `lostReason`
 * khi chuyển vào stage LOST để phục vụ phân tích lý do thua.
 */
const changeStage = async (id, data, userId, user) => {
  const before = await prisma.crmDeal.findUnique({ where: { id }, select: DEAL_SELECT });
  assertAccess(user, before, "dealOwnerId", "Deal");
  if (before.orderId) {
    throw new ApiError(409, "Deal đã tạo đơn hàng — không đổi giai đoạn được");
  }

  const stage = await assertDealStage(data.stageId);
  const patch = { stageId: data.stageId ?? null };
  if (stage) {
    patch.kind = stage.kind;
    patch.probability = stage.probability;
    patch.closedAt = stage.kind === "WON" || stage.kind === "LOST" ? before.closedAt ?? new Date() : null;
  } else {
    patch.kind = "ONGOING";
    patch.probability = 0;
    patch.closedAt = null;
  }
  if (data.lostReason !== undefined) patch.lostReason = data.lostReason;
  if (patch.kind === "LOST" && !patch.lostReason && !before.lostReason) {
    throw new ApiError(400, "Cần nhập lý do thua khi chuyển deal sang giai đoạn Thua");
  }

  const deal = await prisma.crmDeal.update({ where: { id }, data: patch, select: DEAL_SELECT });

  auditService.log({
    userId,
    action: "CHANGE_CRM_DEAL_STAGE",
    entity: "CrmDeal",
    entityId: id,
    before: { stageId: before.stageId, kind: before.kind, probability: before.probability, lostReason: before.lostReason },
    after: { stageId: deal.stageId, kind: deal.kind, probability: deal.probability, lostReason: deal.lostReason },
  });

  await communicationService.logSystemEvent({
    dealId: id,
    content: `Chuyển giai đoạn: ${before.stage?.label || "—"} → ${deal.stage?.label || "—"}`,
    createdById: userId,
  });

  if (stage?.kind === "WON") {
    await notificationWon(deal, before, userId);
  }

  return deal;
};

/** Thông báo cho người phụ trách khi deal vừa thắng (best-effort) */
const notificationWon = async (deal, before, userId) => {
  try {
    await notif.createOne({
      type: "SYSTEM",
      severity: "INFO",
      title: "Deal thắng 🎉",
      message: `${deal.dealName} — giá trị ${deal.value}`,
      link: `/crm/deals/${deal.id}`,
      userId: deal.dealOwnerId || userId,
      meta: { dealId: deal.id, previousStageId: before.stageId },
    });
  } catch (e) {
    logger.error("[crm] notify deal WON failed:", e.message);
  }
};

/**
 * Thay toàn bộ danh sách dòng sản phẩm của deal (PUT semantics) + tính lại `value`
 * khi deal chưa từng được sửa tay (value = 0) — tránh ghi đè giá trị deal tự nhập.
 */
const upsertItems = async (id, items, userId, user) => {
  const deal = await prisma.crmDeal.findUnique({
    where: { id },
    select: { id: true, dealName: true, value: true, kind: true, dealOwnerId: true, orderId: true },
  });
  assertAccess(user, deal, "dealOwnerId", "Deal");
  if (deal.orderId) throw new ApiError(409, "Deal đã tạo đơn hàng — không sửa được danh sách sản phẩm");

  const rows = await normalizeItems(items);
  const itemsTotal = round2(rows.reduce((s, i) => s + i.amount, 0));

  const updated = await prisma.$transaction(async (tx) => {
    await tx.crmDealItem.deleteMany({ where: { dealId: id } });
    if (rows.length) await tx.crmDealItem.createMany({ data: rows.map((r) => ({ ...r, dealId: id })) });
    // value = 0 nghĩa là deal chưa được gán giá thủ công → lấy theo tổng dòng
    const shouldRecompute = Number(deal.value) === 0 && itemsTotal > 0;
    return tx.crmDeal.update({
      where: { id },
      data: shouldRecompute ? { value: itemsTotal } : {},
      select: { ...DEAL_SELECT, items: { select: ITEM_SELECT, orderBy: { createdAt: "asc" } } },
    });
  });

  auditService.log({
    userId,
    action: "UPDATE_CRM_DEAL_ITEMS",
    entity: "CrmDeal",
    entityId: id,
    before: { itemCount: null, value: deal.value },
    after: { itemCount: rows.length, itemsTotal, value: updated.value },
  });

  return updated;
};

/**
 * Dữ liệu kanban: mỗi stage 1 cột, kèm count + tổng value + deal đã convert.
 * Deal chưa gán stage gom vào cột cuối `stageId: null` để không bị "biến mất".
 */
const getBoard = async (user, { includeClosed = false } = {}) => {
  await stagesService.ensureDefaultStages();
  const stages = await stagesService.list("DEAL", { includeInactive: false });

  const where = { ...ownerScope(user, "dealOwnerId") };
  if (!includeClosed) where.kind = "ONGOING";

  const [deals, unassigned] = await Promise.all([
    prisma.crmDeal.findMany({
      where: { ...where, stageId: { in: stages.map((s) => s.id) } },
      select: DEAL_SELECT,
      orderBy: [{ value: "desc" }, { updatedAt: "desc" }],
      take: 500,
    }),
    prisma.crmDeal.findMany({
      where: { ...where, stageId: null },
      select: DEAL_SELECT,
      orderBy: [{ value: "desc" }, { updatedAt: "desc" }],
      take: 200,
    }),
  ]);

  const columns = stages.map((stage) => {
    const cards = deals.filter((d) => d.stageId === stage.id);
    return {
      stage: { id: stage.id, label: stage.label, color: stage.color, kind: stage.kind, probability: stage.probability },
      count: cards.length,
      totalValue: round2(cards.reduce((s, d) => s + Number(d.value || 0), 0)),
      weightedValue: round2(
        cards.reduce((s, d) => s + (Number(d.value || 0) * Number(d.probability || 0)) / 100, 0),
      ),
      deals: cards,
    };
  });

  if (unassigned.length) {
    columns.push({
      stage: { id: null, label: "Chưa phân giai đoạn", color: "#64748b", kind: "ONGOING", probability: 0 },
      count: unassigned.length,
      totalValue: round2(unassigned.reduce((s, d) => s + Number(d.value || 0), 0)),
      weightedValue: 0,
      deals: unassigned,
    });
  }

  return {
    columns,
    summary: {
      totalDeals: columns.reduce((s, c) => s + c.count, 0),
      totalValue: round2(columns.reduce((s, c) => s + c.totalValue, 0)),
      weightedValue: round2(columns.reduce((s, c) => s + c.weightedValue, 0)),
    },
  };
};

/**
 * Weighted forecast + thống kê thắng/thua.
 * weightedValue = Σ(value × probability/100) trên các deal ONGOING — con số
 * "kỳ vọng doanh thu" mà quản lý dùng để lên kế hoạch.
 */
const getForecast = async (user, { months = 6 } = {}) => {
  const m = Math.max(1, Math.min(24, Number(months) || 6));
  const from = new Date();
  from.setDate(1);
  from.setHours(0, 0, 0, 0);
  from.setMonth(from.getMonth() - (m - 1));

  const where = { ...ownerScope(user, "dealOwnerId") };

  const [ongoing, closed] = await Promise.all([
    prisma.crmDeal.findMany({
      where: { ...where, kind: "ONGOING" },
      select: { id: true, value: true, probability: true, expectedCloseDate: true, stage: { select: { id: true, label: true, color: true, probability: true } } },
    }),
    prisma.crmDeal.findMany({
      where: { ...where, kind: { in: ["WON", "LOST"] }, closedAt: { gte: from } },
      select: { id: true, value: true, kind: true, closedAt: true, lostReason: true },
    }),
  ]);

  const byStage = new Map();
  for (const d of ongoing) {
    const key = d.stage?.id || "none";
    const cur = byStage.get(key) || {
      stageId: d.stage?.id || null,
      label: d.stage?.label || "Chưa phân giai đoạn",
      color: d.stage?.color || "#64748b",
      count: 0,
      value: 0,
      weightedValue: 0,
    };
    cur.count += 1;
    cur.value += Number(d.value || 0);
    cur.weightedValue += (Number(d.value || 0) * Number(d.probability || 0)) / 100;
    byStage.set(key, cur);
  }

  // Nhóm theo tháng kết thúc (closedAt) — cho biểu đồ cột won/lost
  const byMonth = new Map();
  const monthKey = (d) => {
    const dt = new Date(d.closedAt);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
  };
  for (const d of closed) {
    const k = monthKey(d);
    const cur = byMonth.get(k) || { month: k, wonCount: 0, wonValue: 0, lostCount: 0, lostValue: 0 };
    if (d.kind === "WON") {
      cur.wonCount += 1;
      cur.wonValue += Number(d.value || 0);
    } else {
      cur.lostCount += 1;
      cur.lostValue += Number(d.value || 0);
    }
    byMonth.set(k, cur);
  }

  const totalValue = ongoing.reduce((s, d) => s + Number(d.value || 0), 0);
  const weightedValue = ongoing.reduce(
    (s, d) => s + (Number(d.value || 0) * Number(d.probability || 0)) / 100,
    0,
  );
  const won = closed.filter((d) => d.kind === "WON");
  const lost = closed.filter((d) => d.kind === "LOST");
  const decided = won.length + lost.length;
  const wonValue = won.reduce((s, d) => s + Number(d.value || 0), 0);

  return {
    summary: {
      openDeals: ongoing.length,
      totalValue: round2(totalValue),
      weightedValue: round2(weightedValue),
      wonCount: won.length,
      wonValue: round2(wonValue),
      lostCount: lost.length,
      lostValue: round2(lost.reduce((s, d) => s + Number(d.value || 0), 0)),
      winRate: decided > 0 ? round2((won.length / decided) * 100) : 0,
      avgDealSize: won.length > 0 ? round2(wonValue / won.length) : 0,
      // Giá trị deal đang mở dự kiến đóng trong mốc tháng tới
      dueSoon: ongoing
        .filter((d) => d.expectedCloseDate && new Date(d.expectedCloseDate) <= from30())
        .reduce((s, d) => s + Number(d.value || 0), 0),
    },
    byStage: [...byStage.values()].map((s) => ({
      ...s,
      value: round2(s.value),
      weightedValue: round2(s.weightedValue),
    })),
    byMonth: [...byMonth.values()]
      .sort((a, b) => a.month.localeCompare(b.month))
      .map((r) => ({
        ...r,
        wonValue: round2(r.wonValue),
        lostValue: round2(r.lostValue),
      })),
    lostReasons: countBy(lost.map((d) => d.lostReason).filter(Boolean)),
  };
};

/** Mốc 30 ngày tới — dùng cho "deal dự kiến đóng trong tháng" */
const from30 = () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

const countBy = (arr) => {
  const map = new Map();
  for (const v of arr) map.set(v, (map.get(v) || 0) + 1);
  return [...map.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);
};

/**
 * Convert deal thắng → đơn hàng.
 *
 * Cố ý KHÔNG viết lại logic đơn hàng: delegate `orderService.create` để tái dùng
 * nguyên logic sinh mã `ORD-YYYYMMDD-XXXX`, trừ/giữ tồn kho, promotion, loyalty,
 * bút toán kế toán, e-invoice.
 *
 * Về giá: `orderService.create` LUÔN lấy `product.price` làm đơn giá (không nhận
 * giá thỏa thuận từ bên ngoài). Nếu giá deal ≠ giá sản phẩm, ta bù chênh lệch
 * bằng chiết khấu cấp đơn (FIXED) để tổng đơn khớp giá trị deal. Trường hợp
 * deal cao hơn giá sản phẩm (giá thương lượng tăng) thì không biểu diễn được bằng
 * chiết khấu âm → ghi log cảnh báo, giữ nguyên giá sản phẩm.
 */
const convertToOrder = async (id, payload = {}, userId, user) => {
  const deal = await prisma.crmDeal.findUnique({
    where: { id },
    select: {
      ...DEAL_SELECT,
      items: { select: ITEM_SELECT, orderBy: { createdAt: "asc" } },
      contact: { select: { id: true, fullName: true, email: true, phone: true, customerId: true } },
    },
  });
  assertAccess(user, deal, "dealOwnerId", "Deal");

  if (deal.orderId) {
    throw new ApiError(409, "Deal này đã tạo đơn hàng trước đó", { orderId: deal.orderId });
  }
  if (deal.kind !== "WON") {
    throw new ApiError(400, "Chỉ deal ở giai đoạn Thắng mới tạo được đơn hàng");
  }

  const sellable = deal.items.filter((it) => it.productId);
  if (sellable.length === 0) {
    throw new ApiError(400, "Deal chưa có sản phẩm nào — thêm dòng sản phẩm trước khi tạo đơn");
  }

  const customerId = await resolveCustomer(deal, payload, userId);

  // Ước lượng tiền đơn theo product.price để bù chênh lệch với giá deal
  const products = await prisma.product.findMany({
    where: { id: { in: sellable.map((i) => i.productId) } },
    select: { id: true, name: true, price: true, isActive: true },
  });
  const priceMap = new Map(products.map((p) => [p.id, Number(p.price || 0)]));
  const estimatedSubtotal = round2(
    sellable.reduce((s, it) => s + priceMap.get(it.productId) * Number(it.quantity || 0), 0),
  );
  const dealItemsTotal = round2(sellable.reduce((s, it) => s + Number(it.amount || 0), 0));
  let orderDiscountValue = 0;
  if (dealItemsTotal > 0 && estimatedSubtotal - dealItemsTotal > 0.5) {
    orderDiscountValue = round2(estimatedSubtotal - dealItemsTotal);
  } else if (estimatedSubtotal - dealItemsTotal < -0.5) {
    logger.warn(
      `[crm] deal ${id}: giá deal cao hơn giá sản phẩm (${dealItemsTotal} > ${estimatedSubtotal}) — đơn hàng sẽ dùng giá sản phẩm`,
    );
  }

  // Require động: chỉ load orderService khi thực sự cần (tránh circular require lúc boot)
  const orderService = require("../orders/order.service");

  const order = await orderService.create(
    {
      customerId,
      items: sellable.map((it) => ({
        productId: it.productId,
        quantity: Number(it.quantity || 0),
        discountType: "NONE",
        discountValue: 0,
      })),
      discount: orderDiscountValue,
      discountType: orderDiscountValue > 0 ? "FIXED" : "NONE",
      discountValue: orderDiscountValue,
      status: payload.orderStatus || "PENDING",
      paymentMethod: payload.paymentMethod || "BANK_TRANSFER",
      warehouseId: payload.warehouseId || undefined,
      note: payload.note || `Tạo từ CRM Deal: ${deal.dealName}`,
      channel: "CRM",
    },
    userId,
    { userRole: user?.role },
  );

  const updated = await prisma.crmDeal.update({
    where: { id },
    data: { orderId: order.id, customerId, closedAt: deal.closedAt ?? new Date() },
    select: { ...DEAL_SELECT, items: { select: ITEM_SELECT, orderBy: { createdAt: "asc" } } },
  });

  await communicationService.logSystemEvent({
    dealId: id,
    contactId: deal.contactId,
    content: `Tạo đơn hàng ${order.orderCode} từ deal (${round2(Number(order.total))} ${order.currency || "VND"})`,
    createdById: userId,
  });

  auditService.log({
    userId,
    action: "CONVERT_CRM_DEAL_TO_ORDER",
    entity: "CrmDeal",
    entityId: id,
    before: { orderId: null },
    after: { orderId: order.id, orderCode: order.orderCode, total: order.total, customerId },
  });

  return { deal: updated, order };
};

/** Chốt khách hàng cho đơn: ưu tiên payload → deal → contact → tìm/tạo mới */
const resolveCustomer = async (deal, payload, userId) => {
  if (payload.customerId) return payload.customerId;
  if (deal.customerId) return deal.customerId;
  if (deal.contact?.customerId) return deal.contact.customerId;

  const phone = deal.contact?.phone || null;
  const email = deal.contact?.email || null;
  const name = deal.contact?.fullName || deal.organization?.name || deal.dealName;

  // Đã có khách hàng cùng SĐT/email → dùng lại, không tạo trùng
  if (phone || email) {
    const existing = await prisma.customer.findFirst({
      where: { ...(phone ? { phone } : {}), ...(!phone && email ? { email } : {}), isActive: true },
      select: { id: true },
    });
    if (existing) return existing.id;
  }

  if (payload.createCustomer === false) {
    throw new ApiError(400, "Chưa có khách hàng cho deal này — truyền customerId hoặc cho phép tạo khách hàng mới", {
      details: { createCustomerAllowed: true },
    });
  }

  const customer = await prisma.customer.create({
    data: {
      name,
      phone,
      email,
      leadStatus: "QUALIFIED",
      referralSource: "CRM_DEAL",
    },
    select: { id: true },
  });

  if (deal.contact?.id) {
    await prisma.crmContact.update({ where: { id: deal.contact.id }, data: { customerId: customer.id } });
  }

  auditService.log({
    userId,
    action: "CREATE_CUSTOMER_FROM_CRM_DEAL",
    entity: "Customer",
    entityId: customer.id,
    after: { name, source: "CRM_DEAL", dealId: deal.id },
  });

  return customer.id;
};

module.exports = {
  DEAL_SELECT,
  ITEM_SELECT,
  calcItemAmount,
  list,
  getById,
  create,
  update,
  remove,
  changeStage,
  upsertItems,
  getBoard,
  getForecast,
  convertToOrder,
};
