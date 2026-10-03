/**
 * config/llm.js — Cấu hình + client LLM cloud (Gemini / OpenAI-compatible)
 *
 * Vì sao không dùng global fetch: trên mạng WiFi này DNS trả AAAA trước và máy KHÔNG có
 * IPv6 default route, nên fetch() của Node bị treo → request chết lặng. Ở đây dùng
 * https.request với `family: 4` để cưỡng chế IPv4, không phụ thuộc DNS/OS.
 *
 * Biến môi trường (xem .env / .env.example):
 *   LLM_PROVIDER     gemini | openai-compatible | local   (mặc định: gemini nếu có key)
 *   GEMINI_API_KEY   API key của Google AI Studio
 *   LLM_MODEL        model id, ví dụ gemini-3.8-flash
 *   LLM_BASE_URL     ghi đè endpoint (dùng cho gateway OpenAI-compatible)
 *   LLM_TIMEOUT_MS   timeout mỗi request (mặc định 60000)
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

const config = () => {
  const key = process.env.GEMINI_API_KEY || "";
  const provider = (process.env.LLM_PROVIDER || (key ? "gemini" : "local")).toLowerCase();
  return {
    provider,
    apiKey: key,
    model: process.env.LLM_MODEL || "gemini-3.8-flash",
    baseUrl: (process.env.LLM_BASE_URL || DEFAULT_GEMINI_BASE).replace(/\/$/, ""),
    timeoutMs: Number(process.env.LLM_TIMEOUT_MS) || 60000,
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
const requestJson = (url, body, headers = {}) =>
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
          const apiMsg = json?.error?.message || raw.slice(0, 300);
          const err = new Error(`Gemini HTTP ${res.statusCode}: ${apiMsg}`);
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
 * Chuẩn hoá `usageMetadata` của Gemini. Trả về số nguyên ≥ 0, thiếu thì 0 —
 * KHÔNG đoán: thiếu `usageMetadata` nghĩa là provider không báo, ghi 0 và để
 * `succeeded` nói thật chuyện gì đã xảy ra.
 */
const readUsage = (json) => {
  const u = json?.usageMetadata || {};
  const n = (v) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.trunc(Number(v)) : 0);
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

const callModel = async (model, { system, prompt, jsonMode, temperature, maxOutputTokens }) => {
  const c = config();
  const url = `${c.baseUrl}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(c.apiKey)}`;
  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { temperature, maxOutputTokens, ...(jsonMode ? { responseMimeType: "application/json" } : {}) },
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

const generateText = async (opts = {}) => {
  const c = config();
  if (!isConfigured()) {
    throw new Error(`Chua cau hinh LLM cloud (LLM_PROVIDER=${c.provider}). Can GEMINI_API_KEY trong .env`);
  }
  const { system, prompt, jsonMode = false, temperature = 0.2, maxOutputTokens = 2048 } = opts;
  const task = opts.task || "OTHER";
  const startedAt = Date.now();

  const primary = activeModel || c.model;
  const chain = [primary, ...fallbackModels().filter((m) => m !== primary)];
  let lastErr = null;

  for (const model of chain) {
    let budget = maxOutputTokens;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const { text, usage } = await callModel(model, { system, prompt, jsonMode, temperature, maxOutputTokens: budget });
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
  await recordUsage({ task, provider: c.provider, model: primary, mode: opts.mode || "live", usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, latencyMs: Date.now() - startedAt, succeeded: false, responseText: String(lastErr?.message || "LLM that bai").slice(0, 500) });
  throw new Error(`${lastErr?.message || "LLM that bai"} (da thu: ${chain.join(", ")})`);
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
  if (!isConfigured()) throw new Error("Chua cau hinh LLM cloud (thieu GEMINI_API_KEY)");
  const json = await getJson(`${c.baseUrl}/models?key=${encodeURIComponent(c.apiKey)}&pageSize=100`);
  return (json.models || []).map((m) => m.name.replace(/^models\//, ""));
};

module.exports = { isConfigured, describe, generateText, listModels, parseJsonLoose, config, getLastUsage, resetLastUsage, readUsage };

