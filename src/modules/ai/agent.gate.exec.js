/**
 * modules/ai/agent.gate.exec.js — Thực thi đề xuất PO sau khi người duyệt bấm Duyệt
 *
 * ============================================================================
 * ĐẠI DIỆN LÀ "AT-MOST-ONCE CÓ PHÁT HIỆN", KHÔNG PHẢI GIAO DỊCH NGUYÊN TỬ.
 * ============================================================================
 * Nói thẳng để không quảng cáo sai:
 *
 *   Tạo PO và ghi `resultRef` KHÔNG nguyên tử (phương án A′). Có một khe hởng
 *   giữa `purchaseService.create()` trả về và lúc `resultRef` được ghi. Nếu
 *   tiến trình chết đúng khe đó, gate sẽ ở trạng thái
 *   `APPROVED + resultRef IS NULL` dù PO đã tồn tại.
 *
 *   Ta CHỐNG tạo PO trùng bằng cách ghi mốc `gateId` vào `PurchaseOrder.note`
 *   và tra cứu mốc đó TRƯỚC khi tạo — xem `findPoByGate()`.
 *
 *   Vì sao không bọc transaction: `withCodeRetry` (journal.service.js) thử
 *   `fn(code)` tối đa 5 lần, mà một unique violation trong Postgres sẽ ABORT cả
 *   transaction — lần thử 2 gặp lỗi `25P02` và `isUniqueConstraintError(25P02)`
 *   trả false ⇒ ném ngay. Retry bên trong transaction là bất khả thi về cấu trúc.
 *   Thêm nữa `auditService.log` và `workflowService.trigger` dùng prisma toàn cục
 *   nên sẽ ghi NGOÀI transaction và sống sót qua rollback.
 *   Bằng chứng đầy đủ: docs/aisc26/00b-gate-design.md §3.
 *
 *   Hệ quả phải nói với giám khảo: đây là at-most-once có phát hiện và thử lại có
 *   chủ đích, KHÔNG phải giao dịch nguyên tử.
 *
 * ============================================================================
 * Quy tắc bất di bất dịch
 * ============================================================================
 * 1. KHÔNG có đường tắt: bắt buộc gọi `purchase.service.create`. Không được
 *    `prisma.purchaseOrder.create` — nếu không sẽ mất audit log, workflow
 *    `PO_ABOVE`, `withCodeRetry` cho mã PO, và ràng buộc `vendorId` bắt buộc.
 * 2. `userId` truyền vào `create` là NGƯỜI DUYỆT, không phải "system".
 * 3. Re-validation luôn tính lại từ DB bằng đúng hàm trong
 *    `replenishment.calc.js`; KHÔNG tái tạo công thức ở đây.
 */
const prisma = require("../../config/prisma");
const logger = require("../../utils/logger");
const auditService = require("../audit/audit.service");
const purchaseService = require("../accounting/purchase.service");
const { PO_PROPOSAL } = require("./agent.humangate");
const {
  planReplenishment,
  evaluateProposalFreshness,
} = require("../replenishment/replenishment.calc");

/** Mốc ghi vào PurchaseOrder.note để tra ngược PO ← gate. */
const GATE_MARKER = (gateId) => `[gate:${gateId}]`;

/** Bọc mốc vào note, giữ phần note do người dùng nhập (nếu có). */
const buildNote = (gateId, note) =>
  [GATE_MARKER(gateId), note].filter(Boolean).join(' ').slice(0, 500);

/**
 * Tìm PO đã sinh ra từ gate này — gọi TRƯỚC khi tạo.
 *
 * Vì sao cần: nếu PO đã tạo xong nhưng ghi `resultRef` lỗi (hoặc tiến trình chết),
 * lần thử lại sẽ tạo PO thứ hai. Đây là chốt chặn quan trọng nhất của A′.
 *
 * Cách tra: `PurchaseOrder.note` chứa mốc `[gate:<gateId>]`. Cột này đã có sẵn,
 * nullable, không cần đổi schema. Đánh đổi đã biết: Postgres không có index trên
 * `note`, nên đây là seq scan trong phạm vi tenant. Chấp nhận được ở quy mô
 * demo/SME; nếu một tenant vượt ~10^4 PO thì cần thêm index (backlog B11).
 *
 * @returns {object|null} PO đã tồn tại, hoặc null
 */
const findPoByGate = async (gateId) =>
  prisma.purchaseOrder.findFirst({
    where: { note: { contains: GATE_MARKER(gateId) } },
    orderBy: { createdAt: 'desc' },
  });

/** Số ngày lịch sử dùng để tính lại nhu cầu — phải KHỚP với lúc lập đề xuất. */
const RECOMPUTE_WINDOW_DAYS = 28;

/**
 * Tính lại số hiện tại của SKU từ DB.
 *
 * Vì sao phải tính lại từ LỊCH SỬ THẬT, không lấy số trong payload: nếu tính
 * với `dailySales: []` thì ROP = 0, và mọi ATP > 0 đều bị coi là "không còn
 * cần đặt" ⇒ chặn nhầm mọi đề xuất. Đề xuất chỉ hợp lệ khi so sánh được với
 * chính bộ số liệu đã dùng để tạo ra nó.
 */
const recomputeCurrent = async (item, { windowDays = RECOMPUTE_WINDOW_DAYS } = {}) => {
  const since = new Date(Date.now() - windowDays * 86400000);

  const [orderItems, receipts] = await Promise.all([
    // Lịch sử bán theo ngày. `outOfStock` không có sẵn ở bảng OrderItem nên
    // không hiệu chỉnh censored ở đây — đề xuất gốc cũng phải ghi nhận điều này.
    prisma.orderItem.findMany({
      where: { productId: item.productId, order: { createdAt: { gte: since } } },
      select: { quantity: true, order: { select: { createdAt: true } } },
    }),
    prisma.purchaseItem.findMany({
      where: { productId: item.productId, purchaseOrder: { date: { gte: since } } },
      select: { purchaseOrder: { select: { date: true, receivedAt: true } } },
    }),
  ]);

  // Gom theo ngày để ra đúng định dạng dailySales của calc.js.
  const byDay = new Map();
  for (const oi of orderItems) {
    const key = new Date(oi.order.createdAt).toISOString().slice(0, 10);
    byDay.set(key, (byDay.get(key) || 0) + Number(oi.quantity || 0));
  }
  const dailySales = [...byDay.entries()].map(([date, qty]) => ({ date, qty, outOfStock: false }));

  const plan = planReplenishment({
    dailySales,
    inventories: await prisma.inventory.findMany({
      where: { productId: item.productId },
      select: { quantity: true, reserved: true },
    }),
    receipts: receipts
      .map((r) => r.purchaseOrder)
      .filter((po) => po?.date && po?.receivedAt),
    unitCost: item.unitCost,
    packMultiple: 1,
  });

  return {
    atp: plan.atp.atp,
    rop: plan.rationale.rop,
    orderQty: plan.order.orderQty,
    unitCost: item.unitCost,
    demandPerDay: plan.rationale.demandPerDay,
  };
};

/**
 * Kiểm tra lại đề xuất lúc duyệt.
 *
 * @param {object} gate
 * @param {boolean} acknowledgeDrift  người duyệt đã xem diff và xác nhận
 * @returns {{ok:true}|{ok:false, status:number, message:string, diff?:object}}
 */
const revalidate = async (gate, { acknowledgeDrift = false, recompute = recomputeCurrent } = {}) => {
  const payload = gate.actionPayload || {};
  const item = Array.isArray(payload.items) ? payload.items[0] : null;

  if (!item || !item.productId || !(Number(item.quantity) > 0)) {
    return { ok: false, status: 400, message: 'Đề xuất không hợp lệ: thiếu dòng hàng' };
  }
  if (!payload.vendorId) {
    return { ok: false, status: 400, message: 'Đề xuất không hợp lệ: thiếu NCC' };
  }

  const vendor = await prisma.vendor.findFirst({ where: { id: payload.vendorId }, select: { id: true, isActive: true } });
  if (!vendor) return { ok: false, status: 400, message: 'Nhà cung cấp không còn tồn tại' };
  if (vendor.isActive === false) {
    return { ok: false, status: 400, message: `Nhà cung cấp ${payload.vendorName || ''} đã ngừng hoạt động` };
  }

  const proposed = {
    atp: payload.rationale?.atp,
    rop: payload.rationale?.rop,
    orderQty: item.quantity,
    unitCost: item.unitCost,
  };
  const current = await recompute(item);
  const freshness = evaluateProposalFreshness({ proposed, current, acknowledgeDrift });

  if (freshness.status === 'NO_LONGER_NEEDED') {
    return { ok: false, status: 409, message: freshness.message, drift: freshness.status, diff: freshness.diff };
  }
  // DRIFT_BLOCK chỉ chặn khi CHƯA được người duyệt xác nhận. Sau khi xác nhận
  // (status vẫn là DRIFT_BLOCK nhưng `acknowledged: true`) thì đi tiếp — và số
  // dùng để tạo PO vẫn là số trong payload mà người duyệt đã nhìn thấy.
  if (freshness.status === 'DRIFT_BLOCK' && !freshness.acknowledged) {
    return { ok: false, status: 409, message: freshness.message, drift: freshness.status, diff: freshness.diff };
  }

  return { ok: true, freshness, current };
};

/**
 * Thực thi gate đề xuất PO đã được duyệt.
 *
 * KHÔNG tự gọi hàm này mà chưa đảo trạng thái gate sang APPROVED — route đã làm
 * việc đó bằng `updateMany` có điều kiện. Ở đây chỉ tạo PO + ghi `resultRef`.
 *
 * @param {string} gateId
 * @param {string} decidedById  người duyệt
 * @param {object} opts
 * @param {boolean} opts.acknowledgeDrift
 * @returns {Promise<{po:object, freshness:object, linked:boolean}>}
 */
const executeGate = async (gateId, decidedById, { acknowledgeDrift = false, recompute } = {}) => {
  const gate = await prisma.agentHumanGate.findFirst({ where: { id: gateId } });
  if (!gate) throw { status: 404, message: 'Human gate not found' };
  if (gate.actionType !== PO_PROPOSAL) {
    throw { status: 400, message: `Gate ${gate.actionType} không phải đề xuất PO` };
  }
  if (gate.status !== 'APPROVED') {
    throw { status: 400, message: `Gate phải ở trạng thái APPROVED mới thực thi được (đang: ${gate.status})` };
  }

  // ── Chống tạo PO trùng ────────────────────────────────────────────────
  if (gate.resultRef) {
    const existing = await prisma.purchaseOrder.findFirst({ where: { id: gate.resultRef } });
    if (existing) return { po: existing, linked: true };
  }
  const alreadyCreated = await findPoByGate(gateId);
  if (alreadyCreated) {
    logger.warn(`[gate-exec] gate ${gateId} da tao PO ${alreadyCreated.poCode} truoc do — lien ket lai, khong tao moi`);
    await prisma.agentHumanGate.update({ where: { id: gateId }, data: { resultRef: alreadyCreated.id } });
    return { po: alreadyCreated, linked: true };
  }

  const check = await revalidate(gate, { acknowledgeDrift, recompute });
  if (!check.ok) {
    throw { status: check.status, message: check.message, drift: check.drift, diff: check.diff };
  }

  const payload = gate.actionPayload || {};
  const item = payload.items[0];

  let po;
  try {
    po = await purchaseService.create(
      {
        vendorId: payload.vendorId,
        expectedAt: payload.expectedAt,
        note: buildNote(gateId, payload.note),
        items: [
          {
            productId: item.productId,
            quantity: item.quantity,
            unitCost: item.unitCost,
            taxRateId: item.taxRateId || null,
          },
        ],
      },
      decidedById,
    );
  } catch (e) {
    // Không nuốt: gate đã APPROVED nhưng resultRef vẫn null ⇒ UI hiện cảnh báo
    // đỏ và có nút thử lại. Audit để lần sau tra được.
    logger.error(`[gate-exec] gate ${gateId}: tao PO that bai: ${e.message}`);
    await auditService
      .log({
        userId: decidedById,
        action: 'AGENT_PO_GATE_EXECUTION_FAILED',
        entity: 'AgentHumanGate',
        entityId: gateId,
        after: { vendorId: payload.vendorId, productId: item.productId, quantity: item.quantity, error: e.message },
      })
      .catch((logErr) => logger.error(`[gate-exec] gate ${gateId}: khong ghi duoc audit loi: ${logErr.message}`));
    throw e;
  }

  await prisma.agentHumanGate.update({ where: { id: gateId }, data: { resultRef: po.id } });

  await auditService
    .log({
      userId: decidedById,
      action: 'AGENT_PO_GATE_EXECUTED',
      entity: 'AgentHumanGate',
      entityId: gateId,
      before: { resultRef: null },
      after: { resultRef: po.id, poCode: po.poCode, total: po.total, drift: check.freshness?.status },
    })
    .catch((logErr) => logger.error(`[gate-exec] gate ${gateId}: khong ghi duoc audit thanh cong: ${logErr.message}`));

  return { po, linked: false };
};

/**
 * Thử lại thực thi cho gate đã APPROVED nhưng `resultRef` vẫn null.
 *
 * Thao tác CỐ Ý, không tự động: PO là hành động tài chính. Chạy lại đầy đủ
 * re-validation vì dữ liệu đã cũ hơn lần đầu.
 */
const retryExecution = async (gateId, decidedById, opts = {}) => {
  const gate = await prisma.agentHumanGate.findFirst({
    where: { id: gateId, actionType: PO_PROPOSAL, status: 'APPROVED', resultRef: null },
  });
  if (!gate) {
    throw { status: 409, message: 'Gate không ở trạng thái "đã duyệt nhưng chưa tạo được PO"' };
  }
  return executeGate(gateId, decidedById, opts);
};

module.exports = {
  GATE_MARKER,
  buildNote,
  findPoByGate,
  revalidate,
  executeGate,
  retryExecution,
};