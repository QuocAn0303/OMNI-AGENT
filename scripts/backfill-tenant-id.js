/**
 * scripts/backfill-tenant-id.js — Set tenantId cho tất cả data hiện có
 */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  // 1. Lấy tenant đầu tiên
  const tenant = await prisma.$queryRaw`SELECT id, name FROM tenants LIMIT 1`;
  if (!tenant || tenant.length === 0) {
    console.error('Không tìm thấy tenant nào. Chạy seed trước.');
    process.exit(1);
  }
  const tenantId = tenant[0].id;
  console.log(`Backfill tenantId = ${tenantId} (${tenant[0].name})`);

  // 2. Tìm tất cả table có cột "tenantId"
  const tables = await prisma.$queryRaw`
    SELECT table_name 
    FROM information_schema.columns 
    WHERE column_name = 'tenantId' 
      AND table_schema = 'public'
      AND table_name != 'tenants'
    ORDER BY table_name
  `;

  console.log(`Tìm thấy ${tables.length} bảng cần backfill`);

  // 3. Update từng table
  let totalUpdated = 0;
  for (const { table_name } of tables) {
    const result = await prisma.$executeRawUnsafe(
      `UPDATE "${table_name}" SET "tenantId" = $1 WHERE "tenantId" IS NULL`,
      tenantId
    );
    if (result > 0) {
      console.log(`  ${table_name}: ${result} rows updated`);
      totalUpdated += result;
    }
  }

  console.log(`\nDone! Total ${totalUpdated} rows backfilled với tenantId = ${tenantId}`);
  await pool.end();
}

main().catch((e) => {
  console.error('Backfill failed:', e);
  process.exit(1);
});
