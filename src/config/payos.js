/**
 * config/payos.js — Tích hợp cổng thanh toán PayOS
 * 
 * Tổng quan:
 * - Lazy singleton: khởi tạo PayOS client khi cần (nếu đủ PAYOS_CLIENT_ID, PAYOS_API_KEY, PAYOS_CHECKSUM_KEY)
 * - Nếu thiếu config → các hàm throw lỗi 503 "Cổng thanh toán chưa được cấu hình"
 * 
 * Hàm:
 * - getPayOS(): Trả về PayOS instance (hoặc null nếu chưa config)
 * - createPaymentLink({ orderCode, amount, description, returnUrl, cancelUrl }): Tạo link thanh toán PayOS
 * - verifyWebhook(webhookBody): Xác thực webhook từ PayOS
 */

const PayOS = require("@payos/node");

let payos = null;

const getPayOS = () => {
  const clientId = process.env.PAYOS_CLIENT_ID;
  const apiKey = process.env.PAYOS_API_KEY;
  const checksumKey = process.env.PAYOS_CHECKSUM_KEY;

  if (!clientId || !apiKey || !checksumKey) {
    return null;
  }

  if (!payos) {
    payos = new PayOS(clientId, apiKey, checksumKey);
  }
  return payos;
};

const createPaymentLink = async ({ orderCode, amount, description, returnUrl, cancelUrl }) => {
  const client = getPayOS();
  if (!client) {
    throw { status: 503, message: "Cổng thanh toán chưa được cấu hình" };
  }

  const paymentLink = await client.createPaymentLink({
    orderCode,
    amount,
    description: description.slice(0, 25),
    returnUrl,
    cancelUrl,
  });

  return paymentLink;
};

const verifyWebhook = (webhookBody) => {
  const client = getPayOS();
  if (!client) {
    throw { status: 503, message: "Cổng thanh toán chưa được cấu hình" };
  }
  return client.verifyPaymentWebhook(webhookBody);
};

module.exports = { getPayOS, createPaymentLink, verifyWebhook };
