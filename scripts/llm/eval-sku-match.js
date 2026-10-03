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

const main = async () => {
  assertLocalDb('llm:eval khong ghi DB nhung van kiem tra DATABASE_URL cho an toan');
  const { simulated } = parseArgs();
  const mode = llmPolicy.resolveMode();
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
  const fuzzy = await runFuzzy(catalog, test);
  const hybrid = await runHybrid(catalog, test);
  const fuzzyDev = await runFuzzy(catalog, dev);
  const hybridDev = await runHybrid(catalog, dev);

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
    // Token/cặp: chỉ ghi số khi đã chạy live thật, ngược lại ghi "chưa đo".
    tokensPerPair: tokensFromUsage ? 'CHUA DO — can doc LlmUsageLog theo run nay' : 'CHUA DO',
    publishable: mode === 'live' || mode === 'record',
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
  L.push(`token/cap: ${out.tokensPerPair}`);
  L.push('');
  if (!out.publishable) {
    L.push('!! KHONG CONG BO: mode khong phai `live`. So tren chi chung minh pipeline chay.');
    L.push('   Chi duoc dua vao slide khi co mode=live + ngay chay + ten model.');
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