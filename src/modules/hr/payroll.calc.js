/**
 * modules/hr/payroll.calc.js — Công cụ tính lương thuần (pure functions, không truy cập DB)
 * 
 * Tổng quan:
 - Cung cấp các hàm tính lương gross → net bao gồm BHXH (10.5%), thuế TNCN luỹ tiến, phạt vi phạm, hệ số chuyên cần.
 * - Áp dụng mức đóng BHXH 2024 (trần 46.8M) và biểu thuế TNCN 7 bậc.
 * 
 * Hàm:
 * - calcPIT(grossMonthly, dependents): Tính thuế TNCN luỹ tiến theo thu nhập chịu thuế/tháng; trả về { taxableIncome, pitAmount }
 * - calcBHXH(grossSalary): Tính BHXH nhân viên đóng (10.5%) với mức trần 46.800.000 VND/tháng
 * - grossToNet(grossSalary, dependents): Tính lương net = Gross - BHXH - PIT; trả về { grossSalary, bhxhEmployee, pitAmount, netSalary }
 * - calculatePayroll({baseSalary, shiftCount, shiftMoney, violations, dependents}): Tính lương chính: hệ số chuyên cần, phạt, gross, BHXH, PIT, netSalary; suspended=true nếu vắng > 2 lần
 */
// Pure payroll calculation utility (no DB access)

// ======== BHXH 2024 ========
// Mức đóng BHXH tối đa = 20 × 2,340,000 = 46,800,000 VND/tháng
const BHXH_CAP = 46_800_000;
const BHXH_RATE   = 0.08;    // Bảo hiểm xã hội
const BHYT_RATE   = 0.015;   // Bảo hiểm y tế
const BHTN_RATE   = 0.01;    // Bảo hiểm thất nghiệp
const EMPLOYEE_INSURANCE_RATE = BHXH_RATE + BHYT_RATE + BHTN_RATE; // 10.5%

// ======== TNCN 2024 ========
// Giảm trừ bản thân: 11,000,000 VND/tháng
// Giảm trừ người phụ thuộc: 4,400,000 VND/tháng/người
const PERSONAL_DEDUCTION   = 11_000_000;
const DEPENDENT_DEDUCTION  = 4_400_000;

// Luỹ tiến 7 bậc (trên thu nhập chịu thuế/tháng)
const PIT_BRACKETS = [
  { max:  5_000_000, rate: 0.05, cumBelow: 0 },
  { max: 10_000_000, rate: 0.10, cumBelow:   250_000 },
  { max: 18_000_000, rate: 0.15, cumBelow:   750_000 },
  { max: 32_000_000, rate: 0.20, cumBelow: 1_950_000 },
  { max: 52_000_000, rate: 0.25, cumBelow: 4_750_000 },
  { max: 80_000_000, rate: 0.30, cumBelow: 9_750_000 },
  { max: Infinity,   rate: 0.35, cumBelow: 18_150_000 },
];

/**
 * Tính thuế TNCN luỹ tiến theo thu nhập chịu thuế / tháng.
 * @param {number} grossMonthly     - Lương gross tháng (đã trừ BHXH)
 * @param {number} [dependents=0]   - Số người phụ thuộc
 * @returns {{ taxableIncome, pitAmount }}
 */
const calcPIT = (grossMonthly, dependents = 0) => {
  const taxableIncome = Math.max(
    0,
    grossMonthly - PERSONAL_DEDUCTION - DEPENDENT_DEDUCTION * dependents,
  );
  if (taxableIncome <= 0) return { taxableIncome: 0, pitAmount: 0 };

  let tax = 0;
  let remaining = taxableIncome;
  let prevMax = 0;
  for (const bracket of PIT_BRACKETS) {
    const range = Math.min(remaining, bracket.max - prevMax);
    if (range <= 0) break;
    tax += range * bracket.rate;
    remaining -= range;
    prevMax = bracket.max;
    if (remaining <= 0) break;
  }

  return { taxableIncome: Math.round(taxableIncome), pitAmount: Math.round(tax) };
};

/**
 * Tính BHXH nhân viên đóng (10.5%).
 * Mức đóng tối đa: 46,800,000 VND/tháng.
 */
const calcBHXH = (grossSalary) => {
  const base = Math.min(Math.max(0, Number(grossSalary || 0)), BHXH_CAP);
  return Math.round(base * EMPLOYEE_INSURANCE_RATE);
};

/**
 * Tính lương thuần (net) từ gross.
 * Net = Gross - BHXH - PIT
 */
const grossToNet = (grossSalary, dependents = 0) => {
  const bhxh = calcBHXH(grossSalary);
  const grossAfterBHXH = Math.max(0, grossSalary - bhxh);
  const { pitAmount } = calcPIT(grossAfterBHXH, dependents);
  const netSalary = Math.max(0, grossSalary - bhxh - pitAmount);
  return { grossSalary: Math.round(grossSalary), bhxhEmployee: bhxh, pitAmount, netSalary };
};

// ======== Main payroll calc ========

const calculatePayroll = ({
  baseSalary = 0,
  shiftCount = 0,
  shiftMoney = null,
  violations = [],
  dependents = 0,
} = {}) => {
  let attendanceCoefficient = 1.0;
  let penalties = 0;
  let suspended = false;

  const absences = (violations || []).filter((v) => v.type === "UNAUTHORIZED_ABSENCE").length;

  for (const v of violations || []) {
    if (v.type === "LATE" || v.type === "EARLY") attendanceCoefficient -= 0.15;
    if (v.type === "PACKING_ERROR" || v.type === "DAMAGED_GOODS") {
      penalties += 500000;
      attendanceCoefficient = Math.min(attendanceCoefficient, 0.8);
    }
  }
  attendanceCoefficient = Math.max(0, attendanceCoefficient);

  if (absences > 2) {
    suspended = true;
    return { attendanceCoefficient, penalties, gross: 0, finalSalary: 0, bhxhEmployee: 0, pitAmount: 0, suspended };
  }

  const base = Number(baseSalary || 0);
  const shiftMoneyVal = shiftMoney != null ? Number(shiftMoney) : base * 0.05;
  const gross = (base + shiftCount * shiftMoneyVal) * attendanceCoefficient;
  const finalSalary = Math.max(0, gross - penalties);

  // PIT + BHXH trên gross thu nhập (finalSalary trước PIT)
  const bhxhEmployee = calcBHXH(finalSalary);
  const grossAfterBHXH = Math.max(0, finalSalary - bhxhEmployee);
  const { pitAmount } = calcPIT(grossAfterBHXH, dependents);

  return {
    attendanceCoefficient,
    penalties,
    gross,
    finalSalary,        // Lương trước BHXH+PIT
    bhxhEmployee,       // BHXH NV đóng
    pitAmount,          // Thuế TNCN
    netSalary: Math.max(0, finalSalary - bhxhEmployee - pitAmount), // Lương thực nhận
    suspended: false,
    shiftMoney: shiftMoneyVal,
  };
};

module.exports = { calculatePayroll, calcPIT, calcBHXH, grossToNet };
