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
const fs = require("fs");
const { pipeline } = require("stream/promises");
const logger = require('./logger');

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;
const DEK_LEN = 32;

// File backup encrypted formats:
//   V1 legacy: [magic "ADUUENC1" (8B)][iv (12B)][ciphertext...][authTag (16B)]
//   V2 envelope: [magic "ADUUENC2" (8B)][ivDEK (12B)][wrappedDEK (48B)][ivData (12B)][ciphertext...][dataTag (16B)]
//   V2 mỗi file dùng DEK (data encryption key) ngẫu nhiên; DEK được mã hóa bằng master key
//   (ENCRYPTION_KEY). Rotation master key: đặt khóa cũ vào ENCRYPTION_KEY_PREVIOUS để vẫn giải mã được dữ liệu cũ.
const FILE_MAGIC = Buffer.from("ADUUENC1", "utf8");
const FILE_MAGIC_V2 = Buffer.from("ADUUENC2", "utf8");
const ENV_HEADER_LEN = FILE_MAGIC_V2.length + IV_LEN + (DEK_LEN + TAG_LEN) + IV_LEN;

function _key() {
  const raw = process.env.ENCRYPTION_KEY || "";
  if (!raw || raw.length < 32) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "ENCRYPTION_KEY phải được đặt (≥ 32 ký tự) ở production. " +
        "Tạo bằng: node -e \"require('crypto').randomBytes(32).toString('hex')\""
      );
    }
    if (!process.env.JWT_SECRET) {
      throw new Error("Thiếu ENCRYPTION_KEY và JWT_SECRET — không thể mã hóa.");
    }
    logger.warn("[crypto] ENCRYPTION_KEY chưa đặt — deriving from JWT_SECRET (chỉ dev)");
    return crypto.createHash("sha256").update(process.env.JWT_SECRET).digest();
  }
  return crypto.createHash("sha256").update(raw).digest();
}

/**
 * Danh sách master key để giải mã (theo thứ tự ưu tiên).
 * Hỗ trợ rotation: ENCRYPTION_KEY = khóa hiện tại, ENCRYPTION_KEY_PREVIOUS = khóa cũ.
 */
function _keys() {
  const keys = [_key()];
  const prev = process.env.ENCRYPTION_KEY_PREVIOUS;
  if (prev && prev.length >= 32) {
    keys.push(crypto.createHash("sha256").update(prev).digest());
  }
  return keys;
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

/**
 * Mã hóa file (streaming AES-256-GCM, envelope encryption) — dùng cho DB backup.
 * Mỗi file sinh 1 DEK (data encryption key) ngẫu nhiên; DEK được "wrap" bằng master key
 * (ENCRYPTION_KEY) và lưu kèm header → rotation master key không cần mã hóa lại dữ liệu cũ.
 * Format: [magic "ADUUENC2" (8B)][ivDEK (12B)][wrappedDEK (48B)][ivData (12B)][ciphertext...][dataTag (16B)]
 * @returns {Promise<{ bytesRead: number, bytesWritten: number }>}
 */
async function encryptFile(srcPath, destPath) {
  const dek = crypto.randomBytes(DEK_LEN);
  const ivDek = crypto.randomBytes(IV_LEN);
  const wrapCipher = crypto.createCipheriv(ALGO, _key(), ivDek);
  const wrappedDek = Buffer.concat([wrapCipher.update(dek), wrapCipher.final()]);
  const wrapTag = wrapCipher.getAuthTag();

  const ivData = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, dek, ivData);
  const out = fs.createWriteStream(destPath);
  await new Promise((resolve, reject) => {
    out.once("open", () => {
      out.write(FILE_MAGIC_V2);
      out.write(ivDek);
      out.write(wrappedDek);
      out.write(wrapTag);
      out.write(ivData);
      resolve();
    });
    out.once("error", reject);
  });
  await pipeline(fs.createReadStream(srcPath), cipher, out);
  const tag = cipher.getAuthTag();
  await fs.promises.appendFile(destPath, tag);
  return { bytesRead: (await fs.promises.stat(srcPath)).size, bytesWritten: (await fs.promises.stat(destPath)).size };
}

async function _readAt(srcPath, len, pos) {
  const fh = await fs.promises.open(srcPath, "r");
  try {
    const buf = Buffer.alloc(len);
    const { bytesRead } = await fh.read(buf, 0, len, pos);
    if (bytesRead !== len) throw new Error("File backup mã hóa bị hỏng (header không đầy đủ)");
    return buf;
  } finally {
    await fh.close();
  }
}

/** Giải mã file backup định dạng V1 (legacy, trước envelope encryption) — thử từng master key. */
async function _decryptLegacy(srcPath, destPath) {
  const fileSize = (await fs.promises.stat(srcPath)).size;
  const bodyStart = FILE_MAGIC.length + IV_LEN;
  const iv = await _readAt(srcPath, IV_LEN, FILE_MAGIC.length);
  const tag = await _readAt(srcPath, TAG_LEN, fileSize - TAG_LEN);
  const cipherBytes = fileSize - bodyStart - TAG_LEN;
  if (cipherBytes < 0) throw new Error("File backup mã hóa bị hỏng (kích thước không hợp lệ)");

  let lastError = null;
  for (const key of _keys()) {
    await fs.promises.rm(destPath, { force: true });
    try {
      const decipher = crypto.createDecipheriv(ALGO, key, iv);
      decipher.setAuthTag(tag);
      const out = fs.createWriteStream(destPath);
      await pipeline(
        fs.createReadStream(srcPath, { start: bodyStart, end: bodyStart + cipherBytes - 1 }),
        decipher,
        out,
      );
      return;
    } catch (e) {
      lastError = e;
      await fs.promises.rm(destPath, { force: true }).catch(() => {});
    }
  }
  throw new Error(`Không thể giải mã backup — kiểm tra ENCRYPTION_KEY/ENCRYPTION_KEY_PREVIOUS (${lastError?.message || "sai khóa"})`);
}

/** Giải mã file backup định dạng V2 (envelope): unwrap DEK bằng master key, rồi giải mã dữ liệu. */
async function _decryptEnvelope(srcPath, destPath) {
  const fileSize = (await fs.promises.stat(srcPath)).size;
  const ivDek = await _readAt(srcPath, IV_LEN, FILE_MAGIC_V2.length);
  const wrapped = await _readAt(srcPath, DEK_LEN + TAG_LEN, FILE_MAGIC_V2.length + IV_LEN);
  const ivData = await _readAt(srcPath, IV_LEN, FILE_MAGIC_V2.length + IV_LEN + DEK_LEN + TAG_LEN);
  const tag = await _readAt(srcPath, TAG_LEN, fileSize - TAG_LEN);
  const bodyStart = ENV_HEADER_LEN;
  const cipherBytes = fileSize - bodyStart - TAG_LEN;
  if (cipherBytes < 0) throw new Error("File backup mã hóa bị hỏng (kích thước không hợp lệ)");

  const wrapTag = wrapped.subarray(DEK_LEN);
  const wrapEnc = wrapped.subarray(0, DEK_LEN);
  let dek = null;
  let lastError = null;
  for (const key of _keys()) {
    try {
      const decipher = crypto.createDecipheriv(ALGO, key, ivDek);
      decipher.setAuthTag(wrapTag);
      dek = Buffer.concat([decipher.update(wrapEnc), decipher.final()]);
      break;
    } catch (e) {
      lastError = e;
    }
  }
  if (!dek) {
    throw new Error(`Không thể giải mã khóa dữ liệu backup — kiểm tra ENCRYPTION_KEY/ENCRYPTION_KEY_PREVIOUS (${lastError?.message || "sai khóa"})`);
  }

  await fs.promises.rm(destPath, { force: true });
  const decipher = crypto.createDecipheriv(ALGO, dek, ivData);
  decipher.setAuthTag(tag);
  const out = fs.createWriteStream(destPath);
  await pipeline(
    fs.createReadStream(srcPath, { start: bodyStart, end: bodyStart + cipherBytes - 1 }),
    decipher,
    out,
  );
}

/**
 * Giải mã file backup (streaming). Trả về true nếu file là backup đã mã hóa
 * (có magic header V1 hoặc V2), false nếu là file thường chưa mã hóa (backward-compat).
 * @returns {Promise<boolean>} isEncrypted
 */
async function decryptFile(srcPath, destPath) {
  const inStream = fs.createReadStream(srcPath);
  const header = await new Promise((resolve, reject) => {
    const chunks = [];
    inStream.on("readable", function read() {
      let chunk;
      while ((chunk = this.read(FILE_MAGIC_V2.length)) !== null) chunks.push(chunk);
    });
    inStream.on("end", () => resolve(Buffer.concat(chunks)));
    inStream.on("error", reject);
  });
  inStream.destroy();
  if (header.length < FILE_MAGIC.length) return false;
  if (header.subarray(0, FILE_MAGIC.length).equals(FILE_MAGIC)) {
    await _decryptLegacy(srcPath, destPath);
    return true;
  }
  if (header.subarray(0, FILE_MAGIC_V2.length).equals(FILE_MAGIC_V2)) {
    await _decryptEnvelope(srcPath, destPath);
    return true;
  }
  return false;
}

module.exports = { encrypt, decrypt, encryptFile, decryptFile };
