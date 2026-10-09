'use strict';

/**
 * modules/partners/roi.service.js — Lợi nhuận ròng và xếp hạng đối tác (PRM)
 *
 * ============================================================================
 * CÔNG THỨC, VÀ VÌ SAO CHỌN NHƯ VẬY
 * Đề cương đồ án ghi:
 *     ROI = (CLV trung bình khách do đối tác mang về × số khách chuyển đổi) − hoa hồng
 *
 * Ba chỗ công thức viết tắt chưa nói, và mỗi chỗ là một quyết định khác nhau:
 *
 * 1. CLV LẤY BẢN NÀO. Mặc định dùng `Customer.clvPredicted` — giá trị vòng đời DỰ
 *    BÁO. Lý do: ngân sách marketing được duyệt trước khi khách mua, nên phải so
 *    sánh được giữa các đối tác khi số khách chuyển đổi còn ít. Nếu dùng `totalSpent`
 *    (tiền đã thu) thì đối tác nào giới thiệu nhanh sẽ luôn thắng, dù mỗi khách
 *    lại trị giá thấp — đúng cái sai lệch mà phân hệ này sinh ra để tránh.
 *    Tham số `metric` cho phép đổi sang `actual` khi cần nhìn về quá khứ.
 *
 * 2. HOA HỒNG TÍNH TRÊN GÌ. Hai kiểu, tuỳ `Partner.commissionType`:
 *      PERCENT_OF_CLV   → hoa hồng = tỷ lệ × giá trị khách
 *      FIXED_PER_CUSTOMER → hoa hồng = số tiền cố định × số khách chuyển đổi
 *    Cả hai cùng tồn tại vì chương trình giới thiệu ở Việt Nam phần lớn trả theo
 *    lần giới thiệu, không theo tỷ lệ doanh thu.
 *
 *    Cơ sở tính hoa hồng KHÔNG đổi theo `metric` đang xem — xem chú thích ở khối
 *    tính bên dưới. Số tiền phải trả là số tiền phải trả, không phải con số dự
 *    báo.
 *
 * 3. CHỈ TÍNH KHÁCH ĐỦ DỮ LIỆU KHÔNG. `clvPredicted` bằng rỗng với khách chưa có
 *    tối thiểu hai đơn hoàn tất (quy tắc của `clv-forecast.service.js`). Báo cáo
 *    vì vậy luôn kèm `coverage` = phần khách chuyển đổi có đủ dữ liệu. Nếu không
 *    báo độ phủ thì người đọc tưởng số tiền đó là của tất cả khách.
 *
 * 4. CHI PHÍ THU HÚT. Cột `Customer.acquiredCost` là chi phí đã bỏ ra để có được
 *    khách đó (quảng cáo, mã ưu đãi trả cho đối tác…). Nếu không trừ, "lợi nhuận
 *    ròng" chỉ là doanh thu trừ hoa hồng và báo cáo sẽ khen một đối tác tốn kém.
 *    NULL được hiểu là chưa ghi chi phí, tức 0.
 *
 * LƯU Ý VỀ THỨ TỰ ƯU TIÊN
 * Xếp hạng mặc định theo `profit` (lợi nhuận ròng). Có thể đổi sang `revenue` (giá trị
 * khách) hoặc `conversion` (tỷ lệ chuyển đổi). Không mặc định theo số lượt giới
 * thiệu vì đó là con số dễ bị thổi phồng và không nói lên điều gì.
 *
 * MỘT CẢNH BÁO VỀ Ý NGHĨA
 * CLV là giá trị DỰ ĐOÁN của một khách. Báo cáo này KHÔNG phải doanh thu đã thu.
 * Tên trường dùng `predictedValue` và `netProfit` để nhớ, và giao diện nên ghi rõ
 * là "giá trị dự báo" chứ không phải "doanh thu".
 */

const prisma = require("../../config/prisma");

const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

const METRICS = ["predicted", "actual"];

/**
 * Xếp hạng đối tác theo lợi nhuận ròng.
 *
 * @param {object} opts
 * @param {'predicted'|'actual'} opts.metric  lấy CLV dự báo hay tiền đã thu
 * @param {number} opts.limit
 * @param {number} opts.offset
 * @param {string} opts.sortBy  profit | revenue | conversion | referrals
 * @param {boolean} opts.activeOnly chỉ lấy đối tác đang hoạt động
 */
const ranking = async ({ metric = "predicted", limit = 20, offset = 0, sortBy = "profit", activeOnly = true } = {}) => {
  // Chấn lọc tham số ngay trong service, không chỉ ở route.
  //
  // `usePredicted = metric === "predicted"` nên một giá trị lạ sẽ rơi nhánh "đo theo
  // thực tế" MÀ KHÔNG BÁO LỖI — báo cáo ra số tiền khác nhau mà không ai biết.
  // `db-agent.service.js` cũng gọi thẳng hàm này, không đi qua route.
  const useMetric = METRICS.includes(metric) ? metric : "predicted";
  const partnerWhere = activeOnly ? { isActive: true } : {};

  const partnerRows = await prisma.partner.findMany({
    where: partnerWhere,
    select: {
      id: true,
      code: true,
      name: true,
      type: true,
      isActive: true,
      commissionType: true,
      commissionRate: true,
      fixedCommission: true,
    },
    orderBy: { name: "asc" },
  });
  const partners = partnerRows;

  // Truy vấn thứ hai CỐ TÌNH không nằm trong `Promise.all` với cái trên.
  //
  // `where` của nó cần `partners.map(...)`, mà `partners` chỉ có sau khi `await`
  // xong. Trong `Promise.all([a, b])` cả hai biểu thức được đánh giá TRƯỚC khi
  // chờ ⇒ `b` chạy khi `partners` còn chưa khai báo và ném
  // `ReferenceError: Cannot access 'partners' before initialization`. Test
  // `partner-roi.service.test.js` bắt được đúng lỗi này.
  const referralGroups = await prisma.partnerReferral.groupBy({
    by: ["partnerId", "converted"],
    where: { partnerId: { in: partners.length ? partners.map((p) => p.id) : ["__none__"] } },
    _count: { _all: true },
  });

  const byPartner = new Map();
  for (const p of partners) {
    byPartner.set(p.id, { total: 0, converted: 0, scored: 0, valueSum: 0, actualSum: 0, acqCostSum: 0 });
  }
  for (const g of referralGroups) {
    const slot = byPartner.get(g.partnerId);
    if (!slot) continue;
    slot.total += g._count._all;
    if (g.converted) slot.converted += g._count._all;
  }

  // Tính tổng giá trị khách theo đối tác.
  //
  // `customerId` trong `partner_referrals` là KHOÁ MỀM và có thể NULL (lượt nhập
  // tay chưa gắn khách, hoặc khách đã xoá mềm). Vì vậy phải bỏ qua null thay vì
  // để Prisma ném lỗi, và đếm riêng số lượt không gắn được để báo cáo minh bạch.
  const convertedPartnerIds = [...byPartner.entries()].filter(([, s]) => s.converted > 0).map(([id]) => id);
  let unattached = 0;
  let contested = 0;
  if (convertedPartnerIds.length) {
    const convertedRows = await prisma.partnerReferral.findMany({
      where: { partnerId: { in: convertedPartnerIds }, converted: true },
      select: { partnerId: true, customerId: true },
    });
    // Mỗi khách được ghi nhận cho MỘT đối tác, và đối tác đó là người giới thiệu
    // ĐẦU TIÊN. Cộng dồn vào cả hai sẽ làm tổng giá trị toàn hệ thống vượt quá
    // thực tế; gán cho cả hai sẽ bị trùng.
    //
    // Nhưng khoan — trường hợp một khách bị hai đối tác cùng giới thiệu là dấu hiệu
    // gian lận hoa hồng, và việc gán tùy tiện cho một bên rồi bỏ bên kia là im lặng
    // làm sai. Vì vậy con số này được đẾM và đưa ra báo cáo (`contestedCustomers`) để
    // người dùng điều tra, thay vì chôn trong bảng xếp hạng.
    const claimsByCustomer = new Map();
    for (const r of convertedRows) {
      if (!r.customerId) {
        unattached += 1;
        continue;
      }
      if (!claimsByCustomer.has(r.customerId)) claimsByCustomer.set(r.customerId, []);
      claimsByCustomer.get(r.customerId).push(r.partnerId);
    }
    for (const ids of claimsByCustomer.values()) {
      if (ids.length > 1) contested += 1;
    }
    // Gán giá trị khách cho đối tác giới thiệu đầu tiên.
    const refByCustomer = new Map();
    for (const [customerId, ids] of claimsByCustomer) refByCustomer.set(customerId, ids[0]);
    const customerIds = [...refByCustomer.keys()];
    if (customerIds.length) {
      const customers = await prisma.customer.findMany({
        where: { id: { in: customerIds } },
        select: { id: true, clvPredicted: true, totalSpent: true, acquiredCost: true },
      });
      for (const c of customers) {
        const partnerId = refByCustomer.get(c.id);
        const slot = byPartner.get(partnerId);
        if (!slot) continue;
        const predicted = c.clvPredicted == null ? null : Number(c.clvPredicted);
        const actual = Number(c.totalSpent || 0);
        if (predicted != null) {
          slot.scored += 1;
          slot.valueSum += predicted;
        }
        slot.actualSum += actual;
        // Chi phí thu hút (quảng cáo, mã giảm giá cho đối tác…) do bên ngoài quy
        // định khi chỉnh sửa hồ sơ khách. Trừ vào lợi nhuận ròng, nếu không thì
        // "lợi nhuận" chỉ là doanh thu trừ hoa hồng và bỏ sót chi phí thật.
        slot.acqCostSum += Number(c.acquiredCost || 0);
      }
    }
  }

  const rows = partners.map((p) => {
    const s = byPartner.get(p.id);
    const usePredicted = useMetric === "predicted";
    const totalValue = usePredicted ? s.valueSum : s.actualSum;
    // Bình quân tính trên tập có dữ liệu khi đo theo dự báo; khi đo theo thực tế
    // thì mọi khách đều có tiền đã thu nên chia hết tổng chuyển đổi.
    const base = usePredicted ? s.scored : s.converted;
    const avgValue = base > 0 ? totalValue / base : 0;
    const netValue = usePredicted ? totalValue : s.actualSum;

    // ------------------------------------------------------------------
    // HOA HỒNG: cơ sở tính CỐ ĐỊNH, không theo `metric` đang xem
    // ------------------------------------------------------------------
    // Hợp đồng `PERCENT_OF_CLV` nói "theo tỷ lệ giá trị vòng đời của khách" — đó là
    // con số DỰ ĐOÁN, không phải tiền đã thu. Trước đây công thức lấy `avgValue`
    // theo đúng `metric` đang chọn, nên khi người dùng bật/tắt nút "dự báo /
    // thực tế" thì CỘT HOA HỒNG CŨNG ĐỔI THEO. Người đọc dễ hiểu nhầm số tiền
    // phải trả là số dự báo, rồi lấy nó đi trả thật.
    //
    // Sửa: tách cơ sở tính hoa hồng khỏi metric xem.
    //   - Có CLV dự báo cho ít nhất một khách → dùng bình quân CLV dự báo.
    //   - Không có khách nào có CLV (dữ liệu mới) → dùng bình quân tiền đã thu,
    //     vì lúc đó dự báo không có gì để dựa vào.
    const commissionBasis = s.scored > 0 ? s.valueSum / s.scored : (s.converted > 0 ? s.actualSum / s.converted : 0);

    let commission = 0;
    if (p.commissionType === "PERCENT_OF_CLV") {
      commission = commissionBasis * Number(p.commissionRate || 0) * s.converted;
    } else {
      commission = Number(p.fixedCommission || 0) * s.converted;
    }

    // Chi phí thu hút là chi phí THẬT đã phát sinh, không phụ thuộc metric xem.
    const acquisitionCost = round2(s.acqCostSum);
    const netProfit = round2(netValue - commission - acquisitionCost);

    return {
      partnerId: p.id,
      code: p.code,
      name: p.name,
      type: p.type,
      isActive: p.isActive,
      commissionType: p.commissionType,
      commissionPercent: Number((Number(p.commissionRate || 0) * 100).toFixed(4)),
      fixedCommission: Number(p.fixedCommission || 0),
      referrals: s.total,
      converted: s.converted,
      conversionRate: s.total ? round2((s.converted / s.total) * 100) : 0,
      scoredCustomers: s.scored,
      // Độ phủ = phần khách chuyển đổi đã có CLV dự báo. Đây là con số PHẢI ĐỌC
      // CÙNG doanh thu dự báo, nếu không sẽ hiểu sai.
      coverage: s.converted ? round2((s.scored / s.converted) * 100) : 0,
      avgValue: round2(avgValue),
      predictedValue: round2(netValue),
      actualValue: round2(s.actualSum),
      commission: round2(commission),
      // Chi phí thu hút đã ghi nhận trên hồ sơ khách (NULL = chưa ghi = 0).
      acquisitionCost,
      netProfit,
    };
  });

  const sorters = {
    profit: (a, b) => b.netProfit - a.netProfit,
    revenue: (a, b) => b.predictedValue - a.predictedValue,
    conversion: (a, b) => b.conversionRate - a.conversionRate || b.converted - a.converted,
    referrals: (a, b) => b.converted - a.converted || b.referrals - a.referrals,
  };
  const sorter = sorters[sortBy] || sorters.profit;
  rows.sort(sorter);
  rows.forEach((r, i) => {
    r.rank = i + 1;
  });

  // Tổng toàn hệ thống để so sánh với chi phí marketing.
  const totals = rows.reduce(
    (acc, r) => {
      acc.referrals += r.referrals;
      acc.converted += r.converted;
      acc.predictedValue += r.predictedValue;
      acc.actualValue += r.actualValue;
      acc.commission += r.commission;
      acc.acquisitionCost += r.acquisitionCost;
      acc.netProfit += r.netProfit;
      return acc;
    },
    {
      referrals: 0,
      converted: 0,
      predictedValue: 0,
      actualValue: 0,
      commission: 0,
      acquisitionCost: 0,
      netProfit: 0,
    },
  );

  return {
    // Tên trường giữ nguyên là `metric` vì đó là hợp đồng với phía gọi (route,
    // giao diện, `db-agent`); GIÁ TRỊ thì đã qua chấn lọc ở trên.
    metric: useMetric,
    metricLabel: useMetric === "predicted" ? "Giá trị vòng đời dự báo" : "Giá trị thực tế đã thu",
    sortBy: sorters[sortBy] ? sortBy : "profit",
    partners: rows.slice(Number(offset), Number(offset) + Number(limit)),
    total: rows.length,
    totals: {
      ...Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, round2(v)])),
      unattachedReferrals: unattached,
      // Số khách bị nhiều đối tác cùng giới thiệu. Báo cáo chỉ gán giá trị cho đối tác
      // giới thiệu ĐẦU TIÊN, nên nếu con số này khác 0 thì lợi nhuận ròng của các
      // bên sau đang bị báo thấp. Đưa ra ngoài để người dùng điều tra gian lận thay
      // vì phải tự phát hiện ra số ấy sai.
      contestedCustomers: contested,
      overallConversionRate: totals.referrals ? round2((totals.converted / totals.referrals) * 100) : 0,
      // Lợi nhuận ròng trên mỗi đồng hoa hồng: đối tác nào đáng giữ hơn.
      roiOnCommission: totals.commission > 0 ? round2((totals.netProfit / totals.commission) * 100) : null,
    },
  };
};

/** Chi tiết một đối tác: số liệu xếp hạng cộng danh sách khách đã chuyển đổi. */
const detail = async (partnerId) => {
  const { partners } = await ranking({ limit: 1000, activeOnly: false });
  const row = partners.find((p) => p.partnerId === partnerId);
  if (!row) throw { status: 404, message: "Không tìm thấy đối tác trong báo cáo hiệu quả" };

  const referrals = await prisma.partnerReferral.findMany({
    where: { partnerId, converted: true },
    select: { customerId: true, convertedAt: true, referralCode: true },
  });
  const customerIds = [...new Set(referrals.map((r) => r.customerId).filter(Boolean))];
  const customers = customerIds.length
    ? await prisma.customer.findMany({
        where: { id: { in: customerIds } },
        select: {
          id: true,
          name: true,
          phone: true,
          totalSpent: true,
          clvPredicted: true,
          churnProbability: true,
          rfmSegment: true,
        },
      })
    : [];
  const byId = new Map(customers.map((c) => [c.id, c]));

  return {
    partner: row,
    customers: referrals
      .map((r) => {
        const c = byId.get(r.customerId);
        return {
          referralCode: r.referralCode,
          convertedAt: r.convertedAt,
          customerId: r.customerId,
          name: c?.name || null,
          phone: c?.phone || null,
          rfmSegment: c?.rfmSegment || null,
          churnProbability: c?.churnProbability ?? null,
          predictedValue: c?.clvPredicted == null ? null : Number(c.clvPredicted),
          actualValue: Number(c?.totalSpent || 0),
          insufficientData: c?.clvPredicted == null,
        };
      })
      .sort((a, b) => (b.predictedValue ?? -1) - (a.predictedValue ?? -1)),
  };
};

module.exports = { ranking, detail };