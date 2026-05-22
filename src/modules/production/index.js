// src/modules/production/index.js
const router = require("express").Router();
const workOrderService = require("./work-order.service");
const { authenticate } = require("../../middleware/auth.middleware");
const { success } = require("../../utils/response");

// GET /api/production/overview — stats
router.get("/overview", authenticate, async (req, res, next) => {
  try {
    success(res, await workOrderService.overview());
  } catch (err) {
    next(err);
  }
});

router.use("/boms", require("./bom.routes"));
router.use("/work-orders", require("./work-order.routes"));
router.use("/work-centers", require("./work-center.routes"));
router.use("/routings", require("./routing.routes"));
router.use("/lots", require("./lot.routes"));

module.exports = router;
