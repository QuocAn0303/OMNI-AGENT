/**
 * prisma/seed_accounting_demo.js — Seed dữ liệu kế toán demo chi tiết
 *
 * Tổng quan:
 - Tạo dữ liệu kế toán demo đầy đủ: kỳ kế toán (fiscal periods), nhà cung cấp (vendors),
 *   vốn góp ban đầu (500M VND), chi phí mẫu 60 ngày, đơn mua hàng (PO), thanh toán đơn hàng
 *   + bút toán (journal entries), bảng lương + hạch toán, thanh toán công nợ, thông báo kế toán
 * - Chạy SAU: seed.js → seed_accounting.js → spread_orders.js
 * - Tự động gọi autopost service để tạo journal entries cho mỗi giao dịch
 * - Sử dụng Prisma transaction cho các thao tác phức tạp (tạo PO, công nợ)
 *
 * Hàm:
 * - ensureDefaultWarehouse(): Lấy hoặc tạo warehouse mặc định nếu chưa có
 * - seedFiscalPeriods(): Tạo 12 kỳ kế toán năm hiện tại + 3 tháng cuối năm trước (OPEN)
 * - seedVendors(): Upsert 6 nhà cung cấp mẫu (nguyên liệu, sáp nến, bao bì, vận chuyển...)
 * - seedCapital(admin, autopost): Ghi nhận vốn góp 500M VND + cập nhật tài khoản ngân hàng
 * - seedExpenses(admin, vendors, autopost): Tạo chi phí mẫu hàng tháng + ngẫu nhiên trong 60 ngày,
 *   tự động post journal nếu đã thanh toán. Có kiểm tra và bỏ qua nếu đã tồn tại
 * - receivePoItems(po, items, warehouse, admin): Nhập kho các item từ PO, tạo inventory transaction
 * - seedPurchaseOrders(admin, vendors, autopost, warehouse): Tạo 8 PO mẫu với các trạng thái
 *   thanh toán khác nhau (đã trả, trả 1 phần, chưa trả), tự động post journal + công nợ
 * - seedOrderPaymentsAndJournals(admin, autopost): Tạo thanh toán cho đơn hàng COMPLETED chưa có
 *   journal, post journal doanh thu, tạo công nợ phải thu nếu chưa thanh toán đủ
 * - seedPayrollJournals(admin, autopost): Tính lương 3 tháng gần nhất cho employees,
 *   tạo payroll + journal entries qua autopost
 * - seedDebtPayments(admin, autopost): Tạo 3 phiếu thanh toán công nợ mẫu (trả 1 phần),
 *   cập nhật số dư customer/vendor + post journal
 * - seedAccountingNotifications(admin): Tạo thông báo kế toán (chi phí chờ duyệt, công nợ, đóng sổ)
 * - main(): Hàm chính — kiểm tra preconditions, chạy tuần tự các seed functions, in summary
 */
// prisma/seed_accounting_demo.js
// Seed demo kế toán: vendors, chi phí, PO, bút toán, công nợ, lương, kỳ kế toán.
// Chạy SAU: seed.js → seed_accounting.js → spread_orders.js
require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { Pool } = require("pg");
const { calculatePayroll } = require("../src/modules/hr/payroll.calc");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

let _tenantId = null;
const rndInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

const daysAgo = (days) => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(rndInt(8, 18), rndInt(0, 59), 0, 0);
  return d;
};

const dateCode = (date) => date.toISOString().slice(0, 10).replace(/-/g, "");

async function ensureDefaultWarehouse() {
  let wh = await prisma.warehouse.findFirst({ where: { isDefault: true } });
  if (!wh) {
    wh = await prisma.warehouse.create({
      data: { code: "WH-DEFAULT", name: "Kho mặc định", isDefault: true, tenantId: _tenantId },
    });
  }
  return wh;
}

async function seedFiscalPeriods() {
  console.log("→ Seeding fiscal periods...");
  const year = new Date().getFullYear();
  let count = 0;
  for (let m = 1; m <= 12; m++) {
    const startDate = new Date(year, m - 1, 1);
    const endDate = new Date(year, m, 0, 23, 59, 59, 999);
    await prisma.fiscalPeriod.upsert({
      where: { tenantId_year_month: { tenantId: _tenantId, year, month: m } },
      update: { status: "OPEN", startDate, endDate },
      create: { year, month: m, startDate, endDate, status: "OPEN", tenantId: _tenantId },
    });
    count++;
  }
  // Tháng cuối năm trước (cho dữ liệu 60 ngày trải qua T12)
  const prevYear = year - 1;
  for (let m = 10; m <= 12; m++) {
    const startDate = new Date(prevYear, m - 1, 1);
    const endDate = new Date(prevYear, m, 0, 23, 59, 59, 999);
    await prisma.fiscalPeriod.upsert({
      where: { tenantId_year_month: { tenantId: _tenantId, year: prevYear, month: m } },
      update: { status: "OPEN", startDate, endDate },
      create: { year: prevYear, month: m, startDate, endDate, status: "OPEN", tenantId: _tenantId },
    });
    count++;
  }
  console.log(`  ✅ ${count} fiscal periods (OPEN)`);
}

async function seedVendors() {
  console.log("→ Creating vendors...");
  const vendorData = [
    {
      code: "NCC-001",
      name: "Công ty TNHH Nguyên liệu Hương Liệu",
      taxCode: "0312345678",
      phone: "0901234567",
      email: "sales@huonglieu.vn",
      address: "12 Nguyễn Văn Linh, Q.7, TP.HCM",
      contactPerson: "Nguyễn Thị Lan",
      paymentTerms: 30,
    },
    {
      code: "NCC-002",
      name: "Cơ sở Sáp nến Việt Hưng",
      taxCode: "0398765432",
      phone: "0907654321",
      email: "vihung@gmail.com",
      address: "45 Lê Văn Sỹ, Q.3, TP.HCM",
      paymentTerms: 15,
    },
    {
      code: "NCC-003",
      name: "Bao bì Đại Phát",
      phone: "0902223333",
      address: "88 Cách Mạng Tháng 8, Q.10, TP.HCM",
      paymentTerms: 30,
    },
    {
      code: "NCC-004",
      name: "Dịch vụ vận chuyển GHN",
      taxCode: "0309090909",
      phone: "1900636677",
      email: "b2b@ghn.vn",
      paymentTerms: 7,
    },
    {
      code: "NCC-005",
      name: "Chủ nhà thuê mặt bằng Q1",
      phone: "0911111111",
      address: "120 Nguyễn Huệ, Q.1, TP.HCM",
      paymentTerms: 0,
    },
    {
      code: "NCC-006",
      name: "Công ty In ấn Minh Long",
      taxCode: "0311223344",
      phone: "02838222222",
      email: "minhlong@print.vn",
      paymentTerms: 30,
    },
  ];
  const vendors = [];
  for (const v of vendorData) {
    const row = await prisma.vendor.upsert({
      where: { code: v.code },
      update: { name: v.name, phone: v.phone, email: v.email, address: v.address },
      create: { ...v, tenantId: _tenantId },
    });
    vendors.push(row);
  }
  console.log(`  ✅ ${vendors.length} vendors`);
  return vendors;
}

async function seedCapital(admin, autopost) {
  console.log("→ Recording initial capital contribution...");
  const existing = await prisma.journalEntry.findFirst({
    where: { description: { contains: "Góp vốn" } },
  });
  if (existing) {
    console.log("  ⏭  Already has capital entry");
    return;
  }
  await autopost.postCapitalContribution({
    amount: 500000000,
    method: "BANK_TRANSFER",
    description: "Góp vốn chủ sở hữu - khởi nghiệp",
    userId: admin.id,
  });
  const bank = await prisma.bankAccount.findFirst({ where: { isDefault: true } });
  if (bank) {
    await prisma.bankAccount.update({
      where: { id: bank.id },
      data: { currentBalance: { increment: 500000000 }, openingBalance: "500000000" },
    });
    await prisma.bankTransaction.create({
      data: {
        bankAccountId: bank.id,
        date: daysAgo(60),
        type: "DEPOSIT",
        amount: 500000000,
        balanceAfter: 500000000,
        reference: "CAP-INIT-500M",
        description: "Góp vốn chủ sở hữu - khởi nghiệp",
        createdById: admin.id,
        tenantId: _tenantId,
      },
    });
  }
  console.log("  ✅ Capital 500M VND posted");
}

async function seedExpenses(admin, vendors, autopost) {
  console.log("→ Creating sample expenses...");
  const existing = await prisma.expense.count({
    where: { expenseCode: { startsWith: "EXP-DEMO-" } },
  });
  if (existing >= 15) {
    console.log(`  ⏭  ${existing} demo expenses already exist`);
    return existing;
  }

  const categories = await prisma.expenseCategory.findMany();
  const catByCode = new Map(categories.map((c) => [c.code, c]));
  const taxRates = await prisma.taxRate.findMany();
  const vat10 = taxRates.find((t) => t.code === "VAT10");
  const bank = await prisma.bankAccount.findFirst({ where: { isDefault: true } });

  const templates = [
    { catCode: "RENT", desc: "Thuê mặt bằng tháng", amount: 15000000, vendor: "NCC-005", monthly: true, status: "PAID" },
    { catCode: "UTILITIES", desc: "Tiền điện - nước - internet", amount: () => rndInt(1500, 3500) * 1000, monthly: true, status: "PAID" },
    { catCode: "SALARY", desc: "Lương nhân viên tháng", amount: () => rndInt(25000, 45000) * 1000, monthly: true, status: "PAID" },
    { catCode: "MARKETING", desc: "Chạy quảng cáo Facebook", amount: () => rndInt(2000, 8000) * 1000, monthly: false, status: "PAID" },
    { catCode: "MARKETING", desc: "Influencer review sản phẩm", amount: () => rndInt(3000, 15000) * 1000, monthly: false, status: "PAID" },
    { catCode: "SHIPPING", desc: "Phí vận chuyển GHN", amount: () => rndInt(500, 2000) * 1000, vendor: "NCC-004", monthly: false, status: "PAID" },
    { catCode: "OFFICE", desc: "Văn phòng phẩm", amount: () => rndInt(200, 800) * 1000, monthly: false, status: "PAID" },
    { catCode: "BANK_FEE", desc: "Phí dịch vụ ngân hàng", amount: () => rndInt(50, 300) * 1000, monthly: false, status: "PAID" },
    { catCode: "TRAVEL", desc: "Đi gặp đối tác", amount: () => rndInt(500, 2000) * 1000, monthly: false, status: "PAID" },
    { catCode: "REPAIR", desc: "Sửa chữa thiết bị", amount: () => rndInt(300, 1500) * 1000, monthly: false, status: "APPROVED" },
    { catCode: "MARKETING", desc: "Quảng cáo Google Ads", amount: () => rndInt(3000, 6000) * 1000, monthly: false, status: "PENDING_APPROVAL" },
  ];

  let expenseCount = 0;
  const now = new Date();

  for (let day = 60; day >= 0; day--) {
    const date = daysAgo(day);

    if (date.getDate() === 1) {
      for (const tpl of templates.filter((t) => t.monthly)) {
        const cat = catByCode.get(tpl.catCode);
        if (!cat) continue;
        const vendor = tpl.vendor ? vendors.find((v) => v.code === tpl.vendor) : null;
        const amount = typeof tpl.amount === "function" ? tpl.amount() : tpl.amount;
        const taxAmount = vat10 ? Math.round((amount * 10) / 100) : 0;
        const total = amount + taxAmount;
        expenseCount++;
        const code = `EXP-DEMO-${dateCode(date)}-${String(expenseCount).padStart(4, "0")}`;
        const method = pick(["BANK_TRANSFER", "CASH"]);
        const expense = await prisma.expense.create({
          data: {
            expenseCode: code,
            date,
            categoryId: cat.id,
            vendorId: vendor?.id,
            description: `${tpl.desc} ${date.getMonth() + 1}/${date.getFullYear()}`,
            amount,
            taxRateId: vat10?.id,
            taxAmount,
            totalAmount: total,
            paymentMethod: method,
            bankAccountId: method === "BANK_TRANSFER" ? bank?.id : null,
            status: tpl.status,
            paidAt: tpl.status === "PAID" ? date : null,
            createdById: admin.id,
            approvedById: tpl.status !== "PENDING_APPROVAL" ? admin.id : null,
            tenantId: _tenantId,
          },
          include: { category: true, vendor: true },
        });
        if (expense.status === "PAID") {
          await autopost.postExpense({ expense, category: expense.category, vendor: expense.vendor, userId: admin.id });
        }
      }
    }

    if (Math.random() < 0.28) {
      const tpl = pick(templates.filter((t) => !t.monthly));
      const cat = catByCode.get(tpl.catCode);
      if (!cat) continue;
      const vendor = tpl.vendor ? vendors.find((v) => v.code === tpl.vendor) : pick(vendors);
      const amount = typeof tpl.amount === "function" ? tpl.amount() : tpl.amount;
      expenseCount++;
      const code = `EXP-DEMO-${dateCode(date)}-${String(expenseCount).padStart(4, "0")}`;
      const method = pick(["CASH", "BANK_TRANSFER"]);
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
          paymentMethod: method,
          bankAccountId: method === "BANK_TRANSFER" ? bank?.id : null,
          status: tpl.status,
          paidAt: tpl.status === "PAID" ? date : null,
          createdById: admin.id,
          approvedById: tpl.status !== "PENDING_APPROVAL" ? admin.id : null,
          tenantId: _tenantId,
        },
        include: { category: true, vendor: true },
      });
      if (expense.status === "PAID") {
        await autopost.postExpense({ expense, category: expense.category, vendor: expense.vendor, userId: admin.id });
      }
    }
  }
  console.log(`  ✅ ${expenseCount} expenses created`);
  return expenseCount;
}

async function receivePoItems(po, items, warehouse, admin) {
  for (const it of items) {
    const inv = await prisma.inventory.upsert({
      where: { productId_warehouseId: { productId: it.productId, warehouseId: warehouse.id } },
      update: { quantity: { increment: it.quantity } },
      create: { productId: it.productId, warehouseId: warehouse.id, quantity: it.quantity, minStock: 10, tenantId: _tenantId },
    });
    await prisma.inventoryTransaction.create({
      data: {
        type: "IMPORT",
        quantity: it.quantity,
        inventoryId: inv.id,
        createdById: admin.id,
        note: `Nhap hang PO ${po.poCode}`,
        tenantId: _tenantId,
      },
    });
  }
}

async function seedPurchaseOrders(admin, vendors, autopost, warehouse) {
  console.log("→ Creating sample purchase orders...");
  const existing = await prisma.purchaseOrder.count({
    where: { poCode: { startsWith: "PO-DEMO-" } },
  });
  if (existing >= 8) {
    console.log(`  ⏭  ${existing} demo POs already exist`);
    return existing;
  }

  const products = await prisma.product.findMany({ where: { isActive: true }, take: 30 });
  if (!products.length) {
    console.log("  ⚠️  No products found, skipping POs");
    return 0;
  }

  const taxRates = await prisma.taxRate.findMany();
  const vat10 = taxRates.find((t) => t.code === "VAT10");
  const debtSvc = require("../src/modules/debt/debt.service");

  const scenarios = [
    { paidRatio: 1, status: "RECEIVED", paymentStatus: "PAID" },
    { paidRatio: 1, status: "RECEIVED", paymentStatus: "PAID" },
    { paidRatio: 1, status: "RECEIVED", paymentStatus: "PAID" },
    { paidRatio: 0.5, status: "RECEIVED", paymentStatus: "PARTIAL" },
    { paidRatio: 0.3, status: "RECEIVED", paymentStatus: "PARTIAL" },
    { paidRatio: 0, status: "RECEIVED", paymentStatus: "UNPAID" },
    { paidRatio: 0, status: "RECEIVED", paymentStatus: "UNPAID" },
    { paidRatio: 1, status: "RECEIVED", paymentStatus: "PAID" },
  ];

  let poCount = 0;
  const now = new Date();

  for (let r = 0; r < scenarios.length; r++) {
    const sc = scenarios[r];
    const dayOffset = rndInt(3, 58);
    const date = daysAgo(dayOffset);
    const vendor = vendors[r % vendors.length];
    const itemCount = rndInt(3, 6);
    const chosen = new Set();
    while (chosen.size < itemCount) chosen.add(pick(products).id);

    let subtotal = 0;
    const items = [];
    for (const pid of chosen) {
      const prod = products.find((p) => p.id === pid);
      const cost = Math.round(Number(prod.costPrice) * (0.9 + Math.random() * 0.15));
      const qty = rndInt(20, 60);
      const sub = cost * qty;
      subtotal += sub;
      items.push({ productId: pid, quantity: qty, unitCost: cost, subtotal: sub, taxAmount: 0 });
    }
    const taxAmount = Math.round(subtotal * 0.1);
    const total = subtotal + taxAmount;
    const paidAmount = Math.round(total * sc.paidRatio);
    const code = `PO-DEMO-${dateCode(date)}-${String(r + 1).padStart(3, "0")}`;

    const exists = await prisma.purchaseOrder.findUnique({ where: { poCode: code } });
    if (exists) continue;

    const po = await prisma.purchaseOrder.create({
      data: {
        poCode: code,
        date,
        vendorId: vendor.id,
        status: sc.status,
        paymentStatus: sc.paymentStatus,
        subtotal,
        taxAmount,
        total,
        paidAmount,
        receivedAt: date,
      createdById: admin.id,
      approvedById: admin.id,
      tenantId: _tenantId,
      items: { create: items.map((it) => ({ ...it, taxRateId: vat10?.id, tenantId: _tenantId })) },
      },
      include: { vendor: true, items: true },
    });

    await receivePoItems(po, po.items, warehouse, admin);
    await autopost.postPurchaseReceived({ purchaseOrder: po, vendor: po.vendor, userId: admin.id });

    if (paidAmount > 0) {
      await autopost.postPurchasePayment({
        purchaseOrder: po,
        vendor: po.vendor,
        amount: paidAmount,
        method: "BANK_TRANSFER",
        userId: admin.id,
      });
    }

    if (sc.paymentStatus !== "PAID") {
      await prisma.$transaction(async (tx) => {
        await debtSvc.createPayableForPoInTx(tx, { po, userId: admin.id });
      });
    }
    poCount++;
  }
  console.log(`  ✅ ${poCount} purchase orders`);
  return poCount;
}

async function seedOrderPaymentsAndJournals(admin, autopost) {
  console.log("→ Setting up order payments & journals...");
  const debtSvc = require("../src/modules/debt/debt.service");

  const completedOrders = await prisma.order.findMany({
    where: { status: "COMPLETED", total: { gt: 0 } },
    include: { payments: true, items: { include: { product: true } } },
  });

  let paymentsAdded = 0;
  let postedOrders = 0;
  let debtsCreated = 0;

  for (const order of completedOrders) {
    const total = Number(order.total);
    let paid = order.payments.reduce((s, p) => s + Number(p.amount), 0);

    const hasJournal = await prisma.journalEntry.findFirst({
      where: { source: "ORDER", sourceId: order.id },
    });

    const demoPayment = order.payments.find((p) => (p.note || "").includes("demo seed"));
    if (!hasJournal && paid === 0 && total > 0 && !demoPayment) {
      const r = Math.random();
      let payAmount = total;
      let paymentStatus = "PAID";
      if (r < 0.12) {
        payAmount = 0;
        paymentStatus = "UNPAID";
      } else if (r < 0.28) {
        payAmount = Math.round(total * (0.35 + Math.random() * 0.4));
        paymentStatus = "PARTIAL";
      }

      const method = pick(["CASH", "BANK_TRANSFER", "CARD"]);
      if (payAmount > 0) {
        await prisma.payment.create({
          data: {
            orderId: order.id,
            amount: payAmount,
            method,
            note: "Thanh toán đơn hàng (demo seed)",
            createdById: admin.id,
            tenantId: _tenantId,
          },
        });
        paid = payAmount;
        paymentsAdded++;
      }
      await prisma.order.update({
        where: { id: order.id },
        data: { paymentStatus, paymentMethod: method },
      });
      order.paymentStatus = paymentStatus;
      order.payments = payAmount > 0 ? [{ amount: payAmount, method }] : [];
    }

    if (!hasJournal) {
      try {
        await autopost.postOrderCompleted({
          order,
          items: order.items.map((it) => ({ quantity: it.quantity, product: it.product })),
          paidAmount: paid,
          payments: order.payments,
          userId: admin.id,
        });
        postedOrders++;
      } catch (e) {
        console.warn(`  ⚠️  Order ${order.orderCode}: ${e.message}`);
      }
    }

    if (["UNPAID", "PARTIAL"].includes(order.paymentStatus)) {
      const hasDebt = await prisma.debt.findUnique({ where: { orderId: order.id } });
      if (!hasDebt) {
        await prisma.$transaction(async (tx) => {
          await debtSvc.createReceivableForOrderInTx(tx, { order, userId: admin.id });
        });
        debtsCreated++;
      }
    }
  }

  console.log(`  ✅ ${paymentsAdded} payments, ${postedOrders} order journals, ${debtsCreated} receivables`);
}

async function seedPayrollJournals(admin, autopost) {
  console.log("→ Seeding payroll & journals...");
  const employees = await prisma.employee.findMany({
    where: { isActive: true },
    include: { user: true, shifts: true, violations: true },
  });
  if (!employees.length) {
    console.log("  ⚠️  No employees found");
    return;
  }

  const now = new Date();
  let payrollCount = 0;
  let journalCount = 0;

  for (let mOffset = 1; mOffset <= 3; mOffset++) {
    const d = new Date(now.getFullYear(), now.getMonth() - mOffset, 1);
    const month = d.getMonth() + 1;
    const year = d.getFullYear();

    for (const emp of employees) {
      const shiftCount = rndInt(18, 24);
      const calc = calculatePayroll({
        baseSalary: Number(emp.baseSalary),
        shiftCount,
        shiftMoney: Number(emp.shiftMoney),
        violations: emp.violations.filter((v) => {
          const vd = new Date(v.date);
          return vd.getMonth() + 1 === month && vd.getFullYear() === year;
        }),
      });

      let payroll = await prisma.payroll.findFirst({
        where: { employeeId: emp.id, month, year },
      });
      if (!payroll) {
        payroll = await prisma.payroll.create({
          data: {
            employeeId: emp.id,
            month,
            year,
            baseSalary: emp.baseSalary,
            shiftMoney: emp.shiftMoney,
            shiftCount,
            attendanceCoefficient: calc.attendanceCoefficient,
            penalties: calc.penalties,
            finalSalary: calc.finalSalary,
            isLocked: true,
            tenantId: _tenantId,
          },
        });
        payrollCount++;
      }

      const hasJournal = await prisma.journalEntry.findFirst({
        where: { source: "PAYROLL", sourceId: payroll.id },
      });
      if (!hasJournal && Number(payroll.finalSalary) > 0) {
        await autopost.postPayrollAccrual({ payroll, employee: emp, userId: admin.id });
        journalCount++;
      }
    }
  }
  console.log(`  ✅ ${payrollCount} payrolls, ${journalCount} payroll journals`);
}

async function seedDebtPayments(admin, autopost) {
  console.log("→ Seeding sample debt payments...");
  const existingDemo = await prisma.debtPayment.count({
    where: { note: { contains: "demo seed" } },
  });
  if (existingDemo >= 3) {
    console.log(`  ⏭  ${existingDemo} demo debt payments already exist`);
    return;
  }

  const partialDebts = await prisma.debt.findMany({
    where: { status: { in: ["OPEN", "PARTIAL"] }, paidAmount: 0 },
    take: 3,
  });

  let count = 0;
  for (const debt of partialDebts) {
    const payAmount = round2(Number(debt.amount) * (0.2 + Math.random() * 0.3));
    if (payAmount <= 0) continue;

    const payment = await prisma.debtPayment.create({
      data: {
        debtId: debt.id,
        amount: payAmount,
        method: pick(["CASH", "BANK_TRANSFER"]),
        note: "Thanh toán một phần (demo seed)",
        createdById: admin.id,
        paidAt: daysAgo(rndInt(1, 14)),
        tenantId: _tenantId,
      },
    });

    const nextPaid = round2(Number(debt.paidAmount) + payAmount);
    const remaining = round2(Number(debt.amount) - nextPaid);
    const status = remaining <= 0 ? "CLOSED" : "PARTIAL";

    await prisma.debt.update({
      where: { id: debt.id },
      data: { paidAmount: nextPaid, status },
    });

    if (debt.customerId) {
      await prisma.customer.update({
        where: { id: debt.customerId },
        data: { totalDebt: { decrement: payAmount } },
      });
    }
    if (debt.vendorId) {
      await prisma.vendor.update({
        where: { id: debt.vendorId },
        data: { totalDebt: { decrement: payAmount } },
      });
    }

    try {
      await autopost.postDebtPayment({ debt, payment, userId: admin.id });
    } catch (e) {
      console.warn(`  ⚠️  Debt payment journal: ${e.message}`);
    }
    count++;
  }
  console.log(`  ✅ ${count} debt payments`);
}

async function seedAccountingNotifications(admin) {
  const existing = await prisma.notification.count({
    where: { title: "Nhắc đóng sổ kỳ kế toán", userId: admin.id },
  });
  if (existing >= 1) return;

  const pendingExpense = await prisma.expense.findFirst({
    where: { status: "PENDING_APPROVAL" },
  });
  const overdueDebt = await prisma.debt.findFirst({
    where: { status: { in: ["OPEN", "OVERDUE"] } },
  });

  const items = [
    {
      type: "EXPENSE_PENDING_APPROVAL",
      severity: "INFO",
      title: "Chi phí chờ duyệt",
      message: pendingExpense
        ? `${pendingExpense.description} - ${Number(pendingExpense.totalAmount).toLocaleString("vi-VN")}đ`
        : "Có chi phí chờ phê duyệt",
      link: "/expenses",
    },
    {
      type: "DEBT_OVERDUE",
      severity: "WARNING",
      title: "Công nợ cần thu",
      message: overdueDebt
        ? `Công nợ ${Number(overdueDebt.amount).toLocaleString("vi-VN")}đ đang chờ thu`
        : "Kiểm tra công nợ phải thu/trả",
      link: "/debts",
    },
    {
      type: "PERIOD_CLOSING_REMINDER",
      severity: "INFO",
      title: "Nhắc đóng sổ kỳ kế toán",
      message: "Cuối tháng - kiểm tra và đóng sổ kế toán",
      link: "/accounting/fiscal-periods",
    },
  ];

  for (const n of items) {
    await prisma.notification.create({
      data: { ...n, userId: admin.id, roleScope: admin.role, tenantId: _tenantId },
    });
  }
  console.log(`  ✅ ${items.length} accounting notifications`);
}

async function main() {
  console.log("🌱 Seeding accounting demo data...");

  const admin =
    (await prisma.user.findFirst({ where: { role: "ADMIN", isActive: true } })) ||
    (await prisma.user.findFirst());
  if (!admin) {
    console.log("⚠️  No user found. Run seed.js first.");
    return;
  }

  const accountCount = await prisma.account.count();
  if (accountCount === 0) {
    console.log("⚠️  Chart of Accounts empty. Run seed_accounting.js first.");
    return;
  }

  const autopost = require("../src/modules/accounting/autopost.service");
  const tenant = await prisma.tenant.findFirst({ where: { slug: "candory-scent" } });
  _tenantId = tenant?.id || null;
  const warehouse = await ensureDefaultWarehouse();

  await seedFiscalPeriods();
  const vendors = await seedVendors();
  await seedCapital(admin, autopost);
  await seedExpenses(admin, vendors, autopost);
  await seedPurchaseOrders(admin, vendors, autopost, warehouse);
  await seedOrderPaymentsAndJournals(admin, autopost);
  await seedPayrollJournals(admin, autopost);
  await seedDebtPayments(admin, autopost);
  await seedAccountingNotifications(admin);

  // Fix tenantId for records created via autopost/debtSvc (no tenant context)
  await prisma.debt.updateMany({ where: { tenantId: null }, data: { tenantId: _tenantId } });
  await prisma.journalEntry.updateMany({ where: { tenantId: null }, data: { tenantId: _tenantId } });
  await prisma.journalLine.updateMany({ where: { tenantId: null }, data: { tenantId: _tenantId } });

  console.log("\n🎉 Accounting demo seed completed!");
  const stats = {
    journalEntries: await prisma.journalEntry.count(),
    expenses: await prisma.expense.count(),
    purchaseOrders: await prisma.purchaseOrder.count(),
    debts: await prisma.debt.count(),
    payrolls: await prisma.payroll.count(),
    fiscalPeriods: await prisma.fiscalPeriod.count(),
  };
  console.log("📊 Database summary:", stats);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    try {
      await pool.end();
    } catch {}
  });
