'use strict';

/**
 * scripts/demo/up.js — rút gọn luồng demo AISC26: nạp dữ liệu → bật UI.
 *
 * Cách dùng:
 *   npm run demo:up            # migrate + seed + seed supermarket demo + bật backend & frontend
 *   npm run demo:bootstrap     # chỉ nạp dữ liệu (không bật UI)
 *   npm run demo:ui            # chỉ bật UI (dữ liệu đã nạp)
 *   npm run demo:up -- --skip-supermarket   # bỏ qua seed supermarket demo
 */
require('dotenv').config();
const { spawn, execSync } = require('child_process');
const path = require('path');

const root = path.resolve(__dirname, '../..');
const argv = process.argv.slice(2);
const bootstrapOnly = argv.includes('--bootstrap-only');
const uiOnly = argv.includes('--ui-only');
const skipSupermarket = argv.includes('--skip-supermarket');

function run(cmd) {
  console.log('\n> ' + cmd);
  execSync(cmd, { cwd: root, stdio: 'inherit' });
}

if (!uiOnly) {
  run('npm run db:migrate:deploy');
  run('npm run db:seed');
  if (!skipSupermarket) run('npm run seed:supermarket:demo');
  console.log('\n✓ Bootstrap dữ liệu demo hoàn tất.');
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
