const zaloConfig = require("../modules/integrations/integration-config.service");

const ZALO_API = {
  CS: "https://openapi.zalo.me/v3.0/oa/message/cs",
  ZNS: "https://business.openapi.zalo.me/message/template",
  QUOTA: "https://openapi.zalo.me/v3.0/oa/quota/message",
  PROFILE: "https://openapi.zalo.me/v3.0/oa/getprofile",
  WEBHOOK: "https://openapi.zalo.me/v3.0/oa/webhook",
};

let _token = null;
let _tokenExpiry = 0;

const getToken = async () => {
  if (_token && Date.now() < _tokenExpiry) return _token;

  const token = process.env.ZALO_OA_ACCESS_TOKEN || process.env.ZALO_ACCESS_TOKEN;
  if (token) {
    _token = token;
    _tokenExpiry = Date.now() + 3600000;
    return token;
  }

  try {
    const cfg = await zaloConfig.getMany(["ZALO_OA_ACCESS_TOKEN"]);
    if (cfg.ZALO_OA_ACCESS_TOKEN) {
      _token = cfg.ZALO_OA_ACCESS_TOKEN;
      _tokenExpiry = Date.now() + 3600000;
      return _token;
    }
  } catch (e) {}

  return null;
};

const apiCall = async (url, body, method = "POST") => {
  const token = await getToken();
  if (!token) return { ok: false, error: "Thieu ZALO_OA_ACCESS_TOKEN" };

  try {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json", access_token: token },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.error) {
      return { ok: false, error: json.message || json.error_name || `HTTP ${res.status}` };
    }
    return { ok: true, data: json.data || json };
  } catch (e) {
    return { ok: false, error: e.message };
  }
};

// Send text message via CS API (within 24h window)
const sendZaloMessage = async ({ userId, text }) => {
  if (!userId) return { ok: false, error: "Thieu userId" };
  return apiCall(ZALO_API.CS, { recipient: { user_id: userId }, message: { text } });
};

// Send ZNS template message (outside 24h window, requires approval)
const sendZnsMessage = async ({ phone, templateId, templateData = {} }) => {
  if (!phone) return { ok: false, error: "Thieu so dien thoai" };
  return apiCall(ZALO_API.ZNS, { phone, template_id: templateId, template_data: templateData });
};

// Send to multiple users
const sendBulkMessages = async (recipients, text) => {
  const results = [];
  for (const recipient of recipients) {
    const userId = recipient.userId || recipient;
    const r = await sendZaloMessage({ userId, text: typeof text === "function" ? text(recipient) : text });
    results.push({ userId, ...r });
    await new Promise((r) => setTimeout(r, 200)); // rate limit
  }
  return results;
};

// Get user profile
const getUserProfile = async (userId) => {
  return apiCall(`${ZALO_API.PROFILE}?data={"user_id":"${userId}"}`, {}, "GET");
};

// Check quota
const getQuota = async () => {
  return apiCall(ZALO_API.QUOTA, {}, "GET");
};

// ─── BUSINESS NOTIFICATIONS ───

const sendDebtReminder = async (customer) => {
  const phone = customer.phone || "";
  if (!phone) return { ok: false, error: "Khong co SDT" };

  const text = `Kinh gui ${customer.name},\nBan con khoan no ${Number(customer.debtAmount || 0).toLocaleString("vi-VN")} VND den han ngay ${new Date(customer.dueDate).toLocaleDateString("vi-VN")}.\nVui long thanh toan de tranh phat sinh lai.\nTran trong, Aduu ERP`;
  return sendZaloMessage({ userId: phone, text });
};

const sendOrderStatusUpdate = async (customerName, phone, orderCode, status) => {
  if (!phone) return { ok: false, error: "Khong co SDT" };

  const statusText = { CONFIRMED: "da xác nhận", SHIPPING: "dang giao hang", COMPLETED: "da hoan thanh", CANCELLED: "da bi huy" };

  const text = `Kinh gui ${customerName},\nDon hang ${orderCode} cua ban ${statusText[status] || "da cập nhật trang thai"}.\nCam on ban da mua hang tai Aduu ERP!`;
  return sendZaloMessage({ userId: phone, text });
};

const sendPayrollNotification = async (employeeName, phone, month, year, finalSalary) => {
  if (!phone) return { ok: false, error: "Khong co SDT" };

  const text = `Kinh gui ${employeeName},\nLuong thang ${month}/${year} cua ban: ${Number(finalSalary).toLocaleString("vi-VN")} VND.\nVui long kiem tra phieu luong tren hệ thống.\nTran trong, Aduu ERP`;
  return sendZaloMessage({ userId: phone, text });
};

const sendPaymentConfirmation = async (customerName, phone, amount) => {
  if (!phone) return { ok: false, error: "Khong co SDT" };

  const text = `Kinh gui ${customerName},\nAduu ERP da nhan duoc khoan thanh toan ${Number(amount).toLocaleString("vi-VN")} VND.\nCam on ban da thanh toan dung han!`;
  return sendZaloMessage({ userId: phone, text });
};

module.exports = {
  sendZaloMessage, sendZnsMessage, sendBulkMessages,
  getUserProfile, getQuota,
  sendDebtReminder, sendOrderStatusUpdate,
  sendPayrollNotification, sendPaymentConfirmation,
};
