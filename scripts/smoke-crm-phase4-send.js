/**
 * Smoke Phase 4 — `executeCampaign` trên DB THẬT (mục 3 & 4 — hàm lõi)
 *
 * Vì sao script này tách riêng khỏi `smoke-crm-phase4-campaign.js`:
 * Script kia test `campaign-tracking.service` **đơn lẻ**. Nhưng người dùng thật
 * không bao giờ gọi service đó — họ bấm "Gửi ngay" trên UI, đi qua
 * `campaigns.service.executeCampaign`. Giữa hai đường đó còn: segment eval,
 * tạo recipient, batch loop, render template, guard từ chối ngay trước lúc gửi.
 * **Chỉ DB thật mới chạm được toàn bộ chuỗi đó.**
 *
 * Cần verify:
 * - `consentedAt`/`unsubscribedAt` lưu đúng
 * - Recipient đã từ chối KHÔNG bị gửi lại (kể cả lần chạy thứ 2)
 * - Link từ chối + pixel + bọc click xuất hiện trong body gửi đi
 * - Token sinh đúng, khác nhau theo từng recipient
 * - Stats cuối khớp thực tế
 * - Idempotent: chạy lại không gửi trùng
 *
 * SMTP không cấu hình ⇒ `sendEmail` chạy mock mode, log ra Winston. Script này
 * chặn logger để assert được nội dung email mà không cần SMTP thật.
 *
 * Chạy: node scripts/smoke-crm-phase4-send.js
 */
require("dotenv").config();

let pass = 0;
let fail = 0;
const check = (label, cond, extra = "") => {
  if (cond) { pass += 1; console.log(`  OK   ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail += 1; console.log(`  FAIL ${label}${extra ? ` — ${extra}` : ""}`); }
};
const section = (t) => console.log(`\n${t}`);

// ── Chặn SMTP + logger TRƯỚC khi require app code ─────────────────────────
// Mock sendEmail để assert được body/header thật sự mà campaigns.service gửi đi.
const sent = [];
jestLikeMock();
function jestLikeMock() {
  const Module = require("module");
  const originalLoad = Module._load;
  Module._load = function patched(request, parent, isMain) {
    if (request.endsWith("utils/email") || request === "../../utils/email") {
      return {
        sendEmail: async (args) => {
          sent.push({ kind: "EMAIL", ...args });
          if (!args.to) throw new Error("Thiếu địa chỉ email người nhận");
          return { messageId: `smoke-${sent.length}` };
        },
        verifyEmail: async () => true,
        resetTransporter: () => {},
      };
    }
    if (request.endsWith("utils/zalo") || request === "../../utils/zalo") {
      return {
        sendZaloMessage: async (args) => { sent.push({ kind: "ZALO", ...args }); return { ok: true }; },
      };
    }
    return originalLoad.apply(this, arguments);
  };
}

const prisma = require("../src/config/prisma");
const { assertLocalDb } = require("./lib/assert-local-db");
assertLocalDb("smoke-crm-phase4-send");
const { captureBaseline, verifyTeardown } = require("./lib/teardown");
const { runWithTenant } = require("../src/config/tenantContext");
const campaignsService = require("../src/modules/crm/campaigns.service");
const tracking = require("../src/modules/crm/campaign-tracking.service");

const TAG = `p4send_${Date.now()}`;

// Biến giữ id cần dọn — để `cleanup()` chạy được cả khi script lỗi giữa chừng.
const created = { tenant: null, users: [], customers: [], segment: null };

/**
 * Dọn dẹp — ĐƯỢC gọi cả khi script lỗi.
 *
 * Lý do tách riêng thế này: bản đầu tiên chỉ dọn ở cuối luồng thành công. Hai lần
 * chạy lỗi (thiếu field khi tạo campaign) đã để lại 2 tenant + 4 khách + 2 user
 * trong DB ⇒ các smoke script sau đọc nhầm dữ liệu rác. Giờ catch gọi lại hàm này.
 */
const cleanup = async () => {
  if (process.argv.includes("--keep")) {
    console.log("  --keep: giữ dữ liệu để debug.");
    return;
  }
  const del = async (l, f) => {
    try { await f(); console.log(`  ${l}: ok`); }
    catch (e) { console.log(`  ${l}: KHÔNG xoá được — ${e.message.split("\n")[0]}`); }
  };
  if (created.customers.length) {
    await del("campaignTracking", () => prisma.campaignTracking.deleteMany({ where: { campaign: { name: { startsWith: TAG } } } }));
    await del("campaignRecipient", () => prisma.campaignRecipient.deleteMany({ where: { customerId: { in: created.customers } } }));
  }
  await del("customerCampaign", () => prisma.customerCampaign.deleteMany({ where: { name: { startsWith: TAG } } }));
  if (created.segment) await del("customerSegment", () => prisma.customerSegment.delete({ where: { id: created.segment } }).then(() => ({})));
  if (created.customers.length) await del("customer", () => prisma.customer.deleteMany({ where: { id: { in: created.customers } } }));
  // `campaigns.service` ghi audit log khi tạo/đổi chiến dịch. Không có FK tới
  // `tenants` ⇒ xoá tenant xong thì log thành MỒ CÔI-TENANT (đo được 2 dòng
  // mỗi lần chạy). Xoá TRƯỚC tenant.
  if (created.tenant) await del("auditLog", () => prisma.auditLog.deleteMany({ where: { tenantId: created.tenant } }).then(() => ({})));
  if (created.users.length) await del("user", () => prisma.user.deleteMany({ where: { id: { in: created.users } } }));
  if (created.tenant) await del("tenant", () => prisma.tenant.delete({ where: { id: created.tenant } }).then(() => ({})));
  const left = await prisma.tenant.count({ where: { slug: { startsWith: TAG } } });
  if (left) { fail += 1; console.log(`  FAIL còn ${left} tenant sót`); }
  else { pass += 1; console.log("  OK   dọn dẹp sạch"); }

  // Verify dùng chung: bắt cả bảng ngoài danh sách trên bị rò, và bắt
  // mồ côi-tenant tăng thêm so với baseline lúc bắt đầu.
  try {
    await verifyTeardown(created.tenant ? [created.tenant] : [], prisma);
  } catch (e) {
    fail += 1;
    console.log(`  FAIL ${e.message}`);
  }
};

(async () => {
  // Baseline mồ côi-tenant TRƯỚC khi seed (xem scripts/lib/teardown.js).
  await captureBaseline(prisma);
  section("1. Chuẩn bị: tenant, user, khách hàng, segment");
  const tenant = await prisma.tenant.create({ data: { name: `${TAG}`, slug: TAG, isActive: true } });
  created.tenant = tenant.id;
  const actor = await prisma.user.create({
    data: {
      tenantId: tenant.id, email: `${TAG}@x.vn`, password: "smoke-test-not-a-real-hash",
      fullName: `${TAG}`, role: "ADMIN", isActive: true,
    },
  });
  created.users.push(actor.id);

  const mkCustomer = async (n, over = {}) => {
    const c = await runWithTenant(tenant.id, () =>
      prisma.customer.create({
        data: { tenantId: tenant.id, name: `KH ${n}`, email: `kh${n}@${TAG}.vn`, phone: `09000000${n}`, isActive: true, ...over },
      }),
    );
    created.customers.push(c.id);
    return c;
  };
  const c1 = await mkCustomer(1);
  const c2 = await mkCustomer(2);
  const c3 = await mkCustomer(3);   // sẽ từ chối trước khi gửi
  const cNoMail = await mkCustomer(4, { email: null }); // không có email → phải FAILED

  // Segment chọn tất cả khách của tenant
  const segment = await runWithTenant(tenant.id, () =>
    prisma.customerSegment.create({
      data: {
        tenantId: tenant.id, name: `${TAG}-seg`, rules: { field: "tier", operator: "eq", value: "BRONZE" },
        createdBy: { connect: { id: actor.id } },
      },
    }),
  );
  created.segment = segment.id;
  check("tạo tenant + user + 4 khách + segment", Boolean(tenant.id && actor.id && segment.id));

  section("2. Từ chối KHÁCH SỐ 3 TRƯỚC khi gửi (mục 3)");
  // Gán unsubscribe cho c3 bằng cách tạo recipient rồi apply unsubscribe — đúng
  // đường người dùng thật đi (bấm link trong email của chiến dịch trước đó).
  const preCampaign = await runWithTenant(tenant.id, () =>
    prisma.customerCampaign.create({
      data: {
        tenantId: tenant.id, name: `${TAG}-prev`, channel: "EMAIL", subject: "p",
        bodyTemplate: "x", status: "SENT",
        createdBy: { connect: { id: actor.id } },
        segment: { connect: { id: segment.id } },
      },
    }),
  );
  const preRec = await runWithTenant(tenant.id, () =>
    prisma.campaignRecipient.create({
      data: { tenantId: tenant.id, campaignId: preCampaign.id, customerId: c3.id },
    }),
  );
  const preTok = await runWithTenant(tenant.id, () => tracking.ensureTokens(preRec.id, { tracking: true }));
  await runWithTenant(tenant.id, () => tracking.applyUnsubscribe(preTok.unsubscribeToken, "test"));
  const c3After = await runWithTenant(tenant.id, () =>
    prisma.customer.findUnique({ where: { id: c3.id }, select: { zaloUserId: true } }),
  );
  check("KH số 3 đã unsubscribe (token hoạt động)", Boolean(c3After));

  section("3. Tạo campaign + gửi thật (executeCampaign)");
  const campaign = await runWithTenant(tenant.id, () =>
    campaignsService.create({
      name: `${TAG}-camp`,
      channel: "EMAIL",
      segmentId: segment.id,
      subject: "Chào {{name}}",
      // Có link http để kiểm tra bọc click + mailto để kiểm tra KHÔNG bọc
      bodyTemplate: 'Chào {{name}}! <a href="https://shop.vn/sale">Xem sale</a> — <a href="mailto:a@b.vn">Email</a>',
      status: "SCHEDULED",
    }, actor.id),
  );
  check("tạo campaign qua campaignsService.create", Boolean(campaign.id));

  sent.length = 0;
  const result = await runWithTenant(tenant.id, () => campaignsService.executeCampaign(campaign.id));
  console.log(`  executeCampaign → ${JSON.stringify(result)}`);
  check("campaign.status = SENT", result.sent > 0);
  check("skippedUnsubscribed >= 1 (KH đã từ chối bị bỏ qua)", result.skippedUnsubscribed >= 1, `${result.skippedUnsubscribed}`);
  check("1 khách thiếu email → FAILED", result.failed >= 1, `${result.failed}`);

  section("4. Recipient rows trong DB");
  const recs = await runWithTenant(tenant.id, () =>
    prisma.campaignRecipient.findMany({
      where: { campaignId: campaign.id },
      select: { id: true, customerId: true, status: true, sentAt: true, error: true,
        unsubscribeToken: true, trackingToken: true, unsubscribedAt: true },
    }),
  );
  const recC1 = recs.find((r) => r.customerId === c1.id);
  const recC2 = recs.find((r) => r.customerId === c2.id);
  const recC3 = recs.find((r) => r.customerId === c3.id);
  const recNoMail = recs.find((r) => r.customerId === cNoMail.id);

  check("recipient KH1 có token", Boolean(recC1.unsubscribeToken && recC1.trackingToken));
  check("2 recipient có token KHÁC NHAU", recC1.unsubscribeToken !== recC2.unsubscribeToken);
  check("KH1 status = SENT", recC1.status === "SENT");
  // KH3 ĐÃ từ chối ở chiến dịch trước → vẫn tạo recipient nhưng đánh dấu
  // unsubscribedAt ngay, để `skippedUnsubscribed` phản ánh đúng "còn bao nhiêu
  // người nhận hợp lệ" và để dashboard hiển thị ai đã opt-out.
  check("KH3 (đã từ chối) được tạo recipient nhưng KHÔNG gửi", recC3?.unsubscribedAt !== null);
  check("KH3 recipient KHÔNG có status SENT", recC3?.status === "PENDING", `${recC3?.status}`);
  check("khách thiếu email → status FAILED", recNoMail?.status === "FAILED", recNoMail?.error);
  check("lỗi FAILED nêu rõ thiếu email", /email/i.test(recNoMail?.error || ""));

  section("5. Nội dung email thật sự gửi đi");
  check("gửi đúng 2 email (bỏ KH3 + KH thiếu email)", sent.length === 2, `${sent.length}`);
  const mail = sent.find((m) => m.to === c1.email);
  check("có email tới KH1", Boolean(mail));
  check("subject đã render {{name}}", mail.subject === "Chào KH 1", mail.subject);
  check("text chứa link từ chối", /\/api\/crm\/track\/unsubscribe\//.test(mail.text));
  check("html chứa pixel mở mail", /\/api\/crm\/track\/open\/[^"]+\.gif/.test(mail.html));
  console.log(`  headers = ${JSON.stringify(mail.headers)}`);
  check(
    "header List-Unsubscribe có mặt",
    /^<.+>\s*$/.test(mail.headers["List-Unsubscribe"] || "") &&
      /\/api\/crm\/track\/unsubscribe\/\w+/.test(mail.headers["List-Unsubscribe"] || ""),
    mail.headers["List-Unsubscribe"],
  );
  check("header List-Unsubscribe-Post = One-Click", mail.headers["List-Unsubscribe-Post"] === "List-Unsubscribe=One-Click");
  check("link http ĐÃ bị bọc tracking", /href="[^"]*\/api\/crm\/track\/click\/[^"]*url=https%3A%2F%2Fshop\.vn%2Fsale[^"]*"/.test(mail.html));
  check("link mailto KHÔNG bị bọc", /<a href="mailto:a@b\.vn">Email<\/a>/.test(mail.html));
  check("text KHÔNG bị bọc link tracking (giữ URL gốc)", /https:\/\/shop\.vn\/sale/.test(mail.text) && !/\/track\/click\//.test(mail.text));
  check("từ chối trong body dùng ĐÚNG token của KH1", mail.html.includes(recC1.unsubscribeToken));

  section("6. Sự kiện tracking ghi trong DB");
  const events = await runWithTenant(tenant.id, () =>
    prisma.campaignTracking.groupBy({ by: ["event"], where: { campaignId: campaign.id }, _count: { _all: true } }),
  );
  const ev = Object.fromEntries(events.map((e) => [e.event, e._count._all]));
  console.log(`  events = ${JSON.stringify(ev)}`);
  check("SENT = 2 (2 email thành công)", ev.SENT === 2, `${ev.SENT}`);
  check("không có OPEN/CLICK (chưa ai mở)", !ev.OPEN && !ev.CLICK);

  const stats = await runWithTenant(tenant.id, () => tracking.getStats(campaign.id));
  check("stats.events.SENT = 2", stats.events.SENT === 2);
  check("stats.openRate = 0 (chưa ai mở)", stats.openRate === 0);
  // KH3 bị đánh dấu unsubscribed ngay lúc tạo recipient ⇒ stats.unsubscribed = 1
  // dù chưa ai bấm link. Đây là dữ liệu đúng, không phải lỗi.
  check("stats.unsubscribed = 1 (KH3 đã opt-out từ chiến dịch trước)", stats.unsubscribed === 1, `${stats.unsubscribed}`);
  check(
    "stats.recipients.PENDING = 1 (KH3 — KH thiếu email đã sang FAILED)",
    stats.recipients.PENDING === 1,
    `${JSON.stringify(stats.recipients)}`,
  );
  check("stats.recipients.SENT = 2", stats.recipients.SENT === 2, `${stats.recipients.SENT}`);

  section("7. Chặn gửi lại campaign đã hoàn tất");
  sent.length = 0;
  // executeCampaign CỐ Ý ném lỗi nếu status = SENT (campaigns.service.js:322) —
  // gửi lại sẽ gửi trùng cho toàn bộ danh sách. Đây là hành vi đúng, phải test.
  const rerun = await runWithTenant(tenant.id, () =>
    campaignsService.executeCampaign(campaign.id).then(() => null).catch((e) => e.message),
  );
  check("gửi lại campaign đã SENT → bị chặn", /Đã gửi xong rồi/.test(String(rerun)), `${rerun}`);
  check("không email nào bị gửi lại", sent.length === 0, `${sent.length}`);

  const stillSending = await runWithTenant(tenant.id, async () => {
    await prisma.customerCampaign.update({ where: { id: campaign.id }, data: { status: "SENDING" } });
    const msg = await campaignsService.executeCampaign(campaign.id).then(() => null).catch((e) => e.message);
    await prisma.customerCampaign.update({ where: { id: campaign.id }, data: { status: "SENT" } });
    return msg;
  });
  check("gửi campaign đang SENDING → bị chặn (chống chạy song song)", /đang gửi/i.test(String(stillSending)), `${stillSending}`);
  check("vẫn không email nào gửi thêm", sent.length === 0, `${sent.length}`);

  section("8. Từ chối sau khi đã gửi — lần gửi tiếp theo phải bỏ qua");
  // Mô phỏng khách bấm link từ chối trong email đã nhận
  await runWithTenant(tenant.id, () => tracking.applyUnsubscribe(recC1.unsubscribeToken, "sau khi gửi"));
  const recC1Now = await runWithTenant(tenant.id, () =>
    prisma.campaignRecipient.findUnique({ where: { id: recC1.id }, select: { unsubscribedAt: true } }),
  );
  check("KH1 đã đánh dấu unsubscribedAt", recC1Now.unsubscribedAt !== null);

  const campaign2 = await runWithTenant(tenant.id, () =>
    campaignsService.create({
      name: `${TAG}-camp2`, channel: "EMAIL", segmentId: segment.id,
      subject: "s2", bodyTemplate: "b2 {{name}}", status: "SCHEDULED",
    }, actor.id),
  );
  sent.length = 0;
  const r2 = await runWithTenant(tenant.id, () => campaignsService.executeCampaign(campaign2.id));
  console.log(`  campaign2 → ${JSON.stringify(r2)}`);
  check("KH1 đã từ chối → KHÔNG có trong email gửi lần 2", !sent.some((m) => m.to === c1.email));
  check("KH1 bị đếm vào skippedUnsubscribed", r2.skippedUnsubscribed >= 1, `${r2.skippedUnsubscribed}`);
  check("KH3 đã từ chối từ trước → cũng bị chặn", r2.skippedUnsubscribed >= 2, `${r2.skippedUnsubscribed}`);
  check("KH2 vẫn nhận (chưa từ chối)", sent.some((m) => m.to === c2.email));

  const recC1In2 = await runWithTenant(tenant.id, () =>
    prisma.campaignRecipient.findFirst({
      where: { campaignId: campaign2.id, customerId: c1.id },
      select: { status: true, unsubscribedAt: true },
    }),
  );
  check(
    "recipient mới của KH1 được đánh dấu unsubscribedAt ngay khi tạo",
    recC1In2?.unsubscribedAt !== null && recC1In2?.unsubscribedAt !== undefined,
    JSON.stringify(recC1In2),
  );

section("9. Dọn dẹp");
  await cleanup();

  console.log(`\n--- Kết quả: ${pass} pass / ${fail} fail ---`);
  await prisma.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
})().catch(async (e) => {
  console.error("\nSMOKE ERROR:", e.message);
  console.error(e.stack?.split("\n").slice(0, 6).join("\n"));
  // Dọn dẹp VẪN phải chạy khi script lỗi — nếu không, dữ liệu rác sót lại và
  // các smoke script sau đọc nhầm. Đã xảy ra 2 lần trước khi sửa.
  try { await cleanup(); } catch (ce) { console.error("cleanup lỗi:", ce.message); }
  try { await prisma.$disconnect(); } catch { /* noop */ }
  process.exit(1);
});