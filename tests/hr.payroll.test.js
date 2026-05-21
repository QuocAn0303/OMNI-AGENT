const { calculatePayroll } = require("../src/modules/hr/payroll.calc");

describe("Payroll.calculatePayroll", () => {
  test("no violations returns full gross", () => {
    const res = calculatePayroll({
      baseSalary: 5000000,
      shiftCount: 10,
      shiftMoney: 250000,
      violations: [],
    });
    expect(res.attendanceCoefficient).toBeCloseTo(1.0);
    expect(res.finalSalary).toBeCloseTo(7500000);
  });

  test("one late reduces coefficient by 0.15", () => {
    const res = calculatePayroll({
      baseSalary: 5000000,
      shiftCount: 10,
      shiftMoney: 250000,
      violations: [{ type: "LATE" }],
    });
    expect(res.attendanceCoefficient).toBeCloseTo(0.85);
    expect(res.finalSalary).toBeCloseTo(7500000 * 0.85);
  });

  test("packing error applies penalty and caps coefficient to 0.8", () => {
    const res = calculatePayroll({
      baseSalary: 5000000,
      shiftCount: 10,
      shiftMoney: 250000,
      violations: [{ type: "PACKING_ERROR" }],
    });
    expect(res.attendanceCoefficient).toBeLessThanOrEqual(0.8 + 1e-6);
    const expectedGross = (5000000 + 10 * 250000) * Math.min(1, 0.8);
    expect(res.finalSalary).toBeCloseTo(expectedGross - 500000);
  });

  test("more than 2 unauthorized absences suspends payroll", () => {
    const res = calculatePayroll({
      baseSalary: 5000000,
      shiftCount: 5,
      shiftMoney: 200000,
      violations: [
        { type: "UNAUTHORIZED_ABSENCE" },
        { type: "UNAUTHORIZED_ABSENCE" },
        { type: "UNAUTHORIZED_ABSENCE" },
      ],
    });
    expect(res.suspended).toBe(true);
    expect(res.finalSalary).toBe(0);
  });
});
