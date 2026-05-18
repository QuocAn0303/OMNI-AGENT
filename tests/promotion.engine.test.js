const engine = require("../src/modules/promotions/promotion.engine");

describe("promotion.engine", () => {
  const products = [
    { id: "p1", categoryId: "c1", price: 100000 },
    { id: "p2", categoryId: "c2", price: 200000 },
  ];

  test("PERCENTAGE respects maxDiscount", () => {
    const cart = engine.buildCart([{ productId: "p1", quantity: 10 }], products);
    const d = engine.calcDiscount(
      { type: "PERCENTAGE", value: 20, maxDiscount: 150000 },
      cart,
    );
    expect(d).toBe(150000);
  });

  test("CATEGORY_DISCOUNT applies to matching lines only", () => {
    const cart = engine.buildCart(
      [
        { productId: "p1", quantity: 2 },
        { productId: "p2", quantity: 1 },
      ],
      products,
    );
    const d = engine.calcDiscount(
      { type: "CATEGORY_DISCOUNT", categoryId: "c1", value: 10 },
      cart,
    );
    expect(d).toBe(20000);
  });

  test("voucher min order rejects small cart", () => {
    const cart = engine.buildCart([{ productId: "p1", quantity: 1 }], products);
    const d = engine.calcDiscount(
      { type: "FIXED_AMOUNT", value: 50000, minOrderValue: 500000 },
      cart,
    );
    expect(d).toBe(0);
  });

  test("auto stack follows priority", () => {
    const cart = engine.buildCart([{ productId: "p1", quantity: 5 }], products);
    const promos = [
      { id: "1", type: "PERCENTAGE", value: 5 },
      { id: "2", type: "PRODUCT_DISCOUNT", productId: "p1", value: 10 },
    ];
    const { totalDiscount, applied } = engine.applyAutoPromotions(promos, cart);
    expect(applied[0].promotion.type).toBe("PRODUCT_DISCOUNT");
    expect(totalDiscount).toBeGreaterThan(0);
  });
});
