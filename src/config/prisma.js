const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { Pool } = require("pg");

// 1. Tạo connection pool kết nối tới PostgreSQL bằng URL trong .env
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.DB_POOL_MAX) || 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

// 2. Tạo Prisma Adapter từ pool vừa khởi tạo
const adapter = new PrismaPg(pool);

// 3. Khởi tạo PrismaClient với adapter bắt buộc
const prisma = new PrismaClient({ adapter });

module.exports = prisma;
