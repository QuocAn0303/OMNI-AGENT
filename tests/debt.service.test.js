const { statusFromAmounts } = require("../src/modules/debt/debt.service");

describe("debt.service statusFromAmounts", () => {
  test("CLOSED when fully paid", () => {
    expect(statusFromAmounts(100, 100, null)).toBe("CLOSED");
  });
  test("PARTIAL when partially paid and not due", () => {
    const future = new Date(Date.now() + 86400000);
    expect(statusFromAmounts(100, 40, future)).toBe("PARTIAL");
  });
  test("OPEN when unpaid and not due", () => {
    const future = new Date(Date.now() + 86400000);
    expect(statusFromAmounts(100, 0, future)).toBe("OPEN");
  });
});
