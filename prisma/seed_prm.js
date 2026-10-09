'use strict';

/**
 * prisma/seed_prm.js — Dữ liệu mẫu phân hệ quản trị đối tác (PRM)
 *
 * ============================================================================
 * MỤC ĐÍCH
 * Đề cương yêu cầu nhập dữ liệu mẫu. Bảng đối tác và bảng lượt giới thiệu là hai
 * bảng mới, nên nếu không nạp dữ liệu thì báo cáo lợi nhuận ròng trên đối tác mở
 * ra sẽ trống và không trình diễn được gì.
 *
 * Dữ liệu ở đây CỐ TÌNH có tính chất minh hoạ chứ không phải dữ liệu ngẫu nhiên:
 * có cả đối tác giới thiệu nhiều nhưng chuyển đổi kém, có cả đối tác chuyển đổi
 * tốt nhưng quy mô nhỏ. Nhờ vậy khi trình diễn, bảng xếp hạng cho thấy được đúng
 * cái sai lệch mà phân hệ này sinh ra để tránh: xếp theo số khách sẽ ra một thứ
 * tự, xếp theo lợi nhuận sẽ ra một thứ tự khác.
 *
 * ============================================================================
 * AN TOÀN (theo đúng convention của scripts/dataset/import-erp-demo.js)
 *   - `assertLocalDb` chặn chạy nhầm lên DB production.
 *   - DRY-RUN là mặc định. Phải `--apply` mới ghi.
 *   - Tất định: PRNG seed cố định ⇒ chạy lại cho ra CÙNG một bộ dữ liệu.
 *   - Idempotent: đã có đối tác thì bỏ qua. `--reset` để dựng lại.
 *
 * CÁCH CHẠY
 *   node prisma/seed_prm.js            # chỉ xem kế hoạch, KHÔNG ghi
 *   node prisma/seed_prm.js --apply    # ghi thật
 *   node prisma/seed_prm.js --reset    # xoá sạch dữ liệu PRM của tenant này
 */

require("dotenv").config();

const { assertLocalDb } = require("../scripts/lib/assert-local-db");

assertLocalDb("seed:prm");

const prisma = require("../src/config/prisma");
const { runWithTenant } = require("../src/config/tenantContext");
const partnerService = require("../src/modules/partners/partner.service");
const referralService = require("../src/modules/partners/referral.service");

// ---------------------------------------------------------------------------
// Cấu hình
// ---------------------------------------------------------------------------

const TENANT_SLUG = "crm-phase1-demo";
const TENANT_NAME = "CRM DEMO — PHASE 1 (dữ liệu mẫu)";

const PRNG_SEED = 20261008; // cố định ⇒ chạy lại cho ra cùng một bộ dữ liệu

// ---------------------------------------------------------------------------
// Kịch bản đối tác
//
// Mỗi kịch bản là một câu chuyện khác nhau về hiệu quả. Nhóm cố tình chọn các số
// liệu khiến bảng xếp hạng đổi thứ tự khi đổi tiêu chí, vì đó mới là điều báo
// cáo cần chứng minh được.
// ---------------------------------------------------------------------------

const SCENARIOS = [
  {
    code: "ĐT-DEMO-AFF01",
    name: "Cộng đồng bà mẹ online",
    type: "AFFILIATE",
    commissionType: "PERCENT_OF_CLV",
    commissionPercent: 12,
    note: "Quy mô lớn, tỷ lệ chuyển đổi thấp. Cột số khách sẽ đứng đầu.",
    referrals: 120,
    conversionRate: 0.15, // 18/120
    clvRange: [1_800_000, 3_200_000],
    spentRatio: 0.42, // tiền đã thu so với giá trị dự báo
  },
  {
    code: "ĐT-DEMO-REF02",
    name: "Nhóm khách quen thuộc",
    type: "REFERRER",
    commissionType: "FIXED_PER_CUSTOMER",
    fixedCommission: 50_000,
    note: "Quy mô nhỏ nhưng tỷ lệ chuyển đổi cao nhất. Hoa hồng tính theo lần giới thiệu.",
    referrals: 40,
    conversionRate: 0.45, // 18/40
    clvRange: [2_400_000, 5_000_000],
    spentRatio: 0.55,
  },
  {
    code: "ĐT-DEMO-AGE03",
    name: "Đại lý vé máy bay",
    type: "MARKETING_CHANNEL",
    commissionType: "PERCENT_OF_CLV",
    commissionPercent: 6,
    note: "Tỷ lệ thấp vì đây là kênh trả phí cố định, không phải giới thiệu.",
    referrals: 210,
    conversionRate: 0.09, // 19/210
    clvRange: [3_600_000, 9_000_000],
    spentRatio: 0.62,
  },
  {
    code: "ĐT-DEMO-EMP04",
    name: "Nhân viên nội bộ giới thiệu",
    type: "SALES_AGENT",
    commissionType: "PERCENT_OF_CLV",
    commissionPercent: 3,
    note: "Lợi nhuận ròng cao nhờ tỷ lệ hoa hồng thấp, dù số khách ít.",
    referrals: 25,
    conversionRate: 0.6, // 15/25
    clvRange: [2_000_000, 4_200_000],
    spentRatio: 0.5,
  },
  {
    code: "ĐT-DEMO-KOL05",
    name: "Blog review ẩm thực",
    type: "MARKETING_CHANNEL",
    commissionType: "FIXED_PER_CUSTOMER",
    fixedCommission: 120_000,
    note: "Chi phí thu hút cao nên lợi nhuận ròng thấp dù giá trị khách lớn.",
    referrals: 60,
    conversionRate: 0.22, // 13/60
    clvRange: [4_000_000, 7_500_000],
    spentRatio: 0.48,
    acquisitionCost: [300_000, 600_000],
  },
];

// ---------------------------------------------------------------------------
// PRNG tất định
// ---------------------------------------------------------------------------

// mulberry32 — tham số `a` PHẢI nằm ngoài closure. Nếu khai báo `let a = seed` bên
// trong thì mọi lần gọi lại đều trả về cùng một giá trị và dữ liệu sinh ra sẽ
// giống nhau hoàn toàn, tức là "ngẫu nhiên" nhưng không ngẫu nhiên.
const mulberry32 = (seed) => {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const FIRST = ["Nguyễn", "Trần", "Lê", "Phạm", "Hoàng", "Vũ", "Đặng", "Bùi", "Đỗ", "Hồ"];
const MIDDLE = ["Thị", "Văn", "Hữu", "Đức", "Minh", "Ngọc", "Quang", "Thu"];
const LAST = ["An", "Bình", "Cường", "Dũng", "Giang", "Hà", "Hương", "Lan", "Mai", "Nam"];

const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
const between = (rng, lo, hi) => lo + rng() * (hi - lo);

/**
 * Sinh số điện thoại chắc chắn CHƯA có trong bảng khách hàng của tenant.
 *
 * Bảng khách hàng có ràng buộc duy nhất trên cặp (số điện thoại, người thuê), và
 * tenant trình diễn đã có sẵn khách từ lần nạp CRM trước. Sinh số theo bộ đếm
 * đơn thuần sẽ va vào số đã có và làm hỏng giữa chừng lúc nạp. Vì vậy dòng thử
 * tới khi gặp số trống.
 */
async function freshPhone(rng) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const phone = `09${String(10000000 + Math.floor(rng() * 89999999)).slice(0, 8)}`;
    const taken = await prisma.customer.findFirst({ where: { phone }, select: { id: true } });
    if (!taken) return phone;
  }
  // Hết lượt thử thì trả số có kèm mã riêng — vẫn hợp lệ về cú pháp, chỉ là
  // không thể bảo đảm trống. Không ném lỗi ở đây để một va chạm hiếm không làm
  // hỏng cả lần nạp.
  return `09${String(80000000 + Math.floor(rng() * 9999999)).slice(0, 8)}`;
}

// ---------------------------------------------------------------------------
// Kế hoạch (in ra trước khi ghi, để người chạy thấy mình sắp làm gì)
// ---------------------------------------------------------------------------

function buildPlan() {
  let totalReferrals = 0;
  let totalConverted = 0;
  const rows = [];
  for (const s of SCENARIOS) {
    const converted = Math.round(s.referrals * s.conversionRate);
    totalReferrals += s.referrals;
    totalConverted += converted;
    rows.push({
      code: s.code,
      name: s.name,
      type: s.type,
      commission:
        s.commissionType === "PERCENT_OF_CLV"
          ? `${s.commissionPercent}% giá trị khách`
          : `${s.fixedCommission.toLocaleString("vi-VN")}₫ mỗi khách`,
      referrals: s.referrals,
      converted,
      rate: `${Math.round(s.conversionRate * 100)}%`,
    });
  }
  return { rows, totalReferrals, totalConverted };
}

function printPlan(tenantSlug) {
  const { rows, totalReferrals, totalConverted } = buildPlan();
  console.log(`\nKẾ HOẠCH NẠP DỮ LIỆU MẪU PRM — tenant "${tenantSlug}"`);
  console.log("=".repeat(96));
  console.log(
    `${"Mã đối tác".padEnd(16)}${"Tên".padEnd(30)}${"Hoa hồng".padEnd(24)}${"Giới thiệu".padStart(10)}${"Chuyển đổi".padStart(11)}${"Tỷ lệ".padStart(8)}`,
  );
  console.log("-".repeat(96));
  for (const r of rows) {
    console.log(
      `${r.code.padEnd(16)}${r.name.slice(0, 28).padEnd(30)}${r.commission.padEnd(24)}${String(r.referrals).padStart(10)}${String(r.converted).padStart(11)}${r.rate.padStart(8)}`,
    );
  }
  console.log("-".repeat(96));
  console.log(
    `TỔNG: ${SCENARIOS.length} đối tác · ${totalReferrals} lượt giới thiệu · ${totalConverted} khách chuyển đổi · ${totalConverted} hồ sơ khách hàng mới`,
  );
  console.log("=".repeat(96));
}

// ---------------------------------------------------------------------------
// Tenant
// ---------------------------------------------------------------------------

async function ensureTenant() {
  const found = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG }, select: { id: true, slug: true, name: true } });
  if (found) return found;
  const created = await prisma.tenant.create({ data: { slug: TENANT_SLUG, name: TENANT_NAME } });
  console.log(`[seed:prm] Đã tạo tenant mới: ${created.name} (${created.slug})`);
  return created;
}

/**
 * Xoá sạch dữ liệu PRM của tenant.
 *
 * Xoá theo thứ tự khách → lượt giới thiệu → đối tác. Xoá đối tác trước thì khóa
 * ngoại CASCADE sẽ kéo mất lượt giới thiệu, còn khách hàng phải xoá tay vì
 * `partnerReferralId` là khoá mềm, không có khoá ngoại nào động tới.
 */
async function resetTenant(tenantId) {
  const counts = [];
  const n = await prisma.customer.deleteMany({ where: { tenantId, partnerReferralId: { not: null } } });
  counts.push(`khách hàng PRM=${n.count}`);
  const lead = await prisma.crmLead.deleteMany({ where: { tenantId, source: { startsWith: 'ĐT-' } } });
  counts.push(`khách tiềm năng PRM=${lead.count}`);
  const r = await prisma.partnerReferral.deleteMany({ where: { tenantId } });
  counts.push(`lượt giới thiệu=${r.count}`);
  const p = await prisma.partner.deleteMany({ where: { tenantId } });
  counts.push(`đối tác=${p.count}`);

  // Dọn dòng mồ côi có `tenantId = NULL`.
  //
  // Lọc `where: { tenantId }` ở trên KHÔNG bắt được chúng, vì NULL khác mọi giá trị
  // khác kể cả giá trị tenant. Mà `NULL` chỉ có thể do gọi `prisma` ngoài ngữ cảnh
  // tenant — tức là do bug, không phải dữ liệu hợp lệ (cron và script đều chạy
  // trong ngữ cảnh riêng của mình).
  //
  // An toàn: hai bảng này mới thêm, mọi dòng NULL trong đó đều là dư chẫng từ
  // lần chạy sai. Vẫn in ra số lượng để người đọc thấy rõ, không xoá âm thầm.
  const orphanLead = await prisma.crmLead.deleteMany({ where: { tenantId: null, source: { startsWith: 'ĐT-' } } });
  if (orphanLead.count) counts.push(`khách tiềm năng MỒ CÔI (tenantId NULL)=${orphanLead.count}`);
  const orphanRef = await prisma.partnerReferral.deleteMany({ where: { tenantId: null } });
  if (orphanRef.count) counts.push(`lượt giới thiệu MỒ CÔI (tenantId NULL)=${orphanRef.count}`);
  const orphanPartner = await prisma.partner.deleteMany({ where: { tenantId: null } });
  if (orphanPartner.count) counts.push(`đối tác MỒ CÔI (tenantId NULL)=${orphanPartner.count}`);

  return counts;
}

// ---------------------------------------------------------------------------
// Nạp
// ---------------------------------------------------------------------------

/**
 * Nạp dữ liệu, CHẠY BÊN TRONG ngữ cảnh tenant.
 *
 * `runWithTenant` là bắt buộc, không phải cho đẹp: extension multi-tenant tự chèn
 * `tenantId` vào mọi truy vấn lấy từ ngữ cảnh này. Gọi ngoài ngữ cảnh thì mọi
 * dòng ghi ra đều có `tenantId = NULL` — dữ liệu nằm trong DB nhưng không ai đọc
 * được, và báo cáo ra rỗng trong khi script báo "đã nạp thành công".
 *
 * Chạy lại `node prisma/seed_prm.js --reset --apply` để dọn các dòng `NULL` sót
 * lại từ lần chạy sai trước.
 */
async function seed() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG }, select: { id: true } });
  if (!tenant) throw new Error(`chưa có tenant "${TENANT_SLUG}"`);
  return runWithTenant(tenant.id, async () => {
    const rng = mulberry32(PRNG_SEED);
    const stats = { partners: 0, referrals: 0, converted: 0, customers: 0, leads: 0 };

    for (const s of SCENARIOS) {
      const partner = await partnerService.create({
        code: s.code,
        name: s.name,
        type: s.type,
        commissionType: s.commissionType,
        commissionPercent: s.commissionType === "PERCENT_OF_CLV" ? s.commissionPercent : undefined,
        fixedCommission: s.commissionType === "FIXED_PER_CUSTOMER" ? s.fixedCommission : undefined,
        contactName: `${pick(rng, FIRST)} ${pick(rng, LAST)}`,
        phone: `0900${String(100000 + stats.partners * 137).slice(0, 6)}`,
        notes: s.note,
      });
      stats.partners += 1;

      const convertedCount = Math.round(s.referrals * s.conversionRate);

      // Lượt giới thiệu: đặt ngày rải rác trong bốn tháng gần nhất để báo cáo theo
      // thời gian sau này có dữ liệu để mà vẽ.
      for (let i = 0; i < s.referrals; i += 1) {
        const phoneSeqValue = await freshPhone(rng);
        const referral = await referralService.create({
          partnerId: partner.id,
          referredName: `${pick(rng, FIRST)} ${pick(rng, MIDDLE)} ${pick(rng, LAST)}`,
          referredPhone: phoneSeqValue,
          referralDate: new Date(Date.now() - Math.floor(between(rng, 1, 120)) * 86400000),
        });
        stats.referrals += 1;

        if (i >= s.referrals - convertedCount) {
          // Nhóm cuối cùng được coi là đã thành khách. Mô phỏng đúng đường thật:
          // khách tiềm năng đi qua các mốc rồi được đặt trạng thái CONVERTED khi
          // cơ hội bán hàng thắng. Nếu không tạo lead cho nhóm này thì mốc cuối
          // của phễu luôn bằng không, và bảng phễu trông như phần PRM chưa chạy.
          const clv = Math.round(between(rng, s.clvRange[0], s.clvRange[1]));
          const spent = Math.round(clv * s.spentRatio);
          const acq = s.acquisitionCost
            ? Math.round(between(rng, s.acquisitionCost[0], s.acquisitionCost[1]))
            : null;

          const customer = await prisma.customer.create({
            data: {
              name: referral.referredName,
              phone: phoneSeqValue,
              // Giá trị vòng đời dự báo. Có cố ý để một phần khách CHƯA có giá trị
              // dự báo, đúng như dữ liệu thật: khách mới chưa đủ hai đơn hoàn tất
              // thì không dự báo được. Nhờ vậy cột độ phủ trong báo cáo có con số
              // khác 100% và sinh viên thấy được vì sao phải đọc cột đó.
              clvPredicted: rng() < 0.85 ? clv : null,
              totalSpent: spent,
              acquiredCost: acq,
              rfmSegment: pick(rng, ["KHỚI", "TRUNG THÀNH", "TIỀM NĂNG", "NGỦ DONG", "MẤT LIÊN KẾT"]),
            },
          });
          stats.customers += 1;

          const convertedAt = new Date(Date.now() - Math.floor(between(rng, 1, 60)) * 86400000);
          const lead = await prisma.crmLead.create({
            data: {
              leadName: referral.referredName,
              mobileNo: phoneSeqValue,
              status: "CONVERTED",
              source: partner.code,
              convertedAt,
            },
          });
          stats.leads += 1;

          await prisma.partnerReferral.update({
            where: { id: referral.id },
            data: {
              converted: true,
              convertedAt,
              customerId: customer.id,
              // Nối hai chiều: PRM → lead và lead → khách. Thiếu `leadId` ở đây thì
              // `markConverted(leadId)` lúc chạy thật sẽ không tìm thấy dòng nào.
              leadId: lead.id,
            },
          });
          await prisma.customer.update({
            where: { id: customer.id },
            data: { partnerReferralId: referral.id },
          });
          stats.converted += 1;
        } else if (rng() < 0.55) {
          // Lượt chưa thành khách thì tạo một khách tiềm năng đi kèm, đặt ở trạng
          // thái tương ứng với mức độ đi được trong phễu.
          //
          // Phễu gom lead theo trường `source`, đó là trường chứa MÃ ĐỐI TÁC — cùng
          // khoá nối mà giao diện lập trình ghi vào. Không tạo lead thì bảng phễu mở
          // ra toàn số không, và sinh viên không phân biệt được là lỗi hiển thị hay
          // đúng là chưa có dữ liệu.
          const status = pick(rng, ["NEW", "NEW", "CONTACTED", "CONTACTED", "QUALIFIED", "DEAD"]);
          await prisma.crmLead.create({
            data: {
              leadName: referral.referredName,
              mobileNo: phoneSeqValue,
              status,
              source: partner.code,
            },
          });
          stats.leads += 1;
        }
      }
    }
    return stats;
  });
}

// ---------------------------------------------------------------------------

function parseArgs() {
  const argv = process.argv.slice(2);
  const out = { apply: false, reset: false };
  for (const a of argv) {
    if (a === "--apply") out.apply = true;
    else if (a === "--reset") out.reset = true;
  }
  return out;
}

async function main() {
  const args = parseArgs();
  const tenant = await ensureTenant();

  if (args.reset) {
    if (!args.apply) {
      console.log(`[reset] DRY-RUN — sẽ xoá toàn bộ dữ liệu PRM trong tenant "${tenant.slug}".`);
      console.log("[reset] Thêm --apply để xoá thật.");
      await prisma.$disconnect();
      return;
    }
    const counts = await resetTenant(tenant.id);
    console.log(`[reset] Đã xoá: ${counts.join(", ")}`);
    console.log("[reset] Chạy lại `node prisma/seed_prm.js --apply` để dựng lại.");
    await prisma.$disconnect();
    return;
  }

  const existing = await prisma.partner.count({ where: { tenantId: tenant.id } });
  if (existing > 0) {
    console.log(`[seed:prm] Tenant ${tenant.slug} đã có ${existing} đối tác — KHÔNG nhân bản.`);
    console.log("[seed:prm] Dùng --reset để dựng lại từ đầu.");
    await prisma.$disconnect();
    return;
  }

  printPlan(tenant.slug);

  if (!args.apply) {
    console.log("\nDRY-RUN — chưa ghi gì. Thêm --apply để nạp thật.");
    await prisma.$disconnect();
    return;
  }

  const stats = await seed();
  console.log(
    `\n[seed:prm] Đã nạp: ${stats.partners} đối tác · ${stats.referrals} lượt giới thiệu · ` +
      `${stats.converted} khách chuyển đổi · ${stats.customers} hồ sơ khách hàng.`,
  );
  console.log(`[seed:prm] Mở báo cáo tại /prm/roi để xem bảng xếp hạng.`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("[seed:prm] LỖI:", e.message);
  if (e.stack) console.error(e.stack.split("\n").slice(0, 6).join("\n"));
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});