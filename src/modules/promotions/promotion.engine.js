/**
 * modules/promotions/promotion.engine.js — Engine tính khuyến mãi & chiết khấu
 * 
 * Tổng quan:
 * - Xây dựng giỏ hàng từ items, tính chiết khấu theo nhiều loại promotion.
 * - Hỗ trợ auto-apply nhiều promotion theo thứ tự ưu tiên và apply voucher đơn lẻ.
 * 
 * Hàm:
 * - buildCart(items, products): Xây dựng cart object { lines, subtotal, totalQty } từ items và products
 * - calcDiscount(promo, cart): Tính chiết khấu cho 1 promotion — hỗ trợ PERCENTAGE, FIXED_AMOUNT, CATEGORY_DISCOUNT, PRODUCT_DISCOUNT, BUY_X_GET_Y, FREE_SHIPPING
 * - applyAutoPromotions(promotions, cart): Áp dụng tự động nhiều promotion theo PRIORITY, discount stack dần
 * - applyVoucher(promo, cart): Áp dụng voucher đơn lẻ, trả về { promotion, discount, eligible }
 * - toNum(v): Chuyển giá trị sang number (default 0)
 * - round2(n): Làm tròn đến 2 chữ số thập phân
 * 
 * Helper:
 * - meetsMinOrder(promo, cart): Kiểm tra đơn hàng đạt giá trị tối thiểu
 * - meetsMinQty(promo, cart): Kiểm tra đơn hàng đạt số lượng tối thiểu
 * - sortByPriority(promos): Sắp xếp promotion theo PRIORITY array
 * - PRIORITY: Mảng thứ tự ưu tiên các loại khuyến mãi
 */
const toNum = (v) => Number(v || 0);
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

const PRIORITY = [
  "PRODUCT_DISCOUNT",
  "CATEGORY_DISCOUNT",
  "BUY_X_GET_Y",
  "FIXED_AMOUNT",
  "PERCENTAGE",
  "FREE_SHIPPING",
];

const buildCart = (items, products) => {
  const lines = items.map((item) => {
    const product = products.find((p) => p.id === item.productId);
    const gross = toNum(product.price) * item.quantity;
    const itemDisc = toNum(item.discountAmount || 0);
    const subtotal = gross - itemDisc;
    return {
      productId: item.productId,
      categoryId: product.categoryId,
      quantity: item.quantity,
      unitPrice: toNum(product.price),
      gross,
      subtotal,
    };
  });
  const subtotal = lines.reduce((s, l) => s + l.subtotal, 0);
  const totalQty = lines.reduce((s, l) => s + l.quantity, 0);
  return { lines, subtotal, totalQty };
};

const meetsMinOrder = (promo, cart) => {
  const min = promo.minOrderValue ? toNum(promo.minOrderValue) : 0;
  return cart.subtotal >= min;
};

const meetsMinQty = (promo, cart) => {
  if (!promo.minQuantity) return true;
  return cart.totalQty >= promo.minQuantity;
};

const calcDiscount = (promo, cart) => {
  if (!meetsMinOrder(promo, cart) || !meetsMinQty(promo, cart)) return 0;
  const value = toNum(promo.value);

  switch (promo.type) {
    case "PERCENTAGE": {
      let d = round2((cart.subtotal * value) / 100);
      if (promo.maxDiscount) d = Math.min(d, toNum(promo.maxDiscount));
      return Math.min(cart.subtotal, d);
    }
    case "FIXED_AMOUNT":
    case "FREE_SHIPPING":
      return Math.min(cart.subtotal, value);
    case "CATEGORY_DISCOUNT": {
      const catSub = cart.lines
        .filter((l) => l.categoryId === promo.categoryId)
        .reduce((s, l) => s + l.subtotal, 0);
      if (!catSub) return 0;
      let d = round2((catSub * value) / 100);
      if (promo.maxDiscount) d = Math.min(d, toNum(promo.maxDiscount));
      return Math.min(cart.subtotal, d);
    }
    case "PRODUCT_DISCOUNT": {
      const line = cart.lines.find((l) => l.productId === promo.productId);
      if (!line) return 0;
      let d = round2((line.subtotal * value) / 100);
      if (promo.maxDiscount) d = Math.min(d, toNum(promo.maxDiscount));
      return Math.min(cart.subtotal, d);
    }
    case "BUY_X_GET_Y": {
      const buy = promo.buyQuantity || 1;
      const get = promo.getQuantity || 1;
      const line = promo.productId
        ? cart.lines.find((l) => l.productId === promo.productId)
        : cart.lines.sort((a, b) => a.unitPrice - b.unitPrice)[0];
      if (!line) return 0;
      const sets = Math.floor(line.quantity / (buy + get));
      return round2(sets * get * line.unitPrice);
    }
    default:
      return 0;
  }
};

const sortByPriority = (promos) =>
  [...promos].sort((a, b) => PRIORITY.indexOf(a.type) - PRIORITY.indexOf(b.type));

const applyAutoPromotions = (promotions, cart) => {
  const applied = [];
  let remaining = cart.subtotal;
  const adjustedCart = { ...cart, subtotal: remaining };

  for (const promo of sortByPriority(promotions)) {
    if (remaining <= 0) break;
    adjustedCart.subtotal = remaining;
    const discount = calcDiscount(promo, adjustedCart);
    if (discount > 0) {
      applied.push({ promotion: promo, discount });
      remaining = round2(remaining - discount);
    }
  }

  const totalDiscount = applied.reduce((s, a) => s + a.discount, 0);
  return { applied, totalDiscount: round2(totalDiscount) };
};

const applyVoucher = (promo, cart) => {
  const discount = calcDiscount(promo, cart);
  return { promotion: promo, discount, eligible: discount > 0 };
};

module.exports = {
  PRIORITY,
  buildCart,
  calcDiscount,
  applyAutoPromotions,
  applyVoucher,
  toNum,
  round2,
};
