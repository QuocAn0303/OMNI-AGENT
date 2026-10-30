/**
 * modules/replenishment/replenishment.routes.js — Xem và tạo đề xuất nhập hàng (ROP)
 *
 * ============================================================================
 * VÌ SAO FILE NÀY TỒN TẠI
 * ============================================================================
 * Trước đây module `replenishment` (đã có 54 unit test + backtest + human-gate)
 * KHÔNG có route HTTP nào: nó chỉ chạy được qua CDC `LOW_STOCK` và qua cron
 * `checkAutoReorder`. Hệ quả: màn hình duy nhất người dùng mở được là
 * "Trợ lý KD" — và nó dùng công thức RIÊNG (`(safetyStock*2 - qty) * 1.2`) với
 * ngưỡng `10` hard-code, khác hẳn `planReplenishment`.
 *
 * Nghĩa là thứ khách thấy không phải thứ đã nghiên cứu và đánh giá. File này
 * đóng lỗ đó: mọi con số trả về đều đi qua `planReplenishment` — HÀM DUY NHẤT
 * được phép tính ROP. LLM không được chạm vào số (xem `01-llm-role.md` §2).
 *
 * Endpoint:
 * - GET  /suggestions            — danh sách SKU dưới ROP, CÓ kèm số đề xuất (read-only)
 * - GET  /products/:id/preview   — xem trước một SKU (read-only)
 * - POST /products/:id/propose   — TẠO đề xuất thật (ghi AgentHumanGate PENDING)
 * - POST /proposals/:gateId/explain — LLM diễn giải + soạn tin NCC + báo cáo
 *   hàng rào `assertNumbersUnchanged` (thêm 2026-10-14; đây là endpoint ĐẦU TIÊN
 *   đưa `proposal-explain.llm.js` vào sản phẩm — trước đó chỉ script gọi được)
 *
 * Read-only không ghi bảng nào: `previewForProduct` chỉ đọc, nhờ vậy màn hình xem
 * trước không tạo rác và không sinh đề xuất trùng.
 */

const express = require("express");
const prisma = require("../../config/prisma");
const { authenticate, authorize } = require("../../middleware/auth.middleware");
const { requireModule } = require("../../middleware/plan.middleware");
const { success, error } = require("../../utils/response");
const { runWithTenant } = require("../../config/tenantContext");
const {
  previewForProduct,
  suggestForProduct,
} = require("./replenishment.suggest");
const { NEED_REPLENISHMENT, STOCKOUT, OK } = require("./replenishment.calc");
const { explainProposalForGate } = require("./proposal-explain.service");

/**
 * @swagger
 * /api/replenishment/suggestions:
 *   get:
 *     summary: Danh sách SKU dưới điểm đặt lại (ROP) kèm số lượng đề xuất nhập
 *     description: >
 *       Read-only. Mọi số đề xuất do `planReplenishment` tính — cùng hàm dùng khi
 *       tạo đề xuất thật, nên số xem trước và số ghi vào gate là một. LLM không
 *       tham gia tính toán.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 50, maximum: 200 }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [NEED_REPLENISHMENT, STOCKOUT, OK] }
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     items: { type: array, items: { type: object } }
 *                     scannedSkus: { type: integer }
 *                     note: { type: string }
 *
 * /api/replenishment/products/{id}/preview:
 *   get:
 *     summary: Xem trước đề xuất nhập cho một SKU (không ghi dữ liệu)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: OK }
 *       404: { description: Không tìm thấy sản phẩm hoặc thiếu dữ liệu tồn kho }
 *
 * /api/replenishment/products/{id}/propose:
 *   post:
 *     summary: Tạo đề xuất nhập thật (AgentHumanGate PENDING — phải người duyệt)
 *     description: >
 *       Ghi 1 AgentHumanGate + 1 AgentSession. Trả 409 nếu đã có đề xuất PENDING
 *       cho cùng SKU. Không tự tạo PO — việc ghi PO chỉ chạy sau khi người duyệt.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       201: { description: Đã tạo đề xuất }
 *       200: { description: SKU không cần nhập }
 *       409: { description: Đã có đề xuất đang chờ duyệt, hoặc thiếu nhà cung cấp }
 */
const router = express.Router();

// `authenticate` PHẢI đứng trước `requireModule`: requireModule đọc
// `req.user.tenantId` để biết gói nào, không có token thì không có tenant ⇒
// fail-open (paywall không chặn được). Xem `docs/aisc26/00-scope.md` §7 B1.
router.use(authenticate, requireModule("replenishment"));

const parseLimit = (raw, def = 50, max = 200) => {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.min(n, max);
};

/** Bọc `fn` trong tenant context — `previewForProduct` gọi Prisma ngoài request. */
const inTenant = (tenantId, fn) => runWithTenant(tenantId, fn);

router.get(
  "/suggestions",
  authorize("ADMIN", "MANAGER", "WAREHOUSE", "ACCOUNTANT"),
  async (req, res, next) => {
    try {
      const limit = parseLimit(req.query.limit);
      const statusFilter = req.query.status ? String(req.query.status).toUpperCase() : null;
      const VALID = [NEED_REPLENISHMENT, STOCKOUT, OK];
      if (statusFilter && !VALID.includes(statusFilter)) {
        return error(res, `status không hợp lệ. Chỉ nhận: ${VALID.join(", ")}`, 400);
      }
      // Mặc định CHỈ trả SKU cần hành động. Trả cả `OK` sẽ ngập màn hình bằng
      // hàng còn dồn — vẫn xem được bằng `?status=OK` khi cần soi toàn bộ.
      const wantOnly = statusFilter ? [statusFilter] : [NEED_REPLENISHMENT, STOCKOUT];

      const products = await prisma.product.findMany({
        where: { isActive: true },
        select: { id: true },
        orderBy: { name: "asc" },
      });

      // Một lần nạp lịch sử cho TẤT CẢ SKU thay vì gọi lặp từng SKU — cùng ý nghĩa
      // với `loadReplenishmentInput` nên số vẫn khớp đường ghi.
      const rows = await inTenant(req.user.tenantId, async () => {
        const out = [];
        for (const p of products.slice(0, limit * 3)) {
          // eslint-disable-next-line no-await-in-loop
          const preview = await previewForProduct({ productId: p.id });
          if (!preview) continue;
          if (statusFilter && preview.plan.status !== statusFilter) continue;
          if (!wantOnly.includes(preview.plan.status)) continue;
          // ROP = 0 (chưa có nhu cầu) ⇒ orderQty = 0 ⇒ không có gì để đề xuất.
          if (!(preview.plan.order.orderQty > 0)) continue;
          out.push(preview);
          if (out.length >= limit) break;
        }
        return out;
      });

      const items = rows.map(({ product, plan, vendor, needVendor }) => ({
        productId: product.id,
        sku: product.sku,
        productName: product.name,
        unit: product.unit,
        status: plan.status,
        atp: plan.atp.atp,
        onOrder: plan.atp.onOrder,
        inventoryPosition: plan.atp.position,
        rop: plan.rop.rop,
        safetyStock: plan.safety.safetyStock,
        demandPerDay: plan.demand.demandPerDay,
        demandMethod: plan.demand.method,
        demandConfidence: plan.demand.confidence,
        leadTimeDays: plan.lead.leadTimeDays,
        leadTimeEstimated: plan.lead.estimated,
        daysOfCover: plan.daysOfCover ?? null,
        orderQty: plan.order.orderQty,
        unitCost: plan.rationale.unitCost,
        missingCost: plan.missingCost,
        totalEstimate: plan.order.totalEstimate,
        vendorId: vendor?.id || null,
        vendorName: vendor?.name || null,
        needVendor,
        rationale: plan.rationale,
      }));

      success(res, {
        items,
        scannedSkus: products.length,
        note:
          "Mọi số do công thức ROP tính (serviceLevel, lead time, an toàn). LLM không tính số nào.",
      });
    } catch (e) {
      next(e);
    }
  },
);

router.get(
  "/products/:id/preview",
  authorize("ADMIN", "MANAGER", "WAREHOUSE", "ACCOUNTANT", "CASHIER"),
  async (req, res, next) => {
    try {
      const preview = await inTenant(req.user.tenantId, () =>
        previewForProduct({ productId: req.params.id }),
      );
      if (!preview) return error(res, "Không tìm thấy sản phẩm hoặc thiếu dữ liệu tồn kho", 404);

      const { product, plan, vendor, needVendor } = preview;
      success(res, {
        productId: product.id,
        sku: product.sku,
        productName: product.name,
        unit: product.unit,
        status: plan.status,
        vendor: vendor ? { id: vendor.id, name: vendor.name } : null,
        needVendor,
        plan,
      });
    } catch (e) {
      next(e);
    }
  },
);

router.post(
  "/products/:id/propose",
  authorize("ADMIN", "MANAGER"),
  async (req, res, next) => {
    try {
      const result = await inTenant(req.user.tenantId, () =>
        suggestForProduct({ tenantId: req.user.tenantId, productId: req.params.id }),
      );

      if (result === null) {
        return error(res, "SKU này chưa cần nhập (vị thế tồn còn trên điểm đặt lại)", 400);
      }
      if (result.needVendor) {
        return error(
          res,
          `SKU ${result.sku} cần nhập nhưng chưa có nhà cung cấp — cần người chọn, hệ thống không tự bịa`,
          409,
        );
      }
      success(res, {
        gateId: result.gate.id,
        status: result.gate.status,
        sku: result.gate.actionPayload?.sku,
        quantity: result.gate.actionPayload?.quantity,
      });
    } catch (e) {
      next(e);
    }
  },
);

/**
 * @swagger
 * /api/replenishment/proposals/{gateId}/explain:
 *   post:
 *     summary: LLM diễn giải đề xuất + soạn tin nhắn NCC, kèm trạng thái hàng rào số
 *     description: >
 *       Trả về hai văn bản cho một thẻ duyệt đề xuất nhập hàng: lời giải thích
 *       cho chủ shop và tin nhắn đặt hàng gửi nhà cung cấp — cùng trạng thái
 *       hàng rào `assertNumbersUnchanged`.
 *
 *       **Số trong văn bản không phải do LLM tính.** Khối số đưa vào LLM lấy từ
 *       `AgentHumanGate.actionPayload` — tức số do `planReplenishment` đã tính ở
 *       Bước A. Sau khi LLM trả lời, `assertNumbersUnchanged()` quét MỌI con số
 *       trong văn bản và so với khối số đó; số nào lạ là LLM tự thêm và văn bản
 *       bị loại bỏ, hệ thống dùng bản mẫu.
 *
 *       **Tin nhắn NCC KHÔNG được gửi.** Không có hàm gửi nào trong đường này;
 *       `vendorMessageSent` luôn là `false` và `requiresHumanSend` luôn là `true`.
 *       Người dùng tự sao chép rồi gửi qua Zalo/SMS/email.
 *
 *       `simulateTamper=true` là chế độ BIỂU DIỄN: cố tình đổi số lượng đề xuất
 *       rồi đưa qua hàng rào thật để chứng minh nó bắt được. Không gọi mạng.
 *     tags: [Replenishment]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: gateId
 *         required: true
 *         schema: { type: string, format: uuid }
 *         description: id của AgentHumanGate loại PURCHASE_ORDER_PROPOSAL
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               quantity:
 *                 type: integer
 *                 minimum: 1
 *                 maximum: 2147483647
 *                 description: Số lượng do người dùng chọn cho tin nhắn NCC; không sửa số gợi ý của công thức
 *               simulateTamper:
 *                 type: boolean
 *                 default: false
 *                 description: Chế độ biểu diễn hàng rào số (không gọi mạng)
 *               mode:
 *                 type: string
 *                 enum: [auto, template]
 *                 default: auto
 *                 description: "auto = dùng LLM nếu chế độ cho phép, không thì dùng mẫu; template = ép mẫu"
 *     responses:
 *       200:
 *         description: >
 *           Văn bản + trạng thái hàng rào. `guardrail.passed=true` nghĩa là LLM
 *           giữ nguyên 100% số của công thức. `guardrail.passed=false` (khi
 *           simulateTamper) nghĩa là hàng rào đã bác bỏ văn bản sửa số và hệ
 *           thống dùng bản mẫu.
 *       400: { description: Thiếu gateId và productId, hoặc mode không hợp lệ }
 *       404: { description: Không tìm thấy thẻ duyệt trong tenant này }
 *       409: { description: Thẻ duyệt không có mã hàng trong payload }
 */
router.post(
  "/proposals/:gateId/explain",
  authorize("ADMIN", "MANAGER", "WAREHOUSE", "ACCOUNTANT"),
  async (req, res, next) => {
    try {
      const simulateTamper = req.body?.simulateTamper === true;
      const mode = req.body?.mode === "template" ? "template" : "auto";
      const result = await inTenant(req.user.tenantId, () =>
        explainProposalForGate({
          tenantId: req.user.tenantId,
          gateId: req.params.gateId,
          simulateTamper,
          mode,
          quantity: req.body?.quantity,
        }),
      );
      success(res, result);
    } catch (e) {
      next(e);
    }
  },
);

module.exports = router;
