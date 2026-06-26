/**
 * realtime/socket.js — WebSocket real-time với Socket.IO
 * 
 * Tổng quan:
 * - Khởi tạo Socket.IO server gắn với HTTP server
 * - Dùng Redis adapter để scale ngang (fallback in-memory nếu không có Redis)
 * - Xác thực qua JWT trong handshake.auth.token hoặc query.token
 * - Mỗi user tự động join room user:{userId} và role:{role}
 * - emitToUser / emitToRole gửi thông báo theo kênh
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
      console.log("[socket] redis adapter attached");
    } catch (e) {
      console.error("[socket] redis adapter failed, falling back to in-memory:", e.message);
    }
  } else {
    console.log("[socket] running in-memory (no Redis)");
  }

  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.query?.token;
      if (!token) return next(new Error("Unauthorized"));
      const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ["HS256"] });
      socket.userId = decoded.id;
      socket.role = decoded.role;
      return next();
    } catch (e) {
      return next(new Error("Unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    if (socket.userId) socket.join(`user:${socket.userId}`);
    if (socket.role) socket.join(`role:${socket.role}`);
  });

  return io;
};

const getIo = () => io;

const emitToUser = (userId, event, payload) => {
  io?.to(`user:${userId}`).emit(event, payload);
};

const emitToRole = (role, event, payload) => {
  io?.to(`role:${role}`).emit(event, payload);
};

module.exports = { initSocket, getIo, emitToUser, emitToRole };
