const router = require("express").Router();
const { z } = require("zod");
const bankAccountService = require("./bank-account.service");
const { authenticate, authorize } = require("../../middleware/auth.middleware");
const { success, created } = require("../../utils/response");

const createSchema = z.object({
  accountNumber: z.string().min(1, "Số tài khoản là bắt buộc"),
  bankName: z.string().min(1, "Tên ngân hàng là bắt buộc"),
  accountName: z.string().min(1, "Tên chủ tài khoản là bắt buộc"),
  accountId: z.string().optional(),
  openingBalance: z.number().optional().default(0),
  isDefault: z.boolean().optional().default(false),
  note: z.string().optional(),
});

const updateSchema = z.object({
  accountNumber: z.string().optional(),
  bankName: z.string().optional(),
  accountName: z.string().optional(),
  accountId: z.string().optional(),
  openingBalance: z.number().optional(),
  isDefault: z.boolean().optional(),
  note: z.string().optional(),
});

router.use(authenticate);

router.get("/", authorize("ADMIN", "MANAGER", "ACCOUNTANT"), async (req, res, next) => {
  try {
    const accounts = await bankAccountService.list();
    success(res, accounts);
  } catch (e) { next(e); }
});

router.post("/", authorize("ADMIN", "ACCOUNTANT"), async (req, res, next) => {
  try {
    const data = createSchema.parse(req.body);
    const account = await bankAccountService.create(data);
    created(res, account, "Thêm tài khoản ngân hàng thành công");
  } catch (e) { next(e); }
});

router.put("/:id", authorize("ADMIN", "ACCOUNTANT"), async (req, res, next) => {
  try {
    const data = updateSchema.parse(req.body);
    const account = await bankAccountService.update(req.params.id, data);
    success(res, account, "Cập nhật tài khoản ngân hàng thành công");
  } catch (e) { next(e); }
});

router.delete("/:id", authorize("ADMIN"), async (req, res, next) => {
  try {
    await bankAccountService.remove(req.params.id);
    success(res, null, "Đã xóa tài khoản ngân hàng");
  } catch (e) { next(e); }
});

module.exports = router;
