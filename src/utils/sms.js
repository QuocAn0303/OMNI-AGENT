// src/utils/sms.js — SMS gateway wrapper. Đọc cấu hình từ IntegrationConfig.
// Provider hỗ trợ: "ESMS", "TWILIO", "LOG" (mặc định — log ra console).
const config = require("../modules/integrations/integration-config.service");
const logger = require("./logger");

async function sendSms(phone, message) {
  const cfg = await config.getMany(["SMS_PROVIDER", "SMS_API_KEY", "SMS_API_SECRET", "SMS_BRAND_NAME"]);
  const provider = (cfg.SMS_PROVIDER || "LOG").toUpperCase();

  if (provider === "LOG" || !cfg.SMS_API_KEY) {
    logger.info(`[sms:LOG] -> ${phone}: ${message}`);
    return { provider: "LOG", success: true, mock: true };
  }

  if (provider === "ESMS") {
    const url = `https://rest.esms.vn/MainService.svc/json/SendMultipleMessage_V4_post_json/`;
    const body = {
      ApiKey: cfg.SMS_API_KEY,
      SecretKey: cfg.SMS_API_SECRET,
      Phone: phone,
      Content: message,
      Brandname: cfg.SMS_BRAND_NAME || "Aduu",
      SmsType: 2,
    };
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (data.CodeResult !== "100") throw { status: 502, message: `ESMS thất bại: ${data.ErrorMessage || JSON.stringify(data)}` };
    return { provider, success: true, raw: data };
  }

  if (provider === "TWILIO") {
    const sid = cfg.SMS_API_KEY;
    const token = cfg.SMS_API_SECRET;
    const from = cfg.SMS_BRAND_NAME;
    const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
    const auth = Buffer.from(`${sid}:${token}`).toString("base64");
    const params = new URLSearchParams({ To: phone, From: from, Body: message });
    const res = await fetch(url, { method: "POST", headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" }, body: params });
    if (!res.ok) throw { status: 502, message: `Twilio thất bại: ${await res.text()}` };
    return { provider, success: true };
  }

  throw { status: 400, message: `SMS_PROVIDER không hỗ trợ: ${provider}` };
}

module.exports = { sendSms };
