// One-shot fix: remove failed phase3 migration row so migrate deploy retries it.
// Safe to run repeatedly: if the row is gone or already finished, this is a no-op.
const { Client } = require("pg");

const FAILED = "20260522190000_phase3_bom_lot_marketplace_project";

(async () => {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log("[fix-migration] DATABASE_URL not set — skipping");
    return;
  }
  const client = new Client({ connectionString: url });
  try {
    await client.connect();
    const res = await client.query(
      `DELETE FROM _prisma_migrations
       WHERE migration_name = $1
         AND (finished_at IS NULL OR rolled_back_at IS NOT NULL)`,
      [FAILED]
    );
    console.log(`[fix-migration] removed ${res.rowCount} failed row(s) for ${FAILED}`);
  } catch (e) {
    console.error("[fix-migration] error (ignored):", e.message);
  } finally {
    await client.end().catch(() => {});
  }
})();
