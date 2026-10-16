/**
 * scripts/seed/supermarket/run.js — TRÌNH CHẠY + KIỂM CHỨNG
 *
 * Chạy:  node scripts/seed/supermarket/run.js
 * Xem:   node scripts/seed/supermarket/run.js --verify
 *
 * Chạy TUẦN TỰ, không song song với lệnh khác — nó ghi DB hàng loạt.
 */

require('dotenv').config();
const path = require('path');
const prisma = require('../../../src/config/prisma');
const { runWithTenant } = require('../../../src/config/tenantContext');
const S = require('./seed');

// ── DỌN DẸP THEO THỨ TỰ PHỤ THUỘC ───────────────────────────────────────
//
// Vì sao cần bước này: xoá bảng cha trong khi bảng con còn trỏ tới sẽ vi
// phạm FK. Lần đầu tôi xoá `vendors` trước khi xoá `purchase_orders` ⇒
// `RESTRICT` chặn. Xoá **con trước, cha sau** là thứ tự duy nhất đúng.
//
// KHÔNG xoá: user · tenant · companySettings · account · subscriptionPlan.
// Chúng là hạ tầng, không phải dữ liệu nghiệp vụ.

const DON_DUOC = [
  // kế toán
  ['journalLine', {}], ['journalEntry', {}],
  // mua hàng
  ['goodsReceiptItem', {}], ['goodsReceiptNote', {}],
  ['purchaseItem', {}], ['purchaseOrder', {}],
  ['rfqQuote', {}], ['rfqQuotation', {}],
  ['replenishmentItem', {}], ['replenishmentProposal', {}],
  // kho
  ['stockTransferItem', {}], ['stockTransfer', {}],
  ['cycleCountItem', {}], ['cycleCount', {}],
  ['inventoryTransaction', {}], ['inventoryLot', {}], ['serialNumber', {}], ['inventory', {}],
  // bán hàng
  ['billSplit', {}], ['promotionUsage', {}], ['orderItemModifier', {}],
  ['returnLineItem', {}], ['orderReturn', {}],
  ['invoice', {}], ['payment', {}], ['orderItem', {}], ['order', {}],
  // khách
  ['debtPayment', {}], ['debt', {}],
  ['loyaltyTransaction', {}], ['stampCard', {}], ['customerNote', {}],
  ['customerTask', {}], ['promotionUsageCustomer', {}],
  ['storeCreditTransaction', {}], ['churnAlert', {}],
  ['customer', {}],
  // hàng & danh mục
  ['productVariant', {}], ['product', {}],
  ['vendor', {}],
  ['warehouse', {}],
  ['category', {}],
];

async function donDep(tenantId) {
  console.log('\n[0/8] Don dep du lieu cu (theo thu tu phu thuoc)');
  let tong = 0;
  const thatBai = [];
  for (const [bang] of DON_DUOC) {
    if (!prisma[bang]) continue;
    try {
      const r = await prisma[bang].deleteMany({ where: { tenantId } });
      if (r.count) { tong += r.count; console.log('      ' + bang.padEnd(28) + r.count); }
    } catch (e) {
      thatBai.push(bang + ' (' + String(e.message).slice(0, 60) + ')');
    }
  }
  console.log('      da xoa ' + tong + ' dong');
  if (thatBai.length) {
    console.log('      ⚠ KHONG xoa duoc (con bi FK chặn):');
    thatBai.forEach((x) => console.log('         ' + x));
  }
  return { tong, thatBai };
}

// ── KIỂM CHỨNG ───────────────────────────────────────────────────────────

/** EAN-13: chữ số kiểm tra = (10 - tổng(trọng số 1,3)) % 10 */
function eanHopLe(ma) {
  if (!/^\d{13}$/.test(ma)) return false;
  const tong = [...ma.slice(0, 12)].reduce((s, d, i) => s + Number(d) * (i % 2 === 0 ? 1 : 3), 0);
  return (10 - (tong % 10)) % 10 === Number(ma[12]);
}

async function verify() {
  const t = await prisma.tenant.findFirst({ where: { slug: S.SLUG } });
  if (!t) { console.log('KHONG co tenant demo'); return; }
  const w = (m, e) => prisma[m].count({ where: { tenantId: t.id, ...(e || {}) } });

  const dong = [];
  const them = (n, gt, gh) => dong.push({ n, gt, gh });

  const sp = await w('product');
  const coMa = await prisma.product.count({ where: { tenantId: t.id, barcode: { not: null } } });
  const dsMa = await prisma.product.findMany({ where: { tenantId: t.id, barcode: { not: null } }, select: { barcode: true } });
  const maSai = dsMa.filter((x) => !eanHopLe(x.barcode)).length;

  them('san pham', sp, '>= 3000');
  them('  co ma vach', coMa, `>= ${Math.round(sp * 0.95)}`);
  them('  MA VACH SAI CHU SO', maSai, 'PHAI = 0');
  them('nhan hang', await w('category'), '>= 10');
  them('  co nhom con', await prisma.category.count({ where: { tenantId: t.id, parentId: { not: null } } }), '>= 40');
  them('nha cung cap', await w('vendor'), '>= 40');
  them('kho + cua hang', await w('warehouse'), '>= 9');

  const grn = await w('goodsReceiptNote');
  const jeGrn = await prisma.journalEntry.count({ where: { tenantId: t.id, source: 'PURCHASE' } });
  them('phieu nhap kho', grn, '-');
  them('  but toan phat sinh', jeGrn, 'PHAI = so GRN');

  const don = await w('order');
  const inv = await w('invoice');
  const tt = await w('payment');
  them('don hang', don, '>= 10000');
  them('HOA DON', inv, 'PHAI > 0');
  them('THANH TOAN', tt, 'PHAI > 0');

  them('chuyen kho', await w('stockTransfer'), '>= 300');
  them('kiem ke', await w('cycleCount'), '>= 30');
  them('giao dich loyalty', await w('loyaltyTransaction'), 'PHAI > 0');
  them('cong no', await w('debt'), '> 0');

  // Phân bố khách hàng
  const ks = await prisma.customer.findMany({ where: { tenantId: t.id }, select: { id: true } });
  const idSet = new Set(ks.map((k) => k.id));
  const theoK = new Map();
  const dsOD = await prisma.order.findMany({ where: { tenantId: t.id, customerId: { not: null } }, select: { customerId: true } });
  dsOD.forEach((o) => theoK.set(o.customerId, (theoK.get(o.customerId) || 0) + 1));
  const nhom = { '1-2 lan': 0, '3-15 lan': 0, '16-45 lan': 0, '46+ lan': 0 };
  for (const c of ks) {
    const n = theoK.get(c.id) || 0;
    if (n <= 2) nhom['1-2 lan'] += 1;
    else if (n <= 15) nhom['3-15 lan'] += 1;
    else if (n <= 45) nhom['16-45 lan'] += 1;
    else nhom['46+ lan'] += 1;
  }
  const tongK = ks.length || 1;

  // Mùa vụ
  const theoThang = new Array(12).fill(0);
  const dsOD2 = await prisma.order.findMany({ where: { tenantId: t.id }, select: { orderDate: true } });
  dsOD2.forEach((o) => { theoThang[new Date(o.orderDate).getUTCMonth()] += 1; });

  console.log('\n=== KIỂM CHỨNG BỘ DỮ LIỆU CHUỖI SIÊU THỊ ===\n');
  let sai = 0;
  dong.forEach((r) => {
    const batBuoc = r.gh.includes('PHAI');
    const dat = batBuoc
      ? (r.gh.includes('= 0') ? r.gt === 0 : r.gt > 0)
      : true;
    if (!dat) sai += 1;
    console.log('  ' + (dat ? 'OK  ' : 'SAI ') + r.n.padEnd(26) + String(r.gt).padStart(7) + '   ' + r.gh);
  });

  console.log('\n=== PHAN BO KHACH HANG (theo so don) ===');
  Object.entries(nhom).forEach(([k, v]) => {
    console.log('  ' + k.padEnd(12) + String(v).padStart(6) + '   ' + ((v / tongK) * 100).toFixed(1) + '%');
  });
  console.log('  don/khach TB   ' + (dsOD.length / tongK).toFixed(1));

  console.log('\n=== DON HANG THEO THANG (mua vu) ===');
  const maxT = Math.max(...theoThang);
  const minT = Math.min(...theoThang);
  theoThang.forEach((v, i) => {
    console.log('  T' + String(i + 1).padStart(2) + ' ' + String(v).padStart(6) + '  ' + '#'.repeat(Math.round((v / maxT) * 40)));
  });
  console.log('  thang ' + (theoThang.indexOf(maxT) + 1) + ' cao nhat | thang ' + (theoThang.indexOf(minT) + 1) + ' thap nhat'
    + (theoThang.indexOf(maxT) + 1 === 12 && theoThang.indexOf(minT) + 1 === 2 ? '  <- co mua vu' : '  <- CHUA co mua vu'));

  console.log('\n=== KET LUA: ' + (sai === 0 ? 'TAT CA BAT BUOC DUNG' : sai + ' muc SAI') + ' ===');
  if (sai > 0) process.exitCode = 1;
  await prisma.$disconnect();
}

// ── CHẠY ─────────────────────────────────────────────────────────────────

async function main() {
  if (process.argv.includes('--verify')) return verify();

  const t0 = Date.now();
  console.log('=== SINH DU LIEU CHUOI SIEU THI ===');
  console.log('  nam:', S.NAM, '| seed:', S.SEED, '| cua hang:', S.SO_CUA_HANG);
  console.log('  san pham:', S.SO_SAN_PHAM, '| khach:', S.SO_KHACH, '| PO:', S.SO_PO, '| don:', S.SO_DON);
  console.log('');

  const tenant = await prisma.tenant.findFirst({ where: { slug: S.SLUG } });
  if (!tenant) {
    console.log('KHONG co tenant demo slug=' + S.SLUG + '. Chay: npm run demo:setup truoc');
    process.exitCode = 1;
    return;
  }
  const user = await prisma.user.findFirst({ where: { tenantId: tenant.id }, orderBy: { createdAt: 'asc' } });
  if (!user) { console.log('Tenant khong co user nao de gan nguoi tao'); process.exitCode = 1; return; }

  const tenantId = tenant.id;
  const buoc = (n, ten, fn) => {
    console.log(`\n[${n}/8] ${ten}`);
    const tg = Date.now();
    return Promise.resolve(fn()).then((r) => {
      console.log(`      xong sau ${((Date.now() - tg) / 1000).toFixed(1)}s`);
      return r;
    });
  };

  if (!process.argv.includes('--khong-don')) {
    await donDep(tenantId);
  }

  const danhMuc = await buoc(1, 'Danh muc', () => S.BUOC_DANH_MUC(tenantId));
  const ncc = await buoc(2, 'Nha cung cap', () => S.BUOC_NCC(tenantId));
  const kho = await buoc(3, 'Kho + cua hang', () => S.BUOC_KHO(tenantId));
  const sanPham = await buoc(4, 'San pham', () => S.BUOC_SAN_PHAM(tenantId, danhMuc));
  const khach = await buoc(5, 'Khach hang', () => S.BUOC_KHACH(tenantId));
  const ton = await buoc(6, 'Ton kho mo dau', () => S.BUOC_TON_DAU(tenantId, sanPham, kho));

  const btt = await S.taiKhoan(tenantId);
  const ctx = { tenantId, danhMuc, ncc, kho, sanPham, khach, ton, userId: user.id, btt };

  await buoc(8, 'Vong mua hang + ban hang + van hanh', async () => {
    const tienDaTra = new Map();
    await S.BUOC_MUA_HANG(ctx);
    const ban = await S.BUOC_BAN_HANG(ctx);
    ctx.dsDon = ban.dsDon;
    ctx.tongTheoDon = ban.tongTheoDon;
    ctx.tienDaTra = tienDaTra;
    await S.BUOC_CHUYEN_KHO(ctx);
    await S.BUOC_KIEM_KE(ctx);
    await S.BUOC_LOYALTY(ctx);
    await S.BUOC_CONG_NO(ctx);

    // Bút toán bán hàng: TỔNG HỢP THEO NGÀY — đúng cách POS chốt cuối ngày,
    // không mỗi đơn một bút toán (sẽ là 16.000 bút toán, vô lý với kế toán thật).
    const tk511 = btt.get('511');
    const tk632 = btt.get('632');
    const tk111 = btt.get('111');
    const tk112 = btt.get('112');
    const theoNgay = new Map();
    ban.dsDon.forEach((o) => {
      const k = o.orderDate.toISOString().slice(0, 10);
      if (!theoNgay.has(k)) theoNgay.set(k, { tong: 0, von: 0, ngay: o.orderDate });
      const g = theoNgay.get(k);
      g.tong += ban.tongTheoDon.get(o.id) || 0;
    });
    // Giá vốn ước theo tỉ lệ vốn trên doanh thu (62–78 %).
    const giaVon = (() => {
      const dsSP = sanPham;
      const tongGia = dsSP.reduce((s, p) => s + Number(p.price), 0);
      const tongVon = dsSP.reduce((s, p) => s + Number(p.costPrice), 0);
      return tongGia > 0 ? tongVon / tongGia : 0.7;
    })();
    let jeBan = 0;
    for (const [k, g] of theoNgay) {
      if (tk511 && tk632 && tk111) {
        await S.ghiButToan(btt, 'JEB' + k.replace(/-/g, ''), g.ngay,
          `Bán hàng ngày ${k} (${g.tong.toLocaleString('vi-VN')} đ)`,
          [
            { tk: tk111, no: Number((g.tong * 0.42).toFixed(2)) },
            { tk: tk112, no: Number((g.tong * 0.58).toFixed(2)) },
            { tk: tk511, co: Number(g.tong.toFixed(2)) },
            { tk: tk632, no: Number((g.tong * giaVon).toFixed(2)) },
            { tk: tk111, co: Number((g.tong * giaVon).toFixed(2)) },
          ],
          'ORDER');
        jeBan += 1;
      }
    }
    S.log('but toan ban hang (chot theo ngay):', jeBan);
  });

  console.log('\n=== XONG sau ' + ((Date.now() - t0) / 1000 / 60).toFixed(1) + ' phut ===');
  console.log('Chay kiem chung:  node scripts/seed/supermarket/run.js --verify\n');
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('LOI:', e.message);
  if (e.code === 'P2002') console.error('  => trung khoa duy nhat (barcode/sku/ma). Can doi --seed.');
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
