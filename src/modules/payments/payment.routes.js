const router = require("express").Router({ mergeParams: true });
const { z } = require("zod");
const paymentService = require("./payment.service");
const { authenticate, authorize } = require("../../middleware/auth.middleware");
const { success, created } = require("../../utils/response");

const paymentSchema = z.object({
  amount: z.number().positive(),
  method: z.enum(["CASH", "BANK_TRANSFER", "CARD"]),
  reference: z.string().optional(),
  note: z.string().optional(),
});

router.use(authenticate);

router.get("/", async (req, res, next) => {
  try {
    const [payments, balance] = await Promise.all([
      paymentService.getByOrderId(req.params.orderId),
      paymentService.getOrderBalance(req.params.orderId),
    ]);
    success(res, { payments, balance });
  } catch (err) {
    next(err);
  }
});

router.post("/", authorize("ADMIN", "MANAGER", "CASHIER"), async (req, res, next) => {
  try {
    const data = paymentSchema.parse(req.body);
    const payment = await paymentService.recordPayment(
      { ...data, orderId: req.params.orderId },
      req.user.id,
    );
    created(res, payment, "Ghi nhận thanh toán thành công");
  } catch (err) {
    next(err);
  }
});

module.exports = router;
