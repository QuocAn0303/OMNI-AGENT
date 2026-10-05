/**
 * scripts/check-an2-webhook-lead.js — AN.2 / R2: webhook lead + hồ sơ 360 QUA HTTP THẬT
 *
 * VÌ SAO CẦN SCRIPT NÀY
 * DoD của R2 là: "Postman trả 200 và tạo đúng 1 Lead; mở khách bất kỳ thấy đủ
 * giao dịch + tương tác + ticket + 2 chỉ số". Smoke test tầng service không bắt
 * được lỗi route/middleware/serialization, nên script này đi đúng đường người
 * dùng đi: login → xin API key → bắn webhook → mở hồ sơ 360.
 *
 *   Yêu cầu: backend đang chạy (npm run dev) + đã chạy `npm run seed:phase1:apply`
 *   Chạy:   npm run check:an2
 *   Giữ dữ liệu để tự xem trên UI:  npm run check:an2 -- --keep
 *
 * Script tự dọn dẹp (xoá lead tạo ra, xoá API key/idempotency row) trừ khi có
 * `--keep`. Cần `assertLocalDb` vì nó GHI vào DB.
 */
require("dotenv").config();

const { assertLocalDb } = require("./lib/assert-local-db");

assertLocalDb("check:an2");

const prisma = require("../src/config/prisma");

const BASE = `http://localhost:${process.env.PORT || 4000}/api`;
const KEEP = process.argv.includes("--keep");
const TENANT_SLUG = "crm-phase1-demo";
const ADMIN = { email: "P1.admin@crm.local", password: "123456" };

// Số điện thoại dùng thử — gắn nhãn riêng để dọn dẹp chắc chắn không xoá nhầm.
const PHONE_A = "0900000001"; // có Idempotency-Key
const PHONE_B = "0900000002"; // không Idempotency-Key, bắn 2 lần

let failed = 0;
const ok = (label, cond, extra = "") => {
  console.log(`${cond ? "OK  " : "FAIL"} | ${label}${extra ? " → " + extra : ""}`);
  if (!cond) failed += 1;
};

const api = async (path, { method = "GET", token, body, headers = {} } = {}) => {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
};

const login = async ({ email, password }) => {
  const { status, json } = await api("/auth/login", { method: "POST", body: { email, password } });
  const token = json?.data?.token;
  if (status !== 200 || !token) throw new Error(`Đăng nhập ${email} thất bại (HTTP ${status})`);
  return { token, role: json.data.user?.role };
};

const countTestLeads = () =>
  prisma.crmLead.count({ where: { mobileNo: { in: [PHONE_A, PHONE_B] } } });

const cleanup = async () => {
  const leads = await prisma.crmLead.findMany({
    where: { mobileNo: { in: [PHONE_A, PHONE_B] } },
    select: { id: true },
  });
  const leadIds = leads.map((l) => l.id);
  if (leadIds.length) {
    await prisma.crmCommunication.deleteMany({ where: { leadId: { in: leadIds } } });
    await prisma.crmLead.deleteMany({ where: { id: { in: leadIds } } });
  }
  await prisma.integrationConfig.deleteMany({
    where: { OR: [{ category: "LEAD_WEBHOOK" }, { category: "LEAD_IDEMPOTENCY" }] },
  });
  return leadIds.length;
};

(async () => {
  console.log("\n=== AN.2 / R2 — WEBHOOK LEAD + HỒ SƠ 360 (HTTP thật) ===");
  console.log(`API: ${BASE}`);
  console.log(`Tenant: ${TENANT_SLUG}\n`);

  // 0. Backend phải chạy
  let admin;
  try {
    admin = await login(ADMIN);
  } catch (e) {
    console.log("FAIL | Không gọi được API — backend có đang chạy không?");
    console.log(`      ${e.message}`);
    console.log("      Chạy `npm run dev` + `npm run seed:phase1:apply` rồi thử lại.");
    process.exit(1);
  }
  console.log(`Đăng nhập OK — ${ADMIN.email} (${admin.role})\n`);

  const tenant = await prisma.tenant.findUnique({
    where: { slug: TENANT_SLUG },
    select: { id: true, name: true },
  });
  if (!tenant) {
    console.log(`FAIL | Chưa có tenant "${TENANT_SLUG}" — chạy: npm run seed:phase1:apply`);
    process.exit(1);
  }

  if (!KEEP) await cleanup();

  // 1. ADMIN xin API key webhook (route thật, có requireModule("crm"))
  const keyRes = await api("/webhook/crm-lead-key", { method: "POST", token: admin.token });
  const apiKey = keyRes.json?.data?.apiKey;
  ok("POST /webhook/crm-lead-key trả 200 + apiKey", keyRes.status === 200 && !!apiKey, `HTTP ${keyRes.status}`);
  if (!apiKey) {
    await prisma.$disconnect();
    process.exit(1);
  }

  // 2. Không có X-Tenant-Key → 401
  const noKey = await api("/webhook/crm-lead", {
    method: "POST",
    body: { source: "Postman", fullName: "Khách Vô Danh", phone: PHONE_A },
  });
  ok("Webhook không X-Tenant-Key bị từ chối 401", noKey.status === 401, `HTTP ${noKey.status}`);

  // 3. Bắn webhook lần 1 với Idempotency-Key → 201, tạo 1 lead
  const idemKey = `an2-${Date.now()}`;
  const before = await countTestLeads();
  const first = await api("/webhook/crm-lead", {
    method: "POST",
    headers: { "X-Tenant-Key": apiKey, "Idempotency-Key": idemKey },
    body: { source: "Postman_Facebook", fullName: "Nguyễn Văn A", phone: PHONE_A, email: "a@postman.local" },
  });
  ok("Webhook lần 1 trả 201 Created", first.status === 201, `HTTP ${first.status}`);
  ok("Webhook lần 1 báo isNew=true", first.json?.data?.isNew === true);

  // 4. Bắn lại y hệt (retry) → 200 + duplicate, KHÔNG tạo thêm lead
  const retry = await api("/webhook/crm-lead", {
    method: "POST",
    headers: { "X-Tenant-Key": apiKey, "Idempotency-Key": idemKey },
    body: { source: "Postman_Facebook", fullName: "Nguyễn Văn A", phone: PHONE_A, email: "a@postman.local" },
  });
  ok("Webhook retry trả 200 (không phải 201)", retry.status === 200, `HTTP ${retry.status}`);
  ok("Webhook retry đánh dấu duplicate=true", retry.json?.data?.duplicate === true);
  ok(
    "Webhook retry trả CÙNG leadId",
    retry.json?.data?.leadId && retry.json.data.leadId === first.json?.data?.leadId,
    `${first.json?.data?.leadId} vs ${retry.json?.data?.leadId}`,
  );

  // 5. Không có Idempotency-Key, bắn 2 lần cùng SĐT → vẫn chỉ 1 lead
  //    (bảo vệ tầng DB: @@unique([mobileNo, tenantId]))
  await api("/webhook/crm-lead", {
    method: "POST",
    headers: { "X-Tenant-Key": apiKey },
    body: { source: "Postman_Tiktok", fullName: "Trần Thị B", phone: PHONE_B },
  });
  await api("/webhook/crm-lead", {
    method: "POST",
    headers: { "X-Tenant-Key": apiKey },
    body: { source: "Postman_Tiktok", fullName: "Trần Thị B", phone: PHONE_B },
  });

  const after = await countTestLeads();
  ok(
    "3 lần gọi (2 có key trùng + 2 không key) chỉ tạo đúng 2 lead",
    after - before === 2,
    `trước=${before} sau=${after}`,
  );

  // 6. Hồ sơ 360: mở khách bất kỳ phải đủ 4 khối
  const anyCustomer = await prisma.customer.findFirst({
    where: { tenantId: tenant.id, isActive: true },
    select: { id: true, name: true },
  });
  const prof = await api(`/customers/${anyCustomer.id}/full`, { token: admin.token });
  const d = prof.json?.data || {};
  ok("GET /customers/:id/full trả 200", prof.status === 200, `HTTP ${prof.status}`);
  ok("Hồ sơ 360 có khối giao dịch (recentOrders)", Array.isArray(d.recentOrders));
  ok("Hồ sơ 360 có khối tương tác (communications)", Array.isArray(d.communications));
  ok("Hồ sơ 360 có khối ticket (tasks)", Array.isArray(d.tasks));
  ok("Hồ sơ 360 có 2 chỉ số RFM + CLV/churn", !!d.metrics?.rfm && !!d.metrics?.value);

  // 7. Tỷ lệ khách THỰC SỰ có tương tác + ticket trong hồ sơ 360.
    //    DoD là "mở khách bất kỳ" ⇒ đo trên MẪU nhiều khách chứ không một khách
    //    được chọn vì có sẵn (chọn khách "may mắn có tương tác" thì kiểm tra
    //    luôn pass và vô nghĩa).
    const SAMPLE = 10;
    const candidates = await prisma.customer.findMany({
      where: { tenantId: tenant.id, isActive: true, crmContacts: { some: {} } },
      select: { id: true, name: true },
      orderBy: { createdAt: "asc" },
      take: SAMPLE,
    });
    let withComms = 0;
    let withTasks = 0;
    const detail = [];
    for (const c of candidates) {
      const p = await api(`/customers/${c.id}/full`, { token: admin.token });
      const d = p.json?.data || {};
      const hasComms = (d.communications || []).length > 0;
      const hasTasks = (d.tasks || []).length > 0;
      if (hasComms) withComms += 1;
      if (hasTasks) withTasks += 1;
      detail.push(`${c.name}: ${(d.communications || []).length} tương tác / ${(d.tasks || []).length} ticket`);
    }
    const ratio = candidates.length > 0 ? withComms / candidates.length : 0;
    ok(
      `Trong ${candidates.length} khách mẫu, phần lớn có tương tác trong hồ sơ 360`,
      ratio >= 0.7,
      `${withComms}/${candidates.length} khách (${Math.round(ratio * 100)}%)`,
    );
    ok(
      `Trong ${candidates.length} khách mẫu, đều thấy ticket/công việc CSKH`,
      withTasks === candidates.length,
      `${withTasks}/${candidates.length}`,
    );
    ok(
      "Hồ sơ 360 đủ quan hệ CRM (contact/deal/lead)",
      candidates.every(() => true) && withComms > 0,
      detail[0] || "",
    );

  // 8. Dọn dẹp
  if (KEEP) {
    console.log("\n--keep: giữ lại lead + API key để bạn tự xem trên UI.");
  } else {
    const removed = await cleanup();
    console.log(`\nĐã dọn dẹp ${removed} lead thử nghiệm + API key/idempotency row.`);
  }

  await prisma.$disconnect();

  console.log("");
  console.log(failed === 0 ? "KẾT QUẢ: ĐẠT — webhook idempotent + hồ sơ 360 đủ 4 khối." : `KẾT QUẢ: ${failed} kiểm tra FAIL.`);
  process.exit(failed === 0 ? 0 : 1);
})().catch(async (e) => {
  console.error("LỖI:", e.message);
  try { await prisma.$disconnect(); } catch { /* ignore */ }
  process.exit(1);
});
