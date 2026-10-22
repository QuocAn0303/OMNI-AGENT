'use strict';

/**
 * scripts/demo/up.js — rút gọn luồng demo AISC26: từ DB trống → bật UI.
 *
 * Tự chạy migrate, seed plan (nếu thiếu), đảm bảo tenant/user demo, login,
 * seed supermarket, setup lead time, rồi bật backend + frontend.
 * Idempotent, an toàn chạy lặp.
 *
 * Cờ:
 *   --bootstrap-only      chỉ nạp dữ liệu, không bật UI
 *   --ui-only             chỉ bật UI
 *   --skip-supermarket    bỏ qua seed supermarket demo
 *   --skip-setup          bỏ qua demo:setup
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

const SLUG = 'omni-demo-mo-phong';
const TENANT_NAME = 'OMNI DEMO (MÔ PHỎNG — dữ liệu chuỗi siêu thị Việt Nam)';
const DEMO_EMAIL = 'demo-mo-phong@local.invalid';

function run(cmd) {
  console.log('\n> ' + cmd);
  execSync(cmd, { cwd: root, stdio: 'inherit' });
}

const prisma = require(path.join(root, 'src/config/prisma'));

async function ensureDemoTenantAndUser() {
  let tenant = await prisma.tenant.findUnique({ where: { slug: SLUG } });
  if (!tenant) {
    tenant = await prisma.tenant.create({ data: { name: TENANT_NAME, slug: SLUG } });
    console.log('✓ Đã tạo tenant demo:', SLUG);
  }
  const userId = tenant.id + ':demo-user';
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    await prisma.user.create({
      data: {
        id: userId,
        tenantId: tenant.id,
        email: DEMO_EMAIL,
        password: 'khong-dang-nhap-duoc',
        fullName: 'Kế toán demo (MÔ PHỎNG)',
        role: 'ADMIN',
        isActive: true,
        emailVerified: false,
        registrationStatus: 'PENDING',
      },
    });
    console.log('✓ Đã tạo user demo:', DEMO_EMAIL);
  }
}

async function main() {
  if (!uiOnly) {
    run('npm run db:migrate:deploy');

    const plan = await prisma.subscriptionPlan.findUnique({ where: { key: 'business' } }).catch(() => null);
    if (!plan) run('npm run db:seed');

    await ensureDemoTenantAndUser();
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
