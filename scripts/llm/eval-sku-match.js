'use strict';

/**
 * scripts/llm/eval-sku-match.js — HARNESS ĐÁNH GIÁ KHỚP SKU THEO S10
 *
 * ============================================================================
 * GIAO THỨC ĐÃ KÝ (03-evaluation-protocol.md §9) — không tự đổi
 * ============================================================================
 *   - Bộ nhãn ≥ 100 cặp, 2 người gán độc lập, mù với kết quả mô hình; đo đồng
 *     thuận bằng Cohen's κ; bất đồng ⇒ người thứ 3 phân xử; κ < 0,6 ⇒ báo kèm cảnh báo.
 *   - Chỉ số: precision@k, recall@k tại **ngưỡng điểm tin cậy chốt trước = 0,85**;
 *     `fallbackRate` (tỉ lệ chuyển người) — luôn báo CÙNG độ chính xác, không báo riêng;
 *     thời gian xử lý 1 cặp.
 *   - Bắt buộc có **đối chứng baseline fuzzy không-LLM trên cùng bộ nhãn**. Không có
 *     đối chứng thì không được nói "LLM khớp tốt hơn".
 *   - Chỉ nói "LLM khớp tốt hơn" khi CI bootstrap **theo cặp** (seed 20261003, 1000
 *     lần) của chênh lệch **không chứa 0**.
 *   - `n < 100` ⇒ chỉ báo số đếm, không báo phần trăm.
 *
 * ============================================================================
 * HAI ĐƯỜNG ĐỐI CHỨNG
 * ============================================================================
 *   A. `fuzzy`      — `SkuMatcher` thuần (không LLM). Đây là baseline bắt buộc.
 *   B. `hybrid`     — `matchHybridBatch` (công thức + LLM ca mơ hồ + người xác nhận).
 *
 * Chỉ số tính trên tập **test**; tập **dev** dùng để soi (và báo cáo riêng) — không
 * tinh chỉnh tham số trên test.
 *
 * ============================================================================
 * CHẾ ĐỘ LLM
 * ============================================================================
 * Chế độ đọc từ `LLM_MODE` (xem `src/config/llm-policy.js`):
 *   - `off` / `replay` ⇒ chạy được nhưng **KHÔNG được công bố số độ chính xác**;
 *     báo cáo ghi rõ `mode` và `KHONG CONG BO` (01-llm-role.md §3.3).
 *   - `live` / `record` ⇒ số đo được công bố kèm ngày + tên model.
 *
 * LỆNH:
 *   npm run llm:eval                       # dùng nhãn tay đã gán
 *   npm run llm:eval -- --simulated        # dùng đáp án MÔ PHỎNG (chỉ để chạy máy)
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { assertLocalDb } = require('../lib/assert-local-db');
const { readCsvObjects } = require('../lib/csv');
const ROOT = path.resolve(__dirname, '..', '..');

const { SkuMatcher, AUTO_ACCEPT_SCORE, REVIEW_SCORE } = require(`${ROOT}/src/modules/import/sku-matcher`);
const { matchHybridBatch, HUMAN_THRESHOLD } = require(`${ROOT}/src/modules/import/sku-matcher.hybrid`);
const llmPolicy = require(`${ROOT}/src/config/llm-policy`);
// Dùng cho đọc `LlmUsageLog` sau khi chạy (đo token thật) — xem `readUsage()`.
const prisma = require(`${ROOT}/src/config/prisma`);

const LABEL_DIR = path.join(ROOT, 'data', 'aisc26', 'skus', 'labels');
const SHEET = path.join(LABEL_DIR, 'label-sheet.csv');
const TRUTH_SIM = path.join(LABEL_DIR, 'truth.simulated.csv');
const CATALOG_CSV = path.join(ROOT, 'data', 'dataset', 'sku_names.csv');

/** Ngưỡng điểm tin cậy chốt trước theo S10 — dùng để quyết định "tự áp dụng". */
const CONF_THRESHOLD = 0.85;
/** Seed bootstrap cố định (S10 ghi rõ 20261003). */
const SEED = 20261003;
const RESAMPLES = 1000;
/** Tỉ lệ test trong bộ nhãn (phần còn lại là dev). */
const TEST_SHARE = 0.5;

const mulberry32 = (seed) => {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const pct = (v) => (v === null || v === undefined ? null : Number((v * 100).toFixed(2)));
const round = (v, d = 4) => (v === null || v === undefined || !Number.isFinite(v) ? null : Number(v.toFixed(d)));

/** CSV đọc bằng bộ đọc chuẩn `scripts/lib/csv.js` (tên hàng có dấu phẩy/nháy kép). */
const readCsv = (file) => readCsvObjects(fs.readFileSync(file, 'utf8'));

/** Tách dev/test tất định (seed cố định ⇒ chạy lại ra CÙNG một cách chia). */
const splitDevTest = (pairs, testShare = TEST_SHARE) => {
  const rnd = mulberry32(SEED);
  const tagged = pairs.map((p) => ({ ...p, _u: rnd() }));
  tagged.sort((a, b) => (a.pair_id < b.pair_id ? -1 : 1));
  const nTest = Math.round(tagged.length * testShare);
  const dev = tagged.slice(0, tagged.length - nTest);
  const test = tagged.slice(tagged.length - nTest);
  return { dev, test };
};

/**
 * Cohen's κ cho 2 người gán (S10). Cần cả 2 cột `labeler_a`/`labeler_b` có tên.
 * Không đủ dữ liệu ⇒ trả `null` + lý do, KHÔNG bịa κ.
 */
const cohensKappa = (a, b) => {
  const pairs = a.map((x, i) => [x, b[i]]).filter(([x, y]) => x && y);
  const n = pairs.length;
  if (!n) return { kappa: null, n: 0, reason: 'chua co cap nao ca hai nguoi gan cung mot nhan' };
  const cats = [...new Set(pairs.flat())];
  const agree = pairs.filter(([x, y]) => x === y).length;
  const po = agree / n;
  let pe = 0;
  for (const c of cats) {
    const pa = pairs.filter(([x]) => x === c).length / n;
    const pb = pairs.filter(([, y]) => y === c).length / n;
    pe += pa * pb;
  }
  const kappa = pe >= 1 ? 1 : (po - pe) / (1 - pe);
  return { kappa: round(kappa, 4), n, po: round(po, 4), pe: round(pe, 4), low: kappa < 0.6 };
};

/**
 * Chỉ số ở ngưỡng chốt trước.
 *
 * Một cặp là "tự áp dụng" (pred) nếu hệ thống trả về SKU **và** không yêu cầu người.
 * Cặp nào chuyển người thì KHÔNG tính là đoán đúng/sai — nó là chi phí vận hành,
 * và S10 yêu cầu báo `fallbackRate` cùng độ chính xác, không báo riêng.
 *
 * @param {Array<{pair_id, label_sku, pred_sku, needsHuman}>} rows
 */
const scoreAtThreshold = (rows) => {
  let tp = 0; let fp = 0; let fn = 0; let escalated = 0;
  for (const r of rows) {
    const truth = r.label_sku || null;
    const pred = r.pred_sku || null;
    const predictedAuto = Boolean(pred) && r.needsHuman !== true;
    if (!predictedAuto) {
      escalated += 1;
      if (!truth) continue;      // không có nhãn ⇒ không tính recall
      fn += 1;                    // có nhãn nhưng hệ thống không tự áp dụng
      continue;
    }
    if (!truth) { fp += 1; continue; } // hệ thống tự áp dụng mà không có nhãn để đối chiếu
    if (pred === truth) tp += 1;
    else fp += 1;
  }
  const labelled = rows.filter((r) => r.label_sku).length;
  const precision = tp + fp > 0 ? tp / (tp + fp) : null;
  const recall = tp + fn > 0 ? tp / (tp + fn) : null;
  const f1 = precision !== null && recall !== null && precision + recall > 0
    ? (2 * precision * recall) / (precision + recall) : 0;
  return {
    n: rows.length,
    labelled,
    tp, fp, fn,
    precision: round(precision),
    recall: round(recall),
    f1: round(f1),
    escalated,
    fallbackRate: rows.length ? round(escalated / rows.length) : null,
  };
};

/** Bootstrap THEO CẶP của chênh lệch F1 (S10) — seed cố định, 1000 lần. */
const bootstrapF1Diff = (rowsA, rowsB, { seed = SEED, resamples = RESAMPLES } = {}) => {
  const n = Math.min(rowsA.length, rowsB.length);
  if (n < 2) return { n, point: null, ciLow: null, ciHigh: null, note: 'nua du cap' };
  const f1Of = (rows, idxSet) => {
    let tp = 0; let fp = 0; let fn = 0;
    idxSet.forEach((i) => {
      const r = rows[i];
      const truth = r.label_sku || null;
      const predictedAuto = Boolean(r.pred_sku) && r.needsHuman !== true;
      if (!predictedAuto) { if (truth) fn += 1; return; }
      if (!truth) { fp += 1; return; }
      if (r.pred_sku === truth) tp += 1; else fp += 1;
    });
    const p = tp + fp > 0 ? tp / (tp + fp) : 0;
    const rcl = tp + fn > 0 ? tp / (tp + fn) : 0;
    return p + rcl > 0 ? (2 * p * rcl) / (p + rcl) : 0;
  };
  const all = Array.from({ length: n }, (_, i) => i);
  const point = f1Of(rowsA, all) - f1Of(rowsB, all);
  const rnd = mulberry32(seed);
  const diffs = [];
  for (let r = 0; r < resamples; r += 1) {
    const idx = [];
    for (let i = 0; i < n; i += 1) idx.push(Math.floor(rnd() * n));
    diffs.push(f1Of(rowsA, idx) - f1Of(rowsB, idx));
  }
  diffs.sort((x, y) => x - y);
  const lo = diffs[Math.floor(0.025 * resamples)];
  const hi = diffs[Math.floor(0.975 * resamples) - 1] ?? diffs[diffs.length - 1];
  return { n, seed, resamples, point: round(point), ciLow: round(lo), ciHigh: round(hi), excludesZero: lo > 0 || hi < 0 };
};

/** Chạy baseline fuzzy thuần trên một tập cặp. */
const runFuzzy = async (catalog, pairs) => {
  const matcher = new SkuMatcher(catalog);
  const t0 = Date.now();
  const rows = pairs.map((p) => {
    const m = matcher.match(p.external_name, {});
    return {
      pair_id: p.pair_id,
      label_sku: p.label_sku || null,
      pred_sku: m.sku || null,
      // Fuzzy tự quyết khi AUTO_ACCEPT; dưới đó là hàng đợi người.
      needsHuman: m.status !== 'AUTO_ACCEPT',
      fuzzyScore: m.score,
      reason: m.reason,
    };
  });
  return { rows, ms: Date.now() - t0 };
};

/** Chạy đường lai (công thức + LLM ca mơ hồ + người xác nhận). */
const runHybrid = async (catalog, pairs) => {
  const t0 = Date.now();
  const inputs = pairs.map((p) => ({ name: p.external_name, ref: p.pair_id }));
  const res = await matchHybridBatch(inputs, catalog, { useLlm: true });
  const byRef = new Map();
  for (const r of [...res.matched, ...res.reviewQueue]) {
    byRef.set(r.ref, { sku: r.sku, needsHuman: r.needsHuman === true, via: r.via, confidence: r.confidence });
  }
  const rows = pairs.map((p) => {
    const hit = byRef.get(p.pair_id) || {};
    return {
      pair_id: p.pair_id,
      label_sku: p.label_sku || null,
      pred_sku: hit.sku || null,
      needsHuman: hit.needsHuman !== false,
      via: hit.via || 'missing',
      confidence: hit.confidence ?? null,
    };
  });
  return { rows, ms: Date.now() - t0, stats: res.stats };
};

const parseArgs = () => {
  const sim = process.argv.includes('--simulated');
  const modeIdx = process.argv.indexOf('--mode');
  return { simulated: sim, mode: modeIdx >= 0 ? process.argv[modeIdx + 1] : undefined };
};

/**
 * Đọc `LlmUsageLog` để đo TOKEN THẬT của lần chạy này.
 *
 * VÌ SAO CÓ (sửa 2026-10-14): dòng 361 cũ gán cứng
 * `tokensPerPair: 'CHUA DO - can doc LlmUsageLog theo run nay'` — nghĩa là
 * `tokensFromUsage` được tính rồi **vứt đi**, và không lần nào trong lịch sử
 * dự án có con số token thật. `config/llm.js` và `writeUsageRow` của
 * `llm-policy` đã ghi sẵn từng lần gọi vào bảng `llm_usage_logs`; chỉ là không
 * ai đọc lại.
 *
 * Cửa sổ lọc = `[since, until)` quanh lần chạy + `task='SKU_MATCH'`. Khoá theo
 * `task` vì các tác vụ khác (`PROPOSAL_EXPLAIN`, `VENDOR_MESSAGE`) dùng chung
 * bảng và cùng có thể chạy song song.
 *
 * @returns {Promise<object>} số đo token/độ trễ, hoặc `{ measured:false, lyDo }`
 */
const readUsage = async (since, until) => {
  try {
    const agg = await prisma.llmUsageLog.aggregate({
      where: { task: 'SKU_MATCH', createdAt: { gte: since, lt: until } },
      _sum: {
        promptTokens: true,
        completionTokens: true,
        totalTokens: true,
        latencyMs: true,
      },
      _count: { _all: true },
    });
    const n = agg._count._all;
    if (!n) return { measured: false, lyDo: 'khong co dong LlmUsageLog nao cho task SKU_MATCH trong cua so chay' };
    return {
      measured: true,
      soLanGoi: n,
      promptTokens: agg._sum.promptTokens || 0,
      completionTokens: agg._sum.completionTokens || 0,
      totalTokens: agg._sum.totalTokens || 0,
      doTreTrungBinhMs: Math.round((agg._sum.latencyMs || 0) / n),
      // Thời gian bị trả về kể cả lần lỗi — vẫn là chi phí thật của hệ thống.
      luuY: 'doTreTrungBinhMs tinh ca lan ERROR (503/timeout) — la chi phi that',
    };
  } catch (e) {
    return { measured: false, lyDo: `doc LlmUsageLog that bai: ${e.message}` };
  }
};

const main = async () => {
  assertLocalDb('llm:eval khong ghi DB nhung van kiem tra DATABASE_URL cho an toan');
  const { simulated, mode: cliMode } = parseArgs();
  // SỬA 2026-10-14 — CỜ CLI `--mode` TỪNG BỊ BỎ QUA (im lặng).
  //
  // BUG THẬT: `parseArgs()` trả về `{ simulated, mode }`, nhưng dòng cũ chỉ
  // destructure `const { simulated } = parseArgs();` ⇒ `mode` bị vứt im lặng.
  // Dòng kế bên lại `llmPolicy.resolveMode()` chỉ đọc biến môi trường
  // `LLM_MODE` (xem `src/config/llm-policy.js:105-107`) ⇒ lệnh
  // `npm run llm:eval -- --mode live` **vẫn chạy ở mode=off** và không báo lỗi.
  // Tài liệu hướng dẫn sai ở 6 chỗ (00-index.md, 09-real-data-evidence.md,
  // FILL-IN.md, MORNING-REPORT.md, STATE.md) — ai làm theo sẽ tưởng đã đo
  // được LLM thật trong khi vẫn là đường không-LLM.
  //
  // SỬA: cờ CLI được ghi vào `LLM_MODE` TRƯỚC khi `resolveMode()` chạy. Thứ tự
  // này quan trọng: `resolveMode` đọc biến môi trường lúc gọi, không phải lúc
  // nạp module — nên phải gán trước.
  if (cliMode) {
    if (!['off', 'record', 'replay', 'live'].includes(cliMode)) {
      throw new Error(
        `--mode ${cliMode} khong hop le. Chi chap nhan: off | record | replay | live.`,
      );
    }
    process.env.LLM_MODE = cliMode;
    // `LLM_DISABLED=1` vẫn phải thắng: đó là khoá cứu, không phải tuỳ chọn.
    console.log(`[llm:eval] --mode ${cliMode} → ep LLM_MODE=${cliMode}`);
  }
  const mode = llmPolicy.resolveMode();
  if (cliMode && cliMode !== mode) {
    console.log(
      `[llm:eval] YEU CAU mode=${cliMode} NHUNG resolveMode() tra ${mode}` +
      `${process.env.LLM_DISABLED === '1' ? ' (do LLM_DISABLED=1 — khoa cuu dung dat)' : ''}`,
    );
  }
  const catalog = readCsv(CATALOG_CSV).map((r) => ({ sku: r.sku, name: r.name }));
  const sheet = readCsv(SHEET);

  // ── nhãn ────────────────────────────────────────────────────────────────
  let pairs;
  let labelSource;
  if (simulated) {
    if (!fs.existsSync(TRUTH_SIM)) throw new Error('thieu truth.simulated.csv');
    const truth = new Map(readCsv(TRUTH_SIM).map((r) => [r.pair_id, r.sku]));
    pairs = sheet.map((r) => ({
      pair_id: r.pair_id,
      external_name: r.external_name,
      label_sku: truth.get(r.pair_id) || null,
    }));
    labelSource = 'MO PHONG (dap an cua bo sinh tep xuat don) — KHONG phai nhan nguoi';
  } else {
    pairs = sheet.map((r) => ({
      pair_id: r.pair_id,
      external_name: r.external_name,
      label_sku: r.label_sku || null,
      labeler_a: r.labeler_a || null,
      labeler_b: r.labeler_b || null,
      label_confidence: r.label_confidence || null,
    }));
    labelSource = 'nhan tay (label_sku do nguoi dien)';
  }

  const labelled = pairs.filter((p) => p.label_sku).length;
  if (!simulated && labelled === 0) {
    console.log('=== KHU VUC CHUA DO DUOC (BLOCKER-HUMAN) ===');
    console.log(`Phieu ${path.relative(ROOT, SHEET)} co ${pairs.length} cap nhung COT label_sku con TRONG.`);
    console.log('Khong co nhan tay thi khong tinh duoc precision/recall - va quy tac S10 cam do.');
    console.log('');
    console.log('Dung 2 nguoi gan doc lap theo huong dan, roi chay lai:');
    console.log('  1) mo docs/aisc26/notes/sku-labeling-guide.md');
    console.log('  2) moi nguoi dien MOT cot: labeler_a va labeler_b (khong xem cot cua nhau)');
    console.log('  3) sau khi hai ben thong nhat label_sku (phan xu giua khi khac)');
    console.log('  4) chay: npm run llm:eval');
    console.log('');
    console.log(`Muon chi chay may (khong cong bo so): npm run llm:eval -- --simulated`);
    process.exit(2);
  }

  const { dev, test } = splitDevTest(pairs);
  const usageSince = new Date();
  const fuzzy = await runFuzzy(catalog, test);
  const hybrid = await runHybrid(catalog, test);
  const fuzzyDev = await runFuzzy(catalog, dev);
  const hybridDev = await runHybrid(catalog, dev);
  const usageUntil = new Date();

  // Token thật — đọc từ DB, không đoán.
  const usage = (mode === 'live' || mode === 'record')
    ? await readUsage(usageSince, usageUntil)
    : { measured: false, lyDo: `mode=${mode} — khong co lenh goi that nen khong co token` };
  const perPair = (total, count) => (count > 0 ? Number((total / count).toFixed(1)) : null);
  const tokensPerPairNumber = usage.measured
    ? {
      trenMoiCapDaDoi: perPair(usage.totalTokens, usage.soLanGoi),
      trenMoiCapKiemDinh: perPair(usage.totalTokens, test.length),
      trenMoiCapDaNhan: perPair(usage.totalTokens, labelled),
    }
    : null;

  const sFuzzy = scoreAtThreshold(fuzzy.rows);
  const sHybrid = scoreAtThreshold(hybrid.rows);
  const boot = bootstrapF1Diff(hybrid.rows, fuzzy.rows);

  const kappa = simulated
    ? { kappa: null, n: 0, reason: 'nhan MO PHONG - khong tinh Cohen kappa duoc' }
    : cohensKappa(pairs.map((p) => p.labeler_a), pairs.map((p) => p.labeler_b));

  // Token: chỉ có số thật khi đã chạy live. Replay/off ⇒ 0 và ghi "chưa đo".
  const tokensFromUsage = hybrid.stats.llmCalls > 0 && (mode === 'live' || mode === 'record');
  const out = {
    runId: `S10-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`,
    at: new Date().toISOString(),
    labelSource,
    dataset: {
      labelSheet: path.relative(ROOT, SHEET),
      catalog: path.relative(ROOT, CATALOG_CSV),
      totalPairs: pairs.length,
      labelled,
      nhanLaMoPhong: simulated,
    },
    mode,
    llm: llmPolicy.describe(),
    confThreshold: CONF_THRESHOLD,
    baselineThresholds: { autoAccept: AUTO_ACCEPT_SCORE, review: REVIEW_SCORE },
    seed: SEED,
    resamples: RESAMPLES,
    split: { test: test.length, dev: dev.length },
    kappa,
    test: { fuzzy: sFuzzy, hybrid: sHybrid },
    dev: { fuzzy: scoreAtThreshold(fuzzyDev.rows), hybrid: scoreAtThreshold(hybridDev.rows) },
    f1DiffBootstrap: boot,
    throughput: {
      fuzzyMs: fuzzy.ms,
      hybridMs: hybrid.ms,
      msPerPairFuzzy: round(fuzzy.ms / Math.max(1, test.length), 2),
      msPerPairHybrid: round(hybrid.ms / Math.max(1, test.length), 2),
    },
    llmCalls: hybrid.stats.llmCalls,
    llmUsable: hybrid.stats.llmUsable,
    llmRejected: hybrid.stats.llmRejected,
    llmMisses: hybrid.stats.llmMisses,
    // Lý do trượt tách nhóm (sửa 2026-10-14 — trước đây báo cáo gọi chung là
    // "503/timeout", nhưng đo thật cho thấy API không hỏng).
    llmMissBy: hybrid.stats.llmMissBy,
    tyLeDungDuoc: hybrid.stats.tyLeDungDuoc,
    // Token/độ trễ đọc thật từ `llm_usage_logs` (sửa 2026-10-14 — trước đây gán
    // cứng chuỗi "CHUA DO" dù đã chạy live).
    usage,
    // Token/cặp: chỉ ghi số khi đã chạy live thật, ngược lại ghi "chưa đo".
    tokensPerPair: tokensFromUsage ? tokensPerPairNumber : 'CHUA DO',
    // SỬA 2026-10-14 — `publishable` trước đây CHỈ xét `mode`, nên một lần chạy
    // `mode=live` mà LLM **không lần nào** thành công vẫn bị gắn
    // `publishable: true`. Hệ quả: hybrid ≡ fuzzy (vì LLM không được dùng) nhưng
    // vẫn mang nhãn "số AI" ⇒ có thể bị đưa lên slide nhầm.
    //
    // Nay đòi cả hai: ĐÃ chạy live/record **và** có ít nhất 1 câu trả lời LLM
    // dùng được. Không đạt ⇒ `publishable: false` kèm lý do.
    publishable: (mode === 'live' || mode === 'record') && hybrid.stats.llmUsable > 0,
    lyDoKhongCongBo: (mode !== 'live' && mode !== 'record')
      ? `mode=${mode} — phai chay live hoac record`
      : (hybrid.stats.llmUsable === 0
        ? 'mode=live nhung KHONG co cau tra loi LLM nao dung duoc (het ha muc 429 / 503) '
          + '=> hybrid chay dung bang fuzzy, khong phai so cua AI'
        : null),
  };

  const file = path.join(ROOT, 'docs', 'aisc26', 'notes', 'sku-eval-last-run.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`, 'utf8');

  // ── in báo cáo ──────────────────────────────────────────────────────────
  const L = [];
  L.push('=== DANH GIA KHOIP SKU (S10) ===');
  L.push(`run_id: ${out.runId} | mode: ${mode} | nhan: ${labelSource}`);
  L.push(`n = ${out.dataset.totalPairs} cap (co nhan: ${labelled}) | test ${test.length} / dev ${dev.length}`);
  L.push(`nguong cham: confidence >= ${CONF_THRESHOLD}`);
  L.push('');
  L.push(`BASELINE fuzzy khong-LLM : P=${sFuzzy.precision} R=${sFuzzy.recall} F1=${sFuzzy.f1} chuyen_nguoi=${pct(sFuzzy.fallbackRate)}%`);
  L.push(`HYBRID (fuzzy + LLM)     : P=${sHybrid.precision} R=${sHybrid.recall} F1=${sHybrid.f1} chuyen_nguoi=${pct(sHybrid.fallbackRate)}%`);
  L.push(`bootstrap F1(hybrid-fuzzy): ${boot.point} CI95 [${boot.ciLow}, ${boot.ciHigh}] ${boot.excludesZero ? '=> KHONG chua 0' : '=> CHUA 0'}`);
  L.push(`Cohen kappa (2 nguoi gan): ${kappa.kappa ?? kappa.reason}${kappa.low ? '  <0,6 => nhan chua du tin cay' : ''}`);
  L.push(`LLM goi: ${hybrid.stats.llmCalls} | dung duoc: ${hybrid.stats.llmUsable} | trượt: ${hybrid.stats.llmMisses}`);
  if (usage.measured) {
    L.push(
      `TOKEN THAT  : ${usage.totalTokens} tok (prompt ${usage.promptTokens} + completion ` +
      `${usage.completionTokens}) tren ${usage.soLanGoi} lenh goi · do tre TB ${usage.doTreTrungBinhMs} ms`,
    );
    L.push(
      `token/cap   : ${tokensPerPairNumber.trenMoiCapDaDoi} tren moi lenh goi · ` +
      `${tokensPerPairNumber.trenMoiCapKiemDinh} tren moi cap kiem dinh · ` +
      `${tokensPerPairNumber.trenMoiCapDaNhan} tren moi cap da nhan`,
    );
    // Sửa 2026-10-14 — cảnh báo cũ ghi "503/timeout" cho MỌI trường hợp trượt.
    // Đo trên DB thật cho thấy 13/13 lời gọi API đều HTTP 200: trượt phần lớn vì
    // LLM trả JSON sai khuôn dạng, không phải vì hạ tầng. Ghi đúng nguyên nhân.
    const missBy = hybrid.stats.llmMissBy || {};
    const tyLe = hybrid.stats.tyLeDungDuoc;
    L.push(`ty le LLM tra loi chac chan: ${tyLe}% (${hybrid.stats.llmUsable}/${hybrid.stats.llmCalls} ca duoc hoi)`);
    if (tyLe !== null && tyLe < 50) {
      const goc = [];
      if (missBy.api) goc.push(`${missBy.api} loi API`);
      if (missBy.json) goc.push(`${missBy.json} JSON sai khuon dang`);
      if (missBy.hallucinatedSku) goc.push(`${missBy.hallucinatedSku} tra ma ngoai danh sach ung vien`);
      if (missBy.other) goc.push(`${missBy.other} ly do khac`);
      L.push('');
      L.push('!! TINH DUNG DUOC THAP. Phan tang cua hybrid tren bo mau nay KHONG');
      L.push('   dien dai — dung no de so sanh voi nguoi khac.');
      if (goc.length) L.push(`   Ly do truot: ${goc.join('; ')}.`);
    }
  } else {
    L.push(`token/cap: CHUA DO — ${usage.lyDo}`);
  }
  L.push('');
  if (!out.publishable) {
    L.push('!! KHONG CONG BO.');
    L.push(`   Ly do: ${out.lyDoKhongCongBo}`);
    L.push('   Chi duoc dua vao slide khi co mode=live + ngay chay + TEN MODEL + it nhat');
    L.push('   mot cau tra loi LLM dung duoc.');
  }
  if (simulated) {
    L.push('!! NHAN LA MO PHONG (sinh tu catalog) — KHONG phai nhan nguoi, KHONG phai do chinh xac thuc te.');
  }
  if (labelled < 100) L.push('!! n < 100 => chi bao so dem, KHONG bao phan tram.');
  L.push(`ghi: ${path.relative(ROOT, file)}`);

  console.log(L.join('\n'));
  await require(`${ROOT}/src/config/prisma`).$disconnect().catch(() => {});
  process.exit(0);
};

main().catch((e) => {
  console.error(`[llm:eval] that bai: ${e.message}`);
  process.exit(1);
});