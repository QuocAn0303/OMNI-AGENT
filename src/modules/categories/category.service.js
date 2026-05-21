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