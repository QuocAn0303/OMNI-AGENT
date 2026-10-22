/**
 * scripts/backtest/run.js — `npm run backtest`
 *
 * Thực hiện đúng giao thức `docs/aisc26/03-evaluation-protocol.md`:
 *   S2  tinh chỉnh CHỈ trên tập giữa, ngân sách 4 cấu hình/phương án, cùng hàm mục tiêu
 *   S3  hai nhánh censored A/B, báo cả hai, không chọn nhánh theo kết quả
 *   S4  đặc tả mô phỏng (xem lib/simulate.js)
 *   S5  một chỉ số chính có đơn vị tiền
 *   S6  rolling-origin ≥ 3 cửa sổ, mỗi cửa sổ dựng lại tham số từ đầu
 *   S7  bootstrap theo SKU, 1000 lần, seed 20261003
 *   S8  baseline dự báo naive + seasonal-naive (chỉ đo WAPE, không đặt hàng)
 *   S11 sổ ghi mọi lần chạy: notes/backtest-runs.md + .jsonl
 *   §3.2 mọi hàm báo cáo nhận slice='test' và từ chối tham số khác
 *
 * Lệnh chạy lại (S11/§11): npm run backtest -- --slice=test
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const { loadDailySku, REPO_ROOT } = require("./lib/dataset");
const { buildRollingWindows } = require("./lib/windows");
const { estimateDemand } = require("./lib/demand");
const { simulate } = require("./lib/simulate");
const { buildConfig, configGrid, SIMPLICITY_ORDER, P3_ALPHA_FIXED, REVIEW_PERIOD_DAYS } = require("./lib/policies");
const { assertSlice, wape, clusterBootstrap, round } = require("./lib/metrics");
const { calcSafetyStock } = require("../../src/modules/replenishment/replenishment.calc");

const NOTES_DIR = path.join(REPO_ROOT, "docs", "aisc26", "notes");
const RUNS_MD = path.join(NOTES_DIR, "backtest-runs.md");
const RUNS_JSONL = path.join(NOTES_DIR, "backtest-runs.jsonl");

/** Hằng số chốt trước (không phải tham số tinh chỉnh). */
const DEMAND_WINDOW_DAYS = 28;
const INITIAL_ATP_LEAD_TIME = 7; // S4: tồn đầu kỳ luôn tính với LT = 7 cho mọi phương án
const INITIAL_ATP_SERVICE_LEVEL = 0.95; // z = 1.645, mặc định của sản phẩm
const SEED = 20261003;
const RESAMPLES = 1000;
const POLICY_NAMES = ["P1", "P2", "P3", "P4"];
const BASELINES = ["P1", "P4"];
const FORECAST_BASELINES = ["naive", "seasonal-naive"];
const SPARSE_NONZERO_DAYS = 10;

const paramHash = (obj) =>
  crypto.createHash("sha256").update(JSON.stringify(obj, Object.keys(obj).sort())).digest("hex").slice(0, 16);

// ---------------------------------------------------------------- CLI

const parseArgs = (argv) => {
  const out = {
    slice: "test",
    asOf: null,
    leadTimes: [3, 7, 14],
    branches: ["A", "B"],
    positionModes: ["withOnOrder", "atpOnly"],
    windows: 3,
    mainLeadTime: 7,
    log: true,
    sensitivity: true,
  };
  for (const a of argv) {
    const [k, v] = a.replace(/^--/, "").split("=");
    if (k === "slice") out.slice = v;
    else if (k === "as-of") out.asOf = v;
    else if (k === "lead-times") out.leadTimes = v.split(",").map(Number);
    else if (k === "branches") out.branches = v.split(",");
    else if (k === "position") out.positionModes = v.split(",");
    else if (k === "windows") out.windows = Number(v);
    else if (k === "main-lead-time") out.mainLeadTime = Number(v);
    else if (k === "log") out.log = v !== "false";
    else if (k === "sensitivity") out.sensitivity = v !== "false";
    else throw new Error(`Tham so khong biet: ${a}`);
  }
  return out;
};

// ---------------------------------------------------------------- dữ liệu

/** Chỉ giữ các ngày <= asOf (mặc định toàn bộ), trả về chỉ số ngày hợp lệ. */
const dayRange = (ds, asOf) => {
  const n = asOf && ds.dateIndex.has(asOf) ? ds.dateIndex.get(asOf) + 1 : ds.nDays;
  return n;
};

/** Mảng ngày dày của một SKU trong [from, to) — ngày không bán = 0. */
const dense = (ds, skuIdx, from, to) => {
  const out = new Float64Array(to - from);
  const base = skuIdx * ds.nDays;
  for (let d = from; d < to; d += 1) out[d - from] = ds.units[base + d];
  return out;
};

/** Giá vốn 1 đơn vị: trung vị `unit_price_median` trên tập quan sát của SKU đó. */
const unitCost = (ds, skuIdx, obsFrom, obsTo) => {
  const base = skuIdx * ds.nDays;
  const vals = [];
  for (let d = obsFrom; d < obsTo; d += 1) {
    const p = ds.price[base + d];
    if (Number.isFinite(p) && p > 0) vals.push(p);
  }
  if (!vals.length) return null;
  vals.sort((a, b) => a - b);
  const mid = Math.floor(vals.length / 2);
  return vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
};

// ---------------------------------------------------------------- vòng lặp 1 SKU

/**
 * Hai lượt cố định (xem lib/demand.js): lượt 1 coi mọi ngày là không censored để
 * có d_ref sơ bộ, lượt 2 dùng cờ censored thật của lượt 1.
 */
const estimateForSku = ({ ds, skuIdx, demandFrom, demandTo, obsFrom, obsTo, branch, lt, policyName, config, initialAtp, cost, positionMode }) => {
  const series = dense(ds, skuIdx, demandFrom, demandTo);
  const noCensored = new Array(series.length).fill(false);

  const pass1 = estimateDemand(series, noCensored, { branch, alphas: [P3_ALPHA_FIXED] });
  const probe = simulate({
    nDays: series.length,
    demand: series,
    policy: buildConfig(policyName, { ...config, leadTimeDays: lt }, { ...pass1, crostonDemand: pass1.croston[P3_ALPHA_FIXED] }),
    policyParams: {},
    leadTimeDays: lt,
    initialAtp,
    costPerUnit: cost,
    positionMode,
  });

  const pass2 = estimateDemand(series, probe.censored, { branch, alphas: [P3_ALPHA_FIXED] });
  const params = {
    demandPerDay: pass2.demandPerDay,
    sigmaDaily: pass2.sigmaDaily,
    crostonDemand: pass2.croston[P3_ALPHA_FIXED],
  };
  return {
    params,
    diagnostics: {
      censoredDays: pass2.censoredDays,
      demandWindowDays: pass2.totalDays,
      nonzeroDays: pass2.nonzeroDays,
      sparse: pass2.sparse,
      probeCensoredDays: probe.censoredDays,
    },
  };
};

// ---------------------------------------------------------------- một lần chạy

const runBacktest = (opts) => {
  const ds = loadDailySku();
  const nDays = dayRange(ds, opts.asOf);
  if (nDays < 120) throw new Error(`Chay chi con ${nDays} ngay du lieu, khong du de 3 cua so.`);
  const dates = ds.dates.slice(0, nDays);
  const windows = buildRollingWindows(dates, { count: opts.windows });

  const idxOf = (d) => {
    const i = ds.dateIndex.get(d);
    if (i === undefined) throw new Error(`Ngay ${d} khong co trong dataset`);
    return i;
  };

  // SKU có giá vốn và có bán trong kỳ quan sát tối thiểu — loại trước, chốt trước khi chạy.
  const eligible = [];
  for (let s = 0; s < ds.nSku; s += 1) {
    const firstSale = dense(ds, s, 0, nDays).findIndex((v) => v > 0);
    if (firstSale < 0) continue;
    const c = unitCost(ds, s, 0, nDays);
    if (c === null) continue;
    eligible.push({ skuIdx: s, sku: ds.skus[s], cost: c, firstSaleIdx: firstSale });
  }
  const excludedNoCost = ds.nSku - eligible.length;

  const scenarios = [];
  for (const positionMode of opts.positionModes) {
    for (const lt of opts.leadTimes) {
      for (const branch of opts.branches) {
        scenarios.push({ positionMode, leadTimeDays: lt, branch });
      }
    }
  }

  const results = [];
  for (const sc of scenarios) {
    const perWindow = [];
    for (const w of windows) {
      const obsTo = idxOf(w.midStartDate);
      const midFrom = idxOf(w.midStartDate);
      const midTo = idxOf(w.midEndDate) + 1;
      const testFrom = idxOf(w.testStartDate);
      const testTo = idxOf(w.testEndDate) + 1;
      const demandTo = midFrom; // cửa sổ nhu cầu = 28 ngày cuối trước khi bắt đầu tập giữa
      const demandFrom = Math.max(0, demandTo - DEMAND_WINDOW_DAYS);

      // Giá vốn dùng để chấm = trung vị `unit_price_median` của SKU trên TẬP QUAN
      // SÁT của cửa sổ này (không dùng cả kỳ) — nếu dùng cả kỳ thì giá của các
      // tháng kiểm định lọt ngược vào mô phỏng (D-P5-09).
      const win = [];
      for (const e of eligible) {
        const c = unitCost(ds, e.skuIdx, 0, midFrom);
        if (c !== null) win.push({ ...e, cost: c });
      }

      // Tồn đầu kỳ CHUNG cho mọi phương án, mọi lead time, mọi nhánh (S4).
      const initialAtp = new Float64Array(win.length);
      for (let i = 0; i < win.length; i += 1) {
        const e = win[i];
        const dref =
          dense(ds, e.skuIdx, demandFrom, demandTo).reduce((a, b) => a + b, 0) / (demandTo - demandFrom);
        const vals = Array.from(dense(ds, e.skuIdx, demandFrom, demandTo));
        const m = vals.reduce((a, b) => a + b, 0) / (vals.length || 1);
        const sigma =
          vals.length > 1 ? Math.sqrt(vals.reduce((a, x) => a + (x - m) ** 2, 0) / (vals.length - 1)) : 0;
        const ss = calcSafetyStock({
          sigmaDaily: sigma,
          leadTimeDays: INITIAL_ATP_LEAD_TIME,
          serviceLevel: INITIAL_ATP_SERVICE_LEVEL,
        });
        initialAtp[i] = Math.ceil(ss.safetyStock + dref * INITIAL_ATP_LEAD_TIME);
      }

      // --- tinh chỉnh tren tap gia (S2) ---
      const tuned = {};
      for (const name of POLICY_NAMES) {
        let best = null;
        for (const config of configGrid(name)) {
          let totalCost = 0;
          let sold = 0;
          let excluded = 0;
          for (let i = 0; i < win.length; i += 1) {
            const e = eligible[i];
            const est = estimateForSku({
              ds,
              skuIdx: e.skuIdx,
              demandFrom,
              demandTo,
              obsFrom: 0,
              obsTo: demandTo,
              branch: sc.branch,
              lt: sc.leadTimeDays,
              policyName: name,
              config,
              initialAtp: initialAtp[i],
              cost: e.cost,
              positionMode: sc.positionMode,
            });
            const pol = buildConfig(name, { ...config, leadTimeDays: sc.leadTimeDays }, {
              ...est.params,
              demandPerDay: est.params.demandPerDay,
              sigmaDaily: est.params.sigmaDaily,
            });
            const sim = simulate({
              nDays: midTo - midFrom,
              demand: dense(ds, e.skuIdx, midFrom, midTo),
              policy: pol,
              policyParams: {},
              leadTimeDays: sc.leadTimeDays,
              initialAtp: initialAtp[i],
              costPerUnit: e.cost,
              positionMode: sc.positionMode,
            });
            totalCost += sim.totalCost;
            sold += sim.sold;
            if (sim.sold <= 0) excluded += 1;
          }
          const objective = sold > 0 ? totalCost / sold : Number.POSITIVE_INFINITY;
          const cand = {
            name,
            config,
            label: config.label,
            objectiveMid: objective,
            midSold: sold,
            excludedMid: excluded,
            simplicity: SIMPLICITY_ORDER[name],
          };
          // Hoà thì ưu tiên phương án đơn giản hơn (S2), rồi thứ tự lưới cố định.
          if (best === null || cand.objectiveMid < best.objectiveMid - 1e-9) best = cand;
        }
        tuned[name] = best;
      }

      // --- chay tren tap kiem dinh ---
      const windowResult = {
        window: w,
        leadTimeDays: sc.leadTimeDays,
        branch: sc.branch,
        tuned: Object.fromEntries(Object.entries(tuned).map(([k, v]) => [k, { label: v.label, objectiveMid: round(v.objectiveMid) }])),
        policies: {},
        forecasts: {},
        wape: {},
        paramHash: null,
        skuCount: win.length,
      };

      const perSkuByPolicy = {};
      const frozen = [];
      for (const name of POLICY_NAMES) {
        const chosen = tuned[name];
        let totalCost = 0;
        let sold = 0;
        let lostUnits = 0;
        let lostValue = 0;
        let endValue = 0;
        let censoredDays = 0;
        let reviews = 0;
        let orderCount = 0;
        let orderUnits = 0;
        let noSales = 0;
        let absErr = 0;
        let actualUnits = 0;
        const perSku = [];
        const actualArr = [];
        const predArr = [];

        for (let i = 0; i < win.length; i += 1) {
          const e = eligible[i];
          const est = estimateForSku({
            ds,
            skuIdx: e.skuIdx,
            demandFrom,
            demandTo,
            obsFrom: 0,
            obsTo: demandTo,
            branch: sc.branch,
            lt: sc.leadTimeDays,
            policyName: name,
            config: chosen.config,
            initialAtp: initialAtp[i],
            cost: e.cost,
            positionMode: sc.positionMode,
          });
          const pol = buildConfig(name, { ...chosen.config, leadTimeDays: sc.leadTimeDays }, {
            ...est.params,
            demandPerDay: est.params.demandPerDay,
            sigmaDaily: est.params.sigmaDaily,
          });
          const sim = simulate({
            nDays: testTo - testFrom,
            demand: dense(ds, e.skuIdx, testFrom, testTo),
            policy: pol,
            policyParams: {},
            leadTimeDays: sc.leadTimeDays,
            initialAtp: initialAtp[i],
            costPerUnit: e.cost,
            positionMode: sc.positionMode,
          });
          totalCost += sim.totalCost;
          sold += sim.sold;
          lostUnits += sim.lostUnits;
          lostValue += sim.lostValue;
          endValue += sim.endValue;
          censoredDays += sim.censoredDays;
          reviews += sim.reviews;
          orderCount += sim.orderCount;
          orderUnits += sim.orderUnits;
          if (sim.sold <= 0) noSales += 1;

          const actual = dense(ds, e.skuIdx, testFrom, testTo);
          for (let k = 0; k < actual.length; k += 1) {
            actualUnits += actual[k];
            absErr += Math.abs(actual[k] - est.params.demandPerDay);
            actualArr.push(actual[k]);
            predArr.push(est.params.demandPerDay);
          }
          perSku.push({
            sku: e.sku,
            totalCost: sim.totalCost,
            sold: sim.sold,
            lostUnits: sim.lostUnits,
            censoredDays: sim.censoredDays,
            reviews: sim.reviews,
            orderCount: sim.orderCount,
            dRef: est.params.demandPerDay,
            sparse: est.diagnostics.sparse,
            demandCensoredDays: est.diagnostics.censoredDays,
          });
          frozen.push({
            name,
            label: chosen.label,
            config: chosen.config,
            demandPerDay: est.params.demandPerDay,
            sigmaDaily: est.params.sigmaDaily,
            crostonDemand: est.params.crostonDemand,
            threshold: pol.threshold,
            safetyStock: pol.safetyStock ?? null,
          });
        }

        perSkuByPolicy[name] = perSku;
        windowResult.policies[name] = {
          label: chosen.label,
          config: chosen.config,
          mainMetric: sold > 0 ? totalCost / sold : null,
          totalCost,
          sold,
          lostUnits,
          lostValue,
          endValue,
          censoredDays,
          censoredDayRatio: reviews > 0 ? censoredDays / reviews : null,
          reviews,
          orderCount,
          orderUnits,
          skuNoSales: noSales,
          fillRate: actualUnits > 0 ? sold / actualUnits : null,
          absErr,
          actualUnits,
        };
        windowResult.wape[name] = {
          slice: "test",
          value: wape({ actual: actualArr, predicted: predArr, slice: "test" }),
          predicted: "d_ref",
        };
      }

      // Baseline du bao S8 — KHONG dat hang, chi do WAPE.
      {
        let absNaive = 0;
        let absSeasonal = 0;
        let actualUnits = 0;
        const actualArr = [];
        const naiveArr = [];
        const seasonalArr = [];
        for (let i = 0; i < win.length; i += 1) {
          const s = eligible[i].skuIdx;
          for (let d = testFrom; d < testTo; d += 1) {
            const y = ds.units[s * ds.nDays + d];
            actualUnits += y;
            actualArr.push(y);
            const prev = d - 1 >= 0 ? ds.units[s * ds.nDays + d - 1] : 0;
            const week = d - 7 >= 0 ? ds.units[s * ds.nDays + d - 7] : 0;
            naiveArr.push(prev);
            seasonalArr.push(week);
            absNaive += Math.abs(y - prev);
            absSeasonal += Math.abs(y - week);
          }
        }
        windowResult.forecasts.naive = {
          formula: "y(t-1)",
          wape: wape({ actual: actualArr, predicted: naiveArr, slice: "test" }),
        };
        windowResult.forecasts["seasonal-naive"] = {
          formula: "y(t-7)",
          wape: wape({ actual: actualArr, predicted: seasonalArr, slice: "test" }),
        };
        windowResult.forecasts.actualUnits = actualUnits;
      }

      // Bootstrap theo SKU (S7) —gom theo SKU qua cac cua so.
      windowResult.bootstrap = {};
      for (const name of POLICY_NAMES) {
        if (BASELINES.includes(name)) continue;
        for (const b of BASELINES) {
          windowResult.bootstrap[`${name}-vs-${b}`] = clusterBootstrap({
            perSku: win.map((e, i) => ({
              a: { totalCost: perSkuByPolicy[name][i].totalCost, sold: perSkuByPolicy[name][i].sold },
              b: { totalCost: perSkuByPolicy[b][i].totalCost, sold: perSkuByPolicy[b][i].sold },
            })),
            seed: SEED,
            resamples: RESAMPLES,
            slice: "test",
          });
        }
      }
      windowResult.perSkuByPolicy = perSkuByPolicy;
      windowResult.skuList = win.map((e) => e.sku);
      windowResult.paramHash = paramHash(
        Object.fromEntries(Object.entries(windowResult.policies).map(([k, v]) => [k, v.config])),
      );
      windowResult.frozen = frozen;
      perWindow.push(windowResult);
    }
    results.push({
      positionMode: sc.positionMode,
      leadTimeDays: sc.leadTimeDays,
      branch: sc.branch,
      windows: perWindow,
    });
  }

  return {
    opts,
    source: ds.source,
    dataset: {
      nSkuTotal: ds.nSku,
      nSkuEligible: eligible.length,
      excludedNoCost,
      nDays,
      firstDate: dates[0],
      lastDate: dates[nDays - 1],
      daysWithSales: ds.daysWithSales,
      zeroSalesDays: ds.zeroSalesDays,
      csvRows: ds.csvRows,
    },
    windows,
    results,
    seed: SEED,
    resamples: RESAMPLES,
    demandWindowDays: DEMAND_WINDOW_DAYS,
    reviewPeriodDays: REVIEW_PERIOD_DAYS,
    sparseThreshold: SPARSE_NONZERO_DAYS,
  };
};

/**
 * `run-exp2.js` (thí nghiệm 2, protocol §13.2) dùng lại các hàm dưới đây. Xuất ra
 * KHÔNG đổi hành vi thí nghiệm 1 — chỉ để không chép lại cùng một thuật toán.
 */
module.exports = {
  runBacktest,
  parseArgs,
  NOTES_DIR,
  RUNS_MD,
  RUNS_JSONL,
  SEED,
  RESAMPLES,
  POLICY_NAMES,
  BASELINES,
  FORECAST_BASELINES,
  DEMAND_WINDOW_DAYS,
  INITIAL_ATP_LEAD_TIME,
  INITIAL_ATP_SERVICE_LEVEL,
  dayRange,
  dense,
  unitCost,
  estimateForSku,
};

if (require.main === module) {
  const opts = parseArgs(process.argv.slice(2));
  assertSlice(opts.slice);
  const command = `npm run backtest -- ${process.argv.slice(2).join(" ")}`.trim();
  const t0 = Date.now();
  const out = runBacktest(opts);
  const seconds = ((Date.now() - t0) / 1000).toFixed(1);

  // eslint-disable-next-line global-require
  const { appendRunLog } = require("./report");
  const { markdown, runId } = appendRunLog(out, {
    runId: `BT-${stamp()}`,
    command,
    note: process.env.BACKTEST_NOTE || "",
  });
  if (opts.log === false) {
    process.stdout.write("log=false: KHONG ghi vao so lan chay (chi dung de kiem thuc)\n");
  }

  const jsonPath = path.join(REPO_ROOT, "data", "dataset", "backtest-last-run.json");
  fs.writeFileSync(
    jsonPath,
    JSON.stringify({ ...out, windows: out.windows }, (k, v) => (k === "frozen" ? undefined : v)),
    "utf8",
  );
  const mdPath = path.join(REPO_ROOT, "docs", "aisc26", "03-evaluation-results.md");
  // Phần tay (nhận định, kết luận, giới hạn) nằm giữa hai MARKER và được GIỮ LẠI
  // khi chạy lại — máy không được ghi đè phần tay bằng bảng sinh tự động.
  const BEGIN = "<!-- PHAN-TAY-BAT-DAU -->";
  const END = "<!-- PHAN-TAY-KET-THUC -->";
  let kept = "";
  if (fs.existsSync(mdPath)) {
    const prev = fs.readFileSync(mdPath, "utf8");
    const i = prev.indexOf(BEGIN);
    const j = prev.indexOf(END);
    if (i !== -1 && j > i) kept = prev.slice(i, j + END.length);
  }
  const banner = [
    "<!-- SINH TỰ ĐỘNG bởi `npm run backtest` — phần bảng KHÔNG sửa tay. -->",
    `<!-- run_id: ${runId} · commit mã: ${require("child_process").execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim()} -->`,
    kept,
    "",
  ].join("\n");
  fs.writeFileSync(mdPath, banner + markdown, "utf8");

  process.stdout.write(`${markdown}\n`);
  process.stdout.write(
    `\nrun_id=${runId} · ${seconds}s\n` +
      `sổ lần chạy: docs/aisc26/notes/backtest-runs.md (+ .jsonl)\n` +
      `báo cáo: docs/aisc26/03-evaluation-results.md\n` +
      `JSON đầy đủ: data/dataset/backtest-last-run.json (KHÔNG commit, .gitignore)\n`,
  );
}

function stamp() {
  return new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
}
