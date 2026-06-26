/**
 * modules/hr/hr.service.js — Service quản lý Nhân sự / HR
 *
 * Tổng quan:
 * - Cung cấp logic nghiệp vụ cho module HR: quản lý nhân viên, chấm công, bảng lương, vi phạm
 * - Sử dụng Prisma ORM để thao tác với DB, tích hợp payroll.calc để tính lương
 * - Gọi expenseAuto để tự động ghi nhận chi phí khi khóa lương
 *
 * Hàm:
 * - createEmployee(payload): Tạo nhân viên mới kèm User account trong transaction. Tự sinh email nếu không có, hash password mặc định, map position → role
 * - flattenEmployee(emp): Chuyển đổi employee object có user lồng ghép thành flat object, che email @erp.local
 * - generatePayrollForMonth(month, year): Sinh bảng lương cho tất cả nhân viên đang active trong tháng. Tính shiftCount, violations, gọi calculatePayroll, upsert Payroll record
 * - parseMonthKey(monthKey): Parse chuỗi "YYYY-MM" thành { month, year }, mặc định tháng hiện tại nếu không truyền
 * - listAttendance({ from, to, employeeId }): Liệt kê chấm công (shifts) trong khoảng thời gian, trả về flat object mỗi shift
 * - listPayroll(monthKey): Liệt kê bảng lương của tháng, trả về flat object kèm tính netSalary
 * - listEmployeesWithPreview(): Lấy danh sách nhân viên kèm preview lương tháng hiện tại
 * - lockPayroll(payrollId, userId): Khóa bảng lương, tự động ghi nhận chi phí qua expenseAuto
 */
const prisma = require("../../config/prisma");
const { calculatePayroll } = require("./payroll.calc");
const expenseAuto = require("../accounting/expense-auto.service");
const autopostService = require("../accounting/autopost.service");
const postingErrorService = require("../accounting/posting-error.service");
const bcrypt = require("bcrypt");

const POSITION_TO_ROLE = {
  MANAGER: "MANAGER",
  CASHIER: "CASHIER",
  SALES: "CASHIER",
  WAREHOUSE: "WAREHOUSE",
  OTHER: "CASHIER",
};

const createEmployee = async (payload) => {
  const {
    employeeCode, fullName, phone, email,
    position = "OTHER", baseSalary = 0, hireDate, address,
  } = payload;

  // Tạo User + Employee trong transaction
  return prisma.$transaction(async (tx) => {
    // Kiểm tra email trùng nếu có
    if (email) {
      const existing = await tx.user.findUnique({ where: { email } });
      if (existing) throw { status: 409, message: "Email đã được sử dụng" };
    }

    // Tạo email tạm nếu không có
    const userEmail = email || `emp_${Date.now()}@erp.local`;
    const hashedPw = await bcrypt.hash("NhanVien@2026", 10);
    const role = POSITION_TO_ROLE[position] || "CASHIER";

    const user = await tx.user.create({
      data: { email: userEmail, password: hashedPw, fullName, role },
    });

    const employee = await tx.employee.create({
      data: {
        userId: user.id,
        employeeCode: employeeCode || null,
        phone: phone || null,
        position,
        hireDate: hireDate ? new Date(hireDate) : null,
        address: address || null,
        baseSalary,
      },
      include: { user: true },
    });

    return flattenEmployee(employee);
  });
};

const flattenEmployee = (emp) => ({
  id: emp.id,
  userId: emp.userId,
  employeeCode: emp.employeeCode,
  fullName: emp.user.fullName,
  email: emp.user.email?.endsWith("@erp.local") ? null : emp.user.email,
  phone: emp.phone,
  position: emp.position,
  hireDate: emp.hireDate,
  address: emp.address,
  baseSalary: Number(emp.baseSalary),
  shiftMoney: Number(emp.shiftMoney),
  isActive: emp.isActive,
  role: emp.user.role,
});

// Payroll rules implementation
const generatePayrollForMonth = async (month, year) => {
  // get only active employees
  const employees = await prisma.employee.findMany({
    where: { isActive: true },
    include: { user: true, shifts: true, violations: true },
  });

  const createdPayrolls = await prisma.$transaction(async (tx) => {
    const results = [];

    for (const emp of employees) {
      const shiftCount = await tx.shift.count({
        where: {
          employeeId: emp.id,
          date: {
            gte: new Date(year, month - 1, 1),
            lt: new Date(year, month, 1),
          },
        },
      });

      const violations = await tx.violation.findMany({
        where: {
          employeeId: emp.id,
          date: {
            gte: new Date(year, month - 1, 1),
            lt: new Date(year, month, 1),
          },
        },
      });

      const shiftMoneyValue = emp.shiftMoney
        ? Number(emp.shiftMoney)
        : Number(emp.baseSalary) * 0.05;

      const calc = calculatePayroll({
        baseSalary: emp.baseSalary,
        shiftCount,
        shiftMoney: shiftMoneyValue,
        violations,
        dependents: emp.dependents || 0,
      });

      let finalSalary = 0;
      if (calc.suspended) {
        finalSalary = 0;
        await tx.employee.update({
          where: { id: emp.id },
          data: { isActive: false },
        });
      } else {
        finalSalary = calc.finalSalary;
      }

      const payrollData = {
        baseSalary: emp.baseSalary,
        shiftMoney: shiftMoneyValue,
        shiftCount,
        attendanceCoefficient: calc.attendanceCoefficient,
        penalties: calc.penalties,
        finalSalary,
        bhxhEmployee: calc.bhxhEmployee || 0,
        pitAmount: calc.pitAmount || 0,
      };

      const existing = await tx.payroll.findFirst({
        where: { employeeId: emp.id, month, year },
      });
      let rec;
      if (existing) {
        if (existing.isLocked) {
          results.push(existing);
          continue;
        }
        rec = await tx.payroll.update({ where: { id: existing.id }, data: payrollData });
      } else {
        rec = await tx.payroll.create({ data: { employeeId: emp.id, month, year, ...payrollData } });
      }

      results.push(rec);
    }

    return results;
  });

  return createdPayrolls;
};

const parseMonthKey = (monthKey) => {
  const now = new Date();
  if (!monthKey) return { month: now.getMonth() + 1, year: now.getFullYear() };

  const [year, month] = String(monthKey).split("-").map(Number);
  if (!year || !month || month < 1 || month > 12) {
    throw { status: 400, message: "Thang bang luong không hop le" };
  }
  return { month, year };
};

const listAttendance = async ({ from, to, employeeId }) => {
  if (!from || !to) {
    throw { status: 400, message: "Vui lòng chon khoang thoi gian" };
  }

  const start = new Date(from);
  start.setHours(0, 0, 0, 0);
  const end = new Date(to);
  end.setHours(23, 59, 59, 999);

  const shifts = await prisma.shift.findMany({
    where: {
      date: { gte: start, lte: end },
      ...(employeeId ? { employeeId } : {}),
    },
    include: { employee: { include: { user: true } } },
    orderBy: { date: "desc" },
  });

  return shifts.map((shift) => ({
    id: shift.id,
    date: shift.date,
    employeeId: shift.employeeId,
    userId: shift.employee.userId,
    employeeName: shift.employee.user.fullName,
    employeeCode: shift.employee.user.email,
    shiftType: shift.type,
    checkIn: shift.date,
    checkOut: null,
    totalHours: 8,
    isLate: false,
  }));
};

const listPayroll = async (monthKey) => {
  const { month, year } = parseMonthKey(monthKey);
  const payrolls = await prisma.payroll.findMany({
    where: { month, year },
    include: { employee: { include: { user: true } } },
    orderBy: { createdAt: "desc" },
  });

  return payrolls.map((p) => ({
    id: p.id,
    employeeId: p.employeeId,
    employeeName: p.employee.user.fullName,
    employeeCode: p.employee.user.email,
    month: p.month,
    year: p.year,
    baseSalary: Number(p.baseSalary),
    shiftMoney: Number(p.shiftMoney),
    shiftCount: p.shiftCount,
    totalHours: p.shiftCount * 8,
    attendanceCoefficient: p.attendanceCoefficient,
    penalties: Number(p.penalties),
    bonus: 0,
    deduction: Number(p.penalties),
    finalSalary: Number(p.finalSalary),
    bhxhEmployee: Number(p.bhxhEmployee),
    pitAmount: Number(p.pitAmount),
    netSalary: Math.max(0, Number(p.finalSalary) - Number(p.bhxhEmployee) - Number(p.pitAmount)),
    isLocked: p.isLocked,
  }));
};

const listEmployeesWithPreview = async () => {
  const emps = await prisma.employee.findMany({ include: { user: true } });
  const res = [];
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();

  for (const emp of emps) {
    const shiftCount = await prisma.shift.count({
      where: {
        employeeId: emp.id,
        date: {
          gte: new Date(year, month - 1, 1),
          lt: new Date(year, month, 1),
        },
      },
    });
    const violations = await prisma.violation.findMany({
      where: {
        employeeId: emp.id,
        date: {
          gte: new Date(year, month - 1, 1),
          lt: new Date(year, month, 1),
        },
      },
    });

    const shiftMoneyValue = emp.shiftMoney
      ? Number(emp.shiftMoney)
      : Number(emp.baseSalary) * 0.05;
    const calc = calculatePayroll({
      baseSalary: emp.baseSalary,
      shiftCount,
      shiftMoney: shiftMoneyValue,
      violations,
    });

    // Trả flat object để frontend dùng trực tiếp
    res.push({
      ...flattenEmployee(emp),
      shiftCount,
      violations,
      preview: {
        baseSalary: Number(emp.baseSalary),
        shiftMoney: shiftMoneyValue,
        attendanceCoefficient: calc.attendanceCoefficient,
        penalties: calc.penalties,
        finalSalary: calc.finalSalary,
      },
    });
  }

  return res;
};

const lockPayroll = async (payrollId, userId) => {
  const payroll = await prisma.payroll.findUnique({
    where: { id: payrollId },
    include: { employee: { include: { user: true } } },
  });
  if (!payroll) throw { status: 404, message: "Không tìm thấy bảng lương" };
  if (payroll.isLocked) throw { status: 400, message: "Bảng lương đã khóa" };

  const updated = await prisma.payroll.update({
    where: { id: payrollId },
    data: { isLocked: true },
  });

  await expenseAuto.fromPayrollLock({ payroll: updated, userId }).catch(() => {});

  await postingErrorService.tryPostOrQueue(
    () => autopostService.postPayrollAccrual({ payroll: updated, employee: payroll.employee, userId }),
    { source: "PAYROLL", sourceId: payrollId, payload: { operation: "PAYROLL_ACCRUAL" } },
  );

  return updated;
};

module.exports = {
  createEmployee,
  flattenEmployee,
  generatePayrollForMonth,
  listEmployeesWithPreview,
  listAttendance,
  listPayroll,
  lockPayroll,
  parseMonthKey,
};
