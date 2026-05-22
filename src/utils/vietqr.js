// src/utils/vietqr.js
// Tạo VietQR string theo chuẩn NAPAS/EMVCo.
// Spec: https://vietqr.io/portal-service/download
// QR string = EMVCo format với merchant account info chuẩn VN

/**
 * Tính CRC16-CCITT cho EMVCo QR string.
 */
const crc16 = (str) => {
  let crc = 0xFFFF;
  for (const ch of str) {
    crc ^= ch.charCodeAt(0) << 8;
    for (let i = 0; i < 8; i++) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
    }
    crc &= 0xFFFF;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
};

/**
 * Tạo EMVCo TLV: ID + length(2) + value.
 */
const tlv = (id, value) => {
  const s = String(value || "");
  return `${id}${String(s.length).padStart(2, "0")}${s}`;
};

/**
 * Sinh VietQR string (EMVCo) cho chuyển khoản ngân hàng.
 *
 * @param {Object} p
 * @param {string} p.bankBin       - BIN ngân hàng (6 số, e.g. "970436" = VPBank, "970415" = VietinBank...)
 * @param {string} p.accountNumber - Số tài khoản
 * @param {number} [p.amount]      - Số tiền (optional)
 * @param {string} [p.description] - Nội dung chuyển khoản (max 25 ký tự khuyến nghị)
 * @param {string} [p.accountName] - Tên chủ TK (optional, in QR)
 * @returns {string} QR string ready for qrcode lib
 */
const buildVietQRString = ({ bankBin, accountNumber, amount, description, accountName }) => {
  // 00: Payload format indicator
  // 01: Point of initiation method (11=static, 12=dynamic)
  const pointOfInit = amount ? "12" : "11";

  // 38: Merchant account info - NAPAS VietQR
  const merchantGuid = "A000000727";
  const merchantAccount = [
    tlv("00", merchantGuid),      // AID
    tlv("01", bankBin),           // Bank BIN
    tlv("02", accountNumber),     // Account number
  ].join("");

  // 54: Transaction amount
  // 58: Country code
  // 59: Merchant name
  // 60: Merchant city
  // 62: Additional data (ref / description)
  const addData = description ? tlv("08", String(description).slice(0, 25)) : "";

  const payload = [
    tlv("00", "01"),                           // Payload Format Indicator
    tlv("01", pointOfInit),                    // Point of Initiation
    tlv("38", merchantAccount),                // Merchant Account Info
    tlv("52", "0000"),                         // MCC
    tlv("53", "704"),                          // Transaction Currency (VND=704)
    amount ? tlv("54", String(Math.round(amount))) : "", // Transaction Amount
    tlv("58", "VN"),                           // Country Code
    tlv("59", accountName ? accountName.slice(0, 25) : "NGUOI BAN HANG"), // Merchant Name
    tlv("60", "VIETNAM"),                      // Merchant City
    addData ? tlv("62", addData) : "",         // Additional Data
    "6304",                                    // CRC placeholder
  ].join("");

  return payload + crc16(payload);
};

/**
 * Tạo VietQR PNG base64 bằng qrcode package.
 * Nếu qrcode chưa cài → trả về null (non-blocking).
 */
const generateVietQRBase64 = async (params) => {
  try {
    const QRCode = require("qrcode");
    const str = buildVietQRString(params);
    return await QRCode.toDataURL(str, { errorCorrectionLevel: "M", width: 300 });
  } catch (_) {
    return null; // qrcode not installed or params invalid
  }
};

/**
 * VietQR bank BINs thường gặp.
 */
const BANK_BINS = {
  VCB:    "970436",
  TCB:    "970407",
  MB:     "970422",
  BIDV:   "970418",
  ACB:    "970416",
  VIB:    "970441",
  VPB:    "970432",
  TECH:   "970407",
  AGRI:   "970405",
  VIET:   "970423",
};

module.exports = { buildVietQRString, generateVietQRBase64, crc16, BANK_BINS };
