// src/modules/users/user.routes.js
const router = require("express").Router();
const { z } = require("zod");
const userService = require("./user.service");
const { authenticate, authorize } = require("../../middleware/auth.middleware");
const { success, created, paginated } = require("../../utils/response");

const createSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  fullName: z.string().min(2),
  role: z.enum(["ADMIN", "MANAGER", "CASHIER", "WAREHOUSE"]).default("CASHIER"),
});

const updateSchema = z.object({
  email: z.string().email().optional(),
  password: z.string().min(6).optional(),
  fullName: z.string().min(2).optional(),
  role: z.enum(["ADMIN", "MANAGER", "CASHIER", "WAREHOUSE"]).optional(),
  isActive: z.boolean().optional(),
}).strict();

// Tất cả routes yêu cầu đăng nhập + role ADMIN
router.use(authenticate, authorize("ADMIN"));
// Lấy danh sách người dùng với phân trang
router.get("/", async (req, res, next) => {
  try {
    const { users, pagination } = await userService.getAll(req.query);
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

router.post("/", async (req, res, next) => {
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
