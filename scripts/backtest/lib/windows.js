/**
 * scripts/backtest/lib/windows.js — cửa sổ trượt theo tháng (S6).
 *
 * Giao thức §3.1 yêu cầu "rolling-origin, tối thiểu 3 cửa sổ", mỗi cửa sổ =
 *   quan sát (train) → giữa (mid) → kiểm định (test)
 * nhưng KHÔNG nói cửa sổ nào được chọn. Quyết định chốt TRƯỚC lần chạy đầu
 * (xem `docs/aisc26/parallel/DECISIONS-P5.md` D-P5-03 và protocol §13):
 *   test = 3 tháng đầy đủ gần nhất, mid = tháng liền trước, train = mọi ngày
 *   trước đó. Mỗi cửa sổ dựng lại tham số từ đầu, không cộng dồn.
 */
const monthKey = (date) => date.slice(0, 7);

const daysInMonth = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/** Các tháng có đủ ngày trong `dates` (không phải tháng dở ở hai đầu kỳ). */
const fullMonths = (dates) => {
  const byMonth = new Map();
  for (const d of dates) {
    if (!byMonth.has(monthKey(d))) byMonth.set(monthKey(d), new Set());
    byMonth.get(monthKey(d)).add(d);
  }
  const out = [];
  for (const [mk, set] of [...byMonth.entries()].sort()) {
    const [y, m] = mk.split("-").map(Number);
    if (set.size === daysInMonth(y, m)) out.push(mk);
  }
  return out;
};

/**
 * @returns {Array<{index:number, testMonth:string, midMonth:string,
 *   trainEndDate:string, midStartDate:string, midEndDate:string,
 *   testStartDate:string, testEndDate:string, trainDays:number}>}
 */
const buildRollingWindows = (dates, { count = 3 } = {}) => {
  const months = fullMonths(dates);
  if (months.length < count + 2) {
    throw new Error(`Chi co ${months.length} thang day du, can it nhat ${count + 2} cho ${count} cua so.`);
  }
  const windows = [];
  for (let i = 0; i < count; i += 1) {
    const testMonth = months[months.length - 1 - i];
    const midMonth = months[months.length - 2 - i];
    const trainEndDate = months[months.length - 3 - i] + "-01";
    const [y, m] = testMonth.split("-").map(Number);
    const [my, mm] = midMonth.split("-").map(Number);
    const trainDays = dates.filter((d) => d < trainEndDate).length;
    windows.push({
      index: i,
      testMonth,
      midMonth,
      trainEndDate,
      midStartDate: `${midMonth}-01`,
      midEndDate: `${midMonth}-${String(daysInMonth(my, mm)).padStart(2, "0")}`,
      testStartDate: `${testMonth}-01`,
      testEndDate: `${testMonth}-${String(daysInMonth(y, m)).padStart(2, "0")}`,
      trainDays,
    });
  }
  return windows;
};

module.exports = { buildRollingWindows, fullMonths, monthKey, daysInMonth };
