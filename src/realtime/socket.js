// src/realtime/socket.js
const { Server } = require("socket.io");
const { createAdapter } = require("@socket.io/redis-adapter");
const jwt = require("jsonwebtoken");
const { pubClient, subClient } = require("../config/redis");

let io;

const initSocket = async (httpServer) => {
  const origin = process.env.CORS_ORIGIN || process.env.CLIENT_URL || "http://localhost:5173";
  io = new Server(httpServer, {
    cors: { origin, credentials: true },
    transports: ["websocket", "polling"],
  });

  try {
    await Promise.all([
      pubClient.status === "ready" ? Promise.resolve() : new Promise((r) => pubClient.once("ready", r)),
      subClient.status === "ready" ? Promise.resolve() : new Promise((r) => subClient.once("ready", r)),
    ]);
    io.adapter(createAdapter(pubClient, subClient));
    console.log("[socket] redis adapter attached");
  } catch (e) {
    console.error("[socket] redis adapter failed, falling back to in-memory:", e.message);
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
