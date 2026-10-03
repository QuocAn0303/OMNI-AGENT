/**
 * scripts/backtest/lib/simulate.js — mô phỏng tồn kho đúng đặc tả S4 (§2.3).
 *
 * Đặc tả chốt, mỗi dòng dưới đây là một quy tắc của protocol:
 *   - Rà soát CUỐI NGÀY. Đơn đặt ngày `t` tới nơi CUỐI NGÀY `t+LT` ⇒ hàng chỉ
 *     dùng được cho ngày `t+LT+1`. Không có "nước đầu" riêng cho phương án nào.
 *   - Thiếu hàng = MẤT BÁN (không ghi nợ): `lost = demand − ATP`.
 *   - Mọi số lượng đặt và mọi tồn đều là số nguyên; phương án tự làm tròn trước.
 *   - NCC 100% tin cậy: không giao thiếu, không trễ, không huỷ.
 *   - Duyệt tức thì (độ trễ 0h), một kho / một cửa hàng / một kênh.
 *
 * `positionMode` là biến **diễn giải** protocol §2.1, không phải tham số tinh
 * chỉnh (D-P5-04): §2.1 ghi `ATP = tồn cuối ngày trước`, còn mã sản phẩm dùng
 * `ATP + onOrder` (`replenishment.calc.js:668`) để tránh đặt hai PO cho một lần
 * mua. Nếu chỉ so ATP thì mọi phương án đặt tối đa mỗi ngày trong suốt LT ngày
 * và phép so sánh trở nên vô nghĩa. Vì vậy chạy CẢ HAI và báo cả hai.
 */
const simulate = ({
  nDays,
  demand,
  policy,
  policyParams,
  leadTimeDays,
  initialAtp,
  costPerUnit,
  positionMode = "withOnOrder",
}) => {
  if (leadTimeDays < 1) throw new Error("Lead time phai >= 1 ngay");
  const useOnOrder = positionMode === "withOnOrder";

  const arrivals = new Float64Array(nDays + leadTimeDays + 2);
  let atp = Math.max(0, Math.ceil(initialAtp));
  let onOrder = 0;

  let sold = 0;
  let lostUnits = 0;
  let lostValue = 0;
  let receivedUnits = 0;
  let purchaseCost = 0;
  let orderCount = 0;
  let orderUnits = 0;
  let censoredDays = 0;
  const censored = new Array(nDays).fill(false);
  const daily = [];

  for (let t = 0; t < nDays; t += 1) {
    const arrived = t > 0 ? arrivals[t - 1] : 0;
    if (arrived > 0) {
      atp += arrived;
      onOrder -= arrived;
      receivedUnits += arrived;
      purchaseCost += arrived * costPerUnit;
    }
    if (onOrder < 0) onOrder = 0;

    const want = demand[t];
    const soldToday = Math.min(atp, want);
    atp -= soldToday;
    const lost = want - soldToday;
    sold += soldToday;
    lostUnits += lost;
    lostValue += lost * costPerUnit;

    const position = useOnOrder ? atp + onOrder : atp;
    const qty = Math.max(
      0,
      Math.ceil(
        policy.orderQty({
          atp,
          onOrder,
          position,
          leadTimeDays,
          params: policyParams,
        }),
      ),
    );
    if (qty > 0) {
      arrivals[t + leadTimeDays] += qty;
      onOrder += qty;
      orderCount += 1;
      orderUnits += qty;
    }

    const isCensored = atp <= 0;
    censored[t] = isCensored;
    if (isCensored) censoredDays += 1;

    daily.push({
      t,
      demand: want,
      sold: soldToday,
      lost,
      atpStart: atp + soldToday - arrived,
      atpEnd: atp,
      ordered: qty,
      censored: isCensored,
    });
  }

  const endAtp = Math.ceil(atp);
  const endValue = endAtp * costPerUnit;
  // Thí nghiệm 2 (protocol §13.2.3): giá trị tồn TRUNG BÌNH = TB của ATP × giá vốn
  // theo từng ngày. `endValue` chỉ là tồn dư CUỐI kỳ nên không dùng để so mức dịch vụ.
  const avgAtp = daily.reduce((a, d) => a + d.atpEnd, 0) / (nDays || 1);
  return {
    nDays,
    sold,
    lostUnits,
    lostValue,
    receivedUnits,
    purchaseCost,
    orderCount,
    orderUnits,
    censoredDays,
    censored,
    endAtp,
    endValue,
    avgAtp,
    avgValue: avgAtp * costPerUnit,
    totalCost: purchaseCost + endValue + lostValue,
    reviews: nDays,
    daily,
  };
};

/**
 * Chỉ số chính S5 (§5.1): (giá vốn hàng vừa nhập + giá trị tồn dư cuối kỳ +
 * giá trị mất bán) / Σ y_thực.  Đơn vị: tiền / đơn vị đã bán.
 */
const mainMetric = (sim) => {
  if (sim.sold <= 0) return null;
  return sim.totalCost / sim.sold;
};

module.exports = { simulate, mainMetric };
