/**
 * modules/users/user.routes.js — Routes quản lý người dùng
 * 
 * Tổng quan:
 * - CRUD users, yêu cầu ADMIN / SUPER_ADMIN / SUPER_OMEGA_ULTRA_ADMIN
 * - Tạo user kiểm tra maxUsers quota qua plan.middleware
 * - SUPER_OMEGA_ULTRA_ADMIN thấy tất cả user; ADMIN chỉ thấy user trong tenant
 * - Soft delete: set isActive = false
 * 
 * Endpoints:
 * - GET /: Danh sách user (phân trang, search, filter role)
 * - GET /:id: Chi tiết user
 * - POST /: Tạo user mới (kiểm tra quota)
 * - PUT /:id: Cập nhật user
 * - DELETE /:id: Vô hiệu hóa user (soft delete)
 * 
 * Validation (Zod):
 * - createSchema: email, password(min 6), fullName(min 2), role
 * - updateSchema: tất cả optional, có .strict() để chặn field lạ
 */

const router = require("express").Router();
const { z } = require("zod");
const userService = require("./user.service");
const { authenticate, authorize } = require("../../middleware/auth.middleware");
const { checkFeature } = require("../../middleware/plan.middleware");
const { success, created, paginated } = require("../../utils/response");

const ALLOWED_ROLES = ["ADMIN", "MANAGER", "CASHIER", "WAREHOUSE"];
const SUPER_ROLES = ["SUPER_ADMIN", "SUPER_OMEGA_ULTRA_ADMIN"];

const createSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  fullName: z.string().min(2),
  role: z.enum([...ALLOWED_ROLES, ...SUPER_ROLES]).default("CASHIER"),
});

const updateSchema = z.object({
  email: z.string().email().optional(),
  password: z.string().min(6).optional(),
  fullName: z.string().min(2).optional(),
  role: z.enum([...ALLOWED_ROLES, ...SUPER_ROLES]).optional(),
  isActive: z.boolean().optional(),
}).strict();

// Tất cả routes yêu cầu đăng nhập + role ADMIN / SUPER_ADMIN / SUPER_OMEGA_ULTRA_ADMIN
router.use(authenticate, authorize("ADMIN", "SUPER_ADMIN", "SUPER_OMEGA_ULTRA_ADMIN"));
// Lấy danh sách người dùng với phân trang
router.get("/", async (req, res, next) => {
  try {
    const { users, pagination } = await userService.getAll(req.query, req.user);
    paginated(res, users, pagination);
  } catch (err) {
    next(err);
  }
});
// Lấy thông tin người dùng theo ID
router.get("/:id", async (req, res, next) => {
  try {
    const user = await userService.getById(req.params.id);
    success(res, user);
  } catch (err) {
    next(err);
  }
});

router.post("/", checkFeature("maxUsers"), async (req, res, next) => {
  try {
    const data = createSchema.parse(req.body);
    const user = await userService.create(data, req.user.id);
    created(res, user, "Tạo tài khoản thành công");
  } catch (err) {
    next(err);
  }
});

router.put("/:id", async (req, res, next) => {
  try {
    const data = updateSchema.parse(req.body);
    const user = await userService.update(req.params.id, data, req.user.id);
    success(res, user, "Cập nhật thành công");
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    await userService.remove(req.params.id, req.user.id);
    success(res, null, "Vô hiệu hóa tài khoản thành công");
  } catch (err) {
    next(err);
  }
});

module.exports = router;
