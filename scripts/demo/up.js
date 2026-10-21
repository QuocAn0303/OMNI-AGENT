'use strict';

/**
 * scripts/demo/up.js — rút gọn luồng demo AISC26: nạp dữ liệu → bật UI.
 *
 * Mặc định làm đủ các bước (idempotent, an toàn chạy lặp):
 *   1. Nếu tenant demo chưa có user → `data:import -- --reset --apply`
 *   2. `demo:login -- --apply` (bật đăng nhập + gói business)
 *   3. `seed:supermarket:demo` (600 SKU + dữ liệu bán hàng) — trừ khi --skip-supermarket
 *   4. `demo:setup` (PO+GRN lịch sử cho lead time) — trừ khi --skip-setup
 *   5. Bật backend + frontend
 *
 * Cờ:
 *   --bootstrap-only      chỉ nạp dữ liệu, không bật UI
 *   --ui-only             chỉ bật UI
 *   --skip-supermarket    bỏ qua seed supermarket demo
 *   --skip-setup          bỏ qua demo:setup
 *   --skip-import         không tự chạy data:import dù thiếu user
 */
require('dotenv').config();
const { spawn, execSync } = require('child_process');
const path = require('path');

const root = path.resolve(__dirname, '../..');
const argv = process.argv.slice(2);
const bootstrapOnly = argv.includes('--bootstrap-only');
const uiOnly = argv.includes('--ui-only');
const skipSupermarket = argv.includes('--skip-supermarket');
const skipSetup = argv.includes('--skip-setup');
const skipImport = argv.includes('--skip-import');

function run(cmd) {
  console.log('\n> ' + cmd);
  execSync(cmd, { cwd: root, stdio: 'inherit' });
}

const prisma = require(path.join(root, 'src/config/prisma'));
const { runWithTenant } = require(path.join(root, 'src/config/tenantContext'));

async function demoUserCount() {
  const t = await prisma.tenant.findUnique({ where: { slug: 'omni-demo-mo-phong' }, select: { id: true } });
  if (!t) return 0;
  return runWithTenant(t.id, () => prisma.user.count({ where: { tenantId: t.id } }));
}

async function main() {
  if (!uiOnly) {
    const n = await demoUserCount().catch(() => 0);
    if (n === 0 && !skipImport) {
      run('npm run data:import -- --reset --apply');
    }
    run('npm run demo:login -- --apply');
    if (!skipSupermarket) run('npm run seed:supermarket:demo');
    if (!skipSetup) run('npm run demo:setup');
    console.log('\n✓ Bootstrap dữ liệu demo hoàn tất.');
    await prisma.$disconnect().catch(() => {});
  }

  if (bootstrapOnly) process.exit(0);

  const backend = spawn('npm', ['run', 'dev'], { cwd: root, stdio: 'inherit', shell: true });
  const frontend = spawn('npm', ['run', 'dev'], { cwd: path.join(root, 'frontend'), stdio: 'inherit', shell: true });

  let shuttingDown = false;
  function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    try { backend.kill('SIGINT'); } catch (_) {}
    try { frontend.kill('SIGINT'); } catch (_) {}
    process.exit(0);
  }
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  backend.on('exit', (code) => {
    if (!shuttingDown && code && code !== 0) console.error('backend exited with code ' + code);
  });
  frontend.on('exit', (code) => {
    if (!shuttingDown && code && code !== 0) console.error('frontend exited with code ' + code);
  });
}

main().catch(async (e) => {
  console.error('LOI:', e && e.message ? e.message : e);
  try { await prisma.$disconnect(); } catch (_) {}
  process.exit(1);
});
