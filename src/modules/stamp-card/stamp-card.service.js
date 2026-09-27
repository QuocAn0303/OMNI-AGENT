/**
 * modules/stamp-card/stamp-card.service.js — Thẻ tích stamp F&B (mua 10 tặng 1)
 *
 * - CRUD StampCardTemplate
 * - earnStamp(customerId) → +1 stamp, đầy → redeem tự động
 * - redeem(stampCardId) → tạo order reward
 */
const prisma = require('../../config/prisma');
const auditService = require('../audit/audit.service');

async function listTemplates() {
  return prisma.stampCardTemplate.findMany({ where: { isActive: true }, include: { _count: { select: { stampCards: true } } } });
}

async function createTemplate(data, userId = null) {
  const template = await prisma.stampCardTemplate.create({ data });
  auditService.log({ userId, action: 'CREATE_STAMP_TEMPLATE', entity: 'StampCardTemplate', entityId: template.id, after: { name: data.name, totalStamps: data.totalStamps } });
  return template;
}

async function updateTemplate(id, data, userId = null) {
  const template = await prisma.stampCardTemplate.update({ where: { id }, data });
  auditService.log({ userId, action: 'UPDATE_STAMP_TEMPLATE', entity: 'StampCardTemplate', entityId: id, after: { name: template.name } });
  return template;
}

async function getCustomerCards(customerId) {
  return prisma.stampCard.findMany({
    where: { customerId },
    include: { template: true },
    orderBy: { createdAt: 'desc' },
  });
}

// +1 stamp khi khách mua món thuộc template (gọi sau Order COMPLETED)
async function earnStamp(customerId, templateId, userId = null) {
  let card = await prisma.stampCard.findFirst({
    where: { customerId, templateId, redeemedAt: null },
  });
  if (!card) {
    const tpl = await prisma.stampCardTemplate.findUnique({ where: { id: templateId } });
    if (!tpl) return null;
    card = await prisma.stampCard.create({
      data: {
        customerId,
        templateId,
        totalStamps: tpl.totalStamps,
        rewardProductId: tpl.rewardProductId,
      },
    });
  }
  if (card.stamps >= card.totalStamps) return card; // đã đầy, chờ redeem

  const updated = await prisma.stampCard.update({
    where: { id: card.id },
    data: { stamps: { increment: 1 } },
  });
  auditService.log({ userId, action: 'EARN_STAMP', entity: 'StampCard', entityId: card.id, after: { customerId, templateId, stamps: updated.stamps } });
  return updated;
}

// Redeem: trao phần thưởng khi đủ stamp
async function redeem(cardId, userId) {
  const card = await prisma.stampCard.findUnique({ where: { id: cardId } });
  if (!card) throw { status: 404, message: 'Không tìm thấy thẻ' };
  if (card.stamps < card.totalStamps) throw { status: 400, message: 'Chưa đủ stamp' };
  if (card.redeemedAt) throw { status: 400, message: 'Đã đổi thưởng rồi' };

  const updated = await prisma.stampCard.update({
    where: { id: cardId },
    data: { redeemedAt: new Date() },
  });
  auditService.log({ userId, action: 'REDEEM_STAMP', entity: 'StampCard', entityId: cardId, after: { customerId: card.customerId } });
  return updated;
}

module.exports = { listTemplates, createTemplate, updateTemplate, getCustomerCards, earnStamp, redeem };
