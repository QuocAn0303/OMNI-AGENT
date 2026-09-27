/**
 * utils/piiMask.js — Mask dữ liệu cá nhân (PII) trong API response
 *
 * Áp dụng cho role không cần xem full PII (CASHIER, WAREHOUSE):
 * - phone: 0912345678 → 09***5678
 * - email: nguyen@email.com → n***@email.com
 * - taxCode: 0123456789 → 0123***789
 * - address: 123 Nguyen Trai... → 123 Nguy*** (giữ 8 ký tự đầu)
 * - cccd/idNumber: 079201000123 → 079201000123 (giữ 3 đầu + 3 cuối)
 *
 * Role ADMIN, MANAGER, ACCOUNTANT xem full (cần cho kế toán, CRM).
 *
 * Deep mask: đệ quy qua toàn bộ object/array — bất kỳ key trùng tên PII
 * (kể cả lồng sâu trong nested object) đều bị mask.
 */
const PII_ROLES_FULL = new Set(["ADMIN", "MANAGER", "ACCOUNTANT", "SUPER_OMEGA_ULTRA_ADMIN", "SUPER_ADMIN"]);

const maskPhone = (phone) => {
  if (!phone || phone.length < 4) return phone;
  return phone.slice(0, 2) + "***" + phone.slice(-4);
};

const maskEmail = (email) => {
  if (!email || !email.includes("@")) return email;
  const [name, domain] = email.split("@");
  return name[0] + "***@" + domain;
};

const maskTaxCode = (tax) => {
  if (!tax || tax.length < 6) return tax;
  return tax.slice(0, 3) + "***" + tax.slice(-3);
};

const maskAddress = (addr) => {
  if (!addr || addr.length < 8) return addr;
  return addr.slice(0, 8) + "***";
};

const maskIdNumber = (id) => {
  if (!id || id.length < 8) return id;
  return id.slice(0, 3) + "***" + id.slice(-3);
};

const MASKERS = {
  phone: maskPhone,
  email: maskEmail,
  taxCode: maskTaxCode,
  address: maskAddress,
  cccd: maskIdNumber,
  idNumber: maskIdNumber,
};

const maskObject = (obj) => {
  if (!obj || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(maskObject);
  const out = { ...obj };
  for (const key of Object.keys(out)) {
    const value = out[key];
    if (typeof value === "string" && MASKERS[key]) {
      out[key] = MASKERS[key](value);
    } else if (value && typeof value === "object") {
      out[key] = maskObject(value);
    }
  }
  return out;
};

const maskPII = (data, role) => {
  if (!data || PII_ROLES_FULL.has(role)) return data;
  return maskObject(data);
};

module.exports = { maskPII, maskPhone, maskEmail, maskTaxCode, maskAddress, maskIdNumber, PII_ROLES_FULL };
