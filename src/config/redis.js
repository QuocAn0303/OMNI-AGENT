/**
 * config/redis.js — Kết nối Redis qua ioredis (cho Socket.IO adapter)
 * 
 * Tổng quan:
 * - Singleton: tạo main client, pub client, sub client từ REDIS_URL
 * - Retry strategy: tối đa 5 lần, exponential backoff (200ms → 2000ms)
 * - Nếu REDIS_URL không set → tất cả client = null, fallback in-memory
 * - Dùng cho Socket.IO Redis adapter để scale ngang nhiều instance
 */

const Redis = require("ioredis");
const logger = require('../utils/logger');

const url = process.env.REDIS_URL;

let redis = null;
let pubClient = null;
let subClient = null;

if (url) {
  const makeClient = (role) =>
    new Redis(url, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: false,
      retryStrategy: (times) => (times > 5 ? null : Math.min(times * 200, 2000)),
    }).on("error", (err) => {
      logger.error(`[redis:${role}]`, err.message);
    });

  redis = makeClient("main");
  pubClient = makeClient("pub");
  subClient = pubClient.duplicate();
} else {
  logger.info("[redis] REDIS_URL not set, running without Redis (in-memory mode)");
}

module.exports = { redis, pubClient, subClient };
