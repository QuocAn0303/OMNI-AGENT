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
const { randomUUID } = require("crypto");
const { getTenantId } = require("../../config/tenantContext");
const auditService = require("../audit/audit.service");
const notif = require("../notifications/notification.service");
const logger = require("../../utils/logger");
const ApiError = require("../../utils/apiError");
const stagesService = require("./stages.service");
const communicationService = require("./communication.service");
const { ownerScopeForTeam, assertAccess, isManager, assertRefsInTenant, resolveOwnerId } = require("./scope");
const { getTeamUserIds } = require("./hierarchy.service");

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/**
 * C3 — phạm vi xoá dòng sản phẩm của 1 deal.
 *
 * `deleteMany` bị Prisma extension ép `tenantId = <tid>` nên **bỏ sót** dòng có
 * `tenantId = NULL` — chính là dòng do nested write tạo ra trước khi sửa (đã có
 * migration backfill, nhưng code phải tự chịu được nếu dữ liệu cũ quay lại từ
 * backup hoặc import tay). Ghép thêm `OR` để quét cả hai trạng thái.
 *
 * `getTenantId()` trả null khi không có tenant context (SUPER_OMEGA bypass) →
 * extension không scope → `deleteMany({ dealId })` đã là phạm vi đúng.
 */
const dealItemDeleteScope = (dealId) => {
  const tenantId = getTenantId();
  if (!tenantId) return { dealId };
  return { dealId, OR: [{ tenantId }, { tenantId: null }] };
};

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

/**
 * CRM Phase 4 — assertAccess theo cây báo cáo (manager thấy record của bậc dưới).
 * Bọc 1 chỗ cho toàn bộ call site trong file này.
 */
const assertDealAccess = async (user, record) =>
  assertAccess(user, record, "dealOwnerId", "Deal", await getTeamUserIds(user));

const list = async (query = {}, user) => {
  const p = Math.max(1, Number(query.page) || 1);
  const l = Math.max(1, Math.min(200, Number(query.limit) || 20));

  const where = { ...ownerScopeForTeam(user, "dealOwnerId", await getTeamUserIds(user)) };
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
  await assertDealAccess(user, deal);
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
  // H7: non-manager không tự gán deal cho người khác được
  const ownerId = resolveOwnerId(data.dealOwnerId, user);
  const kind = stage?.kind === "WON" || stage?.kind === "LOST" ? stage.kind : "ONGOING";

  await assertRefsInTenant([
    { model: "crmOrganization", id: data.organizationId, label: "Tổ chức" },
    { model: "crmContact", id: data.contactId, label: "Liên hệ" },
    { model: "crmLead", id: data.leadId, label: "Lead" },
    { model: "customer", id: data.customerId, label: "Khách hàng" },
    { model: "user", id: ownerId, label: "Người phụ trách" },
  ]);

  const value = data.value ?? round2(items.reduce((s, i) => s + i.amount, 0));

  // C3: KHÔNG dùng nested write `items: { create: items }`.
  // Prisma extension (`config/prisma.js`) chỉ bọc operation cấp cao nhất
  // (`crmDeal.create`) nên dòng `crm_deal_items` con sẽ có `tenantId = NULL`
  // → `upsertItems` (`deleteMany` bị scope theo tenant) không xoá được chúng
  // → mỗi lần "Lưu danh sách sản phẩm" là danh sách nhân đôi.
  // Ghi bằng `createMany` top-level trong transaction ⇒ được inject `tenantId`
  // giống hệt `upsertItems`.
  const deal = await prisma.$transaction(async (tx) => {
    const created = await tx.crmDeal.create({
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
      },
      select: { id: true },
    });

    if (items.length) {
      await tx.crmDealItem.createMany({
        data: items.map((row) => ({ ...row, dealId: created.id })),
      });
    }

    return tx.crmDeal.findUnique({
      where: { id: created.id },
      select: { ...DEAL_SELECT, items: { select: ITEM_SELECT, orderBy: { createdAt: "asc" } } },
    });
  });

  await auditService.log({
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
  await assertDealAccess(user, before);
  // H6: PATCH phải chạy cùng guard với `changeStage` — deal đã sinh đơn thì trạng
  // thái deal và đơn đã phát sinh sẽ mâu thuẫn nếu vẫn đổi stage được.
  if (before.orderId && data.stageId !== undefined) {
    throw new ApiError(409, "Deal đã tạo đơn hàng — không đổi giai đoạn được");
  }
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
  // H7: non-manager không tự chuyển deal cho người khác được
  if (data.dealOwnerId !== undefined) patch.dealOwnerId = resolveOwnerId(data.dealOwnerId, user);
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
  // H6: đổi stage sang LOST qua PATCH cũng bắt buộc có lý do thua — không có bước
  // này thì báo cáo "Lý do thua" mất dữ liệu chỉ vì user dùng modal Sửa thay vì
  // kéo-thả trên kanban.
  if (patch.kind === "LOST" && data.lostReason === undefined && !before.lostReason) {
    throw new ApiError(400, "Cần nhập lý do thua khi chuyển deal sang giai đoạn Thua");
  }

  await assertRefsInTenant([
    { model: "crmOrganization", id: patch.organizationId, label: "Tổ chức" },
    { model: "crmContact", id: patch.contactId, label: "Liên hệ" },
    { model: "customer", id: patch.customerId, label: "Khách hàng" },
    { model: "user", id: patch.dealOwnerId, label: "Người phụ trách" },
  ]);

  const deal = await prisma.crmDeal.update({ where: { id }, data: patch, select: DEAL_SELECT });

  await auditService.log({
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

  // H6: deal chuyển sang WON qua modal Sửa cũng phải báo người phụ trách — trước đây
  // chỉ `changeStage` (kéo-thả kanban) gọi `notificationWon`, nên thắng deal từ form
  // Sửa im lặng không ai được biết.
  if (patch.kind === "WON" && before.kind !== "WON") {
    await notificationWon(deal, before, userId);
  }

  return deal;
};

/** Xóa deal — chặn nếu đã sinh đơn hàng (orderId unique → giữ dấu vết doanh thu) */
const remove = async (id, userId, user) => {
  const deal = await prisma.crmDeal.findUnique({
    where: { id },
    select: { id: true, dealName: true, orderId: true, dealOwnerId: true, kind: true },
  });
  await assertDealAccess(user, deal);
  if (deal.orderId) {
    throw new ApiError(409, "Deal đã tạo đơn hàng — không xóa được để giữ dấu vết doanh thu");
  }

  // items có onDelete: Cascade; communication thì xóa tay (không có FK cascade)
  await prisma.$transaction([
    prisma.crmCommunication.deleteMany({ where: { dealId: id } }),
    prisma.crmDeal.delete({ where: { id } }),
  ]);

  await auditService.log({
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
  await assertDealAccess(user, before);
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

  await auditService.log({
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
    logger.error("[crm] notify deal WON failed:", { err: e });
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
  await assertDealAccess(user, deal);
  if (deal.orderId) throw new ApiError(409, "Deal đã tạo đơn hàng — không sửa được danh sách sản phẩm");

  const rows = await normalizeItems(items);
  const itemsTotal = round2(rows.reduce((s, i) => s + i.amount, 0));

  const updated = await prisma.$transaction(async (tx) => {
    await tx.crmDealItem.deleteMany({ where: dealItemDeleteScope(id) });
    if (rows.length) await tx.crmDealItem.createMany({ data: rows.map((r) => ({ ...r, dealId: id })) });
    // value = 0 nghĩa là deal chưa được gán giá thủ công → lấy theo tổng dòng.
    // CRM audit M8: `PUT {"items": []}` là "xóa sạch danh sách" — trước đây dòng bị
    // xoá nhưng `value` giữ giá trị cũ ⇒ forecast/dashboard sai và `convertToOrder`
    // trả 400 "Deal chưa có sản phẩm" dù deal vẫn còn giá trị. Xóa sạch ⇒ value = 0.
    const shouldRecompute =
      rows.length === 0 ? Number(deal.value) !== 0 : Number(deal.value) === 0 && itemsTotal > 0;
    return tx.crmDeal.update({
      where: { id },
      data: shouldRecompute ? { value: itemsTotal } : {},
      select: { ...DEAL_SELECT, items: { select: ITEM_SELECT, orderBy: { createdAt: "asc" } } },
    });
  });

  await auditService.log({
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
 *
 * CRM audit M3 — `take` cắt ngang dữ liệu mà không báo:
 *   1. `getForecast` nạp TOÀN BỘ deal ONGOING/đã-đóng của tenant vào heap. Tenant
 *      200k deal ONGOING ⇒ mỗi lần gọi `/forecast` nạp 200k row.
 *   2. `getBoard` có `take: 500`/`take: 200` nhưng không phân trang và FE không
 *      cảnh báo ⇒ KPI báo thấp hơn thực tế trong khi người dùng tưởng đã xem hết.
 * Sửa: `take` có trần cho forecast + `truncated` flag trả về cho FE hiển thị.
 */
const BOARD_MAX_DEALS = 500;
const BOARD_MAX_UNASSIGNED = 200;
const FORECAST_MAX_ONGOING = 5000;
const FORECAST_MAX_CLOSED = 5000;

const getBoard = async (user, { includeClosed = false } = {}) => {
  await stagesService.ensureDefaultStages();
  const stages = await stagesService.list("DEAL", { includeInactive: false });

  const where = { ...ownerScopeForTeam(user, "dealOwnerId", await getTeamUserIds(user)) };
  if (!includeClosed) where.kind = "ONGOING";

  // `take + 1` để biết đã cắt ngang mà không cần query COUNT thứ hai (đắt hơn).
  const [deals, unassigned] = await Promise.all([
    prisma.crmDeal.findMany({
      where: { ...where, stageId: { in: stages.map((s) => s.id) } },
      select: DEAL_SELECT,
      orderBy: [{ value: "desc" }, { updatedAt: "desc" }],
      take: BOARD_MAX_DEALS + 1,
    }),
    prisma.crmDeal.findMany({
      where: { ...where, stageId: null },
      select: DEAL_SELECT,
      orderBy: [{ value: "desc" }, { updatedAt: "desc" }],
      take: BOARD_MAX_UNASSIGNED + 1,
    }),
  ]);

  const truncated = deals.length > BOARD_MAX_DEALS || unassigned.length > BOARD_MAX_UNASSIGNED;
  const visibleDeals = deals.slice(0, BOARD_MAX_DEALS);
  const visibleUnassigned = unassigned.slice(0, BOARD_MAX_UNASSIGNED);

  const columns = stages.map((stage) => {
    const cards = visibleDeals.filter((d) => d.stageId === stage.id);
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

  if (visibleUnassigned.length) {
    columns.push({
      stage: { id: null, label: "Chưa phân giai đoạn", color: "#64748b", kind: "ONGOING", probability: 0 },
      count: visibleUnassigned.length,
      totalValue: round2(visibleUnassigned.reduce((s, d) => s + Number(d.value || 0), 0)),
      weightedValue: 0,
      deals: visibleUnassigned,
    });
  }

  return {
    columns,
    // FE hiển thị "còn N bản ghi" để người dùng không tưởng đã xem hết pipeline.
    truncated,
    limits: { maxDeals: BOARD_MAX_DEALS, maxUnassigned: BOARD_MAX_UNASSIGNED },
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

  const where = { ...ownerScopeForTeam(user, "dealOwnerId", await getTeamUserIds(user)) };

  const [ongoing, closed] = await Promise.all([
    prisma.crmDeal.findMany({
      where: { ...where, kind: "ONGOING" },
      select: { id: true, value: true, probability: true, expectedCloseDate: true, stage: { select: { id: true, label: true, color: true, probability: true } } },
      // Trần + cờ cắt ngang: tenant có 200k deal ONGOING sẽ không nạp hết vào heap.
      orderBy: [{ value: "desc" }, { updatedAt: "desc" }],
      take: FORECAST_MAX_ONGOING + 1,
    }),
    prisma.crmDeal.findMany({
      where: { ...where, kind: { in: ["WON", "LOST"] }, closedAt: { gte: from } },
      select: { id: true, value: true, kind: true, closedAt: true, lostReason: true },
      orderBy: { closedAt: "desc" },
      take: FORECAST_MAX_CLOSED + 1,
    }),
  ]);

  // M3: `orderBy` + `take` cũng tránh kiểu `take: 5000` không sort (trước đây
  // dashboard cắt ngang 5000 bản ghi CŨ NHẤT và biến `byMonth` sai mà không báo).
  const forecastTruncated = ongoing.length > FORECAST_MAX_ONGOING || closed.length > FORECAST_MAX_CLOSED;
  const ongoingVisible = ongoing.slice(0, FORECAST_MAX_ONGOING);
  const closedVisible = closed.slice(0, FORECAST_MAX_CLOSED);

  const byStage = new Map();
  for (const d of ongoingVisible) {
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
  for (const d of closedVisible) {
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

  const totalValue = ongoingVisible.reduce((s, d) => s + Number(d.value || 0), 0);
  const weightedValue = ongoingVisible.reduce(
    (s, d) => s + (Number(d.value || 0) * Number(d.probability || 0)) / 100,
    0,
  );
  const won = closedVisible.filter((d) => d.kind === "WON");
  const lost = closedVisible.filter((d) => d.kind === "LOST");
  const decided = won.length + lost.length;
  const wonValue = won.reduce((s, d) => s + Number(d.value || 0), 0);

  return {
    truncated: forecastTruncated,
    limits: { maxOngoing: FORECAST_MAX_ONGOING, maxClosed: FORECAST_MAX_CLOSED },
    summary: {
      openDeals: ongoingVisible.length,
      totalValue: round2(totalValue),
      weightedValue: round2(weightedValue),
      wonCount: won.length,
      wonValue: round2(wonValue),
      lostCount: lost.length,
      lostValue: round2(lost.reduce((s, d) => s + Number(d.value || 0), 0)),
      winRate: decided > 0 ? round2((won.length / decided) * 100) : 0,
      avgDealSize: won.length > 0 ? round2(wonValue / won.length) : 0,
      // Giá trị deal đang mở dự kiến đóng trong mốc tháng tới
      dueSoon: ongoingVisible
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
 * CRM audit M4 — chặn số lượng phân số khi sinh đơn.
 *
 * `CrmDealItem.quantity` là `Decimal(12,2)` nên 1.5 kg là hợp lệ, nhưng
 * `OrderItem.quantity` là **Int**. `Number(1.5)` trước đây bị Postgres/Prisma cắt
 * còn 1 trong khi `subtotal` vẫn tính trên 1.5 ⇒ đơn ghi sai số lượng và `order.service`
 * trừ tồn kho theo số đã cắt. Sửa `OrderItem.quantity` sang Decimal là thay đổi
 * lan sang Inventory/Returns/POS — ra ngoài phạm vi này và tốn kém.
 *
 * Chọn: báo lỗi rõ ràng thay vì ghi sai. Người dùng sửa dòng về số nguyên (hoặc tách
 * dòng) rồi convert. Đây là chọn lựa có chủ ý — im lặng sửa dữ liệu tài chính tệ hơn
 * là báo người dùng biết.
 */
const assertWholeQuantity = (sellable, dealName) => {
  const fractional = sellable.filter((it) => !Number.isInteger(Number(it.quantity || 0)));
  if (fractional.length === 0) return;
  throw new ApiError(
    400,
    `Deal "${dealName}" có ${fractional.length} dòng với số lượng phân số ` +
      `(${fractional.map((i) => i.description || i.productId).join(", ")}). ` +
      "Đơn hàng chỉ nhận số lượng nguyên — hãy làm tròn hoặc tách dòng trước khi tạo đơn.",
  );
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
 *
 * CHỐNG RACE (CRM audit C2): `orderService.create` trừ tồn kho, ghi bút toán và
 * cộng `totalSpent` cho khách — không thể đặt trong transaction của CRM mà vẫn
 * giữ được (nó dùng client Prisma riêng). Vì vậy "giành quyền" phải được quyết
 * định TRƯỚC khi gọi nó, bằng conditional update:
 *
 *   updateMany({ where: { id, orderId: null }, data: { orderId: PENDING } })
 *
 * Chỉ 1 request trong N request song song nhận `count === 1` → đó là người duy
 * nhất được tạo đơn. `@@unique([orderId])` trên CrmDeal không cứu được trường hợp
 * này vì 2 đơn khác nhau đều ghi vào CÙNG 1 deal.
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
  await assertDealAccess(user, deal);

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
  assertWholeQuantity(sellable, deal.dealName);

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

  // ============================================================
  // Bước 1 — GIÀNH QUYỀN tạo đơn (atomic, chặn double-click)
  // ============================================================
  // Dùng marker tạm thay vì orderId thật: nếu `orderService.create` ném lỗi, bước 2
  // gỡ marker lại để deal trở về trạng thái có thể thử lại. Marker PHẢI là chuỗi
  // duy nhất vì `CrmDeal.orderId` có `@unique` — dùng lại cùng 1 hằng (vd theo
  // userId) sẽ tự nổ unique khi user convert 2 deal cùng lúc.
  //
  // Claim đặt TRƯỚC `resolveCustomer` để 2 request song song không cùng tạo 2 khách
  // hàng "ma" (cũng là read-then-write không an toàn).
  const CLAIM = `PENDING_CRM_${randomUUID()}`;
  const claim = await prisma.crmDeal.updateMany({
    where: { id, orderId: null },
    data: { orderId: CLAIM },
  });
  if (claim.count !== 1) {
    const current = await prisma.crmDeal.findUnique({
      where: { id },
      select: { orderId: true },
    });
    throw new ApiError(409, "Deal này đang được tạo đơn hàng — vui lòng không thao tác lại", {
      orderId: current?.orderId ?? null,
    });
  }

  // ============================================================
  // Bước 2 — chốt khách hàng + tạo đơn; lỗi thì trả deal về nguyên trạng
  // ============================================================
  // Require động: chỉ load orderService khi thực sự cần (tránh circular require lúc boot)
  const orderService = require("../orders/order.service");

  let customerId;
  let order;
  try {
    customerId = await resolveCustomer(deal, payload, userId);

    order = await orderService.create(
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
        currency: deal.currency || "VND",
      },
      userId,
      { userRole: user?.role },
    );
  } catch (e) {
    // Gỡ marker. `updateMany` + điều kiện `orderId = CLAIM` ⇒ không bao giờ gỡ nhầm
    // marker của request khác (trường hợp client retry trong lúc request đầu chạy).
    await prisma.crmDeal
      .updateMany({ where: { id, orderId: CLAIM }, data: { orderId: null } })
      .catch((rollbackError) =>
        logger.error(`[crm] rollback claim deal ${id} thất bại:`, { err: rollbackError, dealId: id }),
      );
    throw e;
  }

  // ============================================================
  // Bước 2b — PRM: đánh dấu lượt giới thiệu đã chuyển đổi
  // ============================================================
  // Đặt SAU `orderService.create`, không đặt trước. Đây là điểm duy nhất trong hệ
  // thống mà ta biết chắc khách đã mua — deal thắng VÀ đơn đã tạo xong. Đặt trước
  // sẽ tính hoa hồng cho một đơn không tồn tại nếu tạo đơn lỗi (hết kho, giá không
  // hợp lệ...), tức trả tiền cho một lượt giới thiệu không sinh ra doanh thu.
  //
  // Bọc riêng để PRM lỗi KHÔNG làm hỏng kết quả chuyển deal: đơn đã tạo và kho đã
  // trừ rồi, ném lỗi ở đây sẽ khiến người dùng tưởng đơn thất lạc rồi bấm lại và
  // tạo đơn trùng. Tốt hơn là ghi log để cron quét lại được.
  if (deal.leadId) {
    // Chuyển trạng thái lead sang CONVERTED.
    //
    // Vì sao cần: `CrmLead` có sẵn hai trường `convertedAt` và `convertedDealId`
    // mà không có dòng nào ghi vào. Nếu không chuyển trạng thái, mọi khách tiềm năng
    // đã thành khách vẫn nằm ở trạng thái cũ, và phễu chuyển đổi theo đối tác báo
    // mốc cuối bằng không với mọi đối tác — trông như chưa ai chuyển đổi được khách
    // nào, dù dữ liệu chuyển đổi vẫn đúng ở chỗ khác.
    //
    // Bọc riêng với lý do giống hệt: đơn đã tạo và kho đã trừ rồi, ném lỗi ở đây
    // sẽ khiến người dùng tưởng đơn thất lạc.
    try {
      await prisma.crmLead.update({
        where: { id: deal.leadId },
        data: {
          status: "CONVERTED",
          convertedAt: new Date(),
          convertedDealId: id,
        },
      });
    } catch (leadError) {
      logger.error(`[crm] chuyển trạng thái lead ${deal.leadId} sang CONVERTED thất bại:`, { err: leadError, leadId: deal.leadId });
    }

    try {
      const referralService = require("../partners/referral.service");
      await referralService.markConverted(deal.leadId, customerId);
    } catch (prmError) {
      logger.error(`[crm] đánh dấu chuyển đổi PRM thất bại cho lead ${deal.leadId}:`, { err: prmError, leadId: deal.leadId });
    }
  }

  // ============================================================
  // Bước 3 — chốt đơn thật vào deal
  // ============================================================
  const updated = await prisma.crmDeal.updateMany({
    where: { id, orderId: CLAIM },
    data: {
      orderId: order.id,
      customerId,
      closedAt: deal.closedAt ?? new Date(),
      kind: "WON",
      lostReason: null,
    },
  });
  if (updated.count !== 1) {
    // Marker đã bị ai đó đổi (rất hiếm: chỉ admin sửa tay). Không rollback đơn —
    // đơn đã tồn tại và trừ kho rồi; ghi log + audit để đối soát được.
    logger.error(
      `[crm] deal ${id}: không chốt được orderId sau khi tạo đơn ${order.id} — kiểm tra đơn ${order.orderCode} để tránh đơn ma.`,
    );
  }

  const finalDeal = await prisma.crmDeal.findUnique({
    where: { id },
    select: { ...DEAL_SELECT, items: { select: ITEM_SELECT, orderBy: { createdAt: "asc" } } },
  });

  await communicationService.logSystemEvent({
    dealId: id,
    contactId: deal.contactId,
    content: `Tạo đơn hàng ${order.orderCode} từ deal (${round2(Number(order.total))} ${order.currency || "VND"})`,
    createdById: userId,
  });

  await auditService.log({
    userId,
    action: "CONVERT_CRM_DEAL_TO_ORDER",
    entity: "CrmDeal",
    entityId: id,
    before: { orderId: null },
    after: { orderId: order.id, orderCode: order.orderCode, total: order.total, customerId },
  });

  return { deal: finalDeal, order };
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

  await auditService.log({
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
