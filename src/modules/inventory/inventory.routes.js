const router = require("express").Router();
const inventoryService = require("./inventory.service");
const cycleCountRoutes = require("./cyclecount.routes");
const { authenticate, authorize } = require("../../middleware/auth.middleware");
const { success } = require("../../utils/response");
const { z } = require("zod");

router.use(authenticate);
router.use("/cycle-counts", cycleCountRoutes);

router.get("/", authorize("ADMIN", "MANAGER", "WAREHOUSE"), async (req, res, next) => {
  try {
    const rows = await inventoryService.listByWarehouse(req.query.warehouseId);
    success(res, rows);
  } catch (err) {
    next(err);
  }
});

const importSchema = z.object({
  productId: z.string({ required_error: "Thiếu ID sản phẩm" }).uuid(),
  quantity: z
    .number()
    .int()
    .positive({ message: "Số lượng nhập phải lớn hơn 0" }),
  note: z.string().optional(),
  warehouseId: z.string().uuid().optional(),
});

const exportSchema = z.object({
  productId: z.string({ required_error: "Thiếu ID sản phẩm" }).uuid(),
  quantity: z
    .number()
    .int()
    .positive({ message: "Số lượng xuất phải lớn hơn 0" }),
  note: z.string().optional(),
  warehouseId: z.string().uuid().optional(),
});

const adjustSchema = z.object({
  productId: z.string({ required_error: "Thiếu ID sản phẩm" }).uuid(),
  actualQuantity: z
    .number()
    .int()
    .min(0, { message: "Số lượng thực tế không được âm" }),
  note: z.string().optional(),
  warehouseId: z.string().uuid().optional(),
});
// -------------------

// Nhập kho - ADMIN, MANAGER, WAREHOUSE
router.post(
  "/import",
  authorize("ADMIN", "MANAGER", "WAREHOUSE"),
  async (req, res, next) => {
    try {
      const validatedData = importSchema.parse(req.body);
      const result = await inventoryService.importStock(
        validatedData,
        req.user.id,
      );
      success(res, result, "Nhập kho thành công");
    } catch (err) {
      next(err);
    }
  },
);

// Xuất kho - ADMIN, MANAGER, WAREHOUSE
router.post(
  "/export",
  authorize("ADMIN", "MANAGER", "WAREHOUSE"),
  async (req, res, next) => {
    try {
      const validatedData = exportSchema.parse(req.body);
      const result = await inventoryService.exportStock(
        validatedData,
        req.user.id,
      );
      success(res, result, "Xuất kho thành công");
    } catch (err) {
      next(err);
    }
  },
);

// Kiểm kho/Điều chỉnh
router.post(
  "/adjust",
  authorize("ADMIN", "WAREHOUSE"),
  async (req, res, next) => {
    try {
      const validatedData = adjustSchema.parse(req.body);
      const result = await inventoryService.adjustment(
        validatedData,
        req.user.id,
      );
      success(res, result, "Điều chỉnh kho thành công");
    } catch (err) {
      next(err);
    }
  },
);

// Lấy danh sách hàng sắp hết
router.get(
  "/low-stock",
  authorize("ADMIN", "WAREHOUSE", "MANAGER"),
  async (req, res, next) => {
    try {
      let threshold = 5;
      if (req.query.threshold && !isNaN(req.query.threshold)) {
        threshold = Number(req.query.threshold);
      }
      const products = await inventoryService.getLowStock(threshold);
      success(res, products);
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/alerts",
  authorize("ADMIN", "MANAGER", "WAREHOUSE"),
  async (req, res, next) => {
    try {
      const alerts = await inventoryService.checkAlerts();
      success(res, alerts);
    } catch (err) {
      next(err);
    }
  },
);

// Xem lịch sử giao dịch
router.get(
  "/transactions",
  authorize("ADMIN", "WAREHOUSE"),
  async (req, res, next) => {
    try {
      const logs = await inventoryService.getTransactions(req.query);
      success(res, logs);
    } catch (err) {
      next(err);
    }
  },
);

module.exports = router;
