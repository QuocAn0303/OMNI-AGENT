/**
 * modules/integrations/integration-config.service.js — Quản lý cấu hình tích hợp
 * 
 * Tổng quan:
 * - Lưu trữ cấu hình các dịch vụ tích hợp (VNPT, Cloudinary, SMS, EMAIL)
 * - Ưu tiên: DB (mã hoá secret) > process.env
 * - Cache in-memory 60s, tự động invalidate khi set
 * - Che secrets khi trả về client
 * 
 * Hàm:
 * - isSecret(key): Kiểm tra key có phải secret không
 * - get(key): Lấy giá trị từ cache/DB/ env, hỗ trợ decrypt
 * - getMany(keys): Lấy nhiều key cùng lúc
 * - set(key, value, userId): Lưu giá trị, tự động mã hoá nếu là secret
 * - setMany(values, userId): Lưu nhiều key cùng lúc
 * - getCategoryMasked(category): Lấy cấu hình một nhóm, secrets bị che (••••••••)
 * - getAllMasked(): Lấy tất cả cấu hình, secrets bị che
 * - invalidateCache(): Xoá toàn bộ cache
 */
// src/modules/integrations/integration-config.service.js
// Quản lý cấu hình tích hợp (VNPT, Cloudinary, SMS, SMTP).
// Ưu tiên: DB > process.env. Cache in-memory 60s, invalidate khi set().
const prisma = require("../../config/prisma");
const { encrypt, decrypt } = require("../../utils/crypto");

const SCHEMA = {
  VNPT: {
    keys: ["VNPT_EINVOICE_URL", "VNPT_USERNAME", "VNPT_PASSWORD", "VNPT_COM_CODE", "VNPT_TEMPLATE_CODE", "VNPT_SERIAL"],
    secrets: ["VNPT_PASSWORD"],
  },
  CLOUDINARY: {
    keys: ["CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"],
    secrets: ["CLOUDINARY_API_SECRET", "CLOUDINARY_API_KEY"],
  },
  SMS: {
    keys: ["SMS_PROVIDER", "SMS_API_KEY", "SMS_API_SECRET", "SMS_BRAND_NAME"],
    secrets: ["SMS_API_KEY", "SMS_API_SECRET"],
  },
  EMAIL: {
    keys: ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "SMTP_FROM", "SMTP_SECURE"],
    secrets: ["SMTP_PASS"],
  },
};

const ALL_KEYS = Object.values(SCHEMA).flatMap((s) => s.keys);
const SECRET_KEYS = new Set(Object.values(SCHEMA).flatMap((s) => s.secrets));
const KEY_TO_CATEGORY = {};
for (const [cat, def] of Object.entries(SCHEMA)) {
  for (const k of def.keys) KEY_TO_CATEGORY[k] = cat;
}

const _cache = new Map(); // key -> { value, expiresAt }
const TTL = 60 * 1000;

const isSecret = (key) => SECRET_KEYS.has(key);

async function get(key) {
  const hit = _cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value;

  let value = null;
  try {
    const row = await prisma.integrationConfig.findUnique({ where: { key } });
    if (row && row.valueEnc) {
      // iv == null → giá trị non-secret lưu plain trong valueEnc; có iv → cần decrypt.
      value = row.iv ? decrypt(row.valueEnc, row.iv) : row.valueEnc;
    }
  } catch (_) { /* DB not ready — fall through */ }

  if (value == null || value === "") value = process.env[key] || null;

  _cache.set(key, { value, expiresAt: Date.now() + TTL });
  return value;
}

async function getMany(keys) {
  const out = {};
  await Promise.all(keys.map(async (k) => { out[k] = await get(k); }));
  return out;
}

async function set(key, value, userId = null) {
  if (!KEY_TO_CATEGORY[key]) throw { status: 400, message: `Key không hợp lệ: ${key}` };
  const category = KEY_TO_CATEGORY[key];
  const secret = isSecret(key);
  const { valueEnc, iv } = secret ? encrypt(value) : { valueEnc: value == null ? null : String(value), iv: null };

  await prisma.integrationConfig.upsert({
    where: { key },
    create: { key, category, valueEnc, iv, isSecret: secret, updatedBy: userId },
    update: { valueEnc, iv, isSecret: secret, updatedBy: userId },
  });
  _cache.delete(key);
}

async function setMany(values, userId = null) {
  for (const [k, v] of Object.entries(values)) {
    if (KEY_TO_CATEGORY[k]) await set(k, v, userId);
  }
}

async function getCategoryMasked(category) {
  const def = SCHEMA[category];
  if (!def) throw { status: 404, message: "Category không tồn tại" };
  const out = {};
  for (const key of def.keys) {
    const value = await get(key);
    const hasValue = value != null && value !== "";
    out[key] = {
      isSet: hasValue,
      isSecret: isSecret(key),
      // Hiển thị value cho non-secret; secret thì che.
      value: hasValue ? (isSecret(key) ? "••••••••" : value) : "",
    };
  }
  return out;
}

async function getAllMasked() {
  const out = {};
  for (const cat of Object.keys(SCHEMA)) out[cat] = await getCategoryMasked(cat);
  return out;
}

function invalidateCache() { _cache.clear(); }

module.exports = {
  SCHEMA, ALL_KEYS, isSecret,
  get, getMany, set, setMany,
  getCategoryMasked, getAllMasked,
  invalidateCache,
};
