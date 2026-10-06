/**
 * modules/customers/clv-forecast.service.js — Dự báo CLV & Churn (Mục 3.3 đặc tả CRM/SRM)
 *
 * Quyết định kỹ thuật:
 * - Implement thuần Node.js theo hướng method-of-moments XẤP XỈ BG/NBD + Gamma-Gamma
 *   (không phải MLE đầy đủ) — không thêm dependency/microservice mới vào stack.
 *   * p_alive (probability alive): dựa trên "hazard" = khoảng im lặng kể từ đơn gần nhất
 *     so với chu kỳ mua trung bình (T/n) → p_alive = 1 / (1 + hazard). Đây là xấp xỉ
 *     chuẩn của họ mô hình Pareto/NBD dùng recency + frequency, đủ tin cậy cho cảnh báo
 *     win-back ở quy mô SME.
 *   * Gamma-Gamma: giá trị giao dịch được coi là độc lập với tần suất (giả định của
 *     mô hình) → giá trị mỗi đơn ước lượng bằng trung bình toàn bộ lịch sử.
 * - CLV = giá trị TB mỗi đơn × số đơn kỳ vọng trong horizon × p_alive.
 * - Fallback bắt buộc: customer có < 2 đơn COMPLETED → churnProbability/clvPredicted
 *   = null (KHÔNG suy đoán bừa).
 *
 * Đầu vào: lịch sử đơn COMPLETED (status, createdAt, total). Đầu ra ghi vào
 * Customer.clvPredicted / churnProbability / clvScoredAt.
 */
const prisma = require("../../config/prisma");
const { runWithTenant } = require("../../config/tenantContext");
const logger = require("../../utils/logger");

const DAY_MS = 86_400_000;
const HORIZON_DAYS = 365;
const MIN_ORDERS = 2;

const round4 = (v) => Math.round(v * 10000) / 10000;
const round2 = (v) => Math.round(v * 100) / 100;

/**
 * Hàm thuần (dễ test): tính CLV/churn từ mảng đơn COMPLETED.
 * Trả về { clvPredicted, churnProbability, pAlive, avgOrderValue, insufficientData }
 */
const forecastCustomer = ({ orders, now = new Date(), horizonDays = HORIZON_DAYS }) => {
  const completed = (orders || [])
    .filter((o) => o.status === "COMPLETED")
    .map((o) => ({
      t: new Date(o.createdAt).getTime(),
      total: Number(o.total ?? o.totalAmount ?? 0),
    }))
    .filter((o) => Number.isFinite(o.t) && !Number.isNaN(o.total))
    .sort((a, b) => a.t - b.t);

  if (completed.length < MIN_ORDERS) {
    return { clvPredicted: null, churnProbability: null, insufficientData: true };
  }

  const nowMs = now.getTime();
  const firstT = completed[0].t;
  const lastT = completed[completed.length - 1].t;
  const n = completed.length;
  const tX = Math.max(0, (lastT - firstT) / DAY_MS); // recency: first → last purchase (ngày)
  const T = Math.max(1, (nowMs - firstT) / DAY_MS); // tuổi khách hàng (ngày)
  const inactivity = Math.max(0, (nowMs - lastT) / DAY_MS); // im lặng từ đơn gần nhất
  const avgGap = T / n; // chu kỳ mua trung bình (ngày/đơn)
  const avgOrderValue = completed.reduce((s, o) => s + o.total, 0) / n;

  // p_alive = 1 / (1 + hazard), hazard = inactivity / avgGap
  const hazard = inactivity / Math.max(1, avgGap);
  const pAlive = Math.min(1, Math.max(0, 1 / (1 + hazard)));
  const churnProbability = round4(1 - pAlive);

  // Số đơn kỳ vọng trong horizon, suy giảm theo p_alive
  const purchaseRate = n / T; // đơn/ngày
  const expectedOrders = purchaseRate * horizonDays * pAlive;
  const clvPredicted = round2(avgOrderValue * expectedOrders);

  return { clvPredicted, churnProbability, pAlive: round4(pAlive), avgOrderValue, insufficientData: false };
};

/**
 * Suy ra bộ ĐẶC TRƯNG từ lịch sử đơn — dùng chung cho công thức và mô hình.
 *
 * `churn-model.service.js` cần đúng những đại lượng này; nếu mỗi bên tự tính
 * riêng thì đặc trưng của mô hình lệch với lúc huấn luyện ⇒ AUC đo được không
 * còn ý nghĩa. Vì vậy hàm này là nguồn sự thật DUY NHẤT cho phép tính.
 *
 * @returns {null|{recencyDays:number, frequency:number, monetary:number,
 *   avgGap:number, tenureDays:number, avgOrderValue:number, orders:Array}}
 *   `null` khi chưa đủ 2 đơn COMPLETED (không suy đoán).
 */
const deriveMetrics = async (customerId, { now = new Date(), observationDays = HORIZON_DAYS } = {}) => {
  if (!customerId) return null;
  const since = new Date(now.getTime() - observationDays * DAY_MS);
  const rows = await prisma.order.findMany({
    where: { customerId, status: "COMPLETED", createdAt: { gte: since } },
    select: { createdAt: true, total: true },
    orderBy: { createdAt: "asc" },
  });
  if (rows.length < MIN_ORDERS) return null;

  const firstT = new Date(rows[0].createdAt).getTime();
  const lastT = new Date(rows[rows.length - 1].createdAt).getTime();
  const n = rows.length;
  const nowMs = now.getTime();
  const monetary = rows.reduce((s, o) => s + Number(o.total ?? 0), 0);

  return {
    recencyDays: Math.max(0, Math.floor((nowMs - lastT) / DAY_MS)),
    frequency: n,
    monetary,
    avgGap: Math.max(1, (nowMs - firstT) / DAY_MS / n),
    tenureDays: Math.max(0, Math.floor((nowMs - firstT) / DAY_MS)),
    avgOrderValue: monetary / n,
    orders: rows,
  };
};

// Chấm điểm 1 customer và persist kết quả
const scoreCustomer = async (customerId, client = prisma, now = new Date()) => {
  if (!customerId) return null;
  const orders = await client.order.findMany({
    where: { customerId, status: "COMPLETED" },
    select: { status: true, createdAt: true, total: true },
  });
  const result = forecastCustomer({ orders, now });
  // Đặc trưng cho mô hình: cùng công thức với `forecastCustomer` để hai cách
  // suy luận nhìn cùng một dữ liệu.
  const clvForecastMetrics = () => {
    if (result.insufficientData) return null;
    const completed = orders
      .filter((o) => o.status === "COMPLETED")
      .map((o) => new Date(o.createdAt).getTime())
      .sort((a, b) => a - b);
    const nowMs = now.getTime();
    const firstT = completed[0];
    const lastT = completed[completed.length - 1];
    const n = completed.length;
    const monetary = orders.reduce((s, o) => s + Number(o.total ?? 0), 0);
    return {
      recencyDays: Math.max(0, Math.floor((nowMs - lastT) / DAY_MS)),
      frequency: n,
      monetary,
      avgGap: Math.max(1, (nowMs - firstT) / DAY_MS / n),
      tenureDays: Math.max(0, Math.floor((nowMs - firstT) / DAY_MS)),
      avgOrderValue: monetary / n,
    };
  };

  // Ưu tiên MÔ HÌNH ĐÃ HUẤN LUYỆN như là BẰNG CHỨNG BỔ SUNG cho công thức.
  // Hợp nhất bằng `max()`: khách công thức đã cảnh báo thì giữ nguyên; khách mà
  // công thức bỏ sót nhưng mô hình thấy rủi ro thì được nâng lên ngưỡng hệ
  // thống. Thiếu dữ liệu hoặc thiếu file mô hình ⇒ giữ kết quả công thức.
  let engine = "bnbd-formula";
  let churnProbability = result.churnProbability;
  if (result.insufficientData === false) {
    try {
      const churnModel = require("./churn-model.service");
      const metrics = await clvForecastMetrics(customerId, now);
      if (metrics) {
        const scored = churnModel.scoreCustomer({ id: customerId }, metrics);
        if (scored) {
          churnProbability = churnModel.combine(
            result.churnProbability,
            churnModel.mapToSystemScale(scored.p, scored.threshold),
          );
          engine = scored.engine;
        }
      }
    } catch (e) {
      logger.warn(`[clv] mô hình churn lỗi cho khách ${customerId}, dùng công thức: ${e.message}`);
    }
  }

  await client.customer.update({
    where: { id: customerId },
    data: {
      clvPredicted: result.clvPredicted,
      churnProbability,
      clvScoredAt: new Date(),
    },
  });
  return { customerId, ...result, churnProbability, engine };
};

// Chấm toàn bộ customer có đơn COMPLETED trong tenant hiện tại
const runForTenant = async (client = prisma, now = new Date()) => {
  const groups = await client.order.groupBy({
    by: ["customerId"],
    where: { status: "COMPLETED", customerId: { not: null } },
    _count: { _all: true },
  });
  const scored = [];
  for (const g of groups) {
    try {
      const res = await scoreCustomer(g.customerId, client, now);
      if (res) scored.push(res);
    } catch (e) {
      logger.error(`[clv] score customer ${g.customerId} failed:`, e.message);
    }
  }
  return { scored, customers: groups.length };
};

// Cron: duyệt toàn bộ tenant
const runAllTenants = async (now = new Date()) => {
  const tenants = await prisma.tenant.findMany({ select: { id: true } });
  let total = 0;
  for (const t of tenants) {
    try {
      const res = await runWithTenant(t.id, () => runForTenant(prisma, now));
      total += res?.scored?.length ?? 0;
    } catch (e) {
      logger.error(`[clv] tenant ${t.id} failed:`, e.message);
    }
  }
  return { tenants: tenants.length, scored: total };
};

module.exports = { forecastCustomer, scoreCustomer, runForTenant, runAllTenants, deriveMetrics, MIN_ORDERS, HORIZON_DAYS };
