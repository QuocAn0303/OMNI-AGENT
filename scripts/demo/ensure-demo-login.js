/**
 * scripts/demo/ensure-demo-login.js — Bật đăng nhập + gói cướng cho tenant MÔ PHỎNG
 *
 * ============================================================================
 * VÌ SAO FILE NÀY TỒN TẠI
 * ============================================================================
 * Tenant demo `omni-demo-mo-phong` có dữ liệu đẹp (500 SKU, hàng trăm SKU dưới
 * `minStock`) nhưng script `data:import` cố tình tạo user với mật khẩu
 * `khong-dang-nhap-duoc` — đúng nghĩa, vì dữ liệu mô phỏng không được dùng để
 * đăng nhập chứng minh.
 *
 * Hệ quả thực tế: khi trình bày, chỉ đăng nhập được bằng tenant CANDORY (20 SKU,
 * không có SKU nào dưới ROP) ⇒ màn hình "Nhập hàng" và "Đề xuất nhập" đều TRỐNG.
 * Đó là lý do tính năng quan trọng nhất của Vòng 2 không thấy được trên sân khấu.
 *
 * Script này bật lại đúng hai thứ cho tenant demo, và làm thế một cách idempotent:
 *   1. mật khẩu đăng nhập cho user demo
 *   2. subscription ACTIVE gói `business` (gói duy nhất có `ai` + `replenishment`)
 *
 * KHÔNG sửa `data:import` vì smoke của nó có kỳ vọng teardown nghiêm ngặt; và
 * KHÔNG đụng tenant thật (`candory-scent`) — số 82 đơn / 89.862.000 VND là số đã
 * ký, không được thay đổi.
 *
 * Chạy:  npm run demo:login
 * Dry-run mặc định (không ghi). Ghi thật: --apply
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", "..", ".env") });

const bcrypt = require("bcrypt");
const prisma = require("../../src/config/prisma");
const logger = require("../../src/utils/logger");

const SLUG = "omni-demo-mo-phong";
const DEMO_EMAIL = "demo-mo-phong@local.invalid";
const PLAN_KEY = "business";
// Mật khẩu demo công khai, chỉ dùng cho tenant MÔ PHỎNG trên máy trình bày.
const DEMO_PASSWORD = process.env.DEMO_TENANT_PASSWORD || "Demo123456";
// `TenantSubscription.endDate` là DateTime BẮT BUỘC (không nullable, không default).
const DEMO_END_DATE = new Date(Date.now() + 365 * 24 * 3600 * 1000);

const APPLY = process.argv.includes("--apply");

async function main() {
  const tenant = await prisma.tenant.findFirst({
    where: { OR: [{ slug: SLUG }, { name: { contains: "OMNI DEMO" } }] },
    select: { id: true, name: true, slug: true },
  });

  if (!tenant) {
    console.error(
      "KHONG TIM THAY tenant demo. Chay truoc:  npm run data:import -- --reset --apply --days 34",
    );
    process.exitCode = 1;
    return;
  }

  const user = await prisma.user.findFirst({
    where: { tenantId: tenant.id, email: DEMO_EMAIL },
    select: { id: true, email: true, role: true, isActive: true, emailVerified: true, registrationStatus: true },
  });
  if (!user) {
    console.error(`Khong tim thay user ${DEMO_EMAIL} trong tenant demo.`);
    process.exitCode = 1;
    return;
  }

  const plan = await prisma.subscriptionPlan.findUnique({ where: { key: PLAN_KEY } });
  if (!plan) {
    console.error(`Khong tim thay plan "${PLAN_KEY}". Chay: npm run db:seed:accounting hoac db:seed`);
    process.exitCode = 1;
    return;
  }

  const existingSub = await prisma.tenantSubscription.findFirst({
    where: { tenantId: tenant.id, status: { in: ["ACTIVE", "TRIAL"] } },
    select: { id: true, status: true, plan: { select: { key: true } } },
    orderBy: { createdAt: "desc" },
  });

  const hash = bcrypt.hashSync(DEMO_PASSWORD, 12);
  const allowed = (plan.features?.allowedModules || []).slice();
  // DB thường được seed TRƯỚC khi `ai`/`replenishment` được thêm vào danh sách —
  // nếu không vá ở đây thì gate module sẽ chặn chính tenant demo.
  const missingModules = ["ai", "replenishment"].filter((m) => !allowed.includes(m));
  const modulesFixed = missingModules.length
    ? Array.from(new Set([...allowed, ...missingModules]))
    : null;

  console.log("=== TRUOC KHI GHI ===");
  console.log("tenant          :", tenant.name, `(${tenant.slug || tenant.id})`);
  console.log("user            :", user.email, `role=${user.role} active=${user.isActive} verified=${user.emailVerified} status=${user.registrationStatus}`);
  console.log("subscription    :", existingSub ? `${existingSub.status} / ${existingSub.plan.key}` : "(chua co)");
  console.log("plan se gan     :", plan.name, `(${plan.key})`);
  console.log("module con thieu:", missingModules.length ? missingModules.join(", ") : "(khong)");
  console.log("mode            :", APPLY ? "APPLY (ghi that)" : "DRY-RUN (them --apply de ghi)");

  if (!APPLY) {
    console.log("\n=> Khong gi (dry-run). Them --apply de ghi.");
    await prisma.$disconnect();
    return;
  }

if (!user.isActive || !user.emailVerified || user.registrationStatus !== "ACTIVE") {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        isActive: true,
        // Không có hộp thư trên máy trình bày ⇒ không thể click link xác minh.
        // User mô phỏng thì đánh dấu đã xác minh là đúng và có thể kiểm chứng lại.
        emailVerified: true,
        registrationStatus: "ACTIVE",
        mustChangePassword: false,
      },
    });
    console.log("=> Da bat emailVerified + registrationStatus=ACTIVE cho user demo");
  }
  await prisma.user.update({ where: { id: user.id }, data: { password: hash } });

  if (modulesFixed) {
    await prisma.subscriptionPlan.update({
      where: { id: plan.id },
      data: { features: { ...plan.features, allowedModules: modulesFixed } },
    });
    console.log("=> Da bo sung allowedModules cho plan", PLAN_KEY, ":", missingModules.join(", "));
  }

  if (existingSub) {
    if (existingSub.plan.key !== PLAN_KEY) {
      await prisma.tenantSubscription.update({
        where: { id: existingSub.id },
        data: { planId: plan.id, status: "ACTIVE", startDate: new Date(), endDate: DEMO_END_DATE },
      });
      console.log("=> Da doi plan cua subscription sang", PLAN_KEY);
    } else {
      await prisma.tenantSubscription.update({
        where: { id: existingSub.id },
        data: { status: "ACTIVE", endDate: DEMO_END_DATE },
      });
      console.log("=> Subscription da ACTIVE, giu nguyen plan", PLAN_KEY);
    }
  } else {
    await prisma.tenantSubscription.create({
      data: { tenantId: tenant.id, planId: plan.id, status: "ACTIVE", startDate: new Date(), endDate: DEMO_END_DATE },
    });
    console.log("=> Da tao subscription ACTIVE /", PLAN_KEY);
  }

  // Invalidate cache gói trong tiến trình này (không ảnh hưởng tiến trình khác —
  // cache sống 30s và tự hết hạn).
  const { invalidatePlanCache } = require("../../src/middleware/plan.middleware");
  invalidatePlanCache(tenant.id);

  console.log("\n=== DANG NHAP DEMO ===");
  console.log("email   :", DEMO_EMAIL);
  console.log("password:", DEMO_PASSWORD);
  console.log("LUU Y   : tenant MÔ PHỎNG — khach that khong bao gio nam o day.");

  await prisma.$disconnect();
}

main().catch(async (e) => {
  logger.error(`[demo:login] that bai: ${String(e && e.message ? e.message : e)}`);
  console.error("ERR", e.message);
  try { await prisma.$disconnect(); } catch {}
  process.exit(1);
});
