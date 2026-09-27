/**
 * modules/hr/hr.controller.js — Controller quản lý HR (nhân sự)
 * 
 * Tổng quan:
 * - Xử lý các request HTTP liên quan đến nhân viên, ca làm việc, vi phạm, chấm công và bảng lương.
 * - Gọi hrService để thao tác DB và dùng response helper để trả JSON.
 * 
 * Hàm:
 * - createEmployee(req, res, next): Parse body bằng createEmployeeSchema → gọi hrService.createEmployee → trả về 201
 * - setEmployeeCounts(req, res, next): Set số ca làm & vi phạm cho 1 employee trong tháng; dùng transaction tạo/xoá shifts & violations
 * - setBulkCounts(req, res, next): Tương tự setEmployeeCounts nhưng cho nhiều employee cùng lúc
 * - createShift(req, res, next): Tạo ca làm việc mới
 * - createViolation(req, res, next): Tạo vi phạm, tự động set penalty 500k nếu PACKING_ERROR/DAMAGED_GOODS
 * - updateViolation(req, res, next): Cập nhật type/note/penalty của vi phạm theo id
 * - generatePayroll(req, res, next): Gọi hrService.generatePayrollForMonth theo body {month, year}
 * - calculatePayroll(req, res, next): Parse month từ query và generate payroll
 * - listPayroll(req, res, next): Lấy danh sách bảng lương theo monthKey
 * - lockPayroll(req, res, next): Khoá bảng lương (chống chỉnh sửa)
 * - listAttendance(req, res, next): Danh sách chấm công; nếu không phải ADMIN/MANAGER thì chỉ trả ca của bản thân
 * - listEmployees(req, res, next): Danh sách nhân viên; lọc theo role tương tự listAttendance
 * - updateEmployee(req, res, next): Cập nhật employee (employeeCode, phone, salary...) + user (fullName, email) trong transaction
 * - deleteEmployee(req, res, next): Soft delete (set isActive = false)
 */
const {
  createEmployeeSchema,
  createShiftSchema,
  createViolationSchema,
  generatePayrollSchema,
} = require("./hr.validation");
const hrService = require("./hr.service");
const prisma = require("../../config/prisma");

const createEmployee = async (req, res, next) => {
  try {
    const parsed = createEmployeeSchema.parse(req.body);
    const employee = await hrService.createEmployee(parsed, req.user.id);
    res.status(201).json({ success: true, data: employee, message: "Đã thêm nhân viên" });
  } catch (err) {
    next(err);
  }
};

const setEmployeeCounts = async (req, res, next) => {
  try {
    const { setCountsSchema } = require("./hr.validation");
    const parsed = setCountsSchema.parse(req.body);
    const id = req.params.id;

    const now = new Date();
    const month = parsed.month || now.getMonth() + 1;
    const year = parsed.year || now.getFullYear();

    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 1);

    const desiredShifts = parsed.shiftCount;
    const desiredViolations = parsed.violationCount;
    const shiftType = parsed.shiftType || "MORNING";
    const violationType = parsed.violationType || "LATE";
    const note = parsed.note || "Added by admin";

    await prisma.$transaction(async (tx) => {
      // SHIFTS
      if (typeof desiredShifts === "number") {
        const existingShifts = await tx.shift.findMany({
          where: { employeeId: id, date: { gte: start, lt: end } },
          orderBy: { date: "asc" },
        });
        const cur = existingShifts.length;
        if (desiredShifts > cur) {
          const toCreate = desiredShifts - cur;
          const existingDays = new Set(
            existingShifts.map((s) => new Date(s.date).getDate()),
          );
          const daysInMonth = new Date(year, month, 0).getDate();
          const creations = [];
          for (
            let d = 1;
            d <= daysInMonth && creations.length < toCreate;
            d++
          ) {
            if (!existingDays.has(d)) {
              const date = new Date(year, month - 1, d);
              creations.push(
                tx.shift.create({
                  data: { employeeId: id, date, type: shiftType },
                }),
              );
            }
          }
          await Promise.all(creations);
        } else if (desiredShifts < cur) {
          const toDelete = cur - desiredShifts;
          // delete newest shifts first
          const toRemove = existingShifts.slice(-toDelete);
          for (const r of toRemove) {
            await tx.shift.delete({ where: { id: r.id } });
          }
        }
      }

      // VIOLATIONS
      if (typeof desiredViolations === "number") {
        const existingViolations = await tx.violation.findMany({
          where: { employeeId: id, date: { gte: start, lt: end } },
          orderBy: { date: "asc" },
        });
        const curV = existingViolations.length;
        if (desiredViolations > curV) {
          const toCreate = desiredViolations - curV;
          const creations = [];
          for (let i = 0; i < toCreate; i++) {
            const penalty =
              violationType === "PACKING_ERROR" ||
              violationType === "DAMAGED_GOODS"
                ? 500000
                : 0;
            creations.push(
              tx.violation.create({
                data: {
                  employeeId: id,
                  type: violationType,
                  note,
                  penalty,
                },
              }),
            );
          }
          await Promise.all(creations);
        } else if (desiredViolations < curV) {
          const toDelete = curV - desiredViolations;
          const toRemove = existingViolations.slice(-toDelete);
          for (const r of toRemove) {
            await tx.violation.delete({ where: { id: r.id } });
          }
        }
      }
    });

    const updated = await prisma.employee.findUnique({
      where: { id },
      include: { user: true, shifts: true, violations: true },
    });

    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
};

const setBulkCounts = async (req, res, next) => {
  try {
    const { setCountsBulkSchema } = require("./hr.validation");
    const parsed = setCountsBulkSchema.parse(req.body);

    const now = new Date();
    const month = parsed.month || now.getMonth() + 1;
    const year = parsed.year || now.getFullYear();

    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 1);

    const desiredShifts = parsed.shiftCount;
    const desiredViolations = parsed.violationCount;
    const shiftType = parsed.shiftType || "MORNING";
    const violationType = parsed.violationType || "LATE";
    const note = parsed.note || "Added by admin (bulk)";

    // Process each employee sequentially (each in its own transaction)
    for (const id of parsed.employeeIds) {
      await prisma.$transaction(async (tx) => {
        // SHIFTS
        if (typeof desiredShifts === "number") {
          const existingShifts = await tx.shift.findMany({
            where: { employeeId: id, date: { gte: start, lt: end } },
            orderBy: { date: "asc" },
          });
          const cur = existingShifts.length;
          if (desiredShifts > cur) {
            const toCreate = desiredShifts - cur;
            const existingDays = new Set(
              existingShifts.map((s) => new Date(s.date).getDate()),
            );
            const daysInMonth = new Date(year, month, 0).getDate();
            const creations = [];
            for (
              let d = 1;
              d <= daysInMonth && creations.length < toCreate;
              d++
            ) {
              if (!existingDays.has(d)) {
                const date = new Date(year, month - 1, d);
                creations.push(
                  tx.shift.create({
                    data: { employeeId: id, date, type: shiftType },
                  }),
                );
              }
            }
            await Promise.all(creations);
          } else if (desiredShifts < cur) {
            const toDelete = cur - desiredShifts;
            const toRemove = existingShifts.slice(-toDelete);
            for (const r of toRemove) {
              await tx.shift.delete({ where: { id: r.id } });
            }
          }
        }

        // VIOLATIONS
        if (typeof desiredViolations === "number") {
          const existingViolations = await tx.violation.findMany({
            where: { employeeId: id, date: { gte: start, lt: end } },
            orderBy: { date: "asc" },
          });
          const curV = existingViolations.length;
          if (desiredViolations > curV) {
            const toCreate = desiredViolations - curV;
            const creations = [];
            for (let i = 0; i < toCreate; i++) {
              const penalty =
                violationType === "PACKING_ERROR" ||
                violationType === "DAMAGED_GOODS"
                  ? 500000
                  : 0;
              creations.push(
                tx.violation.create({
                  data: {
                    employeeId: id,
                    type: violationType,
                    note,
                    penalty,
                  },
                }),
              );
            }
            await Promise.all(creations);
          } else if (desiredViolations < curV) {
            const toDelete = curV - desiredViolations;
            const toRemove = existingViolations.slice(-toDelete);
            for (const r of toRemove) {
              await tx.violation.delete({ where: { id: r.id } });
            }
          }
        }
      });
    }

    const updated = await prisma.employee.findMany({
      where: { id: { in: parsed.employeeIds } },
      include: { user: true, shifts: true, violations: true },
    });

    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
};

const createShift = async (req, res, next) => {
  try {
    const parsed = createShiftSchema.parse(req.body);
    const date = parsed.date ? new Date(parsed.date) : new Date();
    const shift = await prisma.shift.create({
      data: { employeeId: parsed.employeeId, date, type: parsed.type },
    });
    res.json({ success: true, data: shift });
  } catch (err) {
    next(err);
  }
};

const createViolation = async (req, res, next) => {
  try {
    const parsed = createViolationSchema.parse(req.body);
    // set default penalty for packing/damage
    let penalty = 0;
    if (parsed.type === "PACKING_ERROR" || parsed.type === "DAMAGED_GOODS")
      penalty = 500000;
    const rec = await prisma.violation.create({
      data: {
        employeeId: parsed.employeeId,
        type: parsed.type,
        note: parsed.note,
        penalty,
      },
    });
    res.json({ success: true, data: rec });
  } catch (err) {
    next(err);
  }
};

const updateViolation = async (req, res, next) => {
  try {
    const { updateViolationSchema } = require("./hr.validation");
    const parsed = updateViolationSchema.parse(req.body);
    const id = req.params.id;

    const allowed = {};
    if (parsed.type !== undefined) allowed.type = parsed.type;
    if (parsed.note !== undefined) allowed.note = parsed.note;
    if (parsed.penalty !== undefined) allowed.penalty = parsed.penalty;

    const updated = await prisma.violation.update({
      where: { id },
      data: allowed,
    });
    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
};

const generatePayroll = async (req, res, next) => {
  try {
    const parsed = generatePayrollSchema.parse(req.body);
    const out = await hrService.generatePayrollForMonth(
      parsed.month,
      parsed.year,
    );
    res.json({ success: true, data: out });
  } catch (err) {
    next(err);
  }
};

const calculatePayroll = async (req, res, next) => {
  try {
    const { month, year } = hrService.parseMonthKey(req.query.month);
    const out = await hrService.generatePayrollForMonth(month, year);
    res.json({ success: true, data: out });
  } catch (err) {
    next(err);
  }
};

const listPayroll = async (req, res, next) => {
  try {
    const { month, page, limit } = req.query;
    const out = await hrService.listPayroll(month, Number(page) || 1, Number(limit) || 50);
    res.json({ success: true, data: out.data, pagination: out.pagination });
  } catch (err) {
    next(err);
  }
};

const listAttendance = async (req, res, next) => {
  try {
    const { from, to, employeeId, page, limit } = req.query;
    const out = await hrService.listAttendance({ from, to, employeeId, page: Number(page) || 1, limit: Number(limit) || 50 });
    const role = req.user?.role;
    if (role === "ADMIN" || role === "MANAGER") {
      res.json({ success: true, data: out.data, pagination: out.pagination });
      return;
    }

    const filtered = out.data.filter((r) => r.userId === req.user?.id);
    res.json({ success: true, data: filtered });
  } catch (err) {
    next(err);
  }
};

const listEmployees = async (req, res, next) => {
  try {
    const out = await hrService.listEmployeesWithPreview();
    // If the requester is not ADMIN or MANAGER, only return their own employee record
    const role = req.user?.role;
    if (role === "ADMIN" || role === "MANAGER") {
      res.json({ success: true, data: out });
    } else {
      const filtered = out.filter((r) => r.userId === req.user?.id);
      res.json({ success: true, data: filtered });
    }
  } catch (err) {
    next(err);
  }
};

const updateEmployee = async (req, res, next) => {
  try {
    const { updateEmployeeSchema } = require("./hr.validation");
    const parsed = updateEmployeeSchema.parse(req.body);
    const id = req.params.id;

    const empData = {};
    if (parsed.employeeCode !== undefined) empData.employeeCode = parsed.employeeCode;
    if (parsed.phone !== undefined) empData.phone = parsed.phone;
    if (parsed.position !== undefined) empData.position = parsed.position;
    if (parsed.baseSalary !== undefined && parsed.baseSalary !== null) empData.baseSalary = parsed.baseSalary;
    if (parsed.shiftMoney !== undefined && parsed.shiftMoney !== null) empData.shiftMoney = parsed.shiftMoney;
    if (parsed.hireDate !== undefined) empData.hireDate = parsed.hireDate ? new Date(parsed.hireDate) : null;
    if (parsed.address !== undefined) empData.address = parsed.address;
    if (parsed.isActive !== undefined) empData.isActive = parsed.isActive;
    if (parsed.departmentId !== undefined) empData.departmentId = parsed.departmentId;

    const userData = {};
    if (parsed.fullName !== undefined) userData.fullName = parsed.fullName;
    if (parsed.email !== undefined && parsed.email !== null && parsed.email !== "") userData.email = parsed.email;

    const updated = await prisma.$transaction(async (tx) => {
      const emp = await tx.employee.update({
        where: { id },
        data: empData,
        include: { user: true },
      });
      if (Object.keys(userData).length > 0) {
        await tx.user.update({ where: { id: emp.userId }, data: userData });
        const refreshed = await tx.employee.findUnique({ where: { id }, include: { user: true } });
        return refreshed;
      }
      return emp;
    });

    res.json({ success: true, data: hrService.flattenEmployee(updated), message: "Đã cập nhật" });
  } catch (err) {
    next(err);
  }
};

const deleteEmployee = async (req, res, next) => {
  try {
    const id = req.params.id;
    await prisma.employee.update({ where: { id }, data: { isActive: false } });
    res.json({ success: true, message: "Đã xóa nhân viên" });
  } catch (err) {
    next(err);
  }
};

const lockPayroll = async (req, res, next) => {
  try {
    const out = await hrService.lockPayroll(req.params.id, req.user.id);
    res.json({ success: true, data: out, message: "Đã khóa bảng lương" });
  } catch (err) {
    next(err);
  }
};

// ─── Department CRUD ───

const listDepartments = async (req, res, next) => {
  try {
    const departments = await prisma.department.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
    });
    res.json({ success: true, data: departments });
  } catch (err) {
    next(err);
  }
};

const createDepartment = async (req, res, next) => {
  try {
    const { name, description } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: "Tên phòng ban không được để trống" });
    }
    const dept = await prisma.department.create({
      data: { name: name.trim(), description: description || null },
    });
    res.status(201).json({ success: true, data: dept, message: "Đã thêm phòng ban" });
  } catch (err) {
    next(err);
  }
};

const updateDepartment = async (req, res, next) => {
  try {
    const { name, description } = req.body;
    const data = {};
    if (name !== undefined) data.name = name.trim();
    if (description !== undefined) data.description = description;

    const dept = await prisma.department.update({
      where: { id: req.params.id },
      data,
    });
    res.json({ success: true, data: dept, message: "Đã cập nhật phòng ban" });
  } catch (err) {
    next(err);
  }
};

const deleteDepartment = async (req, res, next) => {
  try {
    await prisma.department.update({
      where: { id: req.params.id },
      data: { isActive: false },
    });
    res.json({ success: true, message: "Đã xóa phòng ban" });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  createEmployee,
  createShift,
  createViolation,
  updateViolation,
  generatePayroll,
  calculatePayroll,
  listPayroll,
  lockPayroll,
  listAttendance,
  listEmployees,
  updateEmployee,
  deleteEmployee,
  setEmployeeCounts,
  setBulkCounts,
  listDepartments,
  createDepartment,
  updateDepartment,
  deleteDepartment,
};
