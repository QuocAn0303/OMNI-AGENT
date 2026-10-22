'use strict';

/**
 * docs/aisc26/one-off/cleanup-p8-demo-po-residue.js
 *
 * ============================================================================
 * VÌ SAO CÓ TỆP NÀY (phát hiện của gói P8, 2026-10-04)
 * ============================================================================
 * Còn **3 đơn nhập DRAFT** trong tenant demo `omni-demo-mo-phong` do một lần chạy
 * `demo-flow` bị **bỏ dở** (tiến trình bị dừng giữa chừng, không tới bước cleanup):
 *
 *   PO-20261003-0004 / -0005 / -0006  · note `[gate:<id>]` · 1 dòng hàng mỗi PO
 *   gate APPROVED tương ứng, decisionNote "Duyệt trong luồng demo P6"
 *   tạo lúc 2026-10-03 10:58 / 11:00 / 11:02 UTC
 *
 * HẬU QUẢ THẬT (đã đo, không phải phỏng đoán): `npm run smoke:po-gate` **FAIL
 * 21/24** với `Unique constraint failed on the fields: ("poCode")`. Bộ sinh mã PO
 * đếm số PO có sẵn trong ngày, nên mã kế tiếp trùng với dòng rác ⇒ 3 kịch bản
 * (9, 11d, 11e) không tạo được PO. Đây là **bài học đáng ghi**: rác của một script
 * làm hỏng script khác, và triệu chứng là lỗi ràng buộc UNIQUE chứ không phải
 * "còn dữ liệu rác".
 *
 * AN TOÀN
 *   - `assert-local-db`: chỉ chạy trên DB máy cục bộ.
 *   - **dry-run là mặc định**; `--apply` mới ghi.
 *   - Chỉ đụng dòng khớp **cả ba** điều kiện: tenant demo · `status = DRAFT` ·
 *     `note` bắt đầu bằng `[gate:`. Dòng `RECEIVED` của giả định A5 (`-9001…-9003`)
 *     **không** khớp và không bị đụng.
 *   - `EXPECTED` cố định; COUNT chạy lại ngay trước khi ghi, **lệch là hủy toàn bộ**.
 *   - Một transaction; lỗi ⇒ rollback.
 *   - Đã `pg_dump` trước khi chạy: xem `MORNING-REPORT.md` (đường dẫn dump).
 *
 *   node docs/aisc26/one-off/cleanup-p8-demo-po-residue.js
 *   node docs/aisc26/one-off/cleanup-p8-demo-po-residue.js --apply
 */

require('dotenv').config();
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const { assertLocalDb } = require(path.join(ROOT, 'scripts/lib/assert-local-db'));
assertLocalDb('cleanup-p8-demo-po-residue');

const prisma = require(path.join(ROOT, 'src/config/prisma'));

const APPLY = process.argv.includes('--apply');
const DEMO_SLUG = 'omni-demo-mo-phong';
/** Số lượng đã đo trước khi viết. Lệch ⇒ hủy. */
const EXPECTED = { purchaseOrders: 3, gates: 3, sessions: 3 };

const main = async () => {
  const tenant = await prisma.tenant.findUnique({ where: { slug: DEMO_SLUG }, select: { id: true, name: true } });
  if (!tenant) throw new Error(`Không thấy tenant demo ${DEMO_SLUG}`);

  const pos = await prisma.purchaseOrder.findMany({
    where: { tenantId: tenant.id, status: 'DRAFT', note: { startsWith: '[gate:' } },
    select: { id: true, poCode: true, note: true, createdAt: true, _count: { select: { items: true } } },
    orderBy: { createdAt: 'asc' },
  });
  const poIds = pos.map((p) => p.id);
  const gates = await prisma.agentHumanGate.findMany({
    where: { resultRef: { in: poIds } },
    select: { id: true, sessionId: true, status: true, createdAt: true },
  });
  const sessionIds = [...new Set(gates.map((g) => g.sessionId))];
  const auditRows = await prisma.$queryRawUnsafe(
    `SELECT count(*)::int AS n FROM audit_logs WHERE "entityId" = ANY($1::text[])`,
    [...poIds, ...gates.map((g) => g.id)],
  );
  const auditCount = auditRows[0].n;

  console.log(`tenant          : ${tenant.name} (${DEMO_SLUG})`);
  console.log(`PO DRAFT rác    : ${pos.length}`);
  for (const p of pos) {
    console.log(`   ${p.poCode} · items=${p._count.items} · ${p.createdAt.toISOString()} · ${p.note}`);
  }
  console.log(`gate liên kết   : ${gates.length} · session: ${sessionIds.length}`);
  console.log(`auditLog liên quan: ${auditCount}`);
  console.log(`Kỳ vọng        : ${JSON.stringify(EXPECTED)}`);

  const actual = { purchaseOrders: pos.length, gates: gates.length, sessions: sessionIds.length };
  const mismatch = Object.keys(EXPECTED).filter((k) => EXPECTED[k] !== actual[k]);
  if (mismatch.length) {
    console.error(`\nHỦY: COUNT lệch ở ${mismatch.join(', ')} (thấy ${JSON.stringify(actual)}).`);
    console.error('Nếu số đã đúng là do lần chạy khác đã dọn, thì KHÔNG cần chạy lại tệp này.');
    await prisma.$disconnect();
    process.exit(2);
  }
  if (!pos.length) {
    console.log('\nSẠCH — không có gì để làm.');
    await prisma.$disconnect();
    return;
  }

  if (!APPLY) {
    console.log('\nDRY-RUN (mặc định). Thêm --apply để xoá trong MỘT transaction.');
    await prisma.$disconnect();
    return;
  }

  // Đếm lại NGAY TRƯỚC khi ghi — không dùng kết quả lấy ở trên.
  const again = await prisma.purchaseOrder.count({
    where: { tenantId: tenant.id, status: 'DRAFT', note: { startsWith: '[gate:' } },
  });
  if (again !== EXPECTED.purchaseOrders) {
    console.error(`\nHỦY: COUNT chạy lại = ${again}, không bằng ${EXPECTED.purchaseOrders}. Không ghi gì.`);
    await prisma.$disconnect();
    process.exit(2);
  }

  const deleted = await prisma.$transaction(async (tx) => {
    const items = await tx.purchaseItem.deleteMany({ where: { purchaseOrderId: { in: poIds } } });
    const pos2 = await tx.purchaseOrder.deleteMany({ where: { id: { in: poIds } } });
    const g2 = await tx.agentHumanGate.deleteMany({ where: { id: { in: gates.map((g) => g.id) } } });
    const s2 = await tx.agentSession.deleteMany({ where: { id: { in: sessionIds } } });
    const a2 = await tx.auditLog.deleteMany({
      where: { entityId: { in: [...poIds, ...gates.map((g) => g.id)] } },
    });
    return {
      purchaseItems: items.count,
      purchaseOrders: pos2.count,
      gates: g2.count,
      sessions: s2.count,
      auditLogs: a2.count,
    };
  });

  console.log(`\nĐÃ XOÁ: ${JSON.stringify(deleted)}`);
  const left = await prisma.purchaseOrder.count({
    where: { tenantId: tenant.id, status: 'DRAFT', note: { startsWith: '[gate:' } },
  });
  console.log(`Còn lại PO DRAFT rác: ${left}`);
  await prisma.$disconnect();
};

main().catch(async (e) => {
  console.error('LỖI:', e.message);
  try { await prisma.$disconnect(); } catch { /* ignore */ }
  process.exit(1);
});
