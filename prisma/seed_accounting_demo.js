// prisma/seed_accounting_demo.js
// Seed demo cho accounting: vendors, expenses, capital contribution, purchase orders.
// Chạy SAU seed.js + seed_accounting.js
require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { Pool } = require("pg");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const rndInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

async function main() {
  console.log("🌱 Seeding accounting demo data...");

  // Lấy admin user
  const admin = await prisma.user.findFirst({ where: { role: "ADMIN" } });
  if (!admin) {
    console.log("⚠️  No ADMIN user found. Run seed.js first.");
    return;
  }

  // ====== Vendors ======
  console.log("→ Creating vendors...");
  const vendorData = [
    { code: "NCC-001", name: "Công ty TNHH Nguyên liệu Hương Liệu", taxCode: "0312345678", phone: "0901234567", paymentTerms: 30 },
    { code: "NCC-002", name: "Cơ sở Sáp nến Việt Hưng", taxCode: "0398765432", phone: "0907654321", paymentTerms: 15 },
    { code: "NCC-003", name: "Bao bì Đại Phát", phone: "0902223333", paymentTerms: 30 },
    { code: "NCC-004", name: "Dịch vụ vận chuyển GHN", taxCode: "0309090909", phone: "1900636677", paymentTerms: 7 },
    { code: "NCC-005", name: "Chủ nhà thuê mặt bằng Q1", phone: "0911111111", paymentTerms: 0 },
  ];
  const vendors = [];
  for (const v of vendorData) {
    const exists = await prisma.vendor.findUnique({ where: { code: v.code } });
    if (exists) { vendors.push(exists); continue; }
    vendors.push(await prisma.vendor.create({ data: v }));
  }
  console.log(`  ✅ ${vendors.length} vendors`);

  // ====== Capital contribution (góp vốn ban đầu) ======
  console.log("→ Recording initial capital contribution...");
  const autopost = require("../src/modules/accounting/autopost.service");
  const journalSvc = require("../src/modules/accounting/journal.service");

  // Check nếu đã có capital contribution
  const existingCapital = await prisma.journalEntry.findFirst({
    where: { description: { contains: "Góp vốn" } },
  });
  if (!existingCapital) {
    await autopost.postCapitalContribution({
      amount: 500000000, // 500M
      method: "BANK_TRANSFER",
      description: "Góp vốn chủ sở hữu - khởi nghiệp",
      userId: admin.id,
    });
    console.log("  ✅ Capital 500M VND posted");
  } else {
    console.log("  ⏭  Already has capital entry");
  }

  // ====== Expenses (rải đều 60 ngày) ======
  console.log("→ Creating sample expenses...");
  const categories = await prisma.expenseCategory.findMany();
  const catByCode = new Map(categories.map((c) => [c.code, c]));
  const taxRates = await prisma.taxRate.findMany();
  const vat10 = taxRates.find((t) => t.code === "VAT10");

  const expenseTemplates = [
    { catCode: "RENT", desc: "Thuê mặt bằng tháng", amount: 15000000, vendor: "NCC-005", monthly: true },
    { catCode: "UTILITIES", desc: "Tiền điện - nước - internet", amount: () => rndInt(1500, 3500) * 1000, monthly: true },
    { catCode: "MARKETING", desc: "Chạy quảng cáo Facebook", amount: () => rndInt(2000, 8000) * 1000, monthly: false },
    { catCode: "MARKETING", desc: "Influencer review sản phẩm", amount: () => rndInt(3000, 15000) * 1000, monthly: false },
    { catCode: "SHIPPING", desc: "Phí vận chuyển GHN", amount: () => rndInt(500, 2000) * 1000, vendor: "NCC-004", monthly: false },
    { catCode: "OFFICE", desc: "Văn phòng phẩm", amount: () => rndInt(200, 800) * 1000, monthly: false },
    { catCode: "BANK_FEE", desc: "Phí dịch vụ ngân hàng", amount: () => rndInt(50, 300) * 1000, monthly: false },
    { catCode: "TRAVEL", desc: "Đi gặp đối tác", amount: () => rndInt(500, 2000) * 1000, monthly: false },
  ];

  let expenseCount = 0;
  const now = new Date();
  for (let day = 60; day >= 0; day--) {
    const date = new Date(now.getTime() - day * 24 * 60 * 60 * 1000);

    // Mỗi tháng vào ngày 1 - chi phí cố định
    if (date.getDate() === 1) {
      for (const tpl of expenseTemplates.filter((t) => t.monthly)) {
        const cat = catByCode.get(tpl.catCode);
        if (!cat) continue;
        const vendor = tpl.vendor ? vendors.find((v) => v.code === tpl.vendor) : null;
        const amount = typeof tpl.amount === "function" ? tpl.amount() : tpl.amount;
        const taxAmount = vat10 ? Math.round((amount * 10) / 100) : 0;
        const total = amount + taxAmount;
        const code = `EXP-${date.toISOString().slice(0,10).replace(/-/g,"")}-${String(expenseCount+1).padStart(4,"0")}`;
        const expense = await prisma.expense.create({
          data: {
            expenseCode: code,
            date,
            categoryId: cat.id,
            vendorId: vendor?.id,
            description: `${tpl.desc} ${date.getMonth()+1}/${date.getFullYear()}`,
            amount,
            taxRateId: vat10?.id,
            taxAmount,
            totalAmount: total,
            paymentMethod: "BANK_TRANSFER",
            status: "PAID",
            paidAt: date,
            createdById: admin.id,
            approvedById: admin.id,
          },
          include: { category: true, vendor: true },
        });
        await autopost.postExpense({ expense, category: expense.category, vendor: expense.vendor, userId: admin.id });
        expenseCount++;
      }
    }

    // Random ad-hoc expenses (30% chance)
    if (Math.random() < 0.3) {
      const tpl = pick(expenseTemplates.filter((t) => !t.monthly));
      const cat = catByCode.get(tpl.catCode);
      if (!cat) continue;
      const vendor = tpl.vendor ? vendors.find((v) => v.code === tpl.vendor) : pick(vendors);
      const amount = typeof tpl.amount === "function" ? tpl.amount() : tpl.amount;
      const code = `EXP-${date.toISOString().slice(0,10).replace(/-/g,"")}-${String(expenseCount+1).padStart(4,"0")}`;
      const expense = await prisma.expense.create({
        data: {
          expenseCode: code,
          date,
          categoryId: cat.id,
          vendorId: vendor.id,
          description: tpl.desc,
          amount,
          taxAmount: 0,
          totalAmount: amount,
          paymentMethod: pick(["CASH", "BANK_TRANSFER"]),
          status: "PAID",
          paidAt: date,
          createdById: admin.id,
          approvedById: admin.id,
        },
        include: { category: true, vendor: true },
      });
      await autopost.postExpense({ expense, category: expense.category, vendor: expense.vendor, userId: admin.id });
      expenseCount++;
    }
  }
  console.log(`  ✅ ${expenseCount} expenses created`);

  // ====== Purchase Orders (nhập hàng vài lần trong 60 ngày) ======
  console.log("→ Creating sample purchase orders...");
  const products = await prisma.product.findMany({ take: 20 });
  if (products.length > 0) {
    let poCount = 0;
    const poRounds = 4;
    for (let r = 0; r < poRounds; r++) {
      const dayOffset = rndInt(5, 55);
      const date = new Date(now.getTime() - dayOffset * 24 * 60 * 60 * 1000);
      const vendor = vendors[0]; // NCC-001 nguyên liệu
      const itemCount = rndInt(3, 6);
      const chosen = new Set();
      while (chosen.size < itemCount) chosen.add(pick(products).id);

      let subtotal = 0;
      const items = [];
      for (const pid of chosen) {
        const prod = products.find((p) => p.id === pid);
        const cost = Math.round(Number(prod.costPrice) * (0.9 + Math.random() * 0.15));
        const qty = rndInt(20, 50);
        const sub = cost * qty;
        subtotal += sub;
        items.push({ productId: pid, quantity: qty, unitCost: cost, subtotal: sub, taxAmount: 0 });
      }
      const taxAmount = Math.round(subtotal * 0.1);
      const total = subtotal + taxAmount;

      const code = `PO-${date.toISOString().slice(0,10).replace(/-/g,"")}-${String(r+1).padStart(4,"0")}`;
      const po = await prisma.purchaseOrder.create({
        data: {
          poCode: code,
          date,
          vendorId: vendor.id,
          status: "RECEIVED",
          paymentStatus: "PAID",
          subtotal, taxAmount, total, paidAmount: total,
          receivedAt: date,
          createdById: admin.id,
          items: { create: items.map((it) => ({ ...it, taxRateId: vat10?.id })) },
        },
        include: { vendor: true, items: true },
      });

      // Tăng tồn kho
      for (const it of po.items) {
        await prisma.inventory.upsert({
          where: { productId: it.productId },
          update: { quantity: { increment: it.quantity } },
          create: { productId: it.productId, quantity: it.quantity, minStock: 10 },
        });
      }
      // Auto-post: nhập kho + thanh toán
      await autopost.postPurchaseReceived({ purchaseOrder: po, vendor: po.vendor, userId: admin.id });
      await autopost.postPurchasePayment({
        purchaseOrder: po,
        vendor: po.vendor,
        amount: Number(po.total),
        method: "BANK_TRANSFER",
        userId: admin.id,
      });
      poCount++;
    }
    console.log(`  ✅ ${poCount} purchase orders`);
  }

  // ====== Auto-post bút toán cho các đơn hàng đã COMPLETED có sẵn ======
  console.log("→ Auto-posting journals for existing COMPLETED orders...");
  const completedOrders = await prisma.order.findMany({
    where: { status: "COMPLETED" },
    include: { items: { include: { product: true } }, payments: true },
  });
  let postedOrders = 0;
  for (const order of completedOrders) {
    // Skip nếu đã có bút toán
    const existing = await prisma.journalEntry.findFirst({
      where: { source: "ORDER", sourceId: order.id },
    });
    if (existing) continue;
    const paid = order.payments.reduce((s, p) => s + Number(p.amount), 0);
    try {
      await autopost.postOrderCompleted({
        order,
        items: order.items.map((it) => ({ quantity: it.quantity, product: it.product })),
        paidAmount: paid,
        userId: admin.id,
      });
      postedOrders++;
    } catch (e) {
      console.warn(`  ⚠️  Order ${order.orderCode}: ${e.message}`);
    }
  }
  console.log(`  ✅ ${postedOrders} order journals posted`);

  console.log("\n🎉 Accounting demo seed completed!");
  const totalEntries = await prisma.journalEntry.count();
  console.log(`📊 Total journal entries: ${totalEntries}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => {
    await prisma.$disconnect();
    try { await pool.end(); } catch {}
  });
