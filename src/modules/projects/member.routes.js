/**
 * modules/projects/member.routes.js — Định tuyến quản lý thành viên dự án
 *
 * Tổng quan:
 * - REST endpoints cho quản lý thành viên trong dự án
 * - Yêu cầu authenticate + requireModule("projects")
 * - requireProjectMember kiểm soát quyền truy cập theo role trong project
 * - Chỉ OWNER mới thêm/sửa/xóa thành viên (ADMIN/SUPER_ADMIN bypass)
 * - Role trong project: OWNER / MEMBER / VIEWER
 *
 * Hàm:
 * - GET / → service.list (requireProjectMember): Danh sách thành viên
 * - POST / → service.add (OWNER): Thêm thành viên, validate addSchema
 * - PATCH /:userId → service.updateRole (OWNER): Cập nhật vai trò thành viên
 * - DELETE /:userId → service.remove (OWNER): Xóa thành viên
 */
// src/modules/projects/member.routes.js
const router = require("express").Router({ mergeParams: true });
const { z } = require("zod");
const service = require("./member.service");
const { authenticate } = require("../../middleware/auth.middleware");
const { requireModule } = require("../../middleware/plan.middleware");
const { requireProjectMember } = require("./project-access.middleware");
const { created, success } = require("../../utils/response");

router.use(authenticate, requireModule("projects"));

const ROLES = ["OWNER", "MEMBER", "VIEWER"];

const addSchema = z.object({
  userId: z.string().uuid("userId phải là uuid"),
  role: z.enum(ROLES).optional(),
});

const updateSchema = z.object({
  role: z.enum(ROLES),
});

// GET /api/projects/:id/members — bất kỳ thành viên nào trong project
router.get("/", requireProjectMember(), async (req, res, next) => {
  try {
    success(res, await service.list(req.params.id));
  } catch (err) {
    next(err);
  }
});

// POST /api/projects/:id/members — chỉ OWNER (hoặc ADMIN/SUPER_ADMIN bypass)
router.post(
  "/",
  requireProjectMember({ requireRoles: ["OWNER"] }),
  async (req, res, next) => {
    try {
      const data = addSchema.parse(req.body);
      created(res, await service.add(req.params.id, data, req.user.id), "Đã thêm thành viên");
    } catch (err) {
      next(err);
    }
  }
);

// PATCH /api/projects/:id/members/:userId — chỉ OWNER
router.patch(
  "/:userId",
  requireProjectMember({ requireRoles: ["OWNER"] }),
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

// DELETE /api/projects/:id/members/:userId — chỉ OWNER
router.delete(
  "/:userId",
  requireProjectMember({ requireRoles: ["OWNER"] }),
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
