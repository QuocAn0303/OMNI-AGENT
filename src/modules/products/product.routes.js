// src/modules/products/product.routes.js
const router = require("express").Router();
const { z } = require("zod");
const productService = require("./product.service");
const { authenticate, authorize } = require("../../middleware/auth.middleware");
const { success, created, paginated } = require("../../utils/response");
const uploadCloud = require("../../config/cloudinary.config");

const productSchema = z.object({
  sku: z.string().min(1, "SKU không được để trống"),
  name: z.string().min(1, "Tên sản phẩm không được để trống"),
  description: z.string().optional(),
  price: z.number().positive("Giá bán phải lớn hơn 0"),
  costPrice: z.number().positive("Giá vốn phải lớn hơn 0"),
  unit: z.string().default("cái"),
  categoryId: z.string().uuid("Category ID không hợp lệ"),
  initialStock: z.number().int().min(0).default(0),
});

router.use(authenticate);

// Xuất Excel
router.get("/export-excel", async (req, res, next) => {
  try {
    const { products } = await productService.getAll({ page: 1, limit: 100000 });
    const ExcelJS = require("exceljs");
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Sản phẩm");

    sheet.columns = [
      { header: "SKU", key: "sku", width: 18 },
      { header: "Tên sản phẩm", key: "name", width: 35 },
      { header: "Danh mục", key: "category", width: 20 },
      { header: "Giá bán", key: "price", width: 15 },
      { header: "Giá vốn", key: "costPrice", width: 15 },
      { header: "Đơn vị", key: "unit", width: 10 },
      { header: "Tồn kho", key: "quantity", width: 12 },
    ];

    sheet.getRow(1).font = { bold: true };

    products.forEach((p) => {
      sheet.addRow({
        sku: p.sku,
        name: p.name,
        category: p.category?.name || "",
        price: Number(p.price),
        costPrice: Number(p.costPrice),
        unit: p.unit,
        quantity: p.inventory?.quantity ?? 0,
      });
    });

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", "attachment; filename=san-pham.xlsx");
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    next(err);
  }
});

// Xem danh sách - tất cả role
router.get("/", async (req, res, next) => {
  try {
    const { products, pagination } = await productService.getAll(req.query);
    paginated(res, products, pagination);
  } catch (err) {
    next(err);
  }
});

router.get("/sku/:sku", async (req, res, next) => {
  try {
    const product = await productService.findBySku(req.params.sku);
    success(res, product);
  } catch (err) {
    next(err);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const product = await productService.getById(req.params.id);
    success(res, product);
  } catch (err) {
    next(err);
  }
});

// Tạo/sửa/xóa - chỉ ADMIN và MANAGER
router.post("/", authorize("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    const data = productSchema.parse(req.body);
    const product = await productService.create(data, req.user.id);
    created(res, product, "Tạo sản phẩm thành công");
  } catch (err) {
    next(err);
  }
});

router.put("/:id", authorize("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    const data = productSchema.partial().parse(req.body);
    const product = await productService.update(req.params.id, data, req.user.id);
    success(res, product, "Cập nhật sản phẩm thành công");
  } catch (err) {
    next(err);
  }
});

// PATCH: partial update, supports image upload via multipart/form-data
router.patch(
  "/:id",
  authorize("ADMIN", "MANAGER"),
  uploadCloud.single("image"),
  async (req, res, next) => {
    try {
      const partialSchema = productSchema.partial();
      // merge body fields and file if provided
      const payload = { ...req.body };
      if (req.file) payload.imageUrl = req.file.path;
      // convert numeric fields
      if (payload.price != null) payload.price = Number(payload.price);
      if (payload.costPrice != null) payload.costPrice = Number(payload.costPrice);
      if (payload.initialStock != null)
        payload.initialStock = Number(payload.initialStock);

      const data = partialSchema.parse(payload);
      const updated = await productService.update(req.params.id, data, req.user.id);
      success(res, updated, "Cập nhật một phần sản phẩm thành công");
    } catch (err) {
      next(err);
    }
  },
);

// Cập nhật cài đặt tồn kho (minStock)
router.patch("/:id/inventory", authorize("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    const inventory = await productService.updateInventorySettings(req.params.id, req.body);
    success(res, inventory, "Cập nhật cài đặt tồn kho thành công");
  } catch (err) {
    next(err);
  }
});

// API: POST /api/products/:id/image
router.post(
  "/:id/image",
  authorize("ADMIN", "MANAGER"),
  uploadCloud.single("image"),
  async (req, res, next) => {
    try {
      if (!req.file) {
        throw { status: 400, message: "Vui lòng chọn một file ảnh để upload" };
      }

      const imageUrl = req.file.path;

      const updatedProduct = await productService.updateImage(
        req.params.id,
        imageUrl,
      );

      success(res, updatedProduct, "Upload ảnh sản phẩm thành công");
    } catch (err) {
      next(err);
    }
  },
);

router.delete("/:id", authorize("ADMIN"), async (req, res, next) => {
  try {
    await productService.remove(req.params.id, req.user.id);
    success(res, null, "Xóa sản phẩm thành công");
  } catch (err) {
    next(err);
  }
});

module.exports = router;
