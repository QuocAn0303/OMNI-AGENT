/**
 * modules/crm/stages.service.js — Cấu hình stage của CRM Sales Pipeline
 *
 * Tổng quan:
 * - Stage là BẢNG CẤU HÌNH (không phải enum cứng) → admin tự thêm/sửa/đổi thứ tự.
 *   Frappe CRM gọi nó là doctype "CRM Deal Status".
 * - Mỗi stage thuộc 1 entityType: LEAD (kanban lead) hoặc DEAL (kanban deal).
 * - `kind` quyết định ngữ nghĩa: ONGOING (đang chạy) / WON (thắng) / LOST (thua).
 *   `CrmDeal.kind` denormalize từ stage này để query WON/LOST không cần join.
 * - `probability` (0-100) là xác suất thắng — dùng cho weighted forecast.
 *
 * Vì sao cần ensureDefaultStages:
 * - Không có code path nào tạo Tenant trong `src/` (không tồn tại `prisma.tenant.create`)
 *   → không thể hook seed lúc provision tenant. Giải pháp: lazy-seed idempotent,
 *   gọi từ `GET /crm/stages` và `GET /crm/deals/board` (lần đầu tiên của tenant).
 * - `createMany({ skipDuplicates: true })` + unique `[tenantId, entityType, label]`
 *   → chạy lại vô hạn lần cũng không tạo trùng.
 *
 * Hàm:
 * - ensureDefaultStages(tenantId?): tạo stage mặc định nếu tenant chưa có (idempotent)
 * - list(entityType, { includeInactive }): danh sách stage theo entityType
 * - create(data, userId), update(id, data, userId), remove(id, userId)
 * - reorder(items, userId): gán sortOrder hàng loạt
 * - getById(id): 1 stage (dùng nội bộ khi đổi stage lead/deal)
 * - firstOngoingStage(entityType): stage ONGOING đầu tiên theo sortOrder
 */
const prisma = require("../../config/prisma");
const { getTenantId } = require("../../config/tenantContext");
const auditService = require("../audit/audit.service");
const ApiError = require("../../utils/apiError");

// Stage mặc định — probability là xác suất thắng dùng cho forecast
const DEFAULT_STAGES = [
  // Kanban LEAD
  { entityType: "LEAD", label: "Mới", color: "#0f766e", sortOrder: 0, kind: "ONGOING", probability: 10 },
  { entityType: "LEAD", label: "Đã liên hệ", color: "#2563eb", sortOrder: 1, kind: "ONGOING", probability: 25 },
  { entityType: "LEAD", label: "Đủ thông tin", color: "#7c3aed", sortOrder: 2, kind: "ONGOING", probability: 50 },
  // Kanban DEAL
  { entityType: "DEAL", label: "Mới", color: "#0f766e", sortOrder: 0, kind: "ONGOING", probability: 10 },
  { entityType: "DEAL", label: "Đã xác định", color: "#2563eb", sortOrder: 1, kind: "ONGOING", probability: 25 },
  { entityType: "DEAL", label: "Đề xuất", color: "#7c3aed", sortOrder: 2, kind: "ONGOING", probability: 50 },
  { entityType: "DEAL", label: "Đàm phán", color: "#c2410c", sortOrder: 3, kind: "ONGOING", probability: 75 },
  { entityType: "DEAL", label: "Thắng", color: "#16a34a", sortOrder: 4, kind: "WON", probability: 100 },
  { entityType: "DEAL", label: "Thua", color: "#dc2626", sortOrder: 5, kind: "LOST", probability: 0 },
];

const STAGE_SELECT = {
  id: true,
  entityType: true,
  label: true,
  color: true,
  sortOrder: true,
  kind: true,
  probability: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
};

/**
 * Lazy-seed stage mặc định. Idempotent — gọi bao nhiêu lần cũng an toàn.
 * @param {string} [tenantId] - mặc định lấy từ AsyncLocalStorage (tenant.middleware đã set)
 */
const ensureDefaultStages = async (tenantId = getTenantId()) => {
  if (!tenantId) return [];
  try {
    await prisma.crmPipelineStage.createMany({
      data: DEFAULT_STAGES,
      skipDuplicates: true,
    });
  } catch (e) {
    // 23505 = unique violation khi 2 request đồng thời cùng seed → coi như đã có
    if (e?.code !== "P2002" && e?.code !== "23505") throw e;
  }
  return list("DEAL", { includeInactive: true });
};

/**
 * Danh sách stage theo entityType.
 * @param {"LEAD"|"DEAL"} entityType
 * @param {{ includeInactive?: boolean }} opts
 */
const list = async (entityType, { includeInactive = false } = {}) => {
  const where = { entityType };
  if (!includeInactive) where.isActive = true;
  return prisma.crmPipelineStage.findMany({
    where,
    select: STAGE_SELECT,
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
};

const getById = async (id) => {
  const stage = await prisma.crmPipelineStage.findUnique({
    where: { id },
    select: STAGE_SELECT,
  });
  if (!stage) throw new ApiError(404, "Giai đoạn không tồn tại");
  return stage;
};

/** Stage ONGOING đầu tiên theo sortOrder — dùng khi tạo lead/deal chưa chọn stage */
const firstOngoingStage = async (entityType) => {
  const rows = await prisma.crmPipelineStage.findMany({
    where: { entityType, kind: "ONGOING", isActive: true },
    select: STAGE_SELECT,
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    take: 1,
  });
  return rows[0] || null;
};

const create = async (data, userId) => {
  let stage;
  try {
    stage = await prisma.crmPipelineStage.create({
      data: {
        entityType: data.entityType,
        label: data.label.trim(),
        color: data.color || "#0f766e",
        sortOrder: data.sortOrder ?? 0,
        kind: data.kind || "ONGOING",
        probability: data.probability ?? 0,
        isActive: data.isActive ?? true,
      },
      select: STAGE_SELECT,
    });
  } catch (e) {
    // Unique [tenantId, entityType, label] → báo rõ ràng thay vì lỗi DB
    if (e?.code === "P2002") {
      throw new ApiError(409, `Giai đoạn "${data.label}" đã tồn tại trong ${data.entityType === "LEAD" ? "kanban lead" : "kanban deal"}`);
    }
    throw e;
  }

  await auditService.log({
    userId,
    action: "CREATE_CRM_STAGE",
    entity: "CrmPipelineStage",
    entityId: stage.id,
    after: stage,
  });
  return stage;
};

/**
 * Sửa stage + đồng bộ deal trong 1 transaction.
 *
 * CRM audit H5 — 2 vấn đề trước đây:
 *  1. `crmPipelineStage.update` và `crmDeal.updateMany` là 2 statement tuần tự không
 *     transaction. Lỗi giữa chừng ⇒ `stage.kind = "WON"` nhưng deal vẫn ONGOING vĩnh
 *     viễn, không có đường đồng bộ lại.
 *  2. `updateMany` chỉ set `kind` + `probability`, KHÔNG set `closedAt`. Deal được
 *     đẩy sang WON/LOST có `closedAt = null` ⇒ `getForecast` và `dashboard` lọc
 *     `closedAt: { gte: from }` ⇒ doanh thu thắng BIẾN MẤT khỏi winRate/wonValue/
 *     byMonth dù kanban vẫn hiện ở cột "Thắng". Đây là lỗi báo cáo tài chính
 *     nặng hơn lỗi hiển thị.
 *
 * Ghi đè `probability` của deal đã đóng: `probability` là snapshot tại thời điểm deal
 * vào stage, nên chỉ đồng bộ cho deal ONGOING (giữ hành vi cũ).
 */
const update = async (id, data, userId) => {
  const before = await prisma.crmPipelineStage.findUnique({
    where: { id },
    select: STAGE_SELECT,
  });
  if (!before) throw new ApiError(404, "Giai đoạn không tồn tại");

  const patch = {};
  if (data.label !== undefined) patch.label = String(data.label).trim();
  if (data.color !== undefined) patch.color = data.color;
  if (data.sortOrder !== undefined) patch.sortOrder = data.sortOrder;
  if (data.kind !== undefined) patch.kind = data.kind;
  if (data.probability !== undefined) patch.probability = data.probability;
  if (data.isActive !== undefined) patch.isActive = data.isActive;

  const kindChanged = patch.kind !== undefined && patch.kind !== before.kind;

  let stage;
  try {
    stage = await prisma.$transaction(async (tx) => {
      const updated = await tx.crmPipelineStage.update({
        where: { id },
        data: patch,
        select: STAGE_SELECT,
      });

      // Đổi kind/probability của stage → deal đang dùng stage đó phải đồng bộ theo
      // (CrmDeal.kind/probability là bản denormalize để query nhanh).
      // Đổi riêng probability thì chỉ áp cho deal ONGOING — deal đã đóng giữ nguyên snapshot.
      if (before.entityType === "DEAL" && (kindChanged || patch.probability !== undefined)) {
        const dealPatch = {
          ...(kindChanged ? { kind: patch.kind } : {}),
          ...(patch.probability !== undefined ? { probability: patch.probability } : {}),
        };
        if (kindChanged) {
          // Sang WON/LOST → đóng deal (closedAt) để forecast/dashboard tính được.
          // Ngược lại về ONGOING → gỡ closedAt (deal mở lại, không còn "đã đóng").
          dealPatch.closedAt = patch.kind === "ONGOING" ? null : new Date();
          // Deal thắng mà có lý do thua cũ thì không còn hợp lý.
          if (patch.kind !== "LOST") dealPatch.lostReason = null;
        }
        await tx.crmDeal.updateMany({
          where: kindChanged ? { stageId: id } : { stageId: id, kind: "ONGOING" },
          data: dealPatch,
        });
      }

      return updated;
    });
  } catch (e) {
    if (e?.code === "P2002") {
      throw new ApiError(409, `Giai đoạn "${patch.label ?? before.label}" đã tồn tại`);
    }
    throw e;
  }

  await auditService.log({
    userId,
    action: "UPDATE_CRM_STAGE",
    entity: "CrmPipelineStage",
    entityId: id,
    before,
    after: stage,
    meta: kindChanged ? { syncedDealKind: patch.kind, closedAtSet: patch.kind !== "ONGOING" } : undefined,
  });
  return stage;
};

/**
 * Xóa stage — chặn nếu còn lead/deal đang dùng (sẽ mất dữ liệu pipeline).
 * Nên dùng `isActive=false` để ẩn thay vì xóa.
 */
const remove = async (id, userId) => {
  const stage = await prisma.crmPipelineStage.findUnique({
    where: { id },
    select: { ...STAGE_SELECT, _count: { select: { leads: true, deals: true } } },
  });
  if (!stage) throw new ApiError(404, "Giai đoạn không tồn tại");

  if (stage.entityType === "LEAD" && stage._count.leads > 0) {
    throw new ApiError(409, `Còn ${stage._count.leads} lead đang ở giai đoạn này — hãy ẩn (isActive=false) thay vì xóa`);
  }
  if (stage.entityType === "DEAL" && stage._count.deals > 0) {
    throw new ApiError(409, `Còn ${stage._count.deals} deal đang ở giai đoạn này — hãy ẩn (isActive=false) thay vì xóa`);
  }

  await prisma.crmPipelineStage.delete({ where: { id } });

  await auditService.log({
    userId,
    action: "DELETE_CRM_STAGE",
    entity: "CrmPipelineStage",
    entityId: id,
    before: { label: stage.label, entityType: stage.entityType },
  });
  return { id };
};

/** Gán lại thứ tự hiển thị (kéo-thả trong Pipeline Settings) */
const reorder = async (items, userId) => {
  // Chỉ update những stage thuộc tenant hiện tại — extension tự scope theo tenantId
  const result = await prisma.$transaction(
    items.map((it) =>
      prisma.crmPipelineStage.update({
        where: { id: it.id },
        data: { sortOrder: it.sortOrder },
        select: STAGE_SELECT,
      }),
    ),
  );

  await auditService.log({
    userId,
    action: "REORDER_CRM_STAGES",
    entity: "CrmPipelineStage",
    after: { count: items.length },
  });
  return result;
};

module.exports = {
  DEFAULT_STAGES,
  STAGE_SELECT,
  ensureDefaultStages,
  list,
  getById,
  firstOngoingStage,
  create,
  update,
  remove,
  reorder,
};
