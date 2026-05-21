const router = require("express").Router();
const { z } = require("zod");
const cycleCountService = require("./cyclecount.service");
const { authenticate, authorize } = require("../../middleware/auth.middleware");
const { success, created, paginated } = require("../../utils/response");

const createSchema = z.object({
  productIds: z.array(z.string().uuid()).min(1),
  note: z.string().optional(),
});

const recordSchema = z.object({
  items: z.array(z.object({
    id: z.string().uuid(),
    actualQuantity: z.number().int().min(0),
    note: z.string().optional(),
  })).min(1),
});

router.use(authenticate);

router.post("/", authorize("ADMIN", "WAREHOUSE"), async (req, res, next) => {
  try {
    const data = createSchema.parse(req.body);
    const cycleCount = await cycleCountService.create(data, req.user.id);
    created(res, cycleCount, "Tạo phiếu kiểm kê thành công");
  } catch (err) {
    next(err);
  }
});

router.get("/", authorize("ADMIN", "WAREHOUSE", "MANAGER"), async (req, res, next) => {
  try {
    const { cycleCounts, pagination } = await cycleCountService.getAll(req.query);
    paginated(res, cycleCounts, pagination);
  } catch (err) {
    next(err);
  }
});

router.get("/:id", authorize("ADMIN", "WAREHOUSE", "MANAGER"), async (req, res, next) => {
  try {
    const cycleCount = await cycleCountService.getById(req.params.id);
    success(res, cycleCount);
  } catch (err) {
    next(err);
  }
});

router.patch("/:id/items", authorize("ADMIN", "WAREHOUSE"), async (req, res, next) => {
  try {
    const { items } = recordSchema.parse(req.body);
    const cycleCount = await cycleCountService.recordCount(req.params.id, items);
    success(res, cycleCount, "Lưu số liệu kiểm kê thành công");
  } catch (err) {
    next(err);
  }
});

router.patch("/:id/complete", authorize("ADMIN", "WAREHOUSE"), async (req, res, next) => {
  try {
    const cycleCount = await cycleCountService.complete(req.params.id, req.user.id);
    success(res, cycleCount, "Hoàn thành kiểm kê thành công");
  } catch (err) {
    next(err);
  }
});

router.patch("/:id/cancel", authorize("ADMIN"), async (req, res, next) => {
  try {
    const cycleCount = await cycleCountService.cancel(req.params.id);
    success(res, cycleCount, "Hủy kiểm kê thành công");
  } catch (err) {
    next(err);
  }
});

module.exports = router;
