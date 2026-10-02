/**
 * modules/replenishment/replenishment.calc.js — CÔNG THỨC bổ sung tồn kho
 *
 * Mọi hàm ở đây là **hàm thuần**: input JSON → output JSON, không đọc DB,
 * không gọi LLM, không đọc biến môi trường, không dùng Date.now().
 * (Ngoại lệ duy nhất: `nowIso` được truyền vào từ nơi gọi nếu cần.)
 *
 * Lý do tách riêng như vậy:
 *  1. Giám khảo đã hỏi "sao không dùng công thức ROP?" — câu trả lời mạnh nhất
 *     là **cho họ đọc công thức và chạy unit test của nó**. Không có LLM nào
 *     trong file này, và không có import nào tới `config/llm`.
 *  2. Đây là NGUỒN SỰ THẬT DUY NHẤT cho mọi con số mà LLM được phép nhìn
 *     (xem `docs/aisc26/01-llm-role.md` §2).
 *
 * Nguyên tắc áp dụng:
 *  - Censored demand: ngày hết hàng KHÔNG phải ngày nhu cầu = 0.
 *  - Nhu cầu thưa (intermittent): dùng Croston thay vì trung bình thường.
 *  - Lead time lấy từ lịch sử PO→GRN; thiếu dữ liệu thì trả về giá trị ước
 *    lượng **kèm cờ `estimated`**, không bao giờ trả về con số tưởng chừng
 *    là thật mà không nói.
 *  - Mọi kết quả đều kèm `method` + `confidence` để người duyệt biết mình
 *    đang nhìn số từ đâu.
 */
const crypto = require("crypto");

/** Hệ số z chuẩn ứng với mức phục vụ. Bảng tra, không cần thư viện thống kê. */
const Z_BY_SERVICE_LEVEL = {
  0.90: 1.282,
  0.95: 1.645,
  0.975: 1.96,
  0.99: 2.326,
};

const DEFAULT_SERVICE_LEVEL = 0.95;
const DEFAULT_LEAD_TIME_DAYS = 7;
/** Dưới ngưỡng này thì coi lead time là ước lượng (chưa đủ mẫu để tin). */
const LEAD_TIME_MIN_SAMPLES = 3;
/** Ít hơn ngưỡng này ngày có bán ⇒ SKU bán thưa ⇒ đổi phương pháp. */
const SPARSE_NONZERO_DAYS = 10;

const round = (n, digits = 2) => {
  if (!Number.isFinite(n)) return n;
  const f = 10 ** digits;
  return Math.round((n + Number.EPSILON) * f) / f;
};

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** Độ lệch chuẩn mẫu (n−1). Trả 0 nếu mẫu < 2 — tránh NaN khiến PO thành NaN. */
const stdev = (xs) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const variance = xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(variance);
};

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/**
 * Chuẩn hoá lịch sử bán theo ngày.
 *
 * @param {Array<{date:string, qty:number, outOfStock?:boolean}>} rows
 * @returns {{daily: Array<{date:string,qty:number,censored:boolean}>, totalDays:number}}
 */
const normalizeDailySales = (rows = []) =>
  (rows || []).map((r) => ({
    date: r.date,
    qty: Number(r.qty || 0),
    // censored = trong ngày đó hàng không còn để bán ⇒ doanh số bị cắt,
    // KHÔNG phải nhu_cầu = 0. Đây là lỗi phổ biến nhất trong mô hình tồn kho.
    censored: Boolean(r.outOfStock),
  }));

/**
 * Nhu cầu nền trên ngày — có hiệu chỉnh censored demand.
 *
 * Cách làm:
 *  1. Tính trung bình trên **ngày không bị censored** (nhu cầu quan sát được).
 *  2. Với ngày bị censored, thay giá trị bằng `max(bán thực tế, trung bình ở bước 1)`.
 *     Vì khi hết hàng, số bán thực tế ≤ nhu cầu thật, nên phải nâng lên, không hạ xuống.
 *  3. Lấy trung bình trên toàn bộ ngày (đã hiệu chỉnh).
 *
 * @returns {{
 *   demandPerDay:number, demandPerDayObservedOnly:number, sigmaDaily:number,
 *   totalDays:number, censoredDays:number, imputedDays:number,
 *   nonzeroDays:number, sparse:boolean, method:string, confidence:string,
 *   note:string
 * }}
 */
const calcDemand = ({ dailySales = [], method = "auto" } = {}) => {
  const daily = normalizeDailySales(dailySales);
  const totalDays = daily.length;

  const nonCensored = daily.filter((d) => !d.censored);
  const observed = nonCensored.map((d) => d.qty);
  const baselineNonCensored = mean(observed);

  let imputedDays = 0;
  const adjusted = daily.map((d) => {
    if (!d.censored) return d.qty;
    imputedDays += 1;
    // hết hàng ⇒ doanh số bị kìm, nhu cầu thật >= doanh số đó.
    return Math.max(d.qty, baselineNonCensored);
  });

  const nonzeroDays = daily.filter((d) => d.qty > 0).length;
  const sparse = nonzeroDays < SPARSE_NONZERO_DAYS;

  // SKU bán thưa: trung bình thường lệch mạnh về 0. Croston là cách chuẩn cho
  // nhu cầu gián đoạn — dùng nhịp giữa hai lần bán, không phụ thuộc ngày bán 0.
  let demandPerDay;
  let resolvedMethod;
  if (method === "croston" || (method === "auto" && sparse)) {
    const croston = crostonDemandPerDay(adjusted);
    demandPerDay = croston.demandPerDay;
    resolvedMethod = `croston(alpha=${croston.alpha})`;
  } else {
    demandPerDay = mean(adjusted);
    resolvedMethod = "moving-average";
  }

  const sigmaDaily = stdev(adjusted);

  // Độ tin cậy: càng ít quan sát, càng nhiều ngày bị censored, càng ràng buộc.
  let confidence = "HIGH";
  if (totalDays < 30 || nonzeroDays < SPARSE_NONZERO_DAYS) confidence = "LOW";
  else if (totalDays < 60 || imputedDays > totalDays * 0.2) confidence = "MEDIUM";

  const notes = [];
  if (imputedDays > 0) {
    notes.push(
      `${imputedDays}/${totalDays} ngày bị hiệu chỉnh vì hết hàng — nhu cầu thật có thể cao hơn số quan sát được.`,
    );
  }
  if (sparse) {
    notes.push(
      `SKU bán thưa (${nonzeroDays} ngày có bán / ${totalDays} ngày) — dùng Croston, không dùng trung bình.`,
    );
  }
  if (totalDays < 30) notes.push(`Chỉ có ${totalDays} ngày dữ liệu — dưới mức tin cậy cao.`);

  return {
    demandPerDay: round(demandPerDay, 3),
    demandPerDayObservedOnly: round(baselineNonCensored, 3),
    sigmaDaily: round(sigmaDaily, 3),
    totalDays,
    censoredDays: imputedDays,
    imputedDays,
    nonzeroDays,
    sparse,
    method: resolvedMethod,
    confidence,
    note: notes.join(" "),
  };
};

/**
 * Croston cho nhu cầu gián đoạn.
 * size = lượng bán mỗi lần, interval = số ngày giữa hai lần bán.
 * demandPerDay = size / interval.
 */
const crostonDemandPerDay = (qtySeries, alpha = 0.1) => {
  const nonZero = qtySeries.map((q, i) => ({ q, i })).filter((x) => x.q > 0);
  if (!nonZero.length) return { demandPerDay: 0, alpha };

  // Ước lượng tham số smoothing từ dữ liệu (Snyder): alpha = 1/(k+1),
  // k = độ dài trung bình của khoảng trống giữa các lần bán.
  const gaps = nonZero.slice(1).map((x, i) => x.i - nonZero[i].i);
  const k = gaps.length ? Math.max(1, round(mean(gaps), 2)) : 1;
  const a = Math.min(0.99, 1 / (k + 1));

  // Hạt giống phải lấy từ khoảng trống QUAN SÁT ĐƯỢC đầu tiên. Seed bằng 1
  // sẽ làm interval nhỏ lúc đầu và kéo nhu_cầu/ngày tăng vọt sai.
  let size = nonZero[0].q;
  let interval = gaps.length ? Math.max(1, gaps[0]) : 1;
  let total = 0;

  for (let i = 1; i < nonZero.length; i += 1) {
    const gap = nonZero[i].i - nonZero[i - 1].i;
    size = a * nonZero[i].q + (1 - a) * size;
    interval = a * gap + (1 - a) * interval;
    total += nonZero[i].q;
  }

  return { demandPerDay: size / Math.max(1, interval), alpha: round(a, 3) };
};

/**
 * Lead time = số ngày từ khi tạo PO đến khi nhận hàng (GRN).
 * Dùng TRUNG VỊ, không dùng trung bình: lead time có đuôi dài (NCC trễ 2 tuần),
 * trung bình bị kéo lệch và sẽ đặt sai số lượng.
 *
 * @param {Array<{poDate:string, receivedAt:string}>} receipts
 * @returns {{leadTimeDays:number, estimated:boolean, sampleSize:number, method:string, note:string}}
 */
const calcLeadTime = ({ receipts = [], defaultDays = DEFAULT_LEAD_TIME_DAYS } = {}) => {
  const gaps = (receipts || [])
    .filter((r) => r.poDate && r.receivedAt)
    .map((r) => Math.round((new Date(r.receivedAt) - new Date(r.poDate)) / 86400000))
    .filter((d) => Number.isFinite(d) && d >= 0);

  if (gaps.length < LEAD_TIME_MIN_SAMPLES) {
    return {
      leadTimeDays: defaultDays,
      estimated: true,
      sampleSize: gaps.length,
      method: "default",
      note:
        gaps.length === 0
          ? `Chưa có lịch sử nhận hàng — dùng mặc định ${defaultDays} ngày. CỜ: ước lượng.`
          : `Chỉ ${gaps.length} lần nhận hàng (< ${LEAD_TIME_MIN_SAMPLES}) — dùng mặc định ${defaultDays} ngày. CỜ: ước lượng.`,
    };
  }

  const days = median(gaps);
  return {
    leadTimeDays: round(days, 1),
    estimated: false,
    sampleSize: gaps.length,
    method: "median-of-po-to-grn",
    note: `Lead time trung vị trên ${gaps.length} lần nhận hàng (PO → GRN).`,
  };
};

/**
 * Tồn khả dụng (ATP) = tổng tồn − đã giữ, GỘP MỌI KÊNH/KHO.
 *
 * Đây là điểm khác biệt cốt lõi của luồng demo: sàn bán được 3 cái thì ATP giảm
 * 3, không phải tồn của "kênh sàn" riêng (không tồn tại khái niệm kho theo kênh
 * trong mô hình này — hàng của mọi kênh là một tồn chung).
 *
 * @param {Array<{quantity:number, reserved?:number}>} inventories
 */
const calcAtp = ({ inventories = [] } = {}) => {
  const rows = inventories || [];
  const onHand = rows.reduce((s, i) => s + Number(i.quantity || 0), 0);
  const reserved = rows.reduce((s, i) => s + Number(i.reserved || 0), 0);
  const available = onHand - reserved;
  return {
    atp: available,
    onHand,
    reserved,
    warehouses: rows.length,
    negative: available < 0,
  };
};

/**
 * Safety stock theo mức phục vụ:
 *   SS = z(serviceLevel) × σ_LT,  với σ_LT = σ_ngày × √(leadTime)
 *
 * Lý do dùng √LT: các ngày trong khoảng chờ nhập hàng là các biến độc lập,
 * nên độ lệch chuẩn cộng dồn theo căn bậc hai, không cộng thẳng.
 */
const calcSafetyStock = ({
  sigmaDaily = 0,
  leadTimeDays = DEFAULT_LEAD_TIME_DAYS,
  serviceLevel = DEFAULT_SERVICE_LEVEL,
} = {}) => {
  const z = Z_BY_SERVICE_LEVEL[serviceLevel];
  if (!z) {
    throw Object.assign(new Error(`Mức phục vụ ${serviceLevel} không có trong bảng z`), {
      status: 400,
    });
  }
  const sigmaLT = Number(sigmaDaily || 0) * Math.sqrt(Math.max(0, Number(leadTimeDays) || 0));
  const safetyStock = Math.ceil(z * sigmaLT);
  return {
    safetyStock,
    z,
    sigmaLeadTime: round(sigmaLT, 3),
    serviceLevel,
    formula: "SS = z(α) × σ_ngày × √(leadTime)",
  };
};

/**
 * Điểm đặt hàng lại (ROP) = nhu cầu trong thời gian chờ + tồn kho an toàn.
 *
 * LLM KHÔNG BAO GIỜ ĐƯỢC TÍNH HÀM NÀY (xem `docs/aisc26/01-llm-role.md`).
 */
const calcRop = ({ demandPerDay = 0, leadTimeDays = DEFAULT_LEAD_TIME_DAYS, safetyStock = 0 } = {}) => {
  const d = Math.max(0, Number(demandPerDay) || 0);
  const lt = Math.max(0, Number(leadTimeDays) || 0);
  const ss = Math.max(0, Number(safetyStock) || 0);
  return {
    rop: Math.ceil(d * lt + ss),
    demandDuringLeadTime: round(d * lt, 2),
    safetyStock: ss,
    formula: "ROP = nhu_cầu/ngày × leadTime + safetyStock",
  };
};

/** Số ngày tồn còn đủ trước khi hết, theo nhu cầu đã hiệu chỉnh. */
const calcDaysOfCover = ({ atp = 0, demandPerDay = 0 } = {}) => {
  const d = Number(demandPerDay) || 0;
  const a = Number(atp) || 0;
  if (d <= 0) return { daysOfCover: null, infinite: true };
  return { daysOfCover: round(a / d, 1), infinite: false };
};

/**
 * NGƯỠNG TỒN THẤP DUY NHẤT cho luồng demo (P0-4).
 *
 * Trước đây có 5 nơi dùng 5 kiểu khác nhau (`quantity <= 5` hard-code ở
 * automation.service.js:387 và db-agent.service.js:72/174/435, so với
 * `available <= minStock` ở inventory.service.js:257), nên cùng một dữ liệu ra hai
 * con số khác nhau. Luồng demo chỉ dùng hàm này; các nơi khác để backlog.
 *
 * Quy tắc: cần nhập khi `atp <= rop`. Trả kèm mức độ để người duyệt phân loại.
 */
const NEED_REPLENISHMENT = "REPLENISHMENT_NEEDED";
const OK = "OK";
const STOCKOUT = "STOCKOUT";

const evaluateStockStatus = ({ atp = 0, rop = 0, demandPerDay = 0 } = {}) => {
  const a = Number(atp) || 0;
  const r = Number(rop) || 0;
  const { daysOfCover, infinite } = calcDaysOfCover({ atp: a, demandPerDay });

  let status;
  if (a <= 0) status = STOCKOUT;
  else if (a <= r) status = NEED_REPLENISHMENT;
  else status = OK;

  return {
    status,
    needsReplenishment: status !== OK,
    atp: a,
    rop: r,
    daysOfCover,
    infinite,
    threshold: "atp <= rop",
  };
};

/**
 * Số lượng đặt — chính sách (R, S) rà soát định kỳ.
 *
 * S = ROP + nhu_cầu trong 1 chu kỳ rà soát. Với shop nhỏ rà soát hằng tuần,
 * chu kỳ 7 ngày là giả định mặc định và được ghi ra để người duyệt thấy.
 * Trả về 0 nếu đã đủ tồn — đề xuất rỗng thì không sinh gate.
 */
const calcOrderQty = ({
  atp = 0,
  rop = 0,
  demandPerDay = 0,
  reviewPeriodDays = 7,
  packMultiple = 1,
} = {}) => {
  const d = Math.max(0, Number(demandPerDay) || 0);
  // Ngoặc là bắt buộc: `||` có độ ưu tiên thấp hơn `+`, viết không ngoặc sẽ
  // thành `rop || (0 + d*...)` và luôn trả về rop.
  const orderUpToLevel = Math.ceil(
    (Number(rop) || 0) + d * Math.max(0, Number(reviewPeriodDays) || 0),
  );
  const raw = orderUpToLevel - (Number(atp) || 0);
  if (raw <= 0) {
    return { orderQty: 0, orderUpToLevel, rawNeed: raw, packMultiple, formula: "max(0, S − ATP) làm tròn theo bao bì" };
  }
  const pack = Math.max(1, Math.floor(Number(packMultiple) || 1));
  const orderQty = Math.ceil(raw / pack) * pack;
  return {
    orderQty,
    orderUpToLevel,
    rawNeed: raw,
    packMultiple: pack,
    formula: "max(0, S − ATP) làm tròn lên theo bao bì NCC",
  };
};

/**
 * Vân tay của một quyết định — dùng để phát hiện đề xuất đã lỗi thời lúc duyệt.
 *
 * Chỉ băm các con số QUYẾT ĐỊNH (atp, rop, đơn giá, số lượng). Không băm ngày
 * tháng, không băm id — cùng một quyết định với cùng số liệu phải cho cùng
 * vân tay, nếu không thì kiểm tra "đề xuất còn hợp lệ không" sẽ luôn lệch.
 */
const proposalFingerprint = ({ atp, rop, unitCost, orderQty, vendorId } = {}) =>
  crypto
    .createHash("sha256")
    .update(
      [
        `atp=${Number(atp) || 0}`,
        `rop=${Number(rop) || 0}`,
        `unitCost=${Number(unitCost) || 0}`,
        `orderQty=${Number(orderQty) || 0}`,
        `vendorId=${vendorId || ""}`,
      ].join("|"),
    )
    .digest("hex");

/**
 * Hàm duy nhất cho luồng demo: gộp mọi bước tính cho một SKU.
 * Đây là thứ P0-4 yêu cầu — một ngưỡng tồn thấp, một nơi định nghĩa.
 *
 * @returns {object} mọi số ở đây là CÔNG THỨC. LLM chỉ đọc, không sửa.
 */
const planReplenishment = ({
  dailySales = [],
  inventories = [],
  receipts = [],
  unitCost = 0,
  packMultiple = 1,
  reviewPeriodDays = 7,
  serviceLevel = DEFAULT_SERVICE_LEVEL,
  defaultLeadTimeDays = DEFAULT_LEAD_TIME_DAYS,
  demandMethod = "auto",
} = {}) => {
  const demand = calcDemand({ dailySales, method: demandMethod });
  const lead = calcLeadTime({ receipts, defaultDays: defaultLeadTimeDays });
  const atp = calcAtp({ inventories });
  const safety = calcSafetyStock({
    sigmaDaily: demand.sigmaDaily,
    leadTimeDays: lead.leadTimeDays,
    serviceLevel,
  });
  const rop = calcRop({
    demandPerDay: demand.demandPerDay,
    leadTimeDays: lead.leadTimeDays,
    safetyStock: safety.safetyStock,
  });
  const status = evaluateStockStatus({
    atp: atp.atp,
    rop: rop.rop,
    demandPerDay: demand.demandPerDay,
  });
  const qty = calcOrderQty({
    atp: atp.atp,
    rop: rop.rop,
    demandPerDay: demand.demandPerDay,
    reviewPeriodDays,
    packMultiple,
  });

  const totalEstimate = qty.orderQty * (Number(unitCost) || 0);

  return {
    ...status,
    demand,
    lead,
    atp,
    safety,
    rop,
    order: { ...qty, totalEstimate },
    // LLM chỉ được nhận khối này. Không được suy ra số khác.
    rationale: {
      atp: atp.atp,
      rop: rop.rop,
      safetyStock: safety.safetyStock,
      demandPerDay: demand.demandPerDay,
      sigmaDaily: demand.sigmaDaily,
      leadTimeDays: lead.leadTimeDays,
      leadTimeEstimated: lead.estimated,
      daysOfCoverLeft: status.daysOfCover,
      orderQty: qty.orderQty,
      unitCost: Number(unitCost) || 0,
      totalEstimate,
      demandMethod: demand.method,
      demandConfidence: demand.confidence,
    },
  };
};

module.exports = {
  // hằng số
  Z_BY_SERVICE_LEVEL,
  DEFAULT_SERVICE_LEVEL,
  DEFAULT_LEAD_TIME_DAYS,
  LEAD_TIME_MIN_SAMPLES,
  SPARSE_NONZERO_DAYS,
  STOCKOUT,
  NEED_REPLENISHMENT,
  OK,
  // hàm
  calcDemand,
  crostonDemandPerDay,
  calcLeadTime,
  calcAtp,
  calcSafetyStock,
  calcRop,
  calcDaysOfCover,
  evaluateStockStatus,
  calcOrderQty,
  proposalFingerprint,
  planReplenishment,
};