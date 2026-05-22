// Centralized startup: fix failed migrations -> migrate deploy -> start server.
// Runs as a single Node process so we get clean ordered logs and can react to errors.
const { spawn } = require("child_process");
const { Client } = require("pg");

const FAILED = "20260522190000_phase3_bom_lot_marketplace_project";

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

(async () => {
  try {
    await cleanFailedMigrations();
    await run("npx", ["prisma", "migrate", "deploy"]);
    log("migrations applied — starting app");
    require("../src/app.js");
  } catch (e) {
    console.error("[startup] fatal:", e);
    process.exit(1);
  }
})();
