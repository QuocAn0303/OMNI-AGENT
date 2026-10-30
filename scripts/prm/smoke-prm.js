'use strict';

/**
 * scripts/prm/smoke-prm.js — Chạy thử PRM trên DB THẬT, tự dọn dẹp
 *
 * CÁCH CHẠY
 *   npm run smoke:prm            # tạo tenant riêng, kiểm thử, xoá sạch
 *   npm run smoke:prm -- --keep  # giữ lại dữ liệu để mở giao diện xem
 *
 * VÌ SAO CẦN
 * Các test Jest của PRM dùng mock Prisma — chúng chứng minh được logic tính toán
 * và phân quyền, nhưng KHÔNG chứng minh được:
 *   - truy vấn Prisma viết trong service thực sự hợp lệ với schema,
 *   - ràng buộc unique (partnerId, referredPhone) có thật sự chặn trùng không,
 *   - extension multi-tenant có tự chèn tenantId vào cả truy vấn aggregate không,
 *   - đường dẫn /referrals và /roi không bị router gốc nuốt mất.
 * Script này chạy đúng những thứ đó trên Postgres thật.
 *
 * TỰ DỌN DẸP
 * Mọi dữ liệu tạo ra nằm trong một tenant riêng có tiền tố `PRM-SMOKE-`. Xoá
 * tenant sẽ kéo theo (CASCADE) toàn bộ đối tác, lượt giới thiệu và khách hàng liên
 * quan. Không đụng tới dữ liệu thật của bất kỳ tenant nào khác.
 */

require("dotenv").config(); // phải trước require prisma — config/prisma.js đọc DATABASE_URL lúc load
const prisma = require("../../src/config/prisma");
const { runWithTenant } = require("../../src/config/tenantContext");

const partnerService = require("../../src/modules/partners/partner.service");
const referralService = require("../../src/modules/partners/referral.service");
const roiService = require("../../src/modules/partners/roi.service");

const KEEP = process.argv.includes("--keep");
const TAG = "PRM-SMOKE";

let passed = 0;
let failed = 0;

function section(title) {
  console.log(`\n${title}`);
  console.log("-".repeat(72));
}

function check(label, ok, detail) {
  if (ok) {
    passed += 1;
    console.log(`  [OK]   ${label}${detail ? `  (${detail})` : ""}`);
  } else {
    failed += 1;
    console.log(`  [FAIL] ${label}${detail ? `  (${detail})` : ""}`);
  }
}

/** Tạo tenant riêng cho lần chạy này. */
async function createTenant() {
  const stamp = Date.now();
  return prisma.tenant.create({
    data: {
      name: `${TAG}-${stamp}`,
      slug: `${TAG.toLowerCase()}-${stamp}`,
    },
  });
}

/** Xoá sạch mọi tenant mang tiền tố TAG. Dùng cả khi script vừa lỗi. */
async function cleanupAll() {
  const leftovers = await prisma.tenant.findMany({
    where: { name: { startsWith: TAG } },
    select: { id: true, name: true },
  });
  for (const t of leftovers) {
    // Xoá theo thứ tự: khách trước, rồi đối tác (FK partner_referrals sẽ CASCADE).
    // Xoá tenant trước sẽ để lại orphan vì tenantId ở đây là khoá mềm.
    await prisma.customer.deleteMany({ where: { tenantId: t.id } });
    await prisma.crmLead.deleteMany({ where: { tenantId: t.id } });
    await prisma.partnerReferral.deleteMany({ where: { tenantId: t.id } });
    await prisma.partner.deleteMany({ where: { tenantId: t.id } });
    await prisma.tenant.delete({ where: { id: t.id } });
  }
  return leftovers.length;
}

(async () => {
  // Dọn tàn dư của các lần chạy trước bị bỏ dở.
  const stale = await cleanupAll();
  if (stale) console.log(`Đã dọn ${stale} tenant ${TAG} còn sót từ lần chạy trước.`);

  const tenant = await createTenant();
  console.log(`Tenant thử nghiệm: ${tenant.name} (${tenant.id})`);

  try {
    const run = (fn) => runWithTenant(tenant.id, fn);

    // ------------------------------------------------------------------ 1
    section("1. Vòng đời đối tác");
    let affiliate;
    let referrer;
    await run(async () => {
      affiliate = await partnerService.create({
        name: "Đối tác affiliate thử",
        type: "AFFILIATE",
        commissionType: "PERCENT_OF_CLV",
        commissionPercent: 10,
      });
      referrer = await partnerService.create({
        name: "Khách giới thiệu thử",
        type: "REFERRER",
        commissionType: "FIXED_PER_CUSTOMER",
        fixedCommission: 50000,
      });
    });

    check("mã đối tác tự sinh đúng dạng ĐT-YYYYMM-XXXX", /^ĐT-\d{6}-\d{4}$/.test(affiliate.code), affiliate.code);
    // Nhận 10 (nghĩa là 10%) ở đầu vào. Ra API phải trả lại ĐÚNG 10, còn trong
    // DB lưu thẻ phân 0.1 — kiểm tra cả hai vì lỗi quên chia 100 là lỗi làm hoa
    // hồng tăng gấp 100 lần mà mọi thứ vẫn "chạy bình thường".
    check("ra API trả commissionPercent = 10 (đơn vị phần trăm)", affiliate.commissionPercent === 10, String(affiliate.commissionPercent));
    const storedRate = await run(() => prisma.partner.findUnique({ where: { id: affiliate.id }, select: { commissionRate: true } }));
    check("trong DB lưu commissionRate = 0.1 (thẻ phân)", Number(storedRate.commissionRate) === 0.1, String(storedRate.commissionRate));
    check("fixedCommission giữ nguyên số tiền", Number(referrer.fixedCommission) === 50000, String(referrer.fixedCommission));
    check("mặc định isActive = true", affiliate.isActive === true);

    let dupCodeFailed = false;
    await run(async () => {
      try {
        await partnerService.create({ code: affiliate.code, name: "Trùng mã" });
      } catch {
        dupCodeFailed = true;
      }
    });
    check("tạo trùng mã đối tác bị chặn", dupCodeFailed);

    // ------------------------------------------------------------------ 2
    section("2. Lượt giới thiệu");
    let referral;
    let referral2;
    await run(async () => {
      referral = await referralService.create({
        partnerId: affiliate.id,
        referredName: "Nguyễn Văn A",
        referredPhone: "0900000001",
      });
      referral2 = await referralService.create({
        partnerId: affiliate.id,
        referredName: "Trần Thị B",
        referredPhone: "0900000002",
      });
    });

    check("mã lượt giới thiệu sinh tự động dạng RF-XXXXXX", /^RF-[0-9A-F]{10}$/.test(referral.referralCode), referral.referralCode);
    check("mặc định chưa chuyển đổi", referral.converted === false);

    let dupPhoneFailed = false;
    await run(async () => {
      try {
        await referralService.create({
          partnerId: affiliate.id,
          referredName: "Nguyễn Văn A (lại)",
          referredPhone: "0900000001",
        });
      } catch {
        dupPhoneFailed = true;
      }
    });
    check("cùng đối tác + cùng số điện thoại → chặn trùng (ràng buộc DB)", dupPhoneFailed);

    let otherPartnerSamePhone = null;
    await run(async () => {
      // Ngược lại: HAI đối tác khác nhau được giới thiệu CÙNG một số là hợp lệ.
      otherPartnerSamePhone = await referralService.create({
        partnerId: referrer.id,
        referredName: "Nguyễn Văn A",
        referredPhone: "0900000001",
      });
    });
    check("hai đối tác khác nhau được giới thiệu cùng số", Boolean(otherPartnerSamePhone));

    // ------------------------------------------------------------------ 3
    section("3. Chuyển đổi + gắn khách hàng (đi đúng đường webhook → deal)");
    let customer;
    await run(async () => {
      // Đường thật: webhook tạo lead có kèo mã đối tác → referral gắn vào lead →
      // deal thắng → `markConverted(leadId)`. Dùng luôn đường này thay vì gọi
      // thẳng hàm, vì nó là thứ đang chạy trên môi trường thật.
      const lead = await prisma.crmLead.create({
        data: {
          leadName: "Nguyễn Văn A",
          mobileNo: "0900000001",
          status: "QUALIFIED",
          // `source` là khoá nối: webhook ghi mã đối tác vào đây, và phễu chuyển đổi
          // dùng nó để gom lead theo đối tác.
          source: affiliate.code,
        },
      });
      await referralService.attachToLead({
        partnerCode: affiliate.code,
        lead,
      });

      customer = await prisma.customer.create({
        data: {
          name: "Nguyễn Văn A",
          phone: "0900000001",
          clvPredicted: 10_000_000,
          totalSpent: 4_000_000,
          acquiredCost: 500_000,
        },
      });

      const r = await referralService.markConverted(lead.id, customer.id);
      check("markConverted trả về đúng số dòng đã cập nhật", r.updated === 1, JSON.stringify(r));
    });

    const afterConvert = await run(() => referralService.getById(referral.id));
    check("lượt giới thiệu đã đánh dấu chuyển đổi", afterConvert.converted === true);
    check("ghi thời điểm chuyển đổi", Boolean(afterConvert.convertedAt));
    check("gắn đúng mã khách hàng", afterConvert.customerId === customer.id);

    const customerBack = await run(() => prisma.customer.findUnique({ where: { id: customer.id } }));
    check("ghi ngược partnerReferralId lên khách (tra cứu được chiều ngược)", customerBack.partnerReferralId === referral.id);
    check("chi phí thu hút được giữ trên hồ sơ khách", Number(customerBack.acquiredCost) === 500_000, String(customerBack.acquiredCost));

    // ------------------------------------------------------------------ 4
    section("4. Phễu chuyển đổi");
    const funnel = await run(() => referralService.funnel());
    const forAffiliate = funnel.find((f) => f.partnerId === affiliate.id);
    check("phễu trả về mảng cho từng đối tác", Array.isArray(funnel) && funnel.length >= 2, `${funnel.length} đối tác`);
    check("đủ 4 mốc phễu", forAffiliate.funnel.length === 4, forAffiliate.funnel.map((s) => s.stage).join("→"));
    check(
      "mốc cuối là CONVERTED (khớp enum CrmLeadStatus)",
      forAffiliate.funnel[3].stage === "CONVERTED",
      forAffiliate.funnel[3].stage,
    );
    check("tỷ lệ chuyển đổi tính đúng", forAffiliate.conversionRate > 0, `${forAffiliate.conversionRate}%`);

    // ------------------------------------------------------------------ 5
    section("5. ROI — dự báo vs thực tế");
    const predicted = await run(() => roiService.ranking({ metric: "predicted" }));
    const actual = await run(() => roiService.ranking({ metric: "actual" }));

    const rowP = predicted.partners.find((p) => p.partnerId === affiliate.id);
    const rowA = actual.partners.find((p) => p.partnerId === affiliate.id);

    check("trả về hàng cho đối tác", Boolean(rowP), rowP ? `${rowP.referrals} lượt` : "không có");
    check("giá trị dự báo = CLV dự báo của khách", rowP.predictedValue === 10_000_000, String(rowP.predictedValue));
    check("giá trị thực tế = tổng chi tiêu", rowA.actualValue === 4_000_000, String(rowA.actualValue));
    check("độ phủ = 100% khi khách có CLV dự báo", rowP.coverage === 100, `${rowP.coverage}%`);
    check("hoa hồng 10% × 10.000.000 = 1.000.000", rowP.commission === 1_000_000, String(rowP.commission));
    check("chi phí thu hút 500.000 được trừ khỏi lợi nhuận ròng", rowP.acquisitionCost === 500_000, String(rowP.acquisitionCost));
    check("lợi nhuận ròng = 10.000.000 − 1.000.000 − 500.000", rowP.netProfit === 8_500_000, String(rowP.netProfit));

    check(
      "HOA HỒNG KHÔNG ĐỔI khi đổi metric (tiền phải trả không phải số dự báo)",
      rowP.commission === rowA.commission,
      `predicted=${rowP.commission} actual=${rowA.commission}`,
    );
    check("lợi nhuận ròng ĐỔI theo metric (đúng, vì giá trị khách đổi)", rowP.netProfit !== rowA.netProfit, `predicted=${rowP.netProfit} actual=${rowA.netProfit}`);
    check("cột actualValue không đổi theo metric", rowP.actualValue === rowA.actualValue, String(rowP.actualValue));

    const rowFixed = actual.partners.find((p) => p.partnerId === referrer.id);
    check("cách cố định: 50.000/khách chuyển đổi", rowFixed.commission === 0 || rowFixed.commission === 50_000, String(rowFixed.commission));

    check("tổng số liệu khớp tổng dòng", predicted.totals.referrals === predicted.partners.reduce((s, p) => s + p.referrals, 0));
    check("tỷ lệ chuyển đổi toàn hệ thống có tính", typeof predicted.totals.overallConversionRate === "number", String(predicted.totals.overallConversionRate));

    // ------------------------------------------------------------------ 6
    section("6. Cô lập tenant");
    const otherTenant = await createTenant();
    try {
      // Dùng đúng tên trường service trả về (`partners` / `referrals`). Trước đây
      // đoạn này đọc `.data` — vốn là `undefined`, nên `undefined.length` biến thành
      // 0 và kiểm tra "không thấy gì" LUÔN đạt, kể cả khi rò dữ liệu thật. Một
      // kiểm tra luôn đạt thì tệ hơn không có kiểm tra.
      const leaked = await runWithTenant(otherTenant.id, () => partnerService.list({}));
      check(
        "tenant khác KHÔNG thấy đối tác của tenant này",
        Array.isArray(leaked.partners) && leaked.partners.length === 0,
        `partners=${JSON.stringify(leaked.partners && leaked.partners.length)}`,
      );
      check("pagination.total cũng phải bằng 0", leaked.pagination.total === 0, String(leaked.pagination.total));

      const leakReferrals = await runWithTenant(otherTenant.id, () => referralService.list({}));
      check(
        "tenant khác KHÔNG thấy lượt giới thiệu của tenant này",
        Array.isArray(leakReferrals.referrals) && leakReferrals.referrals.length === 0,
        `referrals=${JSON.stringify(leakReferrals.referrals && leakReferrals.referrals.length)}`,
      );

      const leakRoi = await runWithTenant(otherTenant.id, () => roiService.ranking({ metric: "predicted" }));
      check("tenant khác KHÔNG thấy ROI của tenant này", Array.isArray(leakRoi.partners) && leakRoi.partners.length === 0, `partners=${JSON.stringify(leakRoi.partners && leakRoi.partners.length)}`);
    } finally {
      await prisma.customer.deleteMany({ where: { tenantId: otherTenant.id } });
      await prisma.crmLead.deleteMany({ where: { tenantId: otherTenant.id } });
      await prisma.partnerReferral.deleteMany({ where: { tenantId: otherTenant.id } });
      await prisma.partner.deleteMany({ where: { tenantId: otherTenant.id } });
      await prisma.tenant.delete({ where: { id: otherTenant.id } });
    }

    // ------------------------------------------------------------------ 7
    section("7. Xoá mềm giữ lịch sử");
    let deactivated;
    await run(async () => {
      deactivated = await partnerService.deactivate(affiliate.id);
    });
    check("ngừng hoạt động đặt isActive=false", deactivated.isActive === false);
    check("KHÔNG xoá dòng (giữ chứng cứ tính hoa hồng)", Boolean(deactivated.id));

    const stillThere = await run(() => referralService.list({ partnerId: affiliate.id }));
    check(
      "lượt giới thiệu vẫn còn sau khi ngừng đối tác",
      Array.isArray(stillThere.referrals) && stillThere.referrals.length >= 2,
      `${stillThere.referrals && stillThere.referrals.length} lượt`,
    );

    await run(async () => {
      await partnerService.restore(affiliate.id);
    });
    check("khoá lại được", (await partnerService.getById(affiliate.id)).isActive === true);
  } finally {
    if (KEEP) {
      console.log(`\n--keep: giữ lại tenant ${tenant.name} để mở giao diện xem.`);
    } else {
      const removed = await cleanupAll();
      console.log(`\nDọn dẹp: đã xoá ${removed} tenant ${TAG}.`);
    }
  }

  console.log("\n" + "=".repeat(72));
  console.log(`KẾT QUẢ: ${passed} đạt, ${failed} không đạt`);
  console.log("=".repeat(72));
  process.exit(failed === 0 ? 0 : 1);
})()
  .catch(async (e) => {
    console.error("\nLỖI:", e.message);
    if (e.stack) console.error(e.stack.split("\n").slice(0, 6).join("\n"));
    try {
      if (KEEP) console.log(`--keep: giữ lại tenant ${TAG}-* để kiểm tra.`);
      else await cleanupAll();
    } catch (ce) {
      console.error("Dọn dẹp lỗi:", ce.message);
    }
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });