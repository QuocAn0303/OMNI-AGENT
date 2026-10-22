/**
 * scripts/backtest/lib/demand.js — ước lượng nhu cầu/ngày + xử lý censored (S3).
 *
 * Ba điều giao thức chưa nói rõ, chốt trước lần chạy đầu (protocol §13):
 *   1) "TB 28 ngày" (protocol §1, P2/P3) được hiểu là trung bình của **28 ngày
 *      cuối của tập quan sát**, không phải toàn bộ tập quan sát. Lý do: nếu dùng
 *      cả tập quan sát thì "28 ngày" trong §1 là vô nghĩa, và tập quan sát phình
 *      theo cửa sổ thì P2/P3 ở cửa sổ sau sẽ khác hệ thống với cửa sổ trước.
 *   2) σ (§2.1) lấy trên **cùng 28 ngày** đó, để `d_ref` và `σ` cùng nhìn một
 *      giai đoạn; nếu lấy σ cả tập quan sát thì việc đánh dấu censored (chỉ biết
 *      được sau khi mô phỏng) sẽ phải mô phỏng cả 20 tháng cho mỗi cấu hình.
 *   3) Cờ censored lấy từ chính mô phỏng của phương án đó, qua **2 lượt** cố
 *      định: lượt 1 coi mọi ngày là không censored để có d_ref sơ bộ; lượt 2
 *      dùng cờ censored thật của lượt 1. Không lặp tới hội tụ (số vòng lặp phải
 *      chốt trước, nếu không kết quả phụ thuộc thứ tự cập nhật).
 */
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

const stdev = (xs) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
};

/**
 * Croston với alpha TƯỜNG MINH.
 *
 * Vì sao không dùng `crostonDemandPerDay` của `replenishment.calc.js`: hàm đó
 * **nhận tham số `alpha` nhưng không dùng** — nó tự suy `a = 1/(k+1)` từ khoảng
 * trống trong dữ liệu. Lưới tinh chỉnh của S12 yêu cầu `alpha ∈ {0.1,0.2,0.3}`,
 * nên dùng hàm đó thì ba "cấu hình" sẽ cho ra đúng một kết quả và P3 sẽ không
 * được đo đúng nghĩa. Xem D-P5-05.
 */
const crostonExplicit = (series, alpha) => {
  const nz = [];
  for (let i = 0; i < series.length; i += 1) if (series[i] > 0) nz.push({ q: series[i], i });
  if (!nz.length) return 0;
  let size = nz[0].q;
  let interval = nz.length > 1 ? Math.max(1, nz[1].i - nz[0].i) : 1;
  for (let k = 1; k < nz.length; k += 1) {
    const gap = nz[k].i - nz[k - 1].i;
    size = alpha * nz[k].q + (1 - alpha) * size;
    interval = alpha * gap + (1 - alpha) * interval;
  }
  return size / Math.max(1, interval);
};

/**
 * Nhánh A hiệu chỉnh / nhánh B loại ngày (S3 §4.1).
 * @param {number[]} series  chuỗi ngày DÀY (thiếu ngày = 0), đã cắt về đúng cửa sổ
 * @param {boolean[]} censored
 * @param {'A'|'B'} branch
 * @returns {{adjusted:number[], censoredDays:number, nonCensoredDays:number}}
 */
const adjustCensored = (series, censored, branch) => {
  const censoredDays = censored.reduce((s, c) => s + (c ? 1 : 0), 0);
  if (branch === "B") {
    const kept = [];
    for (let i = 0; i < series.length; i += 1) if (!censored[i]) kept.push(series[i]);
    return { adjusted: kept, censoredDays, nonCensoredDays: kept.length };
  }
  const observed = [];
  for (let i = 0; i < series.length; i += 1) if (!censored[i]) observed.push(series[i]);
  const base = mean(observed);
  const adjusted = new Array(series.length);
  for (let i = 0; i < series.length; i += 1) adjusted[i] = censored[i] ? Math.max(series[i], base) : series[i];
  return { adjusted, censoredDays, nonCensoredDays: observed.length };
};

/**
 * @param {number[]} series chuỗi ngày dày của cửa sổ nhu cầu (28 ngày)
 * @param {boolean[]} censored
 * @param {{branch:'A'|'B', alphas:number[], sparseThreshold:number}} opts
 */
const estimateDemand = (series, censored, { branch = "A", alphas = [0.1, 0.2, 0.3], sparseThreshold = 10 } = {}) => {
  const { adjusted, censoredDays, nonCensoredDays } = adjustCensored(series, censored, branch);
  const nonzeroDays = adjusted.reduce((s, x) => s + (x > 0 ? 1 : 0), 0);
  const croston = {};
  for (const a of alphas) croston[a] = crostonExplicit(adjusted, a);
  return {
    branch,
    demandPerDay: mean(adjusted),
    sigmaDaily: stdev(adjusted),
    croston,
    censoredDays,
    nonCensoredDays,
    nonzeroDays,
    sparse: nonzeroDays < sparseThreshold,
    totalDays: adjusted.length,
  };
};

module.exports = { mean, stdev, crostonExplicit, adjustCensored, estimateDemand };
