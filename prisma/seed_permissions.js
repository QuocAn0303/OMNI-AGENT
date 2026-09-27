require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { Pool } = require("pg");

const PERMISSIONS = [
  { key: "products.view", label: "Xem sản phẩm", group: "products" },
  { key: "products.create", label: "Thêm sản phẩm", group: "products" },
  { key: "products.edit", label: "Sửa sản phẩm", group: "products" },
  { key: "products.delete", label: "Xóa sản phẩm", group: "products" },
  { key: "products.editPrice", label: "Sửa giá bán", group: "products" },
  { key: "products.editCost", label: "Sửa giá vốn", group: "products" },

  { key: "orders.view", label: "Xem đơn hàng", group: "orders" },
  { key: "orders.create", label: "Tạo đơn hàng", group: "orders" },
  { key: "orders.edit", label: "Sửa đơn hàng", group: "orders" },
  { key: "orders.cancel", label: "Hủy đơn hàng", group: "orders" },
  { key: "orders.export", label: "Xuất Excel đơn hàng", group: "orders" },

  { key: "customers.view", label: "Xem khách hàng", group: "customers" },
  { key: "customers.create", label: "Thêm khách hàng", group: "customers" },
  { key: "customers.edit", label: "Sửa khách hàng", group: "customers" },
  { key: "customers.delete", label: "Xóa khách hàng", group: "customers" },

  { key: "inventory.view", label: "Xem tồn kho", group: "inventory" },
  { key: "inventory.import", label: "Nhập kho", group: "inventory" },
  { key: "inventory.export", label: "Xuất kho", group: "inventory" },
  { key: "inventory.adjust", label: "Kiểm kho", group: "inventory" },

  { key: "hr.view", label: "Xem nhân sự", group: "hr" },
  { key: "hr.create", label: "Thêm nhân sự", group: "hr" },
  { key: "hr.edit", label: "Sửa nhân sự", group: "hr" },
  { key: "hr.delete", label: "Xóa nhân sự", group: "hr" },
  { key: "hr.payroll", label: "Quản lý lương", group: "hr" },

  { key: "accounting.view", label: "Xem kế toán", group: "accounting" },
  { key: "accounting.journal", label: "Ghi sổ nhật ký", group: "accounting" },
  { key: "accounting.expenses", label: "Quản lý chi phí", group: "accounting" },
  { key: "accounting.reports", label: "Xem báo cáo", group: "accounting" },

  { key: "settings.view", label: "Xem cài đặt", group: "settings" },
  { key: "settings.edit", label: "Sửa cài đặt", group: "settings" },

  { key: "reports.view", label: "Xem báo cáo", group: "reports" },
  { key: "reports.export", label: "Xuất báo cáo", group: "reports" },
];

const ROLE_PERMISSIONS = {
  SUPER_OMEGA_ULTRA_ADMIN: PERMISSIONS.map(p => p.key),
  SUPER_ADMIN: PERMISSIONS.map(p => p.key),
  ADMIN: PERMISSIONS.map(p => p.key),
  MANAGER: [
    "products.view", "products.create", "products.edit", "products.editPrice",
    "orders.view", "orders.create", "orders.edit",
    "customers.view", "customers.create", "customers.edit",
    "inventory.view", "inventory.import", "inventory.export",
    "hr.view",
    "accounting.view", "accounting.expenses", "accounting.reports",
    "settings.view",
    "reports.view", "reports.export",
  ],
  ACCOUNTANT: [
    "accounting.view", "accounting.journal", "accounting.expenses", "accounting.reports",
    "reports.view", "reports.export",
  ],
  CASHIER: [
    "products.view",
    "orders.view", "orders.create",
    "customers.view", "customers.create",
    "inventory.view",
  ],
  WAREHOUSE: [
    "inventory.view", "inventory.import", "inventory.export",
  ],
};

async function seedPermissions(prisma) {
  console.log("→ Seeding permissions...");

  for (const p of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key: p.key },
      update: { label: p.label, group: p.group },
      create: p,
    });
  }
  console.log(`✅ Created ${PERMISSIONS.length} permissions`);

  await prisma.rolePermission.deleteMany();

  let count = 0;
  for (const [role, keys] of Object.entries(ROLE_PERMISSIONS)) {
    for (const permissionKey of keys) {
      await prisma.rolePermission.create({
        data: { role, permissionKey },
      });
      count++;
    }
  }
  console.log(`✅ Created ${count} role-permission mappings`);
}

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 2,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  try {
    await seedPermissions(prisma);
    console.log("\n🎉 Permissions seeded successfully!");
  } catch (e) {
    console.error(e);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
    try { await pool.end(); } catch (err) { }
  }
}

if (require.main === module) {
  main();
}

module.exports = { seedPermissions };
