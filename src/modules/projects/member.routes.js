// src/modules/projects/member.routes.js
const router = require("express").Router({ mergeParams: true });
const { z } = require("zod");
const service = require("./member.service");
const { authenticate, authorize } = require("../../middleware/auth.middleware");
const { created, success } = require("../../utils/response");

router.use(authenticate);

const ROLES = ["OWNER", "MEMBER", "VIEWER"];

const addSchema = z.object({
  userId: z.string().uuid("userId phải là uuid"),
  role: z.enum(ROLES).optional(),
});

const updateSchema = z.object({
  role: z.enum(ROLES),
});

// GET /api/projects/:id/members
router.get("/", async (req, res, next) => {
  try {
    success(res, await service.list(req.params.id));
  } catch (err) {
    next(err);
  }
});

// POST /api/projects/:id/members
router.post(
  "/",
  authorize("ADMIN", "MANAGER"),
  async (req, res, next) => {
    try {
      const data = addSchema.parse(req.body);
      created(res, await service.add(req.params.id, data, req.user.id), "Đã thêm thành viên");
    } catch (err) {
      next(err);
    }
  }
);

// PATCH /api/projects/:id/members/:userId
router.patch(
  "/:userId",
  authorize("ADMIN", "MANAGER"),
  async (req, res, next) => {
    try {
      const { role } = updateSchema.parse(req.body);
      success(
        res,
        await service.updateRole(req.params.id, req.params.userId, role, req.user.id),
        "Đã cập nhật vai trò"
      );
    } catch (err) {
      next(err);
    }
  }
);

// DELETE /api/projects/:id/members/:userId
router.delete(
  "/:userId",
  authorize("ADMIN", "MANAGER"),
  async (req, res, next) => {
    try {
      success(
        res,
        await service.remove(req.params.id, req.params.userId, req.user.id),
        "Đã xóa thành viên"
      );
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
