// src/modules/audit/audit.routes.js
const router = require("express").Router();
const { authenticate, authorize } = require("../../middleware/auth.middleware");
const auditService = require("./audit.service");
const { paginated } = require("../../utils/response");

// Chỉ Admin mới được xem log
router.use(authenticate, authorize("ADMIN"));

// GET /api/audit?page=1&limit=50
router.get("/", async (req, res, next) => {
  try {
    const { logs, pagination } = await auditService.getAll(req.query);
    paginated(res, logs, pagination);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
