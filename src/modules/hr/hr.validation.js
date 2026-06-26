/**
 * modules/hr/hr.validation.js — Zod schemas cho module HR
 * 
 * Tổng quan:
 * - Định nghĩa các Zod schema để validate dữ liệu đầu vào cho các endpoint HR.
 * 
 * Hàm:
 * - createEmployeeSchema: Validate tạo nhân viên (employeeCode, fullName, phone, email, position, baseSalary, hireDate, address)
 * - createShiftSchema: Validate tạo ca làm (employeeId UUID, date optional, type enum MORNING/AFTERNOON/NIGHT)
 * - createViolationSchema: Validate tạo vi phạm (employeeId UUID, type enum, note optional)
 * - updateViolationSchema: Validate cập nhật vi phạm (type, note, penalty đều optional)
 * - generatePayrollSchema: Validate generate payroll (month 1-12, year >= 2000)
 * - updateEmployeeSchema: Validate cập nhật nhân viên (employeeCode, fullName, phone, email, position, baseSalary, shiftMoney, hireDate, address, isActive)
 * - setCountsSchema: Validate set số ca làm & vi phạm cho 1 employee (shiftCount, violationCount, month, year, violationType, shiftType, note)
 * - setCountsBulkSchema: Validate set số ca làm & vi phạm hàng loạt (employeeIds array, shiftCount, violationCount...)
 */
const { z } = require("zod");

const POSITIONS = ["MANAGER", "CASHIER", "SALES", "WAREHOUSE", "OTHER"];

const createEmployeeSchema = z.object({
  employeeCode: z.string().optional(),
  fullName: z.string().min(1, "Họ tên không được để trống"),
  phone: z.string().optional(),
  email: z.string().email("Email không hợp lệ").optional().or(z.literal("")),
  position: z.enum(POSITIONS).default("OTHER"),
  baseSalary: z.number().nonnegative().optional().default(0),
  hireDate: z.string().optional().nullable(),
  address: z.string().optional(),
});

const createShiftSchema = z.object({
  employeeId: z.string().uuid(),
  date: z.string().optional(),
  type: z.enum(["MORNING", "AFTERNOON", "NIGHT"]),
});

const createViolationSchema = z.object({
  employeeId: z.string().uuid(),
  type: z.enum([
    "LATE",
    "EARLY",
    "PACKING_ERROR",
    "DAMAGED_GOODS",
    "UNAUTHORIZED_ABSENCE",
  ]),
  note: z.string().optional(),
});

const updateViolationSchema = z.object({
  type: z
    .enum([
      "LATE",
      "EARLY",
      "PACKING_ERROR",
      "DAMAGED_GOODS",
      "UNAUTHORIZED_ABSENCE",
    ])
    .optional(),
  note: z.string().optional(),
  penalty: z.number().nonnegative().optional(),
});

const generatePayrollSchema = z.object({
  month: z.number().int().min(1).max(12),
  year: z.number().int().min(2000),
});

const updateEmployeeSchema = z.object({
  employeeCode: z.string().optional().nullable(),
  fullName: z.string().min(1).optional(),
  phone: z.string().optional().nullable(),
  email: z.union([z.string().email(), z.literal(""), z.null()]).optional(),
  position: z.enum(POSITIONS).optional(),
  baseSalary: z.number().nonnegative().optional().nullable(),
  shiftMoney: z.number().nonnegative().optional().nullable(),
  hireDate: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
});

const setCountsSchema = z.object({
  shiftCount: z.number().int().min(0).optional(),
  violationCount: z.number().int().min(0).optional(),
  month: z.number().int().min(1).max(12).optional(),
  year: z.number().int().min(2000).optional(),
  violationType: z
    .enum([
      "LATE",
      "EARLY",
      "PACKING_ERROR",
      "DAMAGED_GOODS",
      "UNAUTHORIZED_ABSENCE",
    ])
    .optional(),
  shiftType: z.enum(["MORNING", "AFTERNOON", "NIGHT"]).optional(),
  note: z.string().optional(),
});

const setCountsBulkSchema = z.object({
  employeeIds: z.array(z.string().uuid()).min(1),
  shiftCount: z.number().int().min(0).optional(),
  violationCount: z.number().int().min(0).optional(),
  month: z.number().int().min(1).max(12).optional(),
  year: z.number().int().min(2000).optional(),
  violationType: z
    .enum([
      "LATE",
      "EARLY",
      "PACKING_ERROR",
      "DAMAGED_GOODS",
      "UNAUTHORIZED_ABSENCE",
    ])
    .optional(),
  shiftType: z.enum(["MORNING", "AFTERNOON", "NIGHT"]).optional(),
  note: z.string().optional(),
});

module.exports = {
  createEmployeeSchema,
  createShiftSchema,
  createViolationSchema,
  generatePayrollSchema,
  updateEmployeeSchema,
  setCountsSchema,
  setCountsBulkSchema,
};
