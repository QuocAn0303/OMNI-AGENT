/**
 * llm/modelFactory.ts — Kết nối 2 model của UIT Provider (OpenAI-compatible).
 *
 * ============================================================================
 * VÌ SAO 2 MODEL
 * ============================================================================
 * UIT có hai endpoint/model với đặc tính khác nhau (docs/llm_uit.md):
 *   - nhanh  (`gemma-4-26b`)  — phân loại, trích xuất, việc hàng loạt.
 *   - suy luận (`qwen3.8-27b`) — nhiều bước, cần lập luận.
 * Gửi model Qwen vào endpoint Gemma sẽ 404, nên CẶP (baseUrl, model) phải đi cùng
 * nhau — đó là lý do `resolveUitConfig` trả cả hai theo từng "mode".
 *
 * ============================================================================
 * BIẾN MÔI TRƯỜNG
 * ============================================================================
 * Ưu tiên tên MỚI, fallback sang tên mà `src/config/llm.js` đang dùng (để không
 * phải đặt lại biến khi đã cấu hình UIT cho ERP):
 *   UIT_LLM_API_KEY            → LLM_UIT_API_KEY → LLM_API_KEY → OPENAI_API_KEY
 *   UIT_LLM_BASE_URL           → LLM_UIT_GEMMA_URL  (endpoint model nhanh)
 *   UIT_LLM_REASONING_BASE_URL → LLM_UIT_QWEN_URL   (endpoint model suy luận)
 *   UIT_FAST_MODEL             → LLM_UIT_MODEL → gemma-4-26b
 *   UIT_REASONING_MODEL        → LLM_UIT_REASONING_MODEL → qwen3.8-27b
 *
 * Streaming TẮT thật (`stream: false`), temperature 0.1. Streaming "giả" của
 * `agent.llm.js` (chia chuỗi rồi bơm SSE) không dùng ở đây.
 */
import type { AuthContext, UsageRecord } from '../contracts/types';
import { traceEvent, type TraceEventInput } from '../telemetry/auditAndTrace';

const DEFAULT_GEMMA_URL = 'https://llm.uit.edu.vn/gemma/v1';
const DEFAULT_QWEN_URL = 'https://llm.uit.edu.vn/qwen/v1';
const DEFAULT_FAST_MODEL = 'gemma-4-26b';
const DEFAULT_REASONING_MODEL = 'qwen3.8-27b';

export type ModelMode = 'fast' | 'reasoning';

export interface UitModelConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
}

export interface UitConfig {
  fast: UitModelConfig;
  reasoning: UitModelConfig;
}

const firstEnv = (env: NodeJS.ProcessEnv, names: string[]): string => {
  for (const name of names) {
    const value = (env[name] || '').trim();
    if (value) return value;
  }
  return '';
};

const stripSlash = (url: string): string => url.replace(/\/+$/, '');

/** Cấu hình 2 model UIT; không lộ key ra ngoài `config.apiKey`. */
export const resolveUitConfig = (env: NodeJS.ProcessEnv = process.env): UitConfig => {
  const apiKey = firstEnv(env, ['UIT_LLM_API_KEY', 'LLM_UIT_API_KEY', 'LLM_API_KEY', 'OPENAI_API_KEY']);
  return {
    fast: {
      baseUrl: stripSlash(firstEnv(env, ['UIT_LLM_BASE_URL', 'LLM_UIT_GEMMA_URL']) || DEFAULT_GEMMA_URL),
      model: firstEnv(env, ['UIT_FAST_MODEL', 'LLM_UIT_MODEL']) || DEFAULT_FAST_MODEL,
      apiKey,
    },
    reasoning: {
      baseUrl: stripSlash(
        firstEnv(env, ['UIT_LLM_REASONING_BASE_URL', 'LLM_UIT_QWEN_URL']) || DEFAULT_QWEN_URL,
      ),
      model: firstEnv(env, ['UIT_REASONING_MODEL', 'LLM_UIT_REASONING_MODEL']) || DEFAULT_REASONING_MODEL,
      apiKey,
    },
  };
};

/** Thông tin cấu hình để in ra khi chẩn đoán — KHÔNG bao giờ chứa key. */
export const describeUitConfig = (env: NodeJS.ProcessEnv = process.env) => {
  const cfg = resolveUitConfig(env);
  return {
    fast: { baseUrl: cfg.fast.baseUrl, model: cfg.fast.model },
    reasoning: { baseUrl: cfg.reasoning.baseUrl, model: cfg.reasoning.model },
    configured: Boolean(cfg.fast.apiKey),
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Callback handler — đo token/độ trễ và tự ghi trace
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Bản `BaseCallbackHandler` cục bộ (cùng tên/phương thức với LangChain) để
 * package không phải kéo cả `@langchain/core` chỉ vì ba hook.
 *
 * Nếu sau này chuyển sang LangChain thật, chỉ cần cho các handler ở đây
 * `extends BaseCallbackHandler` của LangChain — chữ ký đã trùng.
 */
export abstract class BaseCallbackHandler {
  handleLLMStart(_event: LlmStartEvent): void {
    // no-op mặc định
  }

  handleLLMEnd(_event: LlmEndEvent): void {
    // no-op mặc định
  }

  handleLLMError(_event: LlmErrorEvent): void {
    // no-op mặc định
  }
}

export interface LlmStartEvent {
  runId: string;
  model: string;
  baseUrl: string;
  promptChars: number;
}

export interface LlmEndEvent {
  runId: string;
  model: string;
  baseUrl: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  latencyMs: number;
  text: string;
  usage: UsageRecord;
}

export interface LlmErrorEvent {
  runId: string;
  model: string;
  latencyMs: number;
  error: unknown;
}

export interface UsageTraceHandlerOptions {
  ctx: AuthContext;
  node?: string;
  assignedAgent?: string;
  skillName?: string;
  skillVersion?: string;
  trace?: (ctx: AuthContext, partial: TraceEventInput) => unknown;
}

/**
 * Handler tự động ghi trace cho MỖI lần gọi model: token vào/ra, cache hit,
 * chi phí ước tính, độ trễ.
 */
export class UsageTraceHandler extends BaseCallbackHandler {
  private readonly options: UsageTraceHandlerOptions;

  constructor(options: UsageTraceHandlerOptions) {
    super();
    this.options = options;
  }

  override handleLLMEnd(event: LlmEndEvent): void {
    const trace = this.options.trace ?? traceEvent;
    trace(this.options.ctx, {
      node: this.options.node,
      assigned_agent: this.options.assignedAgent,
      usage: event.usage,
      skill_call:
        this.options.skillName && this.options.skillVersion
          ? { name: this.options.skillName, version: this.options.skillVersion }
          : null,
    });
  }

  override handleLLMError(event: LlmErrorEvent): void {
    const trace = this.options.trace ?? traceEvent;
    const message = event.error instanceof Error ? event.error.message : String(event.error);
    trace(this.options.ctx, {
      node: this.options.node,
      assigned_agent: this.options.assignedAgent,
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        cached_tokens: 0,
        cache_hit_rate: 0,
        estimated_cost_usd: 0,
        latency_ms: event.latencyMs,
      },
      error: message,
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Chat model
// ─────────────────────────────────────────────────────────────────────────────

export interface ChatModelOptions {
  mode?: ModelMode;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  callbacks?: BaseCallbackHandler[];
  fetchImpl?: typeof fetch;
  /** Nếu có `ctx`, `UsageTraceHandler` được tự gắn (trừ khi tắt `autoTrace`). */
  ctx?: AuthContext;
  node?: string;
  agentName?: string;
  autoTrace?: boolean;
}

export interface ChatInvokeInput {
  system?: string;
  prompt: string;
  jsonMode?: boolean;
  maxTokens?: number;
}

export interface ChatInvokeResult {
  text: string;
  usage: UsageRecord;
}

export interface ChatModel {
  readonly config: UitModelConfig;
  invoke(input: ChatInvokeInput): Promise<ChatInvokeResult>;
}

const numberValue = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : 0;
};

/** Giá ước tính (USD / 1K token) — UIT không bán token; cho phép đặt nếu cần tính. */
const pricePer1k = (env: NodeJS.ProcessEnv) => ({
  input: Number(env.UIT_LLM_PRICE_INPUT_PER_1K || 0) || 0,
  output: Number(env.UIT_LLM_PRICE_OUTPUT_PER_1K || 0) || 0,
});

const buildUsage = (
  json: unknown,
  latencyMs: number,
  env: NodeJS.ProcessEnv = process.env,
): UsageRecord => {
  const usage = (json as { usage?: Record<string, unknown> } | null)?.usage || {};
  const input = numberValue(usage.prompt_tokens);
  const output = numberValue(usage.completion_tokens);
  const details = (usage.prompt_tokens_details || {}) as Record<string, unknown>;
  const cached = numberValue(details.cached_tokens);
  const prices = pricePer1k(env);
  return {
    input_tokens: input,
    output_tokens: output,
    cached_tokens: cached,
    cache_hit_rate: input > 0 ? Number((cached / input).toFixed(4)) : 0,
    estimated_cost_usd: Number(
      ((input / 1000) * prices.input + (output / 1000) * prices.output).toFixed(6),
    ),
    latency_ms: Math.max(0, Math.trunc(latencyMs)),
  };
};

/**
 * Tạo model `chat/completions` (OpenAI-compatible) cho UIT.
 *
 * `stream: false` là BẮT BUỘC — gateway của trường đôi khi trả SSE dù không xin
 * stream; ở đây ta đọc body JSON và báo lỗi rõ nếu nội dung rỗng, không "giả
 * streaming" bằng cách chia chuỗi.
 */
export const createChatModel = (options: ChatModelOptions = {}): ChatModel => {
  const env = process.env;
  const resolved = resolveUitConfig(env);
  const mode: ModelMode = options.mode || 'fast';
  const config: UitModelConfig = {
    baseUrl: stripSlash(options.baseUrl || resolved[mode].baseUrl),
    model: options.model || resolved[mode].model,
    apiKey: options.apiKey ?? resolved[mode].apiKey,
  };

  const temperature = options.temperature ?? 0.1;
  const maxTokens = options.maxTokens ?? 1024;
  const timeoutMs = options.timeoutMs ?? (Number(env.UIT_LLM_TIMEOUT_MS) || 60_000);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  const callbacks: BaseCallbackHandler[] = [...(options.callbacks || [])];
  if (options.ctx && options.autoTrace !== false) {
    callbacks.push(
      new UsageTraceHandler({
        ctx: options.ctx,
        node: options.node,
        assignedAgent: options.agentName,
      }),
    );
  }

  const invoke = async (input: ChatInvokeInput): Promise<ChatInvokeResult> => {
    if (!config.apiKey) {
      throw new Error(
        'UIT provider chưa có API key — đặt UIT_LLM_API_KEY (hoặc LLM_UIT_API_KEY) trong .env',
      );
    }
    if (typeof fetchImpl !== 'function') {
      throw new Error('Môi trường không có fetch — dùng Node >= 18 hoặc truyền fetchImpl');
    }

    const runId = options.ctx?.runId || 'no-run';
    const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
    if (input.system) messages.push({ role: 'system', content: input.system });
    messages.push({ role: 'user', content: input.prompt });

    callbacks.forEach((handler) =>
      handler.handleLLMStart({
        runId,
        model: config.model,
        baseUrl: config.baseUrl,
        promptChars: input.prompt.length + (input.system?.length || 0),
      }),
    );

    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetchImpl(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          messages,
          temperature,
          max_tokens: input.maxTokens ?? maxTokens,
          stream: false,
          ...(input.jsonMode ? { response_format: { type: 'json_object' } } : {}),
        }),
      });

      const raw = await res.text();
      if (!res.ok) {
        throw new Error(`UIT HTTP ${res.status}: ${raw.slice(0, 300)}`);
      }

      let json: unknown = null;
      try {
        json = JSON.parse(raw);
      } catch {
        throw new Error(
          `UIT trả body không phải JSON (có thể là SSE dù stream=false): ${raw.slice(0, 200)}`,
        );
      }

      const text = (json as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0]
        ?.message?.content;
      if (!text) throw new Error('UIT không trả nội dung (choices[0].message.content rỗng)');

      const latencyMs = Date.now() - startedAt;
      const usage = buildUsage(json, latencyMs, env);
      callbacks.forEach((handler) =>
        handler.handleLLMEnd({
          runId,
          model: config.model,
          baseUrl: config.baseUrl,
          inputTokens: usage.input_tokens,
          outputTokens: usage.output_tokens,
          cachedTokens: usage.cached_tokens,
          latencyMs,
          text,
          usage,
        }),
      );

      return { text, usage };
    } catch (err) {
      const latencyMs = Date.now() - startedAt;
      callbacks.forEach((handler) =>
        handler.handleLLMError({ runId, model: config.model, latencyMs, error: err }),
      );
      throw err;
    } finally {
      clearTimeout(timer);
    }
  };

  return { config, invoke };
};
