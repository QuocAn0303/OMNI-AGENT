/**
 * modules/audit/audit.routes.js — Routes cho audit log
 * 
 * Tổng quan:
 * - REST API cho audit module
 * - Yêu cầu module "audit" trong plan
 * - ADMIN/SUPER_ADMIN: xem log của tenant mình
 * - SUPER_OMEGA_ULTRA_ADMIN: xem log tất cả tenants
 * 
 * Routes:
 * - GET /: Danh sách audit log phân trang, lọc theo action/userId
 */
// src/modules/audit/audit.routes.js
const router = require("express").Router();
const { authenticate, authorize } = require("../../middleware/auth.middleware");
const { requireModule } = require("../../middleware/plan.middleware");
const auditService = require("./audit.service");
const { paginated } = require("../../utils/response");

// ADMIN / SUPER_ADMIN: xem log của tenant mình
// SUPER_OMEGA_ULTRA_ADMIN: xem log của tất cả tenants
router.use(authenticate, authorize("ADMIN", "SUPER_ADMIN", "SUPER_OMEGA_ULTRA_ADMIN"), requireModule("audit"));

// GET /api/audit?page=1&limit=50
router.get("/", async (req, res, next) => {
  try {
    const { logs, pagination } = await auditService.getAll({ ...req.query, user: req.user });
    paginated(res, logs, pagination);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
