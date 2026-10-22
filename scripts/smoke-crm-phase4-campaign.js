/**
 * Smoke Phase 4 — Campaign compliance + tracking trên DB THẬT (mục 3 & 4)
 *
 * Vì sao cần script này mà unit test chưa đủ:
 * - Unit test mock Prisma → không kiểm được FK thật của `CampaignTracking`
 *   (campaignId / recipientId trỏ đúng bảng chưa). Migration Phase 4 sửa 2 quan hệ
 *   đang trỏ sai; chỉ DB mới xác nhận được.
 * - Token là `crypto.randomBytes` + cột `@unique`: cần xác nhận 2 token của 2
 *   recipient không trùng và lookup theo token hoạt động.
 * - `applyUnsubscribe` chạy `updateMany` xoá tenant theo kênh — cần xác nhận
 *   KHÔNG xoá nhầm recipient của tenant khác (rủi ro multi-tenant thật).
 *
 * Chạy: node scripts/smoke-crm-phase4-campaign.js
 * Giữ dữ liệu để debug: -- --keep
 */
require("dotenv").config();
const { assertLocalDb } = require("./lib/assert-local-db");
assertLocalDb("smoke-crm-phase4-campaign");
const { captureBaseline, verifyTeardown } = require("./lib/teardown");
const prisma = require("../src/config/prisma");
const { runWithTenant } = require("../src/config/tenantContext");
const tracking = require("../src/modules/crm/campaign-tracking.service");

const KEEP = process.argv.includes("--keep");
let pass = 0;
let fail = 0;

const check = (label, cond, extra = "") => {
  if (cond) {
    pass += 1;
    console.log(`  OK   ${label}${extra ? ` — ${extra}` : ""}`);
  } else {
    fail += 1;
    console.log(`  FAIL ${label}${extra ? ` — ${extra}` : ""}`);
  }
};
const section = (t) => console.log(`\n${t}`);

const TAG = `p4camp_${Date.now()}`;

// Id cần dọn — ghi dần khi tạo để `cleanup()` chạy được cả khi script lỗi giữa chừng.
const created = { tenants: [], users: [], customers: [] };
let cleanupRef = null;

/**
 * Dọn dẹp — ĐƯỢC gọi cả khi script lỗi.
 *
 * Bản đầu tiên chỉ dọn ở cuồng thành công VÀ nuốt lỗi bằng `.catch(() => {})`.
 * Hậu quả: 2 lần chạy lỗi để lại 2 tenant + 4 khách + 2 user trong DB, các
 * smoke script sau đọc nhầm dữ liệu rác. Giờ: ném lỗi ra, gọi cả trong catch.
 */
const cleanup = async () => {
  cleanupRef = cleanup;
  if (KEEP) {
    console.log("  --keep: giữ dữ liệu để debug.");
    return;
  }
  const del = async (label, fn) => {
    try {
      const r = await fn();
      console.log(`  ${label}: ${r?.count ?? "ok"}`);
    } catch (e) {
      console.log(`  ${label}: KHÔNG xoá được — ${e.message.split("\n")[0]}`);
    }
  };

  const cid = created.customers;
  if (cid.length) {
    await del("campaignTracking", () =>
      prisma.campaignTracking.deleteMany({ where: { campaign: { name: { startsWith: TAG } } } }));
    await del("campaignRecipient", () =>
      prisma.campaignRecipient.deleteMany({ where: { customerId: { in: cid } } }));
  }
  await del("customerCampaign", () =>
    prisma.customerCampaign.deleteMany({ where: { name: { startsWith: TAG } } }));
  await del("customerSegment", () =>
    prisma.customerSegment.deleteMany({ where: { name: { startsWith: TAG } } }));
  if (cid.length) await del("customer", () => prisma.customer.deleteMany({ where: { id: { in: cid } } }));
  // `campaigns.service` ghi audit log; không có FK tới `tenants` ⇒ phải xoá
  // TRƯỚC tenant, nếu không sẽ thành MỒ CÔI-TENANT.
  if (created.tenants.length) await del("auditLog", () => prisma.auditLog.deleteMany({ where: { tenantId: { in: created.tenants } } }).then(() => ({})));
  if (created.users.length) await del("user", () => prisma.user.deleteMany({ where: { id: { in: created.users } } }));
  if (created.tenants.length) await del("tenant", () => prisma.tenant.deleteMany({ where: { id: { in: created.tenants } } }));

  // Verify: không còn gì sót
  const left = await prisma.tenant.count({ where: { slug: { startsWith: TAG } } });
  const leftCust = cid.length ? await prisma.customer.count({ where: { id: { in: cid } } }) : 0;
  const leftUser = created.users.length
    ? await prisma.user.count({ where: { id: { in: created.users } } })
    : 0;
  console.log(`  Còn sót: tenant=${left} customer=${leftCust} user=${leftUser}`);
  if (left || leftCust || leftUser) {
    fail += 1;
    console.log("  FAIL dọn dẹp chưa sạch");
  } else {
    pass += 1;
    console.log("  OK   dọn dẹp sạch, không sót dữ liệu test");
  }

  // Verify dùng chung: bắt cả trường hợp bảng KHÔNG nằm trong danh sách trên
  // bị rò, và bắt mồ côi-tenant tăng thêm so với baseline lúc bắt đầu.
  try {
    await verifyTeardown(created.tenants, prisma);
  } catch (e) {
    fail += 1;
    console.log(`  FAIL ${e.message}`);
  }
};

(async () => {
  cleanupRef = cleanup; // để catch gọi được
  // Baseline mồ côi-tenant TRƯỚC khi seed (xem scripts/lib/teardown.js).
  await captureBaseline(prisma);
  // ---------------------------------------------------------------- setup
  section("1. Tạo dữ liệu thật (tenant + campaign + recipients)");
  const tenant = await prisma.tenant.create({
    data: { name: `${TAG}-tenant`, slug: TAG, isActive: true },
  });
  created.tenants.push(tenant.id);
  const customerA = await prisma.customer.create({
    data: { tenantId: tenant.id, name: "KH A", phone: "0900000001", isActive: true },
  });
  created.customers.push(customerA.id);
  const customerB = await prisma.customer.create({
    data: { tenantId: tenant.id, name: "KH B", phone: "0900000002", isActive: true },
  });
  created.customers.push(customerB.id);
  // KH thuộc tenant KHÁC — để test rò tenant
  const otherTenant = await prisma.tenant.create({
    data: { name: `${TAG}-other`, slug: `${TAG}_o`, isActive: true },
  });
  created.tenants.push(otherTenant.id);
  const customerOther = await prisma.customer.create({
    data: { tenantId: otherTenant.id, name: "KH C", phone: "0900000003", isActive: true },
  });
  created.customers.push(customerOther.id);
  // CustomerCampaign.createdById là BẮT BUỘC (không default) → cần user thật
  const actor = await prisma.user.create({
    data: {
      tenantId: tenant.id, email: `${TAG}@x.vn`, password: "smoke-test-not-a-real-hash",
      fullName: `${TAG}-actor`, role: "MANAGER", isActive: true,
    },
  });
  created.users.push(actor.id);
  const actorOther = await prisma.user.create({
    data: {
      tenantId: otherTenant.id, email: `${TAG}_o@x.vn`, password: "smoke-test-not-a-real-hash",
      fullName: `${TAG}-actor-o`, role: "MANAGER", isActive: true,
    },
  });
  created.users.push(actorOther.id);

  const campaign = await runWithTenant(tenant.id, () =>
    prisma.customerCampaign.create({
      data: {
        tenantId: tenant.id,
        name: `${TAG}-campaign`,
        channel: "EMAIL",
        subject: "Test",
        bodyTemplate: "Chào {{name}}",
        status: "SENDING",
        createdBy: { connect: { id: actor.id } },
        segment: { create: { tenantId: tenant.id, name: `${TAG}-seg`, rules: {}, createdBy: { connect: { id: actor.id } } } },
        recipients: {
          create: [
            { tenantId: tenant.id, customerId: customerA.id },
            { tenantId: tenant.id, customerId: customerB.id },
          ],
        },
      },
      include: { recipients: true },
    }),
  );
  const [recA, recB] = campaign.recipients;
  console.log(`  tenant=${tenant.name} campaign=${campaign.name} recipients=${campaign.recipients.length}`);

  const recOther = await prisma.campaignRecipient.create({
    data: {
      tenantId: otherTenant.id,
      customerId: customerOther.id,
      campaignId: await runWithTenant(otherTenant.id, async () => {
        const c = await prisma.customerCampaign.create({
          data: {
            tenantId: otherTenant.id, name: `${TAG}-camp-other`, channel: "EMAIL",
            createdBy: { connect: { id: actorOther.id } }, subject: "o", bodyTemplate: "o", status: "SENDING",
            segment: { create: { tenantId: otherTenant.id, name: `${TAG}-seg-o`, rules: {}, createdBy: { connect: { id: actorOther.id } } } },
          },
        });
        return c.id;
      }),
    },
  });

  check("tạo campaign + 2 recipient thành công", campaign.recipients.length === 2);
  check("tạo recipient ở tenant khác thành công", Boolean(recOther.id));

  // ---------------------------------------------------------------- FK thật
  section("2. FK CampaignTracking (migration sửa 2 quan hệ trỏ sai)");
  const badCampaign = await runWithTenant(tenant.id, () =>
    prisma.campaignTracking.create({
      data: { campaignId: "khong-ton-tai-123", recipientId: recA.id, event: "OPEN" },
    }).then(() => null).catch((e) => e.code),
  );
  check("campaignId không tồn tại → FK chặn (P2003)", badCampaign === "P2003", `code=${badCampaign}`);

  const badRecipient = await runWithTenant(tenant.id, () =>
    prisma.campaignTracking.create({
      data: { campaignId: campaign.id, recipientId: "khong-ton-tai-456", event: "OPEN" },
    }).then(() => null).catch((e) => e.code),
  );
  check("recipientId không tồn tại → FK chặn (P2003)", badRecipient === "P2003", `code=${badRecipient}`);

  const recCustomerAsRecipient = await runWithTenant(tenant.id, () =>
    prisma.campaignTracking.create({
      // customerId thay vì recipientId — trước Phase 4 cái này hợp lệ vì FK
      // trỏ nhầm sang customers. Giờ phải bị chặn.
      data: { campaignId: campaign.id, recipientId: customerA.id, event: "OPEN" },
    }).then(() => "CREATED").catch((e) => e.code),
  );
  check(
    "recipientId trỏ customerId (sai schema cũ) → bị FK chặn",
    recCustomerAsRecipient === "P2003",
    `code=${recCustomerAsRecipient}`,
  );

  const nullRecipient = await runWithTenant(tenant.id, () =>
    prisma.campaignTracking.create({
      data: { campaignId: campaign.id, recipientId: null, event: "SENT" },
    }).then((r) => r.id).catch((e) => e.code),
  );
  check("recipientId = NULL (sự kiện cấp chiến dịch) → OK", typeof nullRecipient === "string");

  const badEvent = await runWithTenant(tenant.id, () =>
    prisma.campaignTracking.create({
      data: { campaignId: campaign.id, event: "KHONG_CO_TRONG_ENUM" },
    }).then(() => "CREATED").catch((e) => e.code || e.name),
  );
  check("event ngoài enum → bị chặn", badEvent !== "CREATED", `code=${badEvent}`);

  // ---------------------------------------------------------------- token
  section("3. Token: sinh, duy nhất, lookup theo token");
  const tokA = await runWithTenant(tenant.id, () => tracking.ensureTokens(recA.id, { tracking: true }));
  const tokB = await runWithTenant(tenant.id, () => tracking.ensureTokens(recB.id, { tracking: true }));
  check("ensureTokens sinh unsubscribeToken", Boolean(tokA.unsubscribeToken));
  check("ensureTokens sinh trackingToken", Boolean(tokA.trackingToken));
  check("2 token của 1 người KHÁNG NHAU", tokA.unsubscribeToken !== tokA.trackingToken);
  check("2 người KHÁC NHAU token", tokA.unsubscribeToken !== tokB.unsubscribeToken);
  check("token dài 32 ký tự", tokA.unsubscribeToken.length === 32, `${tokA.unsubscribeToken.length}`);

  const tokA2 = await runWithTenant(tenant.id, () => tracking.ensureTokens(recA.id, { tracking: true }));
  check("idempotent: gọi lại không đổi token", tokA2.unsubscribeToken === tokA.unsubscribeToken);

  const dupToken = await runWithTenant(tenant.id, () =>
    prisma.campaignRecipient.update({ where: { id: recB.id }, data: { unsubscribeToken: tokA.unsubscribeToken } })
      .then(() => "CREATED").catch((e) => e.code),
  );
  check("token trùng → unique constraint chặn (P2002)", dupToken === "P2002", `code=${dupToken}`);

  // ---------------------------------------------------------------- event
  section("4. Ghi sự kiện tracking (SENT/OPEN/CLICK)");
  const sentOk = await runWithTenant(tenant.id, () => tracking.recordSent(recA.id));
  check("recordSent ghi được", sentOk === true);

  const open1 = await runWithTenant(tenant.id, () => tracking.trackOpen(tokA.trackingToken, { ip: "1.2.3.4" }));
  check("OPEN lần đầu được ghi", open1 === true);
  const open2 = await runWithTenant(tenant.id, () => tracking.trackOpen(tokA.trackingToken, { ip: "1.2.3.4" }));
  check("OPEN lần 2 KHÔNG ghi lại (chống phồng tỉ lệ mở)", open2 === false);

  const clickOk = await runWithTenant(tenant.id, () =>
    tracking.trackClick(tokA.trackingToken, "https://shop.vn/sale", { ip: "1.2.3.4" }),
  );
  check("CLICK hợp lệ được ghi + trả URL", clickOk.ok === true && clickOk.url === "https://shop.vn/sale");

  const clickEvil = await runWithTenant(tenant.id, () =>
    tracking.trackClick(tokA.trackingToken, "javascript:alert(1)"),
  );
  check("CLICK javascript: bị chặn", clickEvil.ok === false && clickEvil.reason === "URL_UNSAFE");

  const rows = await runWithTenant(tenant.id, () =>
    prisma.campaignTracking.findMany({ where: { campaignId: campaign.id }, select: { event: true, recipientId: true } }),
  );
  const counts = rows.reduce((m, r) => ({ ...m, [r.event]: (m[r.event] || 0) + 1 }), {});
  check("SENT=1 OPEN=1 CLICK=1 (+1 SENT cấp chiến dịch)", counts.SENT === 2 && counts.OPEN === 1 && counts.CLICK === 1, JSON.stringify(counts));

  // ---------------------------------------------------------------- unsubscribe
  section("5. Unsubscribe — chặn THEO KÊNH, không rò tenant");
  // Tạo thêm 1 campaign nữa của KH A cùng kênh, chưa gửi (PENDING)
  const campaign2 = await runWithTenant(tenant.id, () =>
    prisma.customerCampaign.create({
      data: {
        tenantId: tenant.id, name: `${TAG}-camp2`, channel: "EMAIL", subject: "2", bodyTemplate: "2",
        status: "SCHEDULED",
        createdBy: { connect: { id: actor.id } },
        segment: { create: { tenantId: tenant.id, name: `${TAG}-seg2`, rules: {}, createdBy: { connect: { id: actor.id } } } },
        recipients: { create: [{ tenantId: tenant.id, customerId: customerA.id }] },
      },
      include: { recipients: true },
    }),
  );
  const recA2 = campaign2.recipients[0];

  const un = await runWithTenant(tenant.id, () =>
    tracking.applyUnsubscribe(tokA.unsubscribeToken, "khong muon nua"),
  );
  check("applyUnsubscribe trả found=true", un.found === true && un.alreadyUnsubscribed === false);

  const after = await runWithTenant(tenant.id, () =>
    prisma.campaignRecipient.findMany({
      where: { id: { in: [recA.id, recA2.id] } },
      select: { id: true, unsubscribedAt: true, unsubscribeReason: true },
    }),
  );
  check("recipient của chiến dịch 1 đã bị đánh dấu", after.find((r) => r.id === recA.id).unsubscribedAt !== null);
  check(
    "recipient PENDING của chiến dịch 2 CÙNG khách cũng bị chặn (theo kênh)",
    after.find((r) => r.id === recA2.id).unsubscribedAt !== null,
  );
  check("lý do được lưu", after.find((r) => r.id === recA.id).unsubscribeReason === "khong muon nua");

  const recBafter = await runWithTenant(tenant.id, () =>
    prisma.campaignRecipient.findUnique({ where: { id: recB.id }, select: { unsubscribedAt: true } }),
  );
  check("KH B (khách khác) KHÔNG bị ảnh hưởng", recBafter.unsubscribedAt === null);

  const otherAfter = await prisma.campaignRecipient.findUnique({
    where: { id: recOther.id }, select: { unsubscribedAt: true },
  });
  check("recipient của TENANT KHÁC không bị chặn nhầm", otherAfter.unsubscribedAt === null);

  const again = await runWithTenant(tenant.id, () => tracking.applyUnsubscribe(tokA.unsubscribeToken));
  check("gọi lại lần 2 → idempotent, alreadyUnsubscribed=true", again.alreadyUnsubscribed === true);

  const badToken = await runWithTenant(tenant.id, () => tracking.applyUnsubscribe("token-bogus-xyz"));
  check("token sai → found=false", badToken.found === false);

  // ---------------------------------------------------------------- stats
  section("6. getStats — funnel");
  const stats = await runWithTenant(tenant.id, () => tracking.getStats(campaign.id));
  console.log(`  ${JSON.stringify(stats)}`);
  check("events.SENT >= 1", stats.events.SENT >= 1);
  check("events.OPEN = 1 (chỉ lần đầu)", stats.events.OPEN === 1);
  check("events.CLICK = 1", stats.events.CLICK === 1);
  check("events.UNSUBSCRIBE = 1", stats.events.UNSUBSCRIBE === 1);
  check("openRate là số 0..1 không NaN", !Number.isNaN(stats.openRate) && stats.openRate >= 0);
  check("unsubscribed >= 1", stats.unsubscribed >= 1);

  const emptyStats = await runWithTenant(tenant.id, () => tracking.getStats(recOther.campaignId));
  check("campaign không có event → rate = 0, không NaN", emptyStats.openRate === 0 && !Number.isNaN(emptyStats.clickRate));

  // ---------------------------------------------------------------- dọn dẹp
  section("7. Dọn dẹp");
  await cleanup();

  console.log(`\n--- Kết quả: ${pass} pass / ${fail} fail ---`);
  await prisma.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
})().catch(async (e) => {
  console.error("SMOKE ERROR:", e.message);
  console.error(e.stack?.split("\n").slice(0, 8).join("\n"));
  // Dọn dẹp VẪN phải chạy khi script lỗi — nếu không, dữ liệu rác sót lại và các
  // smoke script sau đọc nhầm (đã xảy ra ở bản đầu).
  if (!KEEP && cleanupRef) {
    try { await cleanupRef(); } catch (ce) { console.error("cleanup lỗi:", ce.message); }
  }
  try { await prisma.$disconnect(); } catch { /* noop */ }
  process.exit(1);
});