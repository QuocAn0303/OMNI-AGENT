/**
 * scripts/backtest/report.js — gộp cửa sổ, dựng bảng, ghi sổ lần chạy (S6, S11).
 *
 * Mọi hàm ở đây đều là hàm BÁO CÁO ⇒ chúng gọi `assertSlice('test')`. Gọi với
 * `slice` khác sẽ ném lỗi (protocol §3.2).
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const { assertSlice, round, clusterBootstrap } = require("./lib/metrics");
const { POLICY_NAMES, BASELINES, FORECAST_BASELINES, RUNS_MD, RUNS_JSONL } = require("./run");

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const pct = (v) => (v === null || v === undefined ? "—" : `${(v * 100).toFixed(2)}%`);
const num = (v, d = 4) => (v === null || v === undefined ? "—" : Number(v).toFixed(d));

/**
 * Gộp theo cửa sổ: chỉ số chính = TRUNG BÌNH qua các cửa sổ (S6 §3.1).
 * WAPE gộp lại theo tổng (Σ|y−ŷ|)/(Σy) vì cùng bộ SKU trên mọi cửa sổ.
 */
const aggregate = (out, slice = "test") => {
  assertSlice(slice);
  return out.results.map((sc) => {
    const agg = {
      positionMode: sc.positionMode,
      leadTimeDays: sc.leadTimeDays,
      branch: sc.branch,
      windowCount: sc.windows.length,
      testMonths: sc.windows.map((w) => w.window.testMonth),
      policies: {},
      forecasts: {},
      bootstrap: {},
      censoredDayRatio: {},
      orderLoad: {},
      fillRate: {},
      sparseSkuRatio: null,
      excludedSkuNoSales: {},
      tunedLabels: {},
    };

    for (const name of POLICY_NAMES) {
      const ws = sc.windows.map((w) => w.policies[name]);
      agg.policies[name] = {
        label: ws[0].label,
        mainMetric: mean(ws.map((x) => x.mainMetric)),
        mainMetricPerWindow: ws.map((x) => round(x.mainMetric)),
        totalCost: ws.reduce((a, x) => a + x.totalCost, 0),
        sold: ws.reduce((a, x) => a + x.sold, 0),
        lostUnits: ws.reduce((a, x) => a + x.lostUnits, 0),
        lostValue: ws.reduce((a, x) => a + x.lostValue, 0),
        endValue: ws.reduce((a, x) => a + x.endValue, 0),
        reviews: ws.reduce((a, x) => a + x.reviews, 0),
        orderCount: ws.reduce((a, x) => a + x.orderCount, 0),
        orderUnits: ws.reduce((a, x) => a + x.orderUnits, 0),
        wape: (() => {
          const ae = ws.reduce((a, x) => a + x.absErr, 0);
          const au = ws.reduce((a, x) => a + x.actualUnits, 0);
          return au > 0 ? ae / au : null;
        })(),
      };
      agg.censoredDayRatio[name] =
        agg.policies[name].reviews > 0
          ? ws.reduce((a, x) => a + x.censoredDays, 0) / agg.policies[name].reviews
          : null;
      agg.orderLoad[name] =
        agg.policies[name].orderCount / Math.max(1, agg.policies[name].reviews);
      agg.fillRate[name] =
        agg.policies[name].sold > 0
          ? agg.policies[name].sold /
            (agg.policies[name].sold + agg.policies[name].lostUnits)
          : null;
      agg.excludedSkuNoSales[name] = ws.reduce((a, x) => a + x.skuNoSales, 0);
      agg.tunedLabels[name] = ws.map((x) => x.label);
    }

    // sparseSkuRatio: SKU co < 10 ngay co ban (nguong ca nhat cua 90 ngay gan nhat)
    const firstWin = sc.windows[0];
    const sparseCount = firstWin.perSkuByPolicy.P1.filter((r) => r.sparse).length;
    agg.sparseSkuRatio = firstWin.perSkuByPolicy.P1.length ? sparseCount / firstWin.perSkuByPolicy.P1.length : null;

    for (const f of FORECAST_BASELINES) {
      agg.forecasts[f] = {
        formula: sc.windows[0].forecasts[f].formula,
        wape: mean(sc.windows.map((w) => w.forecasts[f].wape)),
        wapePerWindow: sc.windows.map((w) => round(w.forecasts[f].wape)),
      };
    }

    // Bootstrap: gom theo SKU qua các cửa sổ (đơn vị resample vẫn là SKU — S7).
    // Căn theo **tên SKU**, không theo chỉ số, vì mỗi cửa sổ có thể loại SKU khác
    // nhau (giá vốn tính trên tập quan sát riêng của cửa sổ — D-P5-09).
    const skuList = sc.windows[0].skuList;
    const byName = {};
    for (const name of POLICY_NAMES) {
      byName[name] = sc.windows.map((w) => {
        const m = new Map(w.perSkuByPolicy[name].map((r) => [r.sku, r]));
        return m;
      });
    }
    agg.skuAligned = skuList.length;
    agg.skuDroppedByWindow = sc.windows.map(
      (w, wi) => w.skuList.length - sc.windows[0].skuList.filter((s) => byName.P1[wi].has(s)).length,
    );
    for (const name of POLICY_NAMES) {
      if (BASELINES.includes(name)) continue;
      for (const b of BASELINES) {
        const perSku = [];
        for (const sku of skuList) {
          const ra = byName[name].map((m) => m.get(sku)).filter(Boolean);
          const rb = byName[b].map((m) => m.get(sku)).filter(Boolean);
          if (!ra.length || !rb.length) continue;
          perSku.push({
            a: {
              totalCost: ra.reduce((s, r) => s + r.totalCost, 0),
              sold: ra.reduce((s, r) => s + r.sold, 0),
            },
            b: {
              totalCost: rb.reduce((s, r) => s + r.totalCost, 0),
              sold: rb.reduce((s, r) => s + r.sold, 0),
            },
          });
        }
        agg.bootstrap[`${name}-vs-${b}`] = clusterBootstrap({
          perSku,
          seed: out.seed,
          resamples: out.resamples,
          slice: "test",
        });
      }
    }
    return agg;
  });
};

const fmtPolicyTable = (aggs, { position, leadTime, branch }) => {
  const rows = aggs.filter((a) => a.positionMode === position && a.leadTimeDays === leadTime && a.branch === branch);
  if (!rows.length) return "";
  const a = rows[0];
  const lines = [];
  lines.push(`| Phương án | Cấu hình chọn (tập giữa) | Chi phí chuẩn hoá / đơn vị (TB 3 cửa sổ) | WAPE | Ngày hết hàng (mô phỏng) | Fill rate | Số PO / 100 lần rà soát |`);
  lines.push(`|---|---|---|---|---|---|---|`);
  for (const name of POLICY_NAMES) {
    const p = a.policies[name];
    lines.push(
      `| ${name} | ${a.tunedLabels[name].join(", ")} | ${num(p.mainMetric)} | ${pct(p.wape)} | ${pct(a.censoredDayRatio[name])} | ${pct(a.fillRate[name])} | ${num(a.orderLoad[name] * 100, 1)} |`,
    );
  }
  return lines.join("\n");
};

const fmtBootstrapTable = (aggs, { position, leadTime, branch }) => {
  const a = aggs.find((x) => x.positionMode === position && x.leadTimeDays === leadTime && x.branch === branch);
  if (!a) return "";
  const lines = [];
  lines.push(`| So sánh | Hiệu số (phương án − baseline) | CI 95% | CI có chứa 0? | SKU thắng/thua/hoà | Tỉ lệ thắng | Đủ bằng chứng (>55%)? |`);
  lines.push(`|---|---|---|---|---|---|---|`);
  for (const name of POLICY_NAMES) {
    if (BASELINES.includes(name)) continue;
    for (const b of BASELINES) {
      const r = a.bootstrap[`${name}-vs-${b}`];
      lines.push(
        `| ${name} vs ${b} | ${num(r.point)} | [${num(r.ciLow)}, ${num(r.ciHigh)}] | ${r.excludesZero ? "không" : "CÓ"} | ${r.wins}/${r.losses}/${r.ties} (n=${r.n}, loại ${r.excluded}) | ${pct(r.winRatio)} | ${r.winRatioMet && r.excludesZero ? "CÓ" : "KHÔNG"} |`,
      );
    }
  }
  return lines.join("\n");
};

const fmtForecastTable = (aggs, { position, leadTime, branch }) => {
  const a = aggs.find((x) => x.positionMode === position && x.leadTimeDays === leadTime && x.branch === branch);
  if (!a) return "";
  const lines = [];
  lines.push(`| Mô hình | Công thức | WAPE (TB 3 cửa sổ) |`);
  lines.push(`|---|---|---|`);
  for (const name of POLICY_NAMES) {
    lines.push(`| ${name} (chính sách tồn kho) | ŷ = d_ref | ${pct(a.policies[name].wape)} |`);
  }
  for (const f of FORECAST_BASELINES) {
    lines.push(`| ${f} (baseline dự báo, **không** đặt hàng) | ${a.forecasts[f].formula} | ${pct(a.forecasts[f].wape)} |`);
  }
  return lines.join("\n");
};

const fmtAbsoluteTable = (aggs, { position, leadTime, branch }) => {
  const a = aggs.find((x) => x.positionMode === position && x.leadTimeDays === leadTime && x.branch === branch);
  if (!a) return "";
  const lines = [];
  lines.push(`| Phương án | Tổng chi phí (tuyệt đối) | Đơn vị đã bán | Đơn vị mất bán | Doanh thu mất bán | Giá trị tồn dư cuối kỳ |`);
  lines.push(`|---|---|---|---|---|---|`);
  for (const name of POLICY_NAMES) {
    const p = a.policies[name];
    lines.push(
      `| ${name} | ${num(p.totalCost, 0)} | ${num(p.sold, 0)} | ${num(p.lostUnits, 0)} | ${num(p.lostValue, 0)} | ${num(p.endValue, 0)} |`,
    );
  }
  return lines.join("\n");
};

const buildMarkdown = (out) => {
  const aggs = aggregate(out, "test");
  const mainLt = out.opts.mainLeadTime;
  const MAIN_POS = "withOnOrder";
  const header = [
    `# Kết quả backtest (sinh tự động — \`npm run backtest\`)`,
    ``,
    `- Nguồn dữ liệu: \`${path.basename(out.source.csvPath)}\` · sha256 \`${out.source.sha256}\``,
    `- Khoảng thời gian: ${out.dataset.firstDate} → ${out.dataset.lastDate} (${out.dataset.nDays} ngày)`,
    `- Cỡ mẫu: ${out.dataset.nSkuEligible} SKU dùng được / ${out.dataset.nSkuTotal} SKU trong tệp (loại ${out.dataset.excludedNoCost} SKU không có giá niêm yết)`,
    `- Ngày không ghi nhận bán: ${out.dataset.zeroSalesDays}/${out.dataset.nDays} (${pct(out.dataset.zeroSalesDays / out.dataset.nDays)}) — xem \`03-evaluation-protocol.md\` §13, D-P5-07`,
    `- Cửa sổ trượt: ${out.windows.length} (test = ${out.windows.map((w) => w.testMonth).join(", ")})`,
    `- Lead time: ${out.opts.leadTimes.join("/")} · nhánh censored: ${out.opts.branches.join(",")} · positionMode: ${out.opts.positionModes.join(",")}`,
    `- Seed bootstrap: ${out.seed} · số lần resample: ${out.resamples}`,
    `- censoredDayRatio và số SKU bán được 0 đơn vị: xem bảng bootstrap + bảng chính (định dạng §11 của \`03-evaluation-protocol.md\`)`,
    `- **Mọi chỉ số tồn kho là MÔ PHỎNG** (dataset không có tồn kho/lead time/kênh).`,
    ``,
  ].join("\n");

  const parts = [];
  const mainAgg = aggs.find(
    (a) => a.positionMode === MAIN_POS && a.leadTimeDays === mainLt && a.branch === "A",
  );
  parts.push(
    `- sparseSkuRatio: ${pct(mainAgg ? mainAgg.sparseSkuRatio : null)} (SKU có < 10 ngày có bán trong 28 ngày trước cửa sổ)`,
    "",
    header,
  );
  parts.push(
    `## Chỉ số chính S5 — lead time ${mainLt} ngày, nhánh censored A, ngưỡng so \`ATP + onOrder\` (bảng chính)`,
    "",
    fmtPolicyTable(aggs, { position: MAIN_POS, leadTime: mainLt, branch: "A" }),
    "",
  );
  parts.push("### Số tuyệt đối (để đọc chỉ số chính)", "", fmtAbsoluteTable(aggs, { position: MAIN_POS, leadTime: mainLt, branch: "A" }), "");
  parts.push("### Bootstrap theo SKU (S7)", "", fmtBootstrapTable(aggs, { position: MAIN_POS, leadTime: mainLt, branch: "A" }), "");
  parts.push("### Chất lượng dự báo — WAPE (S8)", "", fmtForecastTable(aggs, { position: MAIN_POS, leadTime: mainLt, branch: "A" }), "");
  parts.push(
    `## Nhánh censored B (kiểm tra độ nhạy — S3)`,
    "",
    fmtPolicyTable(aggs, { position: MAIN_POS, leadTime: mainLt, branch: "B" }),
    "",
  );
  parts.push("### Bootstrap (nhánh B)", "", fmtBootstrapTable(aggs, { position: MAIN_POS, leadTime: mainLt, branch: "B" }), "");
  parts.push(
    `## Độ nhạy: ngưỡng so ATP thuần (đọc §2.1 theo chữ) thay vì ATP + onOrder`,
    "",
    fmtPolicyTable(aggs, { position: "atpOnly", leadTime: mainLt, branch: "A" }),
    "",
  );
  parts.push("### Bootstrap (atpOnly)", "", fmtBootstrapTable(aggs, { position: "atpOnly", leadTime: mainLt, branch: "A" }), "");
  for (const lt of out.opts.leadTimes.filter((x) => x !== mainLt)) {
    parts.push(
      `## Lead time ${lt} ngày (kiểm tra độ nhạy — S4)`,
      "",
      fmtPolicyTable(aggs, { position: MAIN_POS, leadTime: lt, branch: "A" }),
      "",
    );
  }
  return { markdown: parts.join("\n"), aggs };
};

// ---------------------------------------------------------------- sổ lần chạy (S11)

const gitCommit = () => {
  try {
    return execSync("git rev-parse --short HEAD", { cwd: path.resolve(__dirname, "..", ".."), encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
};

const appendRunLog = (out, { runId, command, note = "" }) => {
  fs.mkdirSync(path.dirname(RUNS_MD), { recursive: true });
  const { markdown, aggs } = buildMarkdown(out);
  if (out.opts.log === false) return { runId, markdown };
  const codeCommit = gitCommit();
  const protocolCommit = process.env.PROTOCOL_COMMIT || "1f1a402";
  const stamp = new Date().toISOString();
  const main = aggs.find((a) => a.leadTimeDays === out.opts.mainLeadTime && a.branch === "A");

  const line =
    `| ${runId} | ${stamp} | ${codeCommit} | ${protocolCommit} | ${path.basename(out.source.csvPath)} \`${out.source.sha256.slice(0, 12)}\` | \`${command}\` | ${out.opts.positionModes.join(",")} | ${out.seed} | test | ` +
    `P1=${num(main.policies.P1.mainMetric)} P2=${num(main.policies.P2.mainMetric)} P3=${num(main.policies.P3.mainMetric)} P4=${num(main.policies.P4.mainMetric)} | ${note || "chạy đầu theo giao thức"} |`;

  if (!fs.existsSync(RUNS_MD)) {
    fs.writeFileSync(
      RUNS_MD,
      `# Sổ ghi mọi lần chạy backtest (S11)\n\n` +
        `**Không xoá dòng nào.** Lần chạy bị thay thế giữ nguyên và đánh dấu \`superseded\`.\n` +
        `Cột "commit giao thức" là commit của \`docs/aisc26/03-evaluation-protocol.md\`.\n\n` +
        `| run_id | thời điểm | commit mã | commit giao thức | dataset + sha256 | lệnh | positionMode | seed | slice | chỉ số chính (TB cửa sổ) | ghi chú |\n` +
        `|---|---|---|---|---|---|---|---|---|---|---|\n`,
      "utf8",
    );
  }
  fs.appendFileSync(RUNS_MD, `${line}\n`, "utf8");

  const jsonl = {
    run_id: runId,
    at: stamp,
    code_commit: codeCommit,
    protocol_commit: protocolCommit,
    dataset: { file: path.basename(out.source.csvPath), sha256: out.source.sha256 },
    command,
    position_modes: out.opts.positionModes,
    seed: out.seed,
    resamples: out.resamples,
    slice: "test",
    lead_times: out.opts.leadTimes,
    branches: out.opts.branches,
    windows: out.windows.map((w) => ({ test: w.testMonth, mid: w.midMonth, trainEnd: w.trainEndDate })),
    main: Object.fromEntries(
      POLICY_NAMES.map((n) => [
        n,
        {
          label: main.tunedLabels[n],
          main_metric: round(main.policies[n].mainMetric, 6),
          wape: round(main.policies[n].wape, 6),
          censored_day_ratio: round(main.censoredDayRatio[n], 6),
        },
      ]),
    ),
    forecasts: Object.fromEntries(
      FORECAST_BASELINES.map((f) => [f, round(main.forecasts[f].wape, 6)]),
    ),
    bootstrap: main.bootstrap,
    note: note || "chạy đầu theo giao thức",
  };
  fs.appendFileSync(RUNS_JSONL, `${JSON.stringify(jsonl)}\n`, "utf8");

  return { runId, markdown };
};

module.exports = { aggregate, buildMarkdown, appendRunLog, fmtPolicyTable, fmtBootstrapTable, fmtForecastTable };
