/**
 * modules/push/push.service.js — Web Push notification (PWA)
 *
 * Tổng quan:
 * - VAPID keys: DB (IntegrationConfig, private mã hóa AES) > .env > tự sinh + lưu DB.
 *   Chủ shop không cần cấu hình gì — key ổn định qua restart
 * - Subscription lưu trong Redis `push:sub:{userId}` (JSON array, tối đa 5 thiết bị,
 *   TTL 90 ngày) — device session data, không cần migration.
 *   Không có Redis → fallback in-memory Map (mất subscription khi restart)
 * - sendToUser / sendToRole: gửi push, tự dọn subscription hết hạn (404/410)
 *
 * Hàm:
 * - getPublicKey(): Trả VAPID public key cho frontend subscribe
 * - subscribe(userId, subscription): Lưu/upsert subscription theo endpoint
 * - unsubscribe(userId, endpoint): Xóa subscription
 * - sendToUser(userId, payload): Gửi push đến tất cả thiết bị của user
 * - sendToRole(role, payload): Gửi push đến user có role
 * - sendTest(userId, title, message): Gửi thử tới chính user
 */
const webpush = require('web-push');
const { redis } = require('../../config/redis');
const prisma = require('../../config/prisma');
const logger = require('../../utils/logger');
const configService = require('../integrations/integration-config.service');

const PUSH_KEY = (userId) => `push:sub:${userId}`;
const SUB_TTL = 90 * 24 * 3600;
const MAX_SUBS = 5;
const SUBJECT = process.env.VAPID_SUBJECT || 'mailto:support@aduu-erp.com';

let vapidReady = false;
let vapidPublicKey = null;
let memFallbackWarned = false;

// VAPID keys: DB (IntegrationConfig, private mã hóa) > .env > tự sinh + lưu DB.
// Chủ shop không cần biết .env — key ổn định qua restart.
async function ensureVapid() {
  if (vapidReady) return true;
  try {
    const cfg = await configService.getMany(['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY']);
    const pub = process.env.VAPID_PUBLIC_KEY || cfg.VAPID_PUBLIC_KEY;
    const priv = process.env.VAPID_PRIVATE_KEY || cfg.VAPID_PRIVATE_KEY;
    if (pub && priv) {
      webpush.setVapidDetails(SUBJECT, pub, priv);
      vapidPublicKey = pub;
      vapidReady = true;
      return true;
    }
  } catch (e) {
    logger.error('[push] read VAPID config failed:', e.message);
  }
  try {
    const keys = webpush.generateVAPIDKeys();
    webpush.setVapidDetails(SUBJECT, keys.publicKey, keys.privateKey);
    vapidPublicKey = keys.publicKey;
    vapidReady = true;
    try {
      await configService.setMany({ VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey });
      logger.info('[push] VAPID keys tự sinh và lưu vào DB — ổn định qua restart');
    } catch (e) {
      logger.warn('[push] lưu VAPID keys vào DB thất bại (key sẽ đổi sau restart):', e.message);
    }
    return true;
  } catch (e) {
    logger.error('[push] cannot init VAPID:', e.message);
    return false;
  }
}

const getPublicKey = async () => {
  if (!vapidReady) await ensureVapid();
  return vapidPublicKey;
};

// Fallback in-memory khi không có Redis (giống Socket.IO adapter) — subscription mất khi restart server
const memSubs = new Map();

async function getSubs(userId) {
  if (!redis) return memSubs.get(userId) || [];
  try {
    const raw = await redis.get(PUSH_KEY(userId));
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    logger.warn('[push] read subs failed:', e.message);
    return [];
  }
}

async function setSubs(userId, subs) {
  if (!redis) {
    if (!memFallbackWarned) {
      memFallbackWarned = true;
      logger.warn('[push] REDIS_URL not set — subscriptions lưu in-memory, sẽ mất khi restart server');
    }
    memSubs.set(userId, subs);
    return;
  }
  try {
    await redis.set(PUSH_KEY(userId), JSON.stringify(subs), 'EX', SUB_TTL);
  } catch (e) {
    logger.warn('[push] save subs failed:', e.message);
  }
}

const subscribe = async (userId, subscription) => {
  if (!(await ensureVapid())) throw { status: 500, message: 'Push chưa được cấu hình (thiếu VAPID keys)' };
  const { endpoint, keys } = subscription || {};
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    throw { status: 400, message: 'Subscription không hợp lệ' };
  }

  const subs = await getSubs(userId);
  const next = subs
    .filter((s) => s.endpoint !== endpoint)
    .concat([{ endpoint, keys, userAgent: subscription.userAgent || null, createdAt: new Date().toISOString() }]);
  await setSubs(userId, next.slice(0, MAX_SUBS));
  logger.info(`[push] subscribed user=${userId} total=${Math.min(next.length, MAX_SUBS)}`);
  return { ok: true, count: Math.min(next.length, MAX_SUBS) };
};

const unsubscribe = async (userId, endpoint) => {
  const subs = await getSubs(userId);
  const next = subs.filter((s) => s.endpoint !== endpoint);
  await setSubs(userId, next);
  return { ok: true, count: next.length };
};

const sendToUser = async (userId, payload) => {
  if (!(await ensureVapid())) return { sent: 0, failed: 0 };
  const subs = await getSubs(userId);
  if (!subs.length) return { sent: 0, failed: 0 };

  const body = JSON.stringify({
    title: payload.title || 'Aduu ERP',
    message: payload.message || '',
    link: payload.link || '/',
    severity: payload.severity || 'INFO',
  });

  let sent = 0;
  let failed = 0;
  const results = await Promise.allSettled(
    subs.map((sub) => webpush.sendNotification(sub, body)),
  );
  const stale = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      sent += 1;
    } else {
      failed += 1;
      const code = r.reason?.statusCode;
      if (code === 404 || code === 410) stale.push(subs[i].endpoint);
      else logger.warn(`[push] send failed (${code || 'unknown'}):`, r.reason?.message || r.reason);
    }
  });
  if (stale.length) {
    const kept = subs.filter((s) => !stale.includes(s.endpoint));
    await setSubs(userId, kept);
  }
  return { sent, failed };
};

const sendToRole = async (role, payload, tenantId = null) => {
  const users = await prisma.user.findMany({
    where: { role, isActive: true, ...(tenantId ? { tenantId } : {}) },
    select: { id: true },
    take: 100,
  });
  let totalSent = 0;
  let totalFailed = 0;
  for (const u of users) {
    const r = await sendToUser(u.id, payload);
    totalSent += r.sent;
    totalFailed += r.failed;
  }
  return { sent: totalSent, failed: totalFailed, users: users.length };
};

const sendTest = async (userId) => {
  const r = await sendToUser(userId, {
    title: 'Thông báo đã bật ✅',
    message: 'Bạn sẽ nhận được cảnh báo tồn kho, đơn hàng và nhắc việc ngay cả khi đóng ứng dụng.',
    link: '/notifications',
    severity: 'INFO',
  });
  return r;
};

module.exports = { getPublicKey, subscribe, unsubscribe, sendToUser, sendToRole, sendTest };
