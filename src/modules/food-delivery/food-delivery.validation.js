const { z } = require('zod');

const receiveOrder = z.object({
  provider: z.enum(['GRABFOOD', 'SHOPEEFOOD', 'BEFOOD', 'GO_FOOD']),
  providerOrderId: z.string().min(1, 'providerOrderId không được để trống'),
  customerName: z.string().min(1, 'Tên khách không được để trống'),
  customerPhone: z.string().optional(),
  customerAddress: z.string().min(1, 'Địa chỉ giao không được để trống'),
  items: z.array(z.object({
    productId: z.string().uuid('Product ID không hợp lệ'),
    productName: z.string().min(1),
    quantity: z.number().int().positive('Số lượng phải > 0'),
    unitPrice: z.number().positive('Đơn giá phải > 0'),
  })).min(1, 'Đơn hàng phải có ít nhất 1 sản phẩm'),
  subtotal: z.number().nonnegative(),
  deliveryFee: z.number().nonnegative().default(0),
  total: z.number().positive('Tổng tiền phải > 0'),
  note: z.string().optional(),
});

module.exports = { receiveOrder };
