/**
 * scripts/check-tenant-aidocs.js — Cách ly tenant cho kho RAG `ai_documents` (DB THẬT)
 *
 * VÌ SAO CÓ SCRIPT RIÊNG
 * `AiDocument` có `@@ignore` trong schema ⇒ Prisma KHÔNG sinh client cho nó ⇒
 * extension `tenantId` không chạm được. Toàn bộ cách ly tenant của bảng này
 * nằm trong SQL thô của `src/modules/ai/ai.service.js`, nên phải kiểm bằng SQL
 * thật trên DB thật, không kiểm được bằng unit test mock.
 *
 * Bối cảnh lỗi đã sửa:
 *   - ràng buộc unique TOÀN CỤC `(entity_type, entity_id)`, không có `tenant_id`
 *     ⇒ hai tenant dùng cùng `entity_id` sẽ tranh nhau một hàng;
 *   - `ON CONFLICT DO UPDATE` không set lại `tenant_id` ⇒ tài liệu của tenant A
 *     bị ghi đè nội dung rồi rơi về `NULL`, tức thành "global" và mọi tenant
 *     đọc thấy;
 *   - đọc lại `id` chỉ lọc `entity_type`/`entity_id` ⇒ có thể lấy nhầm tài liệu
 *     của tenant khác rồi đè vector của họ.
 *
 * Chạy: node scripts/check-tenant-aidocs.js
 */
require("dotenv").config();
const { assertLocalDb } = require("./lib/assert-local-db");
assertLocalDb("check-tenant-aidocs");

const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { Pool } = require("pg");

const url = new URL(process.env.DATABASE_URL);
const pool = new Pool({
  host: url.hostname,
  port: parseInt(url.port || "5432", 10),
  database: url.pathname.slice(1).split("?")[0],
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
});
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

let pass = 0;
let fail = 0;
const ok = (label, cond, extra = "") => {
  console.log(`${cond ? "OK  " : "FAIL"} | ${label}${extra ? " -> " + extra : ""}`);
  if (cond) pass += 1;
  else fail += 1;
};

const suffix = Date.now().toString(36);
const ETYPE = `check-aidocs-${suffix}`;

/** Đúng câu SQL đang dùng trong `ai.service.js` sau bản sửa. */
const upsertDoc = (entityId, content, tenantId) =>
  prisma.$executeRawUnsafe(
    `INSERT INTO ai_documents (id, entity_type, entity_id, content, metadata, tenant_id, updated_at)
     VALUES (gen_random_uuid(), $1, $2, $3, $4::jsonb, $5, NOW())
     ON CONFLICT (entity_type, entity_id)
     DO UPDATE SET content = $3, metadata = $4::jsonb, updated_at = NOW()
     WHERE ai_documents.tenant_id = EXCLUDED.tenant_id`,
    ETYPE,
    entityId,
    content,
    JSON.stringify({}),
    tenantId,
  );

const readBack = (entityId, tenantId) =>
  prisma.$queryRawUnsafe(
    `SELECT id, content, tenant_id FROM ai_documents
      WHERE entity_type = $1 AND entity_id = $2 AND tenant_id = $3
      LIMIT 1`,
    ETYPE,
    entityId,
    tenantId,
  );

/** Truy vấn như `searchDocuments`: tài liệu của tenant + knowledge global. */
const searchLike = (tenantId) =>
  prisma.$queryRawUnsafe(
    `SELECT d.entity_id, d.tenant_id
       FROM ai_documents d
      WHERE d.entity_type = $1
        AND (d.tenant_id = $2 OR d.tenant_id IS NULL)`,
    ETYPE,
    tenantId,
  );

(async () => {
  console.log("\n=== CACH LY TENANT cho ai_documents (DB that) ===\n");

  const tA = "tenant-aidocs-A-" + suffix;
  const tB = "tenant-aidocs-B-" + suffix;

  try {
    // ── 1. Hai tenant cùng ghi entity_id KHÁC NHAU ─────────────────────────
    await upsertDoc("eA", "kho-A", tA);
    await upsertDoc("eB", "kho-B", tB);

    const seenByA = await searchLike(tA);
    const seenByB = await searchLike(tB);
    const idsA = seenByA.map((r) => r.entity_id);
    const idsB = seenByB.map((r) => r.entity_id);

    ok("Tenant A chi thay tai lieu cua A", idsA.includes("eA") && !idsA.includes("eB"), idsA.join(","));
    ok("Tenant B chi thay tai lieu cua B", idsB.includes("eB") && !idsB.includes("eA"), idsB.join(","));

    // ── 2. Ghi đè cùng entity_id: KHÔNG được cướp của tenant khác ──────────
    await upsertDoc("shared", "v1-tu-A", tA);
    const owner1 = await prisma.$queryRawUnsafe(
      `SELECT tenant_id FROM ai_documents WHERE entity_type = $1 AND entity_id = 'shared'`,
      ETYPE,
    );
    ok("Ghi 'shared' lan 1 -> thuoc A", owner1[0]?.tenant_id === tA, String(owner1[0]?.tenant_id));

    // Tenant B thử ghi cùng entity_id: phải bị TỪ CHỐI (rowCount = 0), và
    // tài liệu của A phải còn nguyên — không được đổi quyền sở hữu.
    let bError = null;
    let bRowCount = null;
    try {
      bRowCount = await upsertDoc("shared", "v2-tu-B", tB);
    } catch (e) {
      bError = e;
    }
    ok("B ghi 'shared' cùng entity_id -> KHONG duoc ghi (rowCount = 0)", bRowCount === 0 && !bError, `rowCount=${bRowCount}, err=${bError?.code || bError?.message?.slice(0, 40)}`);

    const afterB = await prisma.$queryRawUnsafe(
      `SELECT tenant_id, content FROM ai_documents WHERE entity_type = $1 AND entity_id = 'shared'`,
      ETYPE,
    );
    ok("Tai lieu van thuoc A sau khi B thu ghi", afterB[0]?.tenant_id === tA, String(afterB[0]?.tenant_id));
    ok("Noi dung cua A KHONG bi doi", afterB[0]?.content === "v1-tu-A", String(afterB[0]?.content));

    // ── 3. A ghi lại tài liệu CỦA CHÍNH MÌNH thì vẫn cập nhật được ────────
    const selfWrite = await upsertDoc("shared", "v3-tu-A-cap-nhat", tA);
    const afterSelf = await prisma.$queryRawUnsafe(
      `SELECT tenant_id, content FROM ai_documents WHERE entity_type = $1 AND entity_id = 'shared'`,
      ETYPE,
    );
    ok("A ghi lai tai lieu cua chinh minh -> cap nhat duoc", selfWrite === 1 && afterSelf[0]?.content === "v3-tu-A-cap-nhat", `rowCount=${selfWrite}`);

    // ── 4. Đọc lại theo tenant không được trả nhầm tài liệu của tenant khác ──
    const backA = await readBack("shared", tA);
    ok("Tenant A doc lai duoc tai lieu cua minh", backA[0]?.tenant_id === tA);

    const backB = await readBack("shared", tB);
    ok(
      "Tenant B KHONG doc lai duoc tai lieu cua A",
      backB.length === 0,
      backB.length ? `tra ve ${backB.length} dong` : "",
    );

    // ── 4. Ràng buộc unique toàn cục: ghi lại phải CHỈ có 1 hàng ────────────
    const rows = await prisma.$queryRawUnsafe(
      `SELECT count(*)::int AS n FROM ai_documents WHERE entity_type = $1 AND entity_id = 'shared'`,
      ETYPE,
    );
    ok("Chi co MOT hang cho (entity_type, entity_id)", rows[0].n === 1, `n=${rows[0].n}`);

    ok(
      "Tenant A VAN thay 'shared' cua chinh minh (khong mat tai lieu)",
      (await searchLike(tA)).some((r) => r.entity_id === "shared"),
    );
    ok(
      "Tenant B KHONG thay 'shared' cua A",
      !(await searchLike(tB)).some((r) => r.entity_id === "shared"),
    );
  } finally {
    await prisma.$executeRawUnsafe(`DELETE FROM ai_documents WHERE entity_type = $1`, ETYPE);
    await prisma.$disconnect();
  }

  console.log(`\n=== ${fail === 0 ? "TAT CA PASS" : "CO FAIL"} (${pass} pass / ${fail} fail) ===`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(async (e) => {
  console.error("LOI:", e.message);
  try {
    await prisma.$executeRawUnsafe(`DELETE FROM ai_documents WHERE entity_type = $1`, ETYPE);
    await prisma.$disconnect();
  } catch {
    /* bo qua */
  }
  process.exit(1);
});
