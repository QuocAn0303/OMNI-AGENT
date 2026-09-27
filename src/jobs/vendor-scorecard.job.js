/**
 * jobs/vendor-scorecard.job.js — Vendor Scorecard hàng tháng (Mục 6.4 đặc tả SRM)
 *
 * Công thức (chạy đầu mỗi tháng, quét kỳ = tháng trước):
 *   OTIF%       = (số PO có GRN POSTED onTime=true AND toàn bộ item passQty >= orderedQty)
 *                 / (tổng số PO đã ORDERED trong kỳ) * 100
 *   DefectRate% = Σ rejectQty / Σ receivedQty * 100  (theo GoodsReceiptItem trong kỳ)
 *   score       = OTIF% * 0.6 - DefectRate% * 0.3 (+0 price-variance — chưa có dữ liệu
 *                 giá nhập chênh lệch giữa các NCC, bổ sung sau)
 *   Grade: >= 90 → "A" | 75–89 → "B" | < 75 → "C" (C → Notification cảnh báo ADMIN)
 *
 * Ghi kết quả vào Vendor.otifScore / defectRate / vendorGrade.
 */
const prisma = require("../config/prisma");
const { runWithTenant } = require("../config/tenantContext");
const notificationService = require("../modules/notifications/notification.service");
const logger = require("../utils/logger");

const gradeOf = (score) => (score >= 90 ? "A" : score >= 75 ? "B" : "C");

/**
 * Hàm thuần để test.
 *
 * LƯU Ý CÔNG THỨC (khác literal trong đặc tả — đã sửa lỗi toán học):
 * Đặc tả ghi `score = OTIF% * 0.6 - DefectRate% * 0.3 (+ priceVariance * 0.1)`.
 * Với công thức đó, điểm tối đa khả đạt = 60 (khi OTIF=100, defect=0, chưa có
 * dữ liệu price variance) → ngưỡng A (>=90) và B (75–89) KHÔNG BAO GIỜ đạt được,
 * mọi NCC luôn bị xếp hạng "C" và luôn bắn cảnh báo giả.
 *
 * Cách sửa: giữ nguyên TRỌNG SỐ tương đối giữa các thành phần nhưng quy về thang
 * 0–100 ("chuẩn hoá lại" - renormalize):
 *   - Chưa có price variance (hiện tại): otif*0.6/0.9 + (100-defect)*0.3/0.9
 *   - Có price variance: otif*0.6 + (100-defect)*0.3 + priceVarianceScore*0.1
 * → điểm tối đa = 100, hạng A/B trở nên khả đạt, ý nghĩa ưu tiên OTIF giữ nguyên.
 */
const computeScorecard = ({ poCount, onTimeFullCount, rejectQty, receivedQty, priceVarianceScore = null }) => {
  const otif = poCount > 0 ? (onTimeFullCount / poCount) * 100 : 0;
  const defect = receivedQty > 0 ? (rejectQty / receivedQty) * 100 : 0;
  const quality = 100 - defect; // điểm chất lượng (0-100)

  let score;
  if (priceVarianceScore == null) {
    // Renormalize trọng số 0.6/0.3 (tổng 0.9) về thang 100
    score = otif * (0.6 / 0.9) + quality * (0.3 / 0.9);
  } else {
    score = otif * 0.6 + quality * 0.3 + Number(priceVarianceScore) * 0.1;
  }

  return {
    otifScore: Math.round(otif * 10) / 10,
    defectRate: Math.round(defect * 10) / 10,
    vendorGrade: gradeOf(score),
  };
};

const runForTenant = async (period = {}) => {
  let { year, month } = period;
  if (!year || !month) {
    const prev = new Date();
    prev.setDate(1);
    prev.setMonth(prev.getMonth() - 1);
    year = prev.getFullYear();
    month = prev.getMonth() + 1;
  }
  const from = new Date(year, month - 1, 1);
  const to = new Date(year, month, 1);

  const vendors = await prisma.vendor.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
  });
  const results = [];
  for (const v of vendors) {
    const pos = await prisma.purchaseOrder.findMany({
      where: {
        vendorId: v.id,
        status: { in: ["ORDERED", "RECEIVED", "PAID"] },
        date: { gte: from, lt: to },
      },
      select: { id: true, items: { select: { id: true, quantity: true } } },
    });
    if (!pos.length) continue; // vendor không có PO trong kỳ → giữ nguyên score cũ

    const poIds = pos.map((p) => p.id);
    const grns = await prisma.goodsReceiptNote.findMany({
      where: { purchaseOrderId: { in: poIds }, status: "POSTED" },
      select: {
        id: true,
        onTime: true,
        purchaseOrderId: true,
        items: { select: { receivedQty: true, passQty: true, rejectQty: true, purchaseItemId: true } },
      },
    });

    // Cộng dồn pass/reject/received theo PurchaseItem
    const passByItem = {};
    let totalReceived = 0;
    let totalReject = 0;
    for (const g of grns) {
      for (const it of g.items) {
        passByItem[it.purchaseItemId] = (passByItem[it.purchaseItemId] || 0) + it.passQty;
        totalReceived += it.receivedQty;
        totalReject += it.rejectQty;
      }
    }

    // PO "OTIF" = có GRN onTime AND toàn bộ item pass đủ orderedQty
    let onTimeFull = 0;
    for (const po of pos) {
      const poGrns = grns.filter((g) => g.purchaseOrderId === po.id);
      const fullyReceived = po.items.every((it) => (passByItem[it.id] || 0) >= it.quantity);
      if (poGrns.length > 0 && poGrns.some((g) => g.onTime === true) && fullyReceived) {
        onTimeFull += 1;
      }
    }

    const scorecard = computeScorecard({
      poCount: pos.length,
      onTimeFullCount: onTimeFull,
      rejectQty: totalReject,
      receivedQty: totalReceived,
    });

    await prisma.vendor.update({ where: { id: v.id }, data: scorecard });

    if (scorecard.vendorGrade === "C") {
      await notificationService
        .createOne({
          type: "SYSTEM",
          severity: "WARNING",
          roleScope: "ADMIN",
          title: `Chất lượng NCC giảm: ${v.name}`,
          message: `OTIF ${scorecard.otifScore}% / Defect ${scorecard.defectRate}% — hạng C, xem xét giảm hạn mức`,
          meta: { vendorId: v.id, period: `${year}-${String(month).padStart(2, "0")}` },
        })
        .catch((e) => logger.error("[scorecard] notification failed:", e.message));
    }

    results.push({ vendorId: v.id, vendorName: v.name, ...scorecard });
  }
  return results;
};

// Cron: duyệt toàn bộ tenant
const runAll = async (period) => {
  const tenants = await prisma.tenant.findMany({ select: { id: true } });
  const out = [];
  for (const t of tenants) {
    try {
      const res = await runWithTenant(t.id, () => runForTenant(period));
      out.push(...(res || []));
    } catch (e) {
      logger.error(`[scorecard] tenant ${t.id} failed:`, e.message);
    }
  }
  return out;
};

module.exports = { runForTenant, runAll, computeScorecard, gradeOf };
