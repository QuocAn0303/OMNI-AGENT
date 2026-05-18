const express = require("express");
const router = express.Router();
const { authenticate, authorize } = require("../../middleware/auth.middleware");
const controller = require("./hr.controller");

router.get("/employees", authenticate, controller.listEmployees);
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
router.get("/attendance", authenticate, controller.listAttendance);
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
  controller.createViolation,
);
router.patch(
  "/violations/:id",
  authenticate,
  authorize("ADMIN"),
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
  controller.lockPayroll,
);

module.exports = router;
