/**
 * scripts/backtest/lib/metrics.js — chỉ số + chặn "số lấy từ tập giữa".
 *
 * S12/protocol §3.2: mọi hàm báo cáo **phải** nhận `slice: 'test'` và từ chối
 * mọi tham số khác. Đây là hàng rào bắt buộc, không phải kiểm tra cho có: nếu ai
 * đó lỡ gọi hàm báo cáo với dữ liệu tập giữa thì phải ném lỗi, chứ không trả
 * về một con số trông vẫn hợp lệ.
 */
const REPORT_SLICE = "test";

const assertSlice = (slice) => {
  if (slice !== REPORT_SLICE) {
    throw new Error(
      `Chi bao cao tren tap kiem dinh. Nhan duoc slice="${slice}", phai la "${REPORT_SLICE}". ` +
        `Tinh chinh thi dien dat giua (S2), khong bao gio duoc dung so giua ra bang.`,
    );
  }
  return true;
};

/** PRNG tất định — cùng seed cho cùng kết quả (S7 yêu cầu chạy lại từ sạch ra cùng số). */
const mulberry32 = (seed) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const round = (v, digits = 4) => {
  if (v === null || v === undefined || !Number.isFinite(v)) return null;
  const f = 10 ** digits;
  return Math.round(v * f) / f;
};

/** WAPE gộp SKU (protocol §5.2): Σ|y − ŷ| / Σy trên tập kiểm định. */
const wape = ({ actual, predicted, slice }) => {
  assertSlice(slice);
  let nume = 0;
  let den = 0;
  for (let i = 0; i < actual.length; i += 1) {
    nume += Math.abs(actual[i] - predicted[i]);
    den += actual[i];
  }
  if (den <= 0) return null;
  return nume / den;
};

/** Chỉ số chính S5 cho một tập hợp SKU đã gộp. */
const pooledMetric = ({ totalCost, sold }) => (sold > 0 ? totalCost / sold : null);

/**
 * Bootstrap theo SKU (cluster bootstrap, S7).
 * @param {Array<{a:{totalCost:number,sold:number}, b:{totalCost:number,sold:number}}>} perSku
 *   `a` = phương án, `b` = baseline. `null` nghĩa là SKU đó bán được 0 đơn vị
 *   dưới phương án tương ứng ⇒ không chia được, đưa sang bộ đếm riêng.
 */
const clusterBootstrap = ({
  perSku,
  seed = 20261003,
  resamples = 1000,
  slice = REPORT_SLICE,
  alpha = 0.05,
}) => {
  assertSlice(slice);
  const usable = perSku.filter((r) => r.a && r.b && r.a.sold > 0 && r.b.sold > 0);
  const n = usable.length;
  if (n < 2) {
    return { n, resamples, seed, point: null, ciLow: null, ciHigh: null, excluded: perSku.length - n };
  }

  let sumA = 0;
  let sumAsold = 0;
  let sumB = 0;
  let sumBsold = 0;
  let wins = 0;
  let losses = 0;
  let ties = 0;
  for (const r of usable) {
    sumA += r.a.totalCost;
    sumAsold += r.a.sold;
    sumB += r.b.totalCost;
    sumBsold += r.b.sold;
    const ma = r.a.totalCost / r.a.sold;
    const mb = r.b.totalCost / r.b.sold;
    if (ma < mb) wins += 1;
    else if (ma > mb) losses += 1;
    else ties += 1;
  }
  const point = sumA / sumAsold - sumB / sumBsold;

  const rnd = mulberry32(seed);
  const diffs = new Float64Array(resamples);
  for (let r = 0; r < resamples; r += 1) {
    let a = 0;
    let as = 0;
    let b = 0;
    let bs = 0;
    for (let k = 0; k < n; k += 1) {
      const row = usable[Math.floor(rnd() * n)];
      a += row.a.totalCost;
      as += row.a.sold;
      b += row.b.totalCost;
      bs += row.b.sold;
    }
    diffs[r] = a / as - b / bs;
  }
  const sorted = Array.from(diffs).sort((x, y) => x - y);
  const lo = sorted[Math.floor((alpha / 2) * resamples)];
  const hi = sorted[Math.min(resamples - 1, Math.ceil((1 - alpha / 2) * resamples) - 1)];

  return {
    n,
    resamples,
    seed,
    point: round(point),
    ciLow: round(lo),
    ciHigh: round(hi),
    excludesZero: !(lo <= 0 && hi >= 0),
    wins,
    losses,
    ties,
    winRatio: round(wins / n),
    excluded: perSku.length - n,
    winRatioThreshold: 0.55,
    winRatioMet: wins / n > 0.55,
  };
};

/**
 * Thí nghiệm 2 (protocol §13.2.3): so GIÁ TRỊ TỒN TRUNG BÌNH ở CÙNG MỨC DỊCH VỤ.
 *
 * "Cùng mức dịch vụ" = khớp theo từng SKU: giữ SKU mà fill rate của `a` và `b`
 * lệch nhau ≤ `band` (2 điểm phần trăm, chốt trước). Trên đúng tập SKU đã khớp,
 * bootstrap **theo SKU** (S7: seed, số lần resample, ngưỡng tỉ lệ thắng 0,55).
 * `wins` = SKU nào có giá trị tồn TB **thấp hơn**.
 */
const matchedServiceBootstrap = ({
  perSku,
  band = 0.02,
  seed = 20261003,
  resamples = 1000,
  slice = REPORT_SLICE,
  alpha = 0.05,
}) => {
  assertSlice(slice);
  const usable = perSku.filter(
    (r) =>
      r.a &&
      r.b &&
      r.a.avgValue !== undefined &&
      r.b.avgValue !== undefined &&
      r.a.actualUnits > 0 &&
      r.b.actualUnits > 0,
  );
  const matched = usable.filter((r) => Math.abs(r.a.fillRate - r.b.fillRate) <= band);
  const n = matched.length;
  if (n < 2) {
    return {
      band,
      n,
      usableCount: usable.length,
      excluded: perSku.length - n,
      resamples,
      seed,
      point: null,
      ciLow: null,
      ciHigh: null,
      excludesZero: false,
      wins: 0,
      losses: 0,
      ties: 0,
      winRatio: null,
      winRatioThreshold: 0.55,
      winRatioMet: false,
    };
  }

  let sumA = 0;
  let sumB = 0;
  let wins = 0;
  let losses = 0;
  let ties = 0;
  for (const r of matched) {
    sumA += r.a.avgValue;
    sumB += r.b.avgValue;
    if (r.a.avgValue < r.b.avgValue) wins += 1;
    else if (r.a.avgValue > r.b.avgValue) losses += 1;
    else ties += 1;
  }
  const point = sumA / n - sumB / n;

  const rnd = mulberry32(seed);
  const diffs = new Float64Array(resamples);
  for (let r = 0; r < resamples; r += 1) {
    let a = 0;
    let b = 0;
    for (let k = 0; k < n; k += 1) {
      const row = matched[Math.floor(rnd() * n)];
      a += row.a.avgValue;
      b += row.b.avgValue;
    }
    diffs[r] = a / n - b / n;
  }
  const sorted = Array.from(diffs).sort((x, y) => x - y);
  const lo = sorted[Math.floor((alpha / 2) * resamples)];
  const hi = sorted[Math.min(resamples - 1, Math.ceil((1 - alpha / 2) * resamples) - 1)];

  return {
    band,
    n,
    usableCount: usable.length,
    excluded: perSku.length - n,
    resamples,
    seed,
    point: round(point),
    ciLow: round(lo),
    ciHigh: round(hi),
    excludesZero: !(lo <= 0 && hi >= 0),
    wins,
    losses,
    ties,
    winRatio: round(wins / n),
    winRatioThreshold: 0.55,
    winRatioMet: wins / n > 0.55,
  };
};

module.exports = {
  REPORT_SLICE,
  assertSlice,
  mulberry32,
  round,
  wape,
  pooledMetric,
  clusterBootstrap,
  matchedServiceBootstrap,
};
