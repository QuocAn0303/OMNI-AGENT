// src/modules/einvoice/provider/vnpt.adapter.js
// VNPT eInvoice REST adapter. Đọc cấu hình từ IntegrationConfig (DB) → fallback .env.
// Khi credentials chưa cấu hình → mock mode.
const https = require("https");
const http = require("http");
const config = require("../../integrations/integration-config.service");

const _readCfg = async () => {
  const cfg = await config.getMany([
    "VNPT_EINVOICE_URL", "VNPT_USERNAME", "VNPT_PASSWORD",
    "VNPT_COM_CODE", "VNPT_TEMPLATE_CODE", "VNPT_SERIAL",
  ]);
  return {
    BASE_URL: cfg.VNPT_EINVOICE_URL || "https://einvoiceapi.vnpt.vn",
    USERNAME: cfg.VNPT_USERNAME || "",
    PASSWORD: cfg.VNPT_PASSWORD || "",
    COM_CODE: cfg.VNPT_COM_CODE || "",
    TEMPLATE: cfg.VNPT_TEMPLATE_CODE || "1/001",
    SERIAL:   cfg.VNPT_SERIAL || "K24TVE",
  };
};

const isMockMode = async () => {
  const c = await _readCfg();
  return !c.USERNAME || !c.PASSWORD || !c.COM_CODE;
};

let _token = null;
let _tokenExpiry = 0;
let _tokenKey = null;

async function _fetch(baseUrl, path, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const isHttps = url.protocol === "https:";
    const lib = isHttps ? https : http;
    const body = options.body ? JSON.stringify(options.body) : null;
    const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
    if (body) headers["Content-Length"] = Buffer.byteLength(body);
    const req = lib.request(
      { hostname: url.hostname, port: url.port || (isHttps ? 443 : 80), path: url.pathname + url.search, method: options.method || "GET", headers },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
          catch (_) { resolve({ status: res.statusCode, body: data }); }
        });
      },
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function _getToken(c) {
  const key = `${c.BASE_URL}|${c.USERNAME}`;
  if (_token && _tokenKey === key && Date.now() < _tokenExpiry) return _token;
  const res = await _fetch(c.BASE_URL, "/auth/login", {
    method: "POST",
    body: { username: c.USERNAME, password: c.PASSWORD },
  });
  if (res.status !== 200 || !res.body.token) {
    throw { status: 502, message: `VNPT login failed: ${JSON.stringify(res.body)}` };
  }
  _token = res.body.token;
  _tokenKey = key;
  _tokenExpiry = Date.now() + 50 * 60 * 1000;
  return _token;
}

let _mockSeq = 0;
const _mockInvoiceNo = () => String(++_mockSeq).padStart(7, "0");

async function issueInvoice(p) {
  const c = await _readCfg();
  if (!c.USERNAME || !c.PASSWORD || !c.COM_CODE) {
    return {
      invoiceNo: _mockInvoiceNo(),
      cqtCode: `MOCK-CQT-${Date.now()}`,
      cqtStatus: "ACCEPTED",
      signedXml: null,
      pdfUrl: null,
      rawResponse: { mock: true, note: "VNPT credentials not configured — sandbox/mock mode" },
    };
  }

  const token = await _getToken(c);
  const payload = {
    com_code: c.COM_CODE,
    invoice_data: {
      template_code: c.TEMPLATE,
      serial: c.SERIAL,
      invoice_date: new Date().toISOString().slice(0, 10),
      buyer_name: p.buyerName,
      buyer_tax_code: p.buyerTaxCode || "",
      buyer_address: p.buyerAddress || "",
      payment_method: p.paymentMethod || "TM",
      products: p.items.map((it) => ({
        name: it.name, unit: it.unit || "cái", quantity: it.quantity,
        price: it.unitPrice, tax_rate: it.taxRate || 10,
        tax_amount: it.taxAmount || 0, total: it.total,
      })),
      total_before_tax: p.totalBeforeTax,
      total_tax: p.totalTax,
      total_payment: p.totalPayment,
    },
  };

  const res = await _fetch(c.BASE_URL, "/api/invoice/create", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: payload,
  });

  if (res.status !== 200 || res.body.error_code !== 0) {
    throw { status: 502, message: `VNPT issue failed: ${res.body.error_message || JSON.stringify(res.body)}` };
  }

  return {
    invoiceNo: res.body.invoice_no,
    cqtCode: res.body.cqt_code,
    cqtStatus: "ACCEPTED",
    signedXml: res.body.signed_xml || null,
    pdfUrl: res.body.pdf_url || null,
    rawResponse: res.body,
  };
}

async function cancelInvoice({ invoiceNo, reason }) {
  const c = await _readCfg();
  if (!c.USERNAME || !c.PASSWORD || !c.COM_CODE) {
    return { invoiceNo, cqtStatus: "CANCELLED", rawResponse: { mock: true } };
  }
  const token = await _getToken(c);
  const res = await _fetch(c.BASE_URL, "/api/invoice/cancel", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: { com_code: c.COM_CODE, invoice_no: invoiceNo, cancel_reason: reason || "Hủy theo yêu cầu" },
  });
  if (res.status !== 200 || res.body.error_code !== 0) {
    throw { status: 502, message: `VNPT cancel failed: ${res.body.error_message}` };
  }
  return { invoiceNo, cqtStatus: "CANCELLED", rawResponse: res.body };
}

async function getInvoiceStatus({ invoiceNo }) {
  const c = await _readCfg();
  if (!c.USERNAME || !c.PASSWORD || !c.COM_CODE) {
    return { invoiceNo, cqtStatus: "ACCEPTED", rawResponse: { mock: true } };
  }
  const token = await _getToken(c);
  const res = await _fetch(c.BASE_URL, `/api/invoice/${invoiceNo}?com_code=${c.COM_CODE}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status !== 200) {
    throw { status: 502, message: `VNPT status failed: ${JSON.stringify(res.body)}` };
  }
  return { invoiceNo, cqtStatus: res.body.status, rawResponse: res.body };
}

async function testConnection() {
  const c = await _readCfg();
  if (!c.USERNAME || !c.PASSWORD || !c.COM_CODE) {
    return { success: true, mock: true, message: "Mock mode — chưa cấu hình credentials." };
  }
  _token = null;
  await _getToken(c);
  return { success: true, mock: false, message: "Kết nối VNPT thành công." };
}

module.exports = { issueInvoice, cancelInvoice, getInvoiceStatus, isMockMode, testConnection };
