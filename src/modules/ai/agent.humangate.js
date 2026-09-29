/**
 * modules/ai/agent.humangate.js — Single source of truth cho AgentHumanGate
 *
 * Cac buoi lang ki (xem tests/agent-humangate.contract.test.js):
 * - `actionSummary` la field BAT BUOC trong schema (String @db.Text, khong co default).
 *   Ca 3 call site tung ty viet object literal va bo sot field nay → moi lan goi
 *   throw PrismaClientValidationError TRUOC khi cham toi DB, va loi bi .catch(() => {})
 *   nuot im lang → khong co gate nao duoc ghi, agent van bao "da gui yeu cau phe duyet".
 * - Route decide tung dung `resolvedAt/resolvedBy/resolvedNote` trong khi schema dinh
 *   nghia `decidedAt/decidedById/decisionNote` → moi lan approve/reject tra 500.
 *
 * Vi vay KHONG duoc thiet ke payload AgentHumanGate inline o call site nua — luon
 * goi cac builder duoi day de payload duoc kiem tra bang that (Prisma client that,
 * khong mock) trong bo contract test.
 *
 * Hang so:
 * - GATE_TTL_MS: thoi han mot gate con cho phep phe duyet (24h)
 *
 * Ham:
 * - buildDataRequestGate({ sessionId, tool, params, role, requestedById }) → gate PENDING
 * - buildWriteActionGate({ sessionId, actionType, params, summary, decidedById }) → gate APPROVED (audit)
 * - buildReminderGate({ sessionId, debtId, customerName, remaining, message }) → gate PENDING
 * - buildDecisionData({ decision, note, userId }) → payload cho agentHumanGate.update khi decide
 * - createGate(data) → create + log, KHONG nuot loi
 * - sweepExpiredHumanGates(client) → chuyen PENDING qua han → EXPIRED (cron)
 */
const logger = require('../../utils/logger');

// prisma được require lazy bên trong createGate()/sweepExpiredHumanGates() để các builder
// payload thuần ở file này import được trong unit test mà không cần DATABASE_URL.

const GATE_TTL_MS = 24 * 60 * 60 * 1000;

const nowPlus = (ms) => new Date(Date.now() + ms);

/** Don text cho cot actionSummary (String @db.Text) — khong bao gio rong */
const clip = (text, max = 300) => {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 3)}...` : s;
};

/**
 * Gate xin duyet: role thap goi tool nhay cam (PII / tai chinh / cong no).
 * Trạng thai PENDING →ADMIN/MANAGER phe duyet qua POST /human-gates/:id/decide.
 */
const buildDataRequestGate = ({ sessionId, tool, params = {}, role = null, requestedById = null }) => ({
  sessionId,
  actionType: 'DATA_REQUEST',
  actionPayload: { tool, params, role, requestedById },
  actionSummary: clip(`AI Agent xin doc du lieu nhay cam qua tool "${tool}"${role ? ` (role: ${role})` : ''}`),
  triggerRule: 'SENSITIVE_TOOL_ROLE_GATE',
  status: 'PENDING',
  expiresAt: nowPlus(GATE_TTL_MS),
});

/**
 * Gate ghi nhan write action ma ADMIN/MANAGER du quyen thuc hien ngay.
 * Day la audit trail (khong chan dong nay) nen status = APPROVED va co san decidedAt.
 */
const buildWriteActionGate = ({ sessionId, actionType, params = {}, summary = null, decidedById = null }) => ({
  sessionId,
  actionType,
  actionPayload: params,
  actionSummary: clip(summary || `AI Agent da thuc hien thao tac ghi: ${actionType}`),
  triggerRule: 'WRITE_TOOL_AUDIT',
  status: 'APPROVED',
  decidedById,
  decidedAt: new Date(),
  expiresAt: nowPlus(GATE_TTL_MS),
});

/** Gate nhac no cong no — can quan ly duyet truoc khi gui chinh thuc. */
const buildReminderGate = ({ sessionId, debtId, customerName, remaining, message }) => ({
  sessionId,
  actionType: 'SEND_REMINDER',
  actionPayload: { debtId, customerName, remaining, message },
  actionSummary: clip(`AI Agent nhac no ${customerName || 'khach hang'}: con ${remaining} VND cho khoan no ${debtId}`),
  triggerRule: 'DEBT_REMINDER',
  status: 'PENDING',
  expiresAt: nowPlus(GATE_TTL_MS),
});

/**
 * Payload cho prisma.agentHumanGate.update() khi nguoi dung phe duyet/tu choi.
 * TEN field phai khop chinh xac schema: decidedById / decisionNote / decidedAt.
 */
const buildDecisionData = ({ decision, note = null, userId }) => ({
  status: decision,
  decidedById: userId,
  decisionNote: note || null,
  decidedAt: new Date(),
});

/**
 * Create gate va KHONG nuot loi. Tra ve gate da luu duoc.
 * Caller bat buoc xu ly loi: log + de lan ra next(e), hoac degrade co kiem soat.
 *
 * @param {object} data payload sinh boi cac builder o tren — day la diem duy nhiest
 *   go `agentHumanGate.create`, nen chi can doi chieu schema tai day.
 * @param {object} [client] Prisma client tuy chon (tx trong transaction).
 */
const createGate = async (data, client = null) => {
  const db = client || require('../../config/prisma');
  try {
    const gate = await db.agentHumanGate.create({ data });
    logger.info(`[human-gate] created ${gate.id} type=${gate.actionType} status=${gate.status}`);
    return gate;
  } catch (err) {
    // Log tại điểm phát sinh để không bao giờ mất dấu, kể cả khi caller quên log,
    // rồi RE-THROW — caller phải degrade có kiểm soát chứ không được giả định thành công.
    logger.error(`[human-gate] create FAILED type=${data?.actionType} session=${data?.sessionId}: ${err.message}`);
    throw err;
  }
};

/**
 * Cron sweep: gate PENDING da vuot `expiresAt` → EXPIRED.
 *
 * Khong co ham thi trang thai EXPIRED trong enum HumanGateStatus khong bao gio dat
 * duoc, va `GET /human-gates` tra ve danh sach PENDING "ma" khong bao gio het han.
 * agent_human_gates co `@@index([status, expiresAt])` → updateMany đi theo được index.
 * Chạy ngoài tenant context → Prisma extension không inject tenantId → quét mọi tenant.
 *
 * @param {object} [client] Prisma client tuy chon — truyen vao khi test/control; mac dinh lazy-require.
 */
const sweepExpiredHumanGates = async (client = null) => {
  const db = client || require('../../config/prisma');
  const result = await db.agentHumanGate.updateMany({
    where: { status: 'PENDING', expiresAt: { lt: new Date() } },
    data: { status: 'EXPIRED' },
  });
  if (result.count > 0) logger.info(`[human-gate] swept ${result.count} expired pending gate(s)`);
  return result.count;
};

module.exports = {
  GATE_TTL_MS,
  clip,
  buildDataRequestGate,
  buildWriteActionGate,
  buildReminderGate,
  buildDecisionData,
  createGate,
  sweepExpiredHumanGates,
};
