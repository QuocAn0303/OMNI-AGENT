/**
 * tests/db-agent.authz.test.js — P0-1: chặn lỗ hổng phân quyền trên /api/db-agent
 *
 * Lỗi gốc (phát hiện ở Pha 0, mục F3):
 *   - `db-agent.routes.js` chỉ có `authenticate`, không `authorize`
 *     ⇒ CASHIER / WAREHOUSE đăng nhập là tra được công nợ, sổ cái, hồ sơ KH.
 *   - `POST /query` mặc định `useLlm=true` → `llm-chat.service.chat()` chọn tool
 *     bằng LLM rồi gọi thẳng `HANDLERS[tool]`, KHÔNG kiểm tra tool có phải
 *     write tool không ⇒ create_order / create_po / send_reminder chạy được cho
 *     mọi role, không audit, không human-gate.
 *
 * File này khóa cả hai đường:
 *   1. HTTP layer: role thấp bị 403, role cao qua được.
 *   2. Service layer: write tool bị từ chối kể cả khi LLM trả về nó — và
 *      quan trọng nhất, handler KHÔNG được gọi (không có side-effect).
 *
 * Dùng Express thật + mock `authenticate` để điều khiển role, không cần DB.
 */
const express = require("express");

let mockCurrentUser = { id: "u-admin", role: "ADMIN" };

// Handler giả cho write tool: nếu test này fail vì spy này được gọi,
// nghĩa là write tool đã chạy trước khi kịp chặn.
const mockCreateOrder = jest.fn().mockResolvedValue({ data: [{ id: "o1" }], total: 1 });
const mockCreatePo = jest.fn().mockResolvedValue({ data: [{ id: "po1" }], total: 1 });
const mockSendReminder = jest.fn().mockResolvedValue({ data: [{ id: "n1" }], total: 1 });
const mockSearchProducts = jest.fn().mockResolvedValue({ data: [{ id: "p1" }], total: 1 });

const mockProcessQuery = jest.fn(async () => ({
  success: true, message: "ok", data: [{ id: "p1" }], total: 1,
}));
const mockGenerateResponse = jest.fn(async () => "câu trả lời");

jest.mock("../src/modules/ai/db-agent.service", () => {
  const WRITE_TOOLS = new Set(["create_order", "create_po", "send_reminder"]);
  return {
    WRITE_TOOLS,
    isWriteTool: (t) => WRITE_TOOLS.has(t),
    HANDLERS: {
      search_products: (...a) => mockSearchProducts(...a),
      create_order: (...a) => mockCreateOrder(...a),
      create_po: (...a) => mockCreatePo(...a),
      send_reminder: (...a) => mockSendReminder(...a),
    },
    // resolveIntent trả về tool mà keyword match được — dùng để mô phỏng
    // đường fallback khi LLM không trả lời được.
    resolveIntent: jest.fn(),
    extractParams: jest.fn(() => ({})),
    processQuery: (...a) => mockProcessQuery(...a),
    generateResponse: (...a) => mockGenerateResponse(...a),
  };
});

// auth.middleware: giữ `authorize` THẬT (logic role cần được test đúng),
// chỉ mock `authenticate` để không cần JWT/DB.
jest.mock("../src/middleware/auth.middleware", () => {
  const actual = jest.requireActual("../src/middleware/auth.middleware");
  return {
    ...actual,
    authenticate: (req, res, next) => { req.user = mockCurrentUser; next(); },
  };
});

jest.mock("../src/utils/logger", () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
  truncateLog: (v) => String(v),
}));

// Chặn LLM: không spawn Python, không gọi mạng. Toàn bộ "LLM trả về gì" được
// điều khiển bằng mockQueryModel — vì `inferTool`/`generateNLResponse` gọi
// `queryModel` qua binding nội bộ nên spy lên export của llm-chat không có tác dụng.
const mockQueryModel = jest.fn();

jest.mock("../src/modules/ai/agent.llm", () => ({
  queryModel: (...a) => mockQueryModel(...a),
  startPythonProcess: jest.fn(),
}));

const dbAgentService = require("../src/modules/ai/db-agent.service");
const llmChat = require("../src/modules/ai/llm-chat.service");
const dbAgentRoutes = require("../src/modules/ai/db-agent.routes");

/**
 * Kịch bản LLM: toolCall cho bước chọn tool, response cho bước diễn giải.
 * `queryModel` được gọi với `{query,...}` khi chọn tool và `{prompt, mode:'response'}`
 * khi diễn giải — phân biệt theo `mode`.
 */
const llmReturnsTool = (tool, params = {}) =>
  mockQueryModel.mockImplementation(async (payload) =>
    payload?.mode === "response" ? { response: "câu trả lời NL" } : { toolCall: { tool, params } }
  );

const llmFails = () => mockQueryModel.mockRejectedValue(new Error("LLM không khả dụng"));

beforeEach(() => {
  mockCreateOrder.mockClear();
  mockCreatePo.mockClear();
  mockSendReminder.mockClear();
  mockSearchProducts.mockClear();
  dbAgentService.resolveIntent.mockReset();
  mockQueryModel.mockReset();
});

afterEach(() => jest.restoreAllMocks());

let server;
let baseUrl;

beforeAll((done) => {
  const app = express();
  app.use(express.json());
  app.use("/api/db-agent", dbAgentRoutes);
  app.use((err, req, res, next) => {
    res.status(err?.status || err?.statusCode || 500).json({
      success: false, message: err?.message || "Lỗi",
    });
  });
  server = app.listen(0, () => {
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    done();
  });
});

afterAll(async () => {
  await new Promise((resolve) => server.close(() => resolve()));
});

const postQuery = (body) =>
  fetch(`${baseUrl}/api/db-agent/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const setRole = (role) => { mockCurrentUser = { id: "u1", role }; };

describe("P0-1 · /api/db-agent phân quyền theo vai trò", () => {
  beforeEach(() => setRole("ADMIN"));

  test("GET /tools trả kèm executableHere=false cho write tool", async () => {
    setRole("ADMIN");
    const res = await fetch(`${baseUrl}/api/db-agent/tools`);
    const json = await res.json();

    expect(res.status).toBe(200);
    const byName = Object.fromEntries(json.data.map((t) => [t.name, t]));
    expect(byName.create_po.executableHere).toBe(false);
    expect(byName.create_order.executableHere).toBe(false);
    expect(byName.send_reminder.executableHere).toBe(false);
    expect(byName.search_products.executableHere).toBe(true);
  });

  test.each(["CASHIER", "WAREHOUSE", "SALE"])(
    "role %s bị từ chối 403 trên POST /query",
    async (role) => {
      setRole(role);
      const res = await postQuery({ query: "tồn kho còn bao nhiêu?" });

      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.message).toMatch(/không có quyền/i);
    }
  );

  test.each(["CASHIER", "WAREHOUSE"])("role %s bị từ chối 403 trên GET /tools", async (role) => {
    setRole(role);
    const res = await fetch(`${baseUrl}/api/db-agent/tools`);
    expect(res.status).toBe(403);
  });

  test.each(["ADMIN", "MANAGER", "ACCOUNTANT", "SUPER_ADMIN"])(
    "role %s được phép truy cập POST /query",
    async (role) => {
      setRole(role);
      const res = await postQuery({ query: "tồn kho còn bao nhiêu?", useLlm: false });
      expect(res.status).toBe(200);
    }
  );

  test("CASHIER bị chặn trước cả khi LLM sẽ chọn tool tra cứu", async () => {
    setRole("CASHIER");
    const res = await postQuery({ query: "công nợ khách hàng Nam là bao nhiêu?" });
    expect(res.status).toBe(403);
    // Không được chạm DB: handler tra cứu cũng phải 0 lần gọi.
    expect(mockSearchProducts).not.toHaveBeenCalled();
  });
});

describe("P0-1 · write tool không chạy được qua đường chat NL", () => {
  beforeEach(() => setRole("ADMIN"));

  test.each(["create_order", "create_po", "send_reminder"])(
    "LLM trả %s → từ chối, KHÔNG gọi handler",
    async (tool) => {
      llmReturnsTool(tool, { vendorName: "NCC A", items: [] });

      const result = await llmChat.chat("tạo đơn nhập cho tôi");

      expect(result.success).toBe(false);
      expect(result.message).toMatch(/human-gate/);

      // Điều quan trọng nhất: không có side-effect nào xảy ra.
      expect(mockCreateOrder).not.toHaveBeenCalled();
      expect(mockCreatePo).not.toHaveBeenCalled();
      expect(mockSendReminder).not.toHaveBeenCalled();
    }
  );

  test("đường fallback keyword cũng không lách được chặn write tool", async () => {
    // LLM hỏng → inferTool = null → rơi xuống resolveIntent (keyword).
    llmFails();
    dbAgentService.resolveIntent.mockReturnValue("create_po");

    const result = await llmChat.chat("tạo po nhập thêm hàng");

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/human-gate/);
    expect(mockCreatePo).not.toHaveBeenCalled();
  });

  test("tool tra cứu vẫn chạy bình thường", async () => {
    llmReturnsTool("search_products", { search: "nến" });

    const result = await llmChat.chat("tồn nến thơ còn bao nhiêu");

    expect(result.success).toBe(true);
    expect(mockSearchProducts).toHaveBeenCalledTimes(1);
  });

  test("tool lạ do LLM bịa ra → không chạy handler nào", async () => {
    llmReturnsTool("drop_all_tables", {});

    const result = await llmChat.chat("xóa hết bảng");

    expect(result.success).toBe(false);
    expect(mockSearchProducts).not.toHaveBeenCalled();
    expect(mockCreatePo).not.toHaveBeenCalled();
  });
});

describe("P0-1 · WRITE_TOOLS là nguồn duy nhất", () => {
  test("export đủ 3 write tool", () => {
    expect(dbAgentService.WRITE_TOOLS).toBeInstanceOf(Set);
    expect([...dbAgentService.WRITE_TOOLS].sort()).toEqual([
      "create_order", "create_po", "send_reminder",
    ]);
  });

  test("isWriteTool nhất quán với set, tool tra cứu trả false", () => {
    for (const t of dbAgentService.WRITE_TOOLS) {
      expect(dbAgentService.isWriteTool(t)).toBe(true);
    }
    expect(dbAgentService.isWriteTool("search_products")).toBe(false);
    expect(dbAgentService.isWriteTool("search_hr")).toBe(false);
  });
});