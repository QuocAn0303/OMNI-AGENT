/**
 * tests/agent-step-type.test.js — chống 'FAST_PATH' quay lại
 *
 * Bug thật (đã xảy ra): agent.routes.js khởi tạo `stepType = 'FAST_PATH'` nhưng
 * `type` của AgentStep là ENUM AgentStepType chỉ có
 *   LLM_CALL | TOOL_CALL | HUMAN_GATE | RENDER_UI
 * → PrismaClientValidationError ngay ở client → POST /api/agent/chat trả 500 cho mọi câu
 * hỏi rơi vào nhánh fallback (LLM/Ollama không chạy). Unit test cũ KHÔNG bắt được vì
 * mock prisma.agentStep.create nên không validate enum.
 *
 * Test này đối chiếu giá trị literal trong code với enum thật trong prisma/schema.prisma.
 */
const fs = require("fs");
const path = require("path");

const SCHEMA = fs.readFileSync(path.join(__dirname, "..", "prisma", "schema.prisma"), "utf8");
const ROUTES = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "ai", "agent.routes.js"), "utf8");

const enumValues = (name) => {
  const m = SCHEMA.match(new RegExp(`enum\\s+${name}\\s*\\{([^}]+)\\}`));
  if (!m) throw new Error(`không tìm thấy enum ${name} trong schema.prisma`);
  return m[1]
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("//"));
};

describe("AgentStep.type phải thuộc enum AgentStepType", () => {
  const values = enumValues("AgentStepType");

  it("enum AgentStepType có các giá trị kỳ vọng", () => {
    expect(values).toEqual(expect.arrayContaining(["LLM_CALL", "TOOL_CALL"]));
  });

  it("mọi giá trị literal gán cho stepType đều là giá trị hợp lệ của enum", () => {
    const assigned = [...ROUTES.matchAll(/stepType\s*=\s*'([A-Z_]+)'/g)].map((m) => m[1]);
    expect(assigned.length).toBeGreaterThan(0);
    const invalid = assigned.filter((v) => !values.includes(v));
    expect(invalid).toEqual([]);
  });

  it("giá trị khởi tạo mặc định của stepType hợp lệ (không phải 'FAST_PATH')", () => {
    const init = ROUTES.match(/let\s+reply\s*,\s*stepType\s*=\s*'([A-Z_]+)'/);
    expect(init).not.toBeNull();
    expect(values).toContain(init[1]);
  });

  it("agentStep.create dùng biến stepType chứ không hardcode chuỗi cho field type", () => {
    const createBlock = ROUTES.match(/prisma\.agentStep\.create\(\{[\s\S]*?\}\);/);
    expect(createBlock).not.toBeNull();
    expect(createBlock[0]).toMatch(/type:\s*stepType\b/);
  });
});
