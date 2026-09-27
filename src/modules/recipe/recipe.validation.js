const z = require('zod');

const ingredientSchema = z.object({
  ingredientProductId: z.string().min(1),
  quantity: z.number().positive('Số lượng phải > 0'),
  wastePercent: z.number().min(0).max(100).optional(),
  unit: z.string().optional(),
});

const upsertRecipe = z.object({
  portions: z.number().int().positive().optional(),
  ingredients: z.array(ingredientSchema).min(1, 'Cần ít nhất 1 nguyên liệu'),
});

const logWaste = z.object({
  productId: z.string().min(1),
  quantity: z.number().positive(),
  reason: z.string().min(1, 'Lý do không được để trống'),
  cost: z.number().nonnegative().optional(),
  note: z.string().optional(),
});

module.exports = { upsertRecipe, logWaste };
