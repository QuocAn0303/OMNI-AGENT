/**
 * modules/crm/campaign-tracking.routes.js — Endpoint công khai đo + từ chối (CRM Phase 4)
 *
 * Tổng quan:
 * - Đây là các endpoint **KHÔNG** yêu cầu đăng nhập: chúng được gọi bởi máy đọc mail
 *   (pixel) và bởi người nhận bấm link. Xác thực bằng token ngẫu nhiên sinh lúc gửi,
 *   không dùng JWT (mail client không có JWT).
 * - Cố ý KHÔNG dùng `router.use(authenticate)` như `campaigns.routes.js`: cùng đó là
 *   token trong link, không phải phiên đăng nhập.
 * - `GET /unsubscribe/:token` chỉ hiển thị trang xác nhận — KHÔNG đổi state.
 *   Nhiều trình quét link của mail client (Bắc Ninh/scan) tự GET sẵn link, nếu GET
 *   mà từ chối luôn thì khách bị hủy đăng ký oan. Chỉ `POST` mới thực thi.
 *
 * Routes:
 * - GET  /open/:token.gif       : pixel 1x1, ghi sự kiện OPEN (trả ảnh, không phải JSON)
 * - GET  /click/:token?url=     : ghi CLICK rồi 302 về URL đích
 * - GET  /unsubscribe/:token    : trang HTML xác nhận từ chối
 * - POST /unsubscribe/:token    : thực thi từ chối, trả HTML
 *
 * CRM audit L25/L26:
 * - Không phân biệt 200 vs 404 theo token (không làm oracle dò link hợp lệ).
 * - `reason` được validate bằng Zod (`unsubscribeBodySchema`) — form HTML gửi
 *   text tự do, không đi qua app nên không có chỗ nào chặn sẵn.
 */
const router = require("express").Router();
const { z } = require("zod");
const tracking = require("./campaign-tracking.service");
const logger = require("../../utils/logger");

/** CRM audit L26 — `reason` do người nhận tự gõ trong form HTML. */
const unsubscribeBodySchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

// GIF 1x1 trong suốt — 43 byte, base64 hardcode để không phụ thuộc asset ngoài.
const PIXEL_GIF = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64",
);

const escapeHtml = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );

// IP phía sau proxy — chỉ để ghi vào metadata thống kê, không dùng quyết định gì
const clientIp = (req) =>
  String(req.headers["x-forwarded-for"] || req.ip || "").split(",")[0].trim().slice(0, 45) || null;

const html = (res, status, title, bodyHtml) =>
  res
    .status(status)
    .type("html")
    // Không cho index/search engine đục vào trang có token
    .set("X-Robots-Tag", "noindex, nofollow")
    .set("Cache-Control", "no-store")
    .send(`<!doctype html>
<html lang="vi"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${escapeHtml(title)}</title></head>
<body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f6f7f9;margin:0;padding:40px 16px">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:28px;box-shadow:0 1px 3px rgba(0,0,0,.08)">
    <h1 style="margin:0 0 12px;font-size:20px;color:#111827">${escapeHtml(title)}</h1>
    ${bodyHtml}
  </div>
</body></html>`);

/**
 * @swagger
 * /api/crm/track/open/{token}.gif:
 *   get:
 *     summary: Pixel đo lượt mở email (public, xác thực bằng token)
 *     tags: [CRM]
 *     parameters:
 *       - in: path
 *         name: token
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Trả về ảnh GIF 1x1 }
 */
router.get("/open/:file", async (req, res) => {
  // Filename là "token.gif" — bóc ".gif" để lấy token
  const raw = String(req.params.file || "");
  const token = raw.endsWith(".gif") ? raw.slice(0, -4) : raw;
  try {
    await tracking.trackOpen(token, { ip: clientIp(req) });
  } catch (err) {
    // Pixel không bao giờ được lỗi cho client thấy — vẫn trả ảnh
    logger.error("[crm:track] open pixel lỗi", err.message);
  }
  res.set("Cache-Control", "no-store, no-cache, must-revalidate");
  res.type("image/gif").send(PIXEL_GIF);
});

/**
 * @swagger
 * /api/crm/track/click/{token}:
 *   get:
 *     summary: Ghi lượt bấm link rồi chuyển hướng (public, xác thực bằng token)
 *     tags: [CRM]
 *     parameters:
 *       - in: path
 *         name: token
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: url
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       302: { description: Chuyển hướng tới URL đích }
 *       400: { description: Token sai hoặc URL đích không an toàn }
 */
router.get("/click/:token", async (req, res) => {
  let result;
  try {
    result = await tracking.trackClick(req.params.token, req.query.url, { ip: clientIp(req) });
  } catch (err) {
    logger.error("[crm:track] click lỗi", err.message);
    return res.redirect(302, tracking.baseUrl());
  }
  if (!result.ok) {
    return html(
      res,
      400,
      "Link không hợp lệ",
      `<p style="color:#4b5563;line-height:1.6">Link này đã hết hiệu lực hoặc không an toàn.
      Nếu bạn cần xem nội dung, hãy mở lại email gần nhất.</p>`,
    );
  }
  return res.redirect(302, result.url);
});

/**
 * @swagger
 * /api/crm/track/unsubscribe/{token}:
 *   get:
 *     summary: Trang xác nhận từ chối nhận tin (public — KHÔNG đổi state)
 *     tags: [CRM]
 *     parameters:
 *       - in: path
 *         name: token
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Trang xác nhận }
 *   post:
 *     summary: Thực thi từ chối nhận tin (public, xác thực bằng token)
 *     tags: [CRM]
 *     parameters:
 *       - in: path
 *         name: token
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason: { type: string }
 *     responses:
 *       200: { description: Đã ghi nhận từ chối }
 *       404: { description: Token không hợp lệ }
 */
router.get("/unsubscribe/:token", async (req, res) => {
  let preview;
  try {
    preview = await tracking.getUnsubscribePreview(req.params.token);
  } catch (err) {
    logger.error("[crm:track] unsubscribe preview lỗi", err.message);
    return html(res, 500, "Lỗi hệ thống", `<p style="color:#4b5563">Vui lòng thử lại sau.</p>`);
  }

  // CRM audit L25: KHÔNG phân biệt 200 vs 404 theo token. Trả cùng một trang "đã
  // từ chối" cho mọi token — kể cả token không tồn tại. Lý do: token là 192 bit
  // (`randomBytes(24)`) nên không đoán được, nhưng khác biệt status/nội dung vẫn
  // biến endpoint thành oracle kiểm tra "token này có thật không", và người dùng
  // vô tình là lộ dữ liệu khách hàng qua việc dò link.
  if (!preview.found || preview.alreadyUnsubscribed) {
    return html(
      res,
      200,
      "Đã từ chối trước đó",
      `<p style="color:#4b5563;line-height:1.6">Bạn đã từ chối nhận tin từ trước.
      Chúng tôi sẽ không gửi thêm tin marketing nào cho bạn.</p>`,
    );
  }

  const token = escapeHtml(req.params.token);
  return html(
    res,
    200,
    "Ngừng nhận tin từ chúng tôi?",
    `<p style="color:#4b5563;line-height:1.6;margin:0 0 20px">
      Bấm nút bên dưới để ngừng nhận tin marketing từ chúng tôi.
      Việc này áp dụng cho <strong>mọi</strong> chiến dịch qua kênh
      ${escapeHtml(preview.channel || "")} và không thể hoàn tác.</p>
    <form method="post" action="/api/crm/track/unsubscribe/${token}">
      <button type="submit"
        style="background:#dc2626;color:#fff;border:0;border-radius:8px;padding:12px 20px;font-size:15px;cursor:pointer">
        Ngừng nhận tin
      </button>
    </form>`,
  );
});

router.post("/unsubscribe/:token", async (req, res) => {
  try {
    // CRM audit L26: route CRM này là route DUY NHẤT không validate body.
    // `reason` là text tự do do người dùng gõ (form HTML, không qua app) → phải
    // chặn độ dài và kiểu, nếu không là nơi đẩy chữ thừa vào DB.
    const parsed = unsubscribeBodySchema.safeParse(req.body ?? {});
    const reason = parsed.success ? parsed.data.reason : undefined;

    const result = await tracking.applyUnsubscribe(req.params.token, reason);
    // L25: cùng lý do với GET — response không phải oracle kiểm tra token.
    logger.info(
      `[crm:track] unsubscribe channel=${result.channel} already=${result.alreadyUnsubscribed}`,
    );
    return html(
      res,
      200,
      "Đã ngừng nhận tin",
      `<p style="color:#4b5563;line-height:1.6">Cảm ơn bạn. Yêu cầu đã được ghi nhận —
      bạn sẽ không còn nhận tin marketing từ chúng tôi nữa.</p>`,
    );
  } catch (err) {
    logger.error("[crm:track] unsubscribe lỗi", err.message);
    return html(
      res,
      500,
      "Lỗi hệ thống",
      `<p style="color:#4b5563;line-height:1.6">Không ghi nhận được yêu cầu. Vui lòng thử lại sau.</p>`,
    );
  }
});

module.exports = router;