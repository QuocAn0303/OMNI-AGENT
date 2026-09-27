/**
 * modules/debt/debt.routes.js — Routes quản lý công nợ
 *
 * Tổng quan:
 * - Định nghĩa các endpoint CRUD cho công nợ (debt)
 * - Yêu cầu authenticate + requireModule("debts") cho tất cả routes
 * - Phân quyền theo role cho từng action
 *
 * Hàm:
 * - GET /: Danh sách công nợ có phân trang, lọc — gọi debtService.list() (ADMIN, MANAGER, CASHIER)
 * - GET /summary: Tổng hợp số liệu công nợ — gọi debtService.summary() (ADMIN, MANAGER)
 * - POST /:id/payments: Ghi nhận thanh toán cho 1 công nợ — validate paySchema (amount, method, note), gọi debtService.recordDebtPayment() (ADMIN, MANAGER, CASHIER)
 */
const router = require("express").Router();
const { z } = require("zod");
const { authenticate, authorize } = require("../../middleware/auth.middleware");
const { requireModule } = require("../../middleware/plan.middleware");
const { success, created } = require("../../utils/response");
const { exportToExcel } = require("../../utils/exporter");
const prisma = require("../../config/prisma");
const debtService = require("./debt.service");

router.use(authenticate, requireModule("debts"));

router.get("/", authorize("ADMIN", "MANAGER", "CASHIER"), async (req, res, next) => {
  try {
    success(res, await debtService.list(req.query));
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/debts/export:
 *   get:
 *     summary: Xuất danh sách công nợ ra Excel (ADMIN, MANAGER)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: File .xlsx }
 */
router.get("/export", authorize("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    const debts = await prisma.debt.findMany({
      include: {
        customer: { select: { name: true, phone: true } },
        vendor: { select: { name: true, code: true } },
      },
      take: 10000,
      orderBy: { createdAt: "desc" },
    });
    const buf = await exportToExcel(
      debts.map((d) => ({
        debtCode: d.debtCode,
        type: d.type,
        party: d.customer?.name || d.vendor?.name || "",
        contact: d.customer?.phone || d.vendor?.code || "",
        totalAmount: Number(d.totalAmount || 0),
        paidAmount: Number(d.paidAmount || 0),
        remaining: Number(d.totalAmount || 0) - Number(d.paidAmount || 0),
        status: d.status,
        dueDate: d.dueDate ? new Date(d.dueDate).toLocaleDateString("vi-VN") : "",
      })),
      [
        { header: "Mã công nợ", key: "debtCode" },
        { header: "Loại", key: "type" },
        { header: "Đối tượng", key: "party" },
        { header: "Liên hệ", key: "contact" },
        { header: "Tổng nợ", key: "totalAmount" },
        { header: "Đã trả", key: "paidAmount" },
        { header: "Còn lại", key: "remaining" },
        { header: "Trạng thái", key: "status" },
        { header: "Hạn trả", key: "dueDate" },
      ],
      "Công nợ"
    );
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename=cong-no_${Date.now()}.xlsx`);
    res.send(Buffer.from(buf));
  } catch (e) { next(e); }
});

router.get("/summary", authorize("ADMIN", "MANAGER", "ACCOUNTANT"), async (req, res, next) => {
  try {
    success(res, await debtService.summary());
  } catch (e) {
    next(e);
  }
});

const paySchema = z.object({
  amount: z.number().positive(),
  method: z.enum(["CASH", "BANK_TRANSFER", "CARD", "MOMO", "VNPAY", "ZALOPAY", "PAYOS", "VIETQR"]).optional(),
  note: z.string().optional(),
});

router.post("/:id/payments", authorize("ADMIN", "MANAGER", "CASHIER"), async (req, res, next) => {
  try {
    const body = paySchema.parse(req.body);
    created(res, await debtService.recordDebtPayment(req.params.id, body, req.user.id), "Đã ghi nhận thanh toán công nợ");
  } catch (e) {
    next(e);
  }
});

module.exports = router;
