/**
 * modules/replenishment/replenishment.suggest.js — Nạp dữ liệu và sinh đề xuất PO
 *
 * ============================================================================
 * VÌ SAO FILE NÀY TỒN TẠI: một hàm nạp dữ liệu DUY NHẤT
 * ============================================================================
 * Đề xuất (lúc CDC bắn) và kiểm tra lại (lúc người duyệt) PHẢI nạp dữ liệu
 * giống hệt nhau: cùng cửa sổ lịch sử, cùng cách lọc đơn hợp lệ, cùng cách lấy
 * lead time PO→GRN.
 *
 * Nếu hai nơi nạp khác nhau, chúng sẽ tự sinh ra "drift giả" — kiểu lỗi đã xảy
 * ra khi viết unit test: đề xuất có `quantity: 42` nhưng `planReplenishment`
 * tính ra `30`, chênh 29% > `QTY_DRIFT_TOL` ⇒ mọi đề xuất bị chặn ngay tại lúc
 * duyệt, dù dữ liệu thật không hề đổi. Với dữ liệu thật thì lỗi đó khó tái hiện
 * và khó chẩn đoán hơn nhiều.
 *
 * ⇒ `loadReplenishmentInput()` là điểm vào DUY NHẤT. Không được viết truy vấn
 * tồn kho / lịch sử bán ở module khác cho mục đích này.
 *
 * ============================================================================
 * Chống tạo đề xuất trùng
 * ============================================================================
 * Khoá `pg_advisory_xact_lock` bọc đúng bước "kiểm tra đề xuất PENDING → tạo",
 * và KHÔNG bọc phần tính toán (đọc 28 ngày lịch sử, nặng hơn nhiều). Transaction
 * nhờ vậy rất ngắn.
 *
 * Va chạm hash giữa hai tenant KHÔNG gây sai dữ liệu, chỉ gây chờ thêm một lát —
 * chấp nhận được, ghi nhận tại đây thay vì thêm bảng băm.
 */
const prisma = require("../../config/prisma");
const logger = require("../../utils/logger");
const { runWithTenant } = require("../../config/tenantContext");
const {
  planReplenishment,
  proposalFingerprint,
  calcOnOrder,
  OPEN_PO_STATUSES,
  NEED_REPLENISHMENT,
  STOCKOUT,
} = require("./replenishment.calc");
const {
  buildPoProposalGate,
  createGate,
  PO_PROPOSAL,
  poProposalKey,
} = require("../ai/agent.humangate");

/** Cửa sổ lịch sử — DÙNG CHUNG cho cả đề xuất và kiểm tra lại. */
const HISTORY_WINDOW_DAYS = 28;
/** Chỉ tính đơn đã hoàn tất; đơn huỷ/sáp huỷ không phải nhu cầu. */
const VALID_ORDER_STATUSES = ["COMPLETED"];
/** Chu kỳ rà soát — giả định shop nhỏ đặt hàng theo tuần. */
const REVIEW_PERIOD_DAYS = 7;

/**
 * Nạp đầy đủ số liệu cho một danh sách SKU.
 *
 * @returns {Map<string, object>} key = productId, value = input cho planReplenishment
 */
const loadReplenishmentInput = async (productIds = []) => {
  const ids = [...new Set((productIds || []).filter(Boolean))];
  if (!ids.length) return new Map();

  const since = new Date(Date.now() - HISTORY_WINDOW_DAYS * 86400000);

  const [orderItems, purchaseItems, inventories] = await Promise.all([
    prisma.orderItem.findMany({
      where: {
        productId: { in: ids },
        order: { createdAt: { gte: since }, status: { in: VALID_ORDER_STATUSES } },
      },
      select: { productId: true, quantity: true, order: { select: { createdAt: true } } },
    }),
    // PO còn mở (kể cả DRAFT do gate tạo) để tính onOrder + lấy lead time.
    prisma.purchaseItem.findMany({
      where: {
        productId: { in: ids },
        purchaseOrder: { status: { in: OPEN_PO_STATUSES }, date: { gte: since } },
      },
      select: {
        productId: true,
        quantity: true,
        purchaseOrder: {
          select: {
            id: true,
            status: true,
            date: true,
            receivedAt: true,
            // Hàng chỉ thực sự vào kho khi GRN ở trạng thái POSTED.
            grns: {
              where: { status: "POSTED" },
              select: { items: { select: { productId: true, receivedQty: true } } },
            },
          },
        },
      },
    }),
    prisma.inventory.findMany({
      where: { productId: { in: ids } },
      select: { productId: true, quantity: true, reserved: true },
    }),
  ]);

  const byProduct = new Map(ids.map((id) => [id, {
    dailySales: [], onOrderLines: [], inventories: [],
  }]));

  // Gom bán theo ngày.
  const dayMap = new Map();
  for (const oi of orderItems) {
    const key = `${oi.productId}|${new Date(oi.order.createdAt).toISOString().slice(0, 10)}`;
    dayMap.set(key, (dayMap.get(key) || 0) + Number(oi.quantity || 0));
  }
  for (const [key, qty] of dayMap) {
    const productId = key.split("|")[0];
    byProduct.get(productId)?.dailySales.push({ date: key.split("|")[1], qty, outOfStock: false });
  }

  // onOrder: quantity PO − đã nhận qua GRN POSTED.
  // Nhiều dòng PO cùng SKU có thể tồn tại → gom theo productId.
  const onOrderAcc = new Map();
  for (const pi of purchaseItems) {
    const po = pi.purchaseOrder;
    if (!po) continue;
    let received = 0;
    for (const grn of po.grns || []) {
      for (const gi of grn.items || []) {
        if (gi.productId === pi.productId) received += Number(gi.receivedQty || 0);
      }
    }
    const cur = onOrderAcc.get(pi.productId) || 0;
    onOrderAcc.set(pi.productId, cur + Math.max(0, Number(pi.quantity || 0) - received));
  }

  const invAcc = new Map();
  for (const inv of inventories) {
    const cur = invAcc.get(inv.productId) || [];
    cur.push({ quantity: inv.quantity, reserved: inv.reserved });
    invAcc.set(inv.productId, cur);
  }

  for (const id of ids) {
    const acc = byProduct.get(id);
    acc.onOrder = calcOnOrder({ lines: [{ quantity: onOrderAcc.get(id) || 0 }] });
    acc.inventories = invAcc.get(id) || [];
  }

  return byProduct;
};

/** Lead time PO→GRN đã POSTED, dùng cho `calcLeadTime`. */
const loadLeadTimeReceipts = async (productId) => {
  const rows = await prisma.purchaseItem.findMany({
    where: { productId, purchaseOrder: { grns: { some: { status: "POSTED" } } } },
    select: { purchaseOrder: { select: { date: true, receivedAt: true } } },
  });
  return rows.map((r) => r.purchaseOrder).filter((po) => po?.date && po?.receivedAt);
};

/**
 * Khoá advisory quanh bước "kiểm tra → tạo". Transaction chỉ chứa hai việc này.
 *
 * `hashtext` trả về int4; ta bỏ qua phần cao để tránh tràn khi ghép. Va chạm hash
 * giữa các tenant chỉ gây chờ, không gây sai — chấp nhận được.
 */
const withProposalLock = async (tenantId, proposalKey, fn) =>
  prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      `SELECT pg_advisory_xact_lock(hashtext($1))`,
      `${tenantId}::${proposalKey}`,
    );
    return fn(tx);
  }, { timeout: 10000 });

/** Lấy tập `proposalKey` của các đề xuất PENDING trong tenant hiện tại. */
const findOpenProposalKeys = async () => {
  const rows = await prisma.agentHumanGate.findMany({
    where: { actionType: PO_PROPOSAL, status: 'PENDING' },
    select: { actionPayload: true },
  });
  return rows.map((r) => r?.actionPayload?.proposalKey).filter(Boolean);
};

/**
 * `AgentSession.userId` là BẮT BUỘC trong schema, nên phiên sinh bởi CDC vẫn
 * cần một user thật. Ta dùng ADMIN đầu tiên của tenant — giống cách
 * `automation.service.getSystemUserId()` đang làm — và GHI RÕ điều này trong
 * `userMessage` để không ai hiểu nhầm là chủ shop đã tự yêu cầu.
 */
const resolveSystemUserId = async () => {
  const admin = await prisma.user.findFirst({
    where: { role: { in: ['ADMIN', 'MANAGER'] }, isActive: true },
    select: { id: true },
  });
  return admin?.id || null;
};

/**
 * Sinh đề xuất PO cho một SKU nếu thực sự cần nhập.
 *
 * @returns {object|null} `{ gate, plan }` khi tạo; `null` khi không cần;
 *   `{ needVendor: true, sku, plan }` khi thiếu NCC — để người xử lý chọn tay.
 */
const suggestForProduct = async ({
  tenantId,
  productId,
  packMultiple = 1,
  unitCost = null,
} = {}) => {
  // ── Nạp số liệu (NGOÀI khoá advisory: đọc nhiều, giữ transaction ngắn) ──
  const inputs = await loadReplenishmentInput([productId]);
  const input = inputs.get(productId);
  if (!input) return null;

  const receipts = await loadLeadTimeReceipts(productId);
  const product = await prisma.product.findFirst({
    where: { id: productId },
    select: { id: true, sku: true, name: true, isActive: true, costPrice: true },
  });
  if (!product || product.isActive === false) return null;

  // `Number(null)` là 0 và 0 cũng hữu hạn — nên phải loại null/rỗng TRƯỚC khi kiểm
  // tra, nếu không giá vốn sẽ mặc định thành 0 và tổng tiền đề xuất luôn bằng 0.
  const hasUnitCost = unitCost !== null && unitCost !== undefined && unitCost !== "" && Number.isFinite(Number(unitCost));
  const cost = hasUnitCost ? Number(unitCost) : Number(product.costPrice || 0);
  const plan = planReplenishment({
    dailySales: input.dailySales,
    inventories: input.inventories,
    receipts,
    unitCost: cost,
    packMultiple,
    reviewPeriodDays: REVIEW_PERIOD_DAYS,
    onOrder: input.onOrder,
  });

  if (plan.status === NEED_REPLENISHMENT || plan.status === STOCKOUT) {
    if (!plan.order.orderQty || plan.order.orderQty <= 0) {
      logger.debug(`[suggest] ${product.sku}: ${plan.status} nhưng orderQty = 0 → không sinh đề xuất`);
      return null;
    }
  } else {
    return null;
  }

  // ── NCC từ PO gần nhất còn hoạt động ──
  const lastPo = await prisma.purchaseItem.findFirst({
    where: { productId },
    orderBy: { purchaseOrder: { date: "desc" } },
    select: { purchaseOrder: { select: { vendorId: true, vendor: { select: { id: true, name: true, isActive: true } } } } },
  });
  const vendor = lastPo?.purchaseOrder?.vendor;
  if (!vendor || vendor.isActive === false) {
    // Không tự bịa NCC. Ghi rõ để người xử lý chọn tay.
    logger.info(`[suggest] ${product.sku}: cần nhập nhưng CHƯA CÓ NCC — bỏ qua, cần người chọn`);
    return { needVendor: true, sku: product.sku, plan };
  }

  const key = poProposalKey(productId, vendor.id);
  const fingerprint = proposalFingerprint({
    atp: plan.atp.atp,
    rop: plan.rationale.rop,
    unitCost: cost,
    orderQty: plan.order.orderQty,
    vendorId: vendor.id,
  });

  // ── Khoá advisory: kiểm tra đề xuất mở rồi mới tạo ──
  return withProposalLock(tenantId, key, async (tx) => {
    const openKeys = await findOpenProposalKeys();
    if (openKeys.includes(key)) {
      logger.debug(`[suggest] ${product.sku}: đã có đề xuất PENDING cho ${key} → bỏ qua`);
      return null;
    }

    const systemUserId = await resolveSystemUserId();
    if (!systemUserId) {
      logger.error(
        `[suggest] tenant ${tenantId} không có user ADMIN/MANAGER nào để tạo AgentSession — bỏ qua ${product.sku}`,
      );
      return null;
    }

    // Đề xuất có sẵn AgentSession (CDC không có phiên chat) với triggerSource
    // SYSTEM_EVENT — giá trị này ĐÃ có trong schema.
    const session = await tx.agentSession.create({
      data: {
        userId: systemUserId,
        tenantId,
        userMessage: `[TỰ ĐỘNG — CDC] Đề xuất nhập ${product.sku}: còn ${plan.atp.atp}, điểm đặt lại ${plan.rationale.rop}, đang đặt ${input.onOrder}`,
        intent: 'REPLENISHMENT_PROPOSAL',
        status: 'COMPLETED',
        triggerSource: 'SYSTEM_EVENT',
      },
    });

    const gate = await createGate(
      buildPoProposalGate({
        sessionId: session.id,
        productId,
        sku: product.sku,
        productName: product.name,
        vendorId: vendor.id,
        vendorName: vendor.name,
        quantity: plan.order.orderQty,
        unitCost: cost,
        totalEstimate: plan.order.totalEstimate,
        proposalKey: key,
        fingerprint,
        rationale: plan.rationale,
        // `planReplenishment` trả về `lead` (không phải `leadTime`); mock trong
        // unit test cũ từng dùng sai tên nên lỗi này chỉ lộ ra khi chạy thật.
        leadTimeDays: plan.lead.leadTimeDays,
        leadTimeEstimated: plan.lead.estimated,
      }),
      tx,
    );

    logger.info(
      `[suggest] đã tạo đề xuất ${gate.id} cho ${product.sku} (${plan.order.orderQty} từ ${vendor.name})`,
    );
    return { gate, plan };
  });
};

/**
 * Bọc `suggestForProduct` trong tenant context — dành cho cron/CDC chạy NGOÀI
 * request (nơi không có context nên Prisma extension không tiêm `tenantId`).
 */
const suggestForProductInTenant = (args) =>
  runWithTenant(args.tenantId, () => suggestForProduct(args));

module.exports = {
  HISTORY_WINDOW_DAYS,
  VALID_ORDER_STATUSES,
  REVIEW_PERIOD_DAYS,
  loadReplenishmentInput,
  loadLeadTimeReceipts,
  withProposalLock,
  suggestForProduct,
  suggestForProductInTenant,
  findOpenProposalKeys,
  resolveSystemUserId,
};