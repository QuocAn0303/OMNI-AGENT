/**
 * realtime/socket.js — WebSocket real-time với Socket.IO
 * 
 * Tổng quan:
 * - Khởi tạo Socket.IO server gắn với HTTP server
 * - Dùng Redis adapter để scale ngang (fallback in-memory nếu không có Redis)
 * - Xác thực qua JWT trong handshake.auth.token
 * - Mỗi user tự động join room user:{userId}, role:{role},
 *   tenant:{tenantId} và tenant:{tenantId}:role:{role}
 * - emitToUser / emitToRole gửi thông báo theo kênh
 * - emitToRole có tenantId → chỉ gửi trong tenant đó (chống cross-tenant leak)
 * 
 * Hàm:
 * - waitForRedisReady(client): Đợi Redis client ready (timeout 3s)
 * - initSocket(httpServer): Khởi tạo Socket.IO server
 *     - Gắn CORS, chọn transport (websocket > polling)
 *     - Gắn Redis adapter nếu có
 *     - Xác thực JWT → gán socket.userId + socket.role
 *     - Mỗi connection: join room user:{id} + role:{role}
 * - getIo(): Trả về Socket.IO server instance
 * - emitToUser(userId, event, payload): Gửi event đến 1 user
 * - emitToRole(role, event, payload): Gửi event đến tất cả user có role
 */

const { Server } = require("socket.io");
const { createAdapter } = require("@socket.io/redis-adapter");
const jwt = require("jsonwebtoken");
const { pubClient, subClient } = require("../config/redis");
const prisma = require("../config/prisma");
const logger = require('../utils/logger');

let io;
const REDIS_READY_TIMEOUT_MS = 3000;

const waitForRedisReady = (client) => {
  if (client.status === "ready") return Promise.resolve();

  return new Promise((resolve, reject) => {
    const onReady = () => {
      cleanup();
      resolve();
    };
    const onError = (err) => {
      cleanup();
      reject(err || new Error("Redis connection error"));
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Redis ready timeout"));
    }, REDIS_READY_TIMEOUT_MS);

    const cleanup = () => {
      clearTimeout(timeout);
      client.off("ready", onReady);
      client.off("error", onError);
    };

    client.once("ready", onReady);
    client.once("error", onError);
  });
};

const initSocket = async (httpServer) => {
  const origin = process.env.CORS_ORIGIN || process.env.CLIENT_URL || "http://localhost:5173";
  io = new Server(httpServer, {
    cors: { origin, credentials: true },
    transports: ["websocket", "polling"],
  });

  if (pubClient && subClient) {
    try {
      await Promise.all([
        waitForRedisReady(pubClient),
        waitForRedisReady(subClient),
      ]);
      io.adapter(createAdapter(pubClient, subClient));
      logger.info("[socket] redis adapter attached");
    } catch (e) {
      logger.error("[socket] redis adapter failed, falling back to in-memory:", e.message);
    }
  } else {
    logger.info("[socket] running in-memory (no Redis)");
  }

  io.use(async (socket, next) => {
    try {
      // L8: chỉ nhận token qua handshake.auth (client io(..., { auth: { token } }))
      // Bỏ query string — token lọt vào access log/proxy log khi nối socket
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error("Unauthorized"));
      const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ["HS256"] });

      // Refresh role/tenantId từ DB tại thời điểm kết nối (token có thể cũ 1h)
      let role = decoded.role;
      let tenantId = decoded.tenantId || null;
      if (decoded.supportSessionId) {
        const session = await prisma.supportAccessSession.findUnique({
          where: { id: decoded.supportSessionId },
          select: { status: true, expiresAt: true },
        });
        if (!session || session.status !== "ACTIVE" || new Date(session.expiresAt) < new Date()) {
          return next(new Error("Unauthorized"));
        }
      } else {
        const user = await prisma.user.findUnique({
          where: { id: decoded.id },
          select: { isActive: true, role: true, tenantId: true },
        });
        if (!user || !user.isActive) return next(new Error("Unauthorized"));
        role = user.role;
        tenantId = user.tenantId || null;
      }

      socket.userId = decoded.id;
      socket.role = role;
      socket.tenantId = tenantId;
      return next();
    } catch (e) {
      return next(new Error("Unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    if (socket.userId) socket.join(`user:${socket.userId}`);
    if (socket.role) socket.join(`role:${socket.role}`);
    // C1: room theo tenant — emitToRole(role, event, payload, tenantId) không
    // còn broadcast sang tenant khác
    if (socket.tenantId) {
      socket.join(`tenant:${socket.tenantId}`);
      if (socket.role) socket.join(`tenant:${socket.tenantId}:role:${socket.role}`);
    }
  });

  return io;
};

const getIo = () => io;

const emitToUser = (userId, event, payload) => {
  io?.to(`user:${userId}`).emit(event, payload);
};

const emitToRole = (role, event, payload, tenantId = null) => {
  // Bắt buộc tenantId — KHÔNG bao giờ fallback về room role toàn hệ thống
  // (trước đây emitToRole không có tenantId → broadcast cross-tenant)
  if (!tenantId) {
    logger.warn(`[socket] emitToRole skipped: thiếu tenantId (event=${event}, role=${role})`);
    return;
  }
  io?.to(`tenant:${tenantId}:role:${role}`).emit(event, payload);
};

module.exports = { initSocket, getIo, emitToUser, emitToRole };
