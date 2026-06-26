/**
 * utils/template.js — Mustache-style template renderer
 * 
 * Tổng quan:
 * - Render template string: thay {{var}} và {{nested.var}} bằng giá trị từ object vars
 * - Hỗ trợ dot-path: {{customer.name}} → vars.customer.name
 * - Fallback rỗng nếu key không tồn tại
 * - Dùng cho email/SMS template, nội dung thông báo
 * 
 * Hàm:
 * - get(obj, path): Lấy giá trị theo dot-path từ object (an toàn, null → "")
 * - render(template, vars): Thay tất cả {{key}} trong template bằng giá trị từ vars
 * - customerVars(customer): Tạo vars object tiêu chuẩn từ customer (name, phone, email, tier, points, totalSpent)
 */

const get = (obj, path) => {
  const parts = path.split(".");
  let v = obj;
  for (const p of parts) {
    if (v == null) return "";
    v = v[p];
  }
  return v == null ? "" : String(v);
};

const render = (template, vars = {}) => {
  if (!template) return "";
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => get(vars, key.trim()));
};

const customerVars = (customer) => ({
  name: customer?.name || "",
  phone: customer?.phone || "",
  email: customer?.email || "",
  tier: customer?.tier || "",
  points: customer?.loyaltyPoints ?? 0,
  totalSpent: customer?.totalSpent ?? 0,
  customer: customer || {},
});

module.exports = { render, customerVars };
