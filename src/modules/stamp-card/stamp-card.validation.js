const { z } = require('zod');

const createTemplate = z.object({
  name: z.string().min(1, 'Tên mẫu thẻ không được để trống'),
  totalStamps: z.number().int().positive('Số stamp phải > 0'),
  rewardProductId: z.string().uuid('Reward product ID không hợp lệ'),
  minOrderAmount: z.number().nonnegative().default(0),
  isActive: z.boolean().default(true),
});

module.exports = { createTemplate };
