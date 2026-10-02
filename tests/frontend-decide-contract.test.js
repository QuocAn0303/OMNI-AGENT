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
const AGENT_ROUTES = "src/modules/ai/agent.routes.js";
const WORKFLOW_VALIDATION = "src/modules/workflow/workflow.validation.js";
const WORKFLOW_ROUTES = "src/modules/workflow/workflow.routes.js";

describe("hợp đồng decide — frontend khớp backend", () => {
  it("human-gates/:id/decide: backend đọc `decision`", () => {
    const routes = read(AGENT_ROUTES);
    const m = routes.match(/human-gates\/:id\/decide[\s\S]*?const\s*\{\s*decision\s*,\s*note\s*\}\s*=\s*req\.body[\s\S]*?includes\(decision\)/);
    expect(m).not.toBeNull();
    expect(m[0]).not.toMatch(/const\s*\{\s*action\s*,/);
    // Backend chỉ chấp nhận APPROVED/REJECTED
    expect(m[0]).toMatch(/\['APPROVED',\s*'REJECTED'\]\.includes\(decision\)/);
  });

  it("SmartApprovalCard gửi `decision` cho human-gates, KHÔNG gửi `action`", () => {
    const card = read(CARD);
    const branch = card.match(/human-gates\/\$\{gateId\}\/decide`[\s\S]{0,200}?\n\s*\}\);/);
    expect(branch).not.toBeNull();
    expect(branch[0]).toMatch(/decision:\s*action/);
    // `action` chỉ được dùng làm giá trị, không được làm TÊN field gửi đi.
    expect(branch[0]).not.toMatch(/\baction:\s*action\b/);
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

  it("SmartApprovalCard gọi ĐÚNG URL workflow (có đoạn approvals/)", () => {
    const card = read(CARD);
    expect(card).toMatch(/\/api\/workflows\/approvals\/\$\{expenseId\}\/decide/);
    expect(card).not.toMatch(/\/api\/workflows\/\$\{expenseId\}\/decide/);
  });

  it("SmartApprovalCard gửi status/comment cho workflow", () => {
    const card = read(CARD);
    const branch = card.match(/workflows\/approvals\/\$\{expenseId\}\/decide`[\s\S]{0,200}?\n\s*\}\);/);
    expect(branch).not.toBeNull();
    expect(branch[0]).toMatch(/status:\s*action/);
    expect(branch[0]).toMatch(/comment:/);
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