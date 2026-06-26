/**
 * modules/import/import.routes.js — Routes cho import dữ liệu từ Excel
 * 
 * Tổng quan:
 * - Import sản phẩm, khách hàng, nhà cung cấp từ file Excel
 * - Tải file mẫu (template) cho từng loại
 * - Yêu cầu module "import" trong plan
 * 
 * Routes:
 * - GET /template/:type: Tải file Excel mẫu (products/customers/vendors)
 * - POST /products: Import sản phẩm từ Excel (ADMIN/MANAGER), upsert theo SKU
 * - POST /customers: Import khách hàng từ Excel (ADMIN/MANAGER)
 * - POST /vendors: Import nhà cung cấp từ Excel (ADMIN/MANAGER), upsert theo code
 */
const express = require('express');
const multer = require('multer');
const ExcelJS = require('exceljs');
const prisma = require('../../config/prisma');
const { authenticate, authorize } = require('../../middleware/auth.middleware');
const { requireModule } = require('../../middleware/plan.middleware');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.use(requireModule("import"));

// GET /api/import/template/:type — tải file mẫu
router.get('/template/:type', authenticate, async (req, res, next) => {
  try {
    const templates = {
      products: {
        headers: ['name', 'sku', 'category', 'price', 'costPrice', 'unit', 'description'],
        sample: ['Áo thun nam', 'AT-001', 'Áo', 150000, 80000, 'cái', 'Mô tả sản phẩm'],
      },
      customers: {
        headers: ['name', 'phone', 'email', 'address'],
        sample: ['Nguyễn Văn A', '0901234567', 'a@email.com', '123 Nguyễn Huệ, Q1'],
      },
      vendors: {
        headers: ['code', 'name', 'contactPerson', 'phone', 'email', 'address', 'taxCode'],
        sample: ['NCC-001', 'Công ty ABC', 'Trần Văn B', '0912345678', 'b@email.com', '456 Lê Lợi, Q1', '0123456789'],
      },
    };

    const t = templates[req.params.type];
    if (!t) return res.status(400).json({ success: false, message: 'Loại không hợp lệ' });

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Data');
    ws.addRow(t.headers);
    ws.addRow(t.sample);
    ws.getRow(1).font = { bold: true };
    ws.columns = t.headers.map((h) => ({ header: h, key: h, width: 20 }));

    res.setHeader('Content-Disposition', `attachment; filename=mau_${req.params.type}.xlsx`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    await wb.xlsx.write(res);
    res.end();
  } catch (err) { next(err); }
});

// POST /api/import/products
router.post('/products', authenticate, authorize('ADMIN', 'MANAGER'), upload.single('file'), async (req, res, next) => {
  try {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(req.file.buffer);
    const ws = wb.worksheets[0];

    const headers = ws.getRow(1).values.slice(1); // bỏ index 0
    const errors = [];
    const rows = [];

    ws.eachRow((row, i) => {
      if (i === 1) return;
      const obj = {};
      headers.forEach((h, idx) => { obj[h] = row.getCell(idx + 1).value; });
      rows.push({ rowNum: i, data: obj });
    });

    // Validate
    const valid = [];
    for (const { rowNum, data } of rows) {
      if (!data.name) { errors.push({ row: rowNum, message: 'Thiếu tên sản phẩm' }); continue; }
      if (!data.sku) { errors.push({ row: rowNum, message: 'Thiếu SKU' }); continue; }
      if (!data.price || isNaN(Number(data.price))) { errors.push({ row: rowNum, message: 'Giá không hợp lệ' }); continue; }
      if (!data.costPrice || isNaN(Number(data.costPrice))) { errors.push({ row: rowNum, message: 'Giá vốn không hợp lệ' }); continue; }
      valid.push(data);
    }

    // Lookup categories
    const categoryNames = [...new Set(valid.map((r) => r.category).filter(Boolean))];
    const categories = await prisma.category.findMany({ where: { name: { in: categoryNames } } });
    const catMap = Object.fromEntries(categories.map((c) => [c.name, c.id]));

    // Lấy default category nếu có
    const defaultCat = categories[0] || await prisma.category.findFirst();
    if (!defaultCat) {
      return res.status(400).json({ success: false, message: 'Chưa có danh mục nào trong hệ thống' });
    }

    // Import
    let imported = 0;
    const importErrors = [...errors];
    for (const data of valid) {
      try {
        const categoryId = catMap[data.category] || defaultCat.id;
        await prisma.product.upsert({
          where: { sku: String(data.sku) },
          create: {
            sku: String(data.sku),
            name: String(data.name),
            price: Number(data.price),
            costPrice: Number(data.costPrice),
            unit: data.unit ? String(data.unit) : 'cái',
            description: data.description ? String(data.description) : null,
            categoryId,
          },
          update: {
            name: String(data.name),
            price: Number(data.price),
            costPrice: Number(data.costPrice),
          },
        });
        imported++;
      } catch (err) {
        importErrors.push({ message: `SKU ${data.sku}: ${err.message}` });
      }
    }

    res.json({ success: true, data: { imported, errors: importErrors } });
  } catch (err) { next(err); }
});

// POST /api/import/customers
router.post('/customers', authenticate, authorize('ADMIN', 'MANAGER'), upload.single('file'), async (req, res, next) => {
  try {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(req.file.buffer);
    const ws = wb.worksheets[0];
    const headers = ws.getRow(1).values.slice(1);
    const errors = [];
    let imported = 0;

    const rows = [];
    ws.eachRow((row, i) => {
      if (i === 1) return;
      const obj = {};
      headers.forEach((h, idx) => { obj[h] = row.getCell(idx + 1).value; });
      rows.push({ rowNum: i, data: obj });
    });

    for (const { rowNum, data } of rows) {
      if (!data.name) { errors.push({ row: rowNum, message: 'Thiếu tên khách hàng' }); continue; }
      try {
        await prisma.customer.create({
          data: {
            name: String(data.name),
            phone: data.phone ? String(data.phone) : null,
            email: data.email ? String(data.email) : null,
            address: data.address ? String(data.address) : null,
          },
        });
        imported++;
      } catch (err) {
        errors.push({ row: rowNum, message: err.message.includes('Unique') ? `SĐT ${data.phone} đã tồn tại` : err.message });
      }
    }

    res.json({ success: true, data: { imported, errors } });
  } catch (err) { next(err); }
});

// POST /api/import/vendors
router.post('/vendors', authenticate, authorize('ADMIN', 'MANAGER'), upload.single('file'), async (req, res, next) => {
  try {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(req.file.buffer);
    const ws = wb.worksheets[0];
    const headers = ws.getRow(1).values.slice(1);
    const errors = [];
    let imported = 0;

    const rows = [];
    ws.eachRow((row, i) => {
      if (i === 1) return;
      const obj = {};
      headers.forEach((h, idx) => { obj[h] = row.getCell(idx + 1).value; });
      rows.push({ rowNum: i, data: obj });
    });

    for (const { rowNum, data } of rows) {
      if (!data.code) { errors.push({ row: rowNum, message: 'Thiếu mã NCC' }); continue; }
      if (!data.name) { errors.push({ row: rowNum, message: 'Thiếu tên NCC' }); continue; }
      try {
        await prisma.vendor.upsert({
          where: { code: String(data.code) },
          create: {
            code: String(data.code),
            name: String(data.name),
            contactPerson: data.contactPerson ? String(data.contactPerson) : null,
            phone: data.phone ? String(data.phone) : null,
            email: data.email ? String(data.email) : null,
            address: data.address ? String(data.address) : null,
            taxCode: data.taxCode ? String(data.taxCode) : null,
          },
          update: {
            name: String(data.name),
            contactPerson: data.contactPerson ? String(data.contactPerson) : null,
          },
        });
        imported++;
      } catch (err) {
        errors.push({ row: rowNum, message: err.message });
      }
    }

    res.json({ success: true, data: { imported, errors } });
  } catch (err) { next(err); }
});

module.exports = router;
