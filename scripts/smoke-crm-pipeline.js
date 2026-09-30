/**
 * Smoke test CRM Sales Pipeline (Phase 1) — chạy trên DB thật, tự dọn dẹp.
 *
 * Kiểm tra:
 *  1. 7 bảng + 5 enum của CRM pipeline đã tồn tại trong DB
 *  2. TENANT_SCOPED_MODELS tự inject tenantId khi create (multi-tenant scoping)
 *  3. Ràng buộc @unique orderId trên crm_deals hoạt động
 *
 * Chạy: node scripts/smoke-crm-pipeline.js
 */
require('dotenv').config();
const prisma = require('../src/config/prisma');
const { runWithTenant, getTenantId } = require('../src/config/tenantContext');

const TABLES = [
  'crm_pipeline_stages', 'crm_leads', 'crm_organizations',
  'crm_contacts', 'crm_deals', 'crm_deal_items', 'crm_communications',
];
const TYPES = [
  'CrmEntityType', 'CrmStageKind', 'CrmLeadStatus', 'CrmCommType', 'CrmCommDirection',
];

const A = 'smoke-tenant-AAA';
const B = 'smoke-tenant-BBB';

async function checkSchema() {
  const { Client } = require('pg');
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  const t = await c.query(
    "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename = ANY($1) ORDER BY 1",
    [TABLES],
  );
  const found = t.rows.map((r) => r.tablename);
  console.log('BẢNG: ' + found.length + '/' + TABLES.length);
  for (const x of TABLES) console.log('  ' + (found.includes(x) ? 'OK  ' : 'MISS') + ' ' + x);

  const e = await c.query('SELECT typname FROM pg_type WHERE typname = ANY($1) ORDER BY 1', [TYPES]);
  const tf = e.rows.map((r) => r.typname);
  console.log('ENUM: ' + tf.length + '/' + TYPES.length);
  for (const x of TYPES) console.log('  ' + (tf.includes(x) ? 'OK  ' : 'MISS') + ' ' + x);

  const col = await c.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name='customers' AND column_name='zaloUserId'",
  );
  console.log('COLUMN customers.zaloUserId: ' + (col.rowCount ? 'OK' : 'MISS'));

  const fk = await c.query(
    "SELECT count(*)::int AS n FROM pg_constraint WHERE contype='f' AND conname LIKE 'crm_%'",
  );
  console.log('FK crm_*: ' + fk.rows[0].n);

  await c.end();
  return found.length === TABLES.length && tf.length === TYPES.length && col.rowCount === 1;
}

async function checkScoping() {
  let ok = true;

  // create trong context A
  const leadA = await runWithTenant(A, () =>
    prisma.crmLead.create({ data: { leadName: 'Smoke Lead A' }, select: { id: true, tenantId: true, leadName: true } }),
  );
  console.log('\nTenant scoping (create):');
  console.log('  context A -> tenantId=' + leadA.tenantId + (leadA.tenantId === A ? '  OK' : '  LOI'));
  if (leadA.tenantId !== A) ok = false;

  // tenant B không nhìn thấy row của tenant A
  const seenByB = await runWithTenant(B, () => prisma.crmLead.findMany({ where: {} }));
  const leaked = seenByB.some((r) => r.id === leadA.id);
  console.log('  tenant B thấy row của A? ' + (leaked ? 'CÓ (RÒ RỈ)' : 'không  OK'));
  if (leaked) ok = false;

  const countA = await runWithTenant(A, () => prisma.crmLead.count());
  console.log('  tenant A đếm được row của mình: ' + countA + (countA >= 1 ? '  OK' : '  LOI'));
  if (countA < 1) ok = false;

  return { ok, leadA };
}

async function checkUniqueOrderId() {
  // Kiểm tra index unique tồn tại ở tầng DB (không tạo Order thật vì FK thật)
  const { Client } = require('pg');
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const uq = await c.query(
    "SELECT indexname FROM pg_indexes WHERE tablename='crm_deals' AND indexname='crm_deals_orderId_key'",
  );
  await c.end();

  const ok = uq.rowCount === 1;
  console.log('\nUNIQUE crm_deals.orderId: ' + (ok ? 'OK (index tồn tại ở DB)' : 'MISS'));
  return ok;
}

async function checkRegistered() {
  const src = require('fs').readFileSync(__dirname + '/../src/config/prisma.js', 'utf8');
  const block = src.slice(src.indexOf('TENANT_SCOPED_MODELS'), src.indexOf('READ_OPS'));
  const need = TABLES.map((t) => 'Crm' + t.replace(/^crm_/, '').replace(/^\w/, (m) => m.toUpperCase()).replace(/s$/, 's'));
  const models = [
    'CrmPipelineStage', 'CrmLead', 'CrmOrganization', 'CrmContact',
    'CrmDeal', 'CrmDealItem', 'CrmCommunication',
  ];
  console.log('\nTENANT_SCOPED_MODELS:');
  let ok = true;
  for (const m of models) {
    const has = block.includes('"' + m + '"');
    if (!has) ok = false;
    console.log('  ' + (has ? 'OK  ' : 'MISS') + ' ' + m);
  }
  void need;
  return ok;
}

(async () => {
  let ok = true;
  try {
    ok = (await checkSchema()) && ok;
    ok = (await checkRegistered()) && ok;
    const { ok: scopingOk } = await checkScoping();
    ok = scopingOk && ok;
    ok = (await checkUniqueOrderId()) && ok;
  } finally {
    // dọn dẹp
    await prisma.crmLead.deleteMany({ where: { leadName: { startsWith: 'Smoke Lead' } } });
    await prisma.crmDeal.deleteMany({ where: { dealName: { startsWith: 'Smoke Deal' } } });
    console.log('\nĐã dọn dẹp dữ liệu smoke test.');
  }

  console.log('\n' + (ok ? 'PASS' : 'FAIL'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('Lỗi:', e.message); process.exit(1); });
