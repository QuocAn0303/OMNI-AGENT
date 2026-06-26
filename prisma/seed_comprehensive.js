/**
 * prisma/seed_comprehensive.js — Seed dữ liệu toàn diện cho hệ thống ERP
 *
 * Tổng quan:
 * - Tạo dữ liệu mẫu đầy đủ cho mọi module: users (7 tài khoản), categories (7),
 *   products (28 SP), warehouses (3 kho), inventory, customers (20), employees,
 *   shifts, vendors (4), tax rates (4), chart of accounts (16), expense categories (5),
 *   bank accounts (2), fiscal periods (12), expenses (6), purchase orders (10),
 *   orders (20), promotions (4), notifications
 * - Dùng upsert để có thể chạy lại an toàn (idempotent)
 * - Mật khẩu mặc định: Admin@123
 *
 * Hàm:
 * - rndInt(min, max): Random số nguyên trong khoảng [min, max]
 * - pick(arr): Random lấy 1 phần tử từ mảng
 * - main(): Hàm chính — tạo tuần tự tất cả dữ liệu theo các nhóm (users → categories →
 *   products → warehouses → inventory → customers → employees → shifts → vendors →
 *   tax rates → accounts → expense categories → bank accounts → fiscal periods →
 *   expenses → purchase orders → orders → promotions → notifications)
 */
// prisma/seed_comprehensive.js
// Comprehensive seed data for ERP system
require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { Pool } = require("pg");
const bcrypt = require("bcrypt");
const { faker } = require("@faker-js/faker");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const rndInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

async function main() {
  console.log("🌱 Seeding comprehensive data...");

  // ==================== USERS ====================
  const userData = [
    { email: "admin@erp.local",      fullName: "Nguyễn Văn Admin",        role: "ADMIN" },
    { email: "manager1@erp.local",   fullName: "Trần Thị Quản Lý 1",      role: "MANAGER" },
    { email: "manager2@erp.local",   fullName: "Phạm Quốc Quản Lý 2",     role: "MANAGER" },
    { email: "cashier1@erp.local",   fullName: "Hoàng Thu Thu Ngân Quỹ",  role: "CASHIER" },
    { email: "cashier2@erp.local",   fullName: "Võ Minh Kế Toán",         role: "CASHIER" },
    { email: "warehouse@erp.local",  fullName: "Lê Văn Kho",              role: "WAREHOUSE" },
    { email: "warehouse2@erp.local", fullName: "Ngô Thị Lưu Trữ",         role: "WAREHOUSE" },
  ];

  const hashed = await bcrypt.hash("Admin@123", 10);
  let upsertedCount = 0;
  for (const u of userData) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: { fullName: u.fullName, role: u.role },
      create: { ...u, password: hashed },
    });
    upsertedCount++;
  }
  console.log(`✓ Upserted ${upsertedCount} users`);
  const allUsers = await prisma.user.findMany();

  // ==================== CATEGORIES ====================
  const categoryData = [
    { name: "Nước hoa",      description: "Các loại nước hoa nam, nữ" },
    { name: "Xà phòng",      description: "Xà phòng rửa tay, tắm" },
    { name: "Kem dưỡng",     description: "Kem dưỡng da, kem chống nắng" },
    { name: "Dầu gội",       description: "Dầu gội đầu chuyên biệt" },
    { name: "Nước rửa mặt",  description: "Sữa rửa mặt, toner" },
    { name: "Mặt nạ",        description: "Mặt nạ làm sạch, dưỡng ẩm" },
    { name: "Phụ kiện",      description: "Túi xách, bao bì" },
  ];

  for (const c of categoryData) {
    await prisma.category.upsert({
      where: { name: c.name },
      update: { description: c.description },
      create: c,
    });
  }
  console.log(`✓ Upserted ${categoryData.length} categories`);
  const allCategories = await prisma.category.findMany();

  // ==================== PRODUCTS ====================
  const productMap = {
    "Nước hoa":     ["Nước hoa Hoa Anh Đào", "Nước hoa Hương Hoa Hồng", "Nước hoa Mùa Hè Tươi", "Nước hoa Đêm Quyến Rũ"],
    "Xà phòng":     ["Xà phòng Dưỡng Ẩm", "Xà phòng Thiên Nhiên", "Xà phòng Trị Mụn", "Xà phòng Làm Sáng"],
    "Kem dưỡng":    ["Kem Dưỡng Ban Đêm", "Kem Chống Nắng SPF50", "Kem Dưỡng Ẩm Ngày", "Kem Chăm Sóc Mắt"],
    "Dầu gội":      ["Dầu Gội Phục Hồi", "Dầu Gội Giảm Gãy", "Dầu Gội Hương Thiên Nhiên", "Dầu Gội Chuyên Biệt"],
    "Nước rửa mặt": ["Toner Cân Bằng", "Sữa Rửa Mặt Dịu Nhẹ", "Toner Dưỡng Ẩm", "Sữa Rửa Mặt Làm Sáng"],
    "Mặt nạ":       ["Mặt Nạ Giấy Dưỡng Ẩm", "Mặt Nạ Đất Sét", "Mặt Nạ Hàng Tuần", "Mặt Nạ Tức Thì"],
    "Phụ kiện":     ["Túi Xách Quà Tặng", "Hộp Quà Tặng", "Giấy Gói", "Ruy Băng Trang Trí"],
  };

  const productsData = [];
  for (const [catName, names] of Object.entries(productMap)) {
    const category = allCategories.find((c) => c.name === catName);
    if (!category) continue;
    names.forEach((name, idx) => {
      const price = rndInt(50000, 500000);
      productsData.push({
        sku: `COMP-${catName.slice(0, 3).toUpperCase()}-${String(idx + 1).padStart(2, "0")}`,
        name,
        description: `${name} - Chất lượng cao, an toàn cho da`,
        price: price.toString(),
        costPrice: Math.floor(price * 0.4).toString(),
        unit: "cái",
        categoryId: category.id,
      });
    });
  }

  let createdProd = 0;
  for (const p of productsData) {
    await prisma.product.upsert({
      where: { sku: p.sku },
      update: { name: p.name, price: p.price, costPrice: p.costPrice },
      create: p,
    });
    createdProd++;
  }
  console.log(`✓ Upserted ${createdProd} products`);
  const allProducts = await prisma.product.findMany({ where: { isActive: true } });

  // ==================== WAREHOUSES ====================
  const warehouseData = [
    { code: "WH01", name: "Kho Chính - Tân Bình",  address: "123 Đường Lê Văn Lương, Q. Tân Bình", isDefault: true },
    { code: "WH02", name: "Kho Phụ - Quận 1",       address: "456 Đường Nguyễn Huệ, Q.1" },
    { code: "WH03", name: "Kho Quận 3",              address: "789 Đường 3/2, Q.3" },
  ];

  for (const w of warehouseData) {
    await prisma.warehouse.upsert({
      where: { code: w.code },
      update: { name: w.name, address: w.address },
      create: w,
    });
  }
  console.log(`✓ Upserted ${warehouseData.length} warehouses`);
  const allWarehouses = await prisma.warehouse.findMany();

  // ==================== INVENTORY ====================
  let invCreated = 0;
  for (const product of allProducts) {
    for (const warehouse of allWarehouses) {
      try {
        await prisma.inventory.upsert({
          where: { productId_warehouseId: { productId: product.id, warehouseId: warehouse.id } },
          update: {},
          create: { productId: product.id, warehouseId: warehouse.id, quantity: rndInt(10, 150), minStock: 10 },
        });
        invCreated++;
      } catch {
        // skip if unique constraint from old schema
      }
    }
  }
  console.log(`✓ Upserted ${invCreated} inventory records`);

  // ==================== CUSTOMERS ====================
  const customersData = [];
  for (let i = 0; i < 20; i++) {
    customersData.push({
      name: faker.person.fullName(),
      phone: `09${String(rndInt(10000000, 99999999))}`,
      email: faker.internet.email(),
      address: faker.location.streetAddress(),
      tier: pick(["BRONZE", "SILVER", "GOLD", "PLATINUM"]),
      loyaltyPoints: rndInt(0, 5000),
      totalSpent: rndInt(100000, 50000000).toString(),
    });
  }
  const createdCustomers = await prisma.customer.createMany({ data: customersData, skipDuplicates: true });
  console.log(`✓ Created ${createdCustomers.count} customers`);
  const allCustomers = await prisma.customer.findMany();

  // ==================== EMPLOYEES & HR ====================
  const positions = ["Nhân viên bán hàng", "Quản lý kho", "Kế toán", "Quản lý", "Thu ngân"];
  let empCount = 0;
  for (let i = 0; i < allUsers.length; i++) {
    const user = allUsers[i];
    const existing = await prisma.employee.findUnique({ where: { userId: user.id } });
    if (!existing) {
      await prisma.employee.create({
        data: {
          userId: user.id,
          employeeCode: `EMP-${String(2000 + i).padStart(4, "0")}`,
          phone: `09${String(rndInt(10000000, 99999999))}`,
          position: pick(positions),
          hireDate: faker.date.past(),
          baseSalary: rndInt(5000000, 20000000).toString(),
          shiftMoney: rndInt(0, 1500000).toString(),
        },
      });
      empCount++;
    }
  }
  console.log(`✓ Created ${empCount} employees`);
  const allEmployees = await prisma.employee.findMany();

  // ==================== SHIFTS ====================
  let shiftCount = 0;
  const shiftTypes = ["MORNING", "AFTERNOON", "NIGHT"];
  for (const emp of allEmployees.slice(0, 5)) {
    for (let d = 1; d <= 15; d++) {
      const date = new Date(2026, 4, d);
      await prisma.shift.create({
        data: { employeeId: emp.id, date, type: pick(shiftTypes) },
      });
      shiftCount++;
    }
  }
  console.log(`✓ Created ${shiftCount} shifts`);

  // ==================== VENDORS ====================
  const vendorData = [
    { code: "V001", name: "Công ty Mỹ Phẩm ABC",   taxCode: "0123456789", phone: "0812345678", email: "contact@abccosme.vn",   address: "123 CMT8, TPHCM",          contactPerson: "Nguyễn Văn A", paymentTerms: 30 },
    { code: "V002", name: "Công ty Nước Hoa XYZ",  taxCode: "0987654321", phone: "0887654321", email: "sales@xyzperfume.vn",  address: "456 Lý Thường Kiệt, TPHCM", contactPerson: "Trần Thị B",   paymentTerms: 45 },
    { code: "V003", name: "Nhà Cung Cấp DEF",                             phone: "0855556666", email: "info@defsupply.vn",    address: "789 Bến Cát, Bình Dương",                                  paymentTerms: 60 },
    { code: "V004", name: "Phân Phối GHK Việt Nam", taxCode: "0112233445", phone: "0911223344", email: "order@ghkvn.vn",      address: "101 Kha Vạn Cân, Thủ Đức", contactPerson: "Lê Thành C",   paymentTerms: 30 },
  ];

  for (const v of vendorData) {
    await prisma.vendor.upsert({
      where: { code: v.code },
      update: { name: v.name, phone: v.phone, email: v.email },
      create: v,
    });
  }
  console.log(`✓ Upserted ${vendorData.length} vendors`);
  const allVendors = await prisma.vendor.findMany();

  // ==================== TAX RATES ====================
  const taxData = [
    { code: "VAT0",  name: "Không chịu thuế", rate: "0",  description: "Hàng miễn thuế" },
    { code: "VAT5",  name: "Thuế VAT 5%",      rate: "5",  description: "Hàng thiết yếu" },
    { code: "VAT8",  name: "Thuế VAT 8%",      rate: "8",  description: "Hàng tiêu dùng thông thường" },
    { code: "VAT10", name: "Thuế VAT 10%",     rate: "10", description: "Mức thuế tiêu chuẩn" },
  ];

  for (const t of taxData) {
    await prisma.taxRate.upsert({
      where: { code: t.code },
      update: { name: t.name, description: t.description },
      create: t,
    });
  }
  console.log(`✓ Upserted ${taxData.length} tax rates`);
  const allTaxRates = await prisma.taxRate.findMany();

  // ==================== CHART OF ACCOUNTS ====================
  const accountData = [
    // Assets
    { code: "111",  name: "Cash",              nameVi: "Tiền mặt",                    type: "ASSET",              normalBalance: "DEBIT",  isCash: true },
    { code: "112",  name: "Bank Deposits",     nameVi: "Tiền gửi ngân hàng",          type: "ASSET",              normalBalance: "DEBIT",  isCash: true },
    { code: "131",  name: "Trade Receivables", nameVi: "Phải thu khách hàng",         type: "ASSET",              normalBalance: "DEBIT" },
    { code: "1331", name: "VAT Input",         nameVi: "Thuế GTGT đầu vào",           type: "ASSET",              normalBalance: "DEBIT" },
    { code: "151",  name: "Raw Materials",     nameVi: "Hàng mua đang đi đường",      type: "ASSET",              normalBalance: "DEBIT" },
    { code: "156",  name: "Merchandise",       nameVi: "Hàng hóa tồn kho",            type: "ASSET",              normalBalance: "DEBIT" },
    // Liabilities
    { code: "331",  name: "Trade Payables",    nameVi: "Phải trả nhà cung cấp",       type: "LIABILITY",          normalBalance: "CREDIT" },
    { code: "3331", name: "VAT Output",        nameVi: "Thuế GTGT đầu ra phải nộp",   type: "LIABILITY",          normalBalance: "CREDIT" },
    // Equity
    { code: "411",  name: "Owner Equity",      nameVi: "Vốn đầu tư của chủ sở hữu",  type: "EQUITY",             normalBalance: "CREDIT" },
    { code: "421",  name: "Retained Earnings", nameVi: "Lợi nhuận chưa phân phối",    type: "EQUITY",             normalBalance: "CREDIT" },
    // Revenue
    { code: "511",  name: "Revenue",           nameVi: "Doanh thu bán hàng",          type: "REVENUE",            normalBalance: "CREDIT" },
    { code: "521",  name: "Sales Discount",    nameVi: "Chiết khấu thương mại",       type: "REVENUE",            normalBalance: "DEBIT" },
    // COGS
    { code: "632",  name: "COGS",              nameVi: "Giá vốn hàng bán",            type: "COST_OF_GOODS_SOLD", normalBalance: "DEBIT" },
    // Expenses
    { code: "641",  name: "Selling Expenses",  nameVi: "Chi phí bán hàng",            type: "EXPENSE",            normalBalance: "DEBIT" },
    { code: "642",  name: "Admin Expenses",    nameVi: "Chi phí quản lý doanh nghiệp",type: "EXPENSE",            normalBalance: "DEBIT" },
    { code: "811",  name: "Other Expenses",    nameVi: "Chi phí khác",                type: "EXPENSE",            normalBalance: "DEBIT" },
  ];

  let acctUpserted = 0;
  for (const a of accountData) {
    await prisma.account.upsert({
      where: { code: a.code },
      update: { nameVi: a.nameVi, type: a.type, normalBalance: a.normalBalance },
      create: a,
    });
    acctUpserted++;
  }
  console.log(`✓ Upserted ${acctUpserted} chart of accounts`);

  // ==================== EXPENSE CATEGORIES ====================
  const acct641 = await prisma.account.findUnique({ where: { code: "641" } });
  const acct642 = await prisma.account.findUnique({ where: { code: "642" } });

  const expCatData = [
    { code: "EC001", name: "Chi phí điện nước",   accountId: acct642.id, description: "Điện, nước, internet văn phòng" },
    { code: "EC002", name: "Chi phí vận chuyển",  accountId: acct641.id, description: "Phí ship hàng, vận chuyển kho" },
    { code: "EC003", name: "Chi phí quảng cáo",   accountId: acct641.id, description: "Quảng cáo Facebook, Google" },
    { code: "EC004", name: "Chi phí thuê mặt bằng", accountId: acct642.id, description: "Tiền thuê văn phòng, cửa hàng" },
    { code: "EC005", name: "Chi phí sửa chữa",    accountId: acct642.id, description: "Bảo trì, sửa chữa tài sản" },
  ];

  for (const ec of expCatData) {
    await prisma.expenseCategory.upsert({
      where: { code: ec.code },
      update: { name: ec.name, description: ec.description },
      create: ec,
    });
  }
  console.log(`✓ Upserted ${expCatData.length} expense categories`);
  const allExpCats = await prisma.expenseCategory.findMany();

  // ==================== BANK ACCOUNTS ====================
  const acct112 = await prisma.account.findUnique({ where: { code: "112" } });
  const bankData = [
    { accountNumber: "0111222333", bankName: "Vietcombank", accountName: "Cty TNHH ABC", accountId: acct112.id, openingBalance: "100000000", currentBalance: "125000000", isDefault: true },
    { accountNumber: "0555666777", bankName: "ACB",         accountName: "Cty TNHH ABC", accountId: acct112.id, openingBalance: "50000000",  currentBalance: "63000000" },
  ];

  for (const b of bankData) {
    await prisma.bankAccount.upsert({
      where: { accountNumber: b.accountNumber },
      update: { currentBalance: b.currentBalance },
      create: b,
    });
  }
  console.log(`✓ Upserted ${bankData.length} bank accounts`);
  const allBankAccounts = await prisma.bankAccount.findMany();

  // ==================== FISCAL PERIODS ====================
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1;

  let fpUpserted = 0;
  for (let m = 1; m <= 12; m++) {
    const year = currentYear;
    const start = new Date(year, m - 1, 1);
    const end = new Date(year, m, 0);
    const status = m < currentMonth ? "CLOSED" : "OPEN";
    await prisma.fiscalPeriod.upsert({
      where: { year_month: { year, month: m } },
      update: { status },
      create: { year, month: m, startDate: start, endDate: end, status },
    });
    fpUpserted++;
  }
  console.log(`✓ Upserted ${fpUpserted} fiscal periods`);

  // ==================== EXPENSES ====================
  const adminUser = allUsers.find((u) => u.role === "ADMIN") || allUsers[0];
  const managerUser = allUsers.find((u) => u.role === "MANAGER") || allUsers[0];

  const expensesData = [
    { desc: "Tiền điện tháng 4/2026",       amount: 2500000,  catIdx: 0, method: "BANK_TRANSFER", status: "PAID" },
    { desc: "Chi phí quảng cáo Facebook",   amount: 5000000,  catIdx: 2, method: "BANK_TRANSFER", status: "PAID" },
    { desc: "Tiền thuê mặt bằng tháng 5",   amount: 15000000, catIdx: 3, method: "BANK_TRANSFER", status: "APPROVED" },
    { desc: "Phí vận chuyển hàng tháng 4",  amount: 1800000,  catIdx: 1, method: "CASH",          status: "PAID" },
    { desc: "Sửa chữa máy tính",            amount: 800000,   catIdx: 4, method: "CASH",          status: "PAID" },
    { desc: "Quảng cáo Google Ads tháng 5", amount: 3000000,  catIdx: 2, method: "BANK_TRANSFER", status: "PENDING_APPROVAL" },
  ];

  let expCount = 0;
  for (let i = 0; i < expensesData.length; i++) {
    const e = expensesData[i];
    const cat = allExpCats[e.catIdx] || allExpCats[0];
    const tax = allTaxRates.find((t) => t.code === "VAT10");
    const taxAmt = Math.floor(e.amount * 0.1);
    await prisma.expense.create({
      data: {
        expenseCode:   `EXP-${Date.now()}-${i}`,
        date:          faker.date.recent({ days: 30 }),
        categoryId:    cat.id,
        description:   e.desc,
        amount:        e.amount.toString(),
        taxRateId:     tax?.id,
        taxAmount:     taxAmt.toString(),
        totalAmount:   (e.amount + taxAmt).toString(),
        paymentMethod: e.method,
        status:        e.status,
        createdById:   adminUser.id,
        approvedById:  e.status !== "PENDING_APPROVAL" ? managerUser.id : null,
      },
    });
    expCount++;
  }
  console.log(`✓ Created ${expCount} expenses`);

  // ==================== PURCHASE ORDERS ====================
  let poCount = 0;
  for (let i = 0; i < 10; i++) {
    const vendor = pick(allVendors);
    const itemCount = rndInt(2, 4);
    let subtotal = 0;
    const poItems = [];
    for (let j = 0; j < itemCount; j++) {
      const product = pick(allProducts);
      const qty = rndInt(5, 30);
      const unitCost = Math.floor(Number(product.costPrice) * (0.9 + Math.random() * 0.2));
      const itemSubtotal = unitCost * qty;
      subtotal += itemSubtotal;
      poItems.push({
        productId: product.id,
        quantity:  qty,
        unitCost:  unitCost.toString(),
        subtotal:  itemSubtotal.toString(),
      });
    }
    const taxAmt = Math.floor(subtotal * 0.1);
    const total = subtotal + taxAmt;
    const status = pick(["DRAFT", "PENDING", "APPROVED", "RECEIVED", "PAID"]);
    const poCode = `PO-2026${String(i + 1).padStart(3, "0")}`;
    const existingPO = await prisma.purchaseOrder.findUnique({ where: { poCode } });
    if (!existingPO) {
      await prisma.purchaseOrder.create({
        data: {
          poCode,
          date:          faker.date.recent({ days: 60 }),
          vendorId:      vendor.id,
          status,
          paymentStatus: status === "PAID" ? "PAID" : "UNPAID",
          subtotal:      subtotal.toString(),
          taxAmount:     taxAmt.toString(),
          total:         total.toString(),
          paidAmount:    status === "PAID" ? total.toString() : "0",
          items:         { create: poItems },
          createdById:   adminUser.id,
          approvedById:  ["APPROVED", "RECEIVED", "PAID"].includes(status) ? managerUser.id : null,
        },
      });
      poCount++;
    }
  }
  console.log(`✓ Created ${poCount} purchase orders`);

  // ==================== ORDERS ====================
  let orderCount = 0;
  for (let i = 0; i < 20; i++) {
    const customer = pick(allCustomers);
    const warehouse = pick(allWarehouses);
    const itemCount = rndInt(1, 5);
    let subtotal = 0;
    const orderItems = [];
    for (let j = 0; j < itemCount; j++) {
      const product = pick(allProducts);
      const qty = rndInt(1, 5);
      const price = Number(product.price);
      const itemSubtotal = price * qty;
      subtotal += itemSubtotal;
      orderItems.push({
        productId: product.id,
        quantity:  qty,
        price:     price.toString(),
        subtotal:  itemSubtotal.toString(),
      });
    }
    const discountPct = rndInt(0, 20);
    const discount = Math.floor(subtotal * discountPct / 100);
    const total = subtotal - discount;
    const status = pick(["PENDING", "CONFIRMED", "COMPLETED", "COMPLETED", "COMPLETED"]);
    const paidStatus = status === "COMPLETED" ? "PAID" : pick(["UNPAID", "PARTIAL"]);
    const orderCode = `ORD-2026${String(i + 1).padStart(3, "0")}`;
    const existingOrder = await prisma.order.findUnique({ where: { orderCode } });
    if (!existingOrder) {
      await prisma.order.create({
        data: {
          orderCode,
          status,
          paymentMethod: pick(["CASH", "BANK_TRANSFER", "CARD"]),
          paymentStatus: paidStatus,
          subtotal:      subtotal.toString(),
          discount:      discount.toString(),
          total:         total.toString(),
          customerId:    customer.id,
          warehouseId:   warehouse.id,
          createdById:   pick(allUsers).id,
          items:         { create: orderItems },
        },
      });
      orderCount++;
    }
  }
  console.log(`✓ Created ${orderCount} orders`);

  // ==================== PROMOTIONS ====================
  const promoData = [
    {
      code: "SUMMER20",
      name: "Hè 20% Giảm Giá",
      description: "Khuyến mãi mùa hè, giảm 20% cho mọi đơn hàng",
      type: "PERCENTAGE",
      scope: "VOUCHER_CODE",
      status: "ACTIVE",
      value: "20",
      minOrderValue: "100000",
      maxDiscount: "500000",
      startDate: new Date("2026-06-01"),
      endDate: new Date("2026-08-31"),
      usageLimit: 200,
      perUserLimit: 2,
    },
    {
      name: "Giảm 100k Đơn Trên 500k",
      description: "Tự động áp dụng khi đơn từ 500k",
      type: "FIXED_AMOUNT",
      scope: "AUTO",
      status: "ACTIVE",
      value: "100000",
      minOrderValue: "500000",
      startDate: new Date("2026-01-01"),
      endDate: new Date("2026-12-31"),
    },
    {
      code: "NEWCUST",
      name: "Khách Hàng Mới 50k",
      description: "Giảm 50k cho đơn đầu tiên",
      type: "FIXED_AMOUNT",
      scope: "VOUCHER_CODE",
      status: "ACTIVE",
      value: "50000",
      minOrderValue: "200000",
      startDate: new Date("2026-01-01"),
      endDate: new Date("2026-12-31"),
      usageLimit: 1000,
      perUserLimit: 1,
    },
    {
      code: "FREESHIP",
      name: "Miễn Phí Vận Chuyển",
      description: "Miễn phí ship đơn từ 300k",
      type: "FREE_SHIPPING",
      scope: "AUTO",
      status: "ACTIVE",
      value: "0",
      minOrderValue: "300000",
      startDate: new Date("2026-05-01"),
      endDate: new Date("2026-05-31"),
    },
  ];

  let promoCreated = 0;
  for (const p of promoData) {
    const code = p.code || null;
    try {
      await prisma.promotion.create({ data: p });
      promoCreated++;
    } catch {
      if (code) {
        await prisma.promotion.update({ where: { code }, data: { status: p.status } });
      }
    }
  }
  console.log(`✓ Upserted ${promoCreated} promotions`);

  // ==================== NOTIFICATIONS ====================
  const allAdmins = allUsers.filter((u) => ["ADMIN", "MANAGER"].includes(u.role));
  const notifData = [
    { type: "LOW_STOCK",              severity: "WARNING",  title: "Hàng sắp hết",              message: "Xà phòng Thiên Nhiên còn 3 sản phẩm tại Kho Chính", link: "/inventory" },
    { type: "DEBT_OVERDUE",           severity: "CRITICAL", title: "Công nợ quá hạn",            message: "Khách hàng Trần Văn A nợ 5.500.000đ đã quá 30 ngày", link: "/debts" },
    { type: "PO_PENDING_APPROVAL",    severity: "INFO",     title: "Đơn mua hàng chờ duyệt",    message: "PO-2026001 từ Công ty Mỹ Phẩm ABC chờ phê duyệt", link: "/purchase-orders" },
    { type: "EXPENSE_PENDING_APPROVAL", severity: "INFO",   title: "Chi phí chờ duyệt",         message: "EXP quảng cáo Google 3.300.000đ chờ phê duyệt", link: "/expenses" },
    { type: "PAYROLL_DUE",            severity: "WARNING",  title: "Đến kỳ tính lương",         message: "Tháng 5/2026 - 5 nhân viên chờ tính lương", link: "/hr" },
    { type: "OUT_OF_STOCK",           severity: "CRITICAL", title: "Hết hàng",                  message: "Mặt Nạ Đất Sét hết tại Kho Quận 1", link: "/inventory" },
    { type: "SYSTEM",                 severity: "INFO",     title: "Hệ thống cập nhật",         message: "Hệ thống đã được cập nhật phiên bản mới nhất" },
  ];

  let notifCount = 0;
  for (const n of notifData) {
    for (const admin of allAdmins) {
      await prisma.notification.create({
        data: { ...n, userId: admin.id, roleScope: admin.role },
      });
      notifCount++;
    }
  }
  console.log(`✓ Created ${notifCount} notifications`);

  console.log("\n✅ Comprehensive seed completed successfully!");
  console.log("   Tài khoản đăng nhập: admin@erp.local / Admin@123");
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
