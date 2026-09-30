/**
 * Smoke test CRM Sales Pipeline — Phase 2 (BACKEND) — chạy trên DB thật, tự dọn dẹp.
 *
 * Vì sao cần: toàn bộ Phase 2 được viết theo mẫu "mock Prisma" nên không test nào
 * chạm DB thật. Ở đây ta chạy đúng các service thật (`src/modules/crm/*.service.js`)
 * theo đúng chuỗi nghiệp vụ, trên tenant đã seed:
 *
 *   ensureDefaultStages → org/contact → lead → changeStage → convertToDeal
 *   → getBoard → getForecast → timeline → stage WON → upsertItems
 *   → convertToOrder (delegate orderService, sinh mã ORD-*) → 409 khi gọi lại
 *   → chặn CASHIER đọc record của người khác (record-level permission)
 *
 * Mọi dòng tạo ra đều có tiền tố "[SMOKE-P2]" để dọn dẹp/an toàn.
 * Dùng `--keep` để giữ dữ liệu lại debug.
 *
 * Chạy: npm run smoke:crm-phase2
 * Giữ dữ liệu: npm run smoke:crm-phase2 -- --keep
 */
require("dotenv").config();
const prisma = require("../src/config/prisma");
const { runWithTenant } = require("../src/config/tenantContext");

const stagesService = require("../src/modules/crm/stages.service");
const leadsService = require("../src/modules/crm/leads.service");
const dealsService = require("../src/modules/crm/deals.service");
const orgsService = require("../src/modules/crm/organizations.service");
const contactsService = require("../src/modules/crm/contacts.service");
const commService = require("../src/modules/crm/communication.service");
const dashboardService = require("../src/modules/crm/dashboard.service");

const KEEP = process.argv.includes("--keep");
const TAG = "[SMOKE-P2]";

let pass = 0;
let fail = 0;
const created = { orders: [], auditLogs: [], invTx: [], inventories: [], tempUsers: [] };

const check = (label, condition, detail = "") => {
  if (condition) {
    pass += 1;
    console.log(`  OK   ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail += 1;
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
};

const expectThrow = async (label, fn, status) => {
  try {
    await fn();
    check(label, false, "không ném lỗi");
  } catch (e) {
    check(label, e?.status === status, `status=${e?.status} (cần ${status}): ${e?.message}`);
  }
};

/** Tìm fixture: tenant có warehouse + user + sản phẩm còn tồn kho */
async function pickFixture() {
  // Chạy NGOÀI tenant context: Tenant không bị scope, User cần bypass để dò tenant
  const tenant = await prisma.tenant.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true },
  });
  if (!tenant) return { error: "DB chưa có tenant nào — chạy `npm run db:seed` trước" };

  return runWithTenant(tenant.id, async () => {
    const users = await prisma.user.findMany({
      where: { isActive: true, role: { in: ["ADMIN", "MANAGER", "CASHIER"] } },
      select: { id: true, fullName: true, role: true },
      orderBy: { createdAt: "asc" },
    });
    if (!users.length) return { error: `Tenant ${tenant.name} chưa có user ADMIN/MANAGER/CASHIER` };

    const warehouse = await prisma.warehouse.findFirst({
      where: { isActive: true },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true },
    });
    if (!warehouse) return { error: "Tenant chưa có kho (cần cho đơn hàng)" };

    // Sản phẩm có tồn kho khả dụng trong kho trên
    const product = await prisma.product.findFirst({
      where: { isActive: true, inventories: { some: { warehouseId: warehouse.id, quantity: { gt: 0 } } } },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, price: true },
    });
    if (!product) return { error: "Tenant chưa có sản phẩm nào còn tồn kho (cần cho convertToOrder)" };

    return { tenant, users, warehouse, product };
  });
}

/** Đảm bảo có user thứ 2 để test record-level permission (CASHIER) */
async function ensureSecondUser(fixture) {
  const other = fixture.users.find((u) => u.id !== fixture.users[0].id);
  if (other) return other;
  const tmp = await prisma.user.create({
    data: {
      email: `smoke-p2-${Date.now()}@crm-pipeline.local`,
      passwordHash: "x",
      fullName: `${TAG} CASHIER tạm`,
      role: "CASHIER",
      isActive: true,
      tenantId: fixture.tenant.id,
    },
    select: { id: true, fullName: true, role: true },
  });
  created.tempUsers.push(tmp.id);
  return tmp;
}

async function main() {
  console.log("=== Smoke CRM Sales Pipeline Phase 2 (service thật trên DB thật) ===\n");

  const fixture = await pickFixture();
  if (fixture.error) {
    console.log("SKIP: " + fixture.error);
    console.log("\nPASS (bỏ qua — thiếu dữ liệu seed)");
    process.exit(0);
  }
  console.log(`Tenant: ${fixture.tenant.name} (${fixture.tenant.id})`);
  console.log(`Kho: ${fixture.warehouse.name} · SP: ${fixture.product.name}\n`);

  const { tenant } = fixture;
  const owner = fixture.users.find((u) => ["ADMIN", "MANAGER"].includes(u.role)) || fixture.users[0];
  const other = await ensureSecondUser(fixture);
  const ownerUser = { id: owner.id, role: owner.role };
  const otherUser = { id: other.id, role: other.role === "CASHIER" ? "CASHIER" : "MANAGER" };

  // Dọn dẹp tàn dư của lần chạy trước bị abort (script vừa throw là dừng) —
  // nếu không, tổ chức/lead cùng tên sẽ đụng unique constraint.
  if (!KEEP) await cleanup(tenant.id);

  await runWithTenant(tenant.id, async () => {
    // ---------- 1. Stage mặc định (lazy-seed idempotent) ----------
    console.log("1. Stage mặc định (lazy-seed)");
    await stagesService.ensureDefaultStages();
    const allStages = await prisma.crmPipelineStage.findMany({ orderBy: [{ entityType: "asc" }, { sortOrder: "asc" }] });
    const leadStages = allStages.filter((s) => s.entityType === "LEAD");
    const dealStages = allStages.filter((s) => s.entityType === "DEAL");
    check("có stage LEAD + DEAL", leadStages.length >= 3 && dealStages.length >= 6, `${leadStages.length} LEAD / ${dealStages.length} DEAL`);
    check("có stage kind=WON và kind=LOST", allStages.some((s) => s.kind === "WON") && allStages.some((s) => s.kind === "LOST"));

    // Gọi lần 2 → không tạo trùng (idempotent)
    const before = allStages.length;
    await stagesService.ensureDefaultStages();
    const after = await prisma.crmPipelineStage.count();
    check("gọi lại KHÔNG tạo trùng", after === before, `${before} → ${after}`);

    // ---------- 2. Organization + Contact ----------
    console.log("\n2. Organization + Contact");
    const org = await orgsService.create({ name: `${TAG} Công ty`, industry: "Phần mềm" }, owner.id);
    check("tạo organization", !!org.id);
    const contact = await contactsService.create(
      { fullName: `${TAG} Nguyễn Văn A`, phone: "0900000002", email: "smoke-p2@example.com", organizationId: org.id, isPrimary: true },
      owner.id,
    );
    check("tạo contact primary", !!contact.id && contact.isPrimary === true);

    // Trùng tên trong cùng tenant → 409
    await expectThrow("tổ chức trùng tên → 409", () => orgsService.create({ name: org.name }, owner.id), 409);

    // ---------- 3. Lead ----------
    console.log("\n3. Lead + đổi giai đoạn");
    const lead = await leadsService.create(
      { leadName: `${TAG} Lead`, mobileNo: "0900000001", source: "SMOKE", organizationId: org.id, contactId: contact.id, expectedValue: 1000000, leadOwnerId: owner.id },
      owner.id,
      ownerUser,
    );
    check("tạo lead có owner", !!lead.id && lead.leadOwnerId === owner.id, `status=${lead.status}`);

    const leadStage3 = leadStages[2] || leadStages[leadStages.length - 1];
    const moved = await leadsService.changeStage(lead.id, { stageId: leadStage3.id, status: "QUALIFIED" }, owner.id, ownerUser);
    check("đổi stage lead", moved.lead.stageId === leadStage3.id && moved.lead.status === "QUALIFIED");
    check("tự set lastContactedAt khi đổi trạng thái", !!moved.lead.lastContactedAt);

    // ---------- 4. Record-level permission ----------
    console.log("\n4. Record-level permission (CASHIER)");
    await expectThrow(
      "CASHIER khác đọc lead của người này → 403",
      () => leadsService.getById(lead.id, { id: `${other.id}-khac`, role: "CASHIER" }),
      403,
    );
    const cashierList = await leadsService.list({ leadOwnerId: other.id }, { id: other.id, role: "CASHIER" });
    check(
      "CASHIER ép scope về lead của mình kể cả khi truyền owner khác",
      cashierList.leads.every((l) => l.leadOwnerId === other.id),
      `${cashierList.leads.length} lead`,
    );

    // ---------- 5. Convert Lead → Deal ----------
    console.log("\n5. Convert Lead → Deal");
    const { deal } = await leadsService.convertToDeal(lead.id, { expectedValue: 5000000 }, owner.id, ownerUser);
    check("tạo deal", !!deal.id && deal.kind === "ONGOING", `probability=${deal.probability}`);
    const leadAfter = await leadsService.getById(lead.id, ownerUser);
    check("lead → CONVERTED + trỏ deal", leadAfter.status === "CONVERTED" && leadAfter.convertedDealId === deal.id);
    await expectThrow("convert lần 2 → 409", () => leadsService.convertToDeal(lead.id, {}, owner.id, ownerUser), 409);

    // ---------- 6. Kanban + Forecast + Dashboard ----------
    console.log("\n6. Kanban + Forecast + Dashboard");
    const board = await dealsService.getBoard(ownerUser);
    const inBoard = board.columns.some((c) => c.deals.some((d) => d.id === deal.id));
    check("deal xuất hiện trên kanban", inBoard, `${board.columns.length} cột, ${board.summary.totalDeals} deal`);
    check("tổng giá trị pipeline khớp", Number(board.summary.totalValue) >= 5000000, `${board.summary.totalValue}`);

    const forecast = await dealsService.getForecast(ownerUser, { months: 6 });
    check("weighted forecast > 0", Number(forecast.summary.weightedValue) > 0, `${forecast.summary.weightedValue}`);

    const summary = await dashboardService.getSummary(ownerUser, { months: 6 });
    check("dashboard trả KPI", typeof summary.kpi.totalLeads === "number", `leads=${summary.kpi.totalLeads}, deals=${summary.kpi.openDeals}`);
    check("dashboard phễu lead có bước", summary.funnel.steps.length > 0, `${summary.funnel.steps.length} bước`);

    // ---------- 7. Timeline hợp nhất ----------
    console.log("\n7. Timeline");
    const timeline = await commService.listTimeline({ leadId: lead.id, limit: 100 });
    const hasSystem = timeline.timeline.some((t) => t.type === "SYSTEM");
    const hasConvert = timeline.timeline.some((t) => t.content?.includes("Chuyển thành Deal"));
    check("timeline có sự kiện hệ thống", hasSystem, `${timeline.timeline.length} entry`);
    check("timeline ghi lại lúc convert", hasConvert);
    const note = await commService.create({ type: "CALL", direction: "OUTBOUND", content: `${TAG} gọi khách`, leadId: lead.id, durationSec: 60 }, owner.id);
    check("thêm entry CALL thủ công", !!note.id);
    await expectThrow("tạo entry SYSTEM thủ công → 400", () => commService.create({ type: "SYSTEM", content: "x", leadId: lead.id }, owner.id), 400);

    // ---------- 8. Deal thắng → items → Order ----------
    console.log("\n8. Deal thắng → tạo đơn hàng");
    await expectThrow("deal chưa thắng → 400", () => dealsService.convertToOrder(deal.id, {}, owner.id, ownerUser), 400);

    const wonStage = dealStages.find((s) => s.kind === "WON");
    await dealsService.changeStage(deal.id, { stageId: wonStage.id }, owner.id, ownerUser);
    const wonDeal = await dealsService.getById(deal.id, ownerUser);
    check("đổi stage WON → kind/probability/closedAt", wonDeal.kind === "WON" && wonDeal.probability === wonStage.probability && !!wonDeal.closedAt);

    await expectThrow(
      "chuyển sang LOST mà thiếu lý do → 400",
      () => dealsService.changeStage(deal.id, { stageId: dealStages.find((s) => s.kind === "LOST").id }, owner.id, ownerUser),
      400,
    );

    const qty = 2;
    const price = Number(fixture.product.price);
    // Giá deal CỐ Ý thấp hơn giá sản phẩm 10% → đơn phải được chiết khấu bù lệch
    const dealUnitPrice = Math.round(price * 0.9);
    const withItems = await dealsService.upsertItems(
      deal.id,
      [{ productId: fixture.product.id, quantity: qty, unitPrice: dealUnitPrice, discount: 0 }],
      owner.id,
      ownerUser,
    );
    check("thêm dòng sản phẩm", withItems.items.length === 1, `amount=${withItems.items[0].amount}`);
    check("deal value tính lại từ items", Number(withItems.value) === dealUnitPrice * qty, `${withItems.value}`);

    const { order } = await dealsService.convertToOrder(
      deal.id,
      { orderStatus: "PENDING", paymentMethod: "CASH", note: `${TAG} đơn từ deal` },
      owner.id,
      ownerUser,
    );
    created.orders.push(order.id);
    check("tạo đơn hàng qua orderService", /^ORD-\d{8}-\d{4}$/.test(order.orderCode), order.orderCode);
    const expectedDiscount = Math.round((price * qty - dealUnitPrice * qty) * 100) / 100;
    check("chiết khấu bù lệch giá deal", Number(order.discount) === expectedDiscount, `${order.discount} (cần ${expectedDiscount})`);

    const dealWithOrder = await dealsService.getById(deal.id, ownerUser);
    check("deal.orderId được set", dealWithOrder.orderId === order.id);
    check("deal.customerId được set", !!dealWithOrder.customerId);

    await expectThrow("gọi convertToOrder lần 2 → 409", () => dealsService.convertToOrder(deal.id, {}, owner.id, ownerUser), 409);
    await expectThrow("đổi stage deal đã có đơn → 409", () => dealsService.changeStage(deal.id, { stageId: wonStage.id }, owner.id, ownerUser), 409);
    await expectThrow("xóa deal đã có đơn → 409", () => dealsService.remove(deal.id, owner.id, ownerUser), 409);

    // Ghi nhận thêm để dọn dẹp
    created.auditLogs.push(deal.id, lead.id, org.id, contact.id);
    created.customerIds = [dealWithOrder.customerId].filter(Boolean);
  });

  console.log(`\n--- Kết quả: ${pass} pass / ${fail} fail ---`);
  if (!KEEP) await cleanup(fixture.tenant.id);
  else console.log(`\nGiữ dữ liệu (--keep). Tenant=${fixture.tenant.id} · lead=${TAG}*`);

  console.log("\n" + (fail === 0 ? "PASS" : "FAIL"));
  process.exit(fail === 0 ? 0 : 1);
}

async function cleanup(tenantId) {
  await runWithTenant(tenantId, async () => {
    // 1. Đơn hàng PENDING: trả `reserved` về kho rồi xoá đơn
    for (const orderId of created.orders) {
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        select: { id: true, orderCode: true, items: { select: { productId: true, quantity: true } } },
      });
      if (!order) continue;
      const txs = await prisma.inventoryTransaction.findMany({
        where: { note: { contains: order.orderCode } },
        select: { id: true, inventoryId: true, quantity: true, type: true },
      });
      for (const tx of txs) {
        if (tx.type === "RESERVATION") {
          await prisma.inventory.updateMany({ where: { id: tx.inventoryId }, data: { reserved: { decrement: tx.quantity } } });
        }
      }
      await prisma.inventoryTransaction.deleteMany({ where: { id: { in: txs.map((t) => t.id) } } });
      await prisma.auditLog.deleteMany({ where: { action: "CREATE_ORDER", entityId: orderId } });
      await prisma.order.delete({ where: { id: orderId } });
    }
    // 2. Pipeline
    await prisma.crmCommunication.deleteMany({ where: { lead: { leadName: { startsWith: TAG } } } });
    await prisma.crmCommunication.deleteMany({ where: { deal: { dealName: { startsWith: TAG } } } });
    await prisma.crmCommunication.deleteMany({ where: { contact: { fullName: { startsWith: TAG } } } });
    await prisma.crmDeal.deleteMany({ where: { dealName: { startsWith: TAG } } });
    await prisma.crmLead.deleteMany({ where: { leadName: { startsWith: TAG } } });
    await prisma.crmContact.deleteMany({ where: { fullName: { startsWith: TAG } } });
    await prisma.crmOrganization.deleteMany({ where: { name: { startsWith: TAG } } });
    // 3. Audit log của pipeline
    await prisma.auditLog.deleteMany({ where: { entityId: { in: created.auditLogs } } });
    // 4. Khách hàng tự sinh từ deal (referralSource = CRM_DEAL). Deal đã xoá ở
    //    bước 2 nên không còn FK giữ. Chỉ xoá khách mà script này tự tạo.
    for (const cid of created.customerIds || []) {
      const used = await prisma.order.count({ where: { customerId: cid } });
      if (used > 0) {
        console.log(`  BỎ QUA khách ${cid}: còn ${used} đơn hàng tham chiếu`);
        continue;
      }
      await prisma.crmContact.updateMany({ where: { customerId: cid }, data: { customerId: null } });
      await prisma.customer.deleteMany({ where: { id: cid, referralSource: "CRM_DEAL" } });
    }
    // 5. User tạm
    for (const uid of created.tempUsers) {
      await prisma.user.deleteMany({ where: { id: uid } });
    }
    // Tàn dư user tạm từ lần chạy trước bị abort giữa chừng
    await prisma.user.deleteMany({ where: { email: { startsWith: "smoke-p2-" } } });
  });
}

main().catch((e) => {
  console.error("Lỗi:", e);
  process.exit(1);
});
