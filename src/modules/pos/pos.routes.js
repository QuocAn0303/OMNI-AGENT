const router = require("express").Router();
const { authenticate, authorize } = require("../../middleware/auth.middleware");
const { requireModule } = require("../../middleware/plan.middleware");
const controller = require("./pos.controller");

router.use(authenticate, requireModule("pos"));
router.use(authorize("ADMIN", "MANAGER", "CASHIER"));

router.get("/products", controller.listProducts);
router.get("/categories", controller.listCategories);
router.get("/products/sku/:sku", controller.findBySku);
router.post("/orders", controller.createOrder);

module.exports = router;
