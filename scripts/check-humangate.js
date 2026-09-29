/**
 * scripts/check-humangate.js — Kiểm tra human-in-the-loop gate QUA HTTP THẬT
 *
 * Khác smoke-humangate.js (test tầng DB gọi builder trực tiếp), script này
 * chạy đúng luồng người dùng: login → chat → gate → duyệt. Bắt được lỗi mà
 * smoke test không thấy: route sai, middleware authorize, tên field decide sai.
 *
 *   Yêu cầu: backend đang chạy (npm run dev) + DB đã seed
 *   Chạy:    node scripts/check-humangate.js
 *   Giữ dữ liệu để tự xem trên UI: node scripts/check-humangate.js --keep
 *
 * Cơ chế: role THẤP (CASHIER/WAREHOUSE) hỏi tool nhạy cảm → agent KHÔNG trả
 * dữ liệu, tạo gate PENDING chờ ADMIN/MANAGER duyệt.
 */
require('dotenv').config();

const BASE = `http://localhost:${process.env.PORT || 4000}/api`;
const KEEP = process.argv.includes('--keep');
const CASHIER = { email: 'cashier@candory.com', password: '123456' };
const ADMIN = { email: 'admin@candory.com', password: '123456' };
// "khách hàng" -> intent customerLookup, nằm trong SENSITIVE_TOOLS
const PROMPT = 'khách hàng';

let failed = 0;
const ok = (label, cond, extra = '') => {
  console.log(`${cond ? 'OK  ' : 'FAIL'} | ${label}${extra ? ' → ' + extra : ''}`);
  if (!cond) failed++;
};

const api = async (path, { method = 'GET', token, body } = {}) => {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
};

const login = async ({ email, password }) => {
  const { status, json } = await api('/auth/login', { method: 'POST', body: { email, password } });
  const token = json?.data?.token;
  if (status !== 200 || !token) throw new Error(`Đăng nhập ${email} thất bại (HTTP ${status})`);
  return { token, role: json.data.user?.role };
};

const listGates = async (token) => (await api('/agent/human-gates', { token })).json?.data || [];
const decide = (token, id, decision, note) =>
  api(`/agent/human-gates/${id}/decide`, { method: 'POST', token, body: { decision, note } });

(async () => {
  console.log('\n=== HUMAN-IN-THE-LOOP GATE CHECK ===');
  console.log(`API: ${BASE}\n`);

  // 0. Backend phải chạy
  let cashier;
  try {
    cashier = await login(CASHIER);
  } catch (e) {
    console.log('FAIL | Không gọi được API — backend có đang chạy không?');
    console.log(`      ${e.message}\n      Chạy: npm run dev`);
    process.exit(1);
  }
  const admin = await login(ADMIN);
  console.log(`Đăng nhập OK — cashier=${cashier.role}, admin=${admin.role}\n`);

  const before = await listGates(admin.token);

  // 1. Role thấp hỏi tool nhạy cảm → phải bị chặn, tạo gate PENDING
  const chat = await api('/agent/chat', {
    method: 'POST',
    token: cashier.token,
    body: { messages: [{ role: 'user', content: PROMPT }] },
  });
  const reply = chat.json?.data?.response || '';
  console.log(`Chat("${PROMPT}") → ${JSON.stringify(reply.slice(0, 120))}\n`);

  ok('Role CASHIER bị chặn, không lộ dữ liệu nhạy cảm',
    chat.status === 200 && /phê duyệt|duyệt/i.test(reply), `HTTP ${chat.status}`);
  ok('Trả lời không chứa SĐT khách hàng',
    !/\d{4}[- ]?\d{3}[- ]?\d{3}/.test(reply), 'không lộ PII');

  // 2. Gate mới phải xuất hiện trong danh sách chờ duyệt
  const fresh = (await listGates(admin.token)).filter((g) => !before.some((b) => b.id === g.id));
  ok('Tạo được gate mới', fresh.length > 0, `${fresh.length} gate mới`);

  const gate = fresh.find((g) => g.status === 'PENDING' && g.actionType === 'DATA_REQUEST');
  if (!gate) {
    console.log('\nKhông có gate DATA_REQUEST PENDING — dừng.');
    if (fresh.length) console.table(fresh.map((g) => ({ id: g.id, type: g.actionType, status: g.status })));
    process.exit(failed ? 1 : 0);
  }
  console.log(`\nGate: ${gate.id}`);
  console.log(`  actionType    : ${gate.actionType}`);
  console.log(`  triggerRule   : ${gate.triggerRule}`);
  console.log(`  actionSummary : ${gate.actionSummary}`);
  console.log(`  expiresAt     : ${gate.expiresAt}\n`);

  ok('actionSummary không rỗng (bug PrismaClientValidationError cũ)',
    typeof gate.actionSummary === 'string' && gate.actionSummary.length > 0);
  ok('triggerRule = SENSITIVE_TOOL_ROLE_GATE', gate.triggerRule === 'SENSITIVE_TOOL_ROLE_GATE');

  // 3. CASHIER không được tự duyệt (chỉ ADMIN/MANAGER)
  const denied = await decide(cashier.token, gate.id, 'APPROVED');
  ok('CASHIER không tự duyệt được (403)', denied.status === 403, `HTTP ${denied.status}`);

  // 4. Duyệt hợp lệ
  const approved = await decide(admin.token, gate.id, 'APPROVED', '[check] duyệt thử');
  ok('ADMIN duyệt được (200)', approved.status === 200, `HTTP ${approved.status}`);
  ok('status chuyển sang APPROVED', approved.json?.data?.status === 'APPROVED', approved.json?.data?.status);
  ok('ghi decidedAt + decidedById + decisionNote (đúng tên field schema)',
    Boolean(approved.json?.data?.decidedAt && approved.json?.data?.decidedById));

  // 5. Không duyệt lại được nữa
  const again = await decide(admin.token, gate.id, 'REJECTED');
  ok('Duyệt lần 2 bị từ chối (400)', again.status === 400, `HTTP ${again.status}`);

  // 6. Gate đã xử lý không còn trong danh sách chờ duyệt
  const remaining = await listGates(admin.token);
  ok('Gate đã xử lý không còn trong danh sách PENDING',
    !remaining.some((g) => g.id === gate.id));

  // 7. Dọn dẹp (trừ khi --keep)
  const sessions = [...new Set(fresh.map((g) => g.sessionId).filter(Boolean))];
  if (KEEP) {
    console.log(`\n--keep: giữ ${fresh.length} gate + ${sessions.length} session để xem trên UI.`);
  } else {
    const prisma = require('../src/config/prisma');
    await prisma.agentHumanGate.deleteMany({ where: { id: { in: fresh.map((g) => g.id) } } });
    await prisma.agentSession.deleteMany({ where: { id: { in: sessions } } });
    await prisma.$disconnect();
    console.log(`\nĐã dọn ${fresh.length} gate + ${sessions.length} session test.`);
  }

  console.log(`\n=== ${failed ? `THẤT BẠI ${failed} mục` : 'TẤT CẢ PASS'} ===\n`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('LỖI:', e.message); process.exit(1); });

