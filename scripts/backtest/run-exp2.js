/**
 * scripts/backtest/run-exp2.js — THÍ NGHIỆM 2 (post-hoc, khám phá)
 *
 * > **Nhãn bắt buộc: "Thí nghiệm 2 — post-hoc, khám phá".** Đăng ký SAU khi đã thấy
 * > kết quả thí nghiệm 1, xem `03-evaluation-protocol.md` §13.2 (commit `69a7ba2`).
 * > Không được dùng kết quả ở đây để sửa, rút lại hay định nghĩa lại kết quả thí
 * > nghiệm 1. Mọi kết luận phải kèm nhãn post-hoc.
 *
 * Khác thí nghiệm 1 ở **đúng ba chỗ đã đăng ký trước**, không có chỗ nào khác:
 *   1. §13.2.1 — hàm mục tiêu **có ràng buộc dịch vụ**: chọn cấu hình có `z`/`DOC`
 *      nhỏ nhất mà `fillRate(mid) >= MIN_FILL_RATE`. Không khả thi ⇒ chọn `fillRate(mid)`
 *      cao nhất và đánh dấu `constraintInfeasible` (quy tắc dự phòng chốt trước).
 *   2. §13.2.2 — P1 được mở lưới `DOC ∈ {7,14,21,28}` để chịu **cùng** ràng buộc và
 *      **cùng** ngân sách 4 cấu hình (S2). P2/P3/P4 giữ nguyên lưới của thí nghiệm 1.
 *   3. §13.2.3 — chỉ số so sánh là **giá trị tồn trung bình ở cùng mức dịch vụ**:
 *      khớp fill rate theo từng SKU trong dải ±2 điểm phần trăm, bootstrap theo SKU
 *      (S7, seed 20261003, 1000 lần).
 *
 * Mọi điều khoản khác giữ nguyên: S3 (cả hai nhánh censored), S4 (đặc tả mô phỏng),
 * S6 (3 cửa sổ trượt), S7 (bootstrap theo SKU), S11 (sổ lần chạy), §3.2 (`slice=test`),
 * D-P5-04 (cả hai cách đọc ngưỡng), D-P5-05 (Croston alpha tường minh),
 * D-P5-08 (gộp cửa sổ theo tên SKU), D-P5-09 (giá vốn trên tập quan sát riêng).
 *
 * Lệnh (đăng ký ở §13.2.6):
 *   kiểm thức đường ống (KHÔNG ghi sổ): node scripts/backtest/run-exp2.js --log=false --lead-times=7 --branches=A --windows=1
 *   lần chạy giao thức duy nhất:           npm run backtest:exp2
 *
 * KHÔNG chạm DB, KHÔNG chạm backend, KHÔNG ghi đè `03-evaluation-results.md`.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execSync } = require("child_process");

const { loadDailySku, REPO_ROOT } = require("./lib/dataset");
const { buildRollingWindows } = require("./lib/windows");
const { simulate } = require("./lib/simulate");
const { buildConfig, constrainedGrid, pickConstrained, SIMPLICITY_ORDER } = require("./lib/policies");
const { assertSlice, round, matchedServiceBootstrap } = require("./lib/metrics");
const { calcSafetyStock } = require("../../src/modules/replenishment/replenishment.calc");
const {
  NOTES_DIR,
  RUNS_MD,
  RUNS_JSONL,
  SEED,
  RESAMPLES,
  POLICY_NAMES,
  BASELINES,
  DEMAND_WINDOW_DAYS,
  INITIAL_ATP_LEAD_TIME,
  INITIAL_ATP_SERVICE_LEVEL,
  dayRange,
  dense,
  unitCost,
  estimateForSku,
} = require("./run");

/** Hằng số của THÍ NGHIỆM 2 — chốt trước ở protocol §13.2.1 và §13.2.3. */
const MIN_FILL_RATE = 0.95;
const MATCH_BAND = 0.02;
const MAIN_POSITION = "withOnOrder";

const parseArgs = (argv) => {
  const out = {
    slice: "test",
    asOf: null,
    leadTimes: [3, 7, 14],
    branches: ["A", "B"],
    positionModes: [MAIN_POSITION, "atpOnly"],
    windows: 3,
    mainLeadTime: 7,
    log: true,
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
    else throw new Error(`Tham so khong biet: ${a}`);
  }
  return out;
};

const paramHash = (obj) =>
  crypto.createHash("sha256").update(JSON.stringify(obj, Object.keys(obj).sort())).digest("hex").slice(0, 16);

const fillRateOf = (sold, lost) => (sold + lost > 0 ? sold / (sold + lost) : null);

// ------------------------------------------------------------------ thí nghiệm

const runExp2 = (opts) => {
  assertSlice(opts.slice);
  const ds = loadDailySku();
  const nDays = dayRange(ds, opts.asOf);
  const dates = ds.dates.slice(0, nDays);
  const windows = buildRollingWindows(dates, { count: opts.windows });
  const idxOf = (d) => {
    const i = ds.dateIndex.get(d);
    if (i === undefined) throw new Error(`Ngay ${d} khong co trong dataset`);
    return i;
  };

  const eligible = [];
  for (let s = 0; s < ds.nSku; s += 1) {
    if (dense(ds, s, 0, nDays).findIndex((v) => v > 0) < 0) continue;
    if (unitCost(ds, s, 0, nDays) === null) continue;
    eligible.push({ skuIdx: s, sku: ds.skus[s] });
  }

  const scenarios = [];
  for (const positionMode of opts.positionModes) {
    for (const lt of opts.leadTimes) {
      for (const branch of opts.branches) scenarios.push({ positionMode, leadTimeDays: lt, branch });
    }
  }

  const scenariosOut = [];
  for (const sc of scenarios) {
    const perWindow = [];
    for (const w of windows) {
      const midFrom = idxOf(w.midStartDate);
      const midTo = idxOf(w.midEndDate) + 1;
      const testFrom = idxOf(w.testStartDate);
      const testTo = idxOf(w.testEndDate) + 1;
      const demandTo = midFrom;
      const demandFrom = Math.max(0, demandTo - DEMAND_WINDOW_DAYS);

      // Giá vốn chấm = trung vị giá niêm yết trên TẬP QUAN SÁT riêng của cửa sổ
      // (D-P5-09) — không dùng cả kỳ để giá tháng kiểm định lọt ngược vào mô phỏng.
      const win = [];
      for (const e of eligible) {
        const c = unitCost(ds, e.skuIdx, 0, midFrom);
        if (c !== null) win.push({ ...e, cost: c });
      }

      // Tồn đầu kỳ CHUNG cho mọi phương án, lead time và nhánh (S4).
      const initialAtp = new Float64Array(win.length);
      for (let i = 0; i < win.length; i += 1) {
        const vals = Array.from(dense(ds, win[i].skuIdx, demandFrom, demandTo));
        const dref = vals.reduce((a, b) => a + b, 0) / (demandTo - demandFrom);
        const sigma =
          vals.length > 1
            ? Math.sqrt(vals.reduce((a, x) => a + (x - dref) ** 2, 0) / (vals.length - 1))
            : 0;
        const ss = calcSafetyStock({
          sigmaDaily: sigma,
          leadTimeDays: INITIAL_ATP_LEAD_TIME,
          serviceLevel: INITIAL_ATP_SERVICE_LEVEL,
        });
        initialAtp[i] = Math.ceil(ss.safetyStock + dref * INITIAL_ATP_LEAD_TIME);
      }

      const runOne = ({ policyName, config, from, to, nDaysSim }) => {
        let totalCost = 0;
        let sold = 0;
        let lostUnits = 0;
        let lostValue = 0;
        let endValue = 0;
        let avgValueSum = 0;
        let reviews = 0;
        let orderCount = 0;
        let censoredDays = 0;
        const perSku = [];
        for (let i = 0; i < win.length; i += 1) {
          const e = win[i];
          const est = estimateForSku({
            ds,
            skuIdx: e.skuIdx,
            demandFrom,
            demandTo,
            obsFrom: 0,
            obsTo: demandTo,
            branch: sc.branch,
            lt: sc.leadTimeDays,
            policyName,
            config,
            initialAtp: initialAtp[i],
            cost: e.cost,
            positionMode: sc.positionMode,
          });
          const pol = buildConfig(policyName, { ...config, leadTimeDays: sc.leadTimeDays }, est.params);
          const sim = simulate({
            nDays: nDaysSim,
            demand: dense(ds, e.skuIdx, from, to),
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
          avgValueSum += sim.avgValue;
          reviews += sim.reviews;
          orderCount += sim.orderCount;
          censoredDays += sim.censoredDays;
          perSku.push({
            sku: e.sku,
            sold: sim.sold,
            lostUnits: sim.lostUnits,
            actualUnits: sim.sold + sim.lostUnits,
            avgValue: sim.avgValue,
            totalCost: sim.totalCost,
            fillRate: fillRateOf(sim.sold, sim.lostUnits),
          });
        }
        return {
          totalCost,
          sold,
          lostUnits,
          lostValue,
          endValue,
          avgValueSum,
          reviews,
          orderCount,
          censoredDays,
          perSku,
        };
      };

      // --- tinh chỉnh TRÊN TẬP GIỮA với ràng buộc dịch vụ (§13.2.1) ---
      const tuned = {};
      for (const policyName of POLICY_NAMES) {
        const candidates = constrainedGrid(policyName).map((config) => {
          const r = runOne({
            policyName,
            config,
            from: midFrom,
            to: midTo,
            nDaysSim: midTo - midFrom,
          });
          return {
            name: policyName,
            config,
            label: config.label,
            objectiveMid: r.sold > 0 ? r.totalCost / r.sold : Number.POSITIVE_INFINITY,
            fillRateMid: fillRateOf(r.sold, r.lostUnits),
            simplicity: SIMPLICITY_ORDER[policyName],
          };
        });
        const { best, infeasible } = pickConstrained(candidates, MIN_FILL_RATE);
        best.constraintInfeasible = infeasible;
        best.candidates = candidates;
        tuned[policyName] = best;
      }

      // --- tập kiểm định: chạy MỌI cấu hình để có frontier (§13.2.3) ---
      const policies = {};
      const frontier = {};
      const perSkuByPolicy = {};
      for (const policyName of POLICY_NAMES) {
        const chosen = tuned[policyName];
        const rows = [];
        const chosenRows = [];
        for (const config of constrainedGrid(policyName)) {
          const r = runOne({
            policyName,
            config,
            from: testFrom,
            to: testTo,
            nDaysSim: testTo - testFrom,
          });
          rows.push({
            label: config.label,
            isChosen: config.label === chosen.label,
            mainMetric: r.sold > 0 ? r.totalCost / r.sold : null,
            fillRate: fillRateOf(r.sold, r.lostUnits),
            avgInventoryValue: r.avgValueSum / win.length,
            lostUnits: r.lostUnits,
            lostValue: r.lostValue,
            endValue: r.endValue,
            orderPer100Reviews: (r.orderCount / Math.max(1, r.reviews)) * 100,
          });
          if (config.label === chosen.label) chosenRows.push(r);
        }
        const r = chosenRows[0];
        frontier[policyName] = rows;
        perSkuByPolicy[policyName] = r.perSku;
        policies[policyName] = {
          label: chosen.label,
          config: chosen.config,
          constraintInfeasible: chosen.constraintInfeasible,
          fillRateMid: chosen.fillRateMid,
          objectiveMid: chosen.objectiveMid,
          mainMetric: r.sold > 0 ? r.totalCost / r.sold : null,
          fillRate: fillRateOf(r.sold, r.lostUnits),
          avgInventoryValue: r.avgValueSum / win.length,
          totalCost: r.totalCost,
          sold: r.sold,
          lostUnits: r.lostUnits,
          lostValue: r.lostValue,
          endValue: r.endValue,
          orderCount: r.orderCount,
          reviews: r.reviews,
          censoredDays: r.censoredDays,
        };
      }

      perWindow.push({
        window: w,
        leadTimeDays: sc.leadTimeDays,
        branch: sc.branch,
        positionMode: sc.positionMode,
        skuCount: win.length,
        policies,
        frontier,
        perSkuByPolicy,
        skuList: win.map((e) => e.sku),
        paramHash: paramHash(
          Object.fromEntries(POLICY_NAMES.map((n) => [n, policies[n].config])),
        ),
      });
    }
    scenariosOut.push({
      positionMode: sc.positionMode,
      leadTimeDays: sc.leadTimeDays,
      branch: sc.branch,
      windows: perWindow,
    });
  }

  return {
    experiment: 2,
    label: "post-hoc, kham pha",
    opts,
    minFillRate: MIN_FILL_RATE,
    matchBand: MATCH_BAND,
    seed: SEED,
    resamples: RESAMPLES,
    source: ds.source,
    dataset: {
      nSkuTotal: ds.nSku,
      nSkuEligible: eligible.length,
      nDays,
      firstDate: dates[0],
      lastDate: dates[nDays - 1],
      zeroSalesDays: ds.zeroSalesDays,
    },
    windows,
    scenarios: scenariosOut,
  };
};

// ------------------------------------------------------------------ gộp cửa sổ (S6, D-P5-08)

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const pct = (v) => (v === null || v === undefined ? "—" : `${(v * 100).toFixed(2)}%`);
const num = (v, d = 4) => (v === null || v === undefined ? "—" : Number(v).toFixed(d));

const pickScenario = (out, position, leadTime, branch) =>
  out.scenarios.find(
    (s) => s.positionMode === position && s.leadTimeDays === leadTime && s.branch === branch,
  );

/**
 * Gộp 3 cửa sổ: chỉ số trung bình theo cửa sổ (S6); riêng đối chiếu "cùng mức dịch
 * vụ" thì gộp **theo tên SKU** rồi bootstrap (D-P5-08 + §13.2.3).
 */
const aggScenario = (sc) => {
  const agg = { labels: {}, policies: {}, frontier: {}, matched: {}, skuAligned: 0 };
  for (const name of POLICY_NAMES) {
    const ws = sc.windows.map((w) => w.policies[name]);
    agg.labels[name] = ws.map((x) => x.label);
    agg.policies[name] = {
      constraintInfeasible: ws.some((x) => x.constraintInfeasible),
      constraintInfeasibleWindows: ws.filter((x) => x.constraintInfeasible).length,
      fillRateMid: mean(ws.map((x) => x.fillRateMid)),
      mainMetric: mean(ws.map((x) => x.mainMetric)),
      fillRate: mean(ws.map((x) => x.fillRate)),
      avgInventoryValue: mean(ws.map((x) => x.avgInventoryValue)),
      sold: ws.reduce((a, x) => a + x.sold, 0),
      lostUnits: ws.reduce((a, x) => a + x.lostUnits, 0),
      lostValue: ws.reduce((a, x) => a + x.lostValue, 0),
      endValue: ws.reduce((a, x) => a + x.endValue, 0),
      reviews: ws.reduce((a, x) => a + x.reviews, 0),
      orderCount: ws.reduce((a, x) => a + x.orderCount, 0),
    };
    agg.policies[name].orderPer100Reviews =
      (agg.policies[name].orderCount / Math.max(1, agg.policies[name].reviews)) * 100;
    agg.frontier[name] = sc.windows[0].frontier[name].map((f, i) => {
      const rows = sc.windows.map((w) => w.frontier[name][i]);
      return {
        label: f.label,
        isChosen: rows.every((r) => r.isChosen),
        fillRate: mean(rows.map((r) => r.fillRate)),
        avgInventoryValue: mean(rows.map((r) => r.avgInventoryValue)),
        mainMetric: mean(rows.map((r) => r.mainMetric)),
        lostUnits: rows.reduce((a, r) => a + r.lostUnits, 0),
        orderPer100Reviews: mean(rows.map((r) => r.orderPer100Reviews)),
      };
    });
  }

  const skuList = sc.windows[0].skuList;
  agg.skuAligned = skuList.length;
  for (const name of POLICY_NAMES) {
    if (BASELINES.includes(name)) continue;
    for (const b of BASELINES) {
      const perSku = [];
      for (const sku of skuList) {
        const rowsA = sc.windows.map((w) => w.perSkuByPolicy[name].find((r) => r.sku === sku)).filter(Boolean);
        const rowsB = sc.windows.map((w) => w.perSkuByPolicy[b].find((r) => r.sku === sku)).filter(Boolean);
        if (!rowsA.length || !rowsB.length) continue;
        perSku.push({
          a: {
            avgValue: rowsA.reduce((s, r) => s + r.avgValue, 0) / rowsA.length,
            actualUnits: rowsA.reduce((s, r) => s + r.actualUnits, 0),
            fillRate: rowsA.reduce((s, r) => s + r.sold, 0) / rowsA.reduce((s, r) => s + r.actualUnits, 0),
          },
          b: {
            avgValue: rowsB.reduce((s, r) => s + r.avgValue, 0) / rowsB.length,
            actualUnits: rowsB.reduce((s, r) => s + r.actualUnits, 0),
            fillRate: rowsB.reduce((s, r) => s + r.sold, 0) / rowsB.reduce((s, r) => s + r.actualUnits, 0),
          },
        });
      }
      agg.matched[`${name}-vs-${b}`] = matchedServiceBootstrap({
        perSku,
        band: MATCH_BAND,
        seed: SEED,
        resamples: RESAMPLES,
        slice: "test",
      });
    }
  }
  return agg;
};

// ------------------------------------------------------------------ báo cáo

const buildMarkdown = (out, { runId, codeCommit }) => {
  const mainLt = out.opts.mainLeadTime;
  const aggMain = pickScenario(out, MAIN_POSITION, mainLt, "A")
    ? aggScenario(pickScenario(out, MAIN_POSITION, mainLt, "A"))
    : null;
  const L = [];
  L.push("<!-- SINH TỰ ĐỘNG bởi `npm run backtest:exp2` — phần bảng KHÔNG sửa tay. -->");
  L.push(`<!-- run_id: ${runId} · commit mã: ${codeCommit} -->`);
  L.push("");
  L.push("# THÍ NGHIỆM 2 — post-hoc, khám phá: hàm mục tiêu có ràng buộc dịch vụ");
  L.push("");
  L.push("> **Nhãn bắt buộc: \"Thí nghiệm 2 — post-hoc, khám phá\".** Đăng ký SAU khi đã");
  L.push("> thấy kết quả thí nghiệm 1 (`03-evaluation-protocol.md` §13.2, commit đăng ký");
  L.push("> trước lần chạy). **Không** dùng để sửa hay rút lại kết luận của thí nghiệm 1.");
  L.push("> Mọi chỉ số tồn kho dưới đây vẫn là **MÔ PHỎNG** (dataset không có tồn kho,");
  L.push("> lead time quan sát được, kênh bán, giá vốn thật).");
  L.push("");
  L.push("```");
  L.push(`Nguồn dữ liệu : CÔNG KHAI — ${path.basename(out.source.csvPath)} · sha256 ${out.source.sha256}`);
  L.push(`Khoảng thời gian: ${out.dataset.firstDate} → ${out.dataset.lastDate} (${out.dataset.nDays} ngày)`);
  L.push(`Cỡ mẫu       : ${out.dataset.nSkuEligible} SKU dùng được / ${out.dataset.nSkuTotal} SKU trong tệp`);
  L.push(`Cửa sổ trượt : ${out.windows.length} (test = ${out.windows.map((w) => w.testMonth).join(", ")})`);
  L.push(`Lead time     : ${out.opts.leadTimes.join("/")} · nhánh censored: ${out.opts.branches.join(",")} · positionMode: ${out.opts.positionModes.join(",")}`);
  L.push(`Ràng buộc    : fillRate(tập giữa) >= ${(out.minFillRate * 100).toFixed(0)}% · chọn z/DOC nhỏ nhất đạt ràng buộc`);
  L.push(`Dải khớp DV  : ±${(out.matchBand * 100).toFixed(0)} điểm phần trăm theo từng SKU`);
  L.push(`Bootstrap    : seed ${out.seed} · ${out.resamples} lần · đơn vị resample = SKU (S7)`);
  L.push(`run_id        : ${runId}`);
  L.push(`Commit mã     : ${codeCommit}`);
  L.push(`Commit giao thức: ${process.env.PROTOCOL_COMMIT || "69a7ba2"} (§13.2)`);
  L.push(`Lệnh chạy lại : npm run backtest:exp2`);
  L.push("```");
  L.push("");

  for (const branch of out.opts.branches) {
    const sc = pickScenario(out, MAIN_POSITION, mainLt, branch);
    if (!sc) continue;
    const agg = aggScenario(sc);
    L.push(`## Lead time ${mainLt} ngày · nhánh censored ${branch} · ngưỡng so \`ATP + onOrder\`${branch === "A" ? " — **bảng chính**" : ""}`);
    L.push("");
    L.push(`| Phương án | Cấu hình chọn (tập giữa) | fillRate(tập giữa) | Ràng buộc 95% khả thi? | Fill rate (kiểm định) | **Giá trị tồn TB / SKU** | Chi phí chuẩn hoá / đơn vị | Đơn vị mất bán | PO/100 rà soát |`);
    L.push(`|---|---|---|---|---|---|---|---|---|`);
    for (const name of POLICY_NAMES) {
      const p = agg.policies[name];
      L.push(
        `| ${name} | ${agg.labels[name].join(", ")} | ${pct(p.fillRateMid)} | ${p.constraintInfeasible ? "**KHÔNG**" : "có" } | ${pct(p.fillRate)} | ${num(p.avgInventoryValue)} | ${num(p.mainMetric)} | ${num(p.lostUnits, 0)} | ${num(p.orderPer100Reviews, 1)} |`,
      );
    }
    L.push("");
    L.push(`### Giá trị tồn trung bình ở cùng mức dịch vụ (§13.2.3 — khớp ±2 điểm phần trăm theo SKU)`);
    L.push("");
    L.push(`| So sánh | Chênh lệch TB tồn (a − b) | CI 95% | CI có chứa 0? | SKU tồn thấp hơn/cao hơn/hoà | Tỉ lệ thắng | n khớp | loại | Đủ bằng chứng (>55% + CI loại 0)? |`);
    L.push(`|---|---|---|---|---|---|---|---|---|`);
    for (const name of POLICY_NAMES) {
      if (BASELINES.includes(name)) continue;
      for (const b of BASELINES) {
        const r = agg.matched[`${name}-vs-${b}`];
        L.push(
          `| ${name} vs ${b} | ${num(r.point)} | [${num(r.ciLow)}, ${num(r.ciHigh)}] | ${r.excludesZero ? "không" : "**CÓ**"} | ${r.wins}/${r.losses}/${r.ties} | ${pct(r.winRatio)} | ${r.n} | ${r.excluded} | ${r.winRatioMet && r.excludesZero ? "**CÓ**" : "KHÔNG — chưa đủ bằng chứng"} |`,
        );
      }
    }
    L.push("");
  }

  if (aggMain) {
    L.push(`## Frontier — MỌI cấu hình trên tập kiểm định (LT=${mainLt}, nhánh A, ATP + onOrder)`);
    L.push("");
    L.push(`Bảng bắt buộc: tồn trung bình và mức dịch vụ đánh đổi với nhau, không được giấu đường biên.`);
    L.push("");
    L.push(`| Phương án | Cấu hình | Fill rate | **Giá trị tồn TB / SKU** | Chi phí chuẩn hoá | Đơn vị mất bán | PO/100 rà soát | Được chọn? |`);
    L.push(`|---|---|---|---|---|---|---|---|`);
    for (const name of POLICY_NAMES) {
      for (const f of aggMain.frontier[name]) {
        L.push(
          `| ${name} | ${f.label} | ${pct(f.fillRate)} | ${num(f.avgInventoryValue)} | ${num(f.mainMetric)} | ${num(f.lostUnits, 0)} | ${num(f.orderPer100Reviews, 1)} | ${f.isChosen ? "✔" : ""} |`,
        );
      }
    }
    L.push("");
  }

  for (const sc of out.scenarios) {
    if (sc.positionMode !== MAIN_POSITION || sc.branch !== "A" || sc.leadTimeDays === mainLt) continue;
    const agg = aggScenario(sc);
    L.push(`## Lead time ${sc.leadTimeDays} ngày (độ nhạy — S4) · nhánh A · ATP + onOrder`);
    L.push("");
    L.push(`| Phương án | Cấu hình chọn | fillRate(tập giữa) | Ràng buộc khả thi? | Fill rate (kiểm định) | **Giá trị tồn TB / SKU** | Đơn vị mất bán |`);
    L.push(`|---|---|---|---|---|---|---|`);
    for (const name of POLICY_NAMES) {
      const p = agg.policies[name];
      L.push(
        `| ${name} | ${agg.labels[name].join(", ")} | ${pct(p.fillRateMid)} | ${p.constraintInfeasible ? "**KHÔNG**" : "có"} | ${pct(p.fillRate)} | ${num(p.avgInventoryValue)} | ${num(p.lostUnits, 0)} |`,
      );
    }
    L.push("");
  }

  L.push("## Ghi chú bắt buộc");
  L.push("");
  L.push("1. **post-hoc, khám phá.** Mọi bảng trên được đăng ký sau khi đã thấy kết quả");
  L.push("   thí nghiệm 1, nên không được trình bày như một thí nghiệm tiền đăng ký.");
  L.push("2. **Ràng buộc 95% khả thi hay không** — cột \"Ràng buộc 95% khả thi?\". Nếu là");
  L.push("   `KHÔNG` thì mọi so sánh \"ở cùng mức dịch vụ\" ở đây là so ở mức dịch vụ");
  L.push("   **thấp nhất có thể**, KHÔNG phải 95% (protocol §13.2.4 mục 4).");
  L.push("3. Không được nói \"ROP tốt hơn\" trừ khi CI 95% **loại 0** *và* tỉ lệ SKU thắng");
  L.push("   **> 55%** (§13.2.4).");
  L.push("4. Kết quả thí nghiệm 1 **không bị sửa**. So sánh cạnh nhau nằm trong phần tay");
  L.push("   của `03-evaluation-results.md`.");
  L.push("");
  return L.join("\n");
};

// ------------------------------------------------------------------ sổ S11

const gitCommit = () => {
  try {
    return execSync("git rev-parse --short HEAD", {
      cwd: path.resolve(__dirname, "..", ".."),
      encoding: "utf8",
    }).trim();
  } catch {
    return "unknown";
  }
};

const appendRunLog = (out, { runId, command, note }) => {
  fs.mkdirSync(NOTES_DIR, { recursive: true });
  const codeCommit = gitCommit();
  const protocolCommit = process.env.PROTOCOL_COMMIT || "69a7ba2";
  const stamp = new Date().toISOString();
  const main = aggScenario(pickScenario(out, MAIN_POSITION, out.opts.mainLeadTime, "A"));
  const metricPart = POLICY_NAMES.map(
    (n) =>
      `${n}=${num(main.policies[n].mainMetric)}/fill=${num(main.policies[n].fillRate, 4)}/tonTB=${num(main.policies[n].avgInventoryValue, 2)}`,
  ).join(" ");

  if (!fs.existsSync(RUNS_MD)) {
    fs.writeFileSync(
      RUNS_MD,
      `# Sổ ghi mọi lần chạy backtest (S11)\n\n` +
        `**Không xoá dòng nào.**\n` +
        `Cột "commit giao thức" là commit của \`docs/aisc26/03-evaluation-protocol.md\`.\n\n` +
        `| run_id | thời điểm | commit mã | commit giao thức | dataset + sha256 | lệnh | positionMode | seed | slice | chỉ số chính (TB cửa sổ) | ghi chú |\n` +
        `|---|---|---|---|---|---|---|---|---|---|---|\n`,
      "utf8",
    );
  }
  fs.appendFileSync(
    RUNS_MD,
    `| ${runId} | ${stamp} | ${codeCommit} | ${protocolCommit} (§13.2 — THÍ NGHIỆM 2) | ${path.basename(out.source.csvPath)} \`${out.source.sha256.slice(0, 12)}\` | \`${command}\` | ${out.opts.positionModes.join(",")} | ${out.seed} | test | ${metricPart} | ${note} |\n`,
    "utf8",
  );
  fs.appendFileSync(
    RUNS_JSONL,
    `${JSON.stringify({
      run_id: runId,
      experiment: 2,
      label: "post-hoc, kham pha",
      at: stamp,
      code_commit: codeCommit,
      protocol_commit: protocolCommit,
      dataset: { file: path.basename(out.source.csvPath), sha256: out.source.sha256 },
      command,
      min_fill_rate: out.minFillRate,
      match_band: out.matchBand,
      seed: out.seed,
      resamples: out.resamples,
      slice: "test",
      lead_times: out.opts.leadTimes,
      branches: out.opts.branches,
      position_modes: out.opts.positionModes,
      windows: out.windows.map((w) => ({ test: w.testMonth, mid: w.midMonth })),
      main: Object.fromEntries(
        POLICY_NAMES.map((n) => [
          n,
          {
            label: main.labels[n],
            main_metric: round(main.policies[n].mainMetric, 6),
            fill_rate: round(main.policies[n].fillRate, 6),
            avg_inventory_value: round(main.policies[n].avgInventoryValue, 6),
            constraint_infeasible: main.policies[n].constraintInfeasible,
          },
        ]),
      ),
      matched_service: main.matched,
      note,
    })}\n`,
    "utf8",
  );
};

// ------------------------------------------------------------------ CLI

if (require.main === module) {
  const opts = parseArgs(process.argv.slice(2));
  assertSlice(opts.slice);
  const command = `npm run backtest:exp2 -- ${process.argv.slice(2).join(" ")}`.trim();
  const t0 = Date.now();
  const out = runExp2(opts);
  const seconds = ((Date.now() - t0) / 1000).toFixed(1);
  const runId = `BT2-${new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14)}`;
  const note =
    process.env.BACKTEST_NOTE ||
    "thí nghiệm 2 — post-hoc, khám phá; hàm mục tiêu ràng buộc fillRate(mid) >= 95%; không sửa kết quả thí nghiệm 1";
  const codeCommit = gitCommit();
  const markdown = buildMarkdown(out, { runId, codeCommit });

  if (opts.log === false) {
    process.stdout.write("log=false: KHÔNG ghi sổ lần chạy, KHÔNG ghi tài liệu (chỉ dùng kiểm thử)\n");
  } else {
    appendRunLog(out, { runId, command, note });
    fs.writeFileSync(
      path.join(REPO_ROOT, "docs", "aisc26", "03-evaluation-results-exp2.md"),
      markdown,
      "utf8",
    );
  }
  fs.writeFileSync(
    path.join(REPO_ROOT, "data", "dataset", "backtest-last-run-exp2.json"),
    JSON.stringify(out),
    "utf8",
  );
  process.stdout.write(`${markdown}\n`);
  process.stdout.write(`\nrun_id=${runId} · ${seconds}s\n`);
}