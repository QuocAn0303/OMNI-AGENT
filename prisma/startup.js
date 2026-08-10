/**
 * prisma/startup.js — Unified startup (migrate deploy + seed tùy chọn + start server)
 *
 * Chạy duy nhất 1 tiến trình Node để log gọn theo thứ tự và phản hồi lỗi rõ ràng:
 *   1. Dọn migration "stuck" (finished_at IS NULL, rolled_back_at IS NULL) trong _prisma_migrations
 *      — phục hồi DB rơi giữa chừng khi deploy (migration thật chưa bao giờ được chạy, chỉ là row treo)
 *   2. npx prisma migrate deploy
 *   3. Seed CHỈ khi SEED_ON_START=1 (KHÔNG auto-seed — seed.js có TRUNCATE CASCADE, sẽ xóa data)
 *   4. require('../src/app.js') — khởi động Express + Socket.IO + cron + CDC
 *
 * Cấm chạy `migrate dev` trên DB có bảng RAG (ai_documents/ai_embeddings) — luôn sinh
 * ALTER COLUMN embedding SET DATA TYPE DOUBLE PRECISION[]; chỉ dùng migrate deploy.
 */

require("dotenv").config();

const { spawn } = require("child_process");
const { Client } = require("pg");

const log = (msg) => console.log(`[startup] ${msg}`);

const cleanFailedMigrations = async () => {
  const url = process.env.DATABASE_URL;
  log(`DATABASE_URL set: ${Boolean(url)}`);
  if (!url) return;
  const client = new Client({ connectionString: url });
  try {
    await client.connect();
    log("connected to db");
    const before = await client.query(
      "SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL"
    );
    log(`pending/failed migrations in db: ${JSON.stringify(before.rows)}`);
    if (before.rows.length) {
      const del = await client.query(
        "DELETE FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL"
      );
      log(`cleaned ${del.rowCount} stuck migration row(s)`);
    }
  } catch (e) {
    log(`db clean error (continuing): ${e.message}`);
  } finally {
    await client.end().catch(() => {});
  }
};

const run = (cmd, args) =>
  new Promise((resolve, reject) => {
    log(`exec: ${cmd} ${args.join(" ")}`);
    const p = spawn(cmd, args, { stdio: "inherit", shell: true });
    p.on("exit", (code) => {
      log(`${cmd} exited with code ${code}`);
      if (code === 0) resolve();
      else reject(new Error(`${cmd} failed with code ${code}`));
    });
    p.on("error", reject);
  });

const seed = async () => {
  await run("node", ["prisma/seed.js"]);
  await run("node", ["prisma/seed_accounting.js"]);
  await run("node", ["prisma/seed_accounting_demo.js"]);
  await run("node", ["prisma/seed_permissions.js"]);
};

(async () => {
  try {
    await cleanFailedMigrations();
    await run("npx", ["prisma", "migrate", "deploy"]);
    if (process.env.SEED_ON_START === "1") {
      log("SEED_ON_START=1 — seeding");
      await seed();
    } else {
      log("skip seed (set SEED_ON_START=1 để seed khi start)");
    }
    log("migrations applied — starting app");
    require("../src/app.js");
  } catch (e) {
    console.error("[startup] fatal:", e);
    process.exit(1);
  }
})();
