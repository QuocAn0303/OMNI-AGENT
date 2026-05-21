// src/modules/crm/campaigns.service.js
const prisma = require("../../config/prisma");
const auditService = require("../audit/audit.service");
const segmentsService = require("./segments.service");
const { render, customerVars } = require("../../utils/template");
const { sendEmail } = require("../../utils/email");
const { sendZaloMessage } = require("../../utils/zalo");

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

const list = async ({ status } = {}) => {
  const where = {};
  if (status) where.status = status;
  return prisma.customerCampaign.findMany({
    where,
    select: CAMPAIGN_SELECT,
    orderBy: { createdAt: "desc" },
    take: 200,
  });
};

const getById = async (id) => {
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

  auditService.log({
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

  auditService.log({
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
  auditService.log({
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
    await prisma.campaignRecipient.createMany({
      data: toCreate.map((c) => ({ campaignId, customerId: c.id, status: "PENDING" })),
    });
  }

  const pending = await prisma.campaignRecipient.findMany({
    where: { campaignId, status: "PENDING" },
    include: {
      customer: {
        select: {
          id: true,
          name: true,
          phone: true,
          email: true,
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
          const vars = customerVars(r.customer);
          const body = render(campaign.bodyTemplate, vars);
          const subject = campaign.subject ? render(campaign.subject, vars) : null;

          if (campaign.channel === "EMAIL") {
            if (!r.customer.email) throw new Error("Khách hàng không có email");
            await sendEmail({ to: r.customer.email, subject, text: body, html: body });
          } else if (campaign.channel === "ZALO") {
            // Lưu ý: cần Zalo user_id của khách hàng - hiện chưa có field này
            // trong Customer model. Để demo, dùng phone làm placeholder.
            // Trong thực tế cần thêm field customer.zaloUserId.
            const zaloUserId = r.customer.phone;
            if (!zaloUserId) throw new Error("Không có Zalo userId");
            await sendZaloMessage({ userId: zaloUserId, text: body });
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
      stats: { total: totalRecipients, sent: totalSent, failed: totalFailed },
    },
  });

  return { total: totalRecipients, sent: totalSent, failed: totalFailed };
};

const sendNow = async (id, userId) => {
  auditService.log({
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
      console.error("[cron] campaign", c.id, e.message);
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
  executeCampaign,
  cronProcessScheduled,
};
