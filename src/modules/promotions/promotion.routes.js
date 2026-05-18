const router = require("express").Router();
const { z } = require("zod");
const promotionService = require("./promotion.service");
const { authenticate, authorize } = require("../../middleware/auth.middleware");
const { success, created, paginated } = require("../../utils/response");

const promotionSchema = z.object({
  code: z.string().optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  type: z.enum([
    "PERCENTAGE",
    "FIXED_AMOUNT",
    "BUY_X_GET_Y",
    "CATEGORY_DISCOUNT",
    "PRODUCT_DISCOUNT",
    "FREE_SHIPPING",
  ]),
  scope: z.enum(["AUTO", "VOUCHER_CODE"]).default("AUTO"),
  value: z.number().positive(),
  maxDiscount: z.number().positive().optional(),
  minOrderValue: z.number().min(0).optional(),
  minQuantity: z.number().int().positive().optional(),
  buyQuantity: z.number().int().positive().optional(),
  getQuantity: z.number().int().positive().optional(),
  startDate: z.string(),
  endDate: z.string(),
  usageLimit: z.number().int().positive().optional(),
  perUserLimit: z.number().int().positive().optional(),
  categoryId: z.string().uuid().optional(),
  productId: z.string().uuid().optional(),
});

const cartItemsSchema = z.object({
  items: z.array(
    z.object({
      productId: z.string().uuid(),
      quantity: z.number().int().positive(),
      discountAmount: z.number().min(0).optional(),
    }),
  ).min(1),
  customerId: z.string().uuid().optional().nullable(),
});

router.use(authenticate);

router.post("/", authorize("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    const data = promotionSchema.parse(req.body);
    created(res, await promotionService.create(data), "Tạo khuyến mãi thành công");
  } catch (e) { next(e); }
});

router.get("/", authorize("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    const { promotions, pagination } = await promotionService.list(req.query);
    paginated(res, promotions, pagination);
  } catch (e) { next(e); }
});

router.get("/report", authorize("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    success(res, await promotionService.reportEffectiveness(req.query));
  } catch (e) { next(e); }
});

router.get("/:id", authorize("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    success(res, await promotionService.getById(req.params.id));
  } catch (e) { next(e); }
});

router.patch("/:id", authorize("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    success(res, await promotionService.update(req.params.id, req.body), "Cập nhật thành công");
  } catch (e) { next(e); }
});

router.post("/:id/activate", authorize("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    success(res, await promotionService.setStatus(req.params.id, "ACTIVE"), "Đã kích hoạt");
  } catch (e) { next(e); }
});

router.post("/:id/pause", authorize("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    success(res, await promotionService.setStatus(req.params.id, "PAUSED"), "Đã tạm dừng");
  } catch (e) { next(e); }
});

router.delete("/:id", authorize("ADMIN"), async (req, res, next) => {
  try {
    await promotionService.remove(req.params.id);
    success(res, null, "Đã xóa khuyến mãi");
  } catch (e) { next(e); }
});

router.cartItemsSchema = cartItemsSchema;
module.exports = router;
