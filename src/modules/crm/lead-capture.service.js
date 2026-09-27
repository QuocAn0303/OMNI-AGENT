/**
 * modules/crm/lead-capture.service.js — Webhook thu thập Lead đa kênh (Mục 2)
 *
 * Tổng quan:
 * - Endpoint public `POST /api/webhook/crm-lead` (không JWT) xác thực bằng header
 *   X-Tenant-Key → map ra tenantId.
 * - API key được sinh/rotate qua hàm generateApiKey() và lưu trong IntegrationConfig
 *   hiện có (tái dùng bảng + cơ chế của Integration Center). Key được nhúng vào
 *   trường `key` dạng `LEAD_WEBHOOK:<apiKey>` để tra O(1) theo header; tenantId
 *   nằm trên chính row đó → multi-tenant isolation vẫn được đảm bảo.
 * - Round-robin gán nhân viên phụ trách (role CASHIER/MANAGER, isActive) — con trỏ
 *   lưu trong CompanySettings.leadRoundRobinCursor (Mục 2.2 điểm 4).
 * - Idempotent theo (phone, tenantId): KH đã có → tạo CustomerNote ghi nguồn lead;
 *   KH mới → tạo Customer với leadStatus=NEW, referralSource=source.
 * - Idempotent theo (Idempotency-Key, tenantId) trong 24h: webhook retry không tạo trùng.
 *
 * Hàm:
 * - generateApiKey(tenantId, userId?): sinh key mới + xoá key cũ của tenant (rotate)
 * - listApiKey(tenantId): trả về key (đã mask) đang hoạt động
 * - resolveTenant(apiKey): X-Tenant-Key → tenantId (null nếu sai)
 * - captureLead(tenantId, payload, idempotencyKey?): xử lý lead, trả
 *   { customerId, isNew, assignedToId } — nếu idempotencyKey trùng trong TTL 24h
 *   thì trả về kết quả đã ghi nhận kèm duplicate: true (không tạo record mới)
 */
const crypto = require("crypto");
const prisma = require("../../config/prisma");
const { runWithTenant } = require("../../config/tenantContext");
const logger = require("../../utils/logger");
const notificationService = require("../notifications/notification.service");

const KEY_PREFIX = "LEAD_WEBHOOK:";
const IDEM_PREFIX = "LEAD_IDEMP:";
const IDEM_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const ASSIGN_ROLES = ["CASHIER", "MANAGER"];

const maskKey = (apiKey) => (apiKey ? `${apiKey.slice(0, 6)}••••${apiKey.slice(-4)}` : null);

// Sinh API key mới (mỗi tenant 1 key active — rotate xoá key cũ)
const generateApiKey = async (tenantId, userId = null) => {
  if (!tenantId) throw { status: 400, message: "Thiếu tenant để phát hành key" };
  const apiKey = crypto.randomBytes(24).toString("hex");
  // Rotate: xoá key cũ của tenant trước khi tạo key mới
  await prisma.integrationConfig.deleteMany({
    where: { key: { startsWith: KEY_PREFIX }, tenantId },
  });
  await prisma.integrationConfig.create({
    data: {
      key: `${KEY_PREFIX}${apiKey}`,
      category: "LEAD_WEBHOOK",
      valueEnc: "lead-webhook-api-key",
      isSecret: false,
      tenantId,
      updatedBy: userId,
    },
  });
  return { apiKey, maskedKey: maskKey(apiKey) };
};

const listApiKey = async (tenantId) => {
  const rows = await prisma.integrationConfig.findMany({
    where: { key: { startsWith: KEY_PREFIX }, tenantId },
    select: { key: true, updatedAt: true },
  });
  return rows.map((r) => ({
    maskedKey: maskKey(r.key.replace(KEY_PREFIX, "")),
    updatedAt: r.updatedAt,
  }));
};

// Xác thực X-Tenant-Key → tenantId (public webhook, không JWT)
const resolveTenant = async (apiKey) => {
  if (!apiKey || typeof apiKey !== "string") return null;
  const row = await prisma.integrationConfig.findUnique({
    where: { key: `${KEY_PREFIX}${apiKey}` },
    select: { tenantId: true },
  });
  return row?.tenantId || null;
};

// Chọn nhân viên round-robin + tăng con trỏ trong CompanySettings
const pickAssignee = async (client = prisma) => {
  const assignees = await client.user.findMany({
    where: { role: { in: ASSIGN_ROLES }, isActive: true },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  if (!assignees.length) {
    throw { status: 422, message: "Tenant chưa có nhân viên (CASHIER/MANAGER) để nhận lead" };
  }
  const settings = await client.companySettings.findFirst();
  const cursor = (settings?.leadRoundRobinCursor ?? 0) % assignees.length;
  const assignee = assignees[cursor];
  if (settings) {
    await client.companySettings.update({
      where: { id: settings.id },
      data: { leadRoundRobinCursor: (cursor + 1) % assignees.length },
    });
  }
  return assignee;
};

const buildLeadNote = ({ source, campaignId, productInterest }) => {
  const parts = [`Lead từ nguồn: ${source}`];
  if (campaignId) parts.push(`campaign: ${campaignId}`);
  if (productInterest) parts.push(`quan tâm: ${productInterest}`);
  return parts.join(" — ");
};

/**
 * Xử lý lead — idempotent theo (phone, tenantId) và (Idempotency-Key, tenantId).
 *
 * Idempotency-Key (header webhook, tùy chọn):
 * - Hash sha256(`${tenantId}:${key}`) → lưu trong IntegrationConfig
 *   (category LEAD_IDEMPOTENCY, TTL 24h) — KHÔNG cần migration bảng mới.
 * - Retry trong TTL → trả kết quả cũ kèm duplicate: true, KHÔNG tạo thêm record.
 * - Quá TTL → xử lý lại và upsert (reset TTL).
 *
 * QUAN TRỌNG: đây là PUBLIC webhook (không JWT) nên KHÔNG có tenant context sẵn.
 * Toàn bộ thao tác DB phải chạy trong runWithTenant(tenantId, ...) để Prisma
 * extension tự inject tenantId cho Customer/CustomerNote/Notification và để
 * pickAssignee() chỉ đọc User/CompanySettings của ĐÚNG tenant nhận lead.
 */
const captureLead = async (tenantId, payload, idempotencyKey = null) => {
  if (!tenantId) throw { status: 401, message: "Thiếu tenant nhận lead" };

  // Key không hợp lệ (quá dài/không phải string) → bỏ qua, vẫn xử lý bình thường
  const hasIdemKey =
    typeof idempotencyKey === "string" && idempotencyKey.length >= 8 && idempotencyKey.length <= 200;
  const idemRowKey = hasIdemKey
    ? `${IDEM_PREFIX}${crypto.createHash("sha256").update(`${tenantId}:${idempotencyKey}`).digest("hex")}`
    : null;

  if (idemRowKey) {
    const existing = await prisma.integrationConfig
      .findUnique({ where: { key: idemRowKey }, select: { valueEnc: true, createdAt: true } })
      .catch(() => null);
    const isFresh =
      existing &&
      Date.now() - new Date(existing.createdAt).getTime() < IDEM_TTL_MS;
    if (isFresh && existing.valueEnc) {
      try {
        return { ...JSON.parse(existing.valueEnc), duplicate: true };
      } catch {
        // valueEnc hỏng → xử lý lại bình thường
      }
    }
  }

  const result = await runWithTenant(tenantId, () => captureLeadInTenant(payload));

  if (idemRowKey) {
    // Best-effort: không block response nếu lưu idempotency fail
    await prisma.integrationConfig
      .upsert({
        where: { key: idemRowKey },
        create: {
          key: idemRowKey,
          category: "LEAD_IDEMPOTENCY",
          valueEnc: JSON.stringify(result),
          isSecret: false,
          tenantId,
        },
        update: {
          valueEnc: JSON.stringify(result),
          createdAt: new Date(), // reset TTL 24h
        },
      })
      .catch((e) => logger.warn("[lead-capture] idempotency save failed:", e.message));
  }

  return result;
};

const captureLeadInTenant = async ({ source, fullName, phone, email, productInterest, campaignId }) => {
  const assignee = await pickAssignee();
  const noteContent = buildLeadNote({ source, campaignId, productInterest });

  // Trong tenant context, Prisma extension đã auto-inject tenantId cho mọi query
  // tương ứng — không truyền tenantId thủ công vào where (tránh lỗi field không tồn tại).
  const existing = await prisma.customer.findFirst({
    where: { phone },
    select: { id: true, name: true },
  });

  let customer;
  let isNew = false;
  if (existing) {
    customer = existing;
    await prisma.customerNote.create({
      data: {
        customerId: customer.id,
        content: noteContent,
        type: "NOTE",
        createdById: assignee.id,
      },
    });
  } else {
    customer = await prisma.customer.create({
      data: {
        name: fullName,
        phone,
        email: email || null,
        leadStatus: "NEW",
        referralSource: source,
        notes: {
          create: { content: noteContent, type: "NOTE", createdById: assignee.id },
        },
      },
      select: { id: true, name: true },
    });
    isNew = true;
  }

  await notificationService
    .createOne({
      type: "SYSTEM",
      title: isNew ? "Lead mới từ webhook" : "Lead trùng khách hàng hiện có",
      message: `${fullName} (${phone}) — ${noteContent}`,
      link: `/customers?phone=${encodeURIComponent(phone)}`,
      meta: { customerId: customer.id, source, campaignId: campaignId || null },
      userId: assignee.id,
    })
    .catch((e) => logger.error("[lead-capture] notification failed:", e.message));

  return { customerId: customer.id, isNew, assignedToId: assignee.id };
};

module.exports = { generateApiKey, listApiKey, resolveTenant, captureLead, KEY_PREFIX, maskKey };
