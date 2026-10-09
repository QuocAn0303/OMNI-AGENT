'use strict';

/**
 * modules/partners/roles.js — Ma trận vai trò của phân hệ PRM
 *
 * Vì sao tách riêng, không dùng `crm/roles.js`:
 * Đối tác là đối tượng KHÁC khách hàng. Cấu hình đối tác (tỷ lệ hoa hồng, ngừng
 * hoạt động) là việc quản trị, không phải việc thu ngân cần làm hằng ngày. Nếu
 * dùng chung `CRM_PIPELINE_ROLES` thì CASHIER sẽ sửa được tỷ lệ hoa hồng.
 *
 * Nguyên tắc giữ nguyên từ `crm/roles.js`:
 *   - SUPER_OMEGA_ULTRA_ADMIN luôn có mặt ở mọi nhóm (bypass tenant-scoping).
 *   - `authorize()` kiểm tra đúng danh sách role truyền vào ⇒ thêm role ở đây là
 *     đủ, không cần sửa middleware.
 *
 * Mức chia:
 *   PRM_READ_ROLES    — xem danh sách, báo cáo. MANAGER trở lên cộng CASHIER vì
 *                       nhân viên cần xem hiệu quả đối tác khi gọi khách.
 *   PRM_MANAGE_ROLES  — tạo/sửa đối tác, ghi lượt giới thiệu.
 *   PRM_ADMIN_ROLES   — xoá mềm, khoá, khoá lại đối tác. Chỉ cấp cao nhất vì đây
 *                       là cấu hình có tiền.
 */

// Xem đối tác + báo cáo hiệu quả + phễu chuyển đổi
const PRM_READ_ROLES = [
  "SUPER_OMEGA_ULTRA_ADMIN",
  "SUPER_ADMIN",
  "ADMIN",
  "MANAGER",
  "CASHIER",
];

// Tạo/sửa đối tác, ghi lượt giới thiệu
const PRM_MANAGE_ROLES = ["SUPER_OMEGA_ULTRA_ADMIN", "SUPER_ADMIN", "ADMIN", "MANAGER"];

// Ngừng hoạt động / khoá lại đối tác
const PRM_ADMIN_ROLES = ["SUPER_OMEGA_ULTRA_ADMIN", "SUPER_ADMIN", "ADMIN"];

module.exports = { PRM_READ_ROLES, PRM_MANAGE_ROLES, PRM_ADMIN_ROLES };