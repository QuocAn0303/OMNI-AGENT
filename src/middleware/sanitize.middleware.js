const VALID_TAGS = new Set(["b", "i", "em", "strong", "a", "br", "p", "ul", "ol", "li", "span"]);

// Regex: tag bất kỳ KHÔNG nằm trong whitelist (đóng/mở, có/không attribute)
const FORBIDDEN_TAG_RE = /<\/?([a-zA-Z][a-zA-Z0-9-]*)(\s[^>]*)?>/g;
const ON_HANDLER_RE = /\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
const HREF_SRC_RE = /\s(?:href|src)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;

function stripTags(str) {
  return str
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]*>/g, "");
}

// Rich text: chỉ giữ tag thuộc VALID_TAGS, gỡ on* handler + javascript: URL
function sanitizeRichText(str) {
  let out = str
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(ON_HANDLER_RE, "")
    // Chỉ gỡ href/src trỏ tới javascript: — giữ nguyên URL hợp lệ
    .replace(HREF_SRC_RE, (m) => (/javascript\s*:/i.test(m) ? "" : m));
  // Lặp cho tới khi ổn định: gỡ tag không nằm trong whitelist (kể cả tag lồng nhau)
  for (let i = 0; i < 3; i++) {
    const next = out.replace(FORBIDDEN_TAG_RE, (m, tagName) => {
      const lower = tagName.toLowerCase();
      return VALID_TAGS.has(lower) ? m : "";
    });
    if (next === out) break;
    out = next;
  }
  return out;
}

function sanitizeValue(value, allowTags) {
  if (typeof value === "string") {
    return allowTags ? sanitizeRichText(value) : stripTags(value);
  }
  if (Array.isArray(value)) return value.map((v) => sanitizeValue(v, allowTags));
  if (value && typeof value === "object") return sanitizeObject(value, allowTags);
  return value;
}

function sanitizeObject(obj, allowTags) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = sanitizeValue(v, allowTags);
  }
  return out;
}

// Chỉ sanitize được plain object / array của JSON.
// Buffer và các typed array phải bỏ qua: `express.raw` mount TRƯỚC `express.json`
// cho các path webhook, nên req.body lúc này là Buffer byte thô cần dùng để verify
// HMAC. Nếu đi tiếp, `Object.entries(Buffer)` biến nó thành object chỉ số byte
// ({"0":123,"1":34,...}) → JSON.parse ném lỗi, webhook hợp lệ bị chết �� im lặng.
function isPlainContainer(value) {
  if (value === null || typeof value !== "object") return false;
  if (Buffer.isBuffer(value)) return false;
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return false;
  return true;
}

function sanitize(allowTagsFields = []) {
  return (req, res, next) => {
    if (isPlainContainer(req.body)) {
      const tagsSet = new Set(allowTagsFields);
      const sanitized = {};
      for (const [k, v] of Object.entries(req.body)) {
        sanitized[k] = sanitizeValue(v, tagsSet.has(k));
      }
      req.body = sanitized;
    }
    if (req.query && typeof req.query === "object") {
      for (const [k, v] of Object.entries(req.query)) {
        if (typeof v === "string") req.query[k] = stripTags(v);
      }
    }
    next();
  };
}

module.exports = sanitize;
