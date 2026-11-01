/**
 * modules/agent-gateway/memory-pii.js — Bộ lọc PII 100% cho bộ nhớ dài hạn (UC-007).
 *
 * ============================================================================
 * VÌ SAO DÙNG CHUNG VỚI PACKAGE `agents/`
 * ============================================================================
 * `agents/src/memory/piiFilter.ts` chỉ là vỏ CÓ KIỂU quanh tệp này. Nhờ vậy đường
 * HTTP (`memory.service.js`) và đường agent (`agents/`) chạy ĐÚNG một bộ luật,
 * không có chuyện bản TypeScript chặn còn bản JavaScript cho qua.
 *
 * ============================================================================
 * NĂM NHÓM BỊ CẤM LƯU
 * ============================================================================
 * 1. `cccd`       — số CCCD/CMND/hộ chiếu (9 hoặc 12 chữ số định danh).
 * 2. `bank_account` — số tài khoản ngân hàng / số thẻ thanh toán.
 * 3. `salary`     — mức lương/thu nhập cá nhân cụ thể (kèm số tiền).
 * 4. `credential` — mật khẩu, API key, JWT, secret token, private key.
 * 5. `health`     — bệnh lý / thông tin sức khỏe cá nhân.
 *
 * Mọi so khớp chạy trên bản đã BỎ DẤU + lowercase, nên "mật khẩu", "mat khau",
 * "MẬT KHẨU" đều dính cùng một luật. Chuỗi gốc KHÔNG BAO GIỜ được ghi log/trả
 * về nguyên văn: `scanPii` chỉ trả danh mục + bản che.
 */

const PII_CATEGORIES = Object.freeze([
  'cccd',
  'bank_account',
  'salary',
  'credential',
  'health',
]);

const PII_CATEGORY_LABELS = Object.freeze({
  cccd: 'Số CCCD/CMND/hộ chiếu',
  bank_account: 'Số tài khoản ngân hàng/số thẻ',
  salary: 'Mức lương/thu nhập cá nhân',
  credential: 'Mật khẩu/API key/token',
  health: 'Thông tin sức khỏe/bệnh lý',
});

/** Bỏ dấu tiếng Việt + lowercase. Vị trí ký tự được giữ nguyên để regex số chạy đúng. */
const foldText = (value) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();

const RULES = Object.freeze({
  cccd: [
    // Có nhãn: "CCCD: 001234567890", "CMND 123456789", "căn cước công dân ...".
    /(?:can\s*cuoc(?:\s*cong\s*dan)?|cccd|cmnd|chung\s*minh\s*nhan\s*dan|dinh\s*danh\s*ca\s*nhan|giay\s*to\s*tuy\s*than|ho\s*chieu|passport)(?:\s*(?:so|no|la|:|-))?\s*\d[\d\s.-]{6,16}\d/,
    // 12 chữ số liền (CCCD gắn chip).
    /(?<!\d)\d{12}(?!\d)/,
    // 12 chữ số có phân cách: 001 234 567 890.
    /(?<!\d)(?:\d[ .-]?){11}\d(?!\d)/,
    // 9 chữ số liền (CMND cũ).
    /(?<!\d)\d{9}(?!\d)/,
    // 9 chữ số có phân cách: 123 456 789.
    /(?<!\d)(?:\d[ .-]?){8}\d(?!\d)/,
  ],
  bank_account: [
    // Có nhãn: "STK: 1234567890", "số thẻ 4111 1111 1111 1111".
    /(?:so\s*tai\s*khoan|tai\s*khoan\s*(?:ngan\s*hang|nh)|stk|bank\s*account|account\s*(?:number|no)|so\s*the|the\s*(?:tin\s*dung|thanh\s*toan|ngan\s*hang)|card\s*(?:number|no)|iban|swift)(?:\s*(?:so|no|la|:|-))?\s*[a-z]{0,4}\d[\d\s.-]{5,24}\d/,
    // Số thẻ 13–19 chữ số, có/không phân cách.
    /(?<!\d)(?:\d[ .-]?){12,18}\d(?!\d)/,
  ],
  salary: [
    // "Lương cơ bản của Nguyễn Văn A là 25.000.000đ"
    /(?:luong|thu\s*nhap|salary|payroll|compensation)[^.\n;]{0,60}?\d{1,3}(?:[.,]\d{3})+(?:\s*(?:d|vnd|dong))?/,
    // "lương 25000000"
    /(?:luong|thu\s*nhap|salary|payroll|compensation)[^.\n;]{0,60}?\d{6,}(?:\s*(?:d|vnd|dong))?/,
    // "lương 25 triệu"
    /(?:luong|thu\s*nhap|salary)[^.\n;]{0,60}?\d+(?:[.,]\d+)?\s*(?:trieu|nghin|ty|million|billion)/,
    // Số tiền đứng trước: "25.000.000đ là lương của A".
    /\d{1,3}(?:[.,]\d{3})+(?:\s*(?:d|vnd|dong))?[^.\n;]{0,40}(?:luong|thu\s*nhap|salary)/,
    /\d{6,}\s*(?:d|vnd|dong)?[^.\n;]{0,40}(?:luong|thu\s*nhap|salary)/,
  ],
  credential: [
    // JWT: header.payload.signature.
    /eyj[a-z0-9_-]{10,}\.[a-z0-9_-]{10,}\.[a-z0-9_-]{10,}/,
    // API key phổ biến.
    /\b(?:sk|pk|rk)_(?:live|test)?_?[a-z0-9]{12,}\b/,
    /\bakia[0-9a-z]{16}\b/,
    /\bgh[pousr]_[a-z0-9]{20,}\b/,
    /\bxox[baprs]-[a-z0-9-]{10,}\b/,
    // "mật khẩu là ...", "password: ...", "api key = ...".
    /(?:mat\s*khau|password|passwd|pwd|passcode|ma\s*pin|api[\s_-]*key|apikey|secret|client[\s_-]*secret|access[\s_-]*token|refresh[\s_-]*token|private[\s_-]*key|khoa\s*bi\s*mat)[^.\n;]{0,40}?(?:la|is|:|=|-)\s*\S{3,}/,
    // "mật khẩu admin123" (không có dấu '=' nhưng giá trị trông như credential).
    /(?:mat\s*khau|password|passwd|pwd|passcode|api[\s_-]*key|apikey|secret|client[\s_-]*secret|access[\s_-]*token|refresh[\s_-]*token|private[\s_-]*key)\s+[a-z0-9!@#$%^&*_+=-]{6,}/,
    // Bearer token.
    /\bbearer\s+[a-z0-9._~+/-]{10,}/,
  ],
  health: [
    /\btieu\s*duong\b/,
    /\btram\s*cam\b/,
    /\bthai\s*san\b/,
    /\bmang\s*thai\b/,
    /\bbenh\s*an\b/,
    /\bung\s*thu\b/,
    /\bhiv\b/,
    /\baids\b/,
    /\bviem\s*gan\b/,
    /\broi\s*loan\s*lo\s*au\b/,
    /\btam\s*than\b/,
    /\bdon\s*thuoc\b/,
    /\bchan\s*doan\b/,
    /\bphau\s*thuat\b/,
    /\bdi\s*ung\b/,
    /\bhuyet\s*ap\b/,
    /\bmo\s*mau\b/,
    /\bbasedow\b/,
    /\bdong\s*kinh\b/,
    /\btu\s*ky\b/,
    /\bvo\s*sinh\b/,
    /\bhiem\s*muon\b/,
    /\bsuc\s*khoe\s*ca\s*nhan\b/,
    /\btinh\s*trang\s*suc\s*khoe\b/,
    /\bbenh\s*ly\b/,
    /\bkhuyet\s*tat\b/,
    /\bgay\s*nghien\b/,
    /\bcai\s*nghien\b/,
    /\bcovid\b/,
    /\bsot\s*xuat\s*huyet\b/,
    /\bdieu\s*tri\s*(?:benh|tai\s*benh\s*vien)\b/,
  ],
});

/** Che giá trị khớp — KHÔNG trả nguyên văn PII ra response/log. */
const redact = (value) => {
  const text = String(value ?? '');
  if (text.length <= 4) return '*'.repeat(text.length);
  return `${text.slice(0, 2)}${'*'.repeat(Math.min(12, text.length - 4))}${text.slice(-2)}`;
};

/**
 * Quét PII. Chạy trên bản bỏ dấu để không lọt biến thể hoa/thường/có dấu.
 *
 * @param {unknown} text
 * @returns {{blocked: boolean, categories: string[], categoryLabels: string[], detections: Array<{category: string, sample: string}>}}
 */
const scanPii = (text) => {
  const folded = foldText(text);
  const detections = [];

  for (const category of PII_CATEGORIES) {
    const rules = RULES[category] || [];
    for (const rule of rules) {
      const match = folded.match(rule);
      if (match) {
        detections.push({ category, sample: redact(match[0]) });
        break;
      }
    }
  }

  const categories = [...new Set(detections.map((item) => item.category))];
  return {
    blocked: categories.length > 0,
    categories,
    categoryLabels: categories.map((category) => PII_CATEGORY_LABELS[category]),
    detections,
  };
};

module.exports = {
  PII_CATEGORIES,
  PII_CATEGORY_LABELS,
  foldText,
  scanPii,
  redact,
};
