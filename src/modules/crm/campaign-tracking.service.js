/**
 * modules/crm/campaign-tracking.service.js — Theo dõi + tuân thủ chiến dịch (CRM Phase 4)
 *
 * Tổng quan:
 * - Trước Phase 4, `CampaignTracking` tồn tại trong schema nhưng **0 usage**: `campaignId`
 *   là String trần không FK, `recipientId` trỏ nhầm `Customer`, `event` là String tự do.
 *   Không có service/route nào ghi vào. Phase 4 nối nó vào luồng gửi thật.
 * - Mỗi `CampaignRecipient` sinh 2 token NGẪU NHIÊN lúc gửi (không chứa PII, không đoán được):
 *     · unsubscribeToken → link "từ chối nhận tin" + header `List-Unsubscribe`
 *     · trackingToken    → pixel đo mở mail (OPEN) + link bấm (CLICK)
 *   Tách riêng 2 token để link tracking không vô tình thành link từ chối (và ngược lại):
 *   ai đó mở tracking pixel không được vô tình hủy đăng ký.
 * - Token KHÔNG suy ra từ `id`/`email`/`phone` — nếu dùng `id` thì kẻ xấu đoán uuid để
 *   hủy đăng ký người khác. `crypto.randomBytes(24)` = 192 bit.
 *
 * Quyết định ngữ nghĩa quan trọng — unsubscribe là THEO KÊNH, không theo chiến dịch:
 * `unsubscribedAt` nằm trên `CampaignRecipient` (hợp đồng schema đã chốt ở plan), nhưng
 * khi khách từ chối 1 lần ta đánh dấu **mọi** recipient chưa gửi của cùng khách trên
 * cùng kênh. Nếu chỉ chặn đúng chiến dịch đó thì chiến dịch thứ hai vẫn gửi tiếp →
 * vi phạm Nghị định 13/2023. Xem `applyUnsubscribe`.
 *
 * Hàm:
 * - generateToken(): sinh token ngẫu nhiên base64url (24 byte)
 * - baseUrl()/publicUrl(): gốc URL công khai để dựng link trong email
 * - ensureTokens(recipientId, {tracking}): bảo đảm recipient có token (idempotent).
 *   Trả kèm `unsubscribedAt` — caller dùng để chốt trạng thái từ chối ngay trước lúc
 *   gửi (xem campaigns.service.js executeCampaign).
 * - trackOpen(token, meta): ghi 1 OPEN, chỉ lần đầu
 * - trackClick(token, targetUrl, meta): ghi CLICK + trả URL đích đã kiểm tra an toàn
 * - getUnsubscribePreview(token): dữ liệu cho trang xác nhận từ chối
 * - applyUnsubscribe(token, reason): thực thi từ chối (chặn toàn kênh) + ghi sự kiện
 * - recordSent(recipientId, meta): ghi sự kiện SENT sau khi gửi thành công
 * - getStats(campaignId): tổng hợp SENT/OPEN/CLICK/UNSUBSCRIBE cho dashboard
 *
 * Ghi chú tenant: mọi query đi qua `prisma` đã extend ở `config/prisma.js` nên
 * `CampaignRecipient`/`CampaignTracking`/`CustomerCampaign` tự được auto-scope theo
 * `tenantId` trong request. Endpoint public không có tenant context (không đăng nhập)
 * → phải tự xác thực bằng token, xem `resolveByToken`.
 */
const crypto = require("crypto");
const prisma = require("../../config/prisma");
const logger = require("../../utils/logger");

// Ngữ cảnh bảo mật: URL đích của link bấm do tenant tự soạn trong bodyTemplate,
// không phải input của người gọi API. Vẫn chặn scheme nguy hiểm (javascript:, data:)
// vì endpoint này không cần auth.
const MAX_REDIRECT_LEN = 2048;
const SAFE_SCHEMES = new Set(["http:", "https:"]);

/** Token 24 byte → 32 ký tự base64url. Không chứa PII, không suy ra được. */
const generateToken = () => crypto.randomBytes(24).toString("base64url");

/**
 * Gốc URL công khai.
 * - TRACKING_BASE_URL: ghi đè tường minh khi backend có domain riêng.
 * - CLIENT_URL: đúng trong cả 2 mô hình triển khai của repo — Vite dev proxy và
 *   nginx prod đều để /api của frontend trỏ về backend, nên link sinh từ CLIENT_URL
 *   vẫn chạy tới đúng endpoint.
 */
const baseUrl = () =>
  String(process.env.TRACKING_BASE_URL || process.env.CLIENT_URL || "http://localhost:5173").replace(
    /\/+$/,
    "",
  );

const publicUrl = (suffix) => `${baseUrl()}/api/crm/track/${suffix}`;

const unsubscribeUrl = (token) => publicUrl(`unsubscribe/${encodeURIComponent(token)}`);
const openPixelUrl = (token) => publicUrl(`open/${encodeURIComponent(token)}.gif`);
const clickUrl = (token, target) =>
  publicUrl(`click/${encodeURIComponent(token)}?url=${encodeURIComponent(target)}`);

/**
 * Chỉ cho phép http/https và giới hạn độ dài.
 * Trả về URL đã hợp lệ hoặc null.
 */
const safeRedirectUrl = (raw) => {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value || value.length > MAX_REDIRECT_LEN) return null;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (!SAFE_SCHEMES.has(parsed.protocol)) return null;
  return parsed.toString();
};

const RECIPIENT_BY_TOKEN_SELECT = {
  id: true,
  campaignId: true,
  customerId: true,
  unsubscribedAt: true,
  unsubscribeToken: true,
  trackingToken: true,
  campaign: { select: { id: true, name: true, channel: true } },
};

const resolveByToken = (token, field) => {
  if (!token || typeof token !== "string") return null;
  return prisma.campaignRecipient.findFirst({
    where: { [field]: token },
    select: RECIPIENT_BY_TOKEN_SELECT,
  });
};

/**
 * Bảo đảm recipient có đủ token mà không phá token cũ.
 * Idempotent: chạy lại (cron retry, re-run campaign) vẫn trả token cũ.
 * @returns recipient có token, hoặc null nếu recipient không tồn tại
 */
const ensureTokens = async (recipientId, { tracking = false } = {}) => {
  const SELECT = {
    id: true,
    unsubscribedAt: true,
    unsubscribeToken: true,
    trackingToken: true,
  };
  const current = await prisma.campaignRecipient.findUnique({
    where: { id: recipientId },
    select: SELECT,
  });
  if (!current) return null;

  const patch = {};
  if (!current.unsubscribeToken) patch.unsubscribeToken = generateToken();
  if (tracking && !current.trackingToken) patch.trackingToken = generateToken();
  if (Object.keys(patch).length === 0) return current;

  return prisma.campaignRecipient.update({
    where: { id: recipientId },
    data: patch,
    select: SELECT,
  });
};

/** Ghi 1 sự kiện tracking. Lỗi DB KHÔNG được làm hỏng luồng gửi → nuốt + log. */
const recordEvent = async ({ campaignId, recipientId = null, event, metadata }) => {
  try {
    await prisma.campaignTracking.create({
      data: {
        campaignId,
        recipientId,
        event,
        metadata: metadata || undefined,
      },
    });
    return true;
  } catch (err) {
    logger.error(`[crm:track] ghi sự kiện ${event} thất bại`, err.message);
    return false;
  }
};

/** Sau khi gửi thành công 1 recipient thì ghi SENT. */
const recordSent = async (recipientId, metadata) => {
  const recipient = await prisma.campaignRecipient.findUnique({
    where: { id: recipientId },
    select: { id: true, campaignId: true },
  });
  if (!recipient) return false;
  return recordEvent({
    campaignId: recipient.campaignId,
    recipientId: recipient.id,
    event: "SENT",
    metadata,
  });
};

/**
 * Đo mở mail. Chỉ tính lần đầu cho mỗi recipient — nếu ghi mọi lần thì
 * người nhận tải ảnh chặn nhiều lần sẽ làm phồng tỉ lệ mở.
 * @returns true nếu đây là lần mở đầu tiên được ghi nhận
 */
const trackOpen = async (token, metadata) => {
  const recipient = await resolveByToken(token, "trackingToken");
  if (!recipient) return false;

  const already = await prisma.campaignTracking.findFirst({
    where: { recipientId: recipient.id, event: "OPEN" },
    select: { id: true },
  });
  if (already) return false;

  return recordEvent({
    campaignId: recipient.campaignId,
    recipientId: recipient.id,
    event: "OPEN",
    metadata,
  });
};

/**
 * Đo bấm link. URL đích do người nhận click, phải qua `safeRedirectUrl`
 * trước khi redirect (chặn open-redirect javascript:/data:).
 * @returns {{ ok, url? }} — ok=false nghĩa là token sai hoặc URL đích không an toàn
 */
const trackClick = async (token, targetUrl, metadata) => {
  const recipient = await resolveByToken(token, "trackingToken");
  if (!recipient) return { ok: false, reason: "TOKEN_INVALID" };

  const safe = safeRedirectUrl(targetUrl);
  if (!safe) return { ok: false, reason: "URL_UNSAFE" };

  await recordEvent({
    campaignId: recipient.campaignId,
    recipientId: recipient.id,
    event: "CLICK",
    metadata: { ...(metadata || {}), url: safe },
  });
  return { ok: true, url: safe };
};

/** Dữ liệu cho trang "Bạn có chắc muốn từ chối?" — không thay đổi state. */
const getUnsubscribePreview = async (token) => {
  const recipient = await resolveByToken(token, "unsubscribeToken");
  if (!recipient) return { found: false };
  return {
    found: true,
    alreadyUnsubscribed: Boolean(recipient.unsubscribedAt),
    campaignName: recipient.campaign?.name || null,
    channel: recipient.campaign?.channel || null,
    unsubscribedAt: recipient.unsubscribedAt,
  };
};

/**
 * Thực thi từ chối.
 *
 * Cố ý chặn **toàn kênh** chứ không chỉ 1 chiến dịch: `unsubscribedAt` nằm trên
 * `CampaignRecipient` nhưng người nhận chỉ nói "thôi tôi không muốn nhận quảng cáo
 * nữa". Nếu chỉ chặn chiến dịch này thì lần gửi sau khách lại bị gửi tiếp.
 * `updateMany` chỉ chạm recipient `PENDING` (chưa gửi) → không sửa lịch sử
 * các chiến dịch đã gửi xong, giữ nguyên tính trung thực của báo cáo cũ.
 */
const applyUnsubscribe = async (token, reason) => {
  const recipient = await resolveByToken(token, "unsubscribeToken");
  if (!recipient) return { found: false };

  const cleanReason = typeof reason === "string" ? reason.trim().slice(0, 200) : null;
  const now = new Date();

  if (!recipient.unsubscribedAt) {
    await prisma.campaignRecipient.update({
      where: { id: recipient.id },
      data: { unsubscribedAt: now, unsubscribeReason: cleanReason || null },
    });

    // Chặn các chiến dịch khác trên cùng khách + cùng kênh chưa gửi tới.
    await prisma.campaignRecipient.updateMany({
      where: {
        customerId: recipient.customerId,
        status: "PENDING",
        unsubscribedAt: null,
        campaign: { channel: recipient.campaign?.channel },
      },
      data: { unsubscribedAt: now, unsubscribeReason: cleanReason || null },
    });

    await recordEvent({
      campaignId: recipient.campaignId,
      recipientId: recipient.id,
      event: "UNSUBSCRIBE",
      metadata: cleanReason ? { reason: cleanReason } : undefined,
    });
  }

  return {
    found: true,
    alreadyUnsubscribed: Boolean(recipient.unsubscribedAt),
    unsubscribedAt: recipient.unsubscribedAt || now,
    channel: recipient.campaign?.channel || null,
  };
};

/** Số liệu funnel cho dashboard chiến dịch. */
const getStats = async (campaignId) => {
  const [byEvent, byStatus, unsubscribed] = await Promise.all([
    prisma.campaignTracking.groupBy({
      by: ["event"],
      where: { campaignId },
      _count: { _all: true },
    }),
    prisma.campaignRecipient.groupBy({
      by: ["status"],
      where: { campaignId },
      _count: { _all: true },
    }),
    prisma.campaignRecipient.count({
      where: { campaignId, unsubscribedAt: { not: null } },
    }),
  ]);

  const events = { SENT: 0, OPEN: 0, CLICK: 0, BOUNCE: 0, UNSUBSCRIBE: 0 };
  for (const row of byEvent) events[row.event] = row._count._all;

  const recipients = { PENDING: 0, SENT: 0, FAILED: 0, BOUNCED: 0 };
  for (const row of byStatus) recipients[row.status] = row._count._all;

  const delivered = events.SENT || 0;
  return {
    events,
    recipients,
    unsubscribed,
    openRate: delivered > 0 ? events.OPEN / delivered : 0,
    clickRate: delivered > 0 ? events.CLICK / delivered : 0,
    clickToOpenRate: events.OPEN > 0 ? events.CLICK / events.OPEN : 0,
  };
};

module.exports = {
  generateToken,
  baseUrl,
  publicUrl,
  unsubscribeUrl,
  openPixelUrl,
  clickUrl,
  safeRedirectUrl,
  ensureTokens,
  recordEvent,
  recordSent,
  trackOpen,
  trackClick,
  getUnsubscribePreview,
  applyUnsubscribe,
  getStats,
};