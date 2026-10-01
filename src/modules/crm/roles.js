/**
 * modules/crm/roles.js — Ma trận role của toàn bộ CRM (1 nguồn duy nhất)
 *
 * Vì sao cần file này:
 * Trước đây mỗi route tự liệt kê role (`authorize("SUPER_ADMIN","ADMIN",...)`) và
 * các bản liệt kê lệch nhau — CRM audit M1 liệt kê 4 trường hợp:
 *   - pipeline routes thiếu `SUPER_OMEGA_ULTRA_ADMIN`
 *   - notes/tags thiếu `SUPER_ADMIN`
 *   - campaigns thiếu `SUPER_ADMIN`
 *   - webhook-lead chỉ cho `ADMIN` ⇒ không ai cao hơn ADMIN xoay được API key
 * Ma trận viết rải rác ở 12 file là không thể kiểm tra bằng mắt và chắc chắn lệch
 * tiếp ở lần sửa kế tiếp. Gom vào đây + test đọc chính file này là cách rẻ nhất.
 *
 * Quy ước:
 *   - SUPER_OMEGA_ULTRA_ADMIN luôn có mặt ở mọi nhóm (bypass tenant-scoping).
 *   - Nhóm "manager" = quản lý nghiệp vụ (đọc/sửa toàn tenant theo cây báo cáo).
 *   - Nhóm "self" = mỗi người chỉ thấy việc của mình (CASHIER).
 *
 * Lưu ý: `authorize()` của `auth.middleware` kiểm tra đúng danh sách role truyền
 * vào ⇒ thêm role ở đây là đủ, không cần sửa middleware.
 */

// Đọc/sửa pipeline CRM (lead, deal, stage, organization, contact, dashboard)
const CRM_PIPELINE_ROLES = [
  "SUPER_OMEGA_ULTRA_ADMIN",
  "SUPER_ADMIN",
  "ADMIN",
  "MANAGER",
  "CASHIER",
];

// Thao tác cấu hình (tạo/sửa/xoá stage, org, contact, đổi cây báo cáo)
const CRM_MANAGER_ROLES = ["SUPER_OMEGA_ULTRA_ADMIN", "SUPER_ADMIN", "ADMIN", "MANAGER"];

// Ghi chú / tag / nhiệm vụ — CASHIER dùng cho việc của mình nên vẫn vào
const CRM_NOTE_ROLES = [...CRM_PIPELINE_ROLES];

// Phân khúc + chiến dịch marketing — không mở cho CASHIER
const CRM_MARKETING_ROLES = [...CRM_MANAGER_ROLES];

// Đổi API key webhook — cấu hình bảo mật, chỉ cấp cao nhất
const CRM_ADMIN_ROLES = ["SUPER_OMEGA_ULTRA_ADMIN", "SUPER_ADMIN", "ADMIN"];

module.exports = {
  CRM_PIPELINE_ROLES,
  CRM_MANAGER_ROLES,
  CRM_NOTE_ROLES,
  CRM_MARKETING_ROLES,
  CRM_ADMIN_ROLES,
};