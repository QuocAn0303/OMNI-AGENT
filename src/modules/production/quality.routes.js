const router = require("express").Router();
const { z } = require("zod");
const service = require("./quality.service");
const { authenticate, authorize } = require("../../middleware/auth.middleware");
const { requireModule } = require("../../middleware/plan.middleware");
const { success, created } = require("../../utils/response");

router.use(authenticate, requireModule("production"));

const createSchema = z.object({
  items: z.array(z.object({
    name: z.string().min(1),
    result: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
  })).optional().default([]),
  notes: z.string().optional().nullable(),
});

const submitSchema = z.object({
  status: z.enum(["PASSED", "FAILED", "PARTIAL"]),
  items: z.array(z.object({
    id: z.string().uuid(),
    result: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
  })).optional().default([]),
  notes: z.string().optional().nullable(),
});

router.get("/", authorize("ADMIN", "MANAGER", "WAREHOUSE"), async (req, res, next) => {
  try {
    success(res, await service.list(req.query));
  } catch (err) { next(err); }
});

router.get("/:workOrderId", authorize("ADMIN", "MANAGER", "WAREHOUSE"), async (req, res, next) => {
  try {
    success(res, await service.getForWorkOrder(req.params.workOrderId));
  } catch (err) { next(err); }
});

router.post("/:workOrderId", authorize("ADMIN", "MANAGER", "WAREHOUSE"), async (req, res, next) => {
  try {
    const data = createSchema.parse(req.body);
    created(res, await service.createCheck(req.params.workOrderId, data), "Tạo phiếu kiểm tra thành công");
  } catch (err) { next(err); }
});

router.patch("/:id/submit", authorize("ADMIN", "MANAGER", "WAREHOUSE"), async (req, res, next) => {
  try {
    const data = submitSchema.parse(req.body);
    success(res, await service.submitCheck(req.params.id, { ...data, userId: req.user.id }), "Đã cập nhật kết quả kiểm tra");
  } catch (err) { next(err); }
});

module.exports = router;
