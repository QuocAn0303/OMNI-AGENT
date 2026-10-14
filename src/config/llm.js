/**
 * config/llm.js — Cấu hình + client LLM cloud (Gemini / OpenAI-compatible)
 *
 * Vì sao không dùng global fetch: trên mạng WiFi này DNS trả AAAA trước và máy KHÔNG có
 * IPv6 default route, nên fetch() của Node bị treo → request chết lặng. Ở đây dùng
 * https.request với `family: 4` để cưỡng chế IPv4, không phụ thuộc DNS/OS.
 *
 * Biến môi trường (xem .env / .env.example):
 *   LLM_PROVIDER     gemini | openai-compatible | uit | local   (mặc định: gemini nếu có key)
 *   GEMINI_API_KEY   API key của Google AI Studio
 *   LLM_MODEL        model id, ví dụ gemini-3.8-flash
 *   LLM_BASE_URL     ghi đè endpoint (dùng cho gateway OpenAI-compatible)
 *   LLM_TIMEOUT_MS   timeout mỗi request (mặc định 60000)
 *
 * UIT (Trường ĐH Công nghệ Thông tin — xem docs/llm_uit.md, API tương thích OpenAI):
 *   LLM_PROVIDER=uit dùng key riêng, KHÔNG dùng GEMINI_API_KEY.
 *   LLM_UIT_API_KEY  Bearer key của trường (bắt buộc; có thể dùng LLM_API_KEY thay thế)
 *   LLM_UIT_GEMMA_URL  mặc định https://llm.uit.edu.vn/gemma/v1 (model gemma-4-26b, nhanh)
 *   LLM_UIT_QWEN_URL   mặc định https://llm.uit.edu.vn/qwen/v1  (model qwen3.8-27b, suy luận sâu)
 *   LLM_UIT_MODEL            model nhanh mặc định (mặc định gemma-4-26b)
 *   LLM_UIT_REASONING_MODEL  model suy luận (mặc định qwen3.8-27b, dùng khi opts.reasoning=true)
 *   LLM_UIT_THINKING=1  giữ chế độ suy nghĩ của Qwen (mặc định TẮT để nhanh; bật thì
 *     max_tokens tự nâng tối thiểu 2000 theo khuyến cáo của trường).
 *   LƯU Ý MẠNG: API UIT chỉ reachable trong mạng nội bộ trường. Ngoài mạng, mọi
 *   request bị redirect 302 về www.uit.edu.vn (không phải lỗi key). Kiểm tra bằng
 *   `npm run check:llm` khi đã vào mạng trường + có key.
 *
 * Hàm/Exports:
 *   - isConfigured(): có provider cloud dùng được không
 *   - describe(): thông tin provider (không lộ key)
 *   - generateText({ system, prompt, jsonMode, task }): trả về chuỗi trả lời
 *   - getLastUsage(): token của lần gọi gần nhất (đọc `usageMetadata`)
 *   - listModels(): danh sách model của provider (chẩn đoán)
 *   - parseJsonLoose(text): parse JSON bỏ qua code fence
 *
 * T13 (2026-10-03) — SỔ GHI TOKEN:
 *   `callModel` trước đây bỏ qua hoàn toàn `json.usageMetadata` ⇒ không biết tốn
 *   bao nhiêu token. Nay đọc `promptTokenCount / candidatesTokenCount /
 *   totalTokenCount`, giữ vào `lastUsage`, và ghi MỘT dòng `LlmUsageLog` cho mỗi
 *   lần gọi (kể cả lần thất bại). Đây là đường LLM DUY NHẤT của hệ thống: mọi vai
 *   trò LLM (khớp SKU, giải thích, soạn tin NCC) đều đi qua `generateText` nên
 *   không có đường nào gọi model mà không ghi token.
 */
const https = require("https");
const logger = require("../utils/logger");
const { getTenantId } = require("./tenantContext");

const DEFAULT_GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_UIT_GEMMA_URL = "https://llm.uit.edu.vn/gemma/v1";
const DEFAULT_UIT_QWEN_URL = "https://llm.uit.edu.vn/qwen/v1";
const DEFAULT_UIT_MODEL = "gemma-4-26b";
const DEFAULT_UIT_REASONING_MODEL = "qwen3.8-27b";

const config = () => {
  const provider = (process.env.LLM_PROVIDER || (process.env.GEMINI_API_KEY ? "gemini" : "local")).toLowerCase();
  // Key theo provider: UIT có key riêng của trường, không dùng chung key Google.
  const apiKey =
    provider === "uit"
      ? process.env.LLM_UIT_API_KEY || process.env.LLM_API_KEY || ""
      : provider === "openai-compatible"
        ? process.env.LLM_API_KEY || process.env.GEMINI_API_KEY || ""
        : process.env.GEMINI_API_KEY || "";
  const model =
    process.env.LLM_MODEL ||
    (provider === "uit" ? process.env.LLM_UIT_MODEL || DEFAULT_UIT_MODEL : "gemini-3.8-flash");
  const baseUrl = (
    provider === "uit" ? DEFAULT_UIT_GEMMA_URL : process.env.LLM_BASE_URL || DEFAULT_GEMINI_BASE
  ).replace(/\/$/, "");
  return {
    provider,
    apiKey,
    model,
    baseUrl,
    timeoutMs: Number(process.env.LLM_TIMEOUT_MS) || 60000,
    uit: {
      gemmaUrl: (process.env.LLM_UIT_GEMMA_URL || DEFAULT_UIT_GEMMA_URL).replace(/\/$/, ""),
      qwenUrl: (process.env.LLM_UIT_QWEN_URL || DEFAULT_UIT_QWEN_URL).replace(/\/$/, ""),
      model: process.env.LLM_UIT_MODEL || DEFAULT_UIT_MODEL,
      reasoningModel: process.env.LLM_UIT_REASONING_MODEL || DEFAULT_UIT_REASONING_MODEL,
      thinking: process.env.LLM_UIT_THINKING === "1",
    },
  };
};

const isConfigured = () => {
  const c = config();
  return c.provider !== "local" && Boolean(c.apiKey);
};

const describe = () => {
  const c = config();
  return { provider: c.provider, model: c.model, baseUrl: c.baseUrl, configured: isConfigured() };
};

/** POST JSON ép IPv4, có timeout. Không dùng fetch (xem giải thích đầu file). */
const requestJson = (url, body, headers = {}, label = "Gemini") =>
  new Promise((resolve, reject) => {
    const target = new URL(url);
    const payload = JSON.stringify(body);
    const req = https.request(
      {
        hostname: target.hostname,
        path: `${target.pathname}${target.search}`,
        method: "POST",
        family: 4, // bắt buộc: máy này không có IPv6 default route
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload), ...headers },
        timeout: config().timeoutMs,
      },
      (res) => {
        let raw = "";
        res.on("data", (c) => { raw += c; });
        res.on("end", () => {
          let json = null;
          try { json = JSON.parse(raw); } catch { /* giữ raw */ }
          if (res.statusCode >= 200 && res.statusCode < 300) return resolve(json);
          // Ngoài mạng UIT, gateway trường redirect 302 về www.uit.edu.vn thay vì
          // trả JSON — báo rõ để không nhầm với "key sai".
          if (res.statusCode >= 300 && res.statusCode < 400) {
            const err = new Error(
              `${label} HTTP ${res.statusCode}: bị chuyển hướng về ${res.headers?.location || "?"} — ` +
              "thường là chưa vào mạng nội bộ UIT (API UIT chỉ dùng được trong mạng trường)",
            );
            err.retryable = false;
            return reject(err);
          }
          const apiMsg = json?.error?.message || json?.message || raw.slice(0, 300);
          const err = new Error(`${label} HTTP ${res.statusCode}: ${apiMsg}`);
          err.status = res.statusCode;
          // 503 = quá tải tạm thời (model đông người) → thử lại hoặc đổi model.
          // 429 = hết quota/rate-limit → cần chờ lâu hơn, không đổi model cũng vô ích.
          // 401/403 = key sai, 404 = model sai → không retry, fail ngay.
          err.retryable = res.statusCode === 503 || res.statusCode === 429 || res.statusCode === 500;
          if (res.statusCode === 429) {
            const ra = Number(res.headers?.["retry-after"]);
            err.rateLimited = true;
            err.retryAfterMs = Number.isFinite(ra) && ra > 0 ? ra * 1000 : 5000;
          }
          if (res.statusCode === 401 || res.statusCode === 403) err.hint = " (key không hợp lệ hoặc bị chặn)";
          if (res.statusCode === 404) err.hint = " (LLM_MODEL không tồn tại — chạy: npm run check:llm)";
          return reject(err);
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error(`Gemini timeout sau ${config().timeoutMs}ms`)));
    req.on("error", reject);
    req.write(payload);
    req.end();
  });

/** GET JSON ép IPv4 (dùng cho listModels). */
const getJson = (url) =>
  new Promise((resolve, reject) => {
    const target = new URL(url);
    const req = https.request(
      { hostname: target.hostname, path: `${target.pathname}${target.search}`, method: "GET", family: 4, timeout: config().timeoutMs },
      (res) => {
        let raw = "";
        res.on("data", (c) => { raw += c; });
        res.on("end", () => {
          let json = null;
          try { json = JSON.parse(raw); } catch { /* ignore */ }
          if (res.statusCode >= 200 && res.statusCode < 300) return resolve(json);
          return reject(new Error(`Gemini HTTP ${res.statusCode}: ${json?.error?.message || raw.slice(0, 300)}`));
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("Gemini timeout")));
    req.on("error", reject);
    req.end();
  });

/**
 * Gọi Gemini generateContent. Trả về chuỗi text.
 * jsonMode: yêu cầu model trả về JSON hợp lệ (dùng cho tool-calling).
 *
 * Chịu được tình huống model chính bị quá tải (503 high demand):
 * retry 2 lần trên cùng model, rồi lùi dần qua LLM_FALLBACK_MODELS.
 * Lỗi key/model sai (401/403/404) thì fail ngay, không retry.
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const fallbackModels = () => {
  const raw = process.env.LLM_FALLBACK_MODELS;
  if (raw) return raw.split(",").map((s) => s.trim()).filter(Boolean);
  // KHÔNG dùng gemini-2.5-flash: tài khoản mới bị 404 "no longer available to new users".
  return ["gemini-flash-latest", "gemini-3.7-flash", "gemini-3.5-flash"];
};

// Model đã biết chạy được trong phiên này → bỏ qua thử các model trước đó.
let activeModel = null;

// ── T13: sổ ghi token ──────────────────────────────────────────────────────
/** Token của lần gọi gần nhất. Đọc-sao để caller không sửa được giá trị đã ghi. */
let lastUsage = null;
const getLastUsage = () => (lastUsage ? { ...lastUsage } : null);
const resetLastUsage = () => {
  lastUsage = null;
};

/**
 * Chuẩn hoá `usageMetadata` của Gemini HOẶC `usage` của API OpenAI-compatible.
 * Trả về số nguyên ≥ 0, thiếu thì 0 — KHÔNG đoán: thiếu nghĩa là provider không
 * báo, ghi 0 và để `succeeded` nói thật chuyện gì đã xảy ra.
 */
const readUsage = (json) => {
  const n = (v) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.trunc(Number(v)) : 0);
  const ou = json?.usage;
  if (ou && (ou.prompt_tokens != null || ou.completion_tokens != null || ou.total_tokens != null)) {
    return {
      promptTokens: n(ou.prompt_tokens),
      completionTokens: n(ou.completion_tokens),
      totalTokens: n(ou.total_tokens) || n(ou.prompt_tokens) + n(ou.completion_tokens),
    };
  }
  const u = json?.usageMetadata || {};
  return {
    promptTokens: n(u.promptTokenCount),
    completionTokens: n(u.candidatesTokenCount),
    totalTokens: n(u.totalTokenCount) || n(u.promptTokenCount) + n(u.candidatesTokenCount),
  };
};

/**
 * Ghi 1 dòng `LlmUsageLog`.
 *
 * VÌ SAO KHÔNG NÉM LỖI: ghi token là SỔ ĐO, không phải luồng nghiệp vụ. Một lần gọi
 * LLM đã thành công thì không được đổi thành lỗi 500 chỉ vì bảng sổ ghi lỗi. Vì vậy
 * lỗi ở đây chỉ `logger.error` (không nuốt im lặng) — và chính vì thế mọi kiểm chứng
 * về `LlmUsageLog` đều là smoke trên DB thật (`smoke:llm-usage`), không phải unit test.
 *
 * `tenantId` lấy từ AsyncLocalStorage (`getTenantId`). Ngoài tenant context thì ghi
 * NULL — đúng như thiết kế bảng: phân biệt "lỗi" với "không thuộc tenant nào".
 */
const recordUsage = async ({ task, provider, model, mode, usage, latencyMs, succeeded, promptText, responseText }) => {
  try {
    if (process.env.LLM_USAGE_LOG === "0") return null;
    // Lazy require: `config/prisma` nặng và không cần cho các call site chỉ đọc text.
    const prisma = require("./prisma");
    return await prisma.llmUsageLog.create({
      data: {
        tenantId: getTenantId(),
        task: task || "OTHER",
        provider: provider || "unknown",
        model: model || "unknown",
        mode: mode || "live",
        promptTokens: usage?.promptTokens ?? 0,
        completionTokens: usage?.completionTokens ?? 0,
        totalTokens: usage?.totalTokens ?? 0,
        latencyMs: Math.max(0, Math.trunc(Number(latencyMs) || 0)),
        succeeded: succeeded === true,
        ...(promptText ? { promptText: String(promptText) } : {}),
        ...(responseText ? { responseText: String(responseText) } : {}),
      },
    });
  } catch (e) {
    logger.error(`[LLM] ghi LlmUsageLog THẤT BẠI (task=${task}, model=${model}): ${e.message}`);
    return null;
  }
};

/**
 * Gọi Gemini.
 *
 * `responseSchema` (thêm 2026-10-15): buộc model trả về đúng khuôn dữ liệu.
 *
 * VÌ SAO CẦN — bằng chứng đo được trên project Gemini mới:
 *   `responseMimeType: "application/json"` ĐÃ có sẵn, nhưng vẫn có **2/8** ca
 *   trả về JSON sai khuôn ⇒ `LlmMatchSchema.safeParse` thất bại ⇒ hệ thống loại
 *   bỏ và đẩy sang người dùng xác nhận. Đo trên `llm_usage_logs`: **13/13** lời
 *   gọi HTTP 200, **0** lỗi hạ tầng ⇒ 100% là lỗi ĐỊNH DẠNG, không phải 503.
 *
 *   `responseMimeType` chỉ bảo model "trả về JSON"; `responseSchema` mới bảo
 *   "JSON đúng các trường này, kiểu này". Gemini hỗ trợ schema theo tập con
 *   OpenAPI 3.0 nên không cần model nào đặc biệt.
 *
 *   Hệ quả: thất bại vì khuôn biến về 0; những lỗi còn lại là việc nội dung
 *   (LLM tự chấm điểm thấp, hoặc trả mã ngoài danh sách ứng viên) — vốn đã có
 *   đường xử lý riêng.
 *
 *   QUAN TRỌNG: schema CHỈ ràng buộc HÌNH DẠNG, không ép nội dung. Ràng buộc
 *   "mã trả về phải nằm trong danh sách ứng viên" vẫn do `sku-matcher.hybrid.js`
 *   kiểm — đó là kiểm chéo phía sau model, không phải việc của schema.
 */
const callModel = async (model, { system, prompt, jsonMode, temperature, maxOutputTokens, responseSchema }) => {
  const c = config();
  const url = `${c.baseUrl}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(c.apiKey)}`;
  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature,
      maxOutputTokens,
      ...(jsonMode ? { responseMimeType: "application/json" } : {}),
      // Chỉ có hiệu lực khi đi kèm responseMimeType = application/json.
      ...(jsonMode && responseSchema ? { responseSchema } : {}),
    },
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
  };
  const json = await requestJson(url, body);
  const text = json?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ?? "";
  if (!text) {
    const reason = json?.candidates?.[0]?.finishReason || json?.promptFeedback?.blockReason || "khong ro";
    const err = new Error(`Gemini khong tra ve noi dung (finishReason=${reason})`);
    // Model dòng 3.x nghĩ bằng thinking token: budget nhỏ sẽ bị MAX_TOKENS và không còn text.
    // Đánh dấu cần thử lại với budget lớn hơn thay vì fail thẳng.
    err.retryable = reason === "MAX_TOKENS";
    err.needsMoreTokens = reason === "MAX_TOKENS";
    throw err;
  }
  // `usageMetadata` nằm cạnh `candidates`, không nằm trong candidate — đọc sai chỗ là
  // mất toàn bộ số liệu token (đúng lỗi mà T13 sửa).
  return { text, usage: readUsage(json) };
};

// ── OpenAI-compatible (/chat/completions): UIT + gateway chung ──────────────
// Sửa bug B6 (`docs/aisc26/00-scope.md`): trước đây provider openai-compatible vẫn
// đi URL Gemini nên không bao giờ chạy được. Nay có đường chat thật.

/**
 * Dựng body `/chat/completions` (thuần, không mạng — để unit test được).
 *
 * Qwen của UIT bật thinking sẵn, tốn ~15s cho câu ngắn. Mặc định TẮT để nhanh
 * (`LLM_UIT_THINKING=1` để giữ). Bật thinking thì max_tokens tối thiểu 2000,
 * nếu không model hết token trước khi kịp trả lời (theo docs/llm_uit.md).
 */
const buildChatBody = ({ model, system, prompt, jsonMode, temperature, maxTokens, thinking }) => {
  const messages = [];
  if (system) messages.push({ role: "system", content: system });
  messages.push({ role: "user", content: prompt });
  const body = {
    model,
    messages,
    temperature,
    max_tokens: thinking ? Math.max(maxTokens, 2000) : maxTokens,
    ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
    // `extra_body` là passthrough của gateway OpenAI-compatible; server không hiểu
    // thì bỏ qua. Chỉ gửi khi TẮT thinking (mặc định), vì mặc định server đã bật.
    ...(thinking ? {} : { extra_body: { chat_template_kwargs: { enable_thinking: false } } }),
  };
  return body;
};

/**
 * Đọc text từ response `/chat/completions` (thuần, không mạng).
 * `reasoning_content` (suy nghĩ của Qwen) KHÔNG trộn vào đáp án — caller log riêng.
 * `finish_reason=length` tương đương MAX_TOKENS của Gemini: cần budget lớn hơn.
 */
const parseChatResponse = (json) => {
  const choice = json?.choices?.[0] || {};
  const text = choice?.message?.content ?? "";
  const reasoning = choice?.message?.reasoning_content || "";
  if (!text) {
    const err = new Error(`UIT khong tra ve noi dung (finish_reason=${choice?.finish_reason || "khong ro"})`);
    err.retryable = choice?.finish_reason === "length";
    err.needsMoreTokens = choice?.finish_reason === "length";
    throw err;
  }
  return { text, reasoning };
};

const callOpenAIChat = async ({ baseUrl, apiKey, model, system, prompt, jsonMode, temperature, maxTokens, thinking, label }) => {
  const url = `${baseUrl}/chat/completions`;
  const body = buildChatBody({ model, system, prompt, jsonMode, temperature, maxTokens, thinking });
  const json = await requestJson(url, body, { Authorization: `Bearer ${apiKey}` }, label || "OpenAI");
  const { text, reasoning } = parseChatResponse(json);
  if (reasoning) logger.debug(`[LLM] reasoning (${model}, ${reasoning.length} ky tu, khong tron vao dap an)`);
  return { text, usage: readUsage(json) };
};

/**
 * Chọn endpoint UIT theo nhiệm vụ: Gemma nhanh cho việc hàng loạt, Qwen cho suy
 * luận nhiều bước (theo bảng đo trong docs/llm_uit.md). Trả về { baseUrl, model }.
 * Hai model nằm ở hai base URL khác nhau nên phải chọn cặp đúng — gửi model Qwen
 * vào endpoint Gemma sẽ 404.
 */
const selectUitTarget = ({ reasoning = false } = {}) => {
  const c = config();
  const explicit = (process.env.LLM_MODEL || "").trim();
  const endpointFor = (name) => (/qwen/i.test(name) ? c.uit.qwenUrl : c.uit.gemmaUrl);
  if (explicit) return { baseUrl: endpointFor(explicit), model: explicit };
  if (reasoning) return { baseUrl: c.uit.qwenUrl, model: c.uit.reasoningModel };
  return { baseUrl: c.uit.gemmaUrl, model: c.uit.model };
};

const generateText = async (opts = {}) => {
  const c = config();
  if (!isConfigured()) {
    const hint =
      c.provider === "uit"
        ? "Can LLM_UIT_API_KEY trong .env (xin key tu truong; API chi dung duoc trong mang UIT)"
        : "Can GEMINI_API_KEY trong .env";
    throw new Error(`Chua cau hinh LLM cloud (LLM_PROVIDER=${c.provider}). ${hint}`);
  }
  const { system, prompt, jsonMode = false, temperature = 0.2, maxOutputTokens = 2048 } = opts;
  // Schema đầu ra do CALLER đưa vào. Chỉ Gemini dùng; provider khác bỏ qua.
  // Xem `callModel` để hiểu vì sao cần.
  const responseSchema = opts.responseSchema || null;
  const task = opts.task || "OTHER";
  const startedAt = Date.now();

  // Chuỗi mục tiêu gọi theo thứ tự. Gemini: chỉ tên model (chung baseUrl).
  // UIT/openai-compatible: mang baseUrl riêng vì mỗi model có thể ở endpoint khác.
  let chain;
  if (c.provider === "uit") {
    const first = selectUitTarget({ reasoning: opts.reasoning === true });
    const other = /qwen/i.test(first.model) ? selectUitTarget({}) : selectUitTarget({ reasoning: true });
    const extra = (process.env.LLM_FALLBACK_MODELS || "")
      .split(",").map((s) => s.trim()).filter(Boolean)
      .filter((m) => m !== first.model && m !== other.model)
      .map((m) => ({ model: m, baseUrl: /qwen/i.test(m) ? c.uit.qwenUrl : c.uit.gemmaUrl }));
    chain = [first, ...(first.model === other.model ? [] : [other]), ...extra].map((t) => ({
      kind: "openai",
      label: "UIT",
      thinking: c.uit.thinking && /qwen/i.test(t.model),
      ...t,
    }));
  } else if (c.provider === "openai-compatible") {
    const model = activeModel || c.model;
    chain = [{ kind: "openai", label: "OpenAI", baseUrl: c.baseUrl, model, thinking: false }];
  } else {
    const primary = activeModel || c.model;
    chain = [primary, ...fallbackModels().filter((m) => m !== primary)].map((model) => ({ kind: "gemini", label: "Gemini", model }));
  }
  let lastErr = null;

  for (const target of chain) {
    const model = target.model;
    let budget = maxOutputTokens;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const { text, usage } =
          target.kind === "gemini"
            ? await callModel(model, { system, prompt, jsonMode, temperature, maxOutputTokens: budget, responseSchema })
            : await callOpenAIChat({
                baseUrl: target.baseUrl, apiKey: c.apiKey, model,
                system, prompt, jsonMode, temperature, maxTokens: budget,
                thinking: target.thinking, label: target.label,
              });
        if (activeModel && activeModel !== model) {
          logger.warn(`[LLM] chuyen sang model ${model} (thay cho ${c.model})`);
        }
        activeModel = model;
        logger.debug(`[LLM] ${model} ok, ${text.length} ky tu`);
        lastUsage = { task, provider: c.provider, model, ...usage, latencyMs: Date.now() - startedAt };
        await recordUsage({ task, provider: c.provider, model, mode: opts.mode || "live", usage, latencyMs: lastUsage.latencyMs, succeeded: true });
        return text;
      } catch (e) {
        lastErr = e;
        // Đơn vị ghi là MỘT lần gọi logic (một `generateText`), không phải mỗi HTTP
        // attempt: retry cùng model không tạo dòng riêng, nếu không thì lần 503 rồi
        // thành công sẽ ra 2 dòng cho 1 quyết định. Lần gọi cuối cùng thất bại thì vẫn
        // ghi 1 dòng (token 0, latency thật) — không ghi thì "tiền đi không" không đo được.
        if (!e.retryable) {
          await recordUsage({ task, provider: c.provider, model, mode: opts.mode || "live", usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, latencyMs: Date.now() - startedAt, succeeded: false, responseText: String(e.message).slice(0, 500) });
          throw new Error(`${e.message}${e.hint || ""}`);
        }
        if (e.needsMoreTokens) {
          budget = Math.max(budget * 4, 8192);
          logger.warn(`[LLM] ${model} het token budget → tang len ${budget}`);
          continue;
        }
        // 429 = rate-limit: chờ lâu hơn (hoặc đúng retry-after) rồi thử model kế tiếp.
        // 503 = quá tải: chờ ngắn rồi đổi model.
        const wait = e.rateLimited ? Math.min(e.retryAfterMs || 5000, 20000) : 1200;
        logger.warn(`[LLM] ${model} loi tam thoi (${e.status || "?"}), cho ${wait}ms roi thu tiep...`);
        await sleep(wait);
      }
    }
  }
  await recordUsage({ task, provider: c.provider, model: chain[0]?.model || "unknown", mode: opts.mode || "live", usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, latencyMs: Date.now() - startedAt, succeeded: false, responseText: String(lastErr?.message || "LLM that bai").slice(0, 500) });
  throw new Error(`${lastErr?.message || "LLM that bai"} (da thu: ${chain.map((t) => t.model).join(", ")})`);
};

/** Bo code fence + parse JSON, chiu duoc model tra them text thua. */
const parseJsonLoose = (text) => {
  const cleaned = String(text).replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try { return JSON.parse(cleaned); } catch { /* thu cat object dau-cuoi */ }
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first >= 0 && last > first) {
    try { return JSON.parse(cleaned.slice(first, last + 1)); } catch { /* bo cuoc */ }
  }
  return null;
};

const listModels = async () => {
  const c = config();
  if (!isConfigured()) throw new Error("Chua cau hinh LLM cloud (thieu API key)");
  if (c.provider === "gemini") {
    const json = await getJson(`${c.baseUrl}/models?key=${encodeURIComponent(c.apiKey)}&pageSize=100`);
    return (json.models || []).map((m) => m.name.replace(/^models\//, ""));
  }
  // OpenAI-compatible (gồm UIT): GET {baseUrl}/models với Bearer key.
  const target = c.provider === "uit" ? selectUitTarget({}) : { baseUrl: c.baseUrl };
  const json = await new Promise((resolve, reject) => {
    const u = new URL(`${target.baseUrl}/models`);
    const req = https.request(
      { hostname: u.hostname, path: `${u.pathname}${u.search}`, method: "GET", family: 4, timeout: c.timeoutMs, headers: { Authorization: `Bearer ${c.apiKey}` } },
      (res) => {
        let raw = "";
        res.on("data", (d) => { raw += d; });
        res.on("end", () => {
          let parsed = null;
          try { parsed = JSON.parse(raw); } catch { /* ignore */ }
          if (res.statusCode >= 200 && res.statusCode < 300) return resolve(parsed);
          return reject(new Error(`HTTP ${res.statusCode}: ${parsed?.error?.message || raw.slice(0, 200)}`));
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("UIT timeout")));
    req.on("error", reject);
    req.end();
  });
  return ((json && json.data) || []).map((m) => m.id).filter(Boolean);
};

module.exports = { isConfigured, describe, generateText, listModels, parseJsonLoose, config, getLastUsage, resetLastUsage, readUsage, buildChatBody, parseChatResponse, selectUitTarget };

