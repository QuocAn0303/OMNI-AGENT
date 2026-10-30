/**
 * scripts/lib/teardown.js — TEARDOWN DUNG CHUNG cho script tao du lieu thu
 *
 * VAN DE GOC (do duoc, khong phai doan):
 *   Script kiem chung tao tenant/user/... that roi xoa. Hai duong thoat khong
 *   kiem soat duoc la loi nem ra ngoai try/catch va tien trinh bi Ctrl+C. Chi
 *   co `cleanup()` trong `finally` + `installSignalHandlers()` xu ly duoc.
 *   Nhung "cleanup xong" KHONG chung minh "khong con rac": nen moi lan chay
 *   lai bang chung cho thay script nao ro rac (Smoc 40 dong `warehouses`).
 *
 * BA YEU TO:
 *   1. `captureBaseline()` chup MO-COI-TENANT theo tung bang TRUOC khi seed.
 *   2. `verifyTeardown()` chan 2 dieu kien:
 *        a. Con du lieu cua chinh tenant thu  -> bat buoc teardown day du.
 *        b. Bat ky bang nao TANG so moi coi so voi baseline -> lan chay nay
 *           la rac. Khong dung nguong tuyet doi: DB phat trien co the con rac
 *           cua cac lan chay truoc, do khong phai loi cua lan chay nay.
 *   3. `runWithTeardown()` bao ca nham `captureBaseline` + `cleanup` +
 *      `verifyTeardown` trong MOT cho, dung cho script moi.
 *
 * Dung truc tiep:
 *   const { captureBaseline, verifyTeardown } = require("./lib/teardown");
 *   orphanBaseline = await captureBaseline();      // TRUOC khi tao du lieu
 *   try { ... } finally { await cleanup(); await verifyTeardown(); }
 *
 * Dung khu dung (khuyen nghi):
 *   await runWithTeardown({ label: "check-tenant-isolation", run: main });
 */

let baseline = null;

/** Moi bang co cot `tenantId` (doc tu chinh database, khong hardcode). */
const listScopedTables = async (client) => {
  const rows = await client.$queryRawUnsafe(`
    SELECT c.table_name AS t
      FROM information_schema.columns c
      JOIN information_schema.tables tb
        ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name
     WHERE c.column_name = 'tenantId' AND tb.table_type = 'BASE TABLE'
       AND c.table_schema = 'public' ORDER BY 1`);
  return rows.map((r) => r.t);
};

/**
 * Mo coi-tenant theo bang: dong co `tenantId` khong con bang trong `tenants`.
 *
 * Tinh truc tiep tu database thay vi dua danh sach 139 bang vao ma: bang moi
 * them sau nay se duoc quet ngay, khong can sua script.
 */
const orphanSnapshot = async (client) => {
  const tables = await listScopedTables(client);
  const out = {};
  for (const t of tables) {
    const res = await client.$queryRawUnsafe(
      `SELECT count(*)::int AS n FROM "${t}"
        WHERE "tenantId" IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM tenants x WHERE x.id = "${t}"."tenantId")`,
    );
    out[t] = res[0].n;
  }
  return out;
};

/**
 * Chup baseline mo coi-tenant. PHAI goi TRUOC khi tao du lieu thu.
 * Ket qua duoc giu lai o module (dung chung cho ca process).
 */
const captureBaseline = async (client) => {
  baseline = await orphanSnapshot(client);
  return baseline;
};

/** Baseline hien tai (null neu chua chup). */
const getBaseline = () => baseline;

/**
 * CHAN TEARDOWN SOM / RAC:
 *   - con du lieu cua chinh tenant thu;
 *   - mot bang bat ky TANG so mo coi so voi baseline.
 *
 * Nem loi neu vi doi, nen goi sau moi lan chay: that bai day la bang chung
 * script do hong khong phai chi "khong xac nhan duoc".
 *
 * @param {string|string[]} [tenantIds] tenant thu (bo trong neu khong tao tenant that)
 * @returns {Promise<null>} tra null khi sach
 */
const verifyTeardown = async (tenantIds = [], client) => {
  const ids = (Array.isArray(tenantIds) ? tenantIds : [tenantIds]).filter(Boolean);

  if (ids.length) {
    const tables = await listScopedTables(client);
    const leftovers = [];
    for (const t of tables) {
      const res = await client.$queryRawUnsafe(
        `SELECT count(*)::int AS n FROM "${t}" WHERE "tenantId" = ANY($1::text[])`,
        ids,
      );
      if (res[0].n > 0) leftovers.push(`${t}=${res[0].n}`);
    }
    if (leftovers.length) {
      throw new Error(
        `teardown KHONG sach cho tenant ${ids.join(", ")}: ${leftovers.join(", ")}`,
      );
    }
  }

  const now = await orphanSnapshot(client);
  if (!baseline) {
    throw new Error("verifyTeardown chua duoc captureBaseline() truoc khi seed.");
  }
  const grew = Object.keys(now).filter((t) => now[t] > (baseline[t] ?? 0));
  if (grew.length) {
    throw new Error(
      "lan chay nay TANG mo coi-tenant: " +
        grew.map((t) => `${t} ${baseline[t] ?? 0}->${now[t]}`).join(", "),
    );
  }
  return null;
};

/**
 * Chay mot khoi cong viec co teardown day du.
 *
 * @param {object} opts
 * @param {string} opts.label     ten script, in ra khi that bai
 * @param {import("@prisma/client").PrismaClient} opts.client
 * @param {(tenantIds: string[]) => Promise<{tenantIds?: string[]}>} [opts.run]
 *        tra ve id cua tenant thu de kiem tra du lieu con sot; bo trong neu
 *        script khong tao tenant that
 * @param {() => Promise<string[]>} [opts.getTenantIds] thay cho `run` khi
 *        script can giu control (nhieu tenant tao o nhieu cho)
 * @param {() => Promise<void>} [opts.cleanup] mac dinh `cleanup()` cua
 *        `cleanup-registry`
 */
const runWithTeardown = async ({ label, client, run, getTenantIds, cleanup }) => {
  await captureBaseline(client);
  let tenantIds = [];
  try {
    const out = run ? await run() : null;
    tenantIds = out?.tenantIds ?? tenantIds;
  } finally {
    if (cleanup) await cleanup();
    if (getTenantIds) tenantIds = (await getTenantIds()) ?? tenantIds;
    try {
      await verifyTeardown(tenantIds, client);
    } catch (e) {
      console.error(`[${label}] TEARDOWN BI PHAT: ${e.message}`);
      throw e;
    }
  }
};

module.exports = {
  listScopedTables,
  orphanSnapshot,
  captureBaseline,
  getBaseline,
  verifyTeardown,
  runWithTeardown,
};