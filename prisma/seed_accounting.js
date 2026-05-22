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
// Cấu trúc: code, name (tiếng Anh kế toán), nameVi (founder-friendly), type, normalBalance, isCash, parentCode
const ACCOUNTS = [
  // ===== TÀI SẢN (1xx, 2xx) =====
  // Tiền mặt & tương đương tiền
  { code: "111", name: "Cash on hand", nameVi: "Tiền mặt tại quỹ", type: "ASSET", normalBalance: "DEBIT", isCash: true },
  { code: "112", name: "Cash in bank", nameVi: "Tiền gửi ngân hàng", type: "ASSET", normalBalance: "DEBIT", isCash: true },

  // Phải thu
  { code: "131", name: "Accounts Receivable", nameVi: "Khách hàng nợ tiền", type: "ASSET", normalBalance: "DEBIT" },
  { code: "133", name: "VAT input deductible", nameVi: "Thuế VAT đầu vào được khấu trừ", type: "ASSET", normalBalance: "DEBIT" },
  { code: "1331", name: "VAT input - goods/services", nameVi: "Thuế VAT đầu vào - hàng hóa", type: "ASSET", normalBalance: "DEBIT", parentCode: "133" },
  { code: "138", name: "Other receivables", nameVi: "Phải thu khác", type: "ASSET", normalBalance: "DEBIT" },
  { code: "141", name: "Advances", nameVi: "Tạm ứng", type: "ASSET", normalBalance: "DEBIT" },

  // Hàng tồn kho
  { code: "154", name: "Work in progress", nameVi: "Chi phí sản xuất dở dang", type: "ASSET", normalBalance: "DEBIT" },
  { code: "155", name: "Finished goods", nameVi: "Thành phẩm", type: "ASSET", normalBalance: "DEBIT" },
  { code: "156", name: "Merchandise inventory", nameVi: "Hàng hóa tồn kho", type: "ASSET", normalBalance: "DEBIT" },

  // TSCĐ
  { code: "211", name: "Tangible fixed assets", nameVi: "Tài sản cố định hữu hình", type: "ASSET", normalBalance: "DEBIT" },
  { code: "214", name: "Accumulated depreciation", nameVi: "Hao mòn TSCĐ (-)", type: "ASSET", normalBalance: "CREDIT" },

  // ===== NỢ PHẢI TRẢ (3xx) =====
  { code: "331", name: "Accounts Payable", nameVi: "Nợ nhà cung cấp", type: "LIABILITY", normalBalance: "CREDIT" },
  { code: "333", name: "Taxes payable to State", nameVi: "Thuế phải nộp Nhà nước", type: "LIABILITY", normalBalance: "CREDIT" },
  { code: "3331", name: "VAT output payable", nameVi: "Thuế VAT đầu ra phải nộp", type: "LIABILITY", normalBalance: "CREDIT", parentCode: "333" },
  { code: "3334", name: "Corporate income tax", nameVi: "Thuế TNDN phải nộp", type: "LIABILITY", normalBalance: "CREDIT", parentCode: "333" },
  { code: "3335", name: "Personal income tax", nameVi: "Thuế TNCN phải nộp", type: "LIABILITY", normalBalance: "CREDIT", parentCode: "333" },
  { code: "334", name: "Salaries payable", nameVi: "Lương phải trả nhân viên", type: "LIABILITY", normalBalance: "CREDIT" },
  { code: "338", name: "Other payables", nameVi: "Phải trả khác (BHXH...)", type: "LIABILITY", normalBalance: "CREDIT" },
  { code: "341", name: "Loans", nameVi: "Vay nợ", type: "LIABILITY", normalBalance: "CREDIT" },

  // ===== VỐN CHỦ SỞ HỮU (4xx) =====
  { code: "411", name: "Owner's capital", nameVi: "Vốn góp chủ sở hữu", type: "EQUITY", normalBalance: "CREDIT" },
  { code: "421", name: "Retained earnings", nameVi: "Lợi nhuận chưa phân phối", type: "EQUITY", normalBalance: "CREDIT" },

  // ===== DOANH THU (5xx, 7xx) =====
  { code: "511", name: "Sales revenue", nameVi: "Doanh thu bán hàng", type: "REVENUE", normalBalance: "CREDIT" },
  { code: "515", name: "Financial revenue", nameVi: "Doanh thu tài chính (lãi NH)", type: "REVENUE", normalBalance: "CREDIT" },
  { code: "521", name: "Sales deductions", nameVi: "Giảm trừ doanh thu (chiết khấu, trả hàng)", type: "REVENUE", normalBalance: "DEBIT" },
  { code: "711", name: "Other income", nameVi: "Thu nhập khác", type: "REVENUE", normalBalance: "CREDIT" },

  // ===== CHI PHÍ (6xx, 8xx) =====
  { code: "632", name: "Cost of goods sold", nameVi: "Giá vốn hàng bán", type: "COST_OF_GOODS_SOLD", normalBalance: "DEBIT" },
  { code: "635", name: "Financial expenses", nameVi: "Chi phí tài chính (phí NH, lãi vay)", type: "EXPENSE", normalBalance: "DEBIT" },
  { code: "641", name: "Selling expenses", nameVi: "Chi phí bán hàng", type: "EXPENSE", normalBalance: "DEBIT" },
  { code: "6411", name: "Sales staff salaries", nameVi: "Lương nhân viên bán hàng", type: "EXPENSE", normalBalance: "DEBIT", parentCode: "641" },
  { code: "6417", name: "Marketing & advertising", nameVi: "Chi phí marketing, quảng cáo", type: "EXPENSE", normalBalance: "DEBIT", parentCode: "641" },
  { code: "6418", name: "Other selling costs", nameVi: "Chi phí bán hàng khác (vận chuyển...)", type: "EXPENSE", normalBalance: "DEBIT", parentCode: "641" },
  { code: "642", name: "General & admin expenses", nameVi: "Chi phí quản lý doanh nghiệp", type: "EXPENSE", normalBalance: "DEBIT" },
  { code: "6421", name: "Admin staff salaries", nameVi: "Lương quản lý, văn phòng", type: "EXPENSE", normalBalance: "DEBIT", parentCode: "642" },
  { code: "6423", name: "Office supplies", nameVi: "Văn phòng phẩm", type: "EXPENSE", normalBalance: "DEBIT", parentCode: "642" },
  { code: "6427", name: "Rent & utilities", nameVi: "Thuê mặt bằng, điện nước", type: "EXPENSE", normalBalance: "DEBIT", parentCode: "642" },
  { code: "6428", name: "Other admin costs", nameVi: "Chi phí quản lý khác", type: "EXPENSE", normalBalance: "DEBIT", parentCode: "642" },
  { code: "811", name: "Other expenses", nameVi: "Chi phí khác", type: "EXPENSE", normalBalance: "DEBIT" },
  { code: "821", name: "Corporate income tax expense", nameVi: "Chi phí thuế TNDN", type: "EXPENSE", normalBalance: "DEBIT" },
  { code: "911", name: "Income summary", nameVi: "Xác định kết quả kinh doanh", type: "EXPENSE", normalBalance: "DEBIT" },
];

const TAX_RATES = [
  { code: "VAT0", name: "VAT 0%", rate: "0", description: "Hàng xuất khẩu, không chịu thuế" },
  { code: "VAT5", name: "VAT 5%", rate: "5", description: "Hàng hóa thiết yếu" },
  { code: "VAT8", name: "VAT 8%", rate: "8", description: "Mức giảm tạm thời" },
  { code: "VAT10", name: "VAT 10%", rate: "10", description: "Mức thuế phổ biến" },
];

const EXPENSE_CATEGORIES = [
  { code: "RENT", name: "Thuê mặt bằng", accountCode: "6427" },
  { code: "UTILITIES", name: "Điện - Nước - Internet", accountCode: "6427" },
  { code: "MARKETING", name: "Marketing & Quảng cáo", accountCode: "6417" },
  { code: "SHIPPING", name: "Vận chuyển - Giao hàng", accountCode: "6418" },
  { code: "OFFICE", name: "Văn phòng phẩm", accountCode: "6423" },
  { code: "SALARY_ADMIN", name: "Lương quản lý", accountCode: "6421" },
  { code: "SALARY_SALES", name: "Lương nhân viên bán hàng", accountCode: "6411" },
  { code: "BANK_FEE", name: "Phí ngân hàng", accountCode: "635" },
  { code: "TRAVEL", name: "Công tác phí", accountCode: "6428" },
  { code: "REPAIR", name: "Sửa chữa - Bảo trì", accountCode: "6428" },
  { code: "TAX_OTHER", name: "Lệ phí, thuế khác", accountCode: "6428" },
  { code: "OTHER", name: "Chi phí khác", accountCode: "811" },
  { code: "REFUND", name: "Hoàn tiền khách hàng", accountCode: "521" },
  { code: "SALARY", name: "Lương nhân viên", accountCode: "6421" },
  { code: "INVENTORY_COST", name: "Thanh toán NCC / nhập hàng", accountCode: "6428" },
];

async function seedAccounts() {
  console.log("→ Seeding Chart of Accounts...");
  // First pass: create accounts without parent
  for (const acc of ACCOUNTS) {
    await prisma.account.upsert({
      where: { code: acc.code },
      update: {
        name: acc.name,
        nameVi: acc.nameVi,
        type: acc.type,
        normalBalance: acc.normalBalance,
        isCash: !!acc.isCash,
      },
      create: {
        code: acc.code,
        name: acc.name,
        nameVi: acc.nameVi,
        type: acc.type,
        normalBalance: acc.normalBalance,
        isCash: !!acc.isCash,
      },
    });
  }
  // Second pass: link parent
  for (const acc of ACCOUNTS) {
    if (acc.parentCode) {
      const parent = await prisma.account.findUnique({ where: { code: acc.parentCode } });
      if (parent) {
        await prisma.account.update({
          where: { code: acc.code },
          data: { parentId: parent.id },
        });
      }
    }
  }
  console.log(`  ✅ ${ACCOUNTS.length} accounts`);
}

async function seedTaxRates() {
  console.log("→ Seeding Tax rates...");
  for (const t of TAX_RATES) {
    await prisma.taxRate.upsert({
      where: { code: t.code },
      update: { name: t.name, rate: t.rate, description: t.description },
      create: t,
    });
  }
  console.log(`  ✅ ${TAX_RATES.length} tax rates`);
}

async function seedExpenseCategories() {
  console.log("→ Seeding Expense categories...");
  for (const c of EXPENSE_CATEGORIES) {
    const account = await prisma.account.findUnique({ where: { code: c.accountCode } });
    if (!account) {
      console.warn(`  ⚠️  Account ${c.accountCode} not found for ${c.code}`);
      continue;
    }
    await prisma.expenseCategory.upsert({
      where: { code: c.code },
      update: { name: c.name, accountId: account.id },
      create: { code: c.code, name: c.name, accountId: account.id },
    });
  }
  console.log(`  ✅ ${EXPENSE_CATEGORIES.length} expense categories`);
}

async function seedDefaultBank() {
  console.log("→ Seeding default bank account (optional)...");
  const exists = await prisma.bankAccount.findFirst();
  if (exists) {
    console.log("  ⏭  Bank account already exists, skipping");
    return;
  }
  const acc112 = await prisma.account.findUnique({ where: { code: "112" } });
  if (!acc112) return;
  await prisma.bankAccount.create({
    data: {
      accountNumber: "0123456789",
      bankName: "Vietcombank",
      accountName: "CANDORY SCENT CO., LTD",
      accountId: acc112.id,
      openingBalance: "0",
      currentBalance: "0",
      isDefault: true,
      note: "Tài khoản ngân hàng mặc định (mẫu)",
    },
  });
  console.log("  ✅ 1 default bank account");
}

async function main() {
  console.log("🌱 Seeding Accounting data...");
  await seedAccounts();
  await seedTaxRates();
  await seedExpenseCategories();
  await seedDefaultBank();
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
