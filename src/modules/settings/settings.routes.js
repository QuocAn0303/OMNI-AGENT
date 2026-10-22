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
const BUSINESS_TEMPLATES = require('../../config/business-templates');
const { success, created } = require('../../utils/response');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    // M9: chặn SVG — stored XSS (script bên trong SVG chạy khi trình duyệt render)
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    const ext = (file.originalname || '').toLowerCase().match(/\.(jpe?g|png|webp)$/);
    if (allowed.includes(file.mimetype) && ext) cb(null, true);
    else cb(new Error('Chỉ chấp nhận file ảnh (JPEG, PNG, WebP)'));
  },
});

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

    // M9: logo phải là URL http(s) hoặc data-URI ảnh raster — chặn SVG (stored XSS)
    if (typeof data.logo === 'string' && data.logo) {
      const svgPattern = /\.svg($|\?)|data:image\/svg\+xml|<svg/i;
      if (svgPattern.test(data.logo)) {
        throw { status: 400, message: 'Không hỗ trợ logo SVG — dùng PNG, JPEG hoặc WebP' };
      }
      const valid = /^(https?:\/\/|data:image\/(png|jpe?g|webp)[;,])/i.test(data.logo);
      if (!valid) {
        throw { status: 400, message: 'Logo phải là URL http(s) hoặc ảnh PNG/JPEG/WebP' };
      }
    }

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

// PUT /api/settings/beginner-mode
router.put('/beginner-mode', authenticate, authorize('ADMIN'), async (req, res, next) => {
  try {
    const { enabled } = req.body;
    const settings = await settingsService.setBeginnerMode(!!enabled);
    res.json({ success: true, data: settings });
  } catch (err) { next(err); }
});

// PUT /api/settings/business-template
router.put('/business-template', authenticate, authorize('ADMIN'), async (req, res, next) => {
  try {
    const { template } = req.body;
    const settings = await settingsService.setBusinessTemplate(template);
    res.json({ success: true, data: settings });
  } catch (err) { next(err); }
});

// PUT /api/settings/accounting-mode — HKD mode toggle (FULL_VAS | SIMPLIFIED_HKD)
router.put('/accounting-mode', authenticate, authorize('ADMIN'), async (req, res, next) => {
  try {
    const { mode } = req.body;
    if (!['FULL_VAS', 'SIMPLIFIED_HKD'].includes(mode)) {
      throw { status: 400, message: 'Mode: FULL_VAS | SIMPLIFIED_HKD' };
    }
    const settings = await settingsService.setAccountingMode(mode);
    res.json({ success: true, data: settings });
  } catch (err) { next(err); }
});

// POST /api/settings/seed-template — seed data based on business template
router.post('/seed-template', authenticate, authorize('ADMIN'), async (req, res, next) => {
  try {
    const prisma = require('../../config/prisma');
    const { template } = req.body;

    const tpl = BUSINESS_TEMPLATES[template];
    if (!tpl) {
      throw { status: 400, message: 'Unknown template: ' + template };
    }

    const settings = await settingsService.getOrCreate();

    // Cho phép seed lại nhiều lần: tìm kho đã có thay vì tạo mới (code warehouse là
    // UNIQUE toàn cục nên tạo trùng sẽ lỗi 500). Nếu chưa có thì mới tạo.
    let warehouse = await prisma.warehouse.findFirst({ where: { code: 'KHOCHINH' } });
    if (!warehouse) {
      try {
        warehouse = await prisma.warehouse.create({
          data: { code: 'KHOCHINH', name: 'Kho chinh', address: settings.address || '', isDefault: true },
        });
      } catch {
        warehouse = await prisma.warehouse.findFirst({ where: { code: 'KHOCHINH' } });
      }
    }
    if (!warehouse) {
      throw { status: 500, message: 'Không thể tạo hoặc tìm thấy kho mặc định' };
    }

    const createdCategories = [];
    for (const cat of tpl.categories) {
      try {
        const c = await prisma.category.create({ data: { name: cat.name, description: cat.desc || '' } });
        createdCategories.push(c);
      } catch {
        // Lặp lại nhiều lần: danh mục đã tồn tại ⇒ tìm lại để map sản phẩm.
        const existing = await prisma.category.findFirst({ where: { name: cat.name } });
        if (existing) createdCategories.push(existing);
      }
    }

    let totalProducts = 0;
    let totalVariants = 0;
    const catMap = new Map();
    for (let i = 0; i < tpl.products.length; i++) {
      const p = tpl.products[i];
      const catIdx = i % createdCategories.length;
      const categoryId = createdCategories[catIdx]?.id;
      if (!categoryId) continue;

      const baseInventory = p.unit === 'kg' || p.unit === 'lit' ? 50 : 100;
      const minStockBase = p.unit === 'kg' || p.unit === 'lit' ? 5 : 10;

      try {
        const product = await prisma.product.create({
          data: {
            sku: p.sku,
            name: p.name,
            categoryId,
            price: p.price,
            costPrice: p.costPrice,
            unit: p.unit,
            trackByLot: p.trackByLot || false,
            trackBySerial: p.trackBySerial || false,
            shelfLifeDays: p.shelfLifeDays || null,
            kdsStationId: p.kdsStationId || null,
          },
        });

        await prisma.inventory.create({
          data: { productId: product.id, warehouseId: warehouse.id, quantity: baseInventory, minStock: minStockBase },
        });

        if (p.variants && p.variants.length > 0) {
          for (const v of p.variants) {
            try {
              await prisma.productVariant.create({
                data: { productId: product.id, name: v.name, sku: v.sku, priceAdjust: 0 },
              });
              totalVariants++;
            } catch { /* skip dup variant sku */ }
          }
        }

        totalProducts++;
      } catch { /* duplicate sku — skip */ }
    }

    const createdCustomers = [];
    for (const cust of tpl.customers) {
      try {
        const c = await prisma.customer.create({
          data: {
            name: cust.name,
            phone: cust.phone,
            email: cust.email || null,
            address: cust.address || null,
            loyaltyPoints: cust.loyaltyPoints || 0,
            tier: cust.tier || 'BRONZE',
          },
        });
        createdCustomers.push(c);
      } catch { /* skip dup phone */ }
    }

    await settingsService.update({ demoSeeded: true, businessTemplate: template });

    // CRM/SRM upgrade: seed workflow duyệt PO đa cấp + 10 báo cáo mặc định (Mục 7, 8)
    let crmSrmSeed = {};
    try {
      const { seedPoApprovalWorkflows } = require('../workflow/po-template.seed');
      crmSrmSeed.poWorkflows = await seedPoApprovalWorkflows(req.user.id);
      const { seedDefaultReports } = require('../report-builder/default-reports.seed');
      crmSrmSeed.reports = await seedDefaultReports(req.user.id);
    } catch (seedErr) {
      const logger = require('../../utils/logger');
      logger.error('[seed-template] CRM/SRM seed failed:', seedErr.message);
    }

    res.json({
      success: true,
      data: {
        message: `Da tao du lieu mau cho "${tpl.name}"`,
        created: {
          categories: createdCategories.length,
          products: totalProducts,
          variants: totalVariants,
          customers: createdCustomers.length,
          warehouse: 1,
        },
        crmSrmSeed,
      },
    });
  } catch (err) { next(err); }
});

module.exports = router;
