'use strict';

/**
 * src/modules/import/sku-matcher.js — KHỚP SKU BASELINE KHÔNG DÙNG LLM
 *
 * Vì sao tồn tại: tên hàng từ tệp xuất của sàn (và cả tên trong dataset) là văn
 * bản tự do. Người bán gõ "Áo len nữ 2XL - xanh" cho một mã mà catalog ghi
 * "WOOLLEN HAT RED". Không có khớp SKU thì mọi đề xuất tồn kho gắn với sai mã,
 * tức là sai ngay từ đầu. Đây là **đường không-LLM**: nhanh, miễn phí, tất định,
 * và là mặc định của hệ thống (không được phụ thuộc LLM ở bất kỳ bước nào).
 *
 * Ba tín hiệu ghép lại, vì mỗi cái một mại:
 *   - Dice trên trigram ký tự  → bắt được lỗi gõ / thiếu dấu / lộn xộn ký tự.
 *   - Levenshtein có chuẩn hoá → bắt được cắt bớt ("WOOL HAT RED" vs "WOOLLEN HAT RED").
 *   - Cosine TF-IDF trên từ    → bắt được cùng ngữ nghĩa với từ khác ("XANH" vs "BLUE").
 *
 * NGƯỠNG TIN CẬY + HÀNG ĐỢI "CẦN NGƯỜI XÁC NHẬN" (tên hằng số, không ẩn trong mã):
 *   AUTO_ACCEPT  — khớp một mình, cách hạng nhất trội rõ ⇒ tự ghi.
 *   NEEDS_REVIEW — điểm đủ nhưng chưa chắc (đặc biệt khi hạng 1 và 2 gần nhau)
 *                  ⇒ ĐƯA VÀO HÀNG ĐỢI, KHÔNG tự quyết. Đây là ranh giới "AI không
 *                  được tự bịa"; người xác nhận là bước có chủ thể.
 *   NO_MATCH     — dưới ngưỡng ⇒ coi như SKU lạ, đưa vào hàng đợi kèm lý do.
 *
 * KHÔNG dùng nhãn do LLM sinh, KHÔNG gọi mạng, KHÔNG học từ dữ liệu ngoài bộ
 * catalog truyền vào. Nhờ vậy kết quả tái lập được y hệt ở mọi lần chạy.
 */

// Ngưỡng. ĐỔI ĐỒNG LOẠT thì phải đo lại trên tập khớp SKU (giao thức S10).
const AUTO_ACCEPT_SCORE = 0.86;
const REVIEW_SCORE = 0.62;
// Hạng 1 nhanh hơn hạng 2 dưới ngưỡng này thì coi như "không chắc" ⇒ xem lại.
const MIN_SCORE_MARGIN = 0.05;

const MATCH_STATUS = { AUTO: 'AUTO_ACCEPT', REVIEW: 'NEEDS_REVIEW', NO_MATCH: 'NO_MATCH' };

/** Bỏ dấu tiếng Việt + hạ chữ thường + gom khoảng trắng; giữ chữ số và chữ cái. */
function normalize(input) {
  return String(input ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const tokenize = (input) => normalize(input).split(' ').filter(Boolean);

/** Tập trigram ký tự; chuỗi < 3 ký tự trả về chính nó (tránh tập rỗng). */
function trigrams(s) {
  const t = `  ${String(s ?? '')} `;
  const out = new Set();
  for (let i = 0; i + 3 <= t.length; i += 1) out.add(t.slice(i, i + 3));
  if (!out.size) out.add(t.trim());
  return out;
}

/** Dice trên hai tập (0..1). */
function diceSet(a, b) {
  if (!a.size || !b.size) return 0;
  let hit = 0;
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  for (const g of small) if (big.has(g)) hit += 1;
  return (2 * hit) / (a.size + b.size);
}

/** Levenshtein chuẩn hoá về 0..1 (1 = giống hệt). */
function levRatio(a, b) {
  const s = String(a ?? '');
  const t = String(b ?? '');
  if (s === t) return 1;
  if (!s.length || !t.length) return 0;
  const prev = new Array(t.length + 1);
  const cur = new Array(t.length + 1);
  for (let j = 0; j <= t.length; j += 1) prev[j] = j;
  for (let i = 1; i <= s.length; i += 1) {
    cur[0] = i;
    for (let j = 1; j <= t.length; j += 1) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (s[i - 1] === t[j - 1] ? 0 : 1),
      );
    }
    for (let j = 0; j <= t.length; j += 1) prev[j] = cur[j];
  }
  return 1 - prev[t.length] / Math.max(s.length, t.length);
}

class SkuMatcher {
  /**
   * @param {Array<{sku: string, name?: string}>} catalog danh mục SKU của tenant
   */
  constructor(catalog = []) {
    this.entries = catalog
      .filter((c) => c && c.sku)
      .map((c) => {
        const name = String(c.name ?? '');
        // Chuẩn hoá CHỈ tên, KHÔNG trộn mã hàng vào: nếu trộn thì hai mã khác
        // nhau cùng một tên sẽ không bao giờ đạt điểm tuyệt đối, mà phải so chấm
        // điểm giữa hai mã gần như giống nhau (còn tệ hơn hẳn).
        const norm = normalize(name || c.sku);
        return {
          sku: c.sku,
          name,
          skuNorm: normalize(c.sku),
          norm,
          tri: trigrams(norm),
          tokens: tokenize(name || c.sku),
        };
      });
    this.index = this.buildTfidf();
  }

  /** idf = ln(1 + N/(1+df)) — chuẩn hoá L2 để cosine nằm trong 0..1. */
  buildTfidf() {
    const df = new Map();
    for (const e of this.entries) {
      for (const t of new Set(e.tokens)) df.set(t, (df.get(t) ?? 0) + 1);
    }
    const n = this.entries.length || 1;
    const idf = new Map();
    for (const [t, d] of df) idf.set(t, Math.log(1 + n / (1 + d)));
    const out = new Map();
    for (const e of this.entries) {
      const tf = new Map();
      for (const t of e.tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
      const vec = new Map();
      let norm = 0;
      for (const [t, f] of tf) {
        const w = (f / e.tokens.length) * (idf.get(t) ?? 0);
        vec.set(t, w);
        norm += w * w;
      }
      norm = Math.sqrt(norm) || 1;
      for (const [t, w] of vec) vec.set(t, w / norm);
      out.set(e.sku, vec);
    }
    return { idf, vectors: out, size: n };
  }

  cosine(inputTokens, sku) {
    const vec = this.index.vectors.get(sku);
    if (!vec || !inputTokens.length) return 0;
    let dot = 0;
    for (const t of new Set(inputTokens)) {
      const w = (this.index.idf.get(t) ?? 0);
      if (!w) continue;
      dot += w * (vec.get(t) ?? 0);
    }
    return Math.max(0, Math.min(1, dot));
  }

  /** Điểm của một cặp (tên đầu vào, mục catalog). 0..1. */
  score(inputNorm, inputTokens, entry) {
    const tri = diceSet(trigrams(inputNorm), entry.tri);
    const lev = levRatio(inputNorm, entry.norm);
    const cos = this.cosine(inputTokens, entry.sku);
    return { tri, lev, cos, total: 0.45 * tri + 0.25 * lev + 0.3 * cos };
  }

  /**
   * Khớp MỘT tên đầu vào với catalog.
   *
   * @param {string} inputName
   * @param {object} [opts]
   * @param {string} [opts.inputSku] mã hàng kèm theo; trùng mã ⇒ AUTO chắc chắn
   * @returns {{status: string, sku: string|null, score: number, margin: number,
   *            reason: string, candidates: Array}}
   */
  match(inputName, opts = {}) {
    const norm = normalize(inputName);
    const tokens = tokenize(inputName);
    const inputSku = opts.inputSku ? String(opts.inputSku).trim().toUpperCase() : null;

    if (inputSku) {
      const hit = this.entries.find((e) => e.sku.toUpperCase() === inputSku);
      if (hit) {
        return {
          status: MATCH_STATUS.AUTO,
          sku: hit.sku,
          score: 1,
          margin: 1,
          reason: 'mã hàng khớp tuyệt đối',
          candidates: [],
        };
      }
    }

    // Mã hàng xuất hiện nguyên văn trong chuỗi đầu vào (tệp xuất sàn thường có
    // cột SKU) ⇒ tin ngay, không cần đo điểm mơ hồ.
    const tokenSet = new Set(tokens);
    const byToken = this.entries.find((e) => e.skuNorm && tokenSet.has(e.skuNorm));
    if (byToken) {
      return {
        status: MATCH_STATUS.AUTO,
        sku: byToken.sku,
        score: 1,
        margin: 1,
        reason: 'mã hàng có nguyên văn trong tên đầu vào',
        candidates: [],
      };
    }

    const scored = this.entries
      .map((e) => ({ sku: e.sku, name: e.name, ...this.score(norm, tokens, e) }))
      .sort((a, b) => (b.total - a.total) || a.sku.localeCompare(b.sku));

    const top = scored[0];
    if (!top || top.total < REVIEW_SCORE) {
      return {
        status: MATCH_STATUS.NO_MATCH,
        sku: null,
        score: top ? Number(top.total.toFixed(4)) : 0,
        margin: 0,
        reason: top ? `điểm ${top.total.toFixed(4)} < ngưỡng review ${REVIEW_SCORE}` : 'catalog rỗng',
        candidates: scored.slice(0, 3),
      };
    }

    const second = scored[1];
    const margin = second ? Number((top.total - second.total).toFixed(4)) : 1;
    const base = {
      sku: top.sku,
      score: Number(top.total.toFixed(4)),
      margin,
      candidates: scored.slice(0, 3),
    };

    if (top.total < AUTO_ACCEPT_SCORE) {
      return { ...base, status: MATCH_STATUS.REVIEW, reason: `điểm ${base.score} trong [${REVIEW_SCORE}, ${AUTO_ACCEPT_SCORE})` };
    }
    if (margin < MIN_SCORE_MARGIN) {
      return {
        ...base,
        status: MATCH_STATUS.REVIEW,
        reason: `hạng 1 (${base.score}) và hạng 2 (${second.sku} ${second.total.toFixed(4)}) gần nhau, cách ${margin} < ${MIN_SCORE_MARGIN}`,
      };
    }
    return { ...base, status: MATCH_STATUS.AUTO, reason: `điểm ${base.score} >= ${AUTO_ACCEPT_SCORE}, cách hạng nhất ${margin}` };
  }

  /**
   * Khớp cả lô. Kết quả TÁCH 2 phần để không lẫn: `matched` chỉ chứa cái đủ tin
   * cậy tự ghi; `reviewQueue` là hàng đợi "cần người xác nhận" — không tự quyết.
   *
   * @param {Array<{name?: string, sku?: string, ref?: string}>} inputs
   */
  matchBatch(inputs = []) {
    const matched = [];
    const reviewQueue = [];
    for (const input of inputs) {
      const r = this.match(input.name, { inputSku: input.sku });
      const row = { ...input, ...r };
      if (r.status === MATCH_STATUS.AUTO) matched.push(row);
      else reviewQueue.push(row);
    }
    return {
      matched,
      reviewQueue,
      stats: {
        total: inputs.length,
        auto: matched.length,
        review: reviewQueue.filter((r) => r.status === MATCH_STATUS.REVIEW).length,
        noMatch: reviewQueue.filter((r) => r.status === MATCH_STATUS.NO_MATCH).length,
        nhanTinDong: REVIEW_SCORE,
        nhanTuDong: AUTO_ACCEPT_SCORE,
      },
    };
  }
}

module.exports = {
  SkuMatcher,
  MATCH_STATUS,
  AUTO_ACCEPT_SCORE,
  REVIEW_SCORE,
  MIN_SCORE_MARGIN,
  normalize,
  tokenize,
  trigrams,
  diceSet,
  levRatio,
};