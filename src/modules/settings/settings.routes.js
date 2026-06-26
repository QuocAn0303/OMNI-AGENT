/**
 * modules/settings/settings.routes.js — Routes cho cài đặt công ty
 * 
 * Tổng quan:
 * - REST API cho settings module
 * 
 * Routes:
 * - GET /: Lấy thông tin công ty
 * - PUT /: Cập nhật thông tin công ty (ADMIN, chỉ cho phép các field: name, address, phone, email, taxCode, logo, industry, currency)
 * - PUT /onboarding: Cập nhật bước onboarding (ADMIN)
 */
const express = require('express');
const multer = require('multer');
const { authenticate, authorize } = require('../../middleware/auth.middleware');
const settingsService = require('./settings.service');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// GET /api/settings
router.get('/', authenticate, async (req, res, next) => {
  try {
    const settings = await settingsService.getOrCreate();
    res.json({ success: true, data: settings });
  } catch (err) { next(err); }
});

// PUT /api/settings
router.put('/', authenticate, authorize('ADMIN'), async (req, res, next) => {
  try {
    const allowed = ['name', 'address', 'phone', 'email', 'taxCode', 'logo', 'industry', 'currency'];
    const data = Object.fromEntries(
      Object.entries(req.body).filter(([k]) => allowed.includes(k))
    );
    const settings = await settingsService.update(data);
    res.json({ success: true, data: settings });
  } catch (err) { next(err); }
});

// PUT /api/settings/onboarding
router.put('/onboarding', authenticate, authorize('ADMIN'), async (req, res, next) => {
  try {
    const { step, done } = req.body;
    const settings = await settingsService.updateOnboardingStep(Number(step), !!done);
    res.json({ success: true, data: settings });
  } catch (err) { next(err); }
});

// POST /api/settings/seed-demo — quick-start demo data
router.post('/seed-demo', authenticate, authorize('ADMIN'), async (req, res, next) => {
  try {
    const prisma = require('../../config/prisma');
    const settings = await settingsService.getOrCreate();
    if (settings.demoSeeded) {
      return res.json({ success: true, data: { message: 'Demo data already seeded', created: 0 } });
    }

    const warehouse = await prisma.warehouse.create({
      data: { name: 'Kho chính', address: settings.address || '', isDefault: true },
    });

    const category = await prisma.category.create({
      data: { name: 'Sản phẩm mẫu', description: 'Danh mục mẫu' },
    });

    const products = await Promise.all([
      prisma.product.create({ data: { name: 'Áo thun nam', sku: 'AT001', categoryId: category.id, price: 150000, costPrice: 80000, unit: 'cái' } }),
      prisma.product.create({ data: { name: 'Áo sơ mi', sku: 'AS001', categoryId: category.id, price: 250000, costPrice: 120000, unit: 'cái' } }),
      prisma.product.create({ data: { name: 'Quần jeans', sku: 'QJ001', categoryId: category.id, price: 350000, costPrice: 180000, unit: 'cái' } }),
      prisma.product.create({ data: { name: 'Giày thể thao', sku: 'GT001', categoryId: category.id, price: 500000, costPrice: 300000, unit: 'đôi' } }),
      prisma.product.create({ data: { name: 'Túi xách', sku: 'TX001', categoryId: category.id, price: 450000, costPrice: 250000, unit: 'cái' } }),
      prisma.product.create({ data: { name: 'Đồng hồ', sku: 'DH001', categoryId: category.id, price: 800000, costPrice: 450000, unit: 'cái' } }),
      prisma.product.create({ data: { name: 'Kính mát', sku: 'KM001', categoryId: category.id, price: 180000, costPrice: 90000, unit: 'cái' } }),
      prisma.product.create({ data: { name: 'Nón lưỡi trai', sku: 'NL001', categoryId: category.id, price: 120000, costPrice: 60000, unit: 'cái' } }),
      prisma.product.create({ data: { name: 'Vớ thể thao', sku: 'VT001', categoryId: category.id, price: 45000, costPrice: 20000, unit: 'đôi' } }),
      prisma.product.create({ data: { name: 'Áo khoác gió', sku: 'AK001', categoryId: category.id, price: 420000, costPrice: 220000, unit: 'cái' } }),
    ]);

    for (const p of products) {
      await prisma.inventory.create({
        data: { productId: p.id, warehouseId: warehouse.id, quantity: 100, minStock: 10 },
      });
    }

    const customers = await Promise.all([
      prisma.customer.create({ data: { name: 'Nguyễn Văn A', phone: '0901234567', email: 'a@email.com', address: '123 Nguyễn Huệ, Q1' } }),
      prisma.customer.create({ data: { name: 'Trần Thị B', phone: '0902234568', email: 'b@email.com', address: '456 Lê Lợi, Q3' } }),
      prisma.customer.create({ data: { name: 'Lê Văn C', phone: '0903234569', email: 'c@email.com', address: '789 Hai Bà Trưng, Q1' } }),
      prisma.customer.create({ data: { name: 'Phạm Thị D', phone: '0904234570', email: 'd@email.com', address: '321 Võ Văn Tần, Q3' } }),
      prisma.customer.create({ data: { name: 'Hoàng Văn E', phone: '0905234571', email: 'e@email.com', address: '654 Điện Biên Phủ, Bình Thạnh' } }),
    ]);

    const vendors = await Promise.all([
      prisma.vendor.create({ data: { name: 'Công ty TNHH May mặc ABC', code: 'ABC', contactPerson: 'Nguyễn Văn F', phone: '0281234567', taxCode: '0301234567' } }),
      prisma.vendor.create({ data: { name: 'Công ty CP Giày dép XYZ', code: 'XYZ', contactPerson: 'Trần Văn G', phone: '0282234567', taxCode: '0302234567' } }),
      prisma.vendor.create({ data: { name: 'Nhà phân phối Phụ kiện 123', code: 'PK123', contactPerson: 'Lê Thị H', phone: '0283234567', taxCode: '0303234567' } }),
    ]);

    const order = await prisma.order.create({
      data: {
        orderCode: await (async () => {
          const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
          const count = await prisma.order.count({ where: { createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) } } });
          return `ORD-${today}-${String(count + 1).padStart(4, '0')}`;
        })(),
        customerId: customers[0].id,
        status: 'COMPLETED',
        paymentStatus: 'PAID',
        paymentMethod: 'CASH',
        subtotal: 500000,
        total: 500000,
        items: { create: [{ productId: products[0].id, quantity: 2, price: 150000, subtotal: 300000 }, { productId: products[3].id, quantity: 1, price: 200000, subtotal: 200000 }] },
        payments: { create: [{ amount: 500000, method: 'CASH', paidAt: new Date() }] },
      },
    });

    await settingsService.update({ demoSeeded: true });

    // Seed template workflows
    try {
      const workflowService = require("../workflow/workflow.service");
      const existing = await prisma.workflow.count();
      if (existing === 0) {
        await workflowService.createWorkflow(req.user.id, {
          name: "Duyet chi phi > 5 trieu",
          trigger: "EXPENSE_ABOVE",
          config: { threshold: 5000000 },
          steps: [{ sequence: 1, type: "APPROVAL", config: { approverId: req.user.id } }],
        });
        await workflowService.createWorkflow(req.user.id, {
          name: "Duyet PO > 10 trieu",
          trigger: "PO_ABOVE",
          config: { threshold: 10000000 },
          steps: [{ sequence: 1, type: "APPROVAL", config: { approverId: req.user.id } }],
        });
        await workflowService.createWorkflow(req.user.id, {
          name: "Duyet nghi phep",
          trigger: "LEAVE_REQUEST",
          config: {},
          steps: [{ sequence: 1, type: "APPROVAL", config: { approverId: req.user.id } }],
        });
      }
    } catch (e) {
      console.error("[settings] workflow seed error:", e.message);
    }

    res.json({
      success: true,
      data: {
        message: 'Đã tạo dữ liệu mẫu thành công',
        created: { products: products.length, customers: customers.length, vendors: vendors.length, orders: 1, warehouse: 1 },
      },
    });
  } catch (err) { next(err); }
});

module.exports = router;
