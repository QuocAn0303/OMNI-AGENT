const router = require("express").Router();
const { z } = require("zod");
const warehouseService = require("./warehouse.service");
const { authenticate, authorize } = require("../../middleware/auth.middleware");
const { success, created } = require("../../utils/response");

router.use(authenticate);

router.get("/", async (req, res, next) => {
  try {
    success(res, await warehouseService.list());
  } catch (err) {
    next(err);
  }
});

router.post("/", authorize("ADMIN"), async (req, res, next) => {
  try {
    const data = z
      .object({
        code: z.string().min(2),
        name: z.string().min(2),
        address: z.string().optional(),
        isDefault: z.boolean().optional(),
      })
      .parse(req.body);
    created(res, await warehouseService.create(data, req.user.id));
  } catch (err) {
    next(err);
  }
});

router.patch("/:id", authorize("ADMIN"), async (req, res, next) => {
  try {
    const data = z
      .object({
        name: z.string().optional(),
        address: z.string().optional(),
        isActive: z.boolean().optional(),
        isDefault: z.boolean().optional(),
      })
      .parse(req.body);
    success(res, await warehouseService.update(req.params.id, data, req.user.id));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
