// src/utils/email.js — SMTP wrapper, đọc cấu hình từ IntegrationConfig (fallback .env).
const config = require("../modules/integrations/integration-config.service");
const logger = require("./logger");

let _transporter = null;
let _transporterKey = null;

const _getCfg = () => config.getMany(["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "SMTP_FROM", "SMTP_SECURE"]);

const _getTransporter = async () => {
  const cfg = await _getCfg();
  if (!cfg.SMTP_HOST || !cfg.SMTP_USER) return null;
  const key = JSON.stringify(cfg);
  if (_transporter && _transporterKey === key) return _transporter;
  const nodemailer = require("nodemailer");
  _transporter = nodemailer.createTransport({
    host: cfg.SMTP_HOST,
    port: Number(cfg.SMTP_PORT || 587),
    secure: String(cfg.SMTP_SECURE || "").toLowerCase() === "true",
    auth: { user: cfg.SMTP_USER, pass: cfg.SMTP_PASS },
  });
  _transporterKey = key;
  return _transporter;
};

const sendEmail = async ({ to, subject, text, html }) => {
  if (!to) throw new Error("Thiếu địa chỉ email người nhận");
  const transporter = await _getTransporter();
  const cfg = await _getCfg();
  const from = cfg.SMTP_FROM || cfg.SMTP_USER || "no-reply@aduu.local";

  if (!transporter) {
    logger.info(`[email:LOG] -> ${to} | ${subject}\n${text || html || ""}`);
    return { messageId: null, mock: true };
  }
  const info = await transporter.sendMail({ from, to, subject: subject || "(Không tiêu đề)", text, html });
  return { messageId: info.messageId };
};

const verifyEmail = async () => {
  const transporter = await _getTransporter();
  if (!transporter) throw { status: 400, message: "SMTP chưa được cấu hình (cần SMTP_HOST và SMTP_USER)" };
  await transporter.verify();
  return { success: true };
};

const resetTransporter = () => { _transporter = null; _transporterKey = null; };

module.exports = { sendEmail, verifyEmail, resetTransporter, getTransporter: _getTransporter };
