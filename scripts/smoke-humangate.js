/**
 * Smoke test (chạy 1 lần, tự dọn dẹp): vòng đời AgentHumanGate thật trên DB dev.
 * Tạo AgentSession tạm → tạo gate qua builder → decide qua buildDecisionData →
 * tạo gate quá hạn → sweep → kiểm tra → xóa sạch.
 *   node scripts/smoke-humangate.js
 */
require('dotenv').config();

const prisma = require('../src/config/prisma');
const {
  buildDataRequestGate,
  buildWriteActionGate,
  buildDecisionData,
  createGate,
  sweepExpiredHumanGates,
} = require('../src/modules/ai/agent.humangate');

const ok = (label, cond, extra = '') => {
  console.log(`${cond ? 'OK  ' : 'FAIL'} | ${label}${extra ? ' → ' + extra : ''}`);
  if (!cond) process.exitCode = 1;
};

(async () => {
  const user = await prisma.user.findFirst({ where: { isActive: true }, select: { id: true, tenantId: true } });
  if (!user) {
    console.log('Không có user nào trong DB — bỏ qua smoke test');
    return;
  }

  const session = await prisma.agentSession.create({
    data: { userId: user.id, tenantId: user.tenantId, userMessage: '[smoke] human-gate lifecycle', triggerSource: 'SYSTEM_EVENT' },
  });

  let pendingGate = null;
  let expiredGate = null;
  let approvedGate = null;

  try {
    pendingGate = await createGate(
      buildDataRequestGate({ sessionId: session.id, tool: 'search_customers', params: { q: 'ACME' }, role: 'CASHIER', requestedById: user.id }),
    );
    ok('DATA_REQUEST gate được ghi xuống DB', !!pendingGate?.id, pendingGate?.id);
    ok('actionSummary không rỗng (bug cũ)', typeof pendingGate.actionSummary === 'string' && pendingGate.actionSummary.length > 0, JSON.stringify(pendingGate.actionSummary));
    ok('status = PENDING', pendingGate.status === 'PENDING');
    ok('expiresAt ~24h tới', pendingGate.expiresAt - Date.now() > 23 * 3600 * 1000);

    const decided = await prisma.agentHumanGate.update({
      where: { id: pendingGate.id },
      data: buildDecisionData({ decision: 'APPROVED', note: '[smoke] duyệt thử', userId: user.id }),
    });
    ok('decide dùng decidedById/decidedAt/decisionNote thành công', decided.status === 'APPROVED' && decided.decidedAt instanceof Date && decided.decidedById === user.id);
    ok('decisionNote được lưu', decided.decisionNote === '[smoke] duyệt thử', decided.decisionNote);

    approvedGate = await createGate(
      buildWriteActionGate({ sessionId: session.id, actionType: 'CREATE_ORDER', params: { total: 2500000 }, summary: '[smoke] tạo đơn ORD-TEST', decidedById: user.id }),
    );
    ok('write-action gate ghi được (APPROVED sẵn)', approvedGate.status === 'APPROVED' && approvedGate.actionSummary.includes('ORD-TEST'));

    expiredGate = await prisma.agentHumanGate.create({
      data: { ...buildDataRequestGate({ sessionId: session.id, tool: 'search_products', params: {} }), expiresAt: new Date(Date.now() - 60_000) },
    });

    const swept = await sweepExpiredHumanGates();
    const afterSweep = await prisma.agentHumanGate.findUnique({ where: { id: expiredGate.id } });
    ok('sweep đánh dấu gate quá hạn = EXPIRED', afterSweep.status === 'EXPIRED', `swept=${swept}`);
    ok('gate còn hạn KHÔNG bị sweep', (await prisma.agentHumanGate.findUnique({ where: { id: decided.id } })).status === 'APPROVED');

    const listed = await prisma.agentHumanGate.findMany({ where: { status: 'PENDING', sessionId: session.id } });
    ok('GET /human-gates không còn gate "ma" của session này', listed.length === 0, `pending=${listed.length}`);
  } finally {
    await prisma.agentHumanGate.deleteMany({ where: { sessionId: session.id } });
    await prisma.agentSession.delete({ where: { id: session.id } });
    await prisma.$disconnect();
    console.log('đã dọn dẹp session + gates');
  }
})();
