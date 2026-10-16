/* SCRIPT TẢM — xac nhan mat khau demo da ghi dung chua, va xem login that
 * tra ve loi gi (neu backend dang chay).
 * Chay: node .tmp-login.js
 */
require('dotenv').config();
const bcrypt = require('bcrypt');
const p = require('./src/config/prisma');

(async () => {
  const u = await p.user.findFirst({
    where: { email: 'demo-mo-phong@local.invalid' },
    select: { id: true, email: true, role: true, isActive: true, emailVerified: true, registrationStatus: true, mustChangePassword: true, password: true, tenantId: true },
  });
  if (!u) { console.log('  KHONG co user'); await p.$disconnect(); return; }
  console.log('=== USER ===');
  console.log('  email              : ' + u.email);
  console.log('  role               : ' + u.role);
  console.log('  isActive           : ' + u.isActive);
  console.log('  emailVerified      : ' + u.emailVerified);
  console.log('  registrationStatus : ' + u.registrationStatus);
  console.log('  mustChangePassword : ' + u.mustChangePassword);
  console.log('  bcrypt hash ton tai : ' + (u.password ? 'co (' + u.password.length + ' ky tu)' : '<RONG>'));
  console.log('  khop Demo123456    : ' + (u.password ? bcrypt.compareSync('Demo123456', u.password) : false));
  console.log('  khop cu            : ' + (u.password ? bcrypt.compareSync('khong-dang-nhap-duoc', u.password) : false));

  // Thu dang nhap that qua HTTP neu backend dang chay.
  const http = require('http');
  const goi = (path, body) => new Promise((r) => {
    const payload = JSON.stringify(body);
    const req = http.request({ hostname: '127.0.0.1', port: 4000, path, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }, timeout: 15000 }, (res) => {
      let raw = ''; res.on('data', (d) => { raw += d; }); res.on('end', () => r({ status: res.statusCode, body: raw }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (e) => r({ status: 0, body: e.message }));
    req.write(payload); req.end();
  });

  console.log('\n=== THU DANG NHAP QUA HTTP ===');
  const r = await goi('/api/auth/login', { email: 'demo-mo-phong@local.invalid', password: 'Demo123456' });
  if (r.status === 0) {
    console.log('  backend CHUA CHAY (' + r.body + ') — can mo 1 terminal chay: npm run dev');
  } else {
    console.log('  HTTP ' + r.status);
    let j = {};
    try { j = JSON.parse(r.body); } catch { /* ignore */ }
    console.log('  ' + r.body.replace(/\s+/g, ' ').slice(0, 300));
    if (j.data && j.data.user) console.log('  user: ' + j.data.user.email + '  role=' + j.data.user.role);
    if (j.data && j.data.accessToken) console.log('  -> DA DANG NHAP DUOC');
  }

  await p.$disconnect();
})().catch(async (e) => { console.log('LOI: ' + e.message.slice(0, 120)); await p.$disconnect().catch(() => {}); });
