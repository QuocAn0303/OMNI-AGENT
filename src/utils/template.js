// src/utils/template.js
// Simple mustache-style renderer: thay {{var}} bằng giá trị từ vars.
// Hỗ trợ dot-path: {{customer.name}}, fallback rỗng nếu không có.
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
