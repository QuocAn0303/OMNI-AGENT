const router = require("express").Router();
const prisma = require("../../config/prisma");
const fs = require("fs");
const {
  authenticate,
  requireSuperOmega,
} = require("../../middleware/auth.middleware");
const { success } = require("../../utils/response");
const backupService = require("./backup.service");

router.post("/backup", authenticate, requireSuperOmega, async (req, res, next) => {
  try {
    const result = await backupService.create(req.user.id);
    success(res, result, "Sao lưu thành công");
  } catch (e) { next(e); }
});

router.get("/backups", authenticate, requireSuperOmega, async (req, res, next) => {
  try {
    const backups = await backupService.list();
    success(res, backups);
  } catch (e) { next(e); }
});

router.post("/backups/:id/restore", authenticate, requireSuperOmega, async (req, res, next) => {
  try {
    await backupService.restore(req.params.id, req.user.id);
    success(res, null, "Khôi phục thành công");
  } catch (e) { next(e); }
});

router.delete("/backups/:id", authenticate, requireSuperOmega, async (req, res, next) => {
  try {
    const backup = await prisma.adminBackup.findUnique({ where: { id: req.params.id } });
    if (!backup) return next({ status: 404, message: "Không tìm thấy bản backup" });
    if (fs.existsSync(backup.filepath)) fs.unlinkSync(backup.filepath);
    await prisma.adminBackup.delete({ where: { id: req.params.id } });
    success(res, null, "Đã xóa bản backup");
  } catch (e) { next(e); }
});

module.exports = router;
