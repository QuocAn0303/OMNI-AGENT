'use strict';

/**
 * scripts/check-an3-rfm-reports.js — AN.3 / R3: RFM tự động + 3 báo cáo khớp DB
 *
 * DoD của R3: "Tạo đơn test -> segment đổi trong vài giây; 3 báo cáo khớp DB".
 * Ba ý này kiểm tra bằng BA đường khác nhau rồi so kết quả:
 *
 *   1. Realtime: tạo đơn thật qua HTTP (`POST /api/orders` với status=COMPLETED)
 *      rồi poll `customers.rfmFrequency` cho tới khi tăng — đo bằng chứng thời
 *      gian thực tế. Không gọi service nội bộ: phải đi đúng đường người dùng đi
 *      để bắt được lỗi route/middleware.
 *   2. Báo cáo: chạy `reportBuilderService.runQuery()` (query builder an toàn)
 *      rồi so **từng số** với truy vấn Prisma viết độc lập.
 *   3. Báo cáo phải chạy được trên dữ liệu thật: `saved_reports` được nạp 10
 *      mẫu R-01…R-10 vào tenant Phase 1.
 *
 *   Yêu cầu: backend đang chạy + `npm run seed:phase1:apply`
 *   Chạy:   npm run check:an3
 *   Giữ đơn thử nghiệm để tự xem:  npm run check:an3 -- --keep
 *
 * Script GHI vào DB (nạp báo cáo, tạo/xoá đơn thử) nên có `assertLocalDb`.
 */
require("dotenv").config();

const { assertLocalDb } = require("./lib/assert-local-db");

assertLocalDb("check:an3");

const prisma = require("../src/config/prisma");
const { runWithTenant } = require("../src/config/tenantContext");

const BASE = `http://localhost:${process.env.PORT || 4000}/api`;
const KEEP = process.argv.includes("--keep");
const TENANT_SLUG = "crm-phase1-demo";
const ADMIN = { email: "P1.admin@crm.local", password: "123456" };
const REPORT_LIMIT = 100;

let failed = 0;
const ok = (label, cond, extra = "") => {
  console.log(`${cond ? "OK  " : "FAIL"} | ${label}${extra ? " → " + extra : ""}`);
  if (!cond) failed += 1;
};

const api = async (path, { method = "GET", token, body } = {}) => {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
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

/** `$queryRawUnsafe` trả numeric dạng CHUỖI (driver pg) — ép về number để so. */
const num = (v) => (v == null ? null : Number(v));

(async () => {
  console.log("\n=== AN.3 / R3 — RFM TỰ ĐỘNG + BÁO CÁO KHỚP DB ===");
  console.log(`API: ${BASE}\nTenant: ${TENANT_SLUG}\n`);

  let admin;
  try {
    admin = await login(ADMIN);
  } catch (e) {
    console.log("FAIL | Không gọi được API — backend có đang chạy không?");
    console.log(`      ${e.message}\n      Chạy: npm run dev`);
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

  const reportBuilder = require("../src/modules/report-builder/report-builder.service");
  const { DEFAULT_REPORTS } = require("../src/modules/report-builder/default-reports.seed");
  const rfmService = require("../src/modules/customers/rfm.service");
  const clvForecast = require("../src/modules/customers/clv-forecast.service");

  await runWithTenant(tenant.id, async () => {
    // ---------------------------------------------------------------- 1. nạp 10 báo cáo
    const adminUser = await prisma.user.findFirst({
      where: { tenantId: tenant.id, role: "ADMIN", isActive: true },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    });
    const { seedDefaultReports } = require("../src/modules/report-builder/default-reports.seed");
    const seeded = await seedDefaultReports(adminUser?.id || null);
    ok(
      "Nạp 10 mẫu báo cáo R-01…R-10 vào tenant Phase 1",
      seeded.length === 10,
      `tạo mới ${seeded.filter((s) => s.created).length}, đã có ${seeded.filter((s) => !s.created).length}`,
    );
    const savedCount = await prisma.savedReport.count();
    ok("saved_reports có đủ 10 bản ghi", savedCount === 10, `${savedCount} bản ghi`);

    // ------------------------------------------- 2. chấm RFM + CLV để báo cáo có số
    // Giống hệt cron 01:00 (churn/CLV) và 01:30 (RFM) — chạy trước để R-01/R-02
    // không rơi vào trường hợp "mọi cột NULL".
    const clv = await clvForecast.runForTenant();
    const rfm = await rfmService.runForTenant();
    ok(
      "Chấm CLV/churn cho tenant",
      (clv?.scored?.length ?? 0) > 0,
      `khách có đơn=${clv?.customers ?? 0}, chấm được=${clv?.scored?.length ?? 0}`,
    );
    ok("Chấm RFM + phân khúc cho tenant", (rfm?.scored ?? 0) > 0, `scored=${rfm?.scored ?? 0}`);

    const segments = await prisma.customer.groupBy({ by: ["rfmSegment"], _count: { _all: true } });
    const segCount = segments.reduce((s, x) => s + x._count._all, 0);
    ok(
      "Phân khúc RFM có dữ liệu (không để trống)",
      segCount > 0,
      segments.map((s) => `${s.rfmSegment || "(null)"}:${s._count._all}`).join(" "),
    );

    // ---------------------------------------- 3. REALTIME: đơn mới → RFM đổi
    // Chọn khách có nhiều đơn COMPLETED nhất để chắc chắn R/F/M đều thay đổi.
    const target = await prisma.customer.findFirst({
      where: { isActive: true, rfmFrequency: { gt: 0 } },
      orderBy: { rfmFrequency: "desc" },
      select: {
        id: true,
        name: true,
        rfmFrequency: true,
        rfmMonetary: true,
        rfmSegment: true,
      },
    });
    if (!target) {
      ok("Tìm được khách đã có lịch sử đơn", false, "không có khách nào rfmFrequency > 0");
    } else {
      const product = await prisma.product.findFirst({
        where: { isActive: true },
        select: { id: true, name: true, price: true, inventories: { select: { quantity: true, warehouseId: true }, take: 1 } },
      });
      const before = { ...target };
      // Mốc thời gian để nhận ra giao dịch kho sinh ra bởi đơn thử: bảng
      // `inventory_transactions` KHÔNG có cột orderId ⇒ dò bằng mốc thời gian.
      const txMark = new Date();
      console.log(
        `\nKhách thử nghiệm: ${before.name} — F=${before.rfmFrequency} M=${Math.round(
          Number(before.rfmMonetary || 0),
        )} phân khúc=${before.rfmSegment}`,
      );

      const created = await api("/orders", {
        method: "POST",
        token: admin.token,
        body: {
          customerId: target.id,
          paymentMethod: "CASH",
          paymentStatus: "PAID",
          // Tạo thẳng ở trạng thái COMPLETED để chạy đúng nhánh hook
          // `onOrderCompletedForCustomer` mà thực tế nhân viên bán hàng dùng.
          status: "COMPLETED",
          items: [{ productId: product.id, quantity: 1 }],
          note: "[check:an3] đơn thử nghiệm đo độ trễ RFM",
        },
      });
      ok("POST /orders tạo đơn COMPLETED thành công", created.status === 201, `HTTP ${created.status}`);

      // Poll: tần suất đơn COMPLETED của khách tăng lên 1 ⇒ RFM đã chạy.
      const t0 = Date.now();
      let after = null;
      let elapsedMs = null;
      while (Date.now() - t0 < 15000) {
        const row = await prisma.customer.findUnique({
          where: { id: target.id },
          select: { rfmFrequency: true, rfmMonetary: true, rfmSegment: true, rfmScoredAt: true },
        });
        if (row && row.rfmFrequency > before.rfmFrequency) {
          after = row;
          elapsedMs = Date.now() - t0;
          break;
        }
        await new Promise((r) => setTimeout(r, 250));
      }
      ok(
        "Tạo đơn xong thì R/F/M cập nhật trong ≤ 10 giây",
        !!after && elapsedMs <= 10000,
        after ? `${elapsedMs} ms (F ${before.rfmFrequency} → ${after.rfmFrequency})` : "quá 15s không thay đổi",
      );
      ok(
        "Phân khúc khách được chấm lại sau đơn mới",
        !!after && !!after.rfmScoredAt,
        after?.rfmScoredAt ? `scoredAt=${new Date(after.rfmScoredAt).toISOString()}` : "chưa có scoredAt",
      );

      // Dọn dẹp: xoá đơn thử + trả lại tồn kho, rồi chấm lại RFM cho khớp DB.
      if (created.status === 201 && !KEEP) {
        const orderId = created.json?.data?.id;
        if (orderId) {
          await runWithTenant(tenant.id, async () => {
            const items = await prisma.orderItem.findMany({
              where: { orderId },
              select: { productId: true, quantity: true },
            });
            for (const it of items) {
              const inv = await prisma.inventory.findFirst({
                where: { tenantId: tenant.id, productId: it.productId },
                select: { id: true, quantity: true },
              });
              if (inv) {
                // Xoá giao dịch kho phát sinh từ đơn thử, rồi trả lại tồn.
                const txs = await prisma.inventoryTransaction.findMany({
                  where: { inventoryId: inv.id, createdAt: { gte: txMark } },
                  select: { id: true },
                });
                if (txs.length) {
                  await prisma.inventoryTransaction.deleteMany({
                    where: { id: { in: txs.map((t) => t.id) } },
                  });
                }
                await prisma.inventory.update({
                  where: { id: inv.id },
                  data: { quantity: inv.quantity + it.quantity },
                });
              }
            }
            await prisma.payment.deleteMany({ where: { orderId } });
            await prisma.orderItem.deleteMany({ where: { orderId } });
            await prisma.order.delete({ where: { id: orderId } });
            await rfmService.recalcMetricsForCustomer(target.id);
            await rfmService.scoreTenantSegments();
          });
          ok("Dọn dẹp đơn thử + trả tồn kho, chấm lại RFM", true, `orderId=${orderId}`);
        }
      } else if (created.status === 201) {
        console.log(`\n--keep: giữ đơn thử (${created.json?.data?.id}) để bạn xem trên UI.`);
      }
    } // hết nhánh else của `if (!target)`

    // ------------------------------- 4. CROSS-CHECK 3 BÁO CÁO với truy vấn độc lập
      const byCode = Object.fromEntries(DEFAULT_REPORTS.map((r) => [r.code, r]));

      // ---- R-02: Ma trận phân khúc RFM (aggregate COUNT group by rfmSegment)
      const r02 = await reportBuilder.runQuery(byCode["R-02"].config, { limit: 500 });
      const r02Raw = await prisma.customer.groupBy({ by: ["rfmSegment"], _count: { _all: true } });
      const m02 = new Map(r02.map((r) => [r.rfmSegment ?? "(null)", Number(r.agg_value)]));
      let r02Match = m02.size === r02Raw.length;
      const r02Detail = [];
      for (const row of r02Raw) {
        const key = row.rfmSegment ?? "(null)";
        const expected = row._count._all;
        const got = m02.get(key) ?? 0;
        const same = expected === got;
        if (!same) r02Match = false;
        r02Detail.push(`${key}: báo cáo ${got} / DB ${expected}${same ? "" : " ✗"}`);
      }
      ok("R-02 khớp DB (số khách theo phân khúc)", r02Match, r02Detail.join(" · "));

      // ---- R-01: CLV Leaderboard (danh sách khách, sort theo clvPredicted)
      // So theo TẬP (id → giá trị) chứ không theo thứ tự: Postgres xếp NULL trước
      // khi DESC, Prisma cũng vậy — nhưng để script không phụ thuộc quy ước đó.
// ---- R-01: CLV Leaderboard (danh sách khách, sort theo clvPredicted)
// So theo NỘI DUNG hàng (đã sắp xếp lại để không phụ thuộc thứ tự của Postgres
// khi NULL: Postgres xếp NULL trước với DESC, Prisma cũng vậy — nhưng so sánh
// theo bộ hàng thì kết quả đáng tin hơn và không cần cột `id` trong config).
// Lưu ý: config R-01 KHÔNG chọn cột `id` ⇒ không thể join theo id.
const r01 = await reportBuilder.runQuery(byCode["R-01"].config, { limit: REPORT_LIMIT });
const key01 = (r) =>
  [r.name, r.phone, num(r.clvPredicted), num(r.churnProbability), r.rfmSegment ?? null].join("|");
const r01Report = r01.map(key01).sort();
const r01Db = await prisma.customer.findMany({
  orderBy: { clvPredicted: "desc" },
  take: REPORT_LIMIT,
  select: { name: true, phone: true, clvPredicted: true, churnProbability: true, rfmSegment: true },
});
const r01DbKeys = r01Db.map(key01).sort();
const r01Mismatch = r01Report.filter((k, i) => k !== r01DbKeys[i]).length;
ok(
  "R-01 khớp DB (CLV + churn của từng khách)",
  r01Mismatch === 0 && r01.length > 0 && r01.length === r01DbKeys.length,
  `${r01.length} dòng báo cáo / ${r01DbKeys.length} dòng DB, ${r01Mismatch} dòng lệch`,
);
const vals = r01.map((r) => num(r.clvPredicted)).filter((v) => v != null);
const sortedDesc = vals.every((v, i) => i === 0 || vals[i - 1] >= v);
ok("R-01 sắp xếp CLV giảm dần", sortedDesc, `${vals.slice(0, 3).map((v) => Math.round(v)).join(" ≥ ")}…`);

      // ---- R-07: Vendor Scorecard (danh sách NCC, sort theo otifScore)
const r07 = await reportBuilder.runQuery(byCode["R-07"].config, { limit: REPORT_LIMIT });
const key07 = (v) =>
  [v.name, num(v.otifScore), num(v.defectRate), v.vendorGrade ?? null].join("|");
const r07Report = r07.map(key07).sort();
const r07Db = await prisma.vendor.findMany({
  orderBy: { otifScore: "desc" },
  take: REPORT_LIMIT,
  select: { name: true, otifScore: true, defectRate: true, vendorGrade: true },
});
const r07DbKeys = r07Db.map(key07).sort();
const r07Mismatch = r07Report.filter((k, i) => k !== r07DbKeys[i]).length;
ok(
  "R-07 khớp DB (OTIF / tỷ lệ lỗi / hạng NCC)",
  r07Mismatch === 0 && r07.length > 0 && r07.length === r07DbKeys.length,
  `${r07.length} dòng báo cáo / ${r07DbKeys.length} dòng DB, ${r07Mismatch} dòng lệch`,
);
const otif = r07.map((r) => num(r.otifScore)).filter((v) => v != null);
ok(
  "R-07 sắp xếp OTIF giảm dần",
  otif.every((v, i) => i === 0 || otif[i - 1] >= v),
  `${otif.slice(0, 3).join(" ≥ ")}…`,
);

      // ---- Cả 10 báo cáo có chạy được không (báo cáo nào lỗi thì nêu ra)
      const broken = [];
      for (const r of DEFAULT_REPORTS) {
        try {
          await reportBuilder.runQuery(r.config, { limit: 20 });
        } catch (e) {
          broken.push(`${r.code}: ${e.message}`);
        }
      }
      ok(
        "Cả 10 báo cáo R-01…R-10 chạy được",
        broken.length === 0,
        broken.length ? broken.join(" | ") : "10/10 OK",
      );
  });

  await prisma.$disconnect();
  console.log("");
  console.log(
    failed === 0
      ? "KẾT QUẢ: ĐẠT — RFM tự động + 3 báo cáo khớp DB."
      : `KẾT QUẢ: ${failed} kiểm tra FAIL.`,
  );
  process.exit(failed === 0 ? 0 : 1);
})().catch(async (e) => {
  console.error("LỖI:", e.message);
  try { await prisma.$disconnect(); } catch { /* ignore */ }
  process.exit(1);
});