// src/utils/email.js
// Lazy-load nodemailer + tái sử dụng transporter
let cachedTransporter = null;

const getTransporter = () => {
  if (cachedTransporter) return cachedTransporter;
  const nodemailer = require("nodemailer");
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER) {
    throw new Error("Thiếu cấu hình SMTP (SMTP_HOST, SMTP_USER, SMTP_PASS)");
  }
  cachedTransporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
  return cachedTransporter;
};

const sendEmail = async ({ to, subject, text, html }) => {
  if (!to) throw new Error("Thiếu địa chỉ email người nhận");
  const transporter = getTransporter();
  const info = await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to,
    subject: subject || "(Không tiêu đề)",
    text: text || undefined,
    html: html || undefined,
  });
  return { messageId: info.messageId };
};

module.exports = { sendEmail, getTransporter };
