#!/usr/bin/env node
'use strict';
require('dotenv').config({ quiet: true });
const { fixture, tenantId, validateFixture, seedCompany, verifyCompany } = require('./seed');

async function main() {
  const args = process.argv.slice(2);
  if (args.some(a => !['--apply', '--verify'].includes(a))) throw new Error('UNKNOWN_ARGUMENT');
  validateFixture(fixture);
  if (!args.includes('--apply') && !args.includes('--verify')) {
    process.stdout.write(`${JSON.stringify({ mode: 'dry-run', tenantId, slug: fixture.company.slug, departments: 6, employees: fixture.employees.length, action: 'Dùng --apply để seed; --verify để seed hai lần và kiểm tra DB.' }, null, 2)}\n`);
    return;
  }
  if (process.env.NODE_ENV === 'production') throw new Error('DEMO_SEED_FORBIDDEN_IN_PRODUCTION');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL_REQUIRED');
  const bcrypt = require('bcrypt');
  const { PrismaClient } = require('@prisma/client');
  const { PrismaPg } = require('@prisma/adapter-pg');
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2, connectionTimeoutMillis: 5000 });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  try {
    const hash = await bcrypt.hash(process.env.CANDORA_DEMO_PASSWORD || 'CandoraDemo!2026', 10);
    const first = await seedCompany(prisma, hash);
    const verified = await verifyCompany(prisma);
    if (args.includes('--verify')) {
      const before = await prisma.user.findMany({ where: { tenantId }, orderBy: { id: 'asc' } });
      const second = await seedCompany(prisma, hash);
      await verifyCompany(prisma);
      const after = await prisma.user.findMany({ where: { tenantId }, orderBy: { id: 'asc' } });
      if (second.writes !== 0 || JSON.stringify(before) !== JSON.stringify(after)) throw new Error('IDEMPOTENCY_FAILED');
      process.stdout.write(`${JSON.stringify({ mode: 'verified', first, second, verified, idempotent: true }, null, 2)}\n`);
    } else process.stdout.write(`${JSON.stringify({ mode: 'applied', ...first, verified }, null, 2)}\n`);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch(error => {
  // Do not echo Prisma errors: they may contain connection info or password hashes.
  process.stderr.write(`C-03 seed thất bại (${error.code || error.name}). Kiểm tra DB/schema và xung đột định danh; không in thông tin kết nối.\n`);
  process.exitCode = 1;
});
