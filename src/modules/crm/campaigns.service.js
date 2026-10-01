/**
 * modules/crm/campaigns.service.js — Service chiến dịch marketing
 * 
 * Tổng quan:
 * - Quản lý chiến dịch gửi tin marketing đến khách hàng (EMAIL, ZALO).
 * - Hỗ trợ luồng: DRAFT → SCHEDULED → SENDING → SENT (hoặc FAILED).
 * - Tích hợp segment để chọn đối tượng nhận, template rendering, gửi batch.
 * - Có cron job để xử lý campaign đã lên lịch.
 * 
 * Hàm:
 * - list(filters, user): Danh sách campaign; SUPER_OMEGA_ULTRA_ADMIN thấy adminCampaign.
 * - getById(id, user): Chi tiết campaign theo role.
 * - listRecipients(campaignId, {page, limit, status}): Danh sách người nhận có phân trang.
 * - create(data, userId): Tạo campaign mới (DRAFT hoặc SCHEDULED nếu có scheduledAt).
 * - update(id, data, userId): Cập nhật campaign; không cho sửa khi đang SENDING hoặc SENT.
 * - remove(id, userId): Xóa campaign; không xóa được khi đang SENDING.
* - executeCampaign(campaignId): Lõi thực thi gửi: đánh dấu SENDING, lấy danh sách KH từ segment,
*   tạo recipient rows, gửi theo batch (50 part/s, 1s delay), cập nhật trạng thái.
*   Phase 4: bỏ qua recipient đã từ chối (`unsubscribedAt`), sinh 2 token mỗi recipient,
*   bọc link đo click + gắn pixel mở mail + link từ chối + header List-Unsubscribe.
* - getStats(campaignId): Số liệu funnel (SENT/OPEN/CLICK/UNSUBSCRIBE + tỉ lệ).
* - sendNow(id, userId): Gửi campaign ngay lập tức (wrapper executeCampaign + audit).
* - cronProcessScheduled(): Cron quét campaign SCHEDULED đến hạn, gọi executeCampaign.
 */
// src/modules/crm/campaigns.service.js
const prisma = require("../../config/prisma");
const auditService = require("../audit/audit.service");
const segmentsService = require("./segments.service");
const trackingService = require("./campaign-tracking.service");
const { render, customerVars } = require("../../utils/template");
const { sendEmail } = require("../../utils/email");
const { sendZaloMessage } = require("../../utils/zalo");
const logger = require('../../utils/logger');

const BATCH_SIZE = 50;
const BATCH_DELAY_MS = 1000;

const CAMPAIGN_SELECT = {
  id: true,
  name: true,
  channel: true,
  segmentId: true,
  subject: true,
  bodyTemplate: true,
  status: true,
  scheduledAt: true,
  sentAt: true,
  stats: true,
  createdAt: true,
  updatedAt: true,
  segment: { select: { id: true, name: true, customerCount: true } },
  createdBy: { select: { id: true, fullName: true } },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Bọc link để đo lượt bấm. Chỉ bám thẻ <a href="..."> và bỏ qua:
//  - thẻ neo nội bộ (#...) hoặc mailto:/tel:
//  - link đã trỏ về chính endpoint tracking (tránh bọc lặp khi re-run)
// `text` của mail là bản rút gọn, KHÔNG bọc — nếu không, text hiện link tracking
// dài ngoằng cho người đọc bằng client thường.
const ANCHOR_RE = /<a\s+[^>]*href\s*=\s*(["'])(.*?)\1/gi;
const UNTRACKED_SCHEME_RE = /^(?:#|mailto:|tel:|javascript:|data:)/i;
const SELF_TRACKING_RE = /\/api\/crm\/track\//i;

const isTrackableHref = (href) => {
  const value = String(href || "").trim();
  if (!value) return false;
  if (UNTRACKED_SCHEME_RE.test(value)) return false;
  if (SELF_TRACKING_RE.test(value)) return false;
  return Boolean(trackingService.safeRedirectUrl(value));
};

const rewriteLinksForTracking = (htmlBody, token) =>
  String(htmlBody).replace(ANCHOR_RE, (match, quote, href) => {
    if (!isTrackableHref(href)) return match;
    const wrapped = trackingService.clickUrl(token, String(href).trim());
    // Giữ nguyên dấu quote gốc để không phá attribute đã escape
    return match.replace(`${quote}${href}${quote}`, `${quote}${wrapped}${quote}`);
  });

// Pixel 1x1 cuối body + link từ chối (chỉ kênh EMAIL mới có pixel)
const buildEmailHtml = (bodyHtml, token) => {
  const unsubscribe = trackingService.unsubscribeUrl(token);
  const footer = `
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0 12px">
  <p style="font-size:12px;color:#6b7280;line-height:1.6;margin:0">
    Bạn nhận email này vì đã đăng ký nhận tin từ chúng tôi.<br>
    <a href="${unsubscribe}" style="color:#6b7280">Ngừng nhận tin</a>
  </p>
  <img src="${trackingService.openPixelUrl(token)}" width="1" height="1" alt=""
       style="display:block;width:1px;height:1px;border:0" referrerpolicy="no-referrer">`;
  return rewriteLinksForTracking(bodyHtml, token) + footer;
};

// Link từ chối dạng chữ cho kênh ZALO (Zalo OA không render HTML/pixel)
const withUnsubscribeLink = (textBody, token) => {
  const unsubscribe = trackingService.unsubscribeUrl(token);
  return `${textBody}\n\n---\nNgừng nhận tin: ${unsubscribe}`;
};

// Header List-Unsubscribe (RFC 8058) — cho phép mail client hiện nút "Unsubscribe"
// ngay trên header, không cần mở nội dung. Bắt buộc về mặt thực tiễn cho
// uy tín gửi (Gmail/Yahoo chặn nhà gửi không có cơ chế hủy).
const listUnsubscribeHeaders = (token) => {
  const url = trackingService.unsubscribeUrl(token);
  return {
    "List-Unsubscribe": `<${url}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
};

const list = async (filters = {}, user) => {
  if (user?.role === "SUPER_OMEGA_ULTRA_ADMIN") {
    const where = {};
    if (filters.status) where.status = filters.status;
    return prisma.adminCampaign.findMany({
      where,
      select: {
        id: true,
        name: true,
        channel: true,
        targetPlans: true,
        subject: true,
        content: true,
        status: true,
        sentCount: true,
        scheduledAt: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { recipients: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
  }

  const where = {};
  if (filters.status) where.status = filters.status;
  if (user?.tenantId) where.createdBy = { tenantId: user.tenantId };
  return prisma.customerCampaign.findMany({
    where,
    select: CAMPAIGN_SELECT,
    orderBy: { createdAt: "desc" },
    take: 200,
  });
};

const getById = async (id, user) => {
  if (user?.role === "SUPER_OMEGA_ULTRA_ADMIN") {
    const c = await prisma.adminCampaign.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        channel: true,
        targetPlans: true,
        subject: true,
        content: true,
        status: true,
        sentCount: true,
        scheduledAt: true,
        createdAt: true,
        updatedAt: true,
        recipients: { orderBy: { createdAt: "desc" }, take: 50 },
      },
    });
    if (!c) {
      const err = new Error("Chiến dịch không tồn tại");
      err.status = 404;
      throw err;
    }
    return c;
  }

  const c = await prisma.customerCampaign.findUnique({
    where: { id },
    select: CAMPAIGN_SELECT,
  });
  if (!c) {
    const err = new Error("Chiến dịch không tồn tại");
    err.status = 404;
    throw err;
  }
  return c;
};

const listRecipients = async (campaignId, { page = 1, limit = 50, status } = {}) => {
  const p = Math.max(1, Number(page) || 1);
  const l = Math.max(1, Number(limit) || 50);
  const where = { campaignId };
  if (status) where.status = status;

  const [items, total] = await Promise.all([
    prisma.campaignRecipient.findMany({
      where,
      select: {
        id: true,
        status: true,
        error: true,
        sentAt: true,
        customer: { select: { id: true, name: true, phone: true, email: true } },
      },
      orderBy: [{ status: "asc" }, { sentAt: "desc" }],
      skip: (p - 1) * l,
      take: l,
    }),
    prisma.campaignRecipient.count({ where }),
  ]);
  return {
    recipients: items,
    pagination: { page: p, limit: l, total, totalPages: Math.ceil(total / l) },
  };
};

const create = async (data, userId) => {
  // segment phải tồn tại
  const seg = await prisma.customerSegment.findUnique({ where: { id: data.segmentId } });
  if (!seg) {
    const err = new Error("Segment không tồn tại");
    err.status = 400;
    throw err;
  }

  const campaign = await prisma.customerCampaign.create({
    data: {
      name: data.name,
      channel: data.channel,
      segmentId: data.segmentId,
      subject: data.subject || null,
      bodyTemplate: data.bodyTemplate,
      status: data.scheduledAt ? "SCHEDULED" : "DRAFT",
      scheduledAt: data.scheduledAt ? new Date(data.scheduledAt) : null,
      createdById: userId,
    },
    select: CAMPAIGN_SELECT,
  });

  await auditService.log({
    userId,
    action: "CREATE_CAMPAIGN",
    entity: "CustomerCampaign",
    entityId: campaign.id,
    after: { name: campaign.name, channel: campaign.channel, status: campaign.status },
  });

  return campaign;
};

const update = async (id, data, userId) => {
  const before = await prisma.customerCampaign.findUnique({ where: { id } });
  if (!before) {
    const err = new Error("Chiến dịch không tồn tại");
    err.status = 404;
    throw err;
  }
  if (["SENDING", "SENT"].includes(before.status)) {
    const err = new Error("Không thể sửa chiến dịch đã gửi");
    err.status = 400;
    throw err;
  }

  const patch = {};
  if (data.name !== undefined) patch.name = data.name;
  if (data.channel !== undefined) patch.channel = data.channel;
  if (data.segmentId !== undefined) patch.segmentId = data.segmentId;
  if (data.subject !== undefined) patch.subject = data.subject;
  if (data.bodyTemplate !== undefined) patch.bodyTemplate = data.bodyTemplate;
  if (data.scheduledAt !== undefined) {
    patch.scheduledAt = data.scheduledAt ? new Date(data.scheduledAt) : null;
    patch.status = data.scheduledAt ? "SCHEDULED" : "DRAFT";
  }

  const updated = await prisma.customerCampaign.update({
    where: { id },
    data: patch,
    select: CAMPAIGN_SELECT,
  });

  await auditService.log({
    userId,
    action: "UPDATE_CAMPAIGN",
    entity: "CustomerCampaign",
    entityId: id,
    before: { name: before.name, status: before.status },
    after: { name: updated.name, status: updated.status },
  });
  return updated;
};

const remove = async (id, userId) => {
  const c = await prisma.customerCampaign.findUnique({ where: { id } });
  if (!c) {
    const err = new Error("Chiến dịch không tồn tại");
    err.status = 404;
    throw err;
  }
  if (c.status === "SENDING") {
    const err = new Error("Đang gửi, không thể xóa");
    err.status = 400;
    throw err;
  }
  await prisma.customerCampaign.delete({ where: { id } });
  await auditService.log({
    userId,
    action: "DELETE_CAMPAIGN",
    entity: "CustomerCampaign",
    entityId: id,
    before: { name: c.name },
  });
  return { id };
};

// Lõi thực thi gửi: cố ý là 1 hàm để cron + send-now dùng chung.
const executeCampaign = async (campaignId) => {
  const campaign = await prisma.customerCampaign.findUnique({
    where: { id: campaignId },
    include: { segment: true },
  });
  if (!campaign) throw new Error("Chiến dịch không tồn tại");
  if (campaign.status === "SENDING") throw new Error("Chiến dịch đang gửi");
  if (campaign.status === "SENT") throw new Error("Đã gửi xong rồi");

  // Đánh dấu SENDING
  await prisma.customerCampaign.update({
    where: { id: campaignId },
    data: { status: "SENDING" },
  });

  // Lấy danh sách KH match
  const { customers } = await segmentsService.evaluateSegment(campaign.segment.rules);

  // Tạo recipient rows nếu chưa có
  const existing = await prisma.campaignRecipient.findMany({
    where: { campaignId },
    select: { customerId: true },
  });
  const existingIds = new Set(existing.map((r) => r.customerId));
  const toCreate = customers.filter((c) => !existingIds.has(c.id));
  if (toCreate.length) {
    // Nghị định 13/2023 — chặn THEO KÊNH, không theo chiến dịch.
    // Khách đã bấm "từ chối" ở một chiến dịch trước vẫn phải bị chặn ở chiến dịch
    // NÀY. Recipient mới tạo có `unsubscribedAt = NULL` nên chỉ lọc theo bản ghi
    // recipient là không đủ — phải hỏi thẳng lịch sử từ chối của khách trên
    // cùng kênh. Thiếu bước này thì khách đã opt-out vẫn nhận email (đã bị smoke
    // test `smoke-crm-phase4-send.js` bắt được, không phải unit test).
    const optedOutIds = new Set(
      (
        await prisma.campaignRecipient.findMany({
          where: {
            customerId: { in: toCreate.map((c) => c.id) },
            unsubscribedAt: { not: null },
            campaign: { channel: campaign.channel },
          },
          select: { customerId: true },
        })
      ).map((r) => r.customerId),
    );

    await prisma.campaignRecipient.createMany({
      data: toCreate.map((c) => ({
        campaignId,
        customerId: c.id,
        status: "PENDING",
        ...(optedOutIds.has(c.id) ? { unsubscribedAt: new Date() } : {}),
      })),
    });
  }

  const allRecipients = await prisma.campaignRecipient.findMany({
    where: { campaignId },
    select: { id: true, unsubscribedAt: true },
  });
  // Đã từ chối thì không được gửi tiếp. Lọc ở đây thay vì trong vòng lặp để số
  // liệu trả về phản ánh "còn lại bao nhiêu người nhận hợp lệ".
  const skippedUnsubscribed = allRecipients.filter((r) => r.unsubscribedAt).length;
  const allowedIds = allRecipients.filter((r) => !r.unsubscribedAt).map((r) => r.id);

  const pending = await prisma.campaignRecipient.findMany({
    where: { campaignId, status: "PENDING", id: { in: allowedIds } },
    include: {
      customer: {
        select: {
          id: true,
          name: true,
          phone: true,
          email: true,
          zaloUserId: true,
          tier: true,
          loyaltyPoints: true,
          totalSpent: true,
        },
      },
    },
  });

  let sent = 0;
  let failed = 0;

  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    const batch = pending.slice(i, i + BATCH_SIZE);

    await Promise.all(
      batch.map(async (r) => {
        try {
          // Chốt trạng thái từ chối NGAY TRƯỚC lúc gửi. Lọc ở query phía trên không
          // đủ: campaign chạy batch 50/lần với 1s delay, người nhận có thể bấm
          // "từ chối" giữa chừng. `ensureTokens` vốn đã đọc dòng recipient nên tái
          // dùng chính lần đọc đó — không tốn query thêm.
          const fresh = await trackingService.ensureTokens(r.id, {
            tracking: campaign.channel === "EMAIL",
          });
          if (fresh?.unsubscribedAt) {
            throw Object.assign(new Error("Người nhận đã từ chối nhận tin"), {
              code: "UNSUBSCRIBED",
            });
          }
          if (!fresh?.unsubscribeToken) throw new Error("Không tạo được token từ chối");

          const vars = customerVars(r.customer);
          const body = render(campaign.bodyTemplate, vars);
          const subject = campaign.subject ? render(campaign.subject, vars) : null;

          if (campaign.channel === "EMAIL") {
            if (!r.customer.email) throw new Error("Khách hàng không có email");
            const tok = fresh;
            const htmlBody = buildEmailHtml(body, tok.unsubscribeToken);
            await sendEmail({
              to: r.customer.email,
              subject,
              // `text` giữ bản gốc (chưa bọc link + chưa gắn footer tracking)
              text: withUnsubscribeLink(body, tok.unsubscribeToken),
              html: htmlBody,
              headers: listUnsubscribeHeaders(tok.unsubscribeToken),
            });
            await trackingService.recordSent(r.id);
          } else if (campaign.channel === "ZALO") {
            // Zalo OA cần zaloUserId (user_id của tài khoản Zalo) — đã có field
            // `Customer.zaloUserId` (thêm ở CRM Pipeline Phase 1). Vẫn fallback về
            // SĐT cho khách chưa nhập, vì nhiều khách dùng SĐT làm user_id.
            const zaloUserId = r.customer.zaloUserId || r.customer.phone;
            if (!zaloUserId) throw new Error("Không có Zalo userId");
            await sendZaloMessage({
              userId: zaloUserId,
              text: withUnsubscribeLink(body, fresh.unsubscribeToken),
            });
            await trackingService.recordSent(r.id);
          } else {
            throw new Error(`Channel không hỗ trợ: ${campaign.channel}`);
          }

          await prisma.campaignRecipient.update({
            where: { id: r.id },
            data: { status: "SENT", sentAt: new Date(), error: null },
          });
          sent += 1;
        } catch (err) {
          await prisma.campaignRecipient.update({
            where: { id: r.id },
            data: {
              status: "FAILED",
              error: (err && err.message ? err.message : String(err)).slice(0, 500),
            },
          });
          failed += 1;
        }
      }),
    );

    if (i + BATCH_SIZE < pending.length) {
      await sleep(BATCH_DELAY_MS);
    }
  }

  const totalSent = await prisma.campaignRecipient.count({ where: { campaignId, status: "SENT" } });
  const totalFailed = await prisma.campaignRecipient.count({ where: { campaignId, status: "FAILED" } });
  const totalRecipients = await prisma.campaignRecipient.count({ where: { campaignId } });

  const finalStatus = totalFailed > 0 && totalSent === 0 ? "FAILED" : "SENT";

  await prisma.customerCampaign.update({
    where: { id: campaignId },
    data: {
      status: finalStatus,
      sentAt: new Date(),
      stats: {
        total: totalRecipients,
        sent: totalSent,
        failed: totalFailed,
        skippedUnsubscribed,
      },
    },
  });

  return { total: totalRecipients, sent: totalSent, failed: totalFailed, skippedUnsubscribed };
};

const getStats = async (campaignId) => {
  const exists = await prisma.customerCampaign.findUnique({
    where: { id: campaignId },
    select: { id: true },
  });
  if (!exists) {
    const err = new Error("Chiến dịch không tồn tại");
    err.status = 404;
    throw err;
  }
  return trackingService.getStats(campaignId);
};

const sendNow = async (id, userId) => {
  await auditService.log({
    userId,
    action: "SEND_CAMPAIGN_NOW",
    entity: "CustomerCampaign",
    entityId: id,
  });
  return executeCampaign(id);
};

// Cron: quét campaigns SCHEDULED đến hạn → gửi
const cronProcessScheduled = async () => {
  const now = new Date();
  const due = await prisma.customerCampaign.findMany({
    where: {
      status: "SCHEDULED",
      scheduledAt: { lte: now },
    },
    select: { id: true },
    take: 10,
  });
  let processed = 0;
  for (const c of due) {
    try {
      await executeCampaign(c.id);
      processed += 1;
    } catch (e) {
      logger.error("[cron] campaign", c.id, e.message);
      // Đặt FAILED để không retry vô tận
      await prisma.customerCampaign.update({
        where: { id: c.id },
        data: { status: "FAILED" },
      }).catch(() => null);
    }
  }
  return processed;
};

module.exports = {
  list,
  getById,
  listRecipients,
  create,
  update,
  remove,
  sendNow,
  getStats,
  executeCampaign,
  cronProcessScheduled,
  // Nội bộ — test dùng để kiểm chứng việc bọc link/footer không cần gửi mail thật
  __internals: { rewriteLinksForTracking, buildEmailHtml, withUnsubscribeLink, listUnsubscribeHeaders, isTrackableHref },
};
