// src/modules/einvoice/provider/vnpt.adapter.js
// VNPT eInvoice REST adapter.
// Khi VNPT_USERNAME/VNPT_PASSWORD chưa cấu hình → sandbox/mock mode.
const https = require("https");
const http = require("http");

const BASE_URL = process.env.VNPT_EINVOICE_URL || "https://einvoiceapi.vnpt.vn";
const USERNAME = process.env.VNPT_USERNAME || "";
const PASSWORD = process.env.VNPT_PASSWORD || "";
const COM_CODE = process.env.VNPT_COM_CODE || "";
const TEMPLATE = process.env.VNPT_TEMPLATE_CODE || "1/001";
const SERIAL   = process.env.VNPT_SERIAL || "K24TVE";

const isMockMode = () => !USERNAME || !PASSWORD || !COM_CODE;

let _token = null;
let _tokenExpiry = 0;

async function _fetch(path, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const isHttps = url.protocol === "https:";
    const lib = isHttps ? https : http;
    const body = options.body ? JSON.stringify(options.body) : null;
    const headers = {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    };
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

async function _getToken() {
  if (_token && Date.now() < _tokenExpiry) return _token;
  const res = await _fetch("/auth/login", {
    method: "POST",
    body: { username: USERNAME, password: PASSWORD },
  });
  if (res.status !== 200 || !res.body.token) {
    throw { status: 502, message: `VNPT login failed: ${JSON.stringify(res.body)}` };
  }
  _token = res.body.token;
  _tokenExpiry = Date.now() + 50 * 60 * 1000; // 50 min
  return _token;
}

// Tạo số hóa đơn giả cho mock mode
let _mockSeq = 0;
function _mockInvoiceNo() {
  _mockSeq++;
  return String(_mockSeq).padStart(7, "0");
}

/**
 * Phát hành hóa đơn điện tử.
 * @param {Object} p
 * @param {string} p.buyerName
 * @param {string} [p.buyerTaxCode]
 * @param {string} [p.buyerAddress]
 * @param {string} [p.paymentMethod] "CK"|"TM"|"TMCK"
 * @param {Array}  p.items  [{name, unit, quantity, unitPrice, taxRate, taxAmount, total}]
 * @param {number} p.totalBeforeTax
 * @param {number} p.totalTax
 * @param {number} p.totalPayment
 */
async function issueInvoice(p) {
  if (isMockMode()) {
    const invoiceNo = _mockInvoiceNo();
    return {
      invoiceNo,
      cqtCode: `MOCK-CQT-${Date.now()}`,
      cqtStatus: "ACCEPTED",
      signedXml: null,
      pdfUrl: null,
      rawResponse: { mock: true, note: "VNPT credentials not configured — sandbox/mock mode" },
    };
  }

  const token = await _getToken();
  const payload = {
    com_code: COM_CODE,
    invoice_data: {
      template_code: TEMPLATE,
      serial: SERIAL,
      invoice_date: new Date().toISOString().slice(0, 10),
      buyer_name: p.buyerName,
      buyer_tax_code: p.buyerTaxCode || "",
      buyer_address: p.buyerAddress || "",
      payment_method: p.paymentMethod || "TM",
      products: p.items.map((it) => ({
        name: it.name,
        unit: it.unit || "cái",
        quantity: it.quantity,
        price: it.unitPrice,
        tax_rate: it.taxRate || 10,
        tax_amount: it.taxAmount || 0,
        total: it.total,
      })),
      total_before_tax: p.totalBeforeTax,
      total_tax: p.totalTax,
      total_payment: p.totalPayment,
    },
  };

  const res = await _fetch("/api/invoice/create", {
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

/**
 * Hủy hóa đơn.
 */
async function cancelInvoice({ invoiceNo, reason }) {
  if (isMockMode()) {
    return { invoiceNo, cqtStatus: "CANCELLED", rawResponse: { mock: true } };
  }
  const token = await _getToken();
  const res = await _fetch("/api/invoice/cancel", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: { com_code: COM_CODE, invoice_no: invoiceNo, cancel_reason: reason || "Hủy theo yêu cầu" },
  });
  if (res.status !== 200 || res.body.error_code !== 0) {
    throw { status: 502, message: `VNPT cancel failed: ${res.body.error_message}` };
  }
  return { invoiceNo, cqtStatus: "CANCELLED", rawResponse: res.body };
}

/**
 * Tra cứu trạng thái hóa đơn từ VNPT.
 */
async function getInvoiceStatus({ invoiceNo }) {
  if (isMockMode()) {
    return { invoiceNo, cqtStatus: "ACCEPTED", rawResponse: { mock: true } };
  }
  const token = await _getToken();
  const res = await _fetch(`/api/invoice/${invoiceNo}?com_code=${COM_CODE}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status !== 200) {
    throw { status: 502, message: `VNPT status failed: ${JSON.stringify(res.body)}` };
  }
  return { invoiceNo, cqtStatus: res.body.status, rawResponse: res.body };
}

module.exports = { issueInvoice, cancelInvoice, getInvoiceStatus, isMockMode, TEMPLATE, SERIAL };
