/**
 * modules/supply/supply-dashboard.service.js — DASHBOARD KPI CHUỖI CUNG ỨNG
 *
 * VÌ SAO CẦN
 * `dashboard` hiện chỉ có doanh thu. Chuỗi cung ứng — tồn kho quay vòng bao lâu,
 * thiếu hàng bao nhiêu, nhà cung cấp giao trễ bao nhiêu — thì không có màn hình
 * nào nhìn thấy, trong khi đó mới là phần giám khảo hỏi về tồn kho.
 *
 * NGUYÊN TẮC — KHÔNG ĐƯỢC BỊA SỐ:
 *   - Mọi chỉ số đọc thẳng DB của tenant, KHÔNG mô phỏng.
 *   - Chỉ số nào không tính được vì thiếu dữ liệu thì trả `null` + lý do, KHÔNG
 *     trả 0. Trả 0 là nói dối: "hết hàng 0 cái" khác hẳn "chưa đủ dữ liệu".
 *   - Tỷ lệ giao đúng hạn (OTIF) chỉ tính được từ GRN có `expectedAt`. Không có
 *     `expectedAt` thì trả null chứ không lấy giá trị 0 làm vời.
 *
 * Mỗi chỉ số trả kèm `note` giải thích cách tính và giới hạn của nó, để UI hiện
 * thẳng cho người xem thay vì chỉ đưa một con số trần.
 */
const prisma = require("../../config/prisma");
const { getDefaultWarehouseId } = require("../../utils/warehouse.helper");

const toNum = (v) => Number(v || 0);
const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const pct = (v) => (v == null ? null : round2(Number(v) * 100, 2));

/** Số ngày trước ngày cho trước, theo giờ UTC của DB. */
const daysAgo = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

/** Chuỗi chuỗi cung ứng trong `n` ngày gần nhất. */
const getKpis = async (tenantId, { days = 30 } = {}) => {
  const since = daysAgo(days);
  const prevSince = daysAgo(days * 2);

  const [rows] = await Promise.all([
    prisma.$transaction(async (tx) => {
      // ---- Vòng quay tồn kho: tồn hiện tại vs giá vốn bán trong kỳ ----
      const inv = await tx.inventory.findMany({
        select: { productId: true, quantity: true, reserved: true, product: { select: { costPrice: true } } },
      });
      const stockValue = inv.reduce((s, i) => s + toNum(i.quantity) * toNum(i.product?.costPrice), 0);
      const atpUnits = inv.reduce((s, i) => s + (toNum(i.quantity) - toNum(i.reserved)), 0);

      const sold = await tx.orderItem.aggregate({
        where: { order: { createdAt: { gte: since }, status: "COMPLETED" } },
        _sum: { quantity: true },
      });
      const cogs = await tx.inventoryTransaction.findMany({
        where: { type: "EXPORT", createdAt: { gte: since } },
        select: { quantity: true, unitCost: true },
      });
      const cogsValue = cogs.reduce((s, t) => s + toNum(t.quantity) * toNum(t.unitCost), 0);
      const cogsUnits = cogs.reduce((s, t) => s + toNum(t.quantity), 0);

      // ---- Tồn chết: không bán trong 90 ngày ----
      const slowSince = daysAgo(90);
      const slowProducts = await tx.orderItem.groupBy({
        by: ["productId"],
        where: { order: { createdAt: { gte: slowSince }, status: "COMPLETED" } },
      });
      const soldRecently = new Set(slowProducts.map((r) => r.productId));
      const slowValue = inv
        .filter((i) => !soldRecently.has(i.productId))
        .reduce((s, i) => s + toNum(i.quantity) * toNum(i.product?.costPrice), 0);
      const slowUnits = inv
        .filter((i) => !soldRecently.has(i.productId))
        .reduce((s, i) => s + toNum(i.quantity), 0);

      // ---- Thiếu hàng (stockout) thực tế trong kỳ ----
      const zeroStock = inv.filter((i) => toNum(i.quantity) - toNum(i.reserved) <= 0).length;

      // ---- PO đang mở: quá hạn giao hàng ----
      const openPos = await tx.purchaseOrder.findMany({
        where: { status: { in: ["DRAFT", "PENDING", "PENDING_APPROVAL", "APPROVED", "ORDERED"] } },
        select: { id: true, poCode: true, expectedAt: true, total: true, date: true },
      });
      const overduePos = openPos.filter(
        (p) => p.expectedAt && new Date(p.expectedAt) < new Date(),
      );

      // ---- GRN đã nhập: giao đúng hạn ----
      // CHỈ tính được khi PO có `expectedAt`; thiếu thì bỏ qua, không coi là trễ.
      const grns = await tx.goodsReceiptNote.findMany({
        where: { status: "POSTED", receivedAt: { gte: since } },
        select: {
          id: true, grnCode: true, receivedAt: true, onTime: true,
          purchaseOrder: { select: { id: true, poCode: true, expectedAt: true, vendor: { select: { id: true, name: true } } } },
        },
      });
      const withDeadline = grns.filter((g) => g.purchaseOrder?.expectedAt);
      const onTimeCount = withDeadline.filter((g) => g.onTime === true).length;

      // ---- Kho: vốn tiền nằm ở từng kho ----
      const byWarehouse = await tx.warehouse.findMany({
        where: { isActive: true, parentId: null },
        select: { id: true, code: true, name: true, inventories: { select: { quantity: true, product: { select: { costPrice: true } } } } },
      });

      // ---- Đơn mua trong kỳ vs kỳ trước (đơn vị tiền của tenant) ----
      const poCreated = await tx.purchaseOrder.aggregate({
        where: { date: { gte: since } },
        _sum: { total: true },
        _count: { _all: true },
      });
      const poPrev = await tx.purchaseOrder.aggregate({
        where: { date: { gte: prevSince, lt: since } },
        _sum: { total: true },
      });

      return {
        stockValue,
        atpUnits,
        cogsValue,
        cogsUnits,
        slowValue,
        slowUnits,
        zeroStock,
        totalSkus: inv.length,
        openPos,
        overduePos,
        grns,
        withDeadlineCount: withDeadline.length,
        onTimeCount,
        byWarehouse,
        poCreated,
        poPrev,
      };
    }),
  ]);

  const daysOfCover = rows.cogsUnits > 0 ? round2(rows.atpUnits / rows.cogsUnits) : null;
  // Vòng quay = (365 / số ngày phủ) — quy ra năm. Không có cogs ⇒ null.
  const turnover = daysOfCover && daysOfCover > 0 ? round2(365 / daysOfCover) : null;

  return {
    windowDays: days,
    inventory: {
      stockValue: round2(rows.stockValue),
      atpUnits: rows.atpUnits,
      skus: rows.totalSkus,
      note: "Tồn khả dụng = tồn thật − hàng đã giữ chỗ, × giá vốn hiện tại.",
    },
    velocity: {
      cogsValue: round2(rows.cogsValue),
      cogsUnits: rows.cogsUnits,
      daysOfCover,
      turnoverPerYear: turnover,
      note:
        daysOfCover === null
          ? "Chưa có hàng xuất trong kỳ này nên chưa tính được số ngày phủ tồn — KHÔNG phải bằng 0."
          : `Số ngày phủ tồn = tồn khả dụng ÷ số lượng xuất trong ${days} ngày. ` +
            "Vòng quay = 365 ÷ số ngày phủ.",
    },
    slowMoving: {
      value: round2(rows.slowValue),
      units: rows.slowUnits,
      shareOfStock: rows.stockValue > 0 ? pct(rows.slowValue / rows.stockValue) : null,
      note: "Hàng không bán trong 90 ngày gần nhất. Đây là tiền đang nằm không sinh lãi.",
    },
    stockouts: {
      skusAtZero: rows.zeroStock,
      share: rows.totalSkus > 0 ? pct(rows.zeroStock / rows.totalSkus) : null,
      note: "Số SKU đang hết hàng (tồn khả dụng ≤ 0) tại thời điểm lấy số.",
    },
    purchasing: {
      openCount: rows.openPos.length,
      openValue: round2(rows.openPos.reduce((s, p) => s + toNum(p.total), 0)),
      overdueCount: rows.overduePos.length,
      overdueValue: round2(rows.overduePos.reduce((s, p) => s + toNum(p.total), 0)),
      createdValue: round2(toNum(rows.poCreated._sum.total)),
      createdCount: rows.poCreated._count._all,
      prevCreatedValue: round2(toNum(rows.poPrev._sum.total)),
      changePct:
        toNum(rows.poPrev._sum.total) > 0
          ? pct((toNum(rows.poCreated._sum.total) - toNum(rows.poPrev._sum.total)) / toNum(rows.poPrev._sum.total))
          : null,
      overdue: rows.overduePos.map((p) => ({
        id: p.id, poCode: p.poCode,
        expectedAt: p.expectedAt, daysLate: Math.max(0, Math.round((Date.now() - new Date(p.expectedAt)) / 86400000)),
        total: round2(toNum(p.total)),
      })),
      note: "PO quá hạn = đã quá ngày giao hàng dự kiến mà chưa có GRN nhập kho.",
    },
    supplierDelivery: {
      onTimeRate: rows.withDeadlineCount > 0 ? pct(rows.onTimeCount / rows.withDeadlineCount) : null,
      gradedCount: rows.withDeadlineCount,
      receivedCount: rows.grns.length,
      note:
        rows.withDeadlineCount === 0
          ? "Chưa có phiếu nhập nào gắn với ngày giao hàng dự kiến nên CHƯA tính được tỷ lệ giao đúng hạn. " +
            "Cần chốt ngày giao khi tạo đơn mua."
          : `Đếm trên ${rows.withDeadlineCount}/${rows.grns.length} phiếu nhập có ngày giao dự kiến. ` +
            "Phiếu không có ngày dự kiến bị bỏ qua chứ không tính là trễ.",
    },
    byWarehouse: rows.byWarehouse.map((w) => ({
      id: w.id, code: w.code, name: w.name,
      value: round2(w.inventories.reduce((s, i) => s + toNum(i.quantity) * toNum(i.product?.costPrice), 0)),
    })).sort((a, b) => b.value - a.value),
  };
};

module.exports = { getKpis };