/**
 * prisma/seed.js — Seed dữ liệu chính cho hệ thống CANDORY SCENT
 *
 * Tổng quan:
 * - File này tạo toàn bộ dữ liệu mẫu ban đầu cho hệ thống ERP
 * - Chạy khi: npm run db:seed
 * - Tạo dữ liệu: users (10 tài khoản với các role), subscription plans (4 gói),
 *   tenant + subscription, employees, categories (3 danh mục), products (30-50 SP + tồn kho),
 *   customers (50), orders (40-60 đơn hàng kèm giao dịch tồn kho)
 * - Mật khẩu mặc định tất cả tài khoản: 123456
 * - Có hàm ensureDeepDiveSchema() để tạo enum/table mở rộng (hiện đang comment)
 *
 * Hàm:
 * - ensureDeepDiveSchema(): Tạo các enum mở rộng (ReturnStatus, RefundMethod, CycleCountStatus),
 *   bảng payments, order_returns, cycle_counts và các cột mở rộng
 * - main(): Hàm chính — xoá dữ liệu cũ (TRUNCATE CASCADE), tạo toàn bộ dữ liệu mẫu
 * - rndInt(min, max): Random số nguyên trong khoảng [min, max]
 * - pick(arr): Random lấy 1 phần tử từ mảng
 */
// prisma/seed.js
require("dotenv").config();
const { PrismaClient, Prisma } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { Pool } = require("pg");
const bcrypt = require("bcrypt");
const { faker } = require("@faker-js/faker");

// Use PrismaPg adapter so PrismaClient uses the Postgres adapter engine
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 2,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const rndInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

async function ensureDeepDiveSchema() {
  const statements = [
    `ALTER TYPE "TransactionType" ADD VALUE IF NOT EXISTS 'RESERVATION'`,
    `ALTER TYPE "TransactionType" ADD VALUE IF NOT EXISTS 'RESERVATION_RELEASE'`,
    `ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'SUPER_ADMIN'`,
    `ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'SUPER_OMEGA_ULTRA_ADMIN'`,
    `DO $$ BEGIN CREATE TYPE "ReturnStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'COMPLETED'); EXCEPTION WHEN duplicate_object THEN null; END $$`,
    `DO $$ BEGIN CREATE TYPE "RefundMethod" AS ENUM ('CASH', 'BANK_TRANSFER', 'STORE_CREDIT'); EXCEPTION WHEN duplicate_object THEN null; END $$`,
    `DO $$ BEGIN CREATE TYPE "CycleCountStatus" AS ENUM ('DRAFT', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'); EXCEPTION WHEN duplicate_object THEN null; END $$`,
    `ALTER TABLE "inventories" ADD COLUMN IF NOT EXISTS "reserved" INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "discountType" TEXT DEFAULT 'NONE'`,
    `ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "discountValue" DECIMAL(12, 2) NOT NULL DEFAULT 0`,
    `ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "discountType" TEXT DEFAULT 'NONE'`,
    `ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "discountValue" DECIMAL(12, 2) NOT NULL DEFAULT 0`,
    `ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "discountAmount" DECIMAL(12, 2) NOT NULL DEFAULT 0`,
    `CREATE TABLE IF NOT EXISTS "payments" (
      "id" TEXT NOT NULL,
      "orderId" TEXT NOT NULL,
      "amount" DECIMAL(12, 2) NOT NULL,
      "method" "PaymentMethod" NOT NULL,
      "reference" TEXT,
      "note" TEXT,
      "createdById" TEXT NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
    )`,
    `CREATE TABLE IF NOT EXISTS "order_returns" (
      "id" TEXT NOT NULL,
      "returnCode" TEXT NOT NULL,
      "orderId" TEXT NOT NULL,
      "status" "ReturnStatus" NOT NULL DEFAULT 'PENDING',
      "reason" TEXT NOT NULL,
      "refundMethod" "RefundMethod" NOT NULL DEFAULT 'CASH',
      "refundAmount" DECIMAL(12, 2) NOT NULL,
      "note" TEXT,
      "createdById" TEXT NOT NULL,
      "approvedById" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "order_returns_pkey" PRIMARY KEY ("id")
    )`,
    `CREATE TABLE IF NOT EXISTS "order_return_items" (
      "id" TEXT NOT NULL,
      "returnId" TEXT NOT NULL,
      "orderItemId" TEXT NOT NULL,
      "quantity" INTEGER NOT NULL,
      "refundAmount" DECIMAL(12, 2) NOT NULL,
      CONSTRAINT "order_return_items_pkey" PRIMARY KEY ("id")
    )`,
    `CREATE TABLE IF NOT EXISTS "cycle_counts" (
      "id" TEXT NOT NULL,
      "code" TEXT NOT NULL,
      "status" "CycleCountStatus" NOT NULL DEFAULT 'DRAFT',
      "note" TEXT,
      "createdById" TEXT NOT NULL,
      "completedAt" TIMESTAMP(3),
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "cycle_counts_pkey" PRIMARY KEY ("id")
    )`,
    `CREATE TABLE IF NOT EXISTS "cycle_count_items" (
      "id" TEXT NOT NULL,
      "cycleCountId" TEXT NOT NULL,
      "productId" TEXT NOT NULL,
      "systemQuantity" INTEGER NOT NULL,
      "actualQuantity" INTEGER,
      "variance" INTEGER,
      "note" TEXT,
      CONSTRAINT "cycle_count_items_pkey" PRIMARY KEY ("id")
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "order_returns_returnCode_key" ON "order_returns"("returnCode")`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "cycle_counts_code_key" ON "cycle_counts"("code")`,
    `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "tenantId" TEXT`,
  ];

  for (const statement of statements) {
    await prisma.$executeRawUnsafe(statement);
  }
}

async function main() {
  // await ensureDeepDiveSchema();
  console.log("🌱 Seeding database for CANDORY SCENT...");

  // ---- CLEANUP (order matters to avoid FK constraint errors) ----
  console.log("→ Clearing old data (this may take a while)...");

  // Use raw SQL TRUNCATE CASCADE to avoid FK ordering issues
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "order_return_items",
      "order_returns",
      "payments",
      "order_items",
      "inventory_transactions",
      "orders",
      "cycle_count_items",
      "cycle_counts",
      "inventories",
      "products",
      "categories",
      "customers",
      "payrolls",
      "violations",
      "shifts",
      "employees",
      "refresh_tokens",
      "audit_logs",
      "users"
    CASCADE
  `);

  // ---- USERS ----
  const plainPassword = "123456";
  const hashedPassword = await bcrypt.hash(
    plainPassword,
    Number(process.env.BCRYPT_ROUNDS) || 10,
  );

  const seedUsers = [
    {
      email: "super_omega_ultra_admin@gmail.com",
      fullName: "Siêu siêu siêu cấp admin",
      role: "SUPER_OMEGA_ULTRA_ADMIN",
      isActive: true,
      emailVerified: true,
      registrationStatus: "ACTIVE",
    },
    {
      email: "superadmin@candory.com",
      fullName: "Super Admin CANDORY",
      role: "SUPER_ADMIN",
      isActive: true,
      emailVerified: true,
      registrationStatus: "ACTIVE",
    },
    {
      email: "admin@candory.com",
      fullName: "Admin CANDORY",
      role: "ADMIN",
      isActive: true,
      emailVerified: true,
      registrationStatus: "ACTIVE",
    },
    {
      email: "manager@candory.com",
      fullName: "Quản lý CANDORY",
      role: "MANAGER",
      isActive: true,
      emailVerified: true,
      registrationStatus: "ACTIVE",
    },
    {
      email: "cashier@candory.com",
      fullName: "Thu ngân CANDORY",
      role: "CASHIER",
      isActive: true,
      emailVerified: true,
      registrationStatus: "ACTIVE",
    },
    {
      email: "quocan@gmail.com",
      fullName: "Quốc An",
      role: "MANAGER",
      isActive: true,
      emailVerified: true,
      registrationStatus: "ACTIVE",
    },
    {
      email: "phatlun@gmail.com",
      fullName: "Phát lùn",
      role: "CASHIER",
      isActive: true,
      emailVerified: true,
      registrationStatus: "ACTIVE",
    },
    {
      email: "tanphat@gmail.com",
      fullName: "Tấn Phát",
      role: "WAREHOUSE",
      isActive: true,
      emailVerified: true,
      registrationStatus: "ACTIVE",
    },
    {
      email: "minhtri@gmail.com",
      fullName: "Minh Trí",
      role: "WAREHOUSE",
      isActive: true,
      emailVerified: true,
      registrationStatus: "ACTIVE",
    },
    {
      email: "hieunhan@gmail.com",
      fullName: "Hiếu Nhân",
      role: "WAREHOUSE",
      isActive: true,
      emailVerified: true,
      registrationStatus: "ACTIVE",
    },
    {
      email: "warehouse@candory.com",
      fullName: "Thủ kho CANDORY",
      role: "WAREHOUSE",
      isActive: true,
      emailVerified: true,
      registrationStatus: "ACTIVE",
    },
  ];

  const users = [];
  for (const u of seedUsers) {
    const created = await prisma.user.create({
      data: { ...u, password: hashedPassword },
    });
    users.push(created);
  }
  console.log(`✅ Created ${users.length} users`);

  // ---- SUBSCRIPTION PLANS (4 gói) ----
  const defaultPlans = [
    {
      name: "Miễn phí", key: "free", price: 0, durationDays: 99999, sortOrder: 0,
      description: "Dùng thử miễn phí các tính năng cơ bản — 5 users, 2 kho, 200 sản phẩm",
      features: {
        maxUsers: 5, maxWarehouses: 2, maxProducts: 200,
        allowedModules: [
          "dashboard", "products", "orders", "customers",
          "pos", "returns", "inventory", "crm",
          "loyalty", "promotions", "delivery",
          "hr", "accounting", "debts", "vendors", "purchase-orders",
          "reports", "import", "audit",
        ],
        hrPit: false, hrBhxh: false, hrViolations: false, hrPayrollLock: false,
        accountingBalanceSheet: false, accountingCashFlow: false, accountingAutopost: false,
      },
    },
    {
      name: "Chuyên nghiệp", key: "pro", price: 499000, currency: "VND", durationDays: 30, sortOrder: 1,
      description: "Quản lý chuyên sâu cho doanh nghiệp đang phát triển — 15 users, 5 kho, 500 sản phẩm",
      features: {
        maxUsers: 15, maxWarehouses: 5, maxProducts: 500,
        allowedModules: [
          "dashboard", "products", "orders", "customers",
          "pos", "returns", "inventory", "cycle-count", "stock-transfer",
          "crm", "segments", "loyalty", "promotions", "delivery",
          "hr", "accounting", "debts", "vendors", "purchase-orders",
          "reports", "import", "audit", "analytics", "lot-tracking",
          "marketing", "currency",
        ],
        hrPit: true, hrBhxh: true, hrViolations: true, hrPayrollLock: true,
        accountingBalanceSheet: true, accountingCashFlow: true, accountingAutopost: true,
      },
    },
    {
      name: "Doanh nghiệp", key: "business", price: 1499000, currency: "VND", durationDays: 30, sortOrder: 2,
      description: "Toàn diện cho doanh nghiệp quy mô lớn — 50 users, 20 kho, 5000 sản phẩm",
      features: {
        maxUsers: 50, maxWarehouses: 20, maxProducts: 5000,
        allowedModules: [
          "dashboard", "products", "orders", "customers",
          "pos", "returns", "inventory", "cycle-count", "stock-transfer",
          "crm", "segments", "loyalty", "promotions", "delivery",
          "hr", "accounting", "debts", "vendors", "purchase-orders",
          "reports", "import", "audit", "analytics", "lot-tracking",
          "marketing",
          "production", "projects",
          "einvoice", "tax", "bank-reco", "fixed-assets", "currency",
          "marketplace", "report-builder", "workflows",
          "integrations", "portal", "ai",
        ],
        hrPit: true, hrBhxh: true, hrViolations: true, hrPayrollLock: true,
        accountingBalanceSheet: true, accountingCashFlow: true, accountingAutopost: true,
      },
    },
    {
      name: "Enterprise", key: "enterprise", price: 0, durationDays: 99999, sortOrder: 3,
      description: "Liên hệ để có giải pháp tùy chỉnh — không giới hạn",
      features: {
        maxUsers: "unlimited", maxWarehouses: "unlimited", maxProducts: "unlimited",
        allowedModules: ["*"],
      },
    },
  ];

  const plans = [];
  for (const p of defaultPlans) {
    const plan = await prisma.subscriptionPlan.upsert({
      where: { key: p.key },
      update: p,
      create: p,
    });
    plans.push(plan);
  }
  console.log(`✅ Created ${plans.length} subscription plans`);

  // ---- TENANT for CANDORY SCENT ----
  const tenant = await prisma.tenant.upsert({
    where: { slug: "candory-scent" },
    update: {},
    create: { name: "CANDORY SCENT", slug: "candory-scent" },
  });

  // Assign tenantId to CANDORY users (exclude SUPER_OMEGA_ULTRA_ADMIN)
  const candoryUsers = users.filter((u) => u.role !== "SUPER_OMEGA_ULTRA_ADMIN");
  for (const u of candoryUsers) {
    await prisma.user.update({ where: { id: u.id }, data: { tenantId: tenant.id } });
  }

  // Create active subscription for CANDORY tenant
  const proPlan = plans.find((p) => p.key === "pro");
  if (proPlan) {
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + 30);
    await prisma.tenantSubscription.create({
      data: {
        tenantId: tenant.id,
        planId: proPlan.id,
        status: "ACTIVE",
        startDate: new Date(),
        endDate,
      },
    });
  }
  console.log("✅ Created tenant + subscription for CANDORY SCENT");

  // ---- EMPLOYEES (linked to seeded users) ----
  const employees = [];
  const salaryByRole = {
    SUPER_ADMIN: 20000000,
    ADMIN: 15000000,
    MANAGER: 10000000,
    CASHIER: 7000000,
    WAREHOUSE: 7000000,
  };
  for (const u of users) {
    const base = salaryByRole[u.role] || 7000000;
    const shiftMoney = +(base * 0.05).toFixed(2);
    const emp = await prisma.employee.create({
      data: {
        userId: u.id,
        baseSalary: base.toFixed(2),
        shiftMoney: shiftMoney.toFixed(2),
        isActive: true,
      },
    });
    employees.push(emp);
  }
  console.log(`✅ Created ${employees.length} employees`);

  // ---- CATEGORIES ----
  const categoryNames = [
    "Nến thơm tinh dầu",
    "Sáp thơm tủ quần áo",
    "Phụ kiện đốt nến",
  ];

  const categories = [];
  for (const name of categoryNames) {
    const c = await prisma.category.create({
      data: { name, description: `${name} - CANDORY SCENT` },
    });
    categories.push(c);
  }
  console.log(`✅ Created ${categories.length} categories`);

  let defaultWarehouse = await prisma.warehouse.findFirst({
    where: { isDefault: true },
  });
  if (!defaultWarehouse) {
    defaultWarehouse = await prisma.warehouse.create({
      data: {
        code: "WH-DEFAULT",
        name: "Kho mặc định",
        isDefault: true,
      },
    });
  }

  // ---- PRODUCTS + INVENTORY (30-50 sản phẩm) ----
  const scentList = [
    "Oải hương",
    "Vani",
    "Hoa hồng",
    "Gỗ đàn hương",
    "Bưởi",
    "Trà xanh",
    "Quýt",
    "Hổ phách",
    "Cà phê",
    "Dừa",
    "Hạnh nhân",
    "Hoa nhài",
    "Sả chanh",
  ];

  const productTypes = [
    "Nến hũ sứ",
    "Nến ly",
    "Nến thơm cao cấp",
    "Sáp thơm túi",
    "Sáp treo",
    "Tealight",
    "Đế nến gốm",
    "Bộ phụ kiện đốt nến",
  ];

  const numProducts = rndInt(15, 20);
  const products = [];

  for (let i = 0; i < numProducts; i++) {
    const scent = pick(scentList);
    const type = pick(productTypes);
    const size = pick(["120g", "180g", "250g", "350g", "480g"]);
    const name = `${type} ${scent} ${size}`;
    const sku = `CAND-${faker.string.uuid().split("-")[0].toUpperCase()}`;
    // Generate price as a multiple of 1000 (VND) to avoid odd tens/hundreds
    const price = rndInt(50, 350) * 1000; // VND (50k - 350k stepped by 1k)
    // costPrice as ~45-80% of price, rounded to nearest 1000
    const rawCost = price * (0.45 + Math.random() * 0.35);
    const costPrice = Math.round(rawCost / 1000) * 500;
    const qty = rndInt(50, 200);
    const category = pick(categories);

    const created = await prisma.product.create({
      data: {
        sku,
        name,
        description: faker.commerce.productDescription(),
        price: price.toFixed(2),
        costPrice: costPrice.toFixed(2),
        unit: "cái",
        categoryId: category.id,
        inventories: {
          create: {
            quantity: qty,
            minStock: rndInt(5, 20),
            warehouseId: defaultWarehouse.id,
          },
        },
      },
      include: { inventories: true },
    });

    products.push({
      id: created.id,
      sku: created.sku,
      name: created.name,
      price: parseFloat(created.price),
      inventoryId: created.inventories[0].id,
    });
  }
  console.log(`✅ Created ${products.length} products (+inventory)`);

  // ---- CURRENCIES + EXCHANGE RATES ----
  const currencies = [
    { code: "VND", name: "Việt Nam Đồng", symbol: "₫", isBase: true },
    { code: "USD", name: "US Dollar", symbol: "$" },
    { code: "EUR", name: "Euro", symbol: "€" },
    { code: "JPY", name: "Japanese Yen", symbol: "¥" },
    { code: "CNY", name: "Chinese Yuan", symbol: "¥" },
    { code: "KRW", name: "South Korean Won", symbol: "₩" },
  ];
  for (const cur of currencies) {
    const created = await prisma.currency.upsert({
      where: { code: cur.code },
      update: {},
      create: cur,
    });
    if (!cur.isBase) {
      const rates = {
        USD: 25400, EUR: 27500, JPY: 162, CNY: 3500, KRW: 18.5,
      };
      const existing = await prisma.exchangeRate.findFirst({
        where: { currencyId: created.id },
      });
      if (!existing) {
        const today = new Date(); today.setHours(0, 0, 0, 0);
        await prisma.exchangeRate.create({
          data: {
            currencyId: created.id,
            date: today,
            rate: rates[cur.code],
            source: "SEED",
          },
        });
      }
    }
  }
  console.log(`✅ Created ${currencies.length} currencies with rates`);

  // ---- CUSTOMERS (50) ----
  const customers = [];
  const phonePrefixes = [
    "090",
    "091",
    "092",
    "093",
    "094",
    "095",
    "096",
    "097",
    "098",
    "039",
    "038",
    "037",
    "036",
    "035",
    "034",
    "033",
    "032",
    "070",
    "079",
    "089",
  ];
  for (let i = 0; i < 50; i++) {
    const name = faker.person.fullName();
    const prefix = pick(phonePrefixes);
    const rest = String(rndInt(1000000, 9999999));
    const phone = `${prefix}${rest}`;
    const customer = await prisma.customer.create({
      data: {
        name,
        phone,
        email: faker.internet.email(),
        address: faker.location.streetAddress(),
        totalSpent: "0",
      },
    });
    customers.push(customer);
  }
  console.log(`✅ Created ${customers.length} customers`);

  // ---- ORDERS (100-200) ----
  const orderCount = rndInt(40, 60);
  console.log(
    `→ Creating ${orderCount} orders (this will update inventory & create transactions)...`,
  );

  for (let oi = 0; oi < orderCount; oi++) {
    const customer = pick(customers);
    const createdBy = pick(users);
    const itemCount = rndInt(1, 3);

    // pick distinct products for the order
    const chosen = new Set();
    while (chosen.size < itemCount) {
      chosen.add(pick(products).id);
    }
    const productIds = Array.from(chosen);

    // run a transaction for the whole order
    await prisma.$transaction(
      async (tx) => {
        const orderCode = `ORD-${Date.now().toString().slice(-6)}-${oi}`;

        // create empty order first (we'll patch totals after items)
        const order = await tx.order.create({
          data: {
            orderCode,
            subtotal: "0",
            discount: "0",
            total: "0",
            customerId: customer.id,
            createdById: createdBy.id,
          },
        });

        let orderSum = 0;

        for (const pid of productIds) {
          // read inventory inside transaction to avoid race
          const inv = await tx.inventory.findFirst({
            where: { productId: pid },
          });
          if (!inv || inv.quantity <= 0) continue; // out of stock

          const qty = Math.min(rndInt(1, 5), inv.quantity);

          // get product price
          const prod = products.find((p) => p.id === pid);
          const price = prod ? prod.price : 0;
          const subtotal = parseFloat((price * qty).toFixed(2));

          // create order item
          await tx.orderItem.create({
            data: {
              orderId: order.id,
              productId: pid,
              quantity: qty,
              price: price.toFixed(2),
              subtotal: subtotal.toFixed(2),
            },
          });

          // decrement inventory
          await tx.inventory.update({
            where: { id: inv.id },
            data: { quantity: { decrement: qty } },
          });

          // create inventory transaction
          await tx.inventoryTransaction.create({
            data: {
              type: "EXPORT",
              quantity: qty,
              inventoryId: inv.id,
              createdById: createdBy.id,
              note: `Order ${order.orderCode}`,
            },
          });

          orderSum += subtotal;
        }

        if (orderSum > 0) {
          // update order totals
          await tx.order.update({
            where: { id: order.id },
            data: { subtotal: orderSum.toFixed(2), total: orderSum.toFixed(2) },
          });

          // increment customer totalSpent
          try {
            await tx.customer.update({
              where: { id: customer.id },
              data: { totalSpent: { increment: orderSum } },
            });
          } catch (e) {
            // fallback: read current and set
            const cur = await tx.customer.findUnique({
              where: { id: customer.id },
            });
            const newTotal = (
              parseFloat(cur.totalSpent || 0) + orderSum
            ).toFixed(2);
            await tx.customer.update({
              where: { id: customer.id },
              data: { totalSpent: newTotal },
            });
          }
        } else {
          // no items could be created (all OOS) → remove the empty order
          await tx.order.delete({ where: { id: order.id } });
        }
      },
      { timeout: 60000 },
    );

    if ((oi + 1) % 25 === 0) console.log(`  → ${oi + 1} orders processed`);
  }

  console.log("\n🎉 Seed finished successfully!");
  console.log("📧 Sample logins (mật khẩu: 123456):");
  console.log("  - superadmin@candory.com  [SUPER_ADMIN]");
  console.log("  - admin@candory.com       [ADMIN]");
  console.log("  - manager@candory.com     [MANAGER]");
  console.log("  - cashier@candory.com     [CASHIER]");
  console.log("  - tanphat@gmail.com       [WAREHOUSE]");
  console.log("  - minhtri@gmail.com       [WAREHOUSE]");
  console.log("  - warehouse@candory.com   [WAREHOUSE]");
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
    } catch (err) {
      // ignore
    }
  });
