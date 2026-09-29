/**
 * tests/llm-config.test.js — Cấu hình LLM cloud (không cần mạng/DB)
 *
 * Phần network thật kiểm tra bằng `npm run check:llm` (cần key + Internet).
 * File này bảo vệ phần logic thuần: chọn provider, parse JSON, phân loại lỗi.
 */
const path = require("path");

const MODULE = path.join(__dirname, "..", "src", "config", "llm.js");

const loadWith = (env) => {
  const saved = { ...process.env };
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
