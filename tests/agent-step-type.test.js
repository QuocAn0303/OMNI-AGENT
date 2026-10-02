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

/**
 * Nhãn LLM_CALL phải khớp hành vi thật.
 *
 * `db-agent.service.generateResponse` chỉ nối chuỗi `summary + message` — không
 * import `config/llm`, không gọi mô hình. Trước đây nhánh fallback gắn
 * `stepType = 'LLM_CALL'` và `path = 'fallback_llm'`, khiến số liệu thống kê agent
 * trên UI báo đã dùng LLM khi thực tế chưa hề gọi.
 */
describe("nhãn LLM_CALL chỉ dùng khi thật sự gọi LLM", () => {
  it("generateResponse không import/gọi LLM (nên không được gắn nhãn LLM_CALL)", () => {
    const service = fs.readFileSync(
      path.join(__dirname, "..", "src", "modules", "ai", "db-agent.service.js"),
      "utf8",
    );
    // Nếu file này bắt đầu require LLM thì nhãn LLM_CALL lại hợp lệ —
    // test này sẽ báo sai và cần cập nhật, đó là chủ ý.
    expect(service).not.toMatch(/require\((['"])\.\/agent\.llm\1\)/);
    expect(service).not.toMatch(/require\((['"])\.\.\/\.\.\/config\/llm\1\)/);
  });

  it("không còn nhãn 'fallback_llm' (nhánh đó là keyword, không phải LLM)", () => {
    expect(ROUTES).not.toMatch(/fallback_llm/);
  });

  it("nhánh gọi generateResponse gắn stepType = TOOL_CALL, không phải LLM_CALL", () => {
    const branch = ROUTES.match(
      /stepType\s*=\s*'TOOL_CALL';[\s\S]{0,400}?generateResponse\(/,
    );
    expect(branch).not.toBeNull();
  });

  it("toàn file không gán LLM_CALL cho bước nào chỉ nối chuỗi", () => {
    // Mỗi lần gán LLM_CALL phải nằm cạnh một lời gọi LLM thật (generateNLResponse/
    // queryModel). Ở agent.routes.js hiện không có lời gọi LLM nào ⇒ kỳ vọng 0.
    const assignments = [...ROUTES.matchAll(/stepType\s*=\s*'LLM_CALL'/g)];
    expect(assignments).toHaveLength(0);
  });
});
