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

/**
 * Hệ số z chuẩn ứng với mức phục vụ. Bảng tra, không cần thư viện thống kê.
 *
 * `0.80` và `0.85` thêm vào ngày 2026-10-03 (gói P5 / T10): lưới tinh chỉnh đã
 * chốt trước trong `docs/aisc26/03-evaluation-protocol.md` §3.3 (S12) là
 * `0.80, 0.85, 0.90, 0.95`, nhưng bảng này thiếu hai mức đầu nên backtest sẽ
 * phải tự chế z — tức là mã backtest và mã sản phẩm dùng hai nguồn số khác nhau
 * cho cùng một khái niệm. Thêm vào bảng là thay đổi **cộng thêm**, không đổi
 * hành vi của bất kỳ mức nào đang tồn tại.
 */
const Z_BY_SERVICE_LEVEL = {
  0.80: 0.842,
  0.85: 1.036,
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

/**
 * Ngưỡng trôi (drift) khi người duyệt bấm duyệt.
 *
 * MỐI BẠN CẢNH BÁO: hai hằng số dưới đây là **mặc định chưa hiệu chỉnh, không
 * có căn cứ thực nghiệm**. Chúng được đặt theo kinh nghiệm chung của lĩnh vực,
 * chưa từng chạy trên dữ liệu của bất kỳ khách hàng nào. Sẽ xem lại sau backtest
 * (xem `docs/aisc26/03-evaluation-protocol.md`). Đừng trích hai số này ra slide
 * như kết quả đo.
 *
 * Vì sao cần: lúc đề xuất và lúc duyệt đã cách nhau vài giờ, nên tồn kho và đơn
 * giá có thể đã đổi. So sánh "lệch bao nhiêu thì chặn" có ý nghĩa; so sánh "hash
 * có khớp không" thì không — vì ATP đổi mỗi lần bán.
 */
const QTY_DRIFT_TOL = 0.25;
const COST_DRIFT_TOL = 0.1;

/** Kết quả kiểm tra độ lệch của một đề xuất. */
const DRIFT_NONE = "DRIFT_NONE";
const DRIFT_WARN = "DRIFT_WARN";
const DRIFT_BLOCK = "DRIFT_BLOCK";
const NO_LONGER_NEEDED = "NO_LONGER_NEEDED";

/**
 * Trạng thái khiếm khuyết dữ liệu: SKU CHƯA CÓ giá vốn dùng được.
 *
 * VÌ SAO phải là một trạng thái riêng, không phải `unitCost = 0`:
 *   `costPrice` trong DB là `Decimal NOT NULL`, nhưng **0 là giá trị hợp lệ về mặt
 *   kiểu dữ liệu** — tức đúng là trường hợp "chủ shop chưa nhập giá vốn". Gộp nó
 *   vào phép tính như một giá thật thì PO được tạo với tổng tiền bằng 0 và người
 *   duyệt thấy một con số **sai** chứ không phải "thiếu". Đó là kiểu lỗi tệ nhất:
 *   sai mà nhìn vẫn hợp lý.
 *
 * Phân biệt "thiếu" với "bằng 0" là bắt buộc ở MỌI chuyển đổi số trên dữ liệu
 * có thể null/rỗng — xem `classifyUnitCost` và `MISSING_COST` ở executor.
 */
const MISSING_COST = "MISSING_COST";

/**
 * Đọc giá vốn mà phân biệt "thiếu" với "bằng 0".
 *
 * `missing = true` khi: `null`, `undefined`, chuỗi rỗng, không ép được thành số,
 * HOẶC số ≤ 0. Lý do gộp ≤ 0 vào "thiếu": giá vốn 0 hoặc âm không phải dữ liệu
 * hợp lệ của bán lẻ (giá vốn âm = trả lại hàng, không phải giá nhập), và tổng
 * tiền 0 là con số sai. Cả hai đều phải chặn trước khi tạo PO.
 *
 * @returns {{value: number, missing: boolean}} `value` luôn là số hữu hạn ≥ 0
 *   để mọi phép tính phía sau không nhận NaN; `missing` là tín hiệu để CHẶN.
 */
const classifyUnitCost = (v) => {
  const isBlank = v === null || v === undefined || v === "";
  if (isBlank) return { value: 0, missing: true };
  const n = Number(v);
  if (!Number.isFinite(n)) return { value: 0, missing: true };
  if (n <= 0) return { value: n, missing: true };
  return { value: n, missing: false };
};

/**
 * Ép về số hữu hạn. Mọi giá trị không phải số (NaN, undefined, chuỗi vô nghĩa,
 * object, array rỗng...) đều thành `fallback`.
 *
 * Bắt buộc dùng hàm này thay cho `Number(x || 0)`: biểu thức đó KHÔNG an toàn
 * vì `x || 0` chỉ thay khi x falsy — `"abc" || 0` vẫn là `"abc"`, và
 * `Number("abc") = NaN` lọt vào payload đề xuất PO.
 */
const num = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/** Ép về số không âm (số lượng, giá, tồn không thể âm). */
const nonNeg = (v, fallback = 0) => Math.max(0, num(v, fallback));

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
const normalizeDailySales = (rows = []) => {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((r) => r && typeof r === "object")
    .map((r) => ({
      date: r.date,
      // `qty` âm là dữ liệu bẩn ⇒ kẹp 0. NaN/chuỗi ⇒ 0.
      qty: nonNeg(r.qty),
      // censored = trong ngày đó hàng không còn để bán ⇒ doanh số bị cắt,
      // KHÔNG phải nhu_cầu = 0. Đây là lỗi phổ biến nhất trong mô hình tồn kho.
      censored: Boolean(r.outOfStock),
    }));
};

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
 *
 * ============================================================================
 * VỀ `alpha` (ghi nhận từ P5b, sửa 2026-10-04)
 * ============================================================================
 * Trước đây hàm nhận tham số `alpha = 0.1` nhưng KHÔNG dùng — nó tự suy
 * `a = 1/(k+1)` ở dòng dưới ⇒ tham số người gọi truyền vào bị bỏ qua im lặng,
 * một loại bug "đọc code thấy sai mà test vẫn xanh" (vì test gọi không tham số).
 *
 * Nay `alpha` là TÙY CHỌN có nghĩa:
 *   - `alpha` truyền vào  → dùng đúng giá trị đó (đã kẹp vào (0, 0.99])
 *   - `alpha` bỏ trống    → tự suy theo Snyder `1/(k+1)` như trước
 *
 * Hàm gọi trong sản phẩm (`calcDemand`) không truyền `alpha` ⇒ **hành vi tính
 * toán của luồng demo và hai thí nghiệm KHÔNG đổi**. Thay đổi này chỉ làm cái
 * tham số bị bỏ qua trở thành tham số có tác dụng.
 *
 * @param {number} [alpha] 0 < alpha <= 0.99. Bỏ trống = tự suy từ dữ liệu.
 */
const crostonDemandPerDay = (qtySeries, alpha = null) => {
  const nonZero = qtySeries.map((q, i) => ({ q, i })).filter((x) => x.q > 0);

  // Ước lượng tham số smoothing từ dữ liệu (Snyder): alpha = 1/(k+1),
  // k = độ dài trung bình của khoảng trống giữa các lần bán.
  const gaps = nonZero.slice(1).map((x, i) => x.i - nonZero[i].i);
  const k = gaps.length ? Math.max(1, round(mean(gaps), 2)) : 1;
  const explicit = Number(alpha);
  const hasExplicit =
    alpha !== null && alpha !== undefined && Number.isFinite(explicit) && explicit > 0;
  const a = hasExplicit
    ? Math.min(0.99, explicit)
    : Math.min(0.99, 1 / (k + 1));

  if (!nonZero.length) return { demandPerDay: 0, alpha: round(a, 3) };

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
  const rows = Array.isArray(inventories) ? inventories.filter((i) => i && typeof i === "object") : [];
  const onHand = rows.reduce((s, i) => s + nonNeg(i.quantity), 0);
  const reserved = rows.reduce((s, i) => s + nonNeg(i.reserved), 0);
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
  // sigma âm là dữ liệu bẩn, không phải "an toàn hơn" ⇒ kẹp 0. leadTime tương tự.
  const sigma = nonNeg(sigmaDaily);
  const lt = nonNeg(leadTimeDays);
  const sigmaLT = sigma * Math.sqrt(lt);
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
  const d = nonNeg(demandPerDay);
  const lt = nonNeg(leadTimeDays);
  const ss = nonNeg(safetyStock);
  return {
    rop: Math.ceil(d * lt + ss),
    demandDuringLeadTime: round(d * lt, 2),
    safetyStock: ss,
    formula: "ROP = nhu_cầu/ngày × leadTime + safetyStock",
  };
};

/** Số ngày tồn còn đủ trước khi hết, theo nhu cầu đã hiệu chỉnh. */
const calcDaysOfCover = ({ atp = 0, demandPerDay = 0 } = {}) => {
  const d = nonNeg(demandPerDay);
  const a = nonNeg(atp);
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
  const a = num(atp);
  const r = nonNeg(rop);
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
  const d = nonNeg(demandPerDay);
  // Ngoặc là bắt buộc: `||` có độ ưu tiên thấp hơn `+`, viết không ngoặc sẽ
  // thành `rop || (0 + d*...)` và luôn trả về rop.
  const orderUpToLevel = Math.ceil(nonNeg(rop) + d * nonNeg(reviewPeriodDays));
  const raw = orderUpToLevel - nonNeg(atp);
  if (raw <= 0) {
    return { orderQty: 0, orderUpToLevel, rawNeed: raw, packMultiple, formula: "max(0, S − ATP) làm tròn theo bao bì" };
  }
  const pack = Math.max(1, Math.floor(nonNeg(packMultiple, 1)) || 1);
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
        `atp=${num(atp)}`,
        `rop=${num(rop)}`,
        `unitCost=${num(unitCost)}`,
        `orderQty=${num(orderQty)}`,
        `vendorId=${vendorId || ""}`,
      ].join("|"),
    )
    .digest("hex");

/**
 * Kiểm tra đề xuất còn hợp lệ không — so sánh theo NGƯỠNG Ý NGHĨA, không băm.
 *
 * Bốn trạng thái, mỗi trạng thái nói rõ người duyệt được làm gì:
 *
 * | Kết quả | Điều kiện | Người duyệt được làm gì |
 * |---|---|---|
 * | `NO_LONGER_NEEDED` | ATP **mới** > ROP ⇒ không còn cần đặt | Chỉ Từ chối. **Không có đường override.** |
 * | `DRIFT_BLOCK` | Lệch quá `QTY_DRIFT_TOL` hoặc `COST_DRIFT_TOL` | Xem diff rồi gửi lại kèm `acknowledgeDrift: true`, hoặc Từ chối |
 * | `DRIFT_WARN` | Lệch nhỏ hơn ngưỡng | Duyệt được, kèm cảnh báo trong kết quả |
 * | `DRIFT_NONE` | Không lệch | Duyệt thẳng |
 *
 * `acknowledgeDrift` KHÔNG phải override tự động: người duyệt phải thấy diff và
 * bấm xác nhận có chủ đích, và server **vẫn tính lại** ở lần gọi thứ hai.
 *
 * @param {object} proposed  payload đề xuất: { atp, rop, orderQty, unitCost }
 * @param {object} current   số vừa tính lại từ DB lúc duyệt (cùng cấu trúc)
 * @param {boolean} acknowledgeDrift  người duyệt đã xác nhận thấy diff
 */
const evaluateProposalFreshness = ({ proposed = {}, current = {}, acknowledgeDrift = false } = {}) => {
  const p = proposed && typeof proposed === "object" ? proposed : {};
  const c = current && typeof current === "object" ? current : {};
  const pAtp = num(p.atp);
  const pRop = num(p.rop);
  const cAtp = num(c.atp);
  const cRop = num(c.rop);

  // Không còn cần đặt nữa — chặn tuyệt đối, không override được.
  if (Number.isFinite(cAtp) && Number.isFinite(cRop) && cAtp > cRop) {
    return {
      status: NO_LONGER_NEEDED,
      canApprove: false,
      canAcknowledge: false,
      message:
        `SKU không còn cần đặt: lúc đề xuất ATP=${pAtp} <= ROP=${pRop}, ` +
        `nay ATP=${cAtp} > ROP=${cRop}. Chi co the Tu choi.`,
      diff: { atp: { proposed: pAtp, current: cAtp }, rop: { proposed: pRop, current: cRop } },
    };
  }

  const pQty = nonNeg(p.orderQty);
  const cQty = nonNeg(c.orderQty);
  // Giá vốn: dùng `classifyUnitCost` để "thiếu" KHÔNG bị coi như "bằng 0".
  //
  // Nếu một trong hai vế bị thiếu thì KHÔNG so lệch giá được — so sánh 0 với 0
  // cho `relCost = 0` (không cảnh báo) hoặc 0 với giá mới (chặn vô lý). Đúng hơn
  // là nói thẳng `missingCost` để executor chặn 409 trước khi tạo PO.
  const pCost = classifyUnitCost(p.unitCost);
  const cCost = classifyUnitCost(c.unitCost);
  const costMissing = pCost.missing || cCost.missing;
  const pCostValue = pCost.value;
  const cCostValue = cCost.value;

  // Lệch tương đối so với giá trị CŨ (proposed). Tránh chia cho 0.
  const relQty = pQty > 0 ? Math.abs(cQty - pQty) / pQty : cQty > 0 ? 1 : 0;
  // Khi một vế thiếu, KHÔNG kết luận "lệch giá" — nhưng `anyDrift` vẫn phải đúng
  // để UI không báo "không lệch" trong khi thực ra là không đo được.
  const relCost =
    costMissing ? 0 : pCostValue > 0 ? Math.abs(cCostValue - pCostValue) / pCostValue : cCostValue > 0 ? 1 : 0;

  const diff = {
    orderQty: { proposed: pQty, current: cQty, relDrift: round(relQty, 4) },
    unitCost: {
      proposed: pCost.missing ? null : pCostValue,
      current: cCost.missing ? null : cCostValue,
      relDrift: round(relCost, 4),
      missingCost: costMissing,
    },
    atp: { proposed: pAtp, current: cAtp },
    rop: { proposed: pRop, current: cRop },
  };

  const qtyBlocked = relQty > QTY_DRIFT_TOL;
  const costBlocked = !costMissing && relCost > COST_DRIFT_TOL;
  const anyDrift = relQty > 0 || relCost > 0;

  // THIẾU GIÁ VỐN: trả trạng thái riêng, KHÔNG gộp vào DRIFT_*.
  // `canApprove: false` ở đây chỉ mang tính thông tin cho UI — quyết định chặn
  // thật (409 MISSING_COST) thuộc executor, nơi biết cả trạng thái gate.
  if (costMissing) {
    return {
      status: MISSING_COST,
      canApprove: false,
      canAcknowledge: false,
      acknowledged: false,
      message:
        "SKU chua co gia von dung duoc (thieu hoac <= 0) o luc nay hoac luc de xuat. " +
        "Khong tao PO: tong tien se sai. Them gia von cho SKU truoc khi duyet.",
      diff,
    };
  }

  if ((qtyBlocked || costBlocked) && !acknowledgeDrift) {
    const parts = [];
    if (qtyBlocked) parts.push(`so luong ${pQty} -> ${cQty} (lech ${Math.round(relQty * 100)}%)`);
    if (costBlocked) parts.push(`don gia ${pCostValue} -> ${cCostValue} (lech ${Math.round(relCost * 100)}%)`);
    return {
      status: DRIFT_BLOCK,
      canApprove: false,
      canAcknowledge: true,
      acknowledged: false,
      message:
        `Du lieu da doi so voi luc de xuat: ${parts.join("; ")}. ` +
        `Neu van mua, gui lai kem acknowledgeDrift=true; neu khong thi Tu choi.`,
      diff,
    };
  }

  // Đã vượt ngưỡng nhưng người duyệt đã xác nhận có chủ đích. Giữ status
  // DRIFT_BLOCK để UI vẫn hiển thị "đây là đề xuất đã lệch" — chỉ thêm cờ để
  // phân biệt với trường hợp chưa ai xác nhận.
  if (qtyBlocked || costBlocked) {
    const parts = [];
    if (qtyBlocked) parts.push(`so luong ${pQty} -> ${cQty}`);
    if (costBlocked) parts.push(`don gia ${pCostValue} -> ${cCostValue}`);
    return {
      status: DRIFT_BLOCK,
      canApprove: true,
      canAcknowledge: false,
      acknowledged: true,
      message:
        `Da vuot nguong troi du lieu (${parts.join("; ")}) nhung nguoi duyet da ` +
        `xac nhan co chu dich. Server van tinh lai so moi o lan goi nay.`,
      diff,
    };
  }

  if (anyDrift) {
    return {
      status: DRIFT_WARN,
      canApprove: true,
      canAcknowledge: false,
      acknowledged: false,
      message:
        `Du lieu da doi nhe: so luong ${pQty} -> ${cQty}, don gia ${pCostValue} -> ${cCostValue}. ` +
        `Duoi nguong chan (${Math.round(QTY_DRIFT_TOL * 100)}% / ${Math.round(COST_DRIFT_TOL * 100)}%).`,
      diff,
    };
  }

  return { status: DRIFT_NONE, canApprove: true, canAcknowledge: false, acknowledged: false, message: "Du lieu khong doi.", diff };
};

/**
 * TRẠNG THÁI PO ĐANG CÒN TRÊN ĐƯỜNG (chưa nhập kho).
 *
 * Gồm cả `DRAFT` — vì PO do gate tạo ra khi tổng tiền dưới ngưỡng
 * `PO_ABOVE` chính là DRAFT, nhưng nó LÀ hàng sắp đặt. Bỏ DRAFT khỏi danh sách
 * này là nguyên nhân kinh điển của việc đặt trùng hàng.
 */
const OPEN_PO_STATUSES = ["DRAFT", "PENDING", "PENDING_APPROVAL", "APPROVED", "ORDERED"];

/**
 * Vị thế tồn (inventory position) = ATP + onOrder.
 *
 * Vì sao BẮT BUỘC cộng `onOrder`: sau khi người duyệt, PO còn nằm trên đường về
 * kho nhưng ATP CHƯA tăng. Nếu chỉ so `ATP ≤ ROP` thì CDC sẽ thấy thiếu hàng và
 * sinh đề xuất thứ hai cho đúng nhu cầu đó → hai PO cho một lần mua.
 *
 * @param {Array<{quantity:number, receivedQty?:number}>} lines
 *   Dòng PO còn mở, kèm số lượng đã nhận qua GRN đã POST (mặc định 0).
 */
const calcOnOrder = ({ lines = [] } = {}) => {
  const rows = Array.isArray(lines) ? lines.filter((l) => l && typeof l === "object") : [];
  return rows.reduce((sum, l) => sum + Math.max(0, nonNeg(l.quantity) - nonNeg(l.receivedQty)), 0);
};

/**
 * Hàm duy nhất cho luong demo: gop moi buoc tinh cho mot SKU.
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
  onOrder = 0,
  /** Lead time do người dùng CẤU HÌNH cho riêng SKU/kho (Odoo days-to-purchase). */
  configuredLeadTimeDays = null,
  /** Trần tồn cấu hình — CHỈ để cảnh báo tồn quá cao, KHÔNG ép vào ROP. */
  maxStock = null,
} = {}) => {
  const demand = calcDemand({ dailySales, method: demandMethod });
  // Ưu tiên thứ tự: cấu hình của người dùng → đo được từ lịch sử PO→GRN →
  // mặc định 7 ngày. `configuredLeadTimeDays = null` nghĩa là chưa cấu hình.
  const lead = calcLeadTime({
    receipts,
    defaultDays: configuredLeadTimeDays || defaultLeadTimeDays,
  });
  const leadSource = configuredLeadTimeDays > 0
    ? "CONFIGURED"
    : lead.estimated ? "ESTIMATED" : "MEASURED";
  const atp = calcAtp({ inventories });
  // Inventory position = tồn khả dụng + hàng đang trên đường. Dùng vị thế này
  // để quyết định, còn ATP giữ nguyên để hiển thị cho người duyệt.
  const onOrderQty = nonNeg(onOrder);
  const position = atp.atp + onOrderQty;
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
    atp: position,
    rop: rop.rop,
    demandPerDay: demand.demandPerDay,
  });
  const qty = calcOrderQty({
    atp: position,
    rop: rop.rop,
    demandPerDay: demand.demandPerDay,
    reviewPeriodDays,
    packMultiple,
  });

  const totalEstimate = qty.orderQty * nonNeg(unitCost);
  // CỜ KHIẾM KHUYẾT: `missingCost` là thứ phân biệt "chưa có giá vốn" với
  // "giá vốn = 0". Mọi nơi nhận `plan` đều phải kiểm tra cờ này trước khi dùng
  // `totalEstimate` để tạo PO.
  const cost = classifyUnitCost(unitCost);

  // Tồn quá cao so với trần cấu hình — dùng để cảnh báo vận hành (tồn quá cao
  // vốn tiền và chiếm chỗ). KHÔNG đưa vào `orderQty`: ép trần vào công thức đặt
  // sẽ cho `orderQty = 0` và hệ thống im lặng không đề xuất, tức mất cảnh báo
  // thiếu hàng. `maxStock = null` (chưa cấu hình) ⇒ không cảnh báo, không bịa.
  const maxStockQty = maxStock != null && Number(maxStock) > 0 ? Number(maxStock) : null;
  const overStock = maxStockQty != null && position > maxStockQty;

  return {
    ...status,
    missingCost: cost.missing,
    demand,
    lead: { ...lead, source: leadSource },
    atp: { ...atp, onOrder: onOrderQty, position },
    safety,
    rop,
    order: { ...qty, totalEstimate },
    // Quy tắc nhập hàng đang áp dụng (để UI hiện "này là CẤU HÌNH của bạn").
    rules: {
      configured: configuredLeadTimeDays != null || maxStockQty != null,
      leadTimeDays: configuredLeadTimeDays != null ? configuredLeadTimeDays : null,
      leadTimeSource: leadSource,
      serviceLevel,
      packMultiple,
      maxStock: maxStockQty,
      overStock,
      excessQty: overStock ? Math.max(0, position - maxStockQty) : 0,
    },
    // LLM chỉ được nhận khối này. Không được suy ra số khác.
    rationale: {
      atp: atp.atp,
      onOrder: onOrderQty,
      inventoryPosition: position,
      rop: rop.rop,
      safetyStock: safety.safetyStock,
      demandPerDay: demand.demandPerDay,
      sigmaDaily: demand.sigmaDaily,
      leadTimeDays: lead.leadTimeDays,
      leadTimeEstimated: lead.estimated,
      leadTimeSource: leadSource,
      daysOfCoverLeft: status.daysOfCover,
      orderQty: qty.orderQty,
      unitCost: cost.value,
      missingCost: cost.missing,
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
  QTY_DRIFT_TOL,
  COST_DRIFT_TOL,
  STOCKOUT,
  NEED_REPLENISHMENT,
  OK,
  DRIFT_NONE,
  DRIFT_WARN,
  DRIFT_BLOCK,
  NO_LONGER_NEEDED,
  MISSING_COST,
  // hàm
  classifyUnitCost,
  calcDemand,
  crostonDemandPerDay,
  calcLeadTime,
  calcAtp,
  calcSafetyStock,
  calcRop,
  calcDaysOfCover,
  evaluateStockStatus,
  evaluateProposalFreshness,
  calcOrderQty,
  calcOnOrder,
  OPEN_PO_STATUSES,
  proposalFingerprint,
  planReplenishment,
};