'use strict';

/**
 * modules/partners/index.js — Gom routes của phân hệ PRM vào một router
 *
 * Ba nhóm tách riêng vì ba đối tượng khác nhau và quyền khác nhau:
 *   /partners          hồ sơ đối tác (cấu hình, có tiền ⇒ quyền cao)
 *   /partner-referrals lượt giới thiệu (dữ liệu vận hành hằng ngày)
 *   /partner-roi       báo cáo hiệu quả (đọc, ai cũng xem được)
 *
 * Giữ nguyên kiểu của `crm/index.js`: mỗi tệp routes tự bọp `authenticate` và
 * `requireModule`, router ở đây chỉ gom, không bọc thêm.
 *
 * THỨ TỰ MOUNT CÓ Ý NGHĨA — ĐỪNG ĐẢO:
 * `partner.routes` có `GET /:id`. Khi nó được mount ở "/", đường dẫn "/referrals"
 * và "/roi" cũng khớp với `/:id` (`id = "referrals"`), và Express sẽ dừng ở đó —
 * không chuyển tiếp sang router con. Hậu quả: `GET /api/partners/referrals` trả
 * 404 "không tìm thấy đối tác" thay vì trả danh sách lượt giới thiệu.
 *
 * Vì vậy router có tiền tố riêng (`/referrals`, `/roi`) PHẢI mount trước router gốc.
 * `tests/partner-routing.test.js` khẳng định điều này bằng Express thật.
 */
const router = require("express").Router();

// Nhóm có tiền tố — mount trước để không bị `/:id` của nhóm gốc bắt mất.
router.use("/referrals", require("./referral.routes"));
router.use("/roi", require("./roi.routes"));
router.use("/", require("./partner.routes"));

module.exports = router;