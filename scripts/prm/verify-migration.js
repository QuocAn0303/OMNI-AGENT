/**
scripts/prm/verify-migration.js — Kiểm tra trực tiếp trên DB rằng bảng PRM đã đúng

Vì sao cần: test đọc mock Prisma không chứng minh được migration đã chạy đúng trên
Postgres thật. Tệp này hỏi information_schema của DB đang cấu hình, nên bắt được
cả lỗi "migration chưa chạy", "index chưa tạo", "FK sai ON DELETE".

Cách chạy:  node scripts/prm/verify-migration.js
Mã thoát 0 = tất cả đạt, 1 = có mục đỏ.
 */
'use strict';

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');

// Prisma 7 BẮT BUỘC driver adapter — `new PrismaClient()` không có đối số sẽ ném
// PrismaClientInitializationError. Dự án này dùng `pg` Pool + PrismaPg (xem
// `src/config/prisma.js`), nên script này dựng y hệt để đúng một đường kết nối.
const url = new URL(process.env.DATABASE_URL);
const pool = new Pool({
  host: url.hostname,
  port: parseInt(url.port || '5432', 10),
  database: url.pathname.slice(1).split('?')[0],
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  max: 2,
  connectionTimeoutMillis: 10_000,
});
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

// [tên kiểm tra, kỳ vọng, thông điệp lỗi]
const CHECKS = [
  [
    'Bảng partners tồn tại',
    async () => Boolean(await tableExists('partners')),
    'Chưa có bảng partners — chạy: npx prisma migrate deploy',
  ],
  [
    'Bảng partner_referrals tồn tại',
    async () => Boolean(await tableExists('partner_referrals')),
    'Chưa có bảng partner_referrals — chạy: npx prisma migrate deploy',
  ],
  [
    'Cột Customer.acquiredCost tồn tại',
    async () => Boolean(await columnExists('customers', 'acquiredCost')),
    'Thiếu cột customers.acquiredCost — chạy: npx prisma migrate deploy',
  ],
  [
    'Cột Customer.partnerReferralId tồn tại',
    async () => Boolean(await columnExists('customers', 'partnerReferralId')),
    'Thiếu cột customers.partnerReferralId — chạy: npx prisma migrate deploy',
  ],
  [
    'Có index chặn trùng lượt giới thiệu',
    async () => Boolean(await indexExists('partner_referrals', 'partner_referrals_partnerId_referredPhone_key')),
    'Thiếu unique (partnerId, referredPhone) — cho phép một đối tác giới thiệu trùng số điện thoại và bị trả hoa hồng hai lần',
  ],
  [
    'Kiểu cột enum khớp với schema.prisma',
    async () => {
      // ĐÂY là mục đã bỏ sót lần trước: cột "tồn tại" nhưng sai kiểu thì mọi
      // truy vấn Prisma vẫn hỏng, vì client sinh từ schema gửi tham số kiểu enum.
      // Lỗi thật gặp phải: schema khai `PartnerType` còn migration tạo cột `TEXT`
      // ⇒ Postgres trả `type "public.PartnerType" does not exist` cho MỌI câu
      // truy vấn vào `partners`.
      const rows = await prisma.$queryRawUnsafe(
        `SELECT column_name, udt_name
         FROM information_schema.columns
         WHERE table_name = 'partners' AND column_name IN ('type', 'commissionType')`,
      );
      const found = Object.fromEntries(rows.map((r) => [r.column_name, r.udt_name]));
      const want = { type: 'PartnerType', commissionType: 'CommissionType' };
      const wrong = Object.entries(want).filter(([col, type]) => found[col] !== type);
      if (wrong.length) {
        throw new Error(
          wrong
            .map(([col, type]) => `${col} đang là "${found[col] || 'thiếu'}", cần "${type}"`)
            .join('; '),
        );
      }
      return true;
    },
    'Cột enum của bảng partners phải khớp kiểu khai trong schema.prisma, nếu không Prisma Client sẽ gửi sai kiểu tham số và mọi truy vấn vào bảng đều hỏng',
  ],
  [
    'Chỉ có MỘT khóa ngoại, và nó trỏ về partners',
    async () => {
      const fks = await prisma.$queryRaw`
        SELECT tc.constraint_name, ccu.table_name AS target
        FROM information_schema.table_constraints tc
        JOIN information_schema.constraint_column_usage ccu
          ON ccu.constraint_name = tc.constraint_name
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND tc.table_name = 'partner_referrals'`;
      if (fks.length !== 1) {
        throw new Error(`có ${fks.length} khóa ngoại, mong đợi đúng 1 — xem danh sách: ${fks.map((f) => f.constraint_name).join(', ')}`);
      }
      if (fks[0].target !== 'partners') {
        throw new Error(`khóa ngoại trỏ về "${fks[0].target}", mong đợi "partners"`);
      }
      return true;
    },
    'partner_referrals phải chỉ có 1 khóa ngoại tới partners — có thể đã thêm khoá ngoại cứng tới customers/leads, nghĩa là xoá khách sẽ mất lịch sử giới thiệu',
  ],
  [
    'Khóa ngoại xoá đối tác theo CASCADE',
    async () => {
      const rows = await prisma.$queryRaw`
        SELECT rc.delete_rule
        FROM information_schema.table_constraints tc
        JOIN information_schema.referential_constraints rc
          ON rc.constraint_name = tc.constraint_name
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND tc.table_name = 'partner_referrals'`;
      return rows.length === 1 && rows[0].delete_rule === 'CASCADE';
    },
    'ON DELETE không phải CASCADE — schema.prisma khai báo Cascade nên DB phải khớp, nếu lệch thì môi trường nào chạy theo schema sẽ chặn xoá trong khi DB thì không',
  ],
];

async function tableExists(name) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT to_regclass($1) IS NOT NULL AS ok`,
    `public.${name}`,
  );
  return rows[0].ok;
}

async function columnExists(table, column) {
  // ILIKE, không phải `=`. Postgres giữ NGUYÊN chữ hoa chữ thường trong
  // information_schema, còn Prisma mặc định đặt tên cột theo đúng tên field
  // (`acquiredCost`, không phải `acquiredcost`). So sánh `=` với chuỗi lowercase sẽ
  // báo "thiếu cột" một cách sai — tệ hơn là làm người đọc tưởng migration hỏng.
  const rows = await prisma.$queryRawUnsafe(
    `SELECT 1 FROM information_schema.columns
     WHERE table_name = $1 AND column_name ILIKE $2 LIMIT 1`,
    table,
    column,
  );
  return rows.length > 0;
}

async function indexExists(table, index) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT 1 FROM pg_indexes WHERE tablename = $1 AND indexname = $2 LIMIT 1`,
    table,
    index,
  );
  return rows.length > 0;
}

async function main() {
  let failed = 0;
  console.log('Kiểm tra migration PRM trên DB thật\n');
  for (const [name, run, why] of CHECKS) {
    try {
      const ok = await run();
      if (ok) {
        console.log(`  [OK]   ${name}`);
      } else {
        failed += 1;
        console.log(`  [SAI]  ${name}\n         ${why}`);
      }
    } catch (e) {
      failed += 1;
      console.log(`  [LỖI]  ${name}\n         ${e.message}`);
    }
  }
  console.log('');
  if (failed === 0) {
    console.log(`Tất cả ${CHECKS.length} mục đạt.`);
  } else {
    console.log(`${failed}/${CHECKS.length} mục KHÔNG đạt.`);
  }
  return failed === 0 ? 0 : 1;
}

main()
  .then((code) => prisma.$disconnect().then(() => process.exit(code)))
  .catch(async (e) => {
    console.error('Không kết nối được DB:', e.message);
    await prisma.$disconnect().catch(() => {});
    process.exit(1);
  });