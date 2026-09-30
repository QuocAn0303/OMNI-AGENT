/**
 * modules/customers/customer.routes.js — Routes quản lý khách hàng
 *
 * Tổng quan:
 * - Định nghĩa các endpoint CRUD cho khách hàng
 * - Yêu cầu authenticate + authorize(ADMIN, MANAGER, CASHIER) cho tất cả routes
 * - Tích hợp validation bằng Zod schema
 * - Cung cấp các route phụ: loyalty summary, redeem, debts
 *
 * Hàm:
 * - GET /: Gọi customerService.getAll() — trả về danh sách khách hàng phân trang
 * - GET /:id/full: Gọi customerService.getCustomer360() — trả về Customer 360°
 * - GET /:id/loyalty: Gọi loyaltyService.getLoyaltySummary() — trả về tổng quan loyalty
 * - POST /:id/loyalty/redeem: Gọi loyaltyService.redeemForOrder() — đổi điểm loyalty
 * - GET /:id/debts: Gọi debtService.listByCustomer() — danh sách công nợ
 * - POST /: Tạo khách hàng mới — validate createSchema (name, phone, email, address)
 * - PUT /:id: Cập nhật khách hàng — validate updateSchema
 * - DELETE /:id: Soft delete khách hàng — gọi customerService.remove()
 */

/**
 * @swagger
 * /api/customers:
 *   get:
 *     summary: Danh sách khách hàng phân trang (ADMIN, MANAGER, CASHIER)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer }
 *       - in: query
 *         name: limit
 *         schema: { type: integer }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *       - in: query
 *         name: segmentId
 *         description: Lọc theo phân khúc đã lưu (CustomerSegment.id)
 *         schema: { type: string }
 *     responses:
 *       200: { description: OK }
 *   post:
 *     summary: Tạo khách hàng mới
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               phone: { type: string }
 *               email: { type: string }
 *               address: { type: string }
 *     responses:
 *       201: { description: Tạo khách hàng thành công }
 *
 * /api/customers/export:
 *   get:
 *     summary: Xuất Excel danh sách khách hàng (ADMIN, MANAGER)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: File Excel
 *         content:
 *           application/vnd.openxmlformats-officedocument.spreadsheetml.sheet:
 *             schema: { type: string, format: binary }
 *
 * /api/customers/{id}:
 *   get:
 *     summary: Chi tiết khách hàng
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: OK }
 *   put:
 *     summary: Cập nhật khách hàng
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody: { required: true, content: { application/json: { schema: { type: object } } } }
 *     responses:
 *       200: { description: Cập nhật thành công }
 *   delete:
 *     summary: Xóa (soft) khách hàng
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Đã xóa }
 *
 * /api/customers/{id}/full:
 *   get:
 *     summary: Customer 360° (chi tiết toàn diện)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: OK }
 *
 * /api/customers/{id}/loyalty:
 *   get:
 *     summary: Tổng quan loyalty của khách hàng
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: OK }
 *
 * /api/customers/{id}/loyalty/redeem:
 *   post:
 *     summary: Đổi điểm loyalty cho đơn hàng
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody: { required: true, content: { application/json: { schema: { type: object } } } }
 *     responses:
 *       200: { description: OK }
 *
 * /api/customers/{id}/debts:
 *   get:
 *     summary: Danh sách công nợ của khách hàng
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: OK }
 *
 * /api/customers/{id}/credit-limit:
 *   patch:
 *     summary: Cập nhật hạn mức tín dụng (ADMIN, MANAGER)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody: { required: true, content: { application/json: { schema: { type: object } } } }
 *     responses:
 *       200: { description: OK }
 */
const express = require('express');
const { z } = require('zod');
const customerService = require('./customer.service');
const debtService = require('../debt/debt.service');
const loyaltyService = require('../loyalty/loyalty.service');
const { authenticate, authorize } = require('../../middleware/auth.middleware');
const { paginated, created, success } = require('../../utils/response');
const { maskPII } = require('../../utils/piiMask');
const prisma = require('../../config/prisma');
const { exportToExcel } = require('../../utils/exporter');

const router = express.Router();

// Yêu cầu đăng nhập để thao tác với dữ liệu khách hàng, chỉ admin, manager, cashier mới được truy cập
router.use(authenticate, authorize('ADMIN', 'MANAGER', 'CASHIER'));

// Xuất Excel — chỉ ADMIN, MANAGER
router.get('/export', authorize('ADMIN', 'MANAGER'), async (req, res, next) => {
  try {
    const customers = await prisma.customer.findMany({
      where: { isActive: true },
      take: 10000,
    });
    const buf = await exportToExcel(
      customers.map(c => ({ name: c.name, phone: c.phone || '', email: c.email || '', totalDebt: Number(c.totalDebt || 0), tier: c.tier || '' })),
      [
        { header: 'Tên khách hàng', key: 'name' },
        { header: 'SĐT', key: 'phone' },
        { header: 'Email', key: 'email' },
        { header: 'Công nợ', key: 'totalDebt' },
        { header: 'Hạng', key: 'tier' },
      ],
      'Khách hàng'
    );
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=customers_${Date.now()}.xlsx`);
    res.send(Buffer.from(buf));
  } catch (e) { next(e); }
});

// API: GET /api/customers
router.get('/', async (req, res, next) => {
  try {
    const { customers, pagination } = await customerService.getAll(req.query);
    paginated(res, maskPII(customers, req.user.role), pagination);
  } catch (err) {
    next(err);
  }
});

router.get('/:id/full', async (req, res, next) => {
  try {
    success(res, maskPII(await customerService.getCustomer360(req.params.id), req.user.role));
  } catch (err) {
    next(err);
  }
});

router.get('/:id/loyalty', async (req, res, next) => {
  try {
    success(res, await loyaltyService.getLoyaltySummary(req.params.id));
  } catch (err) {
    next(err);
  }
});

router.post('/:id/loyalty/redeem', async (req, res, next) => {
  try {
    const { points, orderId } = z
      .object({
        points: z.number().int().positive(),
        orderId: z.string().uuid().optional(),
      })
      .parse(req.body);
    success(
      res,
      await loyaltyService.redeemForOrder(req.params.id, points, orderId),
      'Đổi điểm thành công',
    );
  } catch (err) {
    next(err);
  }
});

router.get('/:id/debts', async (req, res, next) => {
  try {
    const { page, limit } = req.query;
    const result = await debtService.listByCustomer(req.params.id, Number(page) || 1, Number(limit) || 50);
    success(res, result.data);
  } catch (err) {
    next(err);
  }
});


const createSchema = z.object({
  name: z.string().min(2, 'Tên khách hàng phải có ít nhất 2 ký tự'),
  phone: z.string().optional(),
  email: z.string().email('Email không đúng định dạng').optional().or(z.literal('')), 
  address: z.string().optional(),
});

// API: POST /api/customers
router.post('/', async (req, res, next) => {
  try {
    const validatedData = createSchema.parse(req.body);
    const newCustomer = await customerService.create(validatedData, req.user.id);
    created(res, newCustomer, 'Thêm mới khách hàng thành công');
  } catch (err) {
    next(err);
  }
});

const updateSchema = z.object({
  name: z.string().min(2, 'Tên khách hàng phải có ít nhất 2 ký tự').optional(),
  phone: z.string().optional().or(z.literal('')),
  email: z.string().email('Email không đúng định dạng').optional().or(z.literal('')),
  address: z.string().optional(),
});

// API: PUT /api/customers/:id
router.put('/:id', async (req, res, next) => {
  try {
    const validatedData = updateSchema.parse(req.body);
    const updatedCustomer = await customerService.update(req.params.id, validatedData, req.user.id);
    success(res, updatedCustomer, 'Cập nhật thông tin khách hàng thành công');
  } catch (err) {
    next(err);
  }
});

// API: DELETE /api/customers/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const deletedCustomer = await customerService.remove(req.params.id, req.user.id);
    success(res, deletedCustomer, 'Xóa khách hàng thành công');
  } catch (err) {
    next(err);
  }
});

const creditLimitSchema = z.object({
  creditLimit: z.number().min(0, 'Hạn mức tín dụng không được âm'),
});

router.patch('/:id/credit-limit', async (req, res, next) => {
  try {
    const { creditLimit } = creditLimitSchema.parse(req.body);
    const updated = await customerService.updateCreditLimit(req.params.id, creditLimit, req.user.id);
    success(res, updated, 'Cập nhật hạn mức tín dụng thành công');
  } catch (err) {
    next(err);
  }
});

module.exports = router;