/**
 * utils/crypto.js — Mã hóa AES-256-GCM cho IntegrationConfig secrets
 * 
 * Tổng quan:
 * - Dùng để mã hóa/giải mã các API key, secret lưu trong DB (IntegrationConfig)
 * - Key lấy từ ENCRYPTION_KEY (≥ 32 ký tự) → hash SHA256 → 32 bytes key
 * - Fallback dev: derive key từ JWT_SECRET (không khuyến nghị cho production)
 * - Output: base64(encrypted_data + auth_tag) + base64(iv)
 * 
 * Hàm:
 * - encrypt(plain): Trả về { valueEnc, iv } — null nếu input rỗng
 * - decrypt(valueEnc, iv): Giải mã, trả về plain text — null nếu lỗi
 */

const crypto = require("crypto");

const ALGO = "aes-256-gcm";

function _key() {
  const raw = process.env.ENCRYPTION_KEY || "";
  if (!raw || raw.length < 32) {
    // Dev fallback: derive from JWT_SECRET so app vẫn chạy được khi chưa set.
    const seed = process.env.JWT_SECRET || "aduu-default-dev-key-do-not-use-in-prod";
    return crypto.createHash("sha256").update(seed).digest();
  }
  return crypto.createHash("sha256").update(raw).digest();
}

function encrypt(plain) {
  if (plain == null || plain === "") return { valueEnc: null, iv: null };
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, _key(), iv);
  const enc = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    valueEnc: Buffer.concat([enc, tag]).toString("base64"),
    iv: iv.toString("base64"),
  };
}

function decrypt(valueEnc, iv) {
  if (!valueEnc || !iv) return null;
  try {
    const buf = Buffer.from(valueEnc, "base64");
    const tag = buf.slice(buf.length - 16);
    const enc = buf.slice(0, buf.length - 16);
    const decipher = crypto.createDecipheriv(ALGO, _key(), Buffer.from(iv, "base64"));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
  } catch (_) {
    return null;
  }
}

module.exports = { encrypt, decrypt };
