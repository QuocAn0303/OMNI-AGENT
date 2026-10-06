/**
 * Kiểm tra nhanh: mô hình churn đã được nối vào `clv-forecast` thật chưa.
 * Dùng khi sửa `churn-model.service.js` / `clv-forecast.service.js`.
 *   Chạy: node scripts/quick-churn-model-check.js
 */
require("dotenv").config();

const prisma = require("../src/config/prisma");
const { runWithTenant } = require("../src/config/tenantContext");

(async () => {
  const info = require("../src/modules/customers/churn-model.service").getModelInfo();
  console.log(`model available = ${info.available} · engine = ${info.engine}`);
  if (info.available) {
    console.log(`aucTest=${info.metrics.aucTest} · aucBaseline=${info.metrics.aucBaseline} · prAuc=${info.metrics.prAuc}`);
    console.log(`decisionThreshold=${info.decisionThreshold} · features=${info.features.join(",")}`);
  }

  const tenant = await prisma.tenant.findUnique({ where: { slug: "crm-phase1-demo" }, select: { id: true } });
  if (!tenant) {
    console.log("Chưa có tenant crm-phase1-demo — chạy: npm run seed:phase1:apply");
    process.exit(1);
  }

  const clv = require("../src/modules/customers/clv-forecast.service");
  const res = await runWithTenant(tenant.id, () => clv.runForTenant());
  const byEngine = {};
  for (const s of res.scored) byEngine[s.engine] = (byEngine[s.engine] || 0) + 1;
  console.log(`Số khách chấm theo engine: ${JSON.stringify(byEngine)}`);

  const risky = await prisma.customer.findMany({
    where: { tenantId: tenant.id, churnProbability: { gte: 0.7 } },
    select: { name: true, churnProbability: true, rfmSegment: true },
    orderBy: { churnProbability: "desc" },
    take: 5,
  });
  console.log(`Khách churn >= 0.70 (ngưỡng hệ thống): ${risky.length}`);
  for (const r of risky) console.log(`  ${r.name} · p=${r.churnProbability} · ${r.rfmSegment || "-"}`);

  await prisma.$disconnect();
})().catch((e) => {
  console.error("LỖI:", e.message);
  process.exit(1);
});
