'use strict';

/**
 * src/config/llm-policy.js — CHẾ ĐỘ CHẠY + THROTTLE + BACKOFF + ĐƯỜNG LUI
 *
 * ============================================================================
 * VÌ SAO TỒN TẠI
 * ============================================================================
 * T14 (`docs/aisc26/NIGHT-PROMPT.md` §6) yêu cầu: LLM phải **tắt được mà luồng vẫn
 * chạy**. Nhưng chỉ có `config/llm.js` thì "tắt" chỉ có một kiểu — không có key. Còn
 * khi CÓ key mà provider lỗi 429/503, `config/llm.js` retry rồi ném lỗi ra ngoài ⇒
 * lần gọi đầu tiên của một ca xử lý hàng loạt sẽ làm hỏng cả luồng.
 *
 * Tệp này là TẦNG QUYẾT ĐỊNH nằm TRÊN `config/llm.js`, và là **đường LLM duy nhất**
 * mà mọi vai trò LLM gọi vào (khớp SKU, giải thích đề xuất, soạn tin NCC). Không có
 * vai trò nào `require` thẳng `config/llm.js` rồi tự quyết định có gọi hay không.
 *
 * ============================================================================
 * BA NGUYÊN TẮC BẤT BIẾN
 * ============================================================================
 * 1. **Mặc định là không-LLM.** `resolveMode()` trả `'off'` trừ khi có key VÀ
 *    `LLM_MODE` yêu cầu bật. Không bao giờ "tự bật vì thấy có key" — có key là quyền
 *    của người dùng, không phải suy luận của hệ thống.
 * 2. **Không bao giờ ném lỗi ra ngoài.** Hàm `callTask` LUÔN trả `{ ok, text, ... }`.
 *    Lỗi 429/503/timeout/JSON hỏng/tắt ⇒ `ok:false` + `reason` ⇒ caller dùng mẫu.
 *    Đây là đường lui nói thật sự: UI phải hiện "tạo bằng mẫu", không im lặng giả vờ.
 * 3. **Không gửi dữ liệu thật.** `assertPublicDataOnly()` chặn ở chế độ `live` khi
 *    biến môi trường `LLM_ALLOW_REAL_DATA` không bật — hiến pháp NIGHT-PROMPT §3.
 *
 * ============================================================================
 * CHẾ ĐỘ
 * ============================================================================
 *   off     — không gọi mạng. Đường lui mặc định. Luồng demo vẫn chạy trọn.
 *   live    — gọi provider thật (Gemini). CHỈ dùng dữ liệu công khai/mô phỏng.
 *   record  — gọi thật NHƯ `live` rồi ghi (hash → response) vào JSONL để `replay`
 *             tái lập được mà không cần key. Đây là cách `live` lần đầu sinh dữ liệu.
 *   replay  — đọc JSONL. KHÔNG gọi mạng. Trượt bản ghi ⇒ `ok:false` ⇒ dùng mẫu.
 *
 * Quy ước báo cáo (`01-llm-role.md` §3.3): số precision/recall CHỈ được công bố kèm
 * `mode: live` + ngày + tên model. Số từ `replay` chỉ chứng minh pipeline chạy.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const llm = require('./llm');
const logger = require('../utils/logger');

/** Tác vụ — hằng số, khớp cột `task` của bảng `llm_usage_logs`. */
const LLM_TASK = Object.freeze({
  SKU_MATCH: 'SKU_MATCH',
  PROPOSAL_EXPLAIN: 'PROPOSAL_EXPLAIN',
  VENDOR_MESSAGE: 'VENDOR_MESSAGE',
});

const RECORD_STORE = process.env.LLM_RECORD_PATH
  || path.join(__dirname, '..', '..', 'data', 'llm-recordings.jsonl');

// ── throttle/backoff ───────────────────────────────────────────────────────
/** Nghỉ tối thiểu giữa hai lần gọi. Gói miễn phí hạn chế RPM rất thấp (xem
 * `docs/aisc26/notes/gemini-free-tier.md`) nên mặc định 1200 ms, không phải 0. */
const baseThrottleMs = () => Math.max(0, Number(process.env.LLM_THROTTLE_MS) || 1200);
/** Trần backoff: không vượt quá 30 s rồi từ bỏ ⇒ dùng mẫu. */
const maxBackoffMs = () => Math.max(baseThrottleMs(), Number(process.env.LLM_MAX_BACKOFF_MS) || 30000);

let nextAllowedAt = 0;
/** Hệ số nhân hiện tại của backoff (1 = chưa bị phạt). Reset khi có lần gọi thành công. */
let backoffFactor = 1;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Chờ tới khi được phép gọi (throttle + backoff cộng dồn). */
const waitForSlot = async () => {
  const wait = Math.max(0, nextAllowedAt - Date.now());
  if (wait > 0) {
    logger.debug(`[LLM-policy] throttle ${wait}ms`);
    await sleep(wait);
  }
  nextAllowedAt = Date.now() + baseThrottleMs() * backoffFactor;
};

/** 429/503 = bị giới hạn tạm thời ⇒ nhân đôi thời gian chờ, có trần. */
const penalize = (reason) => {
  backoffFactor = Math.min(backoffFactor * 2, 64);
  const penalty = Math.min(baseThrottleMs() * backoffFactor, maxBackoffMs());
  nextAllowedAt = Math.max(nextAllowedAt, Date.now() + penalty);
  logger.warn(`[LLM-policy] backoff x${backoffFactor} (${reason}), cat ${penalty}ms`);
};

const reward = () => {
  backoffFactor = 1;
};

/** Lỗi nào được coi là "tạm thời, đáng lùi" (429/503/500/timeout). */
const isTransient = (message) => /\b(429|503|500)\b|timeout|ECONNRESET|EAI_AGAIN|ETIMEDOUT|socket hang up/i.test(String(message || ''));

// ── mode ───────────────────────────────────────────────────────────────────

/**
 * Chế độ hiện tại.
 *
 * Ưu tiên biến môi trường `LLM_MODE`; nếu không có thì **`off`**. Đặc biệt: có
 * `GEMINI_API_KEY` KHÔNG tự bật LLM — `LLM_DISABLED=1` thắng mọi thứ.
 */
const resolveMode = () => {
  if (process.env.LLM_DISABLED === '1') return 'off';
  const raw = String(process.env.LLM_MODE || '').toLowerCase();
  if (['off', 'live', 'record', 'replay'].includes(raw)) return raw;
  return 'off';
};

/** Mô tả chế độ cho UI/ghi chú — KHÔNG lộ key. */
const describe = () => {
  const mode = resolveMode();
  return {
    mode,
    enabled: mode !== 'off',
    // `configured` = có provider + key. Không phải "đang bật".
    configured: llm.isConfigured(),
    provider: llm.describe().provider,
    model: llm.describe().model,
    throttleMs: baseThrottleMs(),
    backoffFactor,
    recordStore: mode === 'replay' || mode === 'record' ? RECORD_STORE : null,
  };
};

// ── record / replay store ──────────────────────────────────────────────────

/**
 * Khóa của một lần gọi = hash(task + system + prompt).
 *
 * KHÔNG đưa `model` vào khóa: `replay` sinh ra để tái lập **đúng câu trả lời đã
 * ghi**, bất kể sau này cấu hình model có đổi hay không (thiết kế record-replay ở
 * `01-llm-role.md` §3.3). Nếu nhét model vào khóa thì đổi `LLM_MODEL` là toàn bộ bản
 * ghi cũ trượt ⇒ demo dự phòng hỏng đúng lúc cần nó nhất. `model` vẫn được ghi
 * trong TỪNG dòng bản ghi và trong `LlmUsageLog`, nên không mất dấu vết.
 */
const callKey = ({ task, system, prompt }) =>
  crypto.createHash('sha256')
    .update(JSON.stringify([task, system || '', prompt]))
    .digest('hex');

const readStore = () => {
  try {
    if (!fs.existsSync(RECORD_STORE)) return new Map();
    const map = new Map();
    for (const line of fs.readFileSync(RECORD_STORE, 'utf8').split('\n')) {
      const t = line.trim();
      if (!t) continue;
      try {
        const row = JSON.parse(t);
        if (row && row.key) map.set(row.key, row);
      } catch { /* dòng hỏng: bỏ qua, không làm hỏng cả tệp */ }
    }
    return map;
  } catch (e) {
    logger.error(`[LLM-policy] doc store that bai: ${e.message}`);
    return new Map();
  }
};

const appendStore = (row) => {
  try {
    fs.mkdirSync(path.dirname(RECORD_STORE), { recursive: true });
    fs.appendFileSync(RECORD_STORE, `${JSON.stringify(row)}\n`, 'utf8');
  } catch (e) {
    // Ghi bản ghi hỏng KHÔNG được làm hỏng cuộc gọi đang thành công — nhưng phải
    // `logger.error`, không nuốt im lặng (AGENTS.md).
    logger.error(`[LLM-policy] ghi store that bai: ${e.message}`);
  }
};

// ── dữ liệu thật ──────────────────────────────────────────────────────────

/**
 * Chặn gửi dữ liệu thật qua LLM. Ở chế độ `live`/`record`, mọi dữ liệu phải là
 * công khai/mô phỏng trừ khi người dùng **tự** bật `LLM_ALLOW_REAL_DATA=1`.
 *
 * Không "tự cho phép": bật biến này là hành động của con người, có dấu vết trong
 * cấu hình, khác hẳn với việc agent tự quyết.
 */
const assertPublicDataOnly = () => {
  if (process.env.LLM_ALLOW_REAL_DATA === '1') {
    logger.warn('[LLM-policy] LLM_ALLOW_REAL_DATA=1 — dang gui du lieu that len LLM ngoai troi');
    return;
  }
  const tag = String(process.env.LLM_DATA_TAG || '').trim();
  if (tag && !/^(mophong|simulated|synthetic|public|cong-khai)/i.test(tag)) {
    const err = new Error(
      `LLM_DATA_TAG="${tag}" khong phai nhan "cong khai". Khong gui du lieu doanh nghiep that len ` +
      'LLM ngoai troi. Dat LLM_DATA_TAG=mophong cho du lieu mo phong, hoac LLM_ALLOW_REAL_DATA=1 ' +
      'neu da duyet rieng cho du lieu nay.',
    );
    err.code = 'REAL_DATA_BLOCKED';
    throw err;
  }
};

// ── hàm gọi duy nhất ───────────────────────────────────────────────────────

/**
 * Gọi LLM cho MỘT tác vụ, không bao giờ ném lỗi ra ngoài.
 *
 * @param {object}   opts
 * @param {string}   opts.task     một trong `LLM_TASK`
 * @param {string}   opts.system   chỉ dẫn hệ thống
 * @param {string}   opts.prompt   nội dung yêu cầu (chỉ số ĐÃ TÍNH SẴN)
 * @param {boolean} [opts.jsonMode]
 * @param {number}  [opts.maxOutputTokens]
 * @returns {Promise<{ok: boolean, text: string|null, reason: string, mode: string,
 *                    usage: object|null, replayed: boolean}>}
 *          `ok:false` ⇒ caller PHẢI dùng đường lui (mẫu / hàng đợi người).
 */
const callTask = async ({ task, system, prompt, jsonMode = true, maxOutputTokens = 1024 }) => {
  const mode = resolveMode();
  const fail = (reason, extra = {}) => ({
    ok: false, text: null, reason, mode, usage: null, replayed: false, ...extra,
  });

  if (mode === 'off') return fail('LLM_DISABLED_OR_MODE_OFF');
  // `replay` cố ý KHÔNG đòi key: đó chính là việc của nó (CI, demo dự phòng khi
  // mất mạng). Đòi key ở chế độ replay sẽ biến đường lui thành đường chết.
  if (mode !== 'replay' && !llm.isConfigured()) return fail('LLM_NOT_CONFIGURED');
  if (task !== LLM_TASK.SKU_MATCH && task !== LLM_TASK.PROPOSAL_EXPLAIN && task !== LLM_TASK.VENDOR_MESSAGE) {
    return fail(`UNKNOWN_TASK:${task}`);
  }

  const key = callKey({ task, system, prompt });

  // ── replay: KHÔNG gọi mạng ────────────────────────────────────────────
  if (mode === 'replay') {
    const row = readStore().get(key);
    if (!row || !row.text) return fail('REPLAY_MISS');
    reward();
    // Vẫn ghi 1 dòng `LlmUsageLog` (mode='replay') để "token phải trả" của lần
    // chạy CI/demo là 0 và được đo đúng — không được tưởng LLM là miễn phí.
    await writeUsageRow({ task, mode, usage: row.usage || null, latencyMs: 0, succeeded: true });
    return {
      ok: true, text: row.text, reason: 'REPLAY_HIT', mode, usage: row.usage || null, replayed: true,
    };
  }

  // ── live / record ──────────────────────────────────────────────────────
  if (mode === 'live' || mode === 'record') {
    try {
      assertPublicDataOnly();
    } catch (e) {
      logger.error(`[LLM-policy] chan gui du lieu that: ${e.message}`);
      return fail(e.code || 'REAL_DATA_BLOCKED');
    }
    await waitForSlot();
    try {
      llm.resetLastUsage();
      const text = await llm.generateText({
        system, prompt, jsonMode, temperature: 0, maxOutputTokens, task, mode,
      });
      const usage = llm.getLastUsage();
      reward();
      if (mode === 'record') {
        appendStore({
          key, task, model: llm.config().model, text, usage, recordedAt: new Date().toISOString(),
        });
      }
      return { ok: true, text, reason: 'LIVE_OK', mode, usage, replayed: false };
    } catch (e) {
      const msg = String(e.message || e);
      if (isTransient(msg)) penalize(msg.slice(0, 120));
      // `config/llm.js` đã tự ghi 1 dòng LlmUsageLog(succeeded=false) cho lần gọi
      // này ⇒ không ghi thêm ở đây, tránh đếm đôi.
      logger.error(`[LLM-policy] ${task} that bai (mode=${mode}): ${msg.slice(0, 200)}`);
      return fail(`LLM_ERROR:${msg.slice(0, 200)}`);
    }
  }

  return fail('UNREACHABLE_MODE');
};

/**
 * Ghi dòng `LlmUsageLog` cho lần gọi KHÔNG đi qua `config/llm.js` (chỉ có
 * `replay`, vốn không gọi mạng). Dùng lại đúng cách ghi của `config/llm.js` để
 * bảng có một nguồn ghi duy nhất về hình dạng dữ liệu.
 */
const writeUsageRow = async ({ task, mode, usage, latencyMs, succeeded }) => {
  try {
    if (process.env.LLM_USAGE_LOG === '0') return null;
    // eslint-disable-next-line global-require
    const prisma = require('./prisma');
    // eslint-disable-next-line global-require
    const { getTenantId } = require('./tenantContext');
    return await prisma.llmUsageLog.create({
      data: {
        tenantId: getTenantId(),
        task,
        provider: llm.describe().provider,
        model: llm.config().model,
        mode,
        promptTokens: usage?.promptTokens ?? 0,
        completionTokens: usage?.completionTokens ?? 0,
        totalTokens: usage?.totalTokens ?? 0,
        latencyMs: Math.max(0, Math.trunc(Number(latencyMs) || 0)),
        succeeded: succeeded === true,
      },
    });
  } catch (e) {
    logger.error(`[LLM-policy] ghi LlmUsageLog (mode=${mode}) that bai: ${e.message}`);
    return null;
  }
};

/** Chỉ số throttle/backoff để harness báo cáo (không lộ nội dung prompt). */
const policyStats = () => ({ baseThrottleMs: baseThrottleMs(), backoffFactor, mode: resolveMode() });

/** Chỉ dùng cho test — không phải API sản phẩm. */
const __resetBackoff = () => { backoffFactor = 1; nextAllowedAt = 0; };

module.exports = {
  LLM_TASK,
  RECORD_STORE,
  callTask,
  describe,
  resolveMode,
  policyStats,
  isTransient,
  callKey,
  readStore,
  __resetBackoff,
};