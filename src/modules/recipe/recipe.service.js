/**
 * modules/recipe/recipe.service.js — Định mức nguyên liệu + COGS F&B
 *
 * - CRUD Recipe (productId, portions, ingredients)
 * - deductOnOrderComplete(orderId) → trừ kho nguyên liệu theo recipe
 * - getCogsReport() → biên lợi nhuận per món
 */
const prisma = require('../../config/prisma');
const auditService = require('../audit/audit.service');

async function listRecipes() {
  return prisma.recipe.findMany({
    include: { product: { select: { id: true, name: true, sku: true, price: true } }, ingredients: { include: { ingredientProduct: { select: { name: true, costPrice: true } } } } },
    orderBy: { createdAt: 'desc' },
  });
}

async function getRecipe(productId) {
  return prisma.recipe.findUnique({
    where: { productId },
    include: { ingredients: { include: { ingredientProduct: true } } },
  });
}

async function upsertRecipe(productId, data, userId = null) {
  const { portions, ingredients } = data;
  // Xóa ingredients cũ + tạo lại (upsert recipe)
  const existing = await prisma.recipe.findUnique({ where: { productId } });
  let recipe;
  if (existing) {
    await prisma.recipeIngredient.deleteMany({ where: { recipeId: existing.id } });
    recipe = await prisma.recipe.update({
      where: { id: existing.id },
      data: { portions: portions || 1, ingredients: { create: ingredients || [] } },
      include: { ingredients: true },
    });
  } else {
    recipe = await prisma.recipe.create({
      data: { productId, portions: portions || 1, ingredients: { create: ingredients || [] } },
      include: { ingredients: true },
    });
  }
  auditService.log({ userId, action: 'UPSERT_RECIPE', entity: 'Recipe', entityId: recipe.id, after: { productId, ingredientCount: recipe.ingredients.length } });
  return recipe;
}

// Trừ kho nguyên liệu khi Order COMPLETED
// Tính: qty món × (ingredient.quantity / recipe.portions) × (1 + wastePercent/100)
async function deductOnOrderComplete(orderId) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: { include: { product: { include: { recipe: { include: { ingredients: true } } } } } } },
  });
  if (!order) return;

  // Gom số lượng cần trừ per ingredientProductId
  const deductions = {}; // ingredientProductId -> { qty, warehouseId }
  for (const item of order.items) {
    if (item.status === 'VOIDED') continue;
    const recipe = item.product?.recipe;
    if (!recipe) continue;
    for (const ing of recipe.ingredients) {
      const perPortion = Number(ing.quantity) / (recipe.portions || 1);
      const withWaste = perPortion * (1 + Number(ing.wastePercent) / 100);
      const total = withWaste * item.quantity;
      if (!deductions[ing.ingredientProductId]) deductions[ing.ingredientProductId] = 0;
      deductions[ing.ingredientProductId] += total;
    }
  }

  // Trừ kho (default warehouse)
  const warehouse = await prisma.warehouse.findFirst({ where: { isDefault: true } });
  if (!warehouse) return;

  for (const [ingredientProductId, qty] of Object.entries(deductions)) {
    const inv = await prisma.inventory.findUnique({
      where: { productId_warehouseId: { productId: ingredientProductId, warehouseId: warehouse.id } },
    });
    if (inv) {
      await prisma.inventory.update({
        where: { id: inv.id },
        data: { quantity: { decrement: Math.ceil(qty) } },
      });
      await prisma.inventoryTransaction.create({
        data: {
          type: 'EXPORT',
          quantity: Math.ceil(qty),
          productId: ingredientProductId,
          warehouseId: warehouse.id,
          note: `Auto-deduct recipe for order ${order.orderCode}`,
          createdById: order.createdById,
        },
      });
    }
  }
}

// Báo cáo COGS: biên lợi nhuận per món có recipe
async function getCogsReport() {
  const recipes = await prisma.recipe.findMany({
    include: {
      product: { select: { id: true, name: true, price: true, costPrice: true } },
      ingredients: { include: { ingredientProduct: { select: { name: true, costPrice: true } } } },
    },
  });
  return recipes.map((r) => {
    const cost = r.ingredients.reduce((sum, ing) => {
      return sum + Number(ing.ingredientProduct.costPrice) * Number(ing.quantity) / (r.portions || 1) * (1 + Number(ing.wastePercent) / 100);
    }, 0);
    const price = Number(r.product.price);
    const margin = price > 0 ? ((price - cost) / price) * 100 : 0;
    return {
      productId: r.product.id,
      name: r.product.name,
      price,
      cogs: Math.round(cost),
      margin: Math.round(margin * 10) / 10,
    };
  });
}

// Ghi waste log
async function logWaste({ productId, orderItemId, quantity, reason, userId }) {
  const waste = await prisma.wasteLog.create({
    data: { productId, orderItemId, quantity, reason, reportedById: userId },
  });
  auditService.log({ userId, action: 'LOG_WASTE', entity: 'WasteLog', entityId: waste.id, after: { productId, quantity, reason } });
  return waste;
}

module.exports = { listRecipes, getRecipe, upsertRecipe, deductOnOrderComplete, getCogsReport, logWaste };
