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
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'text/csv',
    ];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Chỉ chấp nhận file Excel (.xlsx, .xls) hoặc CSV'));
  },
});

/** Số dòng tối đa cho một lần import — chặn file .xlsx 10MB làm nghẽn request. */
const MAX_IMPORT_ROWS = 5000;

/**
 * M5 (security): thông điệp lỗi cho từng dòng trong response.
 * KHÔNG trả `err.message` của Prisma ra client — trong đó có tên model, tên
 * field, chữ ký input type (PrismaClientValidationError) hoặc TOÀN BỘ câu SQL
 * (P2010/P2011). Endpoint này trả HTTP 200 kèm mảng lỗi nên không đi qua
 * error.middleware — phải lọc tại chỗ.
 */
const rowErrorMessage = (err, fallback) => {
  const code = err?.code;
  if (code === 'P2002') return 'Dữ liệu trùng lặp (đã tồn tại)';
  if (code === 'P2003') return 'Dữ liệu tham chiếu không tồn tại';
  if (code === 'P2025') return 'Không tìm thấy bản ghi';
  if (code === 'P2000') return 'Giá trị vượt quá độ dài cho phép';
  // Mọi lỗi khác (kể cả lỗi không phải Prisma) chỉ trả thông điệp chung.
  // Chi tiết đầy đủ đã được logger ghi lại server-side.
  require('../../utils/logger').error('[import] row error:', err);
  return fallback;
};

router.use(authenticate, requireModule("import"));

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
    if (!t) throw { status: 400, message: 'Loại không hợp lệ' };

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

    // Chặn file quá lớn: multer cho phép 10MB nhưng một .xlsx 10MB có thể chứa
    // hơn 100k dòng, mỗi dòng một lượt ghi DB trong cùng một request → nghẽn
    // server. Trả 413 ngay thay vì giày CPU và giữ connection.
    if (rows.length > MAX_IMPORT_ROWS) {
      throw { status: 413, message: `File có ${rows.length} dòng, vượt giới hạn ${MAX_IMPORT_ROWS} dòng mỗi lần import` };
    }

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
      throw { status: 400, message: 'Chưa có danh mục nào trong hệ thống' };
    }

    // Import
    let imported = 0;
    const importErrors = [...errors];
    for (const data of valid) {
      try {
        const categoryId = catMap[data.category] || defaultCat.id;
        const sku = String(data.sku);
        const payload = {
          name: String(data.name),
          price: Number(data.price),
          costPrice: Number(data.costPrice),
          unit: data.unit ? String(data.unit) : 'cái',
          description: data.description ? String(data.description) : null,
          categoryId,
        };

        // M12: `Product` có `@@unique([sku, tenantId])` — KHÔNG có `@unique` đơn
        // trên `sku`. `upsert({ where: { sku } })` vì thế không thỏa
        // ProductWhereUniqueInput và Prisma reject MỌI dòng: tính năng import sản
        // phẩm chưa bao giờ hoạt động. Tự tra cứu rồi create/update theo `id`:
        // extension vẫn khoanh vùng tenant cho cả hai lệnh (findFirst và update
        // đều merge `tenantId` vào `where`), nên không mất rào an toàn multi-tenant.
        const existing = await prisma.product.findFirst({ where: { sku } });
        if (existing) {
          await prisma.product.update({ where: { id: existing.id }, data: payload });
        } else {
          await prisma.product.create({ data: { sku, ...payload } });
        }
        imported++;
      } catch (err) {
        importErrors.push({ message: `SKU ${data.sku}: ${rowErrorMessage(err, 'Không lưu được dòng này')}` });
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

    if (rows.length > MAX_IMPORT_ROWS) {
      throw { status: 413, message: `File có ${rows.length} dòng, vượt giới hạn ${MAX_IMPORT_ROWS} dòng mỗi lần import` };
    }

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
        errors.push({ row: rowNum, message: rowErrorMessage(err, 'Số điện thoại đã tồn tại') });
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

    if (rows.length > MAX_IMPORT_ROWS) {
      throw { status: 413, message: `File có ${rows.length} dòng, vượt giới hạn ${MAX_IMPORT_ROWS} dòng mỗi lần import` };
    }

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
        errors.push({ row: rowNum, message: rowErrorMessage(err, 'Mã NCC đã tồn tại') });
      }
    }

    res.json({ success: true, data: { imported, errors } });
  } catch (err) { next(err); }
});

module.exports = router;
