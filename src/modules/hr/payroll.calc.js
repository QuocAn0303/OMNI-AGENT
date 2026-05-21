// Pure payroll calculation utility (pure, no DB access)
const calculatePayroll = ({
  baseSalary = 0,
  shiftCount = 0,
  shiftMoney = null,
  violations = [],
} = {}) => {
  let attendanceCoefficient = 1.0;
  let penalties = 0;
  let suspended = false;

  // Count unauthorized absences
  const absences = (violations || []).filter(
    (v) => v.type === "UNAUTHORIZED_ABSENCE",
  ).length;

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
    return {
      attendanceCoefficient,
      penalties,
      gross: 0,
      finalSalary: 0,
      suspended,
    };
  }

  const base = Number(baseSalary || 0);
  const shiftMoneyVal = shiftMoney != null ? Number(shiftMoney) : base * 0.05;
  const gross = (base + shiftCount * shiftMoneyVal) * attendanceCoefficient;
  const finalSalary = Math.max(0, gross - penalties);

  return {
    attendanceCoefficient,
    penalties,
    gross,
    finalSalary,
    suspended: false,
    shiftMoney: shiftMoneyVal,
  };
};

module.exports = { calculatePayroll };
