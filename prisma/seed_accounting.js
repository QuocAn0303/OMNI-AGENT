/**
 * prisma/seed_accounting.js — Seed dữ liệu kế toán cơ bản
 *
 * Tổng quan:
 * - Tạo hệ thống tài khoản kế toán (Chart of Accounts) theo Thông tư 200/2014 rút gọn,
 *   các mức thuế suất VAT, danh mục chi phí và tài khoản ngân hàng mặc định
 * - Chạy khi: npm run db:seed (hoặc riêng lẻ), cần chạy SAU seed.js
 * - Dữ liệu tạo: ~40 tài khoản (111..911), 4 thuế suất (VAT0/5/8/10),
 *   15 danh mục chi phí, 1 tài khoản ngân hàng mẫu
 *
 * Hàm:
 * - seedAccounts(): Upsert tất cả tài khoản kế toán — pass 1 tạo tài khoản gốc,
 *   pass 2 gán parentId cho tài khoản con (1331, 3331, 6411...)
 * - seedTaxRates(): Upsert 4 mức thuế VAT (0%, 5%, 8%, 10%)
 * - seedExpenseCategories(): Upsert danh mục chi phí, liên kết với tài khoản tương ứng
 * - seedDefaultBank(): Tạo tài khoản ngân hàng Vietcombank mặc định nếu chưa có
 * - main(): Hàm chính — chạy lần lượt các seed functions trên
 */
// prisma/seed_accounting.js
// Seed Chart of Accounts (VAS rút gọn), Tax rates, Expense categories
require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { Pool } = require("pg");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// Chart of Accounts theo Thông tư 200/2014 - rút gọn cho startup
// Source: Thông tư 200/2014/TT-BTC (cập nhật 2024) - chỉ lấy những TK cần cho SME
const accounts = [
  // === LOẠI 1: TÀI SẢN NGẮN HẠN ===
  { code: "111", name: "Tiền mặt", nameVi: "Tiền mặt Việt Nam", type: "ASSET", normalBalance: "DEBIT", isCash: true },
  { code: "1111", name: "Tiền Việt Nam", nameVi: "Tiền mặt Việt Nam", type: "ASSET", normalBalance: "DEBIT", isCash: true, parentCode: "111" },
  { code: "112", name: "Tiền gửi ngân hàng", nameVi: "Tiền gửi ngân hàng", type: "ASSET", normalBalance: "DEBIT" },
  { code: "1121", name: "Tiền Việt Nam", nameVi: "Tiền gửi ngân hàng bằng VND", type: "ASSET", normalBalance: "DEBIT", parentCode: "112" },
  { code: "131", name: "Phải thu khách hàng", nameVi: "Phải thu khách hàng", type: "ASSET", normalBalance: "DEBIT" },
  { code: "133", name: "Thuế GTGT được khấu trừ", nameVi: "Thuế GTGT được khấu trừ", type: "ASSET", normalBalance: "DEBIT" },
  { code: "1331", name: "Thuế GTGT được khấu trừ hàng hóa, dịch vụ", nameVi: "Thuế GTGT được khấu trừ của hàng hóa dịch vụ", type: "ASSET", normalBalance: "DEBIT", parentCode: "133" },
  { code: "138", name: "Phải thu khác", nameVi: "Phải thu khác", type: "ASSET", normalBalance: "DEBIT" },
  { code: "1388", name: "Phải thu khác", nameVi: "Phải thu khác", type: "ASSET", normalBalance: "DEBIT", parentCode: "138" },
  { code: "141", name: "Tạm ứng", nameVi: "Tạm ứng", type: "ASSET", normalBalance: "DEBIT" },
  { code: "142", name: "Chi phí trả trước ngắn hạn", nameVi: "Chi phí trả trước ngắn hạn", type: "ASSET", normalBalance: "DEBIT" },
  { code: "152", name: "Nguyên liệu, vật liệu", nameVi: "Nguyên liệu, vật liệu", type: "ASSET", normalBalance: "DEBIT" },
  { code: "153", name: "Công cụ, dụng cụ", nameVi: "Công cụ, dụng cụ", type: "ASSET", normalBalance: "DEBIT" },
  { code: "154", name: "Chi phí sản xuất, kinh doanh dở dang", nameVi: "Chi phí SXKD dở dang", type: "ASSET", normalBalance: "DEBIT" },
  { code: "155", name: "Thành phẩm", nameVi: "Thành phẩm", type: "ASSET", normalBalance: "DEBIT" },
  { code: "156", name: "Hàng hóa", nameVi: "Hàng hóa", type: "ASSET", normalBalance: "DEBIT" },

  // === LOẠI 2: TÀI SẢN DÀI HẠN ===
  { code: "211", name: "Tài sản cố định hữu hình", nameVi: "Tài sản cố định hữu hình", type: "ASSET", normalBalance: "DEBIT" },
  { code: "212", name: "Tài sản cố định thuê tài chính", nameVi: "Tài sản cố định thuê tài chính", type: "ASSET", normalBalance: "DEBIT" },
  { code: "213", name: "Tài sản cố định vô hình", nameVi: "Tài sản cố định vô hình", type: "ASSET", normalBalance: "DEBIT" },
  { code: "214", name: "Hao mòn tài sản cố định", nameVi: "Hao mòn tài sản cố định", type: "ASSET", normalBalance: "CREDIT" },
  { code: "2141", name: "Hao mòn TSCĐ hữu hình", nameVi: "Hao mòn TSCĐ hữu hình", type: "ASSET", normalBalance: "CREDIT", parentCode: "214" },
  { code: "2143", name: "Hao mòn TSCĐ vô hình", nameVi: "Hao mòn TSCĐ vô hình", type: "ASSET", normalBalance: "CREDIT", parentCode: "214" },
  { code: "242", name: "Chi phí trả trước dài hạn", nameVi: "Chi phí trả trước dài hạn", type: "ASSET", normalBalance: "DEBIT" },

  // === LOẠI 3: NỢ PHẢI TRẢ ===
  { code: "311", name: "Vay ngắn hạn", nameVi: "Vay ngắn hạn", type: "LIABILITY", normalBalance: "CREDIT" },
  { code: "331", name: "Phải trả người bán", nameVi: "Phải trả cho người bán", type: "LIABILITY", normalBalance: "CREDIT" },
  { code: "333", name: "Thuế và các khoản phải nộp Nhà nước", nameVi: "Thuế và các khoản phải nộp NN", type: "LIABILITY", normalBalance: "CREDIT" },
  { code: "3331", name: "Thuế GTGT phải nộp", nameVi: "Thuế GTGT phải nộp", type: "LIABILITY", normalBalance: "CREDIT", parentCode: "333" },
  { code: "33311", name: "Thuế GTGT đầu ra", nameVi: "Thuế GTGT đầu ra", type: "LIABILITY", normalBalance: "CREDIT", parentCode: "3331" },
  { code: "3335", name: "Thuế thu nhập cá nhân", nameVi: "Thuế TNCN", type: "LIABILITY", normalBalance: "CREDIT", parentCode: "333" },
  { code: "334", name: "Phải trả người lao động", nameVi: "Phải trả người lao động", type: "LIABILITY", normalBalance: "CREDIT" },
  { code: "338", name: "Phải trả, phải nộp khác", nameVi: "Phải trả, phải nộp khác", type: "LIABILITY", normalBalance: "CREDIT" },
  { code: "3383", name: "Bảo hiểm xã hội", nameVi: "Bảo hiểm xã hội", type: "LIABILITY", normalBalance: "CREDIT", parentCode: "338" },
  { code: "3384", name: "Bảo hiểm y tế", nameVi: "Bảo hiểm y tế", type: "LIABILITY", normalBalance: "CREDIT", parentCode: "338" },
  { code: "3386", name: "Kinh phí công đoàn", nameVi: "Kinh phí công đoàn", type: "LIABILITY", normalBalance: "CREDIT", parentCode: "338" },

  // === LOẠI 4: VỐN CHỦ SỞ HỮU ===
  { code: "411", name: "Vốn đầu tư của chủ sở hữu", nameVi: "Vốn góp", type: "EQUITY", normalBalance: "CREDIT" },
  { code: "421", name: "Lợi nhuận sau thuế chưa phân phối", nameVi: "Lợi nhuận chưa phân phối", type: "EQUITY", normalBalance: "CREDIT" },
  { code: "4211", name: "Lợi nhuận năm trước", nameVi: "LN năm trước chưa PP", type: "EQUITY", normalBalance: "CREDIT", parentCode: "421" },
  { code: "4212", name: "Lợi nhuận năm nay", nameVi: "LN năm nay chưa PP", type: "EQUITY", normalBalance: "CREDIT", parentCode: "421" },

  // === LOẠI 5: DOANH THU ===
  { code: "511", name: "Doanh thu bán hàng và cung cấp dịch vụ", nameVi: "Doanh thu", type: "REVENUE", normalBalance: "CREDIT" },
  { code: "5111", name: "Doanh thu bán hàng hóa", nameVi: "Doanh thu bán hàng", type: "REVENUE", normalBalance: "CREDIT", parentCode: "511" },
  { code: "515", name: "Doanh thu hoạt động tài chính", nameVi: "Doanh thu tài chính", type: "REVENUE", normalBalance: "CREDIT" },

  // === LOẠI 6: CHI PHÍ SẢN XUẤT, KINH DOANH ===
  { code: "611", name: "Mua hàng", nameVi: "Mua hàng", type: "COST_OF_GOODS_SOLD", normalBalance: "DEBIT" },
  { code: "621", name: "Chi phí nguyên liệu, vật liệu trực tiếp", nameVi: "CP NVL trực tiếp", type: "COST_OF_GOODS_SOLD", normalBalance: "DEBIT" },
  { code: "622", name: "Chi phí nhân công trực tiếp", nameVi: "CP nhân công trực tiếp", type: "COST_OF_GOODS_SOLD", normalBalance: "DEBIT" },
  { code: "627", name: "Chi phí sản xuất chung", nameVi: "CP sản xuất chung", type: "COST_OF_GOODS_SOLD", normalBalance: "DEBIT" },
  { code: "632", name: "Giá vốn hàng bán", nameVi: "Giá vốn hàng bán", type: "COST_OF_GOODS_SOLD", normalBalance: "DEBIT" },
  { code: "635", name: "Chi phí tài chính", nameVi: "Chi phí tài chính", type: "COST_OF_GOODS_SOLD", normalBalance: "DEBIT" },
  { code: "641", name: "Chi phí bán hàng", nameVi: "Chi phí bán hàng", type: "EXPENSE", normalBalance: "DEBIT" },
  { code: "6411", name: "Chi phí nhân viên bán hàng", nameVi: "CP nhân viên bán hàng", type: "EXPENSE", normalBalance: "DEBIT", parentCode: "641" },
  { code: "6417", name: "Chi phí dịch vụ mua ngoài", nameVi: "CP dịch vụ mua ngoài", type: "EXPENSE", normalBalance: "DEBIT", parentCode: "641" },
  { code: "642", name: "Chi phí quản lý doanh nghiệp", nameVi: "Chi phí QLDN", type: "EXPENSE", normalBalance: "DEBIT" },
  { code: "6421", name: "Chi phí nhân viên quản lý", nameVi: "CP nhân viên QLDN", type: "EXPENSE", normalBalance: "DEBIT", parentCode: "642" },
  { code: "6427", name: "Chi phí dịch vụ mua ngoài QLDN", nameVi: "CP dịch vụ mua ngoài QLDN", type: "EXPENSE", normalBalance: "DEBIT", parentCode: "642" },
  { code: "6428", name: "Chi phí bằng tiền khác", nameVi: "CP bằng tiền khác QLDN", type: "EXPENSE", normalBalance: "DEBIT", parentCode: "642" },

  // === LOẠI 7: THU NHẬP KHÁC ===
  { code: "711", name: "Thu nhập khác", nameVi: "Thu nhập khác", type: "REVENUE", normalBalance: "CREDIT" },

  // === LOẠI 8: CHI PHÍ KHÁC ===
  { code: "811", name: "Chi phí khác", nameVi: "Chi phí khác", type: "EXPENSE", normalBalance: "DEBIT" },

  // === LOẠI 9: XÁC ĐỊNH KẾT QUẢ KINH DOANH ===
  { code: "911", name: "Xác định kết quả kinh doanh", nameVi: "Xác định KQKD", type: "EQUITY", normalBalance: "DEBIT" },
];

const taxRates = [
  { code: "VAT0", name: "Thuế suất 0%", rate: 0, isActive: true },
  { code: "VAT5", name: "Thuế suất 5%", rate: 5, isActive: true },
  { code: "VAT8", name: "Thuế suất 8%", rate: 8, isActive: true },
  { code: "VAT10", name: "Thuế suất 10%", rate: 10, isActive: true },
];

const expenseCategories = [
  { code: "RENT", name: "Tiền thuê mặt bằng", accountCode: "6427" },
  { code: "UTILITY", name: "Điện nước, internet", accountCode: "6427" },
  { code: "SALARY", name: "Lương nhân viên", accountCode: "6421" },
  { code: "MARKETING", name: "Chi phí quảng cáo", accountCode: "6417" },
  { code: "SHIPPING", name: "Phí vận chuyển", accountCode: "6417" },
  { code: "PACKAGING", name: "Bao bì đóng gói", accountCode: "6417" },
  { code: "OFFICE", name: "Văn phòng phẩm", accountCode: "6427" },
  { code: "MAINTENANCE", name: "Bảo trì, sửa chữa", accountCode: "6427" },
  { code: "INSURANCE", name: "Bảo hiểm", accountCode: "6428" },
  { code: "TAX", name: "Thuế, phí", accountCode: "6428" },
  { code: "TRAVEL", name: "Công tác phí", accountCode: "6428" },
  { code: "RAW_MATERIAL", name: "Nguyên vật liệu", accountCode: "621" },
  { code: "EQUIPMENT", name: "Mua sắm thiết bị", accountCode: "6427" },
  { code: "SOFTWARE", name: "Phần mềm, SaaS", accountCode: "6427" },
  { code: "PROFESSIONAL", name: "Dịch vụ thuê ngoài", accountCode: "6427" },
];

async function seedAccounts() {
  console.log("→ Seeding Chart of Accounts...");
  let count = 0;
  // Pass 1: create all accounts (parents first)
  for (const a of accounts) {
    const { parentCode, ...data } = a;
    await prisma.account.upsert({
      where: { code: data.code },
      update: data,
      create: data,
    });
    count++;
  }
  // Pass 2: set parentId for child accounts
  for (const a of accounts) {
    if (a.parentCode) {
      const parent = await prisma.account.findUnique({ where: { code: a.parentCode } });
      if (parent) {
        await prisma.account.update({
          where: { code: a.code },
          data: { parentId: parent.id },
        });
      }
    }
  }
  console.log(`  ✅ ${count} accounts`);
}

async function seedTaxRates(tenantId) {
  console.log("→ Seeding Tax rates...");
  let count = 0;
  for (const t of taxRates) {
    await prisma.taxRate.upsert({
      where: { code_tenantId: { code: t.code, tenantId } },
      update: t,
      create: { ...t, tenantId },
    });
    count++;
}
  console.log(`  ✅ ${count} tax rates`);
}

async function seedExpenseCategories(tenantId) {
  console.log("→ Seeding Expense categories...");
  let count = 0;
  for (const ec of expenseCategories) {
    const account = await prisma.account.findUnique({ where: { code: ec.accountCode } });
    await prisma.expenseCategory.upsert({
      where: { code_tenantId: { code: ec.code, tenantId } },
      update: { name: ec.name, accountId: account?.id || null },
      create: { code: ec.code, name: ec.name, accountId: account?.id || null, tenantId },
    });
    count++;
  }
  console.log(`  ✅ ${count} expense categories`);
}

async function seedDefaultBank(tenantId) {
  console.log("→ Seeding default bank account (optional)...");
  const exists = await prisma.bankAccount.findFirst();
  if (exists) {
    console.log("  ⏭  Bank account already exists, skipping");
    return;
  }
  const cashAccount = await prisma.account.findUnique({ where: { code: "112" } });
  await prisma.bankAccount.create({
    data: {
      bankName: "Vietcombank",
      accountNumber: "1234567890",
      accountName: "CANDORY SCENT CO., LTD",
      isDefault: true,
      tenantId,
      accountId: cashAccount?.id,
    },
  });
  console.log("  ✅ Default bank account created");
}

async function main() {
  console.log("🌱 Seeding Accounting data...");

  const tenant = await prisma.tenant.findFirst({ where: { slug: "candory-scent" } });
  const tenantId = tenant?.id;

  await seedAccounts();
  await seedTaxRates(tenantId);
  await seedExpenseCategories(tenantId);
  await seedDefaultBank(tenantId);
  console.log("🎉 Accounting seed completed!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    try { await pool.end(); } catch {}
  });
