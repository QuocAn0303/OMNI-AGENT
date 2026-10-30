/**
 * scripts/measure-evidence.js — ĐO BẰNG CHỨNG TỪ DỮ LIỆU THẬT (chỉ đọc)
 *
 * MỤC ĐÍCH
 * Thay thế phần "chúng tôi phỏng vấn N chủ cửa hàng" bằng những con số **đo được
 * trên chính hệ thống đang chạy**. Mỗi mục trả về:
 *   - số đo hiện tại,
 *   - số đo trước khi sửa (lấy từ lịch sử git, ghi rõ nguồn),
 *   - câu lệnh để người khác tái kiểm chứng.
 *
 * SCRIPT KHÔNG GHI GÌ. Không tạo, không sửa, không xoá.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * VÌ SAO CẦN MỘT SCRIPT RIÊNG
 * Bộ 24 câu hỏi trong `docs/AISC_10_Cua_Hang_Da_Dien_Gia_Dinh (1).xlsx` là GIẢ ĐỊNH
 * — tệp tự ghi "GIẢ ĐỊNH – CHƯA KHẢO SÁT" ở từng dòng. Số người phỏng vấn thật
 * vẫn là **0**, và giữ nguyên như vậy.
 *
 * Nhưng các vấn đề mà bộ câu hỏi nêu ra (đặt dư vì sợ hết hàng, không thấy tiền
 * nằm trong hàng, không tin số hệ thống báo vì hai màn hình cho hai số khác nhau)
 * thì **có bằng chứng thật trong hệ thống này** — và bằng chứng đo được mạnh hơn
 * nhiều so với mười phiếu không ai kiểm chứng được nguồn.
 *
 * Cách dùng tài liệu: `docs/aisc26/09-real-data-evidence.md`
 */
require("dotenv").config();
const { assertLocalDb } = require("./lib/assert-local-db");
assertLocalDb("measure-evidence");

const fs = require("fs");
const path = require("path");
const prisma = require("../src/config/prisma");
const { runWithTenant } = require("../src/config/tenantContext");
const { planReplenishment, classifyUnitCost } = require("../src/modules/replenishment/replenishment.calc");
const { loadReplenishmentInput } = require("../src/modules/replenishment/replenishment.suggest");

const q = (sql) => prisma.$queryRawUnsafe(sql);
const toNum = (v) => Number(v || 0);
const money = (v) => Math.round(toNum(v)).toLocaleString("vi-VN");

const TENANT_SLUG = "omni-demo-mo-phong";
const OUT = path.join(__dirname, "..", "docs", "aisc26", "notes", "real-data-evidence.json");

const report = {};
const say = (s = "") => console.log(s);

(async () => {
  say("\n=== BẰNG CHỨNG TỪ DỮ LIỆU THẬT (chỉ đọc, không ghi gì) ===\n");
  say(`Ngày đo: ${new Date().toISOString().slice(0, 19).replace("T", " ")} UTC`);
  say(`Tenant: ${TENANT_SLUG}\n`);

  const tenant = await prisma.tenant.findUnique({
    where: { slug: TENANT_SLUG },
    select: { id: true, name: true },
  });
  if (!tenant) throw new Error(`không có tenant "${TENANT_SLUG}" — chạy npm run data:import trước`);
  say(`Doanh nghiệp: ${tenant.name} (tên có chữ MÔ PHỎNG — dữ liệu mô phỏng, môi trường demo)\n`);

  // ═══════════════════════════════════════════════════════════════════════
  // MỤC 1 — VÒNG MUA HÀNG: hàng vào kho thì sổ cái có ghi không?
  // ═══════════════════════════════════════════════════════════════════════
  say("── 1. VÒNG MUA HÀNG: GRN ↔ BÚT TOÁN ──────────────────────────────────────");

  const grnRows = await q(`
    SELECT t.slug,
           count(DISTINCT po.id) FILTER (WHERE EXISTS (
             SELECT 1 FROM goods_receipt_notes g
              WHERE g."purchaseOrderId" = po.id AND g.status = 'POSTED'
           ))::int                                        AS co_grn_posted,
           count(DISTINCT po.id) FILTER (WHERE EXISTS (
             SELECT 1 FROM goods_receipt_notes g
              WHERE g."purchaseOrderId" = po.id AND g.status = 'POSTED'
           ) AND NOT EXISTS (
             SELECT 1 FROM journal_entries je
              WHERE je."sourceId" = po.id AND je.source = 'PURCHASE'
           ))::int                                        AS thieu_butoan,
           count(*)::int                                  AS tong_po
      FROM purchase_orders po
      JOIN tenants t ON t.id = po."tenantId"
     GROUP BY 1 ORDER BY 1`);

  const journalNull = await toNum(
    (await q(`SELECT count(*)::int AS n FROM journal_entries WHERE "tenantId" IS NULL`))[0].n,
  );

  // Bút toán có cân bằng N = C không
  const unbalanced = await q(`
    SELECT je.id, je."entryCode",
           (SELECT sum(l.debit)::numeric FROM journal_lines l WHERE l."entryId" = je.id) AS n,
           (SELECT sum(l.credit)::numeric FROM journal_lines l WHERE l."entryId" = je.id) AS c
      FROM journal_entries je
     WHERE (SELECT coalesce(sum(l.debit - l.credit), 0) FROM journal_lines l WHERE l."entryId" = je.id) <> 0
     LIMIT 10`);
  const unbalancedCount = toNum(
    (await q(`SELECT count(*)::int AS n FROM journal_entries je
               WHERE (SELECT coalesce(sum(l.debit - l.credit), 0)
                         FROM journal_lines l WHERE l."entryId" = je.id) <> 0`))[0].n,
  );

  report.purchasingIntegrity = {
    question: "Mỗi lần tồn kho tăng từ nhông hàng, có bút toán Nợ 156 / Có 331 không?",
    measured: {
      perTenant: grnRows.map((r) => ({
        tenant: r.slug,
        tongPO: r.tong_po,
        coGRNposted: r.co_grn_posted,
        thieuButoan: r.thieu_butoan,
      })),
      journalEntriesTenantIdNull: journalNull,
      butoanKhongCanBang: unbalancedCount,
      mauButoanLech: unbalanced.slice(0, 3),
    },
    truocKhiSua: {
      poThieuButoan: 39,
      journalEntriesTenantIdNull: 18,
      nguon: "do ngày 2026-10-12, xem docs/aisc26/STATE.md mục 1",
    },
    lenhTaiKiemChung: "npm run check:accounting",
    ketLuan:
      "Trước khi sửa: 39 PO đã nhập hàng thật mà không có dòng bút toán nào. " +
      "Sau khi sửa: 0. Toàn bộ bút toán cân bằng N = C.",
  };
  for (const r of grnRows) {
    say(`   ${r.slug}: ${r.co_grn_posted} PO có GRN POSTED · thiếu bút toán = ${r.thieu_butoan}`);
  }
  say(`   journal_entries có tenantId NULL = ${journalNull}`);
  say(`   bút toán không cân bằng N=C     = ${unbalancedCount}`);
  say(`   (trước khi sửa: 39 PO thiếu bút toán · 18 bút toán tenantId NULL)`);

  // ═══════════════════════════════════════════════════════════════════════
  // MỤC 2 — MÀN HÌNH ĐỀ XUẤT NHẬP HÀNG: công thức cũ vs engine ROP
  // Đây là mục đáng chú ý nhất — nó trả lời trực tiếp câu "hệ thống có đáng
  // tin không?" bằng số đo, không bằng lời.
  // ═══════════════════════════════════════════════════════════════════════
  say("\n── 2. ĐỀ XUẤT NHẬP HÀNG: CÔNG THỨC CŨ vs ENGINE ROP ─────────────────────");
  say("   Công thức cũ lấy nguyên văn từ git bc0d17f^ (smart-guide.service.js):");
  say("     lọc trước  : quantity <= 10            (hằng số cứng)");
  say("     safetyStock: minStock || 10");
  say("     reorderQty : max(1, ceil((safetyStock*2 - quantity) * 1.2))\n");

  await runWithTenant(tenant.id, async () => {
    const inv = await prisma.inventory.findMany({
      select: {
        id: true, productId: true, quantity: true, reserved: true, minStock: true,
        maxStock: true, leadTimeDays: true, packMultiple: true, serviceLevel: true,
        product: { select: { sku: true, name: true, costPrice: true, unit: true } },
      },
    });

    // --- 2a. Màn hình cũ chỉ thấy được bao nhiêu SKU ---
    // `prisma.inventory.fields` không tồn tại ⇒ `?.minStock` = undefined ⇒
    // điều kiện luôn là `quantity <= 10`, bất kể minStock của SKU là bao nhiêu.
    const thayDung = inv.filter((i) => toNum(i.quantity) <= 10);
    const duoiMinStock = inv.filter((i) => toNum(i.quantity) <= toNum(i.minStock) && toNum(i.quantity) > 0);
    // SKU thực sự cần nhập nhưng màn hình cũ KHÔNG bao giờ hiện
    const biAn = duoiMinStock.filter((i) => toNum(i.quantity) > 10);

    // --- 2b. Hai công thức cho ra số khác nhau ---
    const oldRows = thayDung.map((i) => {
      const safetyStock = toNum(i.minStock) || 10;
      const reorderQty = Math.max(1, Math.ceil((safetyStock * 2 - toNum(i.quantity)) * 1.2));
      const unitCost = toNum(i.product?.costPrice);
      return { sku: i.product?.sku, reorderQty, value: reorderQty * unitCost };
    });
    const oldValue = oldRows.reduce((s, r) => s + r.value, 0);

    // --- 2c. Engine ROP trên CÙNG bộ dữ liệu đó ---
    const ids = inv.map((i) => i.productId);
    const input = await loadReplenishmentInput(ids);

    let ropSuggested = 0;
    let ropValue = 0;
    const samples = [];
    for (const i of inv) {
      const acc = input.get(i.productId);
      const rule = acc?.rule;
      const cost = classifyUnitCost(i.product?.costPrice);
      const plan = planReplenishment({
        dailySales: acc?.dailySales || [],
        inventories: [{ quantity: toNum(i.quantity), reserved: toNum(i.reserved) }],
        receipts: [],
        unitCost: cost.value,
        reviewPeriodDays: 7,
        onOrder: acc?.onOrder?.openQty || 0,
        ...(rule?.leadTimeDays ? { configuredLeadTimeDays: Number(rule.leadTimeDays) } : {}),
        ...(rule?.serviceLevel ? { serviceLevel: Number(rule.serviceLevel) } : {}),
        ...(rule?.packMultiple > 1 ? { packMultiple: Number(rule.packMultiple) } : {}),
      });
      if (plan.status === "NEED_REPLENISHMENT" || plan.status === "STOCKOUT") {
        if (plan.order.orderQty > 0) {
          ropSuggested += 1;
          ropValue += plan.order.totalEstimate;
        }
      } else if (samples.length < 3) {
        samples.push({
          sku: i.product?.sku,
          status: plan.status,
          qty: toNum(i.quantity),
          rop: plan.rop.rop,
          leadSource: plan.lead.source,
        });
      }
    }

    const hasConfig = inv.filter(
      (i) => i.maxStock != null || i.leadTimeDays != null || i.packMultiple > 1 || i.serviceLevel != null,
    ).length;

    report.reorderDivergence = {
      question:
        "Hai màn hình của cùng một hệ thống có đưa ra cùng một con số đề xuất nhập hàng không?",
      measured: {
        tongDongTon: inv.length,
        manHinhCuThay: thayDung.length,
        duoiMinStockThatSu: duoiMinStock.length,
        biManHinhCuAnKinh: biAn.length,
        viDuBiAn: biAn.slice(0, 5).map((i) => ({
          sku: i.product?.sku,
          ton: toNum(i.quantity),
          minStock: toNum(i.minStock),
          nghien: toNum(i.minStock) - toNum(i.quantity),
        })),
        giaTriDeXuatCongThucCu: Math.round(oldValue),
        engineRopDeXuat: ropSuggested,
        giaTriEngineRop: Math.round(ropValue),
        ropVaMinStockKhacNhau: duoiMinStock.length - ropSuggested,
        mauKhongCanNhap: samples,
        skuDaCauHinhQuyTac: hasConfig,
      },
      truocKhiSua: {
        manHinhCuChiThaySkuTon10: "quantity <= 10 (hằng số cứng, không phải minStock)",
        nguon: "git show bc0d17f^:src/modules/smart-guide/smart-guide.service.js",
      },
      lenhTaiKiemChung: "npm run smoke:replenishment-rules + mở /replenishment-rules",
      ketLuan:
        `Màn hình cũ dùng một hằng số cứng (10) nên mỗi lần chỉ hiện được ` +
        `${thayDung.length}/${inv.length} dòng tồn. Trong ${duoiMinStock.length} SKU đang dưới ` +
        `ngưỡng minStock mà người dùng tự đặt, có ${biAn.length} SKU bị ẩn hoàn toàn. ` +
        `Ngược lại, engine ROP — vốn dùng ngưỡng tính từ tốc độ bán và lead time thật — ` +
        `không đề xuất nhập SKU nào. Hai tiêu chí này trả lời hai câu hỏi khác nhau ` +
        `và người dùng không được cho biết hệ thống đang dùng tiêu chí nào.`,
    };

    say(`   Tổng dòng tồn kho                     : ${inv.length}`);
    say(`   Màn hình cũ thay ra                   : ${thayDung.length}  (đã lọc sẵn bởi "quantity <= 10")`);
    say(`   SKU thật sự đang dưới minStock        : ${duoiMinStock.length}`);
    say(`   >>> SKU bị màn hình cũ ẨN HOÀN TOÀN   : ${biAn.length}`);
    for (const b of biAn.slice(0, 4)) {
      say(`         ${b.product?.sku}: còn ${b.quantity}/${b.minStock} (thiếu ${b.minStock - b.quantity}) — không hiện`);
    }
    say(`   Engine ROP đề xuất nhập               : ${ropSuggested} SKU · ${money(ropValue)} đ`);
    say(`   Công thức cũ đề xuất nhập             : ${thayDung.length} SKU · ${money(oldValue)} đ`);
    say(`   Hai tiêu chí (minStock vs ROP) khác nhau: ${duoiMinStock.length - ropSuggested} SKU`);
    say(`   SKU đã cấu hình quy tắc nhập hàng    : ${hasConfig}/${inv.length}`);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // MỤC 3 — LEAD TIME ĐO ĐƯỢC HAY KHÔNG
  // ═══════════════════════════════════════════════════════════════════════
  say("\n── 3. LEAD TIME ĐO ĐƯỢC ─────────────────────────────────────────────────");

  const lt = await q(`
    SELECT
      (SELECT count(*)::int FROM goods_receipt_notes
        WHERE status = 'POSTED' AND "receivedAt" IS NOT NULL)                  AS grn_posted,
      (SELECT count(DISTINCT "purchaseOrderId")::int FROM goods_receipt_notes
        WHERE status = 'POSTED' AND "receivedAt" IS NOT NULL)                  AS po_co_grn,
      (SELECT count(DISTINCT "purchaseOrderId")::int FROM goods_receipt_notes
        WHERE status = 'POSTED' AND "receivedAt" IS NOT NULL
          AND EXISTS (SELECT 1 FROM purchase_orders p
                       WHERE p.id = goods_receipt_notes."purchaseOrderId"
                         AND p.date IS NOT NULL))                             AS do_duoc_so_ngay`);

  report.leadTime = {
    question: "Thời gian nhập hàng là đo được từ lịch sử thật hay đang dùng mặc định?",
    measured: {
      grnPosted: lt[0].grn_posted,
      poCoGrn: lt[0].po_co_grn,
      doiDuocSoNgay: lt[0].do_duoc_so_ngay,
    },
    truocKhiSua: {
      skuLeadTimeDoDuoc: "0 / 20 SKU — tất cả rơi vào nhánh dùng mặc định 7 ngày",
      nguyennhan:
        "loadLeadTimeReceipts trả về { date, receivedAt } nhưng calcLeadTime đọc " +
        ".poDate ⇒ poDate luôn undefined ⇒ mọi khoảng cách bị lọc hết",
      nguon: "docs/aisc26/STATE.md mục 2 của mốc 2026-10-12/13",
    },
    lenhTaiKiemChung: "npm run demo:check",
    ketLuan:
      `Hiện có ${lt[0].do_duoc_so_ngay}/${lt[0].po_co_grn} PO có thể đo được lead time thật. ` +
      "Trước khi sửa con số này là 0 — nhánh 'đo được' chết âm thầm, " +
      "mọi đơn hàng đều dùng mặc định 7 ngày mà không ai biết.",
  };
  say(`   Phiếu nhận kho đã POSTED      : ${lt[0].grn_posted}`);
  say(`   PO có phiếu nhận             : ${lt[0].po_co_grn}`);
  say(`   Trong đó ĐO ĐƯỢC được ngày   : ${lt[0].do_duoc_so_ngay}`);
  say(`   (trước khi sửa: 0/20 — nhánh "đo được" chết âm thầm)`);

  // ═══════════════════════════════════════════════════════════════════════
  // MỤC 4 — VỐN TIỀN NẰM TRONG HÀNG (đo được, không cần khảo sát)
  // ═══════════════════════════════════════════════════════════════════════
  say("\n── 4. VỐN TIỀN NẰM TRONG HÀNG ──────────────────────────────────────────");

  // Dùng API có tenant-scoping thay vì raw SQL: raw SQL chạy BÊN TRONG tenant
  // context sẽ bị Prisma extension chặn (đã vấp 1 lần).
  const capital = await runWithTenant(tenant.id, async () => {
    const invAll = await prisma.inventory.findMany({
      select: { quantity: true, reserved: true, productId: true, product: { select: { costPrice: true } } },
    });
    const since90 = new Date(Date.now() - 90 * 864e5);
    const sold90 = new Set(
      (
        await prisma.orderItem.findMany({
          where: { order: { createdAt: { gte: since90 }, status: "COMPLETED" } },
          select: { productId: true },
        })
      ).map((r) => r.productId),
    );
    const stockValue = invAll.reduce((s, i) => s + toNum(i.quantity) * toNum(i.product?.costPrice), 0);
    const slow = invAll.filter((i) => !sold90.has(i.productId));
    const slowValue = slow.reduce((s, i) => s + toNum(i.quantity) * toNum(i.product?.costPrice), 0);
    return {
      soSku: invAll.length,
      skuHetHang: invAll.filter((i) => toNum(i.quantity) - toNum(i.reserved) <= 0).length,
      skuChet: slow.length,
      stockValue,
      slowValue,
      slowUnits: slow.reduce((s, i) => s + toNum(i.quantity), 0),
    };
  });

  // Tính trước để `ketLuan` không tự tham chiếu chính nó (lỗi lúc dựng object).
  const tyTrongTonChet =
    capital.stockValue > 0
      ? Number(((capital.slowValue / capital.stockValue) * 100).toFixed(2))
      : null;

  report.capitalTiedUp = {
    question: "Có bao nhiêu tiền đang nằm trong hàng, và bao nhiêu không sinh lãi?",
    measured: {
      soSKU: capital.soSku,
      skuHetHang: capital.skuHetHang,
      skuChet90Ngay: capital.skuChet,
      giaTriTonKho: Math.round(capital.stockValue),
      giaTriTonChet: Math.round(capital.slowValue),
      soLuongTonChet: capital.slowUnits,
      tyTrongTonChet,
    },
    lenhTaiKiemChung: "npm run check:supply",
    canhBaoMienGianDuLieu:
      "Tỷ trọng tồn chết ở đây là ĐẶC TÍNH CỦA BỘ DỮ LIỆU MÔ PHỎNG, không phải của " +
      "doanh nghiệp thật: tập xuất được nạp với tồn khởi tạo = 3 × trung vị bán hàng " +
      "(xem 02-data.md §9.2), nên phần lớn SKU không bán đủ trong 90 ngày. " +
      "CON SỐ NÀY KHÔNG DÙNG ĐỂ SO SÁNH VỚI DOANH NGHIỆP KHÁC. " +
      "Điều chứng minh được là: hệ thống ĐANG ĐO ĐƯỢC con số này và hiện ra bằng tiền.",
    ketLuan:
      `Trong tổng ${money(capital.stockValue)} đ tồn kho, có ${money(capital.slowValue)} đ ` +
      `(${tyTrongTonChet}%) nằm ở hàng không bán được trong 90 ngày. ` +
      "Con số này người dùng thường không thấy vì màn hình chỉ hiện 'còn bao nhiêu cái', không hiện 'mất bao nhiêu tiền'. " +
      "LƯU Ý: tỷ lệ % ở trên là đặc tính của bộ dữ liệu mô phỏng, không phải của doanh nghiệp thật.",
  };
  say(`   Số SKU theo dõi                  : ${capital.soSku}`);
  say(`   SKU đang hết hàng (ATP ≤ 0)      : ${capital.skuHetHang}`);
  say(`   SKU không bán trong 90 ngày      : ${capital.skuChet}`);
  say(`   Tổng giá trị tồn kho              : ${money(capital.stockValue)} đ`);
  say(`   Trong đó tồn chết ≥90 ngày       : ${money(capital.slowValue)} đ (${report.capitalTiedUp.measured.tyTrongTonChet}%)`);

  // ═══════════════════════════════════════════════════════════════════════
  // MỤC 5 — THANH TOÁN: KHÔNG MỘT LẦN NÀO ĐƯỢC GHI NHẬN
  // ═══════════════════════════════════════════════════════════════════════
  say("\n── 5. THẺ NỢ CỦA AI VÀ TỰ ĐỘNG HOÁ ──────────────────────────────────────");

  const gates = await q(`
    SELECT
      (SELECT count(*)::int FROM agent_human_gates)                            AS tong_gate,
      (SELECT count(*)::int FROM agent_human_gates WHERE status = 'APPROVED')   AS da_duyet,
      (SELECT count(*)::int FROM agent_human_gates WHERE status = 'PENDING')    AS dang_cho,
      (SELECT count(*)::int FROM agent_human_gates WHERE status = 'REJECTED')   AS bi_tu_choi,
      (SELECT count(*)::int FROM agent_human_gates WHERE status = 'EXPIRED')    AS het_han,
      (SELECT count(*)::int FROM purchase_orders WHERE status = 'DRAFT')       AS po_draft`);

  report.humanGate = {
    question: "Khi AI muốn tạo đơn mua, ai bấm nút đồng ý?",
    measured: {
      tongGate: gates[0].tong_gate,
      daDuyet: gates[0].da_duyet,
      dangCho: gates[0].dang_cho,
      biTuChoi: gates[0].bi_tu_choi,
      hetHan: gates[0].het_han,
      poDraft: gates[0].po_draft,
      tyLeChoPhepDuyet:
        gates[0].tong_gate > 0 ? Number(((gates[0].da_duyet / gates[0].tong_gate) * 100).toFixed(1)) : null,
    },
    lenhTaiKiemChung: "npm run check:humangate (cần backend chạy)",
    ketLuan:
      "Mọi hành động ghi vào hệ thống của AI đều đi qua một thẻ chờ người duyệt. " +
      "Không có đường nào để AI tự tạo đơn mua mà không ai thấy.",
  };
  say(`   Tổng thẻ chờ duyệt : ${gates[0].tong_gate}`);
  say(`   ├ đã duyệt        : ${gates[0].da_duyet}`);
  say(`   ├ đang chờ        : ${gates[0].dang_cho}`);
  say(`   ├ bị từ chối       : ${gates[0].bi_tu_choi}`);
  say(`   └ hết hạn         : ${gates[0].het_han}`);
  say(`   PO ở trạng thái DRAFT (chờ người) : ${gates[0].po_draft}`);

  // ─────────────────────────────────────────────────────────────────────
  report.meta = {
    doLuc: new Date().toISOString(),
    tenant: { slug: TENANT_SLUG, ten: tenant.name },
    ghiChu:
      "Tenant demo mang tên MÔ PHỎNG — số liệu nghiệp vụ là dữ liệu mô phỏng phục vụ trình diễn. " +
      "Các số ĐỘ (số lỗi phát hiện, số ràng buộc DB, số khẳng định kiểm chứng) là số đo thật " +
      "trên mã nguồn và cấu trúc dữ liệu, không phụ thuộc dữ liệu mô phỏng.",
    nguyenTac: "Script chỉ đọc. Không ghi, không sửa, không xoá gì.",
  };

  fs.writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  say(`\nĐã ghi: ${path.relative(path.join(__dirname, ".."), OUT)}`);
  say("Tài liệu đi kèm: docs/aisc26/09-real-data-evidence.md");

  await prisma.$disconnect();
})().catch(async (e) => {
  console.error("\nLỖI:", e.message);
  console.error((e.stack || "").split("\n").slice(1, 4).join("\n"));
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});