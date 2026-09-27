const { z } = require('zod');

const modifierGroupCreate = z.object({
  productId: z.string().uuid('Product ID không hợp lệ'),
  name: z.string().min(1, 'Tên nhóm không được để trống'),
  type: z.enum(['SINGLE', 'MULTIPLE']).default('SINGLE'),
  isRequired: z.boolean().default(false),
  minSelect: z.number().int().min(0).default(0),
  maxSelect: z.number().int().min(1).default(1),
  sortOrder: z.number().int().default(0),
});

const modifierGroupUpdate = modifierGroupCreate.partial().extend({
  isActive: z.boolean().optional(),
});

const modifierOptionCreate = z.object({
  name: z.string().min(1, 'Tên tuỳ chọn không được để trống'),
  priceAdjust: z.number().default(0),
  sortOrder: z.number().int().default(0),
});

const modifierOptionUpdate = modifierOptionCreate.partial().extend({
  isActive: z.boolean().optional(),
});

const variantCreate = z.object({
  productId: z.string().uuid('Product ID không hợp lệ'),
  name: z.string().min(1, 'Tên biến thể không được để trống'),
  priceAdjust: z.number().default(0),
  sku: z.string().optional(),
  barcode: z.string().optional(),
});

const variantUpdate = z.object({
  name: z.string().min(1).optional(),
  priceAdjust: z.number().optional(),
  sku: z.string().optional(),
  barcode: z.string().optional(),
  isActive: z.boolean().optional(),
});

const comboCreate = z.object({
  productId: z.string().uuid('Product ID không hợp lệ'),
  price: z.number().positive('Giá combo phải lớn hơn 0'),
  items: z.array(z.object({
    productId: z.string().uuid(),
    quantity: z.number().int().positive(),
  })).optional(),
});

const comboUpdate = z.object({
  price: z.number().positive().optional(),
  isActive: z.boolean().optional(),
  items: z.array(z.object({
    productId: z.string().uuid(),
    quantity: z.number().int().positive(),
  })).optional(),
});

const happyHourBase = z.object({
  name: z.string().min(1, 'Tên khuyến mãi không được để trống'),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'startTime phải có định dạng HH:MM').optional(),
  endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'endTime phải có định dạng HH:MM').optional(),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1, 'Phải chọn ít nhất 1 ngày').optional(),
  discountValue: z.number().positive(),
  isActive: z.boolean().default(true),
  appliesTo: z.enum(['ALL', 'CATEGORY', 'PRODUCT']).default('ALL'),
  categoryId: z.string().uuid().optional(),
  productId: z.string().uuid().optional(),
});

const happyHourCreate = happyHourBase.refine(
  (d) => !d.startTime || !d.endTime || d.startTime < d.endTime,
  { message: 'endTime phải sau startTime', path: ['endTime'] },
);

const happyHourUpdate = happyHourBase.partial();

module.exports = {
  modifierGroupCreate, modifierGroupUpdate,
  modifierOptionCreate, modifierOptionUpdate,
  variantCreate, variantUpdate,
  comboCreate, comboUpdate,
  happyHourCreate, happyHourUpdate,
};
