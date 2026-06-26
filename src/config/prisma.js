/**
 * config/prisma.js — Khởi tạo Prisma Client kết nối PostgreSQL
 * 
 * Tổng quan:
 * - Dùng @prisma/adapter-pg để kết nối trực tiếp qua pg.Pool (không qua Prisma Engine)
 * - Parse DATABASE_URL để lấy host, port, database, user, password
 * - Pool config: max 20 connections, idle timeout 30s, connection timeout 10s
 * - Singleton: toàn app dùng chung 1 instance prisma
 */

const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { Pool } = require("pg");

const url = new URL(process.env.DATABASE_URL);
const pool = new Pool({
  host: url.hostname,
  port: parseInt(url.port || "5432"),
  database: url.pathname.slice(1).split("?")[0],
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  max: Number(process.env.DB_POOL_MAX) || 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

module.exports = prisma;
