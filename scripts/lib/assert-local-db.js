/**
 * scripts/lib/assert-local-db.js — Chốt chặn an toàn cho script tự tạo dữ liệu
 *
 * CÁC SCRIPT `check:tenant` TẠO TENANT THẬT TRONG DB RỒI XOÁ. Chạy nhầm lên
 * DB thật (staging/production) là mất dữ liệu. Script này chặn trước khi chạy.
 *
 * Chặn khi:
 *   1. `NODE_ENV=production`
 *   2. `ALLOW_REMOTE_DB_CHECKS` không được đặt mà DATABASE_URL không trỏ localhost
 *   3. Không đọc được DATABASE_URL
 *
 * Dùng:
 *   const assertLocalDb = require("./lib/assert-local-db");
 *   assertLocalDb("check-tenant-isolation");
 */

const LOCAL_HOSTNAMES = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "[::1]",
  "0.0.0.0",
]);

/** Host đọc được từ DATABASE_URL; null nếu không parse được. */
const parseHost = (url) => {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
};

const assertLocalDb = (scriptName) => {
  if (process.env.NODE_ENV === "production") {
    console.error(
      `[${scriptName}] TU CHOI CHAY: NODE_ENV=production.\n` +
      `Script nay tao va xoa du lieu that trong DB.`,
    );
    process.exit(1);
  }

  const url = process.env.DATABASE_URL || "";
  if (!url) {
    console.error(`[${scriptName}] TU CHOI CHAY: khong co DATABASE_URL.`);
    process.exit(1);
  }

  const host = parseHost(url);
  if (!host) {
    console.error(`[${scriptName}] TU CHOI CHAY: khong parse duoc DATABASE_URL.`);
    process.exit(1);
  }

  const isLocal = LOCAL_HOSTNAMES.has(host) || host.endsWith(".local");
  if (!isLocal && process.env.ALLOW_REMOTE_DB_CHECKS !== "1") {
    console.error(
      `[${scriptName}] TU CHOI CHAY: DATABASE_URL tro toi host "${host}" — khong phai may cuc bo.\n` +
      `Script nay tao tenant/user/... that roi xoa. Neu day la DB dung de kiem chung\n` +
      `co chu dich, dat ALLOW_REMOTE_DB_CHECKS=1 de chay co y thuc.`,
    );
    process.exit(1);
  }

  // Không bao giờ in mật khẩu trong DATABASE_URL.
  return `${host}${url.includes("@") ? " (da che thong tin dang nhap)" : ""}`;
};

module.exports = { assertLocalDb, parseHost, LOCAL_HOSTNAMES };