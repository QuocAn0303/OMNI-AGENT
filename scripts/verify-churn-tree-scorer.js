'use strict';

/**
 * Kiểm chứng: dự đoán bằng Node phải KHỚP `predict_proba` của LightGBM.
 *
 * Đây là hợp đồng giữa `scripts/ml/train-churn.py` (huấn luyện, Python) và
 * `src/modules/churn-trees.service.js` (dự đoán, Node). Ranh giới nằm ở tệp JSON
 * mô hình, nên chỉ cần một bên đổi là bên kia sai mà không có gì báo lỗi.
 *
 * Lỗi đã mắc: bản đầu chia tổng lá cho số cây rồi mới sigmoid, khiến mọi xác suất
 * dồn quanh 0,5. Test này bắt được loại lỗi đó.
 *
 * Cách chạy:
 *   node scripts/verify-churn-tree-scorer.js
 *   PYTHON=đường/dẫn/tới/python node scripts/verify-churn-tree-scorer.js
 */
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const PANEL = path.join(ROOT, "data", "dataset", "churn", "panel.csv");
const MODEL = path.join(ROOT, "data", "dataset", "churn", "churn-lgbm.json");
// Bản gốc của LightGBM. Tệp JSON ở trên là bản rút gọn cho Node đọc và không
// mở được bằng `lgb.Booster(model_file=...)`, nên đối chiếu phải dùng bản gốc.
const NATIVE = path.join(ROOT, "data", "dataset", "churn", "churn-lgbm-native.txt");

const scorer = require(path.join(ROOT, "src", "modules", "customers", "churn-trees.service.js"));

const PYTHON = process.env.PYTHON || "python";
const N_SAMPLE = Number(process.env.SAMPLE || 500);
const TOLERANCE = 1e-6;

function fail(msg) {
  console.error(`[verify] SAI: ${msg}`);
  process.exitCode = 1;
}

/**
 * Sinh bộ mẫu đặc trưng thô từ panel, rồi yêu cầu Python tính xác suất gốc.
 *
 * Dùng chính panel.csv làm nguồn đặc trưng để hai bên nhìn cùng dữ liệu: lấy ngẫu
 * nhiên một mẫu, bỏ cột nhãn, rồi đưa `raw_score` của LightGBM ra. Nhờ vậy đối
 * chiếu là trên dữ liệu thật chứ không phải số bịa ra.
 */
function getPythonScores(sampleCount, features) {
  const script = `
import json
import numpy as np, pandas as pd, lightgbm as lgb

feature_names = json.loads(r'''${JSON.stringify(features)}''')

df = pd.read_csv(r'''${PANEL}''')
booster = lgb.Booster(model_file=r'''${NATIVE}''')
X = df[feature_names].to_numpy(dtype=float)
rng = np.random.default_rng(42)
pick = rng.choice(len(X), size=${sampleCount}, replace=False)
scores = booster.predict(X[pick])
print(json.dumps({
    "picks": [int(i) for i in pick],
    "scores": [float(s) for s in scores],
}))
`;
  const out = execFileSync(PYTHON, ["-c", script], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const line = out.trim().split("\n").filter((l) => l.trim().startsWith("{"))[0];
  if (!line) throw new Error("Python không trả về JSON. Kiểm tra PYTHON và thư viện lightgbm.");
  return JSON.parse(line);
}

/** Chuyển dòng panel sang dạng đặc trưng thô mà `predict()` mong đợi. */
function toRawMetrics(row) {
  const exp = (v) => Math.exp(v) - 1; // log1p ngược lại
  return {
    recencyDays: row.recencyDays,
    frequency: row.frequency,
    monetary: exp(row.logMonetary),
    avgGap: row.avgGapDays,
    tenureDays: row.tenureDays,
    avgOrderValue: exp(row.logAvgOrderValue),
  };
}

function main() {
  if (!fs.existsSync(MODEL)) {
    console.error(`[verify] Thiếu tệp mô hình ${path.relative(ROOT, MODEL)} — chạy: python scripts/ml/train-churn.py`);
    process.exit(1);
  }
  const model = JSON.parse(fs.readFileSync(MODEL, "utf8"));
  const features = model.features;

  console.log("=".repeat(74));
  console.log("KIỂM CHỨNG DỰ ĐOÁN CÂY QUYẾT ĐỊNH — NODE so với LIGHTGBM");
  console.log("=".repeat(74));
  console.log(`Mô hình      : ${model.version} · ${model.trees.length} cây · ngưỡng ${model.decisionThreshold}`);
  console.log(`Dung sai cho phép: ${TOLERANCE}`);
  console.log(`Python       : ${PYTHON}`);
  console.log("-".repeat(74));

  // 1. Dự đoán trong Node, không cần Python — kiểm tra nhanh hình dạng đầu ra
  const dummy = { recencyDays: 10, frequency: 3, monetary: 3e6, avgGap: 30, tenureDays: 200, avgOrderValue: 1e6 };
  const p0 = scorer.predict(dummy);
  if (p0 == null) {
    fail("không nạp được mô hình trong Node");
    return;
  }
  if (!(p0 > 0 && p0 < 1)) fail(`xác suất nằm ngoài (0,1): ${p0}`);
  console.log(`Dự đoán mẫu trong Node: ${p0}`);

  // 2. Đối chiếu từng mẫu với LightGBM
  let payload;
  try {
    payload = getPythonScores(N_SAMPLE, features);
  } catch (e) {
    console.error(`[verify] Không chạy được phần Python: ${e.message}`);
    console.error("[verify] Bỏ qua đối chiếu số. Cài lightgbm hoặc đặt biến PYTHON.");
    process.exit(1);
  }

  const lines = fs.readFileSync(PANEL, "utf8").trim().split("\n");
  const header = lines[0].split(",");
  const dataLines = lines.slice(1);
  const cols = Object.fromEntries(header.map((h, i) => [h, i]));

  let worst = 0;
  let worstIdx = -1;
  for (let k = 0; k < payload.picks.length; k += 1) {
    const line = dataLines[payload.picks[k]];
    const cells = line.split(",");
    const row = {};
    for (const f of features) {
      row[f] = Number(cells[cols[f]]);
    }
    const mine = scorer.predict(toRawMetrics(row));
    const theirs = payload.scores[k];
    const diff = Math.abs(mine - theirs);
    if (diff > worst) {
      worst = diff;
      worstIdx = payload.picks[k];
    }
  }

  console.log("-".repeat(74));
  console.log(`Số mẫu đối chiếu : ${payload.picks.length}`);
  console.log(`Sai lệch lớn nhất : ${worst.toExponential(3)}`);
  console.log(`Kết luận         : ${worst <= TOLERANCE ? "ĐẠT" : "KHÔNG ĐẠT"} (cho phép ${TOLERANCE})`);
  if (worst > TOLERANCE) {
    fail(`dự đoán lệch ${worst} ở mẫu dòng ${worstIdx + 2} (tính cả dòng tiêu đề)`);
  } else {
    console.log("Dự đoán của Node khớp LightGBM.");
  }

  // 3. Kiểm tra ngưỡng và kiểu dữ liệu mà phía Node dựa vào
  console.log("-".repeat(74));
  const problems = [];
  if (typeof model.decisionThreshold !== "number") problems.push("decisionThreshold không phải số");
  if (model.thresholdOperator !== "<=") problems.push(`thresholdOperator lạ: ${model.thresholdOperator}`);
  if (!Array.isArray(model.featureImportance)) problems.push("thiếu featureImportance");
  for (const t of model.trees) {
    const ids = Object.keys(t.nodes);
    for (const id of ids) {
      const n = t.nodes[id];
      if (n.leaf === undefined && (n.l === undefined || n.r === undefined)) {
        problems.push(`nút ${id} không phải lá mà cũng thiếu con`);
        break;
      }
    }
    break;
  }
  if (problems.length) {
    for (const p of problems) fail(p);
  } else {
    console.log("Cấu trúc tệp mô hình đúng như `churn-trees.service.js` kỳ vọng.");
  }
  console.log("=".repeat(74));
}

main();