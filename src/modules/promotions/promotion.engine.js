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
