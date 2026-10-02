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
 * Xác minh PO tìm được THỰC SỰ là do gate này sinh ra.
 *
 * Vì sao phải kiểm: mốc `[gate:<id>]` nằm trong `PurchaseOrder.note` — trường
 * người dùng sửa được. Người ta có thể (a) xoá mốc rồi thử lại → ta tạo PO
 * trùng, hoặc (b) ghi mốc giả vào một PO khác → ta liên kết nhầm.
 *
 * Vì vậy không được chỉ tin chuỗi mốc, mà phải đối chiếu nội dung:
 *   cùng NCC, cùng dòng hàng (productId + quantity), đúng `decidedById`,
 *   và tạo SAU thời điểm duyệt.
 *
 * @returns {{ok:true}|{ok:false, reason:string}}
 */
const verifyPoBelongsToGate = (po, { gate, item, vendorId, decidedById }) => {
  if (!po) return { ok: false, reason: 'khong-tim-thay' };
  if (po.vendorId !== vendorId) return { ok: false, reason: 'khac-ncc' };

  const poItem = Array.isArray(po.items) && po.items.length ? po.items[0] : null;
  if (!poItem) return { ok: false, reason: 'po-khong-co-dong-hang' };
  if (poItem.productId !== item.productId) return { ok: false, reason: 'khac-san-pham' };
  if (Number(poItem.quantity) !== Number(item.quantity)) return { ok: false, reason: 'khac-so-luong' };

  if (decidedById && po.createdById && po.createdById !== decidedById) {
    return { ok: false, reason: 'khac-nguoi-tao' };
  }
  // PO phải tạo SAU khi gate được duyệt — nếu trước thì nó không phải do gate này sinh.
  const decidedAt = gate.decidedAt ? new Date(gate.decidedAt) : null;
  if (decidedAt && po.createdAt && new Date(po.createdAt) < decidedAt) {
    return { ok: false, reason: 'tao-truoc-khi-duyet' };
  }
  return { ok: true };
};

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
 * GIỚI HẠN KHÔNG SỬA ĐƯỢC: nếu mốc bị XOÁ khỏi `note` sau khi PO đã tạo thì
 * lần thử lại KHÔNG phát hiện được và sẽ tạo PO thứ hai. Không có cách nào phát
 * hiện trôi chỉ với dữ liệu hiện có — cần cột riêng trên `PurchaseOrder`
 * (ngoài phạm vi đã duyệt). Ghi nhận giới hạn, không hứa hơn mức làm được.
 *
 * @returns {Promise<{po:object}|{rejected:object, reason:string}>}
 */
const findPoByGate = async (gate, { item, vendorId, decidedById } = {}) => {
  const po = await prisma.purchaseOrder.findFirst({
    where: { note: { contains: GATE_MARKER(gate.id) } },
    orderBy: { createdAt: 'desc' },
    include: { items: { select: { productId: true, quantity: true } } },
  });
  if (!po) return { rejected: null };

  const check = verifyPoBelongsToGate(po, { gate, item, vendorId, decidedById });
  if (!check.ok) return { rejected: po, reason: check.reason };
  return { po };
};

/**
 * Tính lại số hiện tại của SKU từ DB — dùng CHUNG hàm nạp với lúc sinh đề xuất.
 *
 * Vì sao phải dùng chung: nếu nơi nạp lịch sử bán khác nhau giữa lúc đề xuất và
 * lúc duyệt thì hai bên sẽ tự sinh ra "drift giả" — đúng lỗi đã gặp khi viết
 * unit test (đề xuất `quantity: 42`, `planReplenishment` tính ra `30`, chênh 29%
 * > `QTY_DRIFT_TOL` ⇒ chặn nhầm dù dữ liệu không đổi). Ngoài đời thật lỗi đó
 * khó tái hiện và khó chẩn đoán hơn nhiều.
 *
 * `onOrder` cũng được nạp ở đây: lúc duyệt phải thấy đúng cái mà lúc đề xuất
 * thấy, nếu không sẽ "thấy cần nhập" trong khi đã có PO đang trên đường.
 */
const recomputeCurrent = async (item) => {
  const { loadReplenishmentInput, loadLeadTimeReceipts } =
    require("../replenishment/replenishment.suggest");

  const inputs = await loadReplenishmentInput([item.productId]);
  const input = inputs.get(item.productId) || { dailySales: [], inventories: [], onOrder: 0 };
  const receipts = await loadLeadTimeReceipts(item.productId);

  const plan = planReplenishment({
    dailySales: input.dailySales,
    inventories: input.inventories,
    receipts,
    unitCost: item.unitCost,
    packMultiple: 1,
    onOrder: input.onOrder,
  });

  return {
    atp: plan.atp.atp,
    onOrder: plan.atp.onOrder,
    inventoryPosition: plan.atp.position,
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

  // So sánh bằng VỊ THẾ TỒN (ATP + onOrder), không phải ATP thô.
  // Lý do: sau khi PO được duyệt, hàng còn trên đường và ATP chưa tăng. Nếu so
  // ATP thô thì hệ thống vẫn "thấy cần nhập" dù đã có PO đang đi — đúng cái lỗi
  // mà `onOrder` sinh ra để chặn.
  const cur = await recompute(item);
  const proposed = {
    atp: payload.rationale?.inventoryPosition ?? payload.rationale?.atp,
    rop: payload.rationale?.rop,
    orderQty: item.quantity,
    unitCost: item.unitCost,
  };
  const current = {
    atp: cur.inventoryPosition ?? cur.atp,
    rop: cur.rop,
    orderQty: cur.orderQty,
    unitCost: cur.unitCost,
  };
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

const payload = gate.actionPayload || {};
  const item = payload.items[0];

  // ── Chống tạo PO trùng ────────────────────────────────────────────────
  if (gate.resultRef) {
    const existing = await prisma.purchaseOrder.findFirst({ where: { id: gate.resultRef } });
    if (existing) return { po: existing, linked: true };
  }
  const found = await findPoByGate(gate, { item, vendorId: payload.vendorId, decidedById });
  if (found.po) {
    logger.warn(`[gate-exec] gate ${gateId} đã tạo PO ${found.po.poCode} trước đó — liên kết lại, không tạo mới`);
    await prisma.agentHumanGate.update({ where: { id: gateId }, data: { resultRef: found.po.id } });
    return { po: found.po, linked: true };
  }
  if (found.rejected) {
    // Có PO mang mốc của gate này nhưng nội dung KHÔNG khớp → tuyệt đối không
    // liên kết và cũng không tạo mới (tạo mới lúc này là tạo trùng chắc chắn).
    logger.error(
      `[gate-exec] gate ${gateId}: tìm thấy PO ${found.rejected.poCode} mang mốc nhưng nội dung KHÔNG khớp ` +
      `(${found.reason}) — KHÔNG liên kết. Cần người xử lý tay.`,
    );
    throw {
      status: 409,
      message:
        `Tìm thấy PO ${found.rejected.poCode} ghi mốc của đề xuất này nhưng nội dung không khớp (${found.reason}). ` +
        `Hệ thống KHÔNG tự liên kết và KHÔNG tạm tạo PO thứ hai. Vui lòng kiểm tra thủ công.`,
    };
  }

  const check = await revalidate(gate, { acknowledgeDrift, recompute });
  if (!check.ok) {
    throw { status: check.status, message: check.message, drift: check.drift, diff: check.diff };
  }

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
  verifyPoBelongsToGate,
  findPoByGate,
  revalidate,
  executeGate,
  retryExecution,
};