/**
 * modules/hr/hr.routes.js — Định tuyến module Nhân sự
 *
 * Tổng quan:
 * - Định nghĩa các endpoint REST cho HR: nhân viên, chấm công, bảng lương, vi phạm, ca làm
 * - Tất cả routes đều yêu cầu authenticate + requireModule("hr")
 * - Một số routes giới hạn quyền ADMIN/MANAGER qua authorize()
 *
 * Hàm:
 * - GET /employees → controller.listEmployees
 * - POST /employees → controller.createEmployee (ADMIN, MANAGER)
 * - PUT /employees/:id → controller.updateEmployee (ADMIN, MANAGER)
 * - DELETE /employees/:id → controller.deleteEmployee (ADMIN)
 * - PATCH /employees/:id → controller.updateEmployee (ADMIN, MANAGER)
 * - PATCH /employees/bulk/counts → controller.setBulkCounts (ADMIN)
 * - PATCH /employees/:id/counts → controller.setEmployeeCounts (ADMIN)
 * - GET /attendance → controller.listAttendance
 * - GET /payroll → controller.listPayroll (ADMIN, MANAGER)
 * - POST /payroll/calculate → controller.calculatePayroll (ADMIN, MANAGER)
 * - POST /shifts → controller.createShift (ADMIN)
 * - POST /violations → controller.createViolation (ADMIN, kèm checkFeature hrViolations)
 * - PATCH /violations/:id → controller.updateViolation (ADMIN, kèm checkFeature hrViolations)
 * - POST /payrolls/generate → controller.generatePayroll (ADMIN, MANAGER)
 * - POST /payrolls/:id/lock → controller.lockPayroll (ADMIN, MANAGER, kèm checkFeature hrPayrollLock)
 */
const express = require("express");
const router = express.Router();
const { authenticate, authorize } = require("../../middleware/auth.middleware");
const { requireModule, checkFeature } = require("../../middleware/plan.middleware");
const controller = require("./hr.controller");

router.use(authenticate, requireModule("hr"));

router.get("/employees", authenticate, authorize("ADMIN", "MANAGER"), controller.listEmployees);
router.post(
  "/employees",
  authenticate,
  authorize("ADMIN", "MANAGER"),
  controller.createEmployee,
);
router.put(
  "/employees/:id",
  authenticate,
  authorize("ADMIN", "MANAGER"),
  controller.updateEmployee,
);
router.delete(
  "/employees/:id",
  authenticate,
  authorize("ADMIN"),
  controller.deleteEmployee,
);
router.get("/attendance", authenticate, authorize("ADMIN", "MANAGER"), controller.listAttendance);
router.get("/payroll", authenticate, authorize("ADMIN", "MANAGER"), controller.listPayroll);
router.post(
  "/payroll/calculate",
  authenticate,
  authorize("ADMIN", "MANAGER"),
  controller.calculatePayroll,
);
router.patch(
  "/employees/:id",
  authenticate,
  authorize("ADMIN", "MANAGER"),
  controller.updateEmployee,
);
router.post(
  "/shifts",
  authenticate,
  authorize("ADMIN"),
  controller.createShift,
);
router.post(
  "/violations",
  authenticate,
  authorize("ADMIN"),
  checkFeature("hrViolations"),
  controller.createViolation,
);
router.patch(
  "/violations/:id",
  authenticate,
  authorize("ADMIN"),
  checkFeature("hrViolations"),
  controller.updateViolation,
);
// Admin-only: bulk must come before :id to avoid Express shadowing
router.patch(
  "/employees/bulk/counts",
  authenticate,
  authorize("ADMIN"),
  controller.setBulkCounts,
);
router.patch(
  "/employees/:id/counts",
  authenticate,
  authorize("ADMIN"),
  controller.setEmployeeCounts,
);
router.post(
  "/payrolls/generate",
  authenticate,
  authorize("ADMIN", "MANAGER"),
  controller.generatePayroll,
);
router.post(
  "/payrolls/:id/lock",
  authenticate,
  authorize("ADMIN", "MANAGER"),
  checkFeature("hrPayrollLock"),
  controller.lockPayroll,
);

// ─── Leave Requests ───
const leaveSvc = require("./leave.service");

router.post(
  "/leave",
  authenticate,
  async (req, res, next) => {
    try {
      const result = await leaveSvc.create(
        req.body.employeeId || req.user.employee?.id,
        req.user.id,
        req.body,
      );
      res.json(result);
    } catch (e) { next(e); }
  }
);

router.get(
  "/leave/:employeeId?",
  authenticate,
  async (req, res, next) => {
    try {
      res.json({ success: true, data: await leaveSvc.list(req.params.employeeId) });
    } catch (e) { next(e); }
  }
);

// ─── Department CRUD ───
router.get("/departments", authenticate, authorize("ADMIN", "MANAGER"), controller.listDepartments);
router.post("/departments", authenticate, authorize("ADMIN", "MANAGER"), controller.createDepartment);
router.put("/departments/:id", authenticate, authorize("ADMIN", "MANAGER"), controller.updateDepartment);
router.delete("/departments/:id", authenticate, authorize("ADMIN"), controller.deleteDepartment);

// ─── Overtime Requests ───
const overtimeSvc = require("./overtime.service");

router.post("/overtime", authenticate, async (req, res, next) => {
  try {
    const result = await overtimeSvc.create(
      req.body.employeeId || req.user.employee?.id, req.user.id, req.body
    );
    res.json({ success: true, data: result });
  } catch (e) { next(e); }
});

router.get("/overtime", authenticate, async (req, res, next) => {
  try {
    res.json({ success: true, data: await overtimeSvc.list(
      req.query.employeeId, parseInt(req.query.month), parseInt(req.query.year)
    ) });
  } catch (e) { next(e); }
});

module.exports = router;
