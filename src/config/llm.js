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
 *   - generateText({ system, prompt, jsonMode }): trả về chuỗi trả lời
 *   - listModels(): danh sách model của provider (chẩn đoán)
 *   - parseJsonLoose(text): parse JSON bỏ qua code fence
 */
const https = require("https");
const logger = require("../utils/logger");

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
  return text;
};

const generateText = async (opts = {}) => {
  const c = config();
  if (!isConfigured()) {
    throw new Error(`Chua cau hinh LLM cloud (LLM_PROVIDER=${c.provider}). Can GEMINI_API_KEY trong .env`);
  }
  const { system, prompt, jsonMode = false, temperature = 0.2, maxOutputTokens = 2048 } = opts;

  const primary = activeModel || c.model;
  const chain = [primary, ...fallbackModels().filter((m) => m !== primary)];
  let lastErr = null;

  for (const model of chain) {
    let budget = maxOutputTokens;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const text = await callModel(model, { system, prompt, jsonMode, temperature, maxOutputTokens: budget });
        if (activeModel && activeModel !== model) {
          logger.warn(`[LLM] chuyen sang model ${model} (thay cho ${c.model})`);
        }
        activeModel = model;
        logger.debug(`[LLM] ${model} ok, ${text.length} ky tu`);
        return text;
      } catch (e) {
        lastErr = e;
        if (!e.retryable) {
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

module.exports = { isConfigured, describe, generateText, listModels, parseJsonLoose, config };

