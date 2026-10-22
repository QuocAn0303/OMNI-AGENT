const z = require('zod');
const ApiError = require('../../utils/apiError');

// PurchaseItem.quantity is a PostgreSQL Int. Do not coerce blanks or strings.
const quantitySchema = z.number().int().min(1).max(2147483647);

/** Keep the formula's recommendation alongside the human's purchase decision. */
const withPurchaseQuantity = (payload, quantity) => {
  const validation = quantitySchema.safeParse(quantity);
  if (!validation.success) {
    throw new ApiError(400, 'Số lượng nhập phải là số nguyên từ 1 đến 2.147.483.647');
  }
  const parsed = validation.data;
  if (!Array.isArray(payload.items) || payload.items.length !== 1) {
    throw { status: 400, message: 'Chỉ hỗ trợ chọn số lượng cho đề xuất một sản phẩm' };
  }
  const item = payload.items[0];
  const totalEstimate = parsed * Number(item.unitCost);
  if (!Number.isFinite(totalEstimate) || totalEstimate < 0 || totalEstimate >= 1e13) {
    throw { status: 400, message: 'Tổng tiền nhập hàng vượt giới hạn cho phép' };
  }
  return {
    ...payload,
    suggestedQuantity: payload.suggestedQuantity ?? item.quantity,
    quantitySelectedByHuman: true,
    items: [{ ...item, quantity: parsed }],
    totalEstimate,
  };
};

module.exports = { quantitySchema, withPurchaseQuantity };
