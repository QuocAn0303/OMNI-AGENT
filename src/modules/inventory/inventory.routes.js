/**
 * modules/inventory/inventory.routes.js — Routes quản lý tồn kho
 * 
 * Tổng quan:
 * - Các endpoint nhập/xuất/kiểm kho, cảnh báo, lịch sử giao dịch
 * - Yêu cầu authenticate + module inventory, mount cycle-count routes
 * 
 * Endpoints:
 * - GET /: Danh sách tồn kho theo warehouse
 * - POST /import: Nhập kho (ADMIN, MANAGER, WAREHOUSE)
 * - POST /export: Xuất kho (ADMIN, MANAGER, WAREHOUSE)
 * - POST /adjust: Kiểm kho/điều chỉnh (ADMIN, WAREHOUSE)
 * - GET /low-stock: Hàng sắp hết (ADMIN, WAREHOUSE, MANAGER)
 * - GET /alerts: Cảnh báo tồn kho critical/warning (ADMIN, MANAGER, WAREHOUSE)
 * - GET /transactions: Lịch sử giao dịch (ADMIN, WAREHOUSE)
 * 
 * Validation:
 * - importSchema, exportSchema, adjustSchema với Zod
 */
const router = require("express").Router();
const inventoryService = require("./inventory.service");
const cycleCountRoutes = require("./cyclecount.routes");
const { authenticate, authorize } = require("../../middleware/auth.middleware");
const { requireModule } = require("../../middleware/plan.middleware");
const { success } = require("../../utils/response");
const { exportToExcel } = require("../../utils/exporter");
const prisma = require("../../config/prisma");
const { z } = require("zod");

router.use(authenticate, requireModule("inventory"));
router.use("/cycle-counts", cycleCountRoutes);

/**
 * Quy tắc nhập hàng (Odoo `Reordering Rules`).
 *
 * Ghi vào `Inventory` theo (sản phẩm × kho) — đúng chỗ `minStock` đã nằm. Trường
 * `null` = "chưa cấu hình" ⇒ động cơ dùng mặc định của hệ thống (lead time đo
 * được từ lịch sử PO→GRN, serviceLevel 0,95, bán lẻ từng cái). KHÔNG dùng 0
 * làm "chưa cấu hình" vì 0 là giá trị có nghĩa (tồn tối thiểu bằng 0).
 *
 * Miền giá trị được chặn ở CẢ ba tầng: Zod (báo lỗi cho UI), CHECK constraint ở DB
 * (chặn cả script/import chạy ngoài app), và `calcSafetyStock` ném 400 khi service
 * level ngoài bảng z.
 */
const ruleSchema = z.object({
  minStock: z.number().int().min(0).optional(),
  maxStock: z.number().int().positive().nullable().optional(),
  leadTimeDays: z.number().int().positive().nullable().optional(),
  packMultiple: z.number().int().min(1).max(100000).optional(),
  serviceLevel: z.number().gt(0).lt(1).nullable().optional(),
});

/** @swagger
 * /api/inventory/rules:
 *   get:
 *     summary: Xem quy tắc nhập hàng của SKU trong kho
 *     tags: [Inventory]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: productId
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: warehouseId
 *         schema: { type: string }
 *     responses:
 *       200: { description: Danh sách quy tắc }
 */
router.get("/rules", authorize("ADMIN", "MANAGER", "WAREHOUSE"), async (req, res, next) => {
  try {
    const { productId, warehouseId } = req.query;
    const where = {};
    if (productId) where.productId = productId;
    if (warehouseId) where.warehouseId = warehouseId;
    const rows = await prisma.inventory.findMany({
      where,
      orderBy: [{ product: { sku: "asc" } }],
      select: {
        id: true, productId: true, warehouseId: true, quantity: true, reserved: true,
        minStock: true, maxStock: true, leadTimeDays: true, packMultiple: true, serviceLevel: true,
        product: { select: { sku: true, name: true, costPrice: true } },
        warehouse: { select: { code: true, name: true, isDefault: true } },
      },
    });
    success(res, rows);
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/inventory/rules:
 *   put:
 *     summary: Cập nhật quy tắc nhập hàng cho (sản phẩm × kho)
 *     tags: [Inventory]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Đã lưu quy tắc }
 *       400: { description: Giá trị ngoài miền cho phép }
 */
router.put("/rules", authorize("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    const { inventoryId, ...rest } = req.body || {};
    if (!inventoryId) throw { status: 400, message: "Thiếu inventoryId" };
    const data = ruleSchema.parse(rest);

    const inv = await prisma.inventory.update({
      where: { id: inventoryId },
      data: {
        ...(data.minStock !== undefined ? { minStock: data.minStock } : {}),
        ...(data.maxStock !== undefined ? { maxStock: data.maxStock } : {}),
        ...(data.leadTimeDays !== undefined ? { leadTimeDays: data.leadTimeDays } : {}),
        ...(data.packMultiple !== undefined ? { packMultiple: data.packMultiple } : {}),
        ...(data.serviceLevel !== undefined ? { serviceLevel: data.serviceLevel } : {}),
      },
      select: {
        id: true, productId: true, warehouseId: true, minStock: true, maxStock: true,
        leadTimeDays: true, packMultiple: true, serviceLevel: true,
        product: { select: { sku: true, name: true } },
      },
    });

    // Ghi nhận thay đổi chính sách tồn kho — ai đổi, đổi sang gì, từ gì.
    const auditService = require("../audit/audit.service");
    await auditService.log({
      userId: req.user.id,
      action: "UPDATE_REPLENISHMENT_RULE",
      entity: "Inventory",
      entityId: inv.id,
      after: {
        productId: inv.productId,
        sku: inv.product?.sku,
        minStock: inv.minStock,
        maxStock: inv.maxStock,
        leadTimeDays: inv.leadTimeDays,
        packMultiple: inv.packMultiple,
        serviceLevel: inv.serviceLevel,
      },
    });

    success(res, inv, "Đã lưu quy tắc nhập hàng");
  } catch (err) {
    next(err);
  }
});

router.get("/", authorize("ADMIN", "MANAGER", "WAREHOUSE"), async (req, res, next) => {
  try {
    const { warehouseId, page, limit } = req.query;
    const result = await inventoryService.listByWarehouse(warehouseId, Number(page) || 1, Number(limit) || 50);
    success(res, result.data);
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/inventory/export:
 *   get:
 *     summary: Xuất danh sách tồn kho ra Excel (ADMIN, MANAGER)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: warehouseId
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: File .xlsx }
 */
router.get("/export", authorize("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    const { warehouseId } = req.query;
    const where = { ...(warehouseId ? { warehouseId } : {}) };
    const items = await prisma.inventory.findMany({
      where,
      include: {
        product: { select: { sku: true, name: true, unit: true, costPrice: true } },
        warehouse: { select: { name: true } },
      },
      take: 10000,
    });
    const buf = await exportToExcel(
      items.map((i) => ({
        sku: i.product?.sku || "",
        name: i.product?.name || "",
        warehouse: i.warehouse?.name || "",
        quantity: i.quantity,
        reserved: i.reserved || 0,
        minStock: i.minStock || 0,
        costPrice: Number(i.product?.costPrice || 0),
      })),
      [
        { header: "SKU", key: "sku" },
        { header: "Tên sản phẩm", key: "name" },
        { header: "Kho", key: "warehouse" },
        { header: "Tồn kho", key: "quantity" },
        { header: "Đã đặt", key: "reserved" },
        { header: "Tồn tối thiểu", key: "minStock" },
        { header: "Giá vốn", key: "costPrice" },
      ],
      "Tồn kho"
    );
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename=ton-kho_${Date.now()}.xlsx`);
    res.send(Buffer.from(buf));
  } catch (e) { next(e); }
});

const importSchema = z.object({
  productId: z.string({ required_error: "Thiếu ID sản phẩm" }).uuid(),
  quantity: z
    .number()
    .int()
    .positive({ message: "Số lượng nhập phải lớn hơn 0" }),
  unitCost: z.number().min(0).optional(),
  note: z.string().optional(),
  warehouseId: z.string().uuid().optional(),
  lotCode: z.string().optional(),
  expDate: z.string().optional(),
  mfgDate: z.string().optional(),
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
