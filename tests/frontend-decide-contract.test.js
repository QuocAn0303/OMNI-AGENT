/**
 * tests/frontend-decide-contract.test.js — Chặn hỏi contract decide của frontend
 *
 * Bug thật đã xảy ra (mốc 4, phát hiện khi đọc code trước Vòng 2):
 * `SmartApprovalCard.jsx` gửi `{ action, note }` cho CẢ HAI endpoint, trong khi
 * backend đọc hai tên khác nhau:
 *   - `POST /api/agent/human-gates/:id/decide`   → `req.body.decision`
 *   - `POST /api/workflows/approvals/:id/decide`  → `decideSchema` { status, comment }
 *
 * Hậu quả: `decision` luôn là `undefined` ⇒ server trả 400 ⇒ **mọi thẻ duyệt trên
 * giao diện đều thất bại**, kể cả gate `DATA_REQUEST`.
 *
 * Test này đối chiếu nguồn frontend với nguồn backend. Không cần chạy Vite.
 */
const fs = require("fs");
const path = require("path");

const read = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");

const CARD = "frontend/src/components/agent-ui/SmartApprovalCard.jsx";
const AGENT_API = "frontend/src/api/agentGates.js";
const AGENT_ROUTES = "src/modules/ai/agent.routes.js";
const WORKFLOW_VALIDATION = "src/modules/workflow/workflow.validation.js";
const WORKFLOW_ROUTES = "src/modules/workflow/workflow.routes.js";

describe("hợp đồng decide — frontend khớp backend", () => {
  it("human-gates/:id/decide: backend đọc `decision`", () => {
    const routes = read(AGENT_ROUTES);
    // Không giới hạn chiều dài: phải quay tới dòng kiểm tra enum.
// `indexOf` sẽ khớp nhầm dòng comment ở đầu file — phải tìm đúng chỗ
// đăng ký route.
const start = routes.indexOf("router.post('/human-gates/:id/decide'");
expect(start).toBeGreaterThan(-1);
const branch = routes.slice(start, start + 1200);
expect(branch).toMatch(/const\s*\{\s*decision\s*,\s*note\s*(,\s*acknowledgeDrift\s*)?\}\s*=\s*req\.body/);
expect(branch).not.toMatch(/const\s*\{\s*action\s*,/);
expect(branch).toMatch(/\['APPROVED',\s*'REJECTED'\]\.includes\(decision\)/);
  });

// T12 dựng lại `SmartApprovalCard.jsx`: nó chỉ phục vụ human-gate của agent nên
  // nhánh workflow được dời hẳn ra. Hợp đồng `decision` được kiểm ở `api/agentGates.js`
  // (nơi duy nhất gọi endpoint sau T12) — test vẫn giữ nguyên ý cũ: tên field gửi
  // đi phải là `decision`, không phải `action`.
  it("api/agentGates.js gửi `decision` cho human-gates, KHÔNG gửi `action`", () => {
    const api = read(AGENT_API);
    const branch = api.match(/human-gates\/\$\{id\}\/decide`[\s\S]{0,120}?\);/);
    expect(branch).not.toBeNull();
    expect(branch[0]).toMatch(/\bbody\b/);
    expect(branch[0]).not.toMatch(/\baction\s*:/);
  });

  it("SmartApprovalCard dùng đúng hợp đồng { decision, note, acknowledgeDrift }", () => {
    const card = read(CARD);
    expect(card).toMatch(/decideGate\(\s*gate\.id\s*,\s*\{/);
    expect(card).toMatch(/decision,/);
    expect(card).toMatch(/note,/);
    expect(card).toMatch(/acknowledgeDrift:/);
  });

  it("workflow approvals: schema là { status, comment }", () => {
    const v = read(WORKFLOW_VALIDATION);
    const m = v.match(/decideSchema\s*=\s*z\.object\(\{([\s\S]*?)\}\)/);
    expect(m).not.toBeNull();
    expect(m[1]).toMatch(/status:/);
    expect(m[1]).toMatch(/comment:/);
  });

  it("route workflow đúng là /approvals/:id/decide", () => {
    expect(read(WORKFLOW_ROUTES)).toMatch(/router\.post\(\s*["']\/approvals\/:id\/decide["']/);
  });

  // Sau T12 thẻ duyệt của agent KHÔNG gọi endpoint workflow nữa; hợp đồng
  // `{ status, comment }` của workflow thuộc về `Approvals.jsx` + `api/workflow.js`
  // và vẫn được kiểm ở hai test cuối. Test này giữ lại để canh: không ai vô tình
  // thêm nhánh workflow sai URL vào thẻ agent.
  it("SmartApprovalCard KHÔNG gọi nhầm endpoint workflow", () => {
    const card = read(CARD);
    expect(card).not.toMatch(/\/workflows\//);
  });

  it("api/workflow.js gửi status/comment cho workflow (không đổi)", () => {
    const wf = read("frontend/src/api/workflow.js");
    expect(wf).toMatch(/\/workflows\/approvals\/\$\{id\}\/decide/);
  });
});

describe("không nơi nào khác gửi sai tên field cho decide", () => {
  const callers = [
    "frontend/src/components/agent-ui/SmartApprovalCard.jsx",
    "frontend/src/pages/Approvals.jsx",
    "frontend/src/api/workflow.js",
  ];

  it.each(callers)("%s không gửi `{ action:` cho endpoint decide", (file) => {
    const src = read(file);
    expect(src).not.toMatch(/[{,]\s*action:\s*(action|decision|'APPROVED'|"APPROVED")/);
  });

  it("Approvals.jsx dùng đúng { status, comment } qua api/workflow.js", () => {
    expect(read("frontend/src/pages/Approvals.jsx")).toMatch(/decideApproval\(\s*id,\s*\{\s*status\s*,\s*comment\s*\}\s*\)/);
    expect(read("frontend/src/api/workflow.js")).toMatch(/\/workflows\/approvals\/\$\{id\}\/decide/);
  });
});