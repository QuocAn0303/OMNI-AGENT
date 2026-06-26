/**
 * modules/categories/category.service.js — Service quản lý danh mục sản phẩm
 * 
 * Tổng quan:
 * - CRUD danh mục sản phẩm, kiểm tra trùng tên, chặn xóa danh mục đang chứa sản phẩm
 * 
 * Hàm:
 * - getAll(): Lấy tất cả danh mục đang hoạt động (isActive: true), kèm số lượng sản phẩm, sắp xếp theo ngày tạo
 * - create(data): Tạo danh mục mới, kiểm tra trùng tên, throw 400 nếu đã tồn tại
 * - update(id, data): Cập nhật tên/mô tả danh mục, throw 404 nếu không tìm thấy hoặc đã bị xóa
 * - remove(id): Soft delete danh mục, chặn xóa nếu danh mục còn chứa sản phẩm (throw 400)
 */
const prisma = require("../../config/prisma");

const categoryService = {
  // 1. Lấy danh sách danh mục (Chỉ lấy danh mục đang hoạt động)
  getAll: async () => {
    return await prisma.category.findMany({
      where: { isActive: true },
      // Sắp xếp theo ngày tạo thay vì ID (vì UUID không thể sắp xếp 1, 2, 3)
      orderBy: { createdAt: "asc" }, 
      include: { _count: { select: { products: true } } }, 
    });
  },

  // 2. Tạo danh mục mới
  create: async (data) => {
    const existing = await prisma.category.findFirst({
      where: { name: data.name, isActive: true },
    });
    
    if (existing) {
      const err = new Error("Tên danh mục này đã tồn tại trong hệ thống.");
      err.status = 400;
      throw err;
    }

    return await prisma.category.create({
      data: {
        name: data.name,
        description: data.description,
        isActive: true,
      },
    });
  },

  // 3. Cập nhật danh mục
  update: async (id, data) => {
    const category = await prisma.category.findUnique({ where: { id } });
    
    if (!category || !category.isActive) {
      const err = new Error("Không tìm thấy danh mục này hoặc danh mục đã bị xóa.");
      err.status = 404;
      throw err;
    }

    return await prisma.category.update({
      where: { id },
      data: {
        name: data.name,
        description: data.description,
      },
    });
  },

  // 4. Xóa mềm danh mục (Chuyển isActive = false)
  remove: async (id) => {
    const category = await prisma.category.findUnique({
      where: { id },
      include: { _count: { select: { products: true } } }
    });

    if (!category || !category.isActive) {
      const err = new Error("Không tìm thấy danh mục này hoặc danh mục đã bị xóa.");
      err.status = 404;
      throw err;
    }

    // Chặn xóa nếu danh mục đang chứa sản phẩm
    if (category._count.products > 0) {
      const err = new Error(`Không thể xóa! Danh mục này đang chứa ${category._count.products} sản phẩm. Hãy chuyển sản phẩm sang danh mục khác trước.`);
      err.status = 400;
      throw err;
    }

    return await prisma.category.update({
      where: { id },
      data: { isActive: false },
    });
  }
};

module.exports = categoryService;