// src/modules/integrations/integration.routes.js
const router = require("express").Router();
const { authenticate, authorize } = require("../../middleware/auth.middleware");
const config = require("./integration-config.service");
const vnpt = require("../einvoice/provider/vnpt.adapter");
const cloudinary = require("../../config/cloudinary.config");
const { sendSms } = require("../../utils/sms");
const { sendEmail, verifyEmail, resetTransporter } = require("../../utils/email");

const adminOnly = authorize("SUPER_ADMIN", "ADMIN");

// GET /api/integrations — toàn bộ cấu hình (secrets bị che)
router.get("/", authenticate, adminOnly, async (req, res, next) => {
  try {
    res.json({ success: true, data: await config.getAllMasked() });
  } catch (e) { next(e); }
});

// GET /api/integrations/:category — 1 nhóm
router.get("/:category", authenticate, adminOnly, async (req, res, next) => {
  try {
    res.json({ success: true, data: await config.getCategoryMasked(req.params.category.toUpperCase()) });
  } catch (e) { next(e); }
});

// PUT /api/integrations/:category — cập nhật nhiều key trong 1 nhóm
// Body: { KEY1: value1, KEY2: value2 } — bỏ qua field rỗng / "••••••••" (không thay đổi)
router.put("/:category", authenticate, adminOnly, async (req, res, next) => {
  try {
    const category = req.params.category.toUpperCase();
    const def = config.SCHEMA[category];
    if (!def) throw { status: 404, message: "Category không tồn tại" };

    const toSet = {};
    for (const [k, v] of Object.entries(req.body || {})) {
      if (!def.keys.includes(k)) continue;
      if (v === "" || v === "••••••••" || v === undefined) continue;
      toSet[k] = v;
    }
    await config.setMany(toSet, req.user.id);

    // Reset transporter cache khi đổi SMTP
    if (category === "EMAIL") resetTransporter();

    res.json({ success: true, data: await config.getCategoryMasked(category), updated: Object.keys(toSet) });
  } catch (e) { next(e); }
});

// POST /api/integrations/:category/test — thử kết nối
router.post("/:category/test", authenticate, adminOnly, async (req, res, next) => {
  try {
    const category = req.params.category.toUpperCase();
    let result;
    switch (category) {
      case "VNPT":
        result = await vnpt.testConnection();
        break;
      case "CLOUDINARY":
        result = await cloudinary.testConnection();
        break;
      case "SMS": {
        const phone = req.body?.testPhone;
        if (!phone) throw { status: 400, message: "Cần testPhone trong body" };
        result = await sendSms(phone, "Aduu: SMS test connection OK.");
        break;
      }
      case "EMAIL": {
        const to = req.body?.testEmail;
        if (to) result = await sendEmail({ to, subject: "Aduu — Test SMTP", text: "Test gửi mail từ Aduu ERP." });
        else result = await verifyEmail();
        break;
      }
      default:
        throw { status: 400, message: "Category không hỗ trợ test" };
    }
    res.json({ success: true, data: result });
  } catch (e) { next(e); }
});

module.exports = router;
