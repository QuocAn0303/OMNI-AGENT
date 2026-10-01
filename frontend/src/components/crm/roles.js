/**
 * Frontend: src/components/crm/roles.js — Ma trận role CRM (phía FE)
 *
 * PHẢI khớp `src/modules/crm/roles.js` của backend (roles.js chính là nguồn
 * chuẩn; file này là bản sao cho FE vì FE không import được source backend).
 *
 * Vì sao cần: CRM audit H8/M1 — trước đây:
 *   - `App.jsx` chặn khối route CRM ở `["ADMIN","MANAGER"]` ⇒ `SUPER_ADMIN` và
 *     `SUPER_OMEGA_ULTRA_ADMIN` (đều có trong seed) bị redirect /403 ở 6 trang,
 *     trong khi backend CÓ cho phép và các page đã viết `isManager` bao gồm
 *     SUPER_ADMIN ⇒ nhánh SUPER_ADMIN là code chết.
 *   - `Sidebar.jsx` có 3 item pipeline không khai báo `roles` ⇒ thừa hưởng
 *     `roles: ALL_ROLES` của group ⇒ hiện cho ACCOUNTANT/WAREHOUSE, bấm vào nhận
 *     403 thật từ router.
 *
 * Nếu sửa ma trận thì sửa CẢ 2 file cùng lúc. `tests/crm-roles.contract.test.js`
 * đọc cả hai và fail nếu lệch.
 */

// Xem/sửa pipeline CRM (lead, deal, stage, organization, contact, dashboard)
export const CRM_PIPELINE_ROLES = [
  "SUPER_OMEGA_ULTRA_ADMIN",
  "SUPER_ADMIN",
  "ADMIN",
  "MANAGER",
  "CASHIER",
];

// Trang quản trị CRM: tổ chức, liên hệ, cấu hình pipeline, cây báo cáo,
// insights, dashboard. Backend: `CRM_MANAGER_ROLES`.
export const CRM_MANAGER_ROLES = [
  "SUPER_OMEGA_ULTRA_ADMIN",
  "SUPER_ADMIN",
  "ADMIN",
  "MANAGER",
];

// Phân khúc + chiến dịch marketing. Backend: `CRM_MARKETING_ROLES`.
export const CRM_MARKETING_ROLES = [...CRM_MANAGER_ROLES];

// Đổi cây báo cáo (PUT reports-to) — chỉ ADMIN trở lên. Backend: `CRM_ADMIN_ROLES`.
export const CRM_ADMIN_ROLES = ["SUPER_OMEGA_ULTRA_ADMIN", "SUPER_ADMIN", "ADMIN"];