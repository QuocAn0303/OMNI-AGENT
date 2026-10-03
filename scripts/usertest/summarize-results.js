'use strict';

/**
 * scripts/usertest/summarize-results.js — `npm run usertest:summarize`
 *
 * ============================================================================
 * MỤC ĐÍCH (T15): đọc kết quả bài thử của người thử và chấm quyết định tay (P4)
 * ============================================================================
 * Đầu vào:
 *   --scenario docs/aisc26/usertest/sku-sets.json      (bắt buộc, số tham chiếu)
 *   --tasks     <tasks.csv>      1 dòng / 1 người thử / 1 điều kiện
 *   --decisions <decisions.csv>  1 dòng / 1 người thử / 1 SKU
 *   --sample    chạy thử bằng bộ SAMPLE kèm theo, in nhãn SAMPLE, không cần file
 *
 * Đầu ra: trung vị + khoảng min–max cho mọi chỉ số, và bảng chấm P4 chạy trên
 * `scripts/backtest/lib/simulate.js` — CÙNG bộ mô phỏng với backtest T10.
 *
 * ----------------------------------------------------------------------------
 * BA QUY TẮC BẮT BUỘC (ghi trong NIGHT-PROMPT.md T15, không được nới)
 * ----------------------------------------------------------------------------
 *  1. Dưới 5 người thử: CHỈ báo trung vị + khoảng. Không phần trăm, không trung
 *     bình, không p-value, không "có ý nghĩa thống kê". Script in cảnh báo và chỉ
 *     in hai thống kê đó.
 *  2. Không tính kiểm định thống kê nào cả — dưới 5 người thì p-value là rác.
 *     Script cố tình KHÔNG có đường tính p-value.
 *  3. Mọi con số phải mang nhãn phạm vi: SAMPLE / MÔ PHỎNG. Kịch bản là dữ liệu
 *     MÔ PHỎNG (UCI Online Retail II, CC BY 4.0). Khi chạy `--sample`, mọi dòng
 *     kết quả ghi nhãn SAMPLE để không bao giờ bị trích ra ngoài.
 *
 * Chấm P4 — ba biến thể trên cùng một kịch bản, cùng một hàm mô phỏng:
 *   MANUAL — đặt đúng số người thử chọn, MỘT lần tại ngày 0
 *   REF    — hệ thống: rà soát hằng ngày, đặt `max(0, ROP − vị thế)`
 *   NONE   — không đặt gì
 * Bất lợi của hệ thống (phải nói khi báo cáo): REF được rà soát 14 lần, MANUAL
 * chỉ một lần. Đây là đánh đổi có ý thức để so "quy trình" với "một quyết định",
 * không phải so hai thuật toán.
 */

const fs = require('fs');
const path = require('path');

const { readCsvObjects } = require('../lib/csv');
const { simulate } = require('../backtest/lib/simulate');

const ROOT = path.resolve(__dirname, '..', '..');
const USERTEST_DIR = path.join(ROOT, 'docs', 'aisc26', 'usertest');
const SAMPLE_DIR = path.join(USERTEST_DIR, 'sample');
const MIN_N_FOR_MORE = 5;

const num = (v) => {
  const n = Number(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};
const nfmt = (v) =>
  v === null || v === undefined ? '—' : new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(v);
const pad = (s, n) => String(s).padEnd(n);

const median = (xs) => {
  if (!xs.length) return null;
  const a = [...xs].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};

/**
 * Báo cáo MỘT chỉ số theo đúng quy tắc: luôn trung vị + khoảng min–max.
 * Không có nhánh "đủ người thì làm thêm" — nói rõ vì sao ở đây không có.
 */
const report = (label, xs, unit = '') => {
  const clean = xs.filter((x) => x !== null && Number.isFinite(x));
  if (!clean.length) return `  ${pad(label, 30)} (chưa có số liệu)`;
  const m = median(clean);
  const lo = Math.min(...clean);
  const hi = Math.max(...clean);
  return `  ${pad(label, 30)} trung vị ${nfmt(m)}${unit}  [${nfmt(lo)} – ${nfmt(hi)}]  n=${clean.length}`;
};

const medianSpread = (label, xs, unit = '') => {
  const clean = xs.filter((x) => x !== null && Number.isFinite(x));
  const m = median(clean);
  const iqr = (() => {
    if (clean.length < 4) return null;
    const a = [...clean].sort((x, y) => x - y);
    const q1 = median(a.slice(0, Math.floor(a.length / 2)));
    const q3 = median(a.slice(Math.ceil(a.length / 2)));
    return q3 - q1;
  })();
  return { label, median: m, lo: Math.min(...clean), hi: Math.max(...clean), n: clean.length, iqr, unit };
};

// ───────────────────────── chấm P4 bằng bộ mô phỏng của backtest ─────────────────────────

/** Chạy một biến thể chính sách trên kịch bản của một SKU. */
const runVariant = (variant, sku, manualQty) => {
  const demand = sku.horizon;
  const initialAtp = num(sku.atp) + num(sku.onOrder);
  const policy = (() => {
    if (variant === 'NONE') return { orderQty: () => 0 };
    if (variant === 'MANUAL') {
      let fired = false;
      return {
        orderQty: () => {
          if (fired) return 0;
          fired = true;
          return Math.max(0, Math.ceil(num(manualQty)));
        },
      };
    }
    // REF — đúng công thức sản phẩm: ROP = nhu_cầu × LT + SS; đặt khi vị thế < ROP.
    const rop = num(sku.rop);
    return {
      orderQty: ({ position }) => Math.max(0, Math.ceil(rop - position)),
    };
  })();

  const sim = simulate({
    nDays: demand.length,
    demand,
    policy,
    policyParams: {},
    leadTimeDays: Math.max(1, Math.round(num(sku.leadTimeDays))),
    initialAtp,
    costPerUnit: num(sku.unitCost),
    positionMode: 'withOnOrder',
  });
  return { lostUnits: sim.lostUnits, sold: sim.sold, avgValue: sim.avgValue, orderCount: sim.orderCount };
};

/** Chấm một bảng quyết định (người thử × bộ SKU) trả về số tổng + mức lệch với hệ thống. */
const gradeSheet = (rows, index) => {
  const per = [];
  let absDev = [];
  let ratio = [];
  for (const sku of index) {
    const hit = rows.find((r) => r.sku === sku.sku);
    if (!hit) continue;
    const manualQty = num(hit.manual_qty);
    if (manualQty === null) continue;
    const m = runVariant('MANUAL', sku, manualQty);
    const r = runVariant('REF', sku, 0);
    const n = runVariant('NONE', sku, 0);
    per.push({
      sku: sku.sku,
      manualQty,
      systemQty: sku.orderQty,
      lostManual: m.lostUnits,
      lostRef: r.lostUnits,
      lostNone: n.lostUnits,
      valueManual: m.avgValue,
      valueRef: r.avgValue,
      valueNone: n.avgValue,
      soldManual: m.sold,
    });
    absDev.push(Math.abs(manualQty - sku.orderQty));
    ratio.push(num(sku.orderQty) > 0 ? manualQty / sku.orderQty : null);
  }
  const sum = (f) => per.reduce((a, x) => a + num(x[f] || 0), 0);
  return {
    rows: per,
    nSkus: per.length,
    lostManual: sum('lostManual'),
    lostRef: sum('lostRef'),
    lostNone: sum('lostNone'),
    valueManual: sum('valueManual'),
    valueRef: sum('valueRef'),
    valueNone: sum('valueNone'),
    soldManual: sum('soldManual'),
    absDev,
    ratio,
  };
};

const loadIndex = (scenarioPath) => {
  const p = JSON.parse(fs.readFileSync(scenarioPath, 'utf8'));
  const mk = (rows, key) =>
    rows.map((c) => ({
      ...c,
      horizon: (p.grading.horizonBySku && p.grading.horizonBySku[c.sku]) || [],
    }));
  return { payload: p, index: { A: mk(p.sets.A, 'A'), B: mk(p.sets.B, 'B') } };
};

const parseArgs = () => {
  const a = process.argv.slice(2);
  const out = {
    sample: a.includes('--sample'),
    makeSample: a.includes('--make-sample'),
  };
  const get = (flag) => {
    const i = a.indexOf(flag);
    return i >= 0 ? a[i + 1] : null;
  };
  out.scenario = get('--scenario') || path.join(USERTEST_DIR, 'sku-sets.json');
  out.tasks = get('--tasks');
  out.decisions = get('--decisions');
  if (out.sample || out.makeSample) {
    out.tasks = out.tasks || path.join(SAMPLE_DIR, 'tasks.sample.csv');
    out.decisions = out.decisions || path.join(SAMPLE_DIR, 'decisions.sample.csv');
  }
  if (!out.makeSample && (!fs.existsSync(out.tasks) || !fs.existsSync(out.decisions))) {
    console.error(
      'Thiếu tệp kết quả. Ví dụ:\n' +
      '  npm run usertest:summarize -- --tasks docs/aisc26/usertest/results/tasks.csv ' +
      '--decisions docs/aisc26/usertest/results/decisions.csv\n' +
      '  npm run usertest:summarize -- --make-sample   (tạo bộ SAMPLE rồi chạy thử)');
    process.exit(1);
  }
  return out;
};

/**
 * Tạo bộ SAMPLE: số lượng BỊA, cố ý lệch khỏi hệ thống theo hướng "người thử bán
 * thủ công" (hơi ít ở SKU bán nhanh, hơi nhiều ở SKU bán chậm) để kịch bản có đủ
 * biến thiên mà vẫn kiểm tra được đường chấm. KHÔNG dùng số này để kết luận gì.
 * Cố ý chỉ 3 người thử để kịch bản cảnh báo "n < 5" chạy đúng.
 */
const makeSample = (index) => {
  fs.mkdirSync(SAMPLE_DIR, { recursive: true });
  const fakes = [
    { id: 'S01', group: 'AB', secs: [980, 610] },
    { id: 'S02', group: 'BA', secs: [1240, 720] },
    { id: 'S03', group: 'AB', secs: [860, 540] },
  ];
  const taskRows = [];
  const decisionRows = [];
  for (const f of fakes) {
    for (const cond of ['COND1_NO_SYSTEM', 'COND2_WITH_SYSTEM']) {
      const setKey = f.group === 'AB'
        ? (cond === 'COND1_NO_SYSTEM' ? 'A' : 'B')
        : (cond === 'COND1_NO_SYSTEM' ? 'B' : 'A');
      taskRows.push([
        f.id,
        'yes',
        f.group,
        cond,
        setKey,
        cond === 'COND1_NO_SYSTEM' ? f.secs[0] : f.secs[1],
        cond === 'COND1_NO_SYSTEM' ? 3 : 4,
        cond === 'COND1_NO_SYSTEM' ? 2 : 4,
        cond === 'COND2_WITH_SYSTEM' ? 'yes' : 'maybe',
        'SAMPLE - du lieugia dinh',
      ]);
      for (const sku of index[setKey]) {
        // Hệ số cố ý lệch: 0,6 nếu SKU bán nhanh, 1,4 nếu bán chậm.
        const k = num(sku.demandPerDay) >= 20 ? 0.6 : 1.4;
        const jitter = 1 + ((f.id.charCodeAt(2) % 5) - 2) / 20;
        const q = Math.max(0, Math.round(num(sku.orderQty) * k * jitter));
        decisionRows.push([f.id, setKey, sku.sku, q, 'SAMPLE']);
      }
    }
  }
  const { toCsv } = require('../lib/csv');
  fs.writeFileSync(
    path.join(SAMPLE_DIR, 'tasks.sample.csv'),
    toCsv(
      ['participant_id', 'consent', 'group', 'condition', 'set_key', 'seconds',
        'confidence_before', 'confidence_after', 'would_use', 'note'],
      taskRows,
    ),
    'utf8');
  fs.writeFileSync(
    path.join(SAMPLE_DIR, 'decisions.sample.csv'),
    toCsv(['participant_id', 'set_key', 'sku', 'manual_qty', 'note'], decisionRows),
    'utf8');
  console.log(`Đã ghi bộ SAMPLE (${taskRows.length} dòng task, ${decisionRows.length} dòng quyết định) vào`);
  console.log(`  ${path.relative(process.cwd(), SAMPLE_DIR)}/tasks.sample.csv`);
  console.log(`  ${path.relative(process.cwd(), SAMPLE_DIR)}/decisions.sample.csv`);
};

function main() {
  const args = parseArgs();
  const { payload, index } = loadIndex(args.scenario);
  if (args.makeSample) makeSample(index);
  if (args.makeSample && !args.sample) {
    console.log('\n(Bỏ qua phần tổng hợp. Thêm --sample để chạy thử ngay trên bộ vừa sinh.)');
    return;
  }

  const isSample = args.sample;
  const label = isSample ? 'SAMPLE' : 'MÔ PHỎNG';

  const tasks = readCsvObjects(fs.readFileSync(args.tasks, 'utf8'));
  const decisions = readCsvObjects(fs.readFileSync(args.decisions, 'utf8'));

  const participants = [...new Set(tasks.map((t) => t.participant_id).filter(Boolean))];
  const consented = tasks.filter((t) => String(t.consent || '').toLowerCase() === 'yes');
  const n = participants.length;

  console.log('='.repeat(78));
  console.log(`BÁO CÁO BÀI THỬ NGƯỜI DÙNG — nhãn dữ liệu: ${label}`);
  if (isSample) {
    console.log('*** ĐÂY LÀ BỘ SAMPLE ĐỂ THỬ SCRIPT — KHÔNG PHẢI KẾT QUẢ THẬT ***');
    console.log('*** KHÔNG ĐƯỢC TRÍCH SỐ NÀY RA BÁO CÁO/TRÌNH BÀY ***');
  }
  console.log(`Kịch bản        : ${path.basename(args.scenario)} · as-of ${payload.asOf} · tenant ${payload.tenant.slug}`);
  console.log(`Người thử        : ${n} (đã đồng ý: ${new Set(consented.map((t) => t.participant_id)).size})`);
  console.log(`Điều kiện        : ${[...new Set(tasks.map((t) => t.condition))].sort().join(' vs ')}`);
  console.log('='.repeat(78));

  if (n < MIN_N_FOR_MORE) {
    console.log(
      `\n[CẢNH BÁO] n = ${n} < ${MIN_N_FOR_MORE}.\n` +
      '  CHỈ được báo: trung vị + khoảng min–max.\n' +
      '  KHÔNG: phần trăm, trung bình, p-value, "có ý nghĩa thống kê", "cải thiện X%".\n' +
      '  Script này cố tình không có đường tính kiểm định thống kê.\n');
  }

  // ── 1. Thời gian làm bài (S9 counterbalance) ────────────────────────────────
  console.log('\n[1] THỜI GIAN LÀM BÀI (giây) — trung vị + khoảng min–max');
  const byCondition = {};
  for (const t of tasks) {
    const key = t.condition;
    (byCondition[key] = byCondition[key] || []).push(num(t.seconds));
  }
  const condStats = {};
  for (const [cond, xs] of Object.entries(byCondition)) {
    const s = medianSpread(cond, xs, 's');
    condStats[cond] = s;
    console.log(report(`${cond} (n=${s.n})`, xs, ' s'));
  }
  const conds = Object.keys(condStats).sort();
  if (conds.length === 2) {
    // Chênh lệch theo CÙNG một người (có counterbalance nên mỗi người làm cả hai)
    const deltas = [];
    for (const pid of participants) {
      const vals = conds.map((c) => {
        const row = tasks.find((t) => t.participant_id === pid && t.condition === c);
        return row ? num(row.seconds) : null;
      });
      if (vals.every((v) => v !== null)) deltas.push(Math.abs(vals[1] - vals[0]));
    }
    console.log(report('|chênh lệch| trong 1 người', deltas, ' s'));
  }

  // ── 2. Tự tin + ý định dùng (không suy ra gì thêm) ─────────────────────────
  console.log('\n[2] TỰ TIN (1–5, tự khai)');
  for (const t of tasks) {
    const c = num(t.confidence_after);
    if (c === null) continue;
    (byCondition[`__conf_${t.condition}`] = byCondition[`__conf_${t.condition}`] || []).push(c);
  }
  for (const cond of conds) {
    const xs = byCondition[`__conf_${cond}`] || [];
    console.log(report(`${cond} (n=${xs.length})`, xs));
  }
  const wouldUse = tasks.filter((t) => String(t.would_use || '').toLowerCase() === 'yes').length;
  const wouldUseCond = {};
  for (const t of tasks) {
    if (String(t.would_use || '').toLowerCase() !== 'yes') continue;
    wouldUseCond[t.condition] = (wouldUseCond[t.condition] || 0) + 1;
  }
  console.log(`  ${pad('nói "sẽ dùng hằng ngày"', 30)} ${Object.entries(wouldUseCond)
    .map(([c, v]) => `${c}: ${v}/${(byCondition[c] || []).length}`)
    .join('  ·  ')}`);

  // ── 3. Chấm quyết định tay (P4) bằng bộ mô phỏng của backtest ──────────────
  console.log('\n[3] CHẤM QUYẾT ĐỊNH TAY (P4) — mô phỏng scripts/backtest/lib/simulate.js');
  console.log(`    Chân trời: ${payload.grading.days} ngày nhu cầu gần nhất của chính SKU (kịch bản cố định, CÓ NHÌN TRƯỚC).`);
  const perPerson = [];
  for (const pid of participants) {
    for (const cond of conds) {
      const trow = tasks.find((t) => t.participant_id === pid && t.condition === cond);
      if (!trow) continue;
      const setKey = String(trow.set_key || '').toUpperCase();
      const setIdx = index[setKey];
      if (!setIdx || !setIdx.length) continue;
      const rows = decisions.filter(
        (d) => d.participant_id === pid && String(d.set_key || '').toUpperCase() === setKey);
      const g = gradeSheet(rows, setIdx);
      if (!g.nSkus) continue;
      perPerson.push({ pid, cond, setKey, ...g });
    }
  }
  for (const cond of conds) {
    const list = perPerson.filter((x) => x.cond === cond);
    if (!list.length) continue;
    console.log(`\n  -- Điều kiện ${cond} (${list.length} phiếu, mỗi phiếu ${list[0].nSkus} SKU) --`);
    console.log(report('đơn vị mất bán — TAY', list.map((x) => x.lostManual), ' dv'));
    console.log(report('đơn vị mất bán — HỆ THỐNG', list.map((x) => x.lostRef), ' dv'));
    console.log(report('đơn vị mất bán — KHÔNG ĐẶT', list.map((x) => x.lostNone), ' dv'));
    console.log(report('giá trị tồn TB — TAY', list.map((x) => x.valueManual)));
    console.log(report('giá trị tồn TB — HỆ THỐNG', list.map((x) => x.valueRef)));
    console.log(report('giá trị tồn TB — KHÔNG ĐẶT', list.map((x) => x.valueNone)));
    console.log(report('|số lượng − số hệ thống|', list.flatMap((x) => x.absDev), ' dv'));
    console.log(report('tỉ lệ TAY / HỆ THỐNG', list.flatMap((x) => x.ratio), '×'));
  }

  // ── 4. So trong cùng một người (điều kiện có hệ thống vs không) ─────────────
  if (conds.length === 2) {
    console.log('\n[4] SO TRONG CÙNG MỘT NGƯỜI (mỗi người làm cả hai điều kiện)');
    const withSystem = conds.find((c) => /system|co-he-thong|2/i.test(c));
    const without = conds.find((c) => c !== withSystem);
    if (withSystem && without) {
      const devA = [];
      const devB = [];
      for (const pid of participants) {
        const a = perPerson.find((x) => x.pid === pid && x.cond === without);
        const b = perPerson.find((x) => x.pid === pid && x.cond === withSystem);
        if (!a || !b) continue;
        devA.push(median(a.absDev));
        devB.push(median(b.absDev));
      }
      console.log(report(`${without}: |sai lệch| mỗi phiếu`, devA, ' dv'));
      console.log(report(`${withSystem}: |sai lệch| mỗi phiếu`, devB, ' dv'));
      const closer = devB.filter((v, i) => devA[i] !== null && v < devA[i]).length;
      console.log(`  ${pad('số phiếu lệch ÍT hơn khi có hệ thống', 30)} ${closer}/${devB.length}`);
    }
  }

  console.log('\n[5] GIỚI HẠN PHẢI NÓI KHI DÙNG SỐ NÀY');
  console.log('  - Mô phỏng trên dữ liệu công khai (UCI Online Retail II, CC BY 4.0), KHÔNG phải doanh nghiệp thật.');
  console.log('  - Chân trời chấm điểm có nhìn trước ⇒ chỉ so tương đối tay-vs-hệ thống trên cùng kịch bản.');
  console.log('  - Hệ thống được rà soát 14 lần, quyết định tay chỉ một lần ⇒ đây là so "quy trình" với "một quyết định".');
  console.log(`  - n = ${n}: ${n < MIN_N_FOR_MORE
    ? 'dưới 5 người thử — chỉ nói trung vị + khoảng, KHÔNG nói "có ý nghĩa thống kê".'
    : 'vẫn là mẫu rất nhỏ, không suy ra thị trường.'}`);
  console.log('='.repeat(78));
}

main();
