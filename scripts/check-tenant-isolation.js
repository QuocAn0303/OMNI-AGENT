/**
 * scripts/check-tenant-isolation.js — Kiểm chứng THỰC rằng extension Prisma có
 * chặn findUnique/update/delete xuyên tenant hay không.
 *
 * Vì sao cần: `src/config/prisma.js` khai báo READ_OPS chứa `findUnique`
 * (dòng 96) nên về lý thuyết `findUnique({ where: { id } })` cũng bị tiêm
 * tenantId. Điều đó CHƯA từng được kiểm chứng bằng DB thật — cả tài liệu lẫn
 * note 00b đều đang giả định ngược lại.
 *
 * Cách chạy:  node scripts/check-tenant-isolation.js
 * Cần:      backend KHÔNG cần chạy; chỉ cần DB đã seed.
 * Tự dọn dẹp dữ liệu test ở cuối.
 */
require("dotenv").config();
const prisma = require("../src/config/prisma");
const { runWithTenant } = require("../src/config/tenantContext");

let pass = 0;
let fail = 0;
const ok = (label, cond, extra = "") => {
  console.log(`${cond ? "OK  " : "FAIL"} | ${label}${extra ? " -> " + extra : ""}`);
  if (cond) pass += 1;
  else fail += 1;
};

const suffix = Date.now().toString(36);

(async () => {
  console.log("\n=== KIEM CHUNG CACH LY TENANT (findUnique) ===");
  console.log(`DB: ${(process.env.DATABASE_URL || "").replace(/:[^:@/]+@/, ":***@")}\n`);

  const suffixA = `iso-a-${suffix}`;
  const suffixB = `iso-b-${suffix}`;
  let tenantA;
  let tenantB;
  let userA;
  let userB;
  let gateA;

  try {
    // 2 tenant riêng, có user để gate tham chiếu (FK decidedById / session.userId)
    tenantA = await prisma.tenant.create({ data: { name: "ISO A", slug: suffixA } });
    tenantB = await prisma.tenant.create({ data: { name: "ISO B", slug: suffixB } });

    // user tạo ngoài tenant context (nền) -> phải tự gắn tenantId
    userA = await prisma.user.create({
      data: {
        tenantId: tenantA.id,
        email: `${suffixA}@iso.test`,
        password: "iso-test-not-a-real-hash",
        fullName: "User A",
        role: "ADMIN",
      },
    });
    userB = await prisma.user.create({
      data: {
        tenantId: tenantB.id,
        email: `${suffixB}@iso.test`,
        password: "iso-test-not-a-real-hash",
        fullName: "User B",
        role: "ADMIN",
      },
    });

    const sessionA = await prisma.agentSession.create({
      data: {
        userId: userA.id,
        tenantId: tenantA.id,
        userMessage: "iso test A",
        status: "RUNNING",
        triggerSource: "SYSTEM_EVENT",
      },
    });

    // Gate thuộc tenant A
    gateA = await prisma.agentHumanGate.create({
      data: {
        tenantId: tenantA.id,
        sessionId: sessionA.id,
        actionType: "DATA_REQUEST",
        actionPayload: { probe: true },
        actionSummary: "iso test gate A",
        status: "PENDING",
        expiresAt: new Date(Date.now() + 3600_000),
      },
    });

    console.log(`gate cua tenant A: ${gateA.id}\n`);

    // ── 1. findUnique xuyên tenant ──────────────────────────────────
    await runWithTenant(tenantA.id, async () => {
      const same = await prisma.agentHumanGate.findUnique({ where: { id: gateA.id } });
      ok("trong tenant A: findUnique gate cua chinh A -> tim thay", Boolean(same));

      // Extension làm `args.where = { ...args.where, tenantId }` — tenantId
      // nằm SAU nên GHI ĐÈ mọi giá trị truyền vào. Truyền tenantId=B trong khi
      // context là A vẫn ra kết quả của A, KHÔNG phải null.
      // Hành vi này an toàn (không giả lập được tenant khác) nhưng rất dễ gây
      // hiểu nhầm: code tưởng đang lọc tenantB thực ra đang đọc tenantA.
      const spoof = await prisma.agentHumanGate.findUnique({
        where: { id: gateA.id, tenantId: tenantB.id },
      });
      ok(
        "trong tenant A: truyen tenantId=B bi ghi de -> van ra ket qua cua A (khong phai null)",
        Boolean(spoof) && spoof.tenantId === tenantA.id,
        spoof ? `tenantId thuc te=${spoof.tenantId === tenantA.id ? "A" : "KHAC"}` : "",
      );
    });

    await runWithTenant(tenantB.id, async () => {
      // KHÔNG truyền tenantId -> nếu extension không chặn, B sẽ thấy gate của A
      const leaked = await prisma.agentHumanGate.findUnique({ where: { id: gateA.id } });
      ok(
        "TRONG TENANT B: findUniquesinh gate cua A ma KHONG truyen tenantId",
        leaked === null,
        leaked ? `LEAK! doc duoc ${leaked.actionSummary}` : "extension da chan",
      );

      const withB = await prisma.agentHumanGate.findUnique({
        where: { id: gateA.id, tenantId: tenantB.id },
      });
      ok("trong tenant B: findUnique co tenantId=B -> null", withB === null);
    });

    // ── 2. update xuyên tenant ──────────────────────────────────────
    await runWithTenant(tenantB.id, async () => {
      const r = await prisma.agentHumanGate.updateMany({
        where: { id: gateA.id },
        data: { status: "REJECTED" },
      });
      ok("trong tenant B: updateMany gate cua A -> count = 0", r.count === 0, `count=${r.count}`);
    });

    const afterUpdate = await prisma.agentHumanGate.findUnique({ where: { id: gateA.id } });
    ok(
      "gate A van PENDING sau khi tenant B thu update",
      afterUpdate.status === "PENDING",
      `status=${afterUpdate.status}`,
    );

    // ── 3. update trong tenant sai, truyền tenantId sai ─────────────
    await runWithTenant(tenantB.id, async () => {
      const r = await prisma.agentHumanGate.updateMany({
        where: { id: gateA.id, tenantId: tenantB.id },
        data: { status: "APPROVED" },
      });
      ok("trong tenant B: updateMany co tenantId=B -> count = 0", r.count === 0, `count=${r.count}`);
    });

    // ── 4. findMany co ban chat trong tenant B ───────────────────────
    await runWithTenant(tenantB.id, async () => {
      const list = await prisma.agentHumanGate.findMany({ where: {} });
      ok(
        "trong tenant B: findMany khong thay gate cua A",
        !list.some((g) => g.id === gateA.id),
        `thay ${list.length} gate cua B`,
      );
    });

    // ── 5. delete xuyên tenant ──────────────────────────────────────
    await runWithTenant(tenantB.id, async () => {
      const r = await prisma.agentHumanGate.deleteMany({ where: { id: gateA.id } });
      ok("trong tenant B: deleteMany gate cua A -> count = 0", r.count === 0, `count=${r.count}`);
    });
    const stillThere = await prisma.agentHumanGate.findUnique({ where: { id: gateA.id } });
    ok("gate A van ton tai sau khi tenant B thu xoa", Boolean(stillThere));

    // ── 6. ngoai tenant context (cron) ──────────────────────────────
    const noCtx = await prisma.agentHumanGate.findUnique({ where: { id: gateA.id } });
    ok(
      "ngoai tenant context: findUnique van tra ve (khong co gi de chan)",
      Boolean(noCtx),
      "=> cron sweep co the quet moi tenant mot luot; day la hanh vi dat biet, khong phai lo hong",
    );

    console.log(`\n=== ${fail === 0 ? "TAT CA PASS" : "CO FAIL"} (${pass} pass / ${fail} fail) ===`);
  } catch (e) {
    console.error("LOI:", e.message);
    fail += 1;
  } finally {
    // Dọn dẹp — cascade xoá session/gate; tenant/user xoá tay
    try {
      if (userA) await prisma.agentSession.deleteMany({ where: { userId: userA.id } });
      if (userB) await prisma.agentSession.deleteMany({ where: { userId: userB.id } });
      if (userA) await prisma.user.deleteMany({ where: { id: userA.id } });
      if (userB) await prisma.user.deleteMany({ where: { id: userB.id } });
      if (tenantA) await prisma.tenant.deleteMany({ where: { id: tenantA.id } });
      if (tenantB) await prisma.tenant.deleteMany({ where: { id: tenantB.id } });
      console.log("Da don dep du lieu test.");
    } catch (e) {
      console.error("Khong don dep duoc:", e.message);
    }
    await prisma.$disconnect();
  }

  process.exit(fail === 0 ? 0 : 1);
})();