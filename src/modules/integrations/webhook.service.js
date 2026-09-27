const prisma = require('../../config/prisma');
const crypto = require('crypto');
const https = require('https');
const http = require('http');
const logger = require('../../utils/logger');
const { decrypt } = require('../../utils/crypto');

const MAX_ATTEMPTS = 3;

const signPayload = (payload, secret) => {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(JSON.stringify(payload));
  return hmac.digest('hex');
};

const deliver = (url, payload, signature) => {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const parsed = new URL(url);
    const client = parsed.protocol === 'https:' ? https : http;
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': signature,
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 10000,
    };
    const req = client.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });
};

const emitEvent = async (event, payload, tenantId) => {
  try {
    const endpoints = await prisma.webhookEndpoint.findMany({
      where: { tenantId, isActive: true, events: { has: event } },
    });
    for (const ep of endpoints) {
      const plainSecret = decrypt(ep.secret, ep.secretIv) || ep.secret;
      const signature = signPayload(payload, plainSecret);
      const delivery = await prisma.webhookDelivery.create({
        data: { endpointId: ep.id, event, payload },
      });
      try {
        const res = await deliver(ep.url, payload, signature);
        await prisma.webhookDelivery.update({
          where: { id: delivery.id },
          data: { status: 'DELIVERED', lastResponse: `${res.statusCode}: ${res.body.slice(0, 200)}`, lastAttemptAt: new Date(), attemptCount: 1 },
        });
      } catch (err) {
        logger.error(`[webhook] delivery failed: ${ep.url}`, err.message);
        await prisma.webhookDelivery.update({
          where: { id: delivery.id },
          data: { status: 'FAILED', lastResponse: err.message, lastAttemptAt: new Date(), attemptCount: 1 },
        });
      }
    }
  } catch (err) {
    logger.error('[webhook] emitEvent error:', err.message);
  }
};

const retryFailed = async () => {
  const failed = await prisma.webhookDelivery.findMany({
    where: { status: 'FAILED', attemptCount: { lt: MAX_ATTEMPTS } },
    include: { endpoint: true },
  });
  for (const d of failed) {
    if (!d.endpoint?.isActive) continue;
    const plainSecret = decrypt(d.endpoint.secret, d.endpoint.secretIv) || d.endpoint.secret;
    const signature = signPayload(d.payload, plainSecret);
    try {
      const res = await deliver(d.endpoint.url, d.payload, signature);
      await prisma.webhookDelivery.update({
        where: { id: d.id },
        data: { status: 'DELIVERED', lastResponse: `${res.statusCode}: ${res.body.slice(0, 200)}`, lastAttemptAt: new Date(), attemptCount: { increment: 1 } },
      });
    } catch (err) {
      await prisma.webhookDelivery.update({
        where: { id: d.id },
        data: { lastResponse: err.message, lastAttemptAt: new Date(), attemptCount: { increment: 1 } },
      });
    }
  }
};

module.exports = { emitEvent, retryFailed };
