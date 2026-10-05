'use strict';

/**
 * prisma/seed_phase1_crm.js — AN.1 / R1: dữ liệu mẫu CRM cho tenant trình diễn
 *
 * ============================================================================
 * MỤC ĐÍCH
 * R1 yêu cầu "đếm được >= 300 dòng mỗi bảng". Code CRM đã viết xong nhưng DB
 * thật các bảng CRM đang RỖNG (đo 2026-10-04: crm_leads 0, crm_deals 0,
 * crm_communications 0, customer_tasks 3). Script này dựng một tenant riêng
 * `crm-phase1-demo` và nạp đủ dữ liệu cho 9 bảng, mỗi bảng >= 300 dòng.
 *
 * VÌ SAO TÁCH TENANT RIÊNG
 *   - Không trộn dữ liệu mẫu vào tenant thật (`candory-scent`: 82 đơn đã ký).
 *   - Không đụng tenant MÔ PHỎNG `omni-demo-mo-phong` đang phục vụ đồ án AISC26.
 *   - Xoá sạch được bằng `--reset` mà không cần biết dữ liệu nào là của ai.
 *
 * AN TOÀN (theo đúng convention của scripts/dataset/import-erp-demo.js):
 *   - `assertLocalDb` chặn nhầm DB production.
 *   - DRY-RUN là mặc định. Phải `--apply` mới ghi.
 *   - Tất định: PRNG seed cố định ⇒ chạy lại cho ra CÙNG một bộ dữ liệu, hai
 *     người chạy đều thấy số liệu giống nhau (quan trọng khi so báo cáo).
 *   - Idempotent: đã có dữ liệu thì bỏ qua, không nhân bản. `--reset` để dựng lại.
 *
 * DỮ LIỆU CÓ TÍNH ĐẾN CHỨ KHÔNG PHẢI NGẪU NHIÊN
 *   - Lịch sử đơn trải đều 12 tháng; ~30% khách im lặng > 100 ngày ⇒ có nhóm
 *     At-Risk thật cho RFM/churn ở Phase 3-4, không phải dữ liệu toàn "khách mới".
 *   - `paymentStatus` khớp với số payment sinh ra (PAID → 1 payment, PARTIAL →
 *     1 payment thiếu, UNPAID → không có) ⇒ đối chiếu sổ tiền khớp DB.
 *
 * Dùng:
 *   node prisma/seed_phase1_crm.js                 # dry-run (mặc định)
 *   node prisma/seed_phase1_crm.js --apply         # ghi thật
 *   node prisma/seed_phase1_crm.js --reset         # xoá sạch tenant này rồi thoát
 *   node prisma/seed_phase1_crm.js --apply --reset # xoá rồi dựng lại
 */

require("dotenv").config();

const bcrypt = require("bcrypt");
const { assertLocalDb } = require("../scripts/lib/assert-local-db");

assertLocalDb("seed:phase1");

const prisma = require("../src/config/prisma");
const { runWithTenant } = require("../src/config/tenantContext");
const logger = require("../src/utils/logger");

// ---------------------------------------------------------------------------
// Hằng số cấu hình
// ---------------------------------------------------------------------------

const TENANT_SLUG = "crm-phase1-demo";
const TENANT_NAME = "CRM DEMO — PHASE 1 (dữ liệu mẫu)";
// Mật khẩu chung của nhóm, giống seed.js — dùng cho tenant MÔ PHỎNG trên máy
// trình diễn. Không phải tài khoản thật.
const PASSWORD = process.env.PHASE1_PASSWORD || "123456";
// `enterprise` có allowedModules = ["*"] ⇒ không bị plan.middleware chặn ở
// các phase sau (crm, segments, marketing, analytics, report-builder...).
const PLAN_KEY = "enterprise";

const PRNG_SEED = 20261004; // cố định ⇒ dữ liệu lặp lại y hệt
const DAY_MS = 86_400_000;

// Ngưỡng DoD của R1.
const MIN_ROWS = 300;
const TARGET = {
  products: 320,
  customers: 320,
  orders: 360,
  leads: 320,
  deals: 320,
  communications: 320,
  tasks: 320,
  // Không nằm trong danh sách 9 bảng kiểm chứng, nhưng CẦN để hồ sơ 360 (AN.2)
  // hiện được tương tác: `CrmCommunication` không có customerId, phải đi qua
  // contact → customer. Không có contact thì timeline của khách luôn rỗng.
  contacts: 320,
  // Phase 3: báo cáo R-06 (Kraljic) + R-07 (Vendor Scorecard) đọc bảng
  // `vendors`; R-09 (AP Aging) đọc `debts` loại PAYABLE. Không có dữ liệu thì
  // các báo cáo này chỉ chứng minh được "0 khớp 0" — không phải bằng chứng.
  vendors: 60,
  debts: 90,
  // Kho mặc định + tồn kho cho từng SKU. Bắt buộc: `orderService.create` kiểm
  // tra tồn (`Sản phẩm ... không đủ tồn kho có thể bán`) nên không có
  // Inventory thì không tạo được đơn qua API ⇒ không chứng minh được
  // "tạo đơn → RFM đổi trong vài giây" (Phase 3.3) và màn hình POS trống.
  inventories: 320,
  // Phase 4: dữ liệu cho R-05 (chiến dịch), R-08 (QC nhận hàng), R-09 (AP aging).
  // Mỗi phiếu nhận hàng kéo theo PO + PO-item ⇒ tốn nhiều dòng hơn nhưng là
  // bằng chứng báo cáo chạy trên dữ liệu thật, không phải "0 khớp 0".
  segments: 4,
  campaigns: 5,
  campaignRecipients: 260,
  purchaseOrders: 45,
  grnItems: 180,
};
// payments không đặt mục tiêu riêng — nó sinh ra từ đơn; hàm verify kiểm
// ngưỡng chung MIN_ROWS cho tất cả 9 bảng.

/** Marker để nhận ra dữ liệu do script này tạo (mã bắt đầu bằng chuỗi này). */
const MARK = "P1";

// ---------------------------------------------------------------------------
// PRNG tất định — không dùng Math.random() (không tái lập được kết quả)
// ---------------------------------------------------------------------------

// mulberry32 — `a` PHẢI nằm ngoài closure. Nếu khai báo `let a = seed` bên trong
// thì hàm trả về trọn vẹn CÙNG MỘT GIÁ TRỊ ở mọi lần gọi ⇒ mọi vòng chọn ngẫu
// nhiên cho ra kết quả giống nhau (và vòng `while` chọn giá trị khác nhau sẽ
// quay vô hạn, đốt CPU).
const mulberry32 = (seed) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const rnd = mulberry32(PRNG_SEED);
const rndInt = (min, max) => min + Math.floor(rnd() * (max - min + 1));
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
/** Chọn theo trọng số: [[giá trị, xác suất tương đối], ...] */
const weighted = (pairs) => {
  const total = pairs.reduce((s, [, w]) => s + w, 0);
  let r = rnd() * total;
  for (const [value, w] of pairs) {
    r -= w;
    if (r <= 0) return value;
  }
  return pairs[pairs.length - 1][0];
};

// ---------------------------------------------------------------------------
// Nguyên liệu tạo dữ liệu — tên/địa danh Việt Nam, KHÔNG PII thật
// ---------------------------------------------------------------------------

const HO = ["Nguyễn", "Trần", "Lê", "Phạm", "Hoàng", "Phan", "Vũ", "Võ", "Đặng", "Bùi",
  "Đỗ", "Hồ", "Ngô", "Dương", "Lý", "Đinh", "Mai", "Trương", "Cao", "Tô"];
const DEMONYM = ["Văn", "Thị", "Hữu", "Đức", "Minh", "Ngọc", "Thanh", "Quang", "Hồng", "Khánh",
  "Thu", "Bảo", "An", "Dũng", "Phúc", "Tâm", "Nhật", "Tuấn", "Huy", "Khoa"];
const GIVEN = ["An", "Bình", "Cường", "Dũng", "Giang", "Hà", "Hải", "Hùng", "Khánh", "Linh",
  "Long", "Mai", "Nam", "Nga", "Phúc", "Quân", "Quỳnh", "Thảo", "Trang", "Tuấn",
  "Vy", "Yến", "Hạnh", "Ngọc", "Lan", "Hương", "Tâm", "Thắng", "Trúc", "Tuệ"];

const DISTRICTS = ["Quận 1", "Quận 3", "Quận 5", "Quận 7", "Quận Bình Thạnh", "Quận Gò Vấp",
  "Quận Tân Bình", "Quận Phú Nhuận", "Thành phố Thủ Đức", "Huyện Củ Chi", "Huyện Bình Chánh",
  "Quận Hải Châu", "Quận Ngũ Hành Sơn", "Quận Hải Châu, Đà Nẵng"];

const CATEGORIES = [
  { name: "Mỹ phẩm chăm sóc da", items: ["Sữa rửa mặt", "Tẩy trang", "Kem dưỡng", "Serum vitamin C", "Mặt nạ lấy da"] },
  { name: "Nước hoa & Nước xả", items: ["Nước hoa nhẹ", "Xịt làm thơm tóc", "Dầu gội", "Dầu xả"] },
  { name: "Đồ gia dụng mini", items: ["Bình giữ nhiệt", "Hộp bút", "Túi vải", "Đèn bàn"] },
  { name: "Trà & Thực phẩm", items: ["Trà sen", "Trà ô long", "Mật ong", "Hạt nổ"] },
];

const LEAD_SOURCES = ["Website", "Facebook", "Zalo OA", "Tiktok", "Giới thiệu", "Sự kiện", "Google Maps"];
const REFERRAL_SOURCES = ["webhook-website", "webhook-facebook", "webhook-tiktok", "giới thiệu", "sự kiện", "google-maps"];
const CHANNELS = ["POS", "QR", "SHOPEE", "TIKTOK", "WEBSITE"];

const COMM_TYPES = ["CALL", "EMAIL", "ZALO", "MEETING", "WHATSAPP", "NOTE"];
const COMM_TEMPLATES = [
  "Gọi xác nhận nhu cầu và hẹn lịch gửi mẫu.",
  "Gửi bảng giá bảng tính theo số lượng khách dự kiến.",
  "Nhắc follow-up sau 3 ngày, khách chưa phản hồi.",
  "Trao đổi về chính sách đổi trả và thời hạn giao.",
  "Thống nhất phương thức thanh toán và địa chỉ giao hàng.",
  "Gửi ưu đãi giới thiệu bạn bè cho khách số lượng lớn.",
  "Khách phản hồi chưa cần mua gấp, hẹn tái khám 2 tháng sau.",
  "Xác nhận đơn hàng đã chuyển kho, cung cấp mã vận đơn.",
];

const TASK_TITLES = [
  "Gọi lại khách hỏi về đơn chưa chốt",
  "Gửi báo giá bảng tính theo số lượng lớn",
  "Nhắc thanh toán công nợ đến hạn",
  "Đề xuất voucher giữ chân khách im lặng lâu",
  "Xác nhận địa chỉ giao hàng trước khi chuyển kho",
  "Theo dõi đơn đang giao, gọi cho khách nếu chậm",
  "Khảo sát nhu cầu dòng sản phẩm mới",
  "Cảm ơn khách sau khi giao hàng, xin đánh giá",
];

const LOST_REASONS = ["Khách chọn đối thủ rẻ hơn", "Không còn nhu cầu", "Chưa đủ ngân sách", "Liên hệ không lại được"];
const KRALJIC = ["STRATEGIC", "LEVERAGE", "BOTTLENECK", "ROUTINE"];
const VENDOR_PREFIX = ["Công ty TNHH", "Nhà phân phối", "Công ty CP", "Xí nghiệp", "Công ty TNHH MTV"];
const VENDOR_NAME = [
  "Nguyễn", "Trần", "Lê", "Phạm", "Hoàng", "Đặng", "Bùi", "Đỗ",
  "Phát", "Thành", "Hải", "Đông", "Nam", "An", "Bình",
];
const VENDOR_SUFFIX = ["Phát", "Thịnh", "Hưng", "Đạt", "Vượng", "Thành Công", "An Phú", "Đại Dương", "Hoàng Gia", "Minh Khai", "Tân Tiến", "Kim Long"];
const DEBT_TYPES = ["PAYABLE", "RECEIVABLE"];

/* --------------------------------------------------------------------------
 * Phase 4 — dữ liệu cho R-05 (chiến dịch) và R-08 (QC nhận hàng)
 * ----------------------------------------------------------------------- */

// Phân khúc khách theo RFM — `rules` là JSON của query builder nội bộ; ở đây
// chỉ cần phân khúc tồn tại để chiến dịch có segmentId hợp lệ.
const SEGMENTS = [
  { key: "rfm-at-risk", name: "RFM — At-Risk (cần giữ chân)", rules: { field: "rfmSegment", op: "=", value: "At-Risk" } },
  { key: "rfm-champions", name: "RFM — Champions (giá trị cao)", rules: { field: "rfmSegment", op: "=", value: "Champions" } },
  { key: "tier-platinum", name: "Hạng Platinum + Gold", rules: { field: "tier", op: "in", value: ["PLATINUM", "GOLD"] } },
  { key: "lead-new", name: "Lead mới chưa liên hệ", rules: { field: "leadStatus", op: "=", value: "NEW" } },
];

const CAMPAIGNS = [
  { name: "Chiến dịch giữ chân At-Risk — tháng này", channel: "EMAIL", seg: "rfm-at-risk", subject: "Ưu đãi 10% dành riêng cho bạn" },
  { name: "Chiến dịch Zalo nhắc mua lại", channel: "ZALO", seg: "rfm-at-risk", subject: "Mua lại hôm nay, giảm ngay 10%" },
  { name: "Chăm sóc khách Champions", channel: "EMAIL", seg: "rfm-champions", subject: "Cảm ơn bạn, quà tặng dành riêng" },
  { name: "Mời tham gia hạng Platinum", channel: "ZALO", seg: "tier-platinum", subject: "Nâng hạng lên Platinum của bạn" },
  { name: "Chào mừng lead mới", channel: "EMAIL", seg: "lead-new", subject: "Cảm ơn bạn đã quan tâm" },
];

const RECEIPT_STATES = [
  { fn: "FULL", pass: 1, reject: 0 }, // đạt 100%
  { fn: "FULL", pass: 1, reject: 0 },
  { fn: "PARTIAL", pass: 0.7, reject: 0.3 }, // lỗi hàng
  { fn: "PARTIAL", pass: 0.8, reject: 0.2 },
  { fn: "FULL", pass: 1, reject: 0 },
];

const insertSegmentsAndCampaigns = async (tenantId, customers, userId) => {
  const segmentIds = {};
  for (const s of SEGMENTS) {
    const found = await prisma.customerSegment.findFirst({
      where: { tenantId, name: s.name },
      select: { id: true },
    });
    const row = found
      ? await prisma.customerSegment.update({ where: { id: found.id }, data: { rules: s.rules }, select: { id: true } })
      : await prisma.customerSegment.create({
          data: { tenantId, name: s.name, rules: s.rules, createdById: userId, customerCount: 0 },
          select: { id: true },
        });
    segmentIds[s.key] = row.id;
  }

  const campaigns = [];
  let recipientTotal = 0;
  for (let i = 0; i < CAMPAIGNS.length; i += 1) {
    const c = CAMPAIGNS[i];
    const segId = segmentIds[c.seg];
    const status = weighted([["SENT", 70], ["SCHEDULED", 15], ["DRAFT", 10], ["FAILED", 5]]);
    const found = await prisma.customerCampaign.findFirst({ where: { tenantId, name: c.name }, select: { id: true } });
    const campaign = found
      ? await prisma.customerCampaign.update({
          where: { id: found.id },
          data: { status, sentAt: status === "SENT" ? daysAgo(rndInt(1, 20)) : null },
          select: { id: true },
        })
      : await prisma.customerCampaign.create({
          data: {
            tenantId,
            name: c.name,
            channel: c.channel,
            segmentId: segId,
            subject: c.subject,
            bodyTemplate: `Kính gửi quý khách, ${c.subject}.`,
            status,
            scheduledAt: status === "SCHEDULED" ? daysAgo(-rndInt(1, 7)) : null,
            sentAt: status === "SENT" ? daysAgo(rndInt(1, 20)) : null,
            createdById: userId,
          },
          select: { id: true },
        });
    campaigns.push({ ...c, id: campaign.id, status, segId });
  }

  // Người nhận: mỗi chiến dịch ~52 khách, trạng thái gửi khớp trạng thái chiến dịch.
  const recipients = [];
  for (const c of campaigns) {
    const size = Math.ceil(TARGET.campaignRecipients / campaigns.length);
    for (let i = 0; i < size; i += 1) {
      const cst = customers[(i * 7 + campaigns.indexOf(c) * 13) % customers.length];
      const status =
        c.status === "SENT"
          ? weighted([["SENT", 88], ["FAILED", 12]])
          : c.status === "FAILED"
            ? weighted([["FAILED", 70], ["PENDING", 30]])
            : "PENDING";
      recipients.push({
        tenantId,
        campaignId: c.id,
        customerId: cst.id,
        status,
        sentAt: status === "SENT" ? daysAgo(rndInt(1, 20)) : null,
        error: status === "FAILED" ? "Địa chỉ thư không hợp lệ" : null,
      });
    }
  }
  for (const part of chunk(recipients)) {
    await prisma.campaignRecipient.createMany({ data: part, skipDuplicates: true });
  }
  recipientTotal = await prisma.campaignRecipient.count({ where: { tenantId } });

  // Cập nhật customerCount cho phân khúc (dùng để hiển thị, không ảnh hưởng R-05).
  for (const s of SEGMENTS) {
    const n = await prisma.customer.count({
      where: {
        tenantId,
        rfmSegment: s.rules.value && s.rules.op === "=" ? s.rules.value : undefined,
      },
    });
    await prisma.customerSegment.update({
      where: { id: segmentIds[s.key] },
      data: { customerCount: n },
    });
  }

  return { segments: Object.keys(segmentIds).length, campaigns: campaigns.length, recipients: recipientTotal };
};

/**
 * Chuỗi PO → PO-item → GRN → GRN-item cho R-08 (QC pass rate).
 *
 * Ràng buộc quan hệ: `GoodsReceiptItem.purchaseItemId` BẮT BUỘC trỏ tới
 * `PurchaseItem`, còn `GoodsReceiptNote.purchaseOrderId` trỏ tới `PurchaseOrder`
 * ⇒ không tạo GRN độc lập được, phải dựng đủ chuỗi.
 */
const toNum = (v) => (v == null ? NaN : typeof v === "number" ? v : Number(String(v).replace(/,/g, "")));

const insertPurchaseAndReceipts = async (tenantId, vendors, productRows, warehouseId, userId) => {
  const poCount = TARGET.purchaseOrders;
  const pos = [];
  for (let i = 0; i < poCount; i += 1) {
    const vendorId = vendors[i % vendors.length].id;
    const days = rndInt(10, 300);
    const items = rndInt(2, 5);
    const lines = [];
    let subtotal = 0;
    for (let k = 0; k < items; k += 1) {
      const product = productRows[rndInt(0, productRows.length - 1)];
      const quantity = rndInt(20, 200);
      const unitCost = Math.round(toNum(product.price) * 0.6);
      subtotal += quantity * unitCost;
      lines.push({ productId: product.id, quantity, unitCost });
    }
    pos.push({
      idx: i,
      poCode: `${MARK}-PO-${pad(i + 1, 3)}`,
      vendorId,
      date: daysAgo(days),
      // Enum PurchaseStatus trong schema: DRAFT/PENDING/PENDING_APPROVAL/
      // APPROVED/ORDERED/RECEIVED/PAID/REJECTED/CANCELLED (xem schema.prisma).
      status: weighted([["RECEIVED", 55], ["PAID", 25], ["APPROVED", 15], ["ORDERED", 5]]),
      lines,
      subtotal,
    });
  }

  let poTotal = 0;
  let purchaseItemTotal = 0;
  let grnTotal = 0;
  let grnItemTotal = 0;

  for (const po of pos) {
    const poRow = await prisma.purchaseOrder.upsert({
      where: { poCode: po.poCode },
      update: {},
      create: {
        tenantId,
        poCode: po.poCode,
        vendorId: po.vendorId,
        status: po.status,
        paymentStatus: weighted([["PAID", 55], ["UNPAID", 30], ["PARTIAL", 15]]),
        subtotal: po.subtotal,
        taxAmount: 0,
        total: po.subtotal,
        expectedAt: po.date,
        createdById: userId,
      },
      select: { id: true },
    });
    poTotal += 1;

    const itemRows = [];
    for (const l of po.lines) {
      const r = await prisma.purchaseItem.create({
        data: {
          tenantId,
          purchaseOrderId: poRow.id,
          productId: l.productId,
          quantity: l.quantity,
          unitCost: l.unitCost,
          subtotal: l.quantity * l.unitCost,
        },
        select: { id: true },
      });
      itemRows.push({ ...l, id: r.id });
      purchaseItemTotal += 1;
    }

    // 80% PO có phiếu nhận hàng tương ứng (số còn lại để ở trạng thái chờ).
    if (rnd() >= 0.8) continue;
    const state = pick(RECEIPT_STATES);
    const grnCode = `${MARK}-GRN-${po.poCode.split("-").pop()}`;
    const receivedAt = new Date(po.date.getTime() + rndInt(1, 10) * 86400000);
    const grn = await prisma.goodsReceiptNote.upsert({
      where: { grnCode },
      update: {},
      create: {
        tenantId,
        grnCode,
        purchaseOrderId: poRow.id,
        warehouseId,
        status: "QC_DONE",
        receivedAt,
        onTime: receivedAt <= po.date,
        createdById: userId,
      },
      select: { id: true },
    });
    grnTotal += 1;

    const grnItems = itemRows.map((l) => ({
      tenantId,
      grnId: grn.id,
      productId: l.productId,
      purchaseItemId: l.id,
      receivedQty: l.quantity,
      passQty: Math.round(l.quantity * state.pass),
      rejectQty: l.quantity - Math.round(l.quantity * state.pass),
    }));
    for (const part of chunk(grnItems)) {
      await prisma.goodsReceiptItem.createMany({ data: part, skipDuplicates: true });
      grnItemTotal += part.length;
    }
  }

  return { purchaseOrders: poTotal, purchaseItems: purchaseItemTotal, grn: grnTotal, grnItems: grnItemTotal };
};

const STAGE_SPEC = {
  LEAD: [
    { label: "Lead mới", kind: "ONGOING", probability: 10 },
    { label: "Đã liên hệ", kind: "ONGOING", probability: 30 },
    { label: "Đủ thông tin", kind: "ONGOING", probability: 50 },
    { label: "Đã thành khách", kind: "WON", probability: 100 },
    { label: "Chết", kind: "LOST", probability: 0 },
  ],
  DEAL: [
    { label: "Cơ hội mới", kind: "ONGOING", probability: 10 },
    { label: "Đang thương lượng", kind: "ONGOING", probability: 45 },
    { label: "Chốt", kind: "WON", probability: 90 },
    { label: "Thua", kind: "LOST", probability: 0 },
  ],
};

const pad = (n, len = 4) => String(n).padStart(len, "0");
const daysAgo = (n) => new Date(Date.now() - n * DAY_MS);

/** Log tiến trình kèm thời gian — để biết script đang chậm ở bước nào. */
const STEP_T0 = Date.now();
const step = (msg) => console.log(`  [${((Date.now() - STEP_T0) / 1000).toFixed(1)}s] ${msg}`);

// ---------------------------------------------------------------------------
// Sinh dữ liệu (thuần hàm — không chạm DB, test được)
// ---------------------------------------------------------------------------

const buildProducts = (n) => {
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const cat = CATEGORIES[i % CATEGORIES.length];
    const item = cat.items[Math.floor(rnd() * cat.items.length)];
    const variant = ` ${pick(["cao cấp", "tiêu chuẩn", "thử nghiệm", "combo 2", "combo 3"])}`;
    const price = rndInt(39, 899) * 1000;
    out.push({
      sku: `${MARK}-${pad(i + 1)}`,
      name: `${item}${variant} #${pad(i + 1, 3)}`,
      price,
      costPrice: Math.round(price * 0.62),
      categoryName: cat.name,
      unit: pick(["cái", "hộp", "chai", "túi", "bộ"]),
    });
  }
  return out;
};

const buildCustomers = (n) => {
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const name = `${pick(HO)} ${pick(DEMONYM)} ${pick(GIVEN)}`;
    out.push({
      // @@unique([phone, tenantId]) — SĐT sinh từ chỉ số nên không trùng.
      phone: `09${pad(i + 1, 8)}`,
      name,
      email: `kh.${pad(i + 1)}@${MARK}.local`,
      address: `${rndInt(1, 250)} ${pick(DISTRICTS)}, TP. Hồ Chí Minh`,
      tier: weighted([["BRONZE", 45], ["SILVER", 30], ["GOLD", 18], ["PLATINUM", 7]]),
      referralSource: pick(REFERRAL_SOURCES),
      leadStatus: weighted([["CUSTOMER", 78], ["CONTACTED", 14], ["QUALIFIED", 5], ["NEW", 3]]),
      loyaltyPoints: rndInt(0, 40) * 25,
      // 30% khách "ngủ đông" để RFM sinh ra phân khúc At-Risk thật.
      dormant: rnd() < 0.3,
      // Khách đến rải đều trong 12 tháng — cần cho KPI cohort giữ chân
      // (`analytics.retentionKpi` nhóm theo `customers.createdAt`). Nếu đặt tất
      // cả là hôm nay thì mọi khách rơi vào một cohort và KPI chỉ có 1 dòng.
      // Lưu ý: KHÔNG ảnh hưởng RFM/CLV vì hai hàm đó chỉ đọc `orders.createdAt`.
      createdAt: daysAgo(rndInt(10, 360)),
    });
  }
  return out;
};

/**
 * Lịch sử đơn: mỗi khách 1–3 đơn trong 12 tháng, đơn của khách "ngủ đông"
 * dồn về nửa đầu kỳ để recency > 100 ngày.
 */
const buildOrders = (customers, productIds) => {
  const orders = [];
  let seq = 0;

  customers.forEach((c, ci) => {
    const count = c.dormant ? rndInt(2, 3) : rndInt(1, 3);
    for (let k = 0; k < count; k += 1) {
      seq += 1;
      const items = rndInt(1, 3);
      const lines = [];
      let subtotal = 0;
      // Chọn SẢN PHẨM KHÁC NHAU trong cùng một đơn — trùng SKU trong 1 đơn là
      // rác dữ liệu, không phải dữ liệu mẫu đúng.
      // BỌC GIỚI HẠN: `while` thuần túy sẽ quay vô hạn nếu `productIds` rỗng
      // hoặc ngắn hơn `items` (sẽ đốt CPU vô ích, treo cả script).
      const want = Math.min(items, productIds.length);
      const picked = new Set();
      let guard = 0;
      while (picked.size < want && guard < 100) {
        picked.add(productIds[Math.floor(rnd() * productIds.length)]);
        guard += 1;
      }
      for (const productId of picked) {
        const qty = rndInt(1, 4);
        const price = rndInt(39, 899) * 1000;
        subtotal += qty * price;
        lines.push({ productId, quantity: qty, price, subtotal: qty * price });
      }
      const status = weighted([["COMPLETED", 92], ["SHIPPING", 5], ["CANCELLED", 3]]);
      // Ngày đặt đơn không được sớm hơn ngày khách đăng ký — nếu không dữ liệu
      // vô lý (mua trước khi thành khách) và KPI cohort sẽ sai.
      const maxAgeDays = Math.floor((Date.now() - c.createdAt.getTime()) / DAY_MS);
      const rawDays = c.dormant
        ? rndInt(120, 360)
        : Math.round(rnd() ** 1.6 * 330) + 3; // thiên về gần đây
      const days = Math.max(1, Math.min(rawDays, maxAgeDays - 1));
      orders.push({
        seq,
        orderCode: `${MARK}-${daysAgo(days).toISOString().slice(0, 10).replace(/-/g, "")}-${pad(seq)}`,
        customerIndex: ci,
        status,
        createdAt: daysAgo(days),
        paymentStatus: status === "CANCELLED" ? "UNPAID" : weighted([["PAID", 88], ["PARTIAL", 7], ["UNPAID", 5]]),
        paymentMethod: weighted([["CASH", 40], ["BANK_TRANSFER", 25], ["CARD", 15], ["MOMO", 12], ["VNPAY", 5], ["ZALOPAY", 3]]),
        channel: pick(CHANNELS),
        lines,
        subtotal,
      });
    }
  });
  return orders;
};

/** NCC + công n� — nguồn dữ liệu cho R-06/R-07 (vendors) và R-09 (AP aging). */
const buildVendors = (n) => {
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const name = `${pick(VENDOR_PREFIX)} ${pick(VENDOR_NAME)} ${pick(VENDOR_SUFFIX)}`;
    const otif = rndInt(72, 100); // % đơn giao đúng hẹn
    const defect = Number((rnd() * 6).toFixed(2)); // % hàng lỗi
    out.push({
      code: `${MARK}-NCC-${pad(i + 1, 3)}`,
      name: `${name} #${pad(i + 1, 3)}`,
      taxCode: `0${rndInt(100000000, 999999999)}`,
      phone: `028${pad(rndInt(1, 99999999), 8)}`,
      email: `ncc.${pad(i + 1)}@${MARK}.local`,
      address: `${rndInt(1, 300)} ${pick(DISTRICTS)}, TP. Hồ Chí Minh`,
      contactPerson: `${pick(HO)} ${pick(DEMONYM)} ${pick(GIVEN)}`,
      paymentTerms: pick([15, 30, 45, 60]),
      kraljicCategory: pick(KRALJIC),
      profitImpactScore: rndInt(1, 10),
      supplyRiskScore: rndInt(1, 10),
      otifScore: otif,
      defectRate: defect,
      // Hạng A/B/C suy từ OTIF và tỷ lệ lỗi cho khớp thực tế vận hành.
      vendorGrade: otif >= 95 && defect <= 1 ? "A" : otif >= 85 ? "B" : "C",
      isActive: rnd() < 0.94,
    });
  }
  return out;
};

const buildDebts = (n, vendors, customers) => {
  const out = [];
  for (let i = 0; i < n; i += 1) {
    // 2/3 là phải trả NCC (R-09 lọc type = PAYABLE), 1/3 là phải thu.
    const isPayable = i % 3 !== 2;
    const amount = rndInt(8, 900) * 10000;
    // Trải hạn 60 ngày quanh hôm nay → có đủ các nhóm tuổi nợ (0/1-30/31-60/&gt;60).
    const dueOffset = rndInt(-60, 20);
    const paidRatio = weighted([[0, 45], [0.5, 30], [1, 25]]);
    out.push({
      index: i,
      type: isPayable ? "PAYABLE" : "RECEIVABLE",
      amount,
      paidAmount: Math.round(amount * paidRatio),
      dueDate: daysAgo(dueOffset),
      vendorIndex: isPayable ? rndInt(0, vendors.length - 1) : null,
      customerIndex: isPayable ? null : rndInt(0, customers.length - 1),
      note: isPayable ? "Tiền hàng nhập chưa thanh toán" : "Tiền khách còn nợ",
    });
  }
  return out;
};

/** Một contact chính cho mỗi khách — cầu nối để timeline của khách không rỗng. */
const buildContacts = (customers) =>
  customers.map((c, i) => ({
    index: i,
    fullName: c.name,
    phone: c.phone,
    email: c.email,
    jobTitle: pick(["Chủ shop", "Quản lý", "Nhân viên bán hàng", "Kế toán", "Tự do"]),
    isPrimary: true,
    customerIndex: i,
  }));

const buildLeads = (n) => {
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const status = weighted([["NEW", 26], ["CONTACTED", 30], ["QUALIFIED", 22], ["CONVERTED", 14], ["DEAD", 8]]);
    out.push({
      index: i,
      leadName: `${pick(HO)} ${pick(DEMONYM)} ${pick(GIVEN)}`,
      // @@unique([mobileNo, tenantId]) — SĐT theo chỉ số.
      mobileNo: `08${pad(i + 1, 8)}`,
      email: `lead.${pad(i + 1)}@${MARK}.local`,
      jobTitle: pick(["Chủ shop", "Quản lý", "Nhân viên bán hàng", "Kế toán", "Tự do", "Trưởng phòng"]),
      source: pick(LEAD_SOURCES),
      status,
      // 55% lead gắn contact của khách ⇒ khi mở hồ sơ 360 của khách đó sẽ
      // thấy timeline của chính lead này (đúng đường liên kết thật của hệ thống).
      contactCustomerIndex: rnd() < 0.55 ? rndInt(0, 199) : null,
      expectedValue: rndInt(15, 900) * 10000,
      createdAt: daysAgo(rndInt(1, 90)),
      lastContactedAt: status === "NEW" ? null : daysAgo(rndInt(1, 30)),
      notes: `Nhu cầu nhập sỉ, hỏi về ${pick(["chính sách đổi trả", "giá số lượng lớn", "thời gian giao hàng", "hóa đơn VAT"])}.`,
    });
  }
  return out;
};

const buildDeals = (n, leadCount) => {
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const kind = weighted([["ONGOING", 58], ["WON", 26], ["LOST", 16]]);
    out.push({
      index: i,
      dealName: `Deal ${MARK}-${pad(i + 1)} — đơn số lượng lớn`,
      kind,
      value: rndInt(20, 1500) * 10000,
      probability: kind === "WON" ? 100 : kind === "LOST" ? 0 : rndInt(10, 80),
      leadIndex: rnd() < 0.7 ? rndInt(0, leadCount - 1) : null,
      expectedCloseDate: daysAgo(-rndInt(3, 45)), // ngày trong tương lai
      closedAt: kind === "ONGOING" ? null : daysAgo(rndInt(1, 60)),
      lostReason: kind === "LOST" ? pick(LOST_REASONS) : null,
      nextStep: kind === "ONGOING" ? pick(["Gửi báo giá mới", "Hẹn gặp trực tiếp", "Chờ khách phản hồi", "Đề xuất phương thức trả góp"]) : null,
      createdAt: daysAgo(rndInt(5, 120)),
    });
  }
  return out;
};

const buildCommunications = (n, leadCount, dealCount) => {
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const type = pick(COMM_TYPES);
    const attachToDeal = rnd() < 0.5;
    out.push({
      index: i,
      type,
      direction: weighted([["OUTBOUND", 62], ["INBOUND", 38]]),
      subject: `${type} — ${pick(["tư vấn sản phẩm", "chốt đơn", "hỗ trợ sau bán", "theo dõi đơn", "xác nhận thông tin"])}`,
      content: pick(COMM_TEMPLATES),
      durationSec: type === "CALL" ? rndInt(35, 480) : null,
      leadIndex: attachToDeal ? null : rndInt(0, leadCount - 1),
      dealIndex: attachToDeal ? rndInt(0, dealCount - 1) : null,
      createdAt: daysAgo(rndInt(0, 88)),
    });
  }
  return out;
};

const buildTasks = (n, customerCount) => {
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const status = weighted([["PENDING", 46], ["IN_PROGRESS", 24], ["DONE", 24], ["CANCELLED", 6]]);
    const dueDays = rndInt(-3, 10);
    out.push({
      index: i,
      customerIndex: rndInt(0, customerCount - 1),
      title: `${pick(TASK_TITLES)} #${pad(i + 1, 3)}`,
      description: `Ghi chú CSKH: ${pick(COMM_TEMPLATES)}`,
      status,
      priority: weighted([["NORMAL", 55], ["HIGH", 30], ["LOW", 15]]),
      dueAt: daysAgo(dueDays),
      completedAt: status === "DONE" ? daysAgo(rndInt(0, 5)) : null,
      createdAt: daysAgo(rndInt(1, 60)),
    });
  }
  return out;
};

// ---------------------------------------------------------------------------
// Ghi DB
// ---------------------------------------------------------------------------

const CHUNK = 200;

const chunk = (arr, size = CHUNK) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

/** Idempotent theo slug — tenant có sẵn thì lấy lại, không tạo trùng. */
const ensureTenant = () =>
  prisma.tenant.upsert({
    where: { slug: TENANT_SLUG },
    update: { name: TENANT_NAME },
    create: { slug: TENANT_SLUG, name: TENANT_NAME },
    select: { id: true, name: true, slug: true },
  });

const ensureUsers = async (tenantId) => {
  const hash = bcrypt.hashSync(PASSWORD, 10);
  const specs = [
    { email: `${MARK}.admin@crm.local`, fullName: "Quản trị Phase 1", role: "ADMIN" },
    { email: `${MARK}.manager@crm.local`, fullName: "Quản lý bán hàng Phase 1", role: "MANAGER" },
    { email: `${MARK}.cashier@crm.local`, fullName: "Thu ngân Phase 1", role: "CASHIER" },
  ];
  const out = {};
  for (const s of specs) {
    out[s.role] = await prisma.user.upsert({
      where: { email: s.email },
      update: {
        tenantId,
        role: s.role,
        isActive: true,
        emailVerified: true,
        registrationStatus: "ACTIVE",
        mustChangePassword: false,
        password: hash,
      },
      create: {
        ...s,
        tenantId,
        password: hash,
        isActive: true,
        emailVerified: true,
        registrationStatus: "ACTIVE",
      },
      select: { id: true, email: true, role: true },
    });
  }
  // Cây báo cáo: cashier → manager → admin (Sales Hierarchy cần để dựng).
  await prisma.user.update({ where: { id: out.MANAGER.id }, data: { reportsToId: out.ADMIN.id } });
  await prisma.user.update({ where: { id: out.CASHIER.id }, data: { reportsToId: out.MANAGER.id } });
  return out;
};

/** Subscription ACTIVE để `plan.middleware` không chặn endpoint ở phase sau. */
const ensureSubscription = async (tenantId) => {
  const plan = await prisma.subscriptionPlan.findUnique({ where: { key: PLAN_KEY }, select: { id: true, key: true } });
  if (!plan) {
    logger.warn(`[seed:phase1] Không thấy plan "${PLAN_KEY}" — bỏ qua subscription. Chạy: npm run db:seed`);
    return null;
  }
  const existing = await prisma.tenantSubscription.findFirst({
    where: { tenantId, status: { in: ["ACTIVE", "TRIAL"] } },
    select: { id: true },
    orderBy: { createdAt: "desc" },
  });
  if (existing) {
    await prisma.tenantSubscription.update({
      where: { id: existing.id },
      data: { planId: plan.id, status: "ACTIVE", endDate: new Date(Date.now() + 365 * DAY_MS) },
    });
    return existing.id;
  }
  const created = await prisma.tenantSubscription.create({
    data: {
      tenantId,
      planId: plan.id,
      status: "ACTIVE",
      startDate: new Date(),
      endDate: new Date(Date.now() + 365 * DAY_MS),
    },
    select: { id: true },
  });
  return created.id;
};

const ensureStages = async (tenantId) => {
  const stages = { LEAD: {}, DEAL: {} };
  for (const entityType of ["LEAD", "DEAL"]) {
    let order = 0;
    for (const spec of STAGE_SPEC[entityType]) {
      order += 1;
      const found = await prisma.crmPipelineStage.findFirst({
        where: { tenantId, entityType, label: spec.label },
        select: { id: true },
      });
      const row = found
        ? await prisma.crmPipelineStage.update({
            where: { id: found.id },
            data: { kind: spec.kind, probability: spec.probability, sortOrder: order },
            select: { id: true },
          })
        : await prisma.crmPipelineStage.create({
            data: {
              tenantId,
              entityType,
              label: spec.label,
              kind: spec.kind,
              probability: spec.probability,
              sortOrder: order,
              isActive: true,
            },
            select: { id: true },
          });
      stages[entityType][spec.label] = row.id;
    }
  }
  return stages;
};

const ensureCategory = (tenantId) =>
  prisma.category.upsert({
    // Category có `@@unique([name, tenantId])` ⇒ phải dùng TÊN compound do Prisma
    // sinh ra (thứ tự cột trong schema: `name_tenantId`), không dùng `where: { name }`.
    where: { name_tenantId: { name: `Hàng hóa ${MARK}`, tenantId } },
    update: {},
    create: { tenantId, name: `Hàng hóa ${MARK}`, description: "Danh mục dữ liệu mẫu Phase 1" },
    select: { id: true, name: true },
  });

const insertProducts = async (tenantId, categoryId, products) => {
  for (const part of chunk(products)) {
    await prisma.product.createMany({
      data: part.map((p) => ({
        tenantId,
        sku: p.sku,
        name: p.name,
        price: p.price,
        costPrice: p.costPrice,
        unit: p.unit,
        categoryId,
        isActive: true,
        trackByLot: false,
        productType: "REGULAR",
      })),
      skipDuplicates: true,
    });
  }
  // `costPrice` cần cho chuỗi PO (giá vốn NCC) — thiếu nó thì `unitCost` = NaN.
  const rows = await prisma.product.findMany({
    where: { tenantId },
    select: { id: true, sku: true, price: true, costPrice: true },
  });
  return rows;
};

const insertCustomers = async (tenantId, customers) => {
  for (const part of chunk(customers)) {
    await prisma.customer.createMany({
      data: part.map((c) => ({
        tenantId,
        phone: c.phone,
        name: c.name,
        email: c.email,
        address: c.address,
        tier: c.tier,
        referralSource: c.referralSource,
        leadStatus: c.leadStatus,
        loyaltyPoints: c.loyaltyPoints,
        totalSpent: 0,
        totalDebt: 0,
        creditLimit: 0,
        storeCredit: 0,
        isActive: true,
        createdAt: c.createdAt,
      })),
      skipDuplicates: true,
    });
  }
  const rows = await prisma.customer.findMany({ where: { tenantId }, select: { id: true, phone: true } });
  return rows;
};

/** Đơn + chi tiết + thanh toán (payment khớp paymentStatus). */
const insertOrders = async (tenantId, orders, customerIdByPhone, userId) => {
  const orderRows = [];
  for (const part of chunk(orders)) {
    await prisma.order.createMany({
      data: part.map((o) => ({
        tenantId,
        orderCode: o.orderCode,
        status: o.status,
        paymentMethod: o.paymentMethod,
        paymentStatus: o.paymentStatus,
        subtotal: o.subtotal,
        discount: 0,
        total: o.subtotal,
        currency: "VND",
        exchangeRate: 1,
        customerId: customerIdByPhone.get(o.customerPhone) || null,
        createdById: userId,
        createdAt: o.createdAt,
        orderType: "DELIVERY",
        channel: o.channel,
      })),
      skipDuplicates: true,
    });
  }
  const stored = await prisma.order.findMany({
    where: { tenantId, orderCode: { startsWith: MARK } },
    select: { id: true, orderCode: true, subtotal: true, paymentStatus: true, status: true, createdAt: true },
  });
  const byCode = new Map(stored.map((o) => [o.orderCode, o]));
  for (const o of orders) orderRows.push(byCode.get(o.orderCode));

  // order_items — model này KHÔNG có createdAt/updatedAt (xem schema.prisma).
  const items = [];
  for (const o of orders) {
    const row = byCode.get(o.orderCode);
    if (!row) continue;
    for (const line of o.lines) {
      items.push({
        tenantId,
        orderId: row.id,
        productId: line.productId,
        quantity: line.quantity,
        price: line.price,
        subtotal: line.subtotal,
        status: "SERVED",
      });
    }
  }
  for (const part of chunk(items)) {
    await prisma.orderItem.createMany({ data: part, skipDuplicates: true });
  }

  // payments — chỉ PAID/PARTIAL mới có payment; UNPAID/CANCELLED thì không.
  const payments = [];
  for (const o of orders) {
    const row = byCode.get(o.orderCode);
    if (!row || (o.paymentStatus !== "PAID" && o.paymentStatus !== "PARTIAL")) continue;
    const amount = o.paymentStatus === "PAID" ? toNum(row.subtotal) : Math.round(toNum(row.subtotal) * 0.5);
    payments.push({
      tenantId,
      orderId: row.id,
      amount,
      currency: "VND",
      exchangeRate: 1,
      method: o.paymentMethod,
      txStatus: "SUCCESS",
      createdById: userId,
      createdAt: o.createdAt,
    });
  }
  for (const part of chunk(payments)) {
    await prisma.payment.createMany({ data: part, skipDuplicates: true });
  }

  // Ghi nhận doanh thu khớp tiền thực thanh toán (khách hàng nhiều đơn ⇒ cộng dồn).
  const perCustomer = new Map();
  for (let i = 0; i < orders.length; i += 1) {
    const row = orderRows[i];
    const o = orders[i];
    if (!row || (o.paymentStatus !== "PAID" && o.paymentStatus !== "PARTIAL")) continue;
    const key = o.customerPhone;
    const amt = o.paymentStatus === "PAID" ? toNum(row.subtotal) : Math.round(toNum(row.subtotal) * 0.5);
    perCustomer.set(key, (perCustomer.get(key) || 0) + amt);
  }
  for (const [phone, spent] of perCustomer) {
    const id = customerIdByPhone.get(phone);
    if (!id) continue;
    const cur = await prisma.customer.findUnique({ where: { id }, select: { totalSpent: true } });
    await prisma.customer.update({
      where: { id },
      data: { totalSpent: toNum(cur?.totalSpent || 0) + spent },
    });
  }

  return { orders: orderRows.filter(Boolean), payments: payments.length, items: items.length };
};

const ensureWarehouse = async (tenantId) => {
  const code = `${MARK}-KHO-CHINH`;
  const found = await prisma.warehouse.findFirst({ where: { tenantId, code }, select: { id: true } });
  const row = found
    ? await prisma.warehouse.update({
        where: { id: found.id },
        data: { name: "Kho chính (dữ liệu mẫu)", isDefault: true, isActive: true },
        select: { id: true },
      })
    : await prisma.warehouse.create({
        data: {
          tenantId,
          code,
          name: "Kho chính (dữ liệu mẫu)",
          address: `${rndInt(1, 200)} ${pick(DISTRICTS)}, TP. Hồ Chí Minh`,
          isDefault: true,
          isActive: true,
        },
        select: { id: true },
      });
  // Chỉ một kho mặc định trong tenant ⇒ bỏ cờ của các kho khác (nếu có).
  await prisma.warehouse.updateMany({
    where: { tenantId, id: { not: row.id }, isDefault: true },
    data: { isDefault: false },
  });
  return row;
};

const insertInventories = async (tenantId, warehouseId, productRows) => {
  for (const part of chunk(productRows)) {
    await prisma.inventory.createMany({
      data: part.map((p) => ({
        tenantId,
        productId: p.id,
        warehouseId,
        quantity: rndInt(40, 500),
        reserved: 0,
        // ROP hợp lý để màn hình "đề xuất nhập" của AISC26 có dữ liệu.
        minStock: rndInt(10, 40),
      })),
      skipDuplicates: true,
    });
  }
  return prisma.inventory.count({ where: { tenantId } });
};

const insertVendors = async (tenantId, vendors) => {
  for (const part of chunk(vendors)) {
    await prisma.vendor.createMany({
      data: part.map((v) => ({
        tenantId,
        code: v.code,
        name: v.name,
        taxCode: v.taxCode,
        phone: v.phone,
        email: v.email,
        address: v.address,
        contactPerson: v.contactPerson,
        paymentTerms: v.paymentTerms,
        totalDebt: 0,
        kraljicCategory: v.kraljicCategory,
        profitImpactScore: v.profitImpactScore,
        supplyRiskScore: v.supplyRiskScore,
        otifScore: v.otifScore,
        defectRate: v.defectRate,
        vendorGrade: v.vendorGrade,
        isActive: v.isActive,
      })),
      skipDuplicates: true,
    });
  }
  const rows = await prisma.vendor.findMany({ where: { tenantId }, select: { id: true, code: true } });
  return rows;
};

const insertDebts = async (tenantId, debts, vendorIds, customerIds) => {
  for (const part of chunk(debts)) {
    await prisma.debt.createMany({
      data: part.map((d) => ({
        tenantId,
        type: d.type,
        status:
          d.paidAmount <= 0
            ? d.dueDate < new Date()
              ? "OVERDUE"
              : "OPEN"
            : d.paidAmount >= d.amount
              ? "CLOSED"
              : "PARTIAL",
        amount: d.amount,
        paidAmount: d.paidAmount,
        dueDate: d.dueDate,
        vendorId: d.vendorIndex != null ? vendorIds[d.vendorIndex] || null : null,
        customerId: d.customerIndex != null ? customerIds[d.customerIndex] || null : null,
        note: d.note,
      })),
      skipDuplicates: true,
    });
  }
  return prisma.debt.count({ where: { tenantId } });
};

const insertContacts = async (tenantId, contacts) => {
  for (const part of chunk(contacts)) {
    await prisma.crmContact.createMany({
      data: part.map((c) => ({
        tenantId,
        fullName: c.fullName,
        phone: c.phone,
        email: c.email,
        jobTitle: c.jobTitle,
        isPrimary: c.isPrimary,
        customerId: c.customerId,
        isActive: true,
      })),
      skipDuplicates: true,
    });
  }
  const rows = await prisma.crmContact.findMany({
    where: { tenantId },
    select: { id: true, customerId: true },
  });
  return rows;
};

const insertLeads = async (tenantId, leads, stages, userId, contactIdByCustomerIndex = []) => {
  for (const part of chunk(leads)) {
    await prisma.crmLead.createMany({
      data: part.map((l) => ({
        tenantId,
        leadName: l.leadName,
        mobileNo: l.mobileNo,
        email: l.email,
        jobTitle: l.jobTitle,
        source: l.source,
        status: l.status,
        stageId: stages.LEAD[
          l.status === "CONVERTED" ? "Đã thành khách" : l.status === "DEAD" ? "Chết" : l.status === "QUALIFIED" ? "Đủ thông tin" : l.status === "CONTACTED" ? "Đã liên hệ" : "Lead mới"
        ],
        leadOwnerId: userId,
        contactId: l.contactCustomerIndex != null
          ? contactIdByCustomerIndex[l.contactCustomerIndex] || null
          : null,
        expectedValue: l.expectedValue,
        lastContactedAt: l.lastContactedAt,
        convertedAt: l.status === "CONVERTED" ? l.createdAt : null,
        notes: l.notes,
        createdAt: l.createdAt,
      })),
      skipDuplicates: true,
    });
  }
  const rows = await prisma.crmLead.findMany({ where: { tenantId }, select: { id: true } });
  return rows;
};

const insertDeals = async (tenantId, deals, stages, leadIds, customerIds, userId) => {
  for (const part of chunk(deals)) {
    await prisma.crmDeal.createMany({
      data: part.map((d) => ({
        tenantId,
        dealName: d.dealName,
        kind: d.kind,
        stageId: stages.DEAL[d.kind === "WON" ? "Chốt" : d.kind === "LOST" ? "Thua" : "Cơ hội mới"],
        value: d.value,
        currency: "VND",
        probability: d.probability,
        expectedCloseDate: d.expectedCloseDate,
        nextStep: d.nextStep,
        dealOwnerId: userId,
        closedAt: d.closedAt,
        lostReason: d.lostReason,
        leadId: d.leadIndex != null ? leadIds[d.leadIndex] || null : null,
        customerId: d.kind === "WON" && customerIds.length ? customerIds[d.index % customerIds.length].id : null,
        createdAt: d.createdAt,
      })),
      skipDuplicates: true,
    });
  }
  const rows = await prisma.crmDeal.findMany({ where: { tenantId }, select: { id: true } });
  return rows;
};

const insertCommunications = async (tenantId, comms, leadIds, dealIds, userId) => {
  for (const part of chunk(comms)) {
    await prisma.crmCommunication.createMany({
      data: part.map((c) => ({
        tenantId,
        type: c.type,
        direction: c.direction,
        subject: c.subject,
        content: c.content,
        durationSec: c.durationSec,
        leadId: c.leadIndex != null ? leadIds[c.leadIndex] || null : null,
        dealId: c.dealIndex != null ? dealIds[c.dealIndex] || null : null,
        createdById: userId,
        createdAt: c.createdAt,
      })),
      skipDuplicates: true,
    });
  }
  return prisma.crmCommunication.count({ where: { tenantId } });
};

const insertTasks = async (tenantId, tasks, customerIds, managerId, adminId) => {
  for (const part of chunk(tasks)) {
    await prisma.customerTask.createMany({
      data: part.map((t) => ({
        tenantId,
        customerId: customerIds[t.customerIndex % customerIds.length].id,
        title: t.title,
        description: t.description,
        status: t.status,
        priority: t.priority,
        dueAt: t.dueAt,
        assignedToId: t.status === "DONE" ? managerId : rnd() < 0.5 ? managerId : adminId,
        createdById: adminId,
        completedAt: t.completedAt,
        createdAt: t.createdAt,
      })),
      skipDuplicates: true,
    });
  }
  return prisma.customerTask.count({ where: { tenantId } });
};

// ---------------------------------------------------------------------------
// Xoá sạch (--reset) — đúng thứ tự phụ thuộc
// ---------------------------------------------------------------------------

// Prisma 7 + `$extends` KHÔNG hỗ trợ truy cập động `prisma[model]` ⇒ mọi nơi
// duyệt theo tên bảng đều phải gọi hàm cụ thể.
const MODELS = {
  product: (c) => prisma.product,
  inventoryTransaction: (c) => prisma.inventoryTransaction,
  inventory: (c) => prisma.inventory,
  warehouse: (c) => prisma.warehouse,
  vendor: (c) => prisma.vendor,
  debt: (c) => prisma.debt,
  category: (c) => prisma.category,
  customer: (c) => prisma.customer,
  customerNote: (c) => prisma.customerNote,
  customerTagOnCustomer: (c) => prisma.customerTagOnCustomer,
  order: (c) => prisma.order,
  orderItem: (c) => prisma.orderItem,
  payment: (c) => prisma.payment,
  crmLead: (c) => prisma.crmLead,
  crmContact: (c) => prisma.crmContact,
  crmDeal: (c) => prisma.crmDeal,
  crmDealItem: (c) => prisma.crmDealItem,
  crmCommunication: (c) => prisma.crmCommunication,
  refreshToken: (c) => prisma.refreshToken,
  savedReport: (c) => prisma.savedReport,
  reportSchedule: (c) => prisma.reportSchedule,
  employee: (c) => prisma.employee,
  shift: (c) => prisma.shift,
  notification: (c) => prisma.notification,
  auditLog: (c) => prisma.auditLog,
  loyaltyTransaction: (c) => prisma.loyaltyTransaction,
  storeCreditTransaction: (c) => prisma.storeCreditTransaction,
  promotionUsage: (c) => prisma.promotionUsage,
  invoice: (c) => prisma.invoice,
  campaignRecipient: (c) => prisma.campaignRecipient,
  crmPipelineStage: (c) => prisma.crmPipelineStage,
  customerCampaign: (c) => prisma.customerCampaign,
  customerSegment: (c) => prisma.customerSegment,
  goodsReceiptItem: (c) => prisma.goodsReceiptItem,
  goodsReceiptNote: (c) => prisma.goodsReceiptNote,
  purchaseItem: (c) => prisma.purchaseItem,
  purchaseOrder: (c) => prisma.purchaseOrder,
  churnAlert: (c) => prisma.churnAlert,
  promotion: (c) => prisma.promotion,
  customerTask: (c) => prisma.customerTask,
};

/**
 * Bảng phụ thuộc vào `customer` (FK) — phải xoá TRƯỚC khách hàng.
 *
 * VÌ SAO CẦN LIỆT KÊ TAY: `customers` có hàng chục bảng trỏ tới (loyalty,
 * store credit, debts, tasks, notes, churn_alerts, promotions...). Xoá sai thứ
 * tự là đụng lỗi `violates RESTRICT setting of foreign key constraint` và phải
 * đoán bảng nào tiếp theo — vừa chậm vừa dễ sót.
 *
 * `scripts/tenant-null.js` đã có bảng chân dung dữ liệu; ở đây chỉ cần các
 * bảng mà seed Phase 1 có thể sinh dữ liệu.
 */
const CUSTOMER_DEPENDENTS = [
  ["campaignRecipient", "người nhận chiến dịch"],
  ["loyaltyTransaction", "giao dịch tích điểm"],
  ["storeCreditTransaction", "giao dịch credit"],
  ["customerTask", "công việc CSKH"],
  ["customerNote", "ghi chú"],
  ["customerTagOnCustomer", "gắn tag"],
  ["churnAlert", "cảnh báo churn"],
  ["promotionUsage", "lượt dùng voucher"],
  ["invoice", "hoá đơn"],
  ["payment", "thanh toán"],
  ["orderItem", "chi tiết đơn"],
  ["order", "đơn hàng"],
  ["debt", "công nợ"],
];

const resetTenant = async (tenantId) => {
const order = [
    ["crmCommunication", "tương tác"],
    ["crmDealItem", "dòng deal"],
    ["crmDeal", "deal"],
    ["crmLead", "lead"],
    ...CUSTOMER_DEPENDENTS,
    ["customerCampaign", "chiến dịch"],
    ["customerSegment", "phân khúc"],
    ["goodsReceiptItem", "dòng phiếu nhận"],
    ["goodsReceiptNote", "phiếu nhận"],
    ["purchaseItem", "dòng đơn mua"],
    ["purchaseOrder", "đơn mua"],
    ["crmContact", "contact"],
    // `products` phải SAU mọi bảng có FK trỏ tới product:
    // inventories, goodsReceiptItem, purchaseItem, orderItem, crmDealItem.
    ["inventoryTransaction", "giao dịch kho"],
    ["inventory", "tồn kho"],
    ["goodsReceiptItem", "dòng phiếu nhận"],
    ["goodsReceiptNote", "phiếu nhận"],
    ["purchaseItem", "dòng đơn mua"],
    ["purchaseOrder", "đơn mua"],
    ["product", "sản phẩm"],
    ["vendor", "nhà cung cấp"],
    ["churnAlert", "cảnh báo churn"],
    ["promotion", "voucher/khuyến mãi"],
    ["warehouse", "kho"],
    ["customer", "khách hàng"],
    ["category", "danh mục"],
    ["crmPipelineStage", "giai đoạn pipeline"],
  ];
  const counts = [];
  for (const [model, label] of order) {
    const accessor = MODELS[model];
    if (typeof accessor !== "function") {
      // Ném kèm TÊN bảng thiếu: nếu không, chỉ thấy "MODELS[model] is not a
      // function" mà không biết là quên khai báo model nào.
      throw new Error(`[seed:phase1] reset: chưa khai báo accessor cho model "${model}" (${label}) trong MODELS`);
    }
    const n = await accessor().deleteMany({ where: { tenantId } });
    if (n.count) counts.push(`${label}=${n.count}`);
  }
  // Dữ liệu sinh ra khi chạy check script (session, thông báo, audit) cũng
  // trỏ tới user/tenant ⇒ phải dọn trước khi xoá user, nếu không FK RESTRUNT.
  // Dữ liệu sinh ra khi chạy check script (refresh token, thông báo, audit) có
  // thể `tenantId = NULL` — token được tạo qua HTTP login khi extension không ép
  // tenantId vào bảng token. Vì vậy xoá theo `userId` của chính user Phase 1,
  // không xoá theo `tenantId` (sẽ bỏ sót dòng NULL và FK RESTRUNT chặn xoá user).
  const phaseUsers = await prisma.user.findMany({
    where: { tenantId, email: { startsWith: MARK } },
    select: { id: true },
  });
  const phaseUserIds = phaseUsers.map((u) => u.id);
  // Bảng trỏ user qua `userId` (token, thông báo) và qua `createdById` (báo cáo,
  // chiến dịch, PO/GRN). Các dòng này có thể `tenantId = NULL` nên xoá theo
  // tenantId không trúng ⇒ phải xoá theo user đã biết.
  const BY_USER_ID = ["refreshToken", "notification", "auditLog"];
  const BY_CREATED_BY = [
    "savedReport",
    "customerSegment",
    "customerCampaign",
    "purchaseOrder",
    "goodsReceiptNote",
    "order",
  ];
  // `Employee` / `ReportSchedule` không có `createdById` ⇒ xoá theo tenant thôi.
  for (const model of ["reportSchedule", "employee", "shift"]) {
    await MODELS[model]().deleteMany({ where: { tenantId } });
  }
  if (phaseUserIds.length) {
    for (const model of BY_USER_ID) {
      await MODELS[model]().deleteMany({ where: { userId: { in: phaseUserIds } } });
    }
    for (const model of BY_CREATED_BY) {
      await MODELS[model]().deleteMany({ where: { createdById: { in: phaseUserIds } } });
    }
  }
  const subs = await prisma.tenantSubscription.deleteMany({ where: { tenantId } });
  const users = await prisma.user.deleteMany({ where: { tenantId, email: { startsWith: MARK } } });
  const tenant = await prisma.tenant.deleteMany({ where: { id: tenantId } });
  if (subs.count) counts.push(`gói cướng=${subs.count}`);
  if (users.count) counts.push(`tài khoản=${users.count}`);
  return { counts, tenantDeleted: tenant.count };
};

// ---------------------------------------------------------------------------
// Báo cáo số dòng (dùng cả cho dry-run lẫn sau khi ghi)
// ---------------------------------------------------------------------------

const REPORT_TABLES = [
  ["products", "product", "sản phẩm"],
  ["customers", "customer", "khách hàng"],
  ["orders", "order", "đơn hàng"],
  ["order_items", "orderItem", "chi tiết đơn"],
  ["payments", "payment", "thanh toán"],
  ["crm_leads", "crmLead", "lead"],
  ["crm_deals", "crmDeal", "deal"],
  ["crm_communications", "crmCommunication", "tương tác"],
  ["customer_tasks", "customerTask", "công việc CSKH"],
];

const reportCounts = async (tenantId) => {
  const out = [];
  for (const [table, model, label] of REPORT_TABLES) {
    const n = await MODELS[model]().count({ where: { tenantId } });
    out.push({ table, label, rows: n, ok: n >= MIN_ROWS });
  }
  return out;
};

const printReport = (rows) => {
  console.log("");
  console.log(`  ${"bảng".padEnd(22)}${"mô tả".padEnd(16)}${"số dòng".padStart(9)}   >= ${MIN_ROWS}?`);
  console.log(`  ${"-".repeat(62)}`);
  for (const r of rows) {
    console.log(`  ${r.table.padEnd(22)}${r.label.padEnd(16)}${String(r.rows).padStart(9)}   ${r.ok ? "OK" : "THIEU"}`);
  }
  const missing = rows.filter((r) => !r.ok);
  console.log("");
  console.log(missing.length ? `  ${missing.length} bảng CHƯA đạt ngưỡng.` : `  ĐẠT: ${rows.length}/${rows.length} bảng >= ${MIN_ROWS} dòng.`);
  return missing;
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const parseArgs = () => {
  const argv = process.argv.slice(2);
  const out = { apply: false, reset: false };
  for (const a of argv) {
    if (a === "--apply") out.apply = true;
    else if (a === "--reset") out.reset = true;
  }
  return out;
};

async function main() {
  const args = parseArgs();

  // --reset: xoá tenant Phase 1 rồi DỪNG. Dựng lại bằng lệnh sau (--apply).
  if (args.reset) {
    const found = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG }, select: { id: true, name: true } });
    if (!found) {
      console.log(`[reset] Chưa có tenant "${TENANT_SLUG}" — không có gì để xoá.`);
      await prisma.$disconnect();
      return;
    }
    if (!args.apply) {
      console.log(`[reset] DRY-RUN — sẽ xoá tenant "${found.name}" và toàn bộ dữ liệu Phase 1 trong đó.`);
      console.log("[reset] Thêm --apply để xoá thật.");
      await prisma.$disconnect();
      return;
    }
    const res = await resetTenant(found.id);
    console.log(`[reset] Đã xoá: ${res.counts.join(", ") || "(không có dữ liệu)"}; tenantDeleted=${res.tenantDeleted}`);
    console.log("[reset] Chạy lại `npm run seed:phase1` để dựng dữ liệu mới.");
    await prisma.$disconnect();
    return;
  }

  const tenant = await ensureTenant();

  // Đã có dữ liệu Phase 1 → không nhân bản.
  const existing = await prisma.customer.count({ where: { tenantId: tenant.id } });
  if (existing >= TARGET.customers) {
    console.log(`[seed:phase1] Tenant ${tenant.slug} đã có ${existing} khách hàng (>= ${TARGET.customers}).`);
    console.log("[seed:phase1] KHÔNG nhân bản. Dùng --reset để dựng lại.");
    const rows = await reportCounts(tenant.id);
    printReport(rows);
    await prisma.$disconnect();
    return;
  }

  const products = buildProducts(TARGET.products);
  const customers = buildCustomers(TARGET.customers);
  const vendors = buildVendors(TARGET.vendors);
  const debts = buildDebts(TARGET.debts, vendors, customers);
  const leads = buildLeads(TARGET.leads);
  const deals = buildDeals(TARGET.deals, TARGET.leads);
  const comms = buildCommunications(TARGET.communications, TARGET.leads, TARGET.deals);
  const tasks = buildTasks(TARGET.tasks, TARGET.customers);

  console.log("=== KẾ HOẠCH SEED PHASE 1 ===");
  console.log(`  tenant   : ${tenant.name} (${tenant.slug})`);
  console.log(`  tài khoản: ${MARK}.admin@crm.local / ${MARK}.manager@crm.local / ${MARK}.cashier@crm.local (mật khẩu: ${PASSWORD})`);
  console.log(`  gói cướng : ${PLAN_KEY}`);
  console.log(`  số liệu  : ${TARGET.customers} khách, ${TARGET.products} sản phẩm, ${TARGET.leads} lead, ${TARGET.deals} deal,`);
  console.log(`             ${TARGET.communications} tương tác, ${TARGET.tasks} công việc, đơn hàng sinh từ lịch sử mua`);
  console.log(`  mode     : ${args.apply ? "APPLY (ghi thật)" : "DRY-RUN (thêm --apply để ghi)"}`);

  if (!args.apply) {
    console.log("");
    console.log("=== SỐ DÒNG HIỆN TẠI TRONG TENANT NÀY (dry-run) ===");
    printReport(await reportCounts(tenant.id));
    console.log("");
    console.log("=> Không ghi gì. Thêm --apply để nạp dữ liệu.");
    await prisma.$disconnect();
    return;
  }

  const summary = await runWithTenant(tenant.id, async () => {
    step("tạo tài khoản 3 vai trò...");
    const users = await ensureUsers(tenant.id);
    step("gắn gói cướng...");
    const subscriptionId = await ensureSubscription(tenant.id);
    step("tạo giai đoạn pipeline...");
    const stages = await ensureStages(tenant.id);
    step("tạo danh mục...");
    const category = await ensureCategory(tenant.id);

    step(`nạp ${products.length} sản phẩm...`);
    const productRows = await insertProducts(tenant.id, category.id, products);
    const productIds = productRows.map((p) => p.id);
    step(`  -> ${productIds.length} sản phẩm`);

    step(`nạp ${customers.length} khách hàng...`);
    const customerRows = await insertCustomers(tenant.id, customers);
    const customerIdByPhone = new Map(customerRows.map((c) => [c.phone, c.id]));
    const byIndex = customers.map((c) => ({ id: customerIdByPhone.get(c.phone) })).filter((c) => c.id);
    step(`  -> ${byIndex.length} khách`);

    // Gắn SĐT khách vào từng đơn để insertOrders map được customerId.
    step("dựng lịch sử đơn hàng...");
    const orders = buildOrders(customers, productIds);
    orders.forEach((o) => { o.customerPhone = customers[o.customerIndex].phone; });
    step(`  -> ${orders.length} đơn`);

    step("ghi đơn + chi tiết + thanh toán...");
    const orderRes = await insertOrders(tenant.id, orders, customerIdByPhone, users.ADMIN.id);
    step(`  -> ${orderRes.orders.length} đơn, ${orderRes.items} dòng, ${orderRes.payments} thanh toán`);

    step(`nạp ${TARGET.contacts} contact (cầu nối để 360 có tương tác)...`);
    const contactsSpec = buildContacts(customers);
    const contactRows = await insertContacts(
      tenant.id,
      contactsSpec.map((c) => ({ ...c, customerId: byIndex[c.customerIndex]?.id || null })),
    );
    // Map theo thứ tự khách để lead gắn đúng contact.
    const contactIdByCustomerIndex = contactsSpec.map((c) => {
      const row = contactRows.find((r) => r.customerId === byIndex[c.customerIndex]?.id);
      return row?.id || null;
    });
    step(`  -> ${contactRows.length} contact`);

    step(`nạp ${leads.length} lead...`);
    const leadRows = await insertLeads(tenant.id, leads, stages, users.MANAGER.id, contactIdByCustomerIndex);
    const leadIds = leadRows.map((l) => l.id);

    step(`nạp ${deals.length} deal...`);
    const dealRows = await insertDeals(tenant.id, deals, stages, leadIds, byIndex, users.MANAGER.id);
    const dealIds = dealRows.map((d) => d.id);

    step(`nạp ${comms.length} tương tác...`);
    const commCount = await insertCommunications(tenant.id, comms, leadIds, dealIds, users.MANAGER.id);
    step(`nạp ${TARGET.tasks} công việc CSKH...`);
    const taskCount = await insertTasks(tenant.id, tasks, byIndex, users.MANAGER.id, users.ADMIN.id);

    step(`nạp ${vendors.length} nhà cung cấp (R-06/R-07)...`);
    const vendorRows = await insertVendors(tenant.id, vendors);
    const vendorIds = vendorRows.map((v) => v.id);

    step("tạo kho chính + tồn kho cho từng SKU...");
    const warehouse = await ensureWarehouse(tenant.id);
    const inventoryCount = await insertInventories(tenant.id, warehouse.id, productRows);

    step(`nạp ${debts.length} công nợ (R-09)...`);
    const debtCount = await insertDebts(
      tenant.id,
      debts,
      vendorIds,
      byIndex.map((c) => c.id),
    );

    step("tạo phân khúc + chiến dịch + người nhận (R-05)...");
    const campaignStats = await insertSegmentsAndCampaigns(
      tenant.id,
      byIndex,
      users.MANAGER.id,
    );

    step(`dựng chuỗi PO → GRN → QC (R-08)...`);
    const grnStats = await insertPurchaseAndReceipts(
      tenant.id,
      vendorRows,
      productRows,
      warehouse.id,
      users.ADMIN.id,
    );

    return {
      subscriptionId,
      products: productRows.length,
      customers: customerRows.length,
      orders: orderRes.orders.length,
      orderItems: orderRes.items,
      payments: orderRes.payments,
      leads: leadRows.length,
      deals: dealRows.length,
      communications: commCount,
      tasks: taskCount,
      vendors: vendorRows.length,
      debts: debtCount,
      inventories: inventoryCount,
      ...campaignStats,
      ...grnStats,
    };
  });

  console.log("");
  console.log("=== ĐÃ GHI ===");
  for (const [k, v] of Object.entries(summary)) console.log(`  ${k.padEnd(16)} ${v}`);

  const rows = await reportCounts(tenant.id);
  const missing = printReport(rows);

  console.log("");
  console.log("=== ĐĂNG NHẬP ĐƯỢC (3 vai trò) ===");
  console.log(`  ADMIN   : ${MARK}.admin@crm.local   / ${PASSWORD}`);
  console.log(`  MANAGER : ${MARK}.manager@crm.local / ${PASSWORD}`);
  console.log(`  CASHIER : ${MARK}.cashier@crm.local / ${PASSWORD}`);
  console.log(`  tenant  : ${tenant.slug}`);

  await prisma.$disconnect();
  if (missing.length) process.exitCode = 1;
}

main().catch(async (e) => {
  logger.error(`[seed:phase1] thất bại: ${String(e && e.message ? e.message : e)}`);
  console.error("ERR", e.message);
  try { await prisma.$disconnect(); } catch { /* ignore */ }
  process.exit(1);
});
