/**
 * tests/demo-flow-contract.test.js — Chặn hồi quy của đường mã luồng demo (T11)
 *
 * Vì sao cần: `scripts/demo/demo-flow.js` được `smoke:demo-flow` (khẳng định) và
 * `demo:run` (trình diễn) dùng chung. Nếu ai đó đổi đường mã ở một chỗ, hoặc làm
 * `demo:run` tự dựng luồng riêng (lệch với bản nghiệm thu — giám khảo soi thấy
 * ngay), hoặc làm luồng quên một bước. Unit test mock không đủ; ở đây ta kiểm
 * **hợp đồng giữa các tệp** bằng đọc nguồn, không cần DB.
 *
 * PHẠM VI: chỉ những điều sai là hỏng CHẨC NĂNG demo. Còn lại đã có
 * `smoke:demo-flow` trên DB thật.
 */
const fs = require("fs");
const path = require("path");

const read = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");

const FLOW = "scripts/demo/demo-flow.js";
const RUNNER = "scripts/demo/run-demo.js";
const SMOKE = "scripts/smoke-demo-flow.js";
const PKG = "package.json";
const SUGGEST = "src/modules/replenishment/replenishment.suggest.js";
const EXEC = "src/modules/ai/agent.gate.exec.js";
const CDC = "src/jobs/agent.cdc.js";

describe("luồng demo: đủ bước theo đúng đường mã sản phẩm", () => {
  it("demo-flow chạy đủ các bước theo thứ tự", () => {
    const flow = read(FLOW);
    const steps = [...flow.matchAll(/step\('([a-z-]+)'/g)].map((m) => m[1]);
    // T14 thêm bước `explain-proposal` (vai trò LLM #2) giữa bước 4 và bước 5: mục
    // đích là chứng minh CHẾ ĐỘ KHÔNG-LLM chạy trọn luồng demo. Thứ tự không đổi,
    // chỉ thêm một bước không ghi DB.
    expect(steps).toEqual([
      "pick-sku",
      "create-order",
      "cdc-low-stock",
      "freshness-before-approve",
      "explain-proposal",
      "approve-gate",
      "exactly-one-po",
      "no-duplicate-proposal",
    ]);
  });

  it("bước giải thích dùng đường LLM duy nhất và KHÔNG tự tính lại số", () => {
    const flow = read(FLOW);
    expect(flow).toMatch(/explainProposal\(/);
    expect(flow).toMatch(/draftVendorMessage\(/);
    // Số đưa vào phải lấy từ Bước A (`replan`) hoặc payload của gate — không nhập tay.
    expect(flow).not.toMatch(/explainProposal\(\{\s*sku:\s*['"`]/);
    // Tin nhắn NCC chỉ được SOẠN: luồng không được có lệnh gửi.
    expect(flow).not.toMatch(/\bsend(?:Message|Sms|Zalo|Email)\s*\(/);
  });

  it("mỗi bước gọi hàm SẢN PHẨM, không tự tính lại nghiệp vụ", () => {
    const flow = read(FLOW);
    // Chọn SKU + tính nhu cầu: công thức, không phải số hard-code.
    expect(flow).toMatch(/planReplenishment\(/);
    expect(flow).toMatch(/loadReplenishmentInput\(/);
    // Đơn: qua service, không `prisma.order.create` tay.
    expect(flow).toMatch(/orderService\.create\(/);
    expect(flow).not.toMatch(/prisma\.order\.create\(/);
    // CDC: đúng handler, không tự tạo gate.
    expect(flow).toMatch(/EVENT_HANDLERS\.LOW_STOCK\(/);
    expect(flow).not.toMatch(/agentHumanGate\.create\(/);
    // Duyệt: qua executor, không tạo PO tay.
    expect(flow).toMatch(/executeGate\(/);
    expect(flow).not.toMatch(/prisma\.purchaseOrder\.create\(/);
  });

  it("đảo trạng thái gate bằng updateMany CÓ ĐIỀU KIỆN (không dùng update)", () => {
    const flow = read(FLOW);
    expect(flow).toMatch(/agentHumanGate\.updateMany\(\{\s*where:\s*\{\s*id:\s*gate\.id,\s*status:\s*'PENDING'/);
    // `buildDecisionData` là nơi DUY NHẤT ghi decidedAt/decidedById/decisionNote.
    expect(flow).toMatch(/buildDecisionData\(/);
  });

  it("bước CDC xoá debounce và nói rõ là ngoài sản phẩm", () => {
    const flow = read(FLOW);
    expect(flow).toMatch(/resetLowStockDebounce\(\)/);
    const cdc = read(CDC);
    expect(cdc).toMatch(/const resetLowStockDebounce = \(\) => lowStockTimers\.clear\(\)/);
    expect(cdc).toMatch(/module\.exports = \{ startCDC, stopCDC, EVENT_HANDLERS, resetLowStockDebounce \}/);
  });

  it("dọn dẹp đo lại được: có capture/diff trên toàn bộ bảng scoped", () => {
    const flow = read(FLOW);
    expect(flow).toMatch(/listScopedTables/);
    expect(flow).toMatch(/captureTenantCounts/);
    expect(flow).toMatch(/diffTenantCounts/);
    // Phải trả tồn kho về đúng số trước, không chỉ xoá dòng.
    expect(flow).toMatch(/quantity: picked\.quantity/);
  });

  it("KHÔNG có đường tắt human-gate trong luồng demo", () => {
    const flow = read(FLOW);
    // Không được tự ý duyệt hàng loạt, không ép acknowledgeDrift.
    expect(flow).not.toMatch(/acknowledgeDrift:\s*true/);
    expect(flow).toMatch(/acknowledgeDrift: false/);
  });
});

describe("trình diễn và nghiệm thu dùng CHUNG một đường mã", () => {
  it("demo:run và smoke:demo-flow đều gọi runDemoFlow của demo-flow.js", () => {
    expect(read(RUNNER)).toMatch(/require\('\.\/demo-flow'\)/);
    expect(read(SMOKE)).toMatch(/require\('\.\/demo\/demo-flow'\)/);
    expect(read(RUNNER)).toMatch(/runDemoFlow\(/);
    expect(read(SMOKE)).toMatch(/runDemoFlow\(/);
  });

  it("không script nào tự dựng lại luồng (tránh lệch với bản nghiệm thu)", () => {
    for (const f of [RUNNER, SMOKE]) {
      const src = read(f);
      expect(src).not.toMatch(/planReplenishment\(/);
      expect(src).not.toMatch(/executeGate\(/);
    }
  });

  it("npm script tồn tại và trỏ đúng tệp", () => {
    const pkg = JSON.parse(read(PKG));
    expect(pkg.scripts["smoke:demo-flow"]).toMatch(/scripts\/smoke-demo-flow\.js/);
    expect(pkg.scripts["demo:run"]).toMatch(/scripts\/demo\/run-demo\.js/);
  });
});

describe("sửa bug lead time (D-015) không được lùi", () => {
  it("loadLeadTimeReceipts trả đúng tên field `poDate` mà calcLeadTime đọc", () => {
    const suggest = read(SUGGEST);
    expect(suggest).toMatch(/poDate:\s*po\.date/);
    // Hợp đồng của hàm toán là `poDate` — không được đổi ở phía calc.
    const calc = read("src/modules/replenishment/replenishment.calc.js");
    expect(calc).toMatch(/r\.poDate/);
  });
});

describe("409 mang `details` để UI thấy được diff", () => {
  it("executor nhét code/drift/diff/missingCost vào details", () => {
    const exec = read(EXEC);
    // Chỉ quan tâm khối `throw` trong `executeGate` — `revalidate` cũng có
    // `if (!check.ok)` nhưng trả về chứ không throw.
    const at = exec.indexOf("const check = await revalidate(gate");
    expect(at).toBeGreaterThan(-1);
    const block = exec.slice(at, at + 1400);
    expect(block).toMatch(/throw \{/);
    expect(block).toMatch(/drift:/);
    expect(block).toMatch(/diff:/);
    expect(block).toMatch(/missingCost:/);
    expect(block).toMatch(/details:\s*\{/);
  });

  it("error.middleware vẫn chuyển `details` (không rơi ở HTTP layer)", () => {
    expect(read("src/middleware/error.middleware.js")).toMatch(/err\.details && \{ details: err\.details \}/);
  });
});