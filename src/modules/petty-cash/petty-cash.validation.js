const z = require('zod');

const createPettyCash = z.object({
  type: z.enum(['IN', 'OUT']),
  amount: z.number().positive('Số tiền phải > 0'),
  category: z.string().min(1, 'Danh mục không được để trống'),
  description: z.string().min(1, 'Mô tả không được để trống'),
  note: z.string().optional(),
});

module.exports = { createPettyCash };
