// One-shot fix: remove the phase3 migration row from _prisma_migrations so
// prisma migrate deploy treats it as not applied and replays the (now
// idempotent) SQL. Safe to keep in start script — when the row is gone, this
// is a no-op.
const { Client } = require("pg");

const FAILED = "20260522190000_phase3_bom_lot_marketplace_project";

(async () => {
  const url = process.env.DATABASE_URL;
  console.log("[fix-migration] DATABASE_URL set:", Boolean(url));
  if (!url) return;

  const client = new Client({ connectionString: url });
  try {
    await client.connect();
    console.log("[fix-migration] connected");

    const before = await client.query(
      "SELECT migration_name, finished_at, rolled_back_at, (logs IS NOT NULL) AS has_logs FROM _prisma_migrations WHERE migration_name = $1",
      [FAILED]
    );
    console.log("[fix-migration] row before:", JSON.stringify(before.rows));

    if (before.rows.length && !before.rows[0].finished_at) {
      const del = await client.query(
        "DELETE FROM _prisma_migrations WHERE migration_name = $1",
        [FAILED]
      );
      console.log(`[fix-migration] deleted ${del.rowCount} row(s)`);
    } else {
      console.log("[fix-migration] nothing to delete");
    }
  } catch (e) {
    console.error("[fix-migration] error:", e.message);
  } finally {
    await client.end().catch(() => {});
  }
})();
