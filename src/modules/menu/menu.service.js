/**
 * modules/menu/menu.service.js — Quản lý menu F&B: modifier, variant, combo, happy hour
 *
 * Cung cấp:
 * - CRUD ModifierGroup + ModifierOption (topping, size, đường, đá...)
 * - CRUD ProductVariant (size M/L/XL cố định)
 * - CRUD Combo (combo món + thành phần)
 * - CRUD HappyHour (merged vào Promotion model, type: HAPPY_HOUR)
 */
const prisma = require('../../config/prisma');
const auditService = require('../audit/audit.service');

// ==================== MODIFIER GROUPS ====================

async function listModifierGroups(productId) {
  return prisma.modifierGroup.findMany({
    where: productId ? { productId } : undefined,
    include: { options: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } } },
    orderBy: { sortOrder: 'asc' },
  });
}

async function createModifierGroup(data, userId = null) {
  const group = await prisma.modifierGroup.create({
    data: {
      productId: data.productId,
      name: data.name,
      type: data.type || 'SINGLE',
      isRequired: data.isRequired || false,
      minSelect: data.minSelect || 0,
      maxSelect: data.maxSelect || 1,
      sortOrder: data.sortOrder || 0,
    },
    include: { options: true },
  });
  auditService.log({ userId, action: 'CREATE_MODIFIER_GROUP', entity: 'ModifierGroup', entityId: group.id, after: { name: group.name, productId: data.productId } });
  return group;
}

async function updateModifierGroup(id, data, userId = null) {
  const group = await prisma.modifierGroup.update({
    where: { id },
    data: {
      name: data.name,
      type: data.type,
      isRequired: data.isRequired,
      minSelect: data.minSelect,
      maxSelect: data.maxSelect,
      sortOrder: data.sortOrder,
      isActive: data.isActive,
    },
  });
  auditService.log({ userId, action: 'UPDATE_MODIFIER_GROUP', entity: 'ModifierGroup', entityId: id, after: { name: group.name } });
  return group;
}

async function deleteModifierGroup(id, userId = null) {
  const group = await prisma.modifierGroup.update({ where: { id }, data: { isActive: false } });
  auditService.log({ userId, action: 'DELETE_MODIFIER_GROUP', entity: 'ModifierGroup', entityId: id, before: { name: group.name } });
  return group;
}

// ==================== MODIFIER OPTIONS ====================

async function createModifierOption(groupId, data, userId = null) {
  const option = await prisma.modifierOption.create({
    data: {
      groupId,
      name: data.name,
      priceAdjust: data.priceAdjust || 0,
      sortOrder: data.sortOrder || 0,
    },
  });
  auditService.log({ userId, action: 'CREATE_MODIFIER_OPTION', entity: 'ModifierOption', entityId: option.id, after: { name: option.name, groupId } });
  return option;
}

async function updateModifierOption(id, data, userId = null) {
  const option = await prisma.modifierOption.update({
    where: { id },
    data: { name: data.name, priceAdjust: data.priceAdjust, sortOrder: data.sortOrder, isActive: data.isActive },
  });
  auditService.log({ userId, action: 'UPDATE_MODIFIER_OPTION', entity: 'ModifierOption', entityId: id, after: { name: option.name } });
  return option;
}

async function deleteModifierOption(id, userId = null) {
  const option = await prisma.modifierOption.update({ where: { id }, data: { isActive: false } });
  auditService.log({ userId, action: 'DELETE_MODIFIER_OPTION', entity: 'ModifierOption', entityId: id, before: { name: option.name } });
  return option;
}

// ==================== PRODUCT VARIANTS ====================

async function listVariants(productId) {
  return prisma.productVariant.findMany({
    where: { productId },
    orderBy: { name: 'asc' },
  });
}

async function createVariant(productId, data, userId = null) {
  const variant = await prisma.productVariant.create({
    data: { productId, name: data.name, priceAdjust: data.priceAdjust || 0, sku: data.sku, barcode: data.barcode },
  });
  auditService.log({ userId, action: 'CREATE_VARIANT', entity: 'ProductVariant', entityId: variant.id, after: { name: variant.name, productId } });
  return variant;
}

async function updateVariant(id, data, userId = null) {
  const variant = await prisma.productVariant.update({
    where: { id },
    data: { name: data.name, priceAdjust: data.priceAdjust, sku: data.sku, barcode: data.barcode, isActive: data.isActive },
  });
  auditService.log({ userId, action: 'UPDATE_VARIANT', entity: 'ProductVariant', entityId: id, after: { name: variant.name } });
  return variant;
}

async function deleteVariant(id, userId = null) {
  const variant = await prisma.productVariant.update({ where: { id }, data: { isActive: false } });
  auditService.log({ userId, action: 'DELETE_VARIANT', entity: 'ProductVariant', entityId: id, before: { name: variant.name } });
  return variant;
}

// ==================== COMBOS ====================

async function listCombos() {
  return prisma.combo.findMany({
    include: { product: { select: { id: true, name: true, sku: true } }, items: { include: { product: { select: { id: true, name: true } } } } },
    orderBy: { createdAt: 'desc' },
  });
}

async function getCombo(id) {
  return prisma.combo.findUnique({
    where: { id },
    include: { product: true, items: { include: { product: true } } },
  });
}

async function createCombo(data, userId = null) {
  const combo = await prisma.combo.create({
    data: {
      productId: data.productId,
      price: data.price,
      items: { create: data.items || [] },
    },
    include: { items: true },
  });
  auditService.log({ userId, action: 'CREATE_COMBO', entity: 'Combo', entityId: combo.id, after: { productId: data.productId, price: data.price } });
  return combo;
}

async function updateCombo(id, data, userId = null) {
  // Replace items if provided
  if (data.items) {
    await prisma.comboItem.deleteMany({ where: { comboId: id } });
    await prisma.comboItem.createMany({ data: data.items.map((it) => ({ ...it, comboId: id })) });
  }
  const combo = await prisma.combo.update({
    where: { id },
    data: { price: data.price, isActive: data.isActive },
    include: { items: true },
  });
  auditService.log({ userId, action: 'UPDATE_COMBO', entity: 'Combo', entityId: id, after: { price: combo.price } });
  return combo;
}

async function deleteCombo(id, userId = null) {
  const combo = await prisma.combo.update({ where: { id }, data: { isActive: false } });
  auditService.log({ userId, action: 'DELETE_COMBO', entity: 'Combo', entityId: id, before: { productId: combo.productId } });
  return combo;
}

// ==================== HAPPY HOUR (merged vào Promotion) ====================

async function listHappyHours() {
  return prisma.promotion.findMany({
    where: { type: 'HAPPY_HOUR' },
    orderBy: { createdAt: 'desc' },
  });
}

async function createHappyHour(data, userId) {
  const promo = await prisma.promotion.create({
    data: {
      type: 'HAPPY_HOUR',
      name: data.name,
      value: data.discountValue,
      scope: 'AUTO',
      status: data.isActive !== false ? 'ACTIVE' : 'DRAFT',
      scheduleType: data.daysOfWeek || data.startTime ? 'CRON' : 'ALWAYS',
      daysOfWeek: data.daysOfWeek?.join(',') || null,
      startTime: data.startTime || null,
      endTime: data.endTime || null,
      startDate: new Date(),
      endDate: new Date('2099-12-31'),
      categoryId: data.appliesTo === 'CATEGORY' ? data.categoryId : null,
      productId: data.appliesTo === 'PRODUCT' ? data.productId : null,
    },
  });
  auditService.log({ userId, action: 'CREATE_HAPPY_HOUR', entity: 'Promotion', entityId: promo.id, after: { name: data.name } }).catch(() => {});
  return promo;
}

async function updateHappyHour(id, data, userId) {
  const updateData = {};
  if (data.name !== undefined) updateData.name = data.name;
  if (data.discountValue !== undefined) updateData.value = data.discountValue;
  if (data.isActive !== undefined) updateData.status = data.isActive ? 'ACTIVE' : 'DRAFT';
  if (data.daysOfWeek) updateData.daysOfWeek = data.daysOfWeek.join(',');
  if (data.startTime !== undefined) updateData.startTime = data.startTime;
  if (data.endTime !== undefined) updateData.endTime = data.endTime;
  if (data.daysOfWeek || data.startTime) updateData.scheduleType = 'CRON';
  const promo = await prisma.promotion.update({ where: { id }, data: updateData });
  auditService.log({ userId, action: 'UPDATE_HAPPY_HOUR', entity: 'Promotion', entityId: id, after: { name: data.name } }).catch(() => {});
  return promo;
}

async function deleteHappyHour(id, userId) {
  const promo = await prisma.promotion.update({ where: { id }, data: { status: 'PAUSED' } });
  auditService.log({ userId, action: 'DELETE_HAPPY_HOUR', entity: 'Promotion', entityId: id, before: { name: promo.name } }).catch(() => {});
  return promo;
}

async function getActiveHappyHours() {
  const rules = await prisma.promotion.findMany({
    where: { type: 'HAPPY_HOUR', status: 'ACTIVE', startDate: { lte: new Date() }, endDate: { gte: new Date() } },
  });
  return rules;
}

module.exports = {
  listModifierGroups, createModifierGroup, updateModifierGroup, deleteModifierGroup,
  createModifierOption, updateModifierOption, deleteModifierOption,
  listVariants, createVariant, updateVariant, deleteVariant,
  listCombos, getCombo, createCombo, updateCombo, deleteCombo,
  listHappyHours, createHappyHour, updateHappyHour, deleteHappyHour,
  getActiveHappyHours,
};
