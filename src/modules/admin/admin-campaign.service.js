/**
 * modules/admin/admin-campaign.service.js — Quản lý chiến dịch email/SMS
 * 
 * Tổng quan:
 * - CRUD chiến dịch gửi email/SMS đến admin của tenant theo gói dịch vụ
 * - Gửi hàng loạt theo batch (50/lần, delay 1s)
 * - Ghi audit cho mọi thao tác
 * 
 * Hàm:
 * - listCampaigns(filters): Danh sách chiến dịch, lọc theo status
 * - getCampaignById(id): Chi tiết chiến dịch kèm 50 recipients đầu
 * - listRecipients(campaignId, {page, limit, status}): Danh sách người nhận, phân trang
 * - createCampaign(data, userId): Tạo chiến dịch + audit
 * - updateCampaign(id, data, userId): Cập nhật chiến dịch + audit
 * - deleteCampaign(id, userId): Xoá chiến dịch (không cho xoá khi đang gửi) + audit
 * - sendCampaign(id, userId): Gửi chiến dịch theo batch, cập nhật trạng thái từng recipient, ghi audit
 */
const prisma = require("../../config/prisma");
const auditService = require("../audit/audit.service");
const { sendEmail } = require("../../utils/email");

const BATCH_SIZE = 50;
const BATCH_DELAY_MS = 1000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CAMPAIGN_SELECT = {
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
};

const listCampaigns = async (filters = {}) => {
  const where = {};
  if (filters.status) where.status = filters.status;
  return prisma.adminCampaign.findMany({
    where,
    select: CAMPAIGN_SELECT,
    orderBy: { createdAt: "desc" },
    take: 200,
  });
};

const getCampaignById = async (id) => {
  const campaign = await prisma.adminCampaign.findUnique({
    where: { id },
    select: { ...CAMPAIGN_SELECT, recipients: { orderBy: { createdAt: "desc" }, take: 50 } },
  });
  if (!campaign) throw { status: 404, message: "Không tìm thấy chiến dịch" };
  return campaign;
};

const listRecipients = async (campaignId, { page = 1, limit = 50, status } = {}) => {
  const p = Math.max(1, Number(page) || 1);
  const l = Math.max(1, Number(limit) || 50);
  const where = { campaignId };
  if (status) where.status = status;

  const [items, total] = await Promise.all([
    prisma.adminCampaignRecipient.findMany({
      where,
      select: { id: true, email: true, fullName: true, tenantName: true, status: true, error: true, sentAt: true },
      orderBy: [{ status: "asc" }, { sentAt: "desc" }],
      skip: (p - 1) * l,
      take: l,
    }),
    prisma.adminCampaignRecipient.count({ where }),
  ]);
  return {
    recipients: items,
    pagination: { page: p, limit: l, total, totalPages: Math.ceil(total / l) },
  };
};

const createCampaign = async (data, userId) => {
  const campaign = await prisma.adminCampaign.create({ data });

  auditService.log({
    userId,
    action: "CREATE_ADMIN_CAMPAIGN",
    entity: "AdminCampaign",
    entityId: campaign.id,
    after: { name: campaign.name, channel: campaign.channel, status: campaign.status },
  });

  return campaign;
};

const updateCampaign = async (id, data, userId) => {
  const before = await prisma.adminCampaign.findUnique({ where: { id } });
  const campaign = await prisma.adminCampaign.update({ where: { id }, data });

  auditService.log({
    userId,
    action: "UPDATE_ADMIN_CAMPAIGN",
    entity: "AdminCampaign",
    entityId: id,
    before: { name: before?.name, status: before?.status },
    after: { name: campaign.name, status: campaign.status },
  });

  return campaign;
};

const deleteCampaign = async (id, userId) => {
  const c = await prisma.adminCampaign.findUnique({ where: { id } });
  if (!c) throw { status: 404, message: "Không tìm thấy chiến dịch" };
  if (c.status === "SENDING") {
    throw { status: 400, message: "Đang gửi, không thể xóa" };
  }
  await prisma.adminCampaign.delete({ where: { id } });

  auditService.log({
    userId,
    action: "DELETE_ADMIN_CAMPAIGN",
    entity: "AdminCampaign",
    entityId: id,
    before: { name: c.name },
  });
};

const sendCampaign = async (id, userId) => {
  const campaign = await prisma.adminCampaign.findUnique({ where: { id } });
  if (!campaign) throw { status: 404, message: "Không tìm thấy chiến dịch" };
  if (campaign.status === "SENDING" || campaign.status === "DONE") {
    throw { status: 400, message: "Chiến dịch đã được gửi hoặc đang gửi" };
  }

  await prisma.adminCampaign.update({
    where: { id },
    data: { status: "SENDING" },
  });

  const targetPlans = campaign.targetPlans;
  const users = await prisma.user.findMany({
    where: {
      role: "ADMIN",
      tenantId: { not: null },
      isActive: true,
      tenant: {
        subscriptions: {
          some: {
            plan: { key: { in: targetPlans } },
            status: { in: ["ACTIVE", "TRIAL"] },
          },
        },
      },
    },
    select: { id: true, email: true, fullName: true, tenant: { select: { name: true } } },
  });

  // Tạo recipient rows
  const existing = await prisma.adminCampaignRecipient.findMany({
    where: { campaignId: id },
    select: { userId: true },
  });
  const existingIds = new Set(existing.map((r) => r.userId));
  const toCreate = users.filter((u) => !existingIds.has(u.id));
  if (toCreate.length) {
    await prisma.adminCampaignRecipient.createMany({
      data: toCreate.map((u) => ({
        campaignId: id,
        userId: u.id,
        email: u.email,
        fullName: u.fullName,
        tenantName: u.tenant?.name || null,
        status: "PENDING",
      })),
    });
  }

  const pending = await prisma.adminCampaignRecipient.findMany({
    where: { campaignId: id, status: "PENDING" },
  });

  let sent = 0;
  let failed = 0;

  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    const batch = pending.slice(i, i + BATCH_SIZE);

    await Promise.all(
      batch.map(async (r) => {
        try {
          await sendEmail({
            to: r.email,
            subject: campaign.subject,
            text: campaign.content,
            html: campaign.content,
          });

          await prisma.adminCampaignRecipient.update({
            where: { id: r.id },
            data: { status: "SENT", sentAt: new Date(), error: null },
          });
          sent += 1;
        } catch (err) {
          await prisma.adminCampaignRecipient.update({
            where: { id: r.id },
            data: {
              status: "FAILED",
              error: (err?.message || String(err)).slice(0, 500),
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

  const totalSent = await prisma.adminCampaignRecipient.count({ where: { campaignId: id, status: "SENT" } });
  const totalFailed = await prisma.adminCampaignRecipient.count({ where: { campaignId: id, status: "FAILED" } });
  const totalRecipients = await prisma.adminCampaignRecipient.count({ where: { campaignId: id } });

  await prisma.adminCampaign.update({
    where: { id },
    data: { status: "DONE", sentCount: totalSent },
  });

  auditService.log({
    userId,
    action: "SEND_ADMIN_CAMPAIGN",
    entity: "AdminCampaign",
    entityId: id,
    after: { name: campaign.name, sentCount: totalSent, failedCount: totalFailed, totalTargets: totalRecipients },
  });

  return { total: totalRecipients, sent: totalSent, failed: totalFailed };
};

module.exports = { listCampaigns, getCampaignById, listRecipients, createCampaign, updateCampaign, deleteCampaign, sendCampaign };
