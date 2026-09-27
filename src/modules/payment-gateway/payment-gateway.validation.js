const { z } = require('zod');

const createPayment = z.object({
  provider: z.enum(['MOMO', 'VNPAY', 'ZALOPAY']),
  orderId: z.string().min(1, 'orderId không được để trống'),
  orderCode: z.string().min(1, 'orderCode không được để trống'),
  amount: z.number().int().positive('Số tiền phải > 0'),
});

module.exports = { createPayment };
