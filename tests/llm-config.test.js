/**
 * tests/llm-config.test.js — Cấu hình LLM cloud (không cần mạng/DB)
 *
 * Phần network thật kiểm tra bằng `npm run check:llm` (cần key + Internet).
 * File này bảo vệ phần logic thuần: chọn provider, parse JSON, phân loại lỗi.
 */
const path = require("path");

const MODULE = path.join(__dirname, "..", "src", "config", "llm.js");

// config() đọc ba cặp tên biến: LLM_*, và OPENAI_*/MODEL_NAME theo chuẩn SDK
// (thêm 2026-10-15). Test phải xoá HẾT cả hai nhóm, nếu không thì `OPENAI_API_KEY`
// trong .env thật lọt vào và làm các test "không có key" đổi kết quả.
const BIEN_LLM = [
  "LLM_PROVIDER", "LLM_API_KEY", "LLM_MODEL", "LLM_BASE_URL", "LLM_FALLBACK_MODELS",
  "LLM_UIT_API_KEY", "LLM_UIT_MODEL",
  "GEMINI_API_KEY",
  "OPENAI_API_KEY", "OPENAI_BASE_URL", "MODEL_NAME",
];

const loadWith = (env) => {
  const saved = { ...process.env };
  BIEN_LLM.forEach((k) => delete process.env[k]);
  Object.keys(env).forEach((k) => {
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  });
  delete require.cache[require.resolve(MODULE)];
  const mod = require(MODULE);
  return { mod, restore: () => { process.env = saved; delete require.cache[require.resolve(MODULE)]; } };
};

describe("config/llm — cấu hình provider", () => {
  let restore;
  afterEach(() => restore && restore());

  test("không có key thì provider = local và isConfigured() = false", () => {
    const r = loadWith({ GEMINI_API_KEY: undefined, LLM_PROVIDER: undefined, LLM_MODEL: undefined, LLM_BASE_URL: undefined });
    restore = r.restore;
    expect(r.mod.config().provider).toBe("local");
    expect(r.mod.isConfigured()).toBe(false);
    expect(r.mod.describe().configured).toBe(false);
  });

  test("có GEMINI_API_KEY thì tự chọn provider gemini, model mặc định gemini-3.8-flash", () => {
    const r = loadWith({ GEMINI_API_KEY: "test-key", LLM_PROVIDER: undefined, LLM_MODEL: undefined, LLM_BASE_URL: undefined });
    restore = r.restore;
    expect(r.mod.config().provider).toBe("gemini");
    expect(r.mod.isConfigured()).toBe(true);
    expect(r.mod.config().model).toBe("gemini-3.8-flash");
  });

  test("LLM_PROVIDER=local ghi đè, dù có key vẫn coi như chưa cấu hình", () => {
    const r = loadWith({ GEMINI_API_KEY: "test-key", LLM_PROVIDER: "local" });
    restore = r.restore;
    expect(r.mod.isConfigured()).toBe(false);
  });

  test("fallback không chứa gemini-2.5-flash (tài khoản mới bị 404)", () => {
    const src = require("fs").readFileSync(MODULE, "utf8");
    const line = src.split("\n").find((l) => l.includes("gemini-flash-latest"));
    expect(line).toBeTruthy();
    expect(line).not.toMatch(/gemini-2\.5-flash\s*"/);
  });

  test("describe() không làm lộ API key", () => {
    const r = loadWith({ GEMINI_API_KEY: "super-secret-key" });
    restore = r.restore;
    expect(JSON.stringify(r.mod.describe())).not.toContain("super-secret-key");
  });

  // ── Tên biến kiểu OpenAI SDK (thêm 2026-10-15) ────────────────────────
  // Các project khác trên máy đặt .env theo chuẩn SDK. Nếu chỉ đọc LLM_* thì
  // key trong .env bị bỏ qua và gateway trả "401 Missing API key" — trông y hệt
  // key sai dù file hoàn toàn đúng.
  test("đọc OPENAI_API_KEY / OPENAI_BASE_URL / MODEL_NAME", () => {
    const r = loadWith({
      LLM_PROVIDER: "openai-compatible",
      OPENAI_API_KEY: "sk-router-123", OPENAI_BASE_URL: "http://localhost:20128/v1",
      MODEL_NAME: "oc/muse-spark-1.3-contributor-free",
    });
    restore = r.restore;
    const c = r.mod.config();
    expect(c.apiKey).toBe("sk-router-123");
    expect(c.baseUrl).toBe("http://localhost:20128/v1");
    expect(c.model).toBe("oc/muse-spark-1.3-contributor-free");
    expect(r.mod.isConfigured()).toBe(true);
  });

  test("LLM_* được ưu tiên khi có cả hai kiểu đặt tên", () => {
    const r = loadWith({
      LLM_PROVIDER: "openai-compatible",
      LLM_API_KEY: "khoa-llm", LLM_BASE_URL: "https://llm.erp.local/v1", LLM_MODEL: "model-llm",
      OPENAI_API_KEY: "khoa-openai", OPENAI_BASE_URL: "https://llm.skhac.local/v1", MODEL_NAME: "model-openai",
    });
    restore = r.restore;
    const c = r.mod.config();
    expect(c.apiKey).toBe("khoa-llm");
    expect(c.baseUrl).toBe("https://llm.erp.local/v1");
    expect(c.model).toBe("model-llm");
  });

  test("bỏ dấu thừa quanh giá trị lấy từ biến môi trường", () => {
    const r = loadWith({ LLM_PROVIDER: "openai-compatible", OPENAI_API_KEY: "  sk-co-khoang  " });
    restore = r.restore;
    expect(r.mod.config().apiKey).toBe("sk-co-khoang");
  });

  test("OPENAI_API_KEY rỗng thì KHÔNG được coi là có key", () => {
    // `trim()` trong firstEnv: biến để trống phải rơi tiếp, không được chặn
    // provider khác bằng một chuỗi rỗng.
    const r = loadWith({ LLM_PROVIDER: "openai-compatible", LLM_API_KEY: undefined, OPENAI_API_KEY: "   " });
    restore = r.restore;
    expect(r.mod.isConfigured()).toBe(false);
  });

  // ── Body SSE (thêm 2026-10-15) ─────────────────────────────────────────
  // 9router trả SSE cho provider `ollama` dù request KHÔNG bật `stream`.
  // Trước đây `JSON.parse` fail ⇒ raw bị vứt ⇒ báo "không trả về nội dung"
  // trong khi model đã trả lời đúng. Body thật lấy từ 9router:
  //   data: {...,"choices":[{"delta":{"content":"Chào"},"finish_reason":null}]}
  //   data: {...,"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{...}}
  const SSE_THAT = [
    'data: {"id":"c1","object":"chat.completion.chunk","model":"gemma4:31b-cloud","choices":[{"index":0,"delta":{"content":"Chào"},"finish_reason":null}]}',
    "",
    'data: {"id":"c1","object":"chat.completion.chunk","model":"gemma4:31b-cloud","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":23,"completion_tokens":2,"total_tokens":25}}',
    "",
    'data: [DONE]',
    '',
  ].join('\n');

  test("gom body SSE thành đáp án đầy đủ", () => {
    const r = loadWith({ LLM_PROVIDER: "openai-compatible", OPENAI_API_KEY: "k" });
    restore = r.restore;
    expect(r.mod.parseChatResponse({ __raw: SSE_THAT }).text).toBe("Chào");
  });

  test("SSE nhiều chunk thì nối lại, không mất phần giữa", () => {
    const r = loadWith({ LLM_PROVIDER: "openai-compatible", OPENAI_API_KEY: "k" });
    restore = r.restore;
    const body = [
      'data: {"choices":[{"delta":{"content":"Xin "}}]}',
      'data: {"choices":[{"delta":{"content":"chào "}}]}',
      'data: {"choices":[{"delta":{"content":"bạn"},"finish_reason":"stop"}],"usage":{"total_tokens":9}}',
    ].join('\n');
    expect(r.mod.parseChatResponse({ __raw: body }).text).toBe("Xin chào bạn");
  });

  test("SSE giữ riêng reasoning_content, không trộn vào đáp án", () => {
    const r = loadWith({ LLM_PROVIDER: "openai-compatible", OPENAI_API_KEY: "k" });
    restore = r.restore;
    const body = [
      'data: {"choices":[{"delta":{"reasoning_content":"suy nghĩ..."}}]}',
      'data: {"choices":[{"delta":{"content":"đáp án"},"finish_reason":"stop"}]}',
    ].join('\n');
    const out = r.mod.parseChatResponse({ __raw: body });
    expect(out.text).toBe("đáp án");
    expect(out.reasoning).toBe("suy nghĩ...");
  });

  test("SSE lấy usage từ chunk cuối để đo token", () => {
    const r = loadWith({ LLM_PROVIDER: "openai-compatible", OPENAI_API_KEY: "k" });
    restore = r.restore;
    const out = r.mod.normalizeChatBody({ __raw: SSE_THAT });
    expect(out.usage.total_tokens).toBe(25);
    expect(out.choices[0].finish_reason).toBe("stop");
  });

  test("body JSON thường thì giữ nguyên, không bị đụng", () => {
    const r = loadWith({ LLM_PROVIDER: "openai-compatible", OPENAI_API_KEY: "k" });
    restore = r.restore;
    const binhThuong = { choices: [{ message: { content: "OK" }, finish_reason: "stop" }], usage: { total_tokens: 3 } };
    expect(r.mod.parseChatResponse(binhThuong).text).toBe("OK");
    expect(r.mod.normalizeChatBody(binhThuong)).toBe(binhThuong);
  });

  test("body không nhận ra thì phải nêu lý do, không báo chung chung", () => {
    // Không phải JSON, không phải SSE (ví dụ proxy trả HTML lỗi).
    // 'không trả về nội dung' kèm 'không phải JSON cũng không phải SSE' là hai
    // lỗi khác nhau, cần hai cách sửa khác nhau — không được gộp làm một.
    const r = loadWith({ LLM_PROVIDER: "openai-compatible", OPENAI_API_KEY: "k" });
    restore = r.restore;
    let err = null;
    try { r.mod.parseChatResponse({ __raw: "<html>502 Bad Gateway</html>" }); } catch (e) { err = e; }
    expect(err).toBeTruthy();
    expect(err.rawPreview).toContain("502");
    expect(err.hint).toMatch(/khong phai JSON/);
  });

  test("parseChatResponse nhận trực tiếp chuỗi raw", () => {
    const r = loadWith({ LLM_PROVIDER: "openai-compatible", OPENAI_API_KEY: "k" });
    restore = r.restore;
    expect(r.mod.parseChatResponse(SSE_THAT).text).toBe("Chào");
  });

  test("LLM_PROVIDER=uit + LLM_UIT_API_KEY thì configured, model mặc định gemma-4-26b", () => {
    const r = loadWith({
      GEMINI_API_KEY: undefined, LLM_PROVIDER: "uit", LLM_UIT_API_KEY: "uit-key",
      LLM_MODEL: undefined, LLM_UIT_MODEL: undefined, LLM_UIT_GEMMA_URL: undefined, LLM_UIT_QWEN_URL: undefined,
    });
    restore = r.restore;
    expect(r.mod.config().provider).toBe("uit");
    expect(r.mod.isConfigured()).toBe(true);
    expect(r.mod.config().model).toBe("gemma-4-26b");
    expect(r.mod.config().uit.gemmaUrl).toBe("https://llm.uit.edu.vn/gemma/v1");
    expect(r.mod.config().uit.qwenUrl).toBe("https://llm.uit.edu.vn/qwen/v1");
    expect(JSON.stringify(r.mod.describe())).not.toContain("uit-key");
  });

  test("UIT không dùng ké GEMINI_API_KEY (key Google gọi UIT sẽ 401 khó hiểu)", () => {
    const r = loadWith({
      GEMINI_API_KEY: "google-key", LLM_PROVIDER: "uit",
      LLM_UIT_API_KEY: undefined, LLM_API_KEY: undefined,
    });
    restore = r.restore;
    expect(r.mod.isConfigured()).toBe(false);
  });

  test("LLM_API_KEY là fallback cho UIT key", () => {
    const r = loadWith({ GEMINI_API_KEY: undefined, LLM_PROVIDER: "uit", LLM_API_KEY: "shared-key" });
    restore = r.restore;
    expect(r.mod.isConfigured()).toBe(true);
  });
});

describe("config/llm — parseJsonLoose", () => {
  const { mod, restore: r } = loadWith({});
  afterAll(() => r());

  test("parse JSON thuần", () => {
    expect(mod.parseJsonLoose('{"tool":"search_products","params":{}}')).toEqual({ tool: "search_products", params: {} });
  });

  test("bỏ được code fence ```json", () => {
    expect(mod.parseJsonLoose('```json\n{"tool":"get_revenue","params":{}}\n```')).toEqual({ tool: "get_revenue", params: {} });
  });

  test("cắt được JSON khi model thêm text thừa", () => {
    expect(mod.parseJsonLoose('Đây là kết quả: {"tool":"search_orders","params":{"status":"PENDING"}} hết.')).toEqual({
      tool: "search_orders",
      params: { status: "PENDING" },
    });
  });

  test("trả null khi không có JSON nào", () => {
    expect(mod.parseJsonLoose("không có JSON ở đây")).toBeNull();
  });
});

describe("config/llm — provider UIT (docs/llm_uit.md)", () => {
  // Mỗi test nạp module mới với env riêng: describe khác có afterAll restore env
  // collection-time (kèm LLM_MODEL từ .env) nên KHÔNG dùng chung module ở đây.
  let restore;
  afterEach(() => restore && restore());
  const loadUit = (extra = {}) => {
    const r = loadWith({
      GEMINI_API_KEY: undefined, LLM_PROVIDER: "uit", LLM_UIT_API_KEY: "k",
      LLM_MODEL: undefined, LLM_UIT_MODEL: undefined,
      LLM_UIT_REASONING_MODEL: undefined, LLM_UIT_GEMMA_URL: undefined, LLM_UIT_QWEN_URL: undefined,
      ...extra,
    });
    restore = r.restore;
    return r.mod;
  };

  test("readUsage đọc usage kiểu OpenAI (prompt_tokens/completion_tokens/total_tokens)", () => {
    const mod = loadUit();
    expect(mod.readUsage({ usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }))
      .toEqual({ promptTokens: 10, completionTokens: 5, totalTokens: 15 });
  });

  test("readUsage vẫn đọc usageMetadata kiểu Gemini", () => {
    const mod = loadUit();
    expect(mod.readUsage({ usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 3, totalTokenCount: 10 } }))
      .toEqual({ promptTokens: 7, completionTokens: 3, totalTokens: 10 });
  });

  test("selectUitTarget: mặc định Gemma, reasoning=true thì Qwen + đúng endpoint", () => {
    const mod = loadUit();
    const fast = mod.selectUitTarget({});
    expect(fast.model).toBe("gemma-4-26b");
    expect(fast.baseUrl).toBe("https://llm.uit.edu.vn/gemma/v1");
    const deep = mod.selectUitTarget({ reasoning: true });
    expect(deep.model).toBe("qwen3.8-27b");
    expect(deep.baseUrl).toBe("https://llm.uit.edu.vn/qwen/v1");
  });

  test("buildChatBody: tắt thinking thì kèm extra_body + giữ max_tokens", () => {
    const mod = loadUit();
    const body = mod.buildChatBody({ model: "qwen3.8-27b", prompt: "hi", temperature: 0, maxTokens: 1024, thinking: false });
    expect(body.extra_body).toEqual({ chat_template_kwargs: { enable_thinking: false } });
    expect(body.max_tokens).toBe(1024);
    expect(body.messages.at(-1)).toEqual({ role: "user", content: "hi" });
  });

  test("buildChatBody: bật thinking thì max_tokens tối thiểu 2000 (kẻo model hết token trước khi trả lời)", () => {
    const mod = loadUit();
    const body = mod.buildChatBody({ model: "qwen3.8-27b", prompt: "hi", temperature: 0, maxTokens: 500, thinking: true });
    expect(body.max_tokens).toBe(2000);
    expect(body.extra_body).toBeUndefined();
  });

  test("buildChatBody: jsonMode thì response_format json_object + system message đầu tiên", () => {
    const mod = loadUit();
    const body = mod.buildChatBody({ model: "gemma-4-26b", system: "sys", prompt: "p", jsonMode: true, temperature: 0, maxTokens: 100, thinking: false });
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.messages[0]).toEqual({ role: "system", content: "sys" });
  });

  test("parseChatResponse: tách reasoning_content, không trộn vào đáp án", () => {
    const mod = loadUit();
    const out = mod.parseChatResponse({
      choices: [{ message: { content: "đáp án", reasoning_content: "suy nghĩ dài..." }, finish_reason: "stop" }],
    });
    expect(out.text).toBe("đáp án");
    expect(out.reasoning).toBe("suy nghĩ dài...");
  });

  test("parseChatResponse: finish_reason=length thì retryable + cần thêm token (như MAX_TOKENS Gemini)", () => {
    const mod = loadUit();
    try {
      mod.parseChatResponse({ choices: [{ message: { content: "", reasoning_content: "..." }, finish_reason: "length" }] });
      throw new Error("phải ném lỗi khi không có content");
    } catch (e) {
      expect(e.retryable).toBe(true);
      expect(e.needsMoreTokens).toBe(true);
    }
  });

  test("đường UIT dùng /chat/completions, không dùng URL generateContent của Gemini", () => {
    loadUit();
    const src = require("fs").readFileSync(MODULE, "utf8");
    expect(src).toContain("/chat/completions");
  });
});
