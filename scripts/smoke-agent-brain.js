/**
 * scripts/smoke-agent-brain.js — Kiểm tra bộ não LLM qua HTTP THẬT (dev 9router)
 *
 * Cách chạy:  node scripts/smoke-agent-brain.js
 * KHÔNG dùng PowerShell cho payload tiếng Việt — encoding bị hỏng; Node fetch mới đúng.
 *
 * Lưu ý: bước (4) tạo MỘT đơn thật trong tenant MÔ PHỎNG (demo) — đây là tenant
 * demo nên chấp nhận được; chạy `npm run demo:restore -- --apply` để dọn nếu cần.
 *
 * Kiểm tra các câu người dùng thật đã report bug:
 *  1. "hi"                                   → brain reply (không menu cứng)
 *  2. "tạo cho mình đơn hàng giá 5 triệu"    → hỏi lại/thiếu thông tin, KHÔNG listOrders
 *  3. "tạo đơn hàng … cho khách <TênSángTạo99>"   → báo không tìm thấy khách
 *  4. "tạo đơn hàng <SP có chữ số> 50 gói cho khách thật" → tạo thành công + TÊN KHÔNG UUID
 *  5. "tạo PO ... từ NCC lạ giá 5 triệu"     → từ chối lịch sự (KHÔNG tạo)
 *  6. "tra cứu tồn kho *"                    → brain chọn tool đọc DB và trả kết quả
 */
const BASE = process.env.SMOKE_BASE || 'http://localhost:4000';
const EMAIL = 'demo-mo-phong@local.invalid';
const PASSWORD = 'Demo123456';

const CUSTOMER_NAME = 'Bui Hoang';
const PRODUCT_HINT = 'Phô mai Oishi';

let token = null;
let failed = 0;

async function req(method, path, body, auth = true) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(auth && token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* không phải JSON */ }
  return { status: res.status, json };
}

async function login() {
  const { status, json } = await req('POST', '/api/auth/login', { email: EMAIL, password: PASSWORD }, false);
  if (status !== 200 || !json?.data?.token) {
    throw new Error(`Login ${status}: ${JSON.stringify(json).slice(0, 300)}\nChạy: npm run demo:login để bật tenant mô phỏng`);
  }
  token = json.data.token;
  console.log(`✔ login ${EMAIL} ok`);
}

async function chat(message) {
  const { status, json } = await req('POST', '/api/agent/chat', { messages: [{ role: 'user', content: message }] });
  const reply = json?.data?.response ?? json?.message ?? '';
  console.log(`\nYOU: ${message}\n   (${status}) ${String(reply).slice(0, 360).replace(/\n/g, ' | ')}`);
  return String(reply);
}

const assert = (name, cond, extra = '') => {
  console.log(`${cond ? '✔' : '✘'} ${name}${cond ? '' : `  ---- ${extra}`}`);
  if (!cond) failed += 1;
};

const listData = (json) => (Array.isArray(json?.data) ? json.data : json?.data?.items || []);

async function prep() {
  const { json: pj } = await req('GET', '/api/products?limit=500');
  const oishi = listData(pj).filter((p) => /oishi/i.test(p.name));
  // Bui Hoang KHÔNG cần nằm trong 500 khách đầu tiên của trang list —
  // findCustomerByQuery dùng contains trực tiếp trước, fallback 500 chỉ là dự phòng.
  assert('sản phẩm Oishi tồn tại trong tenant demo', oishi.length > 0, JSON.stringify(listData(pj).slice(0, 5).map((p) => p.name)));
  console.log(`- sản phẩm Oishi: ${oishi.map((p) => p.name).join(', ').slice(0, 200)}`);
  return oishi.length >= 1;
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i;

async function main() {
  await login();
  const ready = await prep();

  // (1) Trò chuyện — brain phải tự trả lời, không menu cứng
  const hi = await chat('hi');
  // Menu cứng template luôn có bullet "• 📦 Tra cứu tồn kho" — reply tự nhiên của
  // LLM không có chuỗi đó (chữ "Tôi có thể giúp" bình thường là hợp lệ).
  assert('chat "hi" → reply tự nhiên (brain), KHÔNG menu cứng (dấu hiệu LLM chết)', !/• 📦/.test(hi));

  // (2) Lệnh tạo thiếu thông tin — KHÔNG được rơi vào listOrders
  const missing = await chat('tạo cho mình đơn hàng giá 5 triệu');
  assert('lệnh tạo thiếu SP/khách → hỏi lại, KHÔNG ban danh sách đơn hàng',
    !/ORD-\d{8}-\d{4} - /.test(missing) && !/Đơn hàng mới nhất/i.test(missing));

  // (3) Khách không tồn tại → chỉ báo "không tìm thấy khách"
  const noCustomer = await chat('tạo đơn hàng 3 cái nước suối cho khách Khach Ao 99');
  assert('khách lạ → báo không tìm thấy khách (param trích đúng)',
    /khách|tìm thấy/i.test(noCustomer) && !/ORD-\d{8}-\d{4}/.test(noCustomer));

  // (4) Tạo đơn THẬT với khách + sản phẩm có thật (chữ số trong tên phải giữ nguyên)
  if (ready) {
    const okOrder = await chat(`tạo đơn hàng ${PRODUCT_HINT} 50 gói cho khách ${CUSTOMER_NAME}`);
    if (/hạn mức tín dụng|không đủ hàng|không đủ tồn/i.test(okOrder)) {
      // Bị chặn bởi QUY TẮC NGHIỆP VỤ thật (đơn test trước còn công nợ) — đây
      // là từ chối ĐÚNG, miễn là trả lời thân thiện (❌) chứ không 400 undefined.
      assert('bị chặn bởi quy tắc nghiệp vụ → trả lời thân thiện ❌ (không phải 400)', okOrder.startsWith('❌') || /Không thực hiện được/.test(okOrder), okOrder);
    } else {
      const ordCode = (okOrder.match(/ORD-\d{8}-\d{4}/) || [])[0];
      assert('tạo đơn THÀNH CÔNG với khách + sản phẩm thật', Boolean(ordCode));
      if (ordCode) {
        assert('summary in TÊN sản phẩm (không UUID)', !UUID_RE.test(okOrder), okOrder);
        console.log(`- đơn tạo thử ${ordCode}: dọn sau khi test bằng \`npm run demo:restore -- --apply\``);
      }
    }
  }

  // (5) PO từ NCC không tồn tại → từ chối lịch sự, KHÔNG tạo PO
  const poBad = await chat('tạo PO nến thơm 3 cái từ NCC-Does-Not-Exist giá 5 triệu');
  assert('PO NCC lạ → báo không tìm thấy NCC, KHÔNG tạo PO',
    !/PO-\d{8}/.test(poBad) && /nhà cung cấp/i.test(poBad));

  // (6) Đường brain → tool đọc DB
  const inv = await chat('tra cứu tồn kho oishi');
  assert('tồn kho trả kết quả (brain chọn tool đọc đúng)', /Tồn|Oishi|tìm thấy/i.test(inv));

  console.log(`\n${failed === 0 ? '✔✔ TẤT CẢ PASS' : `✘ ${failed} assertion FAIL`}`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch((e) => { console.error('✘ smoke blown up:', e.message); process.exitCode = 1; });
