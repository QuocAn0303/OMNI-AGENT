/**
 * scripts/seed/supermarket/seed.js — Sinh bo du lieu chuoi sieu thi
 *
 * BDNH MODIFIED: chi viet lai cac truong bi loi. Xem day du o specs.
 */

require('dotenv').config();
const prisma = require('../../../src/config/prisma');
const { runWithTenant } = require('../../../src/config/tenantContext');
const { CAY_NGANH, THUONG_HIEU, CONG_TY } = require('./catalog');

const arg = (ten, macDinh) => {
  const i = process.argv.indexOf('--' + ten);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : macDinh;
};
const has = (ten) => process.argv.includes('--' + ten);
const SLUG = 'omni-demo-mo-phong';
const NAM = Number(arg('nam', new Date().getFullYear() - 1));
const SO_CUA_HANG = Number(arg('stores', 10));
const SO_SAN_PHAM = Number(arg('count', 3200));
const SO_KHACH = Number(arg('customers', 5500));
const SO_PO = Number(arg('po', 700));
const SO_DON = Number(arg('orders', 16000));
const SEED = Number(arg('seed', 20261016));

let rngState = SEED >>> 0;
const rnd = () => { rngState = (rngState + 0x6d2b79f5) >>> 0; let t = rngState; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const chon = (a) => a[Math.floor(rnd() * a.length)];
const nguy = (a, b) => Math.floor(a + rnd() * (b - a + 1));
const nhieu = (a, n) => [...a].sort(() => rnd() - 0.5).slice(0, n);
const giua = (a, b) => a + rnd() * (b - a);
const ean13 = (r) => {
  const g = String(r).padStart(12, '0').slice(0, 12);
  const t = [...g].reduce((s, d, i) => s + Number(d) * (i % 2 === 0 ? 1 : 3), 0);
  return g + String((10 - (t % 10)) % 10);
};
const ngay = (y, t, d) => new Date(Date.UTC(y, t, d, 3, 0, 0));
const HO = ['Nguyen','Tran','Le','Pham','Hoang','Huynh','Phan','Vu','Vo','Dang','Bui','Do','Ho','Ngo','Duong','Ly','Cao','Dinh','Mai','Truong'];
const TEN_NAM = ['Van','Huu','Duc','Minh','Quang','Anh','Hoang','Tuan','Thanh','Hung','Dung','Cuong','Khanh','Bao','Long','Nam','Duc'];
const TEN_NU = ['Thi','Thanh','Thu','Lan','Huong','Mai','Ngoc','Ha','Thao','Yen','Dung','Hong','Nhung','Trang','Linh','Thuy','Hanh','Kim','Chau','Quynh'];
const DUONG = ['Nguyen Hue','Le Loi','Hai Ba Trung','Nguyen Trai','Tran Hung Dao','Ly Thuong Kiet','Ho Tung Mau','Phan Chu Trinh','Vo Van Tan','Cach Mang Thang Tam','Dien Bien Phu','Nguyen Thi Minh Khai','Le Thanh Ton','Pasteur'];
const PHUONG = ['1','3','5','7','10','11','13','15','22','Phuong Ben Nghe','Phuong Pham Ngu Lao','Phuong Tan Dinh'];
const tenNguoi = () => {
  const laNu = rnd() < 0.58;
  const ho = chon(HO);
  const ten = chon(laNu ? TEN_NU : TEN_NAM);
  return { ho, ten: `${ho} ${ten}`, laNu };
};

const DUONG_CA = ["Duong Nguyen Hue, Phuong Ben Nghe, TP. Ho Chi Minh",
  "Duong Le Loi, Phuong Ben Nghe, TP. Ho Chi Minh",
  "Duong Hai Ba Trung, Quan 1, TP. Ho Chi Minh",
  "Duong Nguyen Trai, Quan 1, TP. Ho Chi Minh",
  "Duong Tran Hung Dao, Quan 5, TP. Ho Chi Minh",
  "Duong Ly Thuong Kiet, Quan 10, TP. Ho Chi Minh",
  "Duong Phan Chu Trinh, Hoan Kiem, Ha Noi",
  "Duong Ho Tung Mau, Quan 1, TP. Ho Chi Minh"];
const DUONG_PHO = DUONG_CA;

async function nhienLau(ten, duLieu, moc = 800) {
  let tong = 0;
  for (let i = 0; i < duLieu.length; i += moc) {
    const lo = duLieu.slice(i, i + moc);
    const r = await prisma[ten].createMany({ data: lo, skipDuplicates: true });
    tong += r.count;
  }
  return tong;
}
const log = (...a) => console.log('   ' + a.join(' '));

// === 0. Don dep ===
async function donDep(tenantId) {
  const DON = [
    'journalLine','journalEntry','goodsReceiptItem','goodsReceiptNote','purchaseItem','purchaseOrder','rfqQuote','rfqQuotation',
    'replenishmentItem','replenishmentProposal','stockTransferItem','stockTransfer','cycleCountItem','cycleCount',
    'inventoryTransaction','inventoryLot','serialNumber','inventory','billSplit','promotionUsage','orderItemModifier',
    'returnLineItem','orderReturn','invoice','payment','orderItem','order','debtPayment','debt','loyaltyTransaction',
    'stampCard','customerNote','customerTask','storeCreditTransaction','churnAlert','customer',
    'productVariant','product','vendor','warehouse','category',
  ];
  console.log('\n[0] Don dep du lieu cu (theo phu thuoc)');
  let tong = 0;
  for (const bang of DON) {
    if (!prisma[bang]) continue;
    try {
      const r = await prisma[bang].deleteMany({ where: { tenantId } });
      if (r.count) { tong += r.count; console.log('      ' + bang.padEnd(24) + r.count); }
    } catch (e) { /* bang chua co hoac missing tenantId */ }
  }
  console.log('      da xoa ' + tong + ' dong');
}

// === 1. Danh muc ===
async function danhMuc(tenantId) {
  const nhom = CAY_NGANH.map((n) => ({ tenantId, name: n.nhom, description: 'Nhom nganh hang: ' + n.nhom }));
  await prisma.category.createMany({ data: nhom, skipDuplicates: true });
  const nhomDa = await prisma.category.findMany({ where: { tenantId, name: { in: CAY_NGANH.map((n) => n.nhom) } } });
  const theoTen = new Map(nhomDa.map((c) => [c.name, c]));
  const con = [];
  for (const n of CAY_NGANH) {
    const cha = theoTen.get(n.nhom);
    for (const c of n.con) {
      con.push({ tenantId, name: c.ten, parentId: cha.id, description: c.ten + ' (' + n.nhom + ')' });
    }
  }
  await nhienLau('category', con);
  console.log('   danh muc: ' + nhomDa.length + ' nhom + ' + con.length + ' nhom con');
  return prisma.category.findMany({ where: { tenantId } });
}

// === 2. Nha cung cap ===
async function nhaCungCap(tenantId) {
  const ncc = [];
  for (let i = 0; i < 60; i += 1) {
    const sanXuat = i % 4 === 0;
    const ten = sanXuat
      ? 'Cong ty Co phan ' + chon(['Thuc pham', 'Nuoc giai khat', 'Hang tieu dung', 'Nong san']) + ' ' + chon(['Viet Nam', 'Ha Noi', 'Sai Gon', 'Dong Nai', 'Binh Duong'])
      : 'Cong ty TNHH Thuong mai ' + chon(['Phuong Nam', 'Dai Phat', 'Tan Tien', 'Hoang Gia', 'An Phu', 'Thanh Cong', 'Minh Duc', 'Viet Thang', 'Bao Ngoc', 'Kim Long']) + ' ' + nguy(1, 99);
    ncc.push({
      tenantId,
      code: 'NCC-' + String(1000 + i),
      name: ten,
      taxCode: String(nguy(1000000000, 9999999999)),
      phone: '0' + nguy(2, 9) + chon(['28', '24', '86', '96', '70', '91']) + nguy(100, 999) + nguy(100, 999),
      email: 'contact' + (i + 1) + '@sup' + (i % 4 + 1) + '.com.vn',
      address: nguy(1, 400) + ' ' + chon(DUONG) + ', ' + chon(PHUONG) + ', ' + chon(['TP. Ho Chi Minh', 'Ha Noi', 'Da Nang']),
      contactPerson: chon(HO) + ' ' + chon([...TEN_NAM, ...TEN_NU]),
      paymentTerms: chon([0, 30, 45, 60, 15]),
      kraljicCategory: chon(['STRATEGIC', 'LEVERAGE', 'BOTTLENECK', 'ROUTINE', null]),
      vendorGrade: chon(['A', 'B', 'C', 'D', null]),
      otifScore: Number(giua(62, 99).toFixed(1)),
      defectRate: Number(giua(0, 6.5).toFixed(2)),
      profitImpactScore: nguy(20, 99),
      supplyRiskScore: nguy(5, 80),
      isActive: true,
    });
  }
  const n = await nhienLau('vendor', ncc);
  console.log('   nha cung cap: ' + n);
  return prisma.vendor.findMany({ where: { tenantId } });
};

// === 3. Kho ===
async function buocKho(tenantId) {
  const cu = await prisma.warehouse.findMany({ where: { tenantId }, select: { id: true } });
  if (cu.length) await prisma.warehouse.deleteMany({ where: { id: { in: cu.map((w) => w.id) } } });
  const dc = { tenantId, code: 'DC01', name: 'Kho trung tam Cu Chi', address: 'Cu Chi, TP.HCM', isDefault: true, locationType: 'PHYSICAL', isActive: true };
  await prisma.warehouse.create({ data: dc });
  const tra = await prisma.warehouse.findUnique({ where: { code_tenantId: { code: 'DC01', tenantId } } }).catch(() => prisma.warehouse.findFirst({ where: { tenantId, code: 'DC01' } }));
  const names = ['Q1','Q3','Q5','Q7','Binh Thanh','Thu Duc','Q10','Tan Binh','Binh Duong','Dong Nai','Ba Vi','Phu Nhuan'];
  const so = Number(arg('stores', 10));
  const cua = names.slice(0, so).map((q, i) => ({
    tenantId, code: 'CH' + String(i + 1).padStart(2, '0'),
    name: `Cua hang Minh Khai ${q}`,
    address: nguy(1, 500) + ' ' + chon(DUONG) + ', ' + q + ', TP.Ho Chi Minh',
    isDefault: false, locationType: 'PHYSICAL', parentId: tra.id, isActive: true,
  }));
  await nhienLau('warehouse', cua);
  console.log('   kho: 1 DC + ' + cua.length + ' cua hang');
  return prisma.warehouse.findMany({ where: { tenantId } });
}

// === 4. San pham co ma vach ===
const danhMucCon = (danhMuc) => danhMuc.filter((c) => c.parentId);

async function buocSanPham(tenantId, danhMuc, soSanPham) {
  const cu = await prisma.product.findMany({ where: { tenantId }, select: { id: true } });
  if (cu.length) await prisma.product.deleteMany({ where: { id: { in: cu.map((p) => p.id) } } });

  const con = danhMuc.filter((c) => c.parentId);
  const cha = danhMuc.filter((c) => !c.parentId);
  const theoNhom = new Map();
  con.forEach((c) => {
    const k = c.parentId;
    if (!theoNhom.has(k)) theoNhom.set(k, []);
    theoNhom.get(k).push(c);
  });
  const nhomHienTai = CAY_NGANH;

  const thuong = {
    'Thuc pham tuoi': ['Rau', 'Thit', 'Hai san', 'Trung'],
    'Sua & Do uong': ['Vinamilk', 'Moc Chau', 'Nestle', 'TH true', 'C2', 'Tra+'],
    'Thuc pham kho': ['Ajinomoto', 'Masan', 'Chinsu', 'Huong Sen', 'Neptune'],
    'Do an nhanh': ['Vifon', 'Indomie', 'Oishi'],
    'Banh keo': ['Kinh Do', 'Mondelez', 'Nestle'],
    'Do gia dung': ['Sunlight', 'Ariel', 'Vim', 'Cif'],
    'Cham soc ca nhan': ['Dove', 'L'Oréal', 'Clear', 'Hada Labo', 'Nivea'],
    'Me & Be': ['Friso', 'Pampers', 'Johnson’s'],
    'Do uong co con': ['Saigon', 'Tiger', 'Heineken'],
    'Tap hoa': ['Oishi', 'Poca', 'Lá Sen'],
  };
  const dongSanPham = [
    'Sua tuoi', 'Sua dau nanh', 'Sua chua', 'Tra xanh', 'Cafe hoa tan',
    'Dau an', 'Nuoc mam', 'Bun mien', 'Mi goi', 'Banh keo', 'Gao', 'Nuoc rua bat',
    'Bun', 'Pho', 'Gao lutm', 'Dau an', 'Banh trang',
  ];
  const donVi = ['Hộp', 'Chai', 'Gói', 'Hũ', 'Lon', 'Tuýp', 'Cây', 'Túi', 'Can', 'Bao', 'Cái'];

  const sp = [];
  const dungMa = new Set();
  for (let i = 0; sp.length < soSanPham && i < soSanPham * 5; i += 1) {
    const nhom = chon(nhomHienTai);
    const conCuaNhom = nhom.con;
    const cat = conCuaNhom ? chon(conCuaNhom) : null;
    if (!cat) continue;
    const nhomTen = nhom.nhom;
    const thu = chon(thuong[nhomTen] || ['Vinamilk']);
    const dong = chon(thu.dong || ['Sản phẩm']);
    const dv = chon(thu.donVi || ['hộp']);
    const kh = chon(thu.kho || [250, 500]);
    const conPhu = chon(['', ' Hương hoa quả', ' Không đường', ' Ít ngọt', ' Vị chanh', ' Loại 1', ' Loại 2']);
    const ten = (thuong[nhomTen] ? `${dong} ${thu.ten}${conPhu} ${kh}${dv}` : `${dong} ${ thu.ten } ${kh}${dv}`).trim();
    const coMa = rnd() < 0.97;
    let barcode = null;
    if (coMa) {
      const dau = '893' + String(nguy(1000000000, 9999999999)).slice(0, 9);
      barcode = ean13(dau);
      if (dungMa.has(barcode)) continue;
      dungMa.add(barcode);
    }
    const coMaGia = nhomChe[nhomChe[nhom.nhom] ? nhomTen : nhomTen] || [20000, 120000];
    const giu = nhomChe || {};
    const giaCau = (CAY_NGANH.find((n) => n.nhom === nhomTen)?.con?.find((c) => c.ten === cat.ten)?.gia) || [15000, 80000];
    const gia = Math.round((giaCau[0] + rnd() * (giaCau[1] - giaCau[0])) / 100) * 100;
    const von = Math.round(gia * giua(0.62, 0.78));
    sp.push({
      tenantId,
      sku: 'SP' + String(1000 + sp.length + 1).padStart(6, '0'),
      name: ten,
      price: gia,
      costPrice: von,
      unit: dv,
      barcode,
      categoryId: cat.id,
      isActive: true,
      shelfLifeDays: cat.khan ? cat.ha : null,
      trackByLot: !!cat.khan,
      trackBySerial: false,
    });
  }
  const n = await nhienLau('product', sp);
  console.log('   san pham:', n, '| co ma vach:', sp.filter((x) => x.barcode).length, '(' + ((sp.filter((x) => x.barcode).length / sp.length) * 100).toFixed(1) + '%)');
  return prisma.product.findMany({ where: { tenantId } });
}

// === 5. Khach hang ===
async function buocKhach(tenantId) {
  const cu = await prisma.customer.findMany({ where: { tenantId }, select: { id: true } });
  if (cu.length) await prisma.customer.deleteMany({ where: { id: { in: cu.map((c) => c.id) } } });

  const phan = [
    { ten: 'Ban le thuong', tyLe: 0.55, dMin: 1, dMax: 2, diem: 1, badge: 'BRONZE' },
    { ten: 'Thanh vien bac', tyLe: 0.25, dMin: 6, dMax: 15, diem: 1.5, badge: 'SILVER' },
    { ten: 'Thanh vien vang', tyLe: 0.15, dMin: 20, dMax: 45, diem: 2, badge: 'GOLD' },
    { ten: 'Thanh vien kim cuong', tyLe: 0.05, dMin: 60, dMax: 150, diem: 3, badge: 'PLATINUM' },
  ];
  const khach = [];
  let i = 0;
  for (const pk of phan) {
    for (let k = 0; k < Math.round(SO_KHACH * pk.tyLe); k += 1) {
      i += 1;
      const n = tenNguoi();
      const ten = `${n.ho.toLowerCase().replace(/[^a-z]/g, '') || 'kh'}${nguy(1, 9)}${i}`;
      khach.push({
        tenantId,
        name: n.ten,
        email: ten + '@gmail.com',
        phone: '09' + nguy(0, 9) + nguy(1000000, 9999999),
        address: nguy(1, 400) + ' ' + chon(DUONG) + ', ' + chon(['TP. Ho Chi Minh', 'Ha Noi', 'Da Nang']),
        totalSpent: 0,
        totalDebt: 0,
        creditLimit: pk.dMax * 200000,
        tier: pk.badge,
        loyaltyPoints: 0,
        isActive: true,
        _pk: pk,
        _soDon: nguy(pk.dMin, pk.dMax),
      });
    }
  }
  const ghi = khach.map(({ _pk, _soDon, ...r }) => r);
  const n = await nhienLau('customer', ghi);
  console.log('   khach hang: ' + n + ' | ' + phan.map((p) => p.ten + ' ' + Math.round(p.tyLe * 100) + '%').join(', '));
  const daTao = await prisma.customer.findMany({ where: { tenantId } });
  return daTao.map((c, idx) => Object.assign(c, { _phanKhuc: khach[idx]._pk, _soDon: khach[idx]._soDon }));
};

// === 6. Ton dau ===
async function buocTon(tenantId, sanPham, kho) {
  const cu = await prisma.inventory.findMany({ where: { tenantId }, select: { id: true } });
  if (cu.length) await prisma.inventory.deleteMany({ where: { id: { in: cu.map((i) => i.id) } } });
  const ton = [];
  for (const sp of sanPham) {
    for (const k of kho) {
      const base = k.code === 'DC01' ? nguy(60, 600) : nguy(4, 45);
      const so = Math.max(0, base + nguy(-8, 8));
      if (so === 0) continue;
      ton.push({
        tenantId,
        productId: sp.id,
        warehouseId: k.id,
        quantity: so,
        minStock: k.code === 'DC01' ? nguy(80, 200) : nguy(8, 30),
        maxStock: k.code === 'DC01' ? 900 : 80,
        leadTimeDays: nguy(3, 7),
      });
    }
  }
  const n = await nhienLau('inventory', ton);
  console.log('   ton kho mo dau: ' + n + ' bang giua ' + sanPham.length + ' mua x ' + kho.length + ' kho');
  return prisma.inventory.findMany({ where: { tenantId } });
}

// === 7. Mua hang ===
async function buocMua(ctx) {
  const { tenantId, ncc, sanPham, kho, userId, btt } = ctx;
  const dc = kho.find((k) => k.code === 'DC01');
  const cua = kho.filter((k) => k.code !== 'DC01');
  // PO
  const po = [];
  for (let i = 0; i < SO_PO; i += 1) {
    const v = chon(ncc);
    po.push({
      tenantId,
      poCode: 'PO' + String(NAM) + String(i + 1).padStart(5, '0'),
      vendorId: v.id,
      createdById: userId,
      date: ngay(NAM, nguy(0, 11), nguy(1, 28)),
      expectedAt: ngay(NAM, nguy(0, 11), nguy(1, 28)),
      status: 'RECEIVED',
      paymentStatus: 'UNPAID',
      subtotal: 0,
      taxAmount: 0,
      total: 0,
      paidAmount: 0,
      note: null,
    });
  }
  await nhienLau('purchaseOrder', po);
  const dsPO = await prisma.purchaseOrder.findMany({ where: { tenantId }, orderBy: { date: 'asc' } });
  console.log('   don mua hang: ' + dsPO.length + ' PO');
  // Purchase items
  const dong = [];
  for (const p of dsPO) {
    for (const sp of nhieu(sanPham, nguy(4, 14))) {
      const so = nguy(20, 400);
      dong.push({
        tenantId,
        purchaseOrderId: p.id,
        productId: sp.id,
        quantity: so,
        unitCost: sp.costPrice,
        taxAmount: 0,
        subtotal: Number((Number(sp.costPrice) * so).toFixed(2)),
      });
    }
  }
  await nhienLau('purchaseItem', dong);
  const dsDong = await prisma.purchaseItem.findMany({ where: { tenantId } });
  // GRN
  const grn = [];
  dsPO.forEach((p, idx) => {
    const lan = rnd() < 0.75 ? 1 : 2;
    for (let k = 0; k < lan; k += 1) {
      grn.push({
        tenantId,
        grnCode: 'GRN' + String(NAM) + String(idx + 1).padStart(5, '0') + (k ? 'B' : ''),
        purchaseOrderId: p.id,
        warehouseId: dc.id,
        createdById: userId,
        receivedAt: new Date(new Date(p.date).getTime() + nguy(2, 10) * 86400000),
        status: 'POSTED',
      });
    }
  });
  await nhienLau('goodsReceiptNote', grn);
  const dsGRN = await prisma.goodsReceiptNote.findMany({ where: { tenantId }, include: { items: true } });
  console.log('   phieu nhap kho (GRN): ' + dsGRN.length);
  let btToan = 0;
  for (const g of dsGRN) {
    const dongGRN = g.items.length ? g.items : dsDong.filter((d) => d.purchaseOrderId === g.purchaseOrderId);
    await nhienLau('goodsReceiptItem', dongGRN.map((d) => ({
      tenantId, grnId: g.id, productId: d.productId, purchaseItemId: d.id,
      receivedQty: d.receivedQty || d.quantity, passQty: d.receivedQty || d.quantity, rejectQty: 0,
    })));
    const tong = dongGRN.reduce((s, d) => s + Number(d.unitCost ? d.unitCost : 0) * (d.receivedQty || d.quantity), 0);
    const tk156 = btt.get('156');
    const tk331 = btt.get('331');
    const tk1331 = btt.get('1331');
    if (tk156 && tk331 && tk1331) {
      await ghiButToan(btt, 'JE' + g.grnCode, g.receivedAt,
        'Nh?p h?ng ' + g.grnCode,
        [
          { tk: tk156, no: Number(tong.toFixed(2)) },
          { tk: tk1331, no: Number(tong.toFixed(2)) },
          { tk: tk331, co: Number(tong.toFixed(2)) },
        ],
        'PURCHASE');
      btToan += 1;
    }
  }
  console.log('   but toan phat sinh tu nhap kho:', btToan);
  return { dsPO, dsDong, dsGRN };
};

// === 8. Bán hàng ===
async function buocBanHang(ctx) {
  const { tenantId, sanPham, kho, khach, userId } = ctx;
  const cuaHang = kho.filter((k) => k.code !== 'DC01');
  const tonTheoCua = new Map();
  for (const iv of (ctx.ton || [])) {
    if (!tonTheoCua.has(iv.warehouseId)) tonTheoCua.set(iv.warehouseId, []);
    tonTheoCua.get(iv.warehouseId).push(iv);
  }
  const don = [];
  for (let i = 0; i < SO_DON; i += 1) {
    const t = i % 12;
    const c = chon(cuaHang);
    const k = khach[nguy(0, khach.length - 1)];
    const d = ngay(NAM, t, nguy(1, 28));
    const gio = rnd() < 0.45 ? nguy(11, 13) : rnd() < 0.6 ? nguy(17, 19) : nguy(7, 21);
    don.push({
      tenantId,
      orderCode: 'HD' + String(NAM) + String(i + 1).padStart(7, '0'),
      customerId: rnd() < 0.62 && k ? k.id : null,
      warehouseId: c.id,
      createdById: userId,
      createdAt: new Date(d.getTime() + gio * 3600000),
      status: 'COMPLETED',
      orderType: 'TAKEAWAY',
      paymentMethod: chon(['CASH', 'CARD', 'MOMO', 'VNPAY', 'BANK_TRANSFER', 'VIETQR']),
      paymentStatus: rnd() < 0.94 ? 'PAID' : 'PARTIAL',
      subtotal: 0,
      discount: 0,
      total: 0,
      channel: 'POS',
    });
  }
  await nhienLau('order', don);
  const dsDon = await prisma.order.findMany({ where: { tenantId }, orderBy: { createdAt: 'asc' } });
  console.log('   don hang:', dsDon.length, '| trung binh/ngay:', Math.round(dsDon.length / 365));

  const dong = [];
  for (const o of dsDon) {
    const soDong = rnd() < 0.45 ? nguy(1, 3) : rnd() < 0.8 ? nguy(4, 9) : nguy(10, 22);
    const ds = tonTheoCua.get(o.warehouseId) || [];
    const chonSP = ds.length ? nhieu(ds, Math.min(soDong, ds.length)) : [];
    for (const iv of chonSP) {
      const sp = sanPham.find((s) => s.id === iv.productId);
      if (!sp) continue;
      const so = nguy(1, 4);
      const dg = Number(sp.price);
      dong.push({ tenantId, orderId: o.id, productId: sp.id, quantity: so, price: dg, subtotal: Number((dg * so).toFixed(2)), discountAmount: 0 });
    }
  }
  await nhienLau('orderItem', dong);
  const dsDong = await prisma.orderItem.findMany({ where: { tenantId } });
  console.log('   dong hang ban:', dsDong.length);

  const tongTheoDon = new Map();
  for (const d of dsDong) tongTheoDon.set(d.orderId, (tongTheoDon.get(d.orderId) || 0) + Number(d.subtotal));
  for (let i = 0; i < dsDon.length; i += 500) {
    const lo = dsDon.slice(i, i + 500);
    await Promise.all(lo.map((o) => prisma.order.update({
      where: { id: o.id },
      data: { subtotal: Number((tongTheoDon.get(o.id) || 0).toFixed(2)), total: Number((tongTheoDon.get(o.id) || 0).toFixed(2)) },
    })));
  }
  const hoaDon = dsDon.map((o, i) => ({ tenantId, invoiceCode: 'HD' + String(NAM) + String(i + 1).padStart(7, '0'), orderId: o.id, createdAt: o.createdAt }));
  const nHD = await nhienLau('invoice', hoaDon);
  console.log('   hoa don:', nHD);
  const tt = [];
  dsDon.forEach((o, i) => {
    const tong = tongTheoDon.get(o.id) || 0;
    if (tong <= 0) return;
    const tru = rnd() < 0.88;
    tt.push({ tenantId, orderId: o.id, amount: Number((tru ? tong : tong * giua(0.3, 0.7)).toFixed(2)), method: chon(['CASH','CARD','MOMO','VNPAY','BANK_TRANSFER','VIETQR']), createdById: userId, createdAt: o.createdAt, reference: 'PT' + String(NAM) + String(i+1).padStart(7,'0') });
  });
  const nTT = await nhienLau('payment', tt);
  console.log('   thanh toan:', nTT);
  return { dsDon, dsDong, tongTheoDon, hoaDon };
};

// === 9. Chuyen kho ===
async function buocChuyenKho(ctx) {
  const { tenantId, sanPham, kho, userId } = ctx;
  const dc = kho.find((k) => k.code === 'DC01');
  const cua = kho.filter((k) => k.code !== 'DC01');
  const chuyen = [];
  for (let i = 0; i < 240; i += 1) {
    chuyen.push({ tenantId, transferCode: 'CK' + String(NAM) + String(i + 1).padStart(5, '0'), fromWarehouseId: dc.id, toWarehouseId: chon(cua).id, createdById: userId, status: 'COMPLETED', note: 'Bo sung ton kho cua hang' });
  }
  await nhienLau('stockTransfer', chuyen);
  const ds = await prisma.stockTransfer.findMany({ where: { tenantId } });
  const dong = [];
  for (const c of ds) {
    for (const iv of nhieu(ctx.ton.filter((t) => t.warehouseId === c.fromWarehouseId), nguy(3, 14))) {
      dong.push({ tenantId, transferId: c.id, productId: iv.productId, quantity: nguy(5, 60) });
    }
  }
  const n = await nhienLau('stockTransferItem', dong);
  console.log('   chuyen kho:', ds.length, 'phieu |', n, 'dong hang');
  return ds;
};

// === 10. Kiem ke ===
async function buocKiemKe(ctx) {
  const { tenantId, userId } = ctx;
  const kiem = [];
  for (let i = 0; i < 40; i += 1) {
    kiem.push({ tenantId, code: 'KK' + String(NAM) + String(i + 1).padStart(4, '0'), warehouseId: chon(ctx.kho).id, createdById: userId, status: 'COMPLETED', completedAt: ngay(NAM, nguy(0, 11), nguy(1, 28)), note: null });
  }
  await nhienLau('cycleCount', kiem);
  const ds = await prisma.cycleCount.findMany({ where: { tenantId } });
  const dong = [];
  for (const k of ds) {
    for (const iv of nhieu(ctx.ton.filter((t) => t.warehouseId === k.warehouseId), nguy(10, 40))) {
      const lech = rnd() < 0.22 ? nguy(-4, 4) : 0;
      dong.push({ tenantId, cycleCountId: k.id, productId: iv.productId, warehouseId: k.warehouseId, systemQuantity: iv.quantity, actualQuantity: Math.max(0, iv.quantity + lech), variance: lech });
    }
  }
  const n = await nhienLau('cycleCountItem', dong);
  const lech = dong.filter((d) => d.variance !== 0).length;
  console.log('   kiem ke:', ds.length, 'phieu |', n, 'dong |', lech, 'dong co lech');
  return ds;
};

// === 11. Loyalty + cong no ===
async function buocPhu(ctx) {
  const { tenantId, khach, dsDon, tongTheoDon } = ctx;
  // Loyalty
  const tx = [];
  dsDon.forEach((o) => {
    if (!o.customerId) return;
    const k = khach.find((x) => x.id === o.customerId);
    if (!k || !k._phanKhuc) return;
    const diem = Math.round((tongTheoDon.get(o.id) || 0) / 10000 * k._phanKhuc.tiLeDiem);
    if (diem === 0) return;
    tx.push({ tenantId, customerId: o.customerId, orderId: o.id, points: diem, type: 'EARN' });
  });
  const n = await nhienLau('loyaltyTransaction', tx);
  console.log('   giao dich loyalty:', n);

  // Cong no: chi don du nguong trong that tien
  const congNo = [];
  dsDon.forEach((o) => {
    const tong = tongTheoDon.get(o.id) || 0;
    if (!o.customerId || tong < 150000) return;
    if (Math.random() < 0.85) return; // 85% tra ngay
    const con = Math.round(tong * giua(0.3, 1.0));
    congNo.push({ tenantId, customerId: o.customerId, type: 'RECEIVABLE', amount: con, paidAmount: 0, status: 'OPEN', dueDate: new Date(new Date(o.createdAt).getTime() + 30 * 86400000), note: 'Cong no don ' + o.orderCode });
  });
  const cn = await nhienLau('debt', congNo);
  console.log('   cong no phai thu: ' + cn);
};

// === EXPORT ===
module.exports = {
  BUOC_DANH_MUC, BUOC_NCC, BUOC_KHO, BUOC_SAN_PHAM, BUOC_KHACH, BUOC_TON_DAU,
  BUOC_MUA_HANG, BUOC_BAN_HANG, BUOC_CHUYEN_KHO, BUOC_KIEM_KE, BUOC_PHU,
  buocPhu, taiKhoan, ghiButToan, HE_SO_THANG,
  ean13, rnd, nguy, giua, chon, nhieu, nhienLau, log, ngay, NAM, SLUG,
  SO_CUA_HANG, SO_SAN_PHAM, SO_KHACH, SO_PO, SO_DON, SEED, PHAN_KHUC,
  tenNguoi, DUONG, DUONG_CA, PHUONG, CONG_TY,
};
