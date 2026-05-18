const {
  computeTier,
  pointsFromAmount,
  redeemValueFromPoints,
  applyTierDiscount,
} = require("../src/modules/loyalty/loyalty.service");
const { numberToVietnameseWords } = require("../src/utils/vietnameseMoneyWords");

describe("loyalty.service", () => {
  test("1tr chi tiêu → 1000 điểm (mặc định 1 điểm/1000đ)", () => {
    expect(pointsFromAmount(1_000_000)).toBe(1000);
  });

  test("totalSpent 5tr → SILVER", () => {
    expect(computeTier(5_000_000)).toBe("SILVER");
  });

  test("100 điểm → giảm 10k", () => {
    expect(redeemValueFromPoints(100)).toBe(10_000);
  });

  test("GOLD tier giảm 5%", () => {
    expect(applyTierDiscount(1_000_000, "GOLD")).toBe(50_000);
  });
});

describe("vietnameseMoneyWords", () => {
  test("số tiền bằng chữ", () => {
    const words = numberToVietnameseWords(1_250_000);
    expect(words.toLowerCase()).toContain("đồng");
    expect(words.length).toBeGreaterThan(10);
  });
});
