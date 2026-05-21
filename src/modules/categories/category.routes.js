const express = require("express");
const router = express.Router();
const categoryService = require("./category.service");
const { authenticate, authorize } = require("../../middleware/auth.middleware"); // Đưa về chuẩn cũ
const { success } = require("../../utils/response"); // Đưa về chuẩn cũ
const { z } = require("zod");

// --- ZOD SCHEMA ---
const categorySchema = z.object({
  name: z.string().min(1, { message: "Tên danh mục không được để trống" }),
  description: z.string().optional().nullable()
});

// Chặn xác thực người dùng cho toàn bộ router
router.use(authenticate);

// GET: Lấy danh sách danh mục (Tất cả nhân viên đều xem được)
router.get("/", async (req, res, next) => {
  try {
    const categories = await categoryService.getAll();
    success(res, categories, "Lấy danh sách danh mục thành công");
  } catch (error) {
    next(error);
  }
});

// POST: Tạo danh mục mới (Chỉ ADMIN hoặc MANAGER)
router.post("/", authorize("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    const validatedData = categorySchema.parse(req.body);
    const newCategory = await categoryService.create(validatedData);
    // Trả về mã 201 Created
    res.status(201); 
    success(res, newCategory, "Tạo danh mục thành công");
  } catch (error) {
    next(error);
  }
});

// PUT: Cập nhật danh mục
router.put("/:id", authorize("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    const validatedData = categorySchema.parse(req.body);
    const updated = await categoryService.update(req.params.id, validatedData);
    success(res, updated, "Cập nhật danh mục thành công");
  } catch (error) {
    next(error);
  }
});

// DELETE: Xóa danh mục (Thường chỉ dành cho ADMIN)
router.delete("/:id", authorize("ADMIN"), async (req, res, next) => {
  try {
    await categoryService.remove(req.params.id);
    success(res, null, "Xóa danh mục thành công");
  } catch (error) {
    next(error);
  }
});

module.exports = router;