// Tạo shadow database cho `prisma migrate dev` (cần P1003 fix)
// Chạy 1 lần: node scripts/ensure-shadow-db.js
require('dotenv').config();
const { Client } = require('pg');

const adminUrl = process.env.DATABASE_URL;
if (!adminUrl) {
  console.error('Thiếu DATABASE_URL');
  process.exit(1);
}

// Đổi sang database "postgres" để tạo DB mới
const u = new URL(adminUrl);
const shadowName = (u.searchParams.get('shadowDatabaseUrl') || 'erp_shadow')
  .replace(/^.*\/(.*?)(\?.*)?$/, '$1');
u.pathname = '/postgres';
const shadowUrl = new URL(adminUrl);
shadowUrl.pathname = '/' + shadowName;

(async () => {
  const exists = async (name) => {
    const c = new Client({ connectionString: u.toString() });
    await c.connect();
    const r = await c.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    await c.end();
    return r.rowCount > 0;
  };

  if (await exists(shadowName)) {
    console.log('Shadow DB "' + shadowName + '" đã tồn tại — không cần tạo');
  } else {
    const c = new Client({ connectionString: u.toString() });
    await c.connect();
    await c.query('CREATE DATABASE "' + shadowName + '"');
    await c.end();
    console.log('Đã tạo shadow DB: ' + shadowName);
  }

  const c2 = new Client({ connectionString: shadowUrl.toString() });
  await c2.connect();
  await c2.end();
  console.log('Kết nối shadow DB thành công: ' + shadowName);
})().catch((e) => {
  console.error('Lỗi: ' + e.message);
  process.exit(1);
});
