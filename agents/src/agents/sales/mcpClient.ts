/**
 * agents/sales/mcpClient.ts — MCP client/dispatcher có kiểm soát.
 *
 * ============================================================================
 * BA RÀNG BUỘC (test `uc005-sales-mcp` khoá lại)
 * ============================================================================
 * 1. MỌI lời gọi đi qua `withToolGuard`: authorize theo actor gốc, audit
 *    fail-closed TRƯỚC handler, field projection sau handler.
 * 2. TIMEOUT HỮU HẠN: mỗi attempt bị race với `timeoutMs`; mạng treo không được
 *    làm treo đồ thị agent.
 * 3. RETRY TỐI ĐA 2 LẦN, chỉ cho lỗi tạm thời (`TRANSIENT_ERROR` / timeout /
 *    `retryable: true`). Mọi lỗi khác ném ngay — retry mù sẽ nhân đôi tác dụng
 *    phụ.
 *
 * Lời gọi GHI tự sinh `idempotencyKey` ổn định nếu caller chưa truyền. Khoá đi
 * xuyên các lần retry và các lần chạy lại node sau resume, nên server trả lại
 * kết quả cũ thay vì tạo bản ghi thứ hai.
 */
import { createHash } from 'crypto';

import type { AuthContext } from '../../contracts/types';
import type { AuditEventPayload, AuditEventResult } from '../../erp/erpClient';
import { withToolGuard } from '../../policy/toolWrapper';
import type { TraceEventInput } from '../../telemetry/auditAndTrace';

export interface McpToolSpec {
  name: string;
  description?: string;
  resource: string;
  action: 'read' | 'write';
  idempotent?: boolean;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
}

export interface McpServerDescriptor {
  serverName: string;
  version: string;
  description?: string;
  tools: McpToolSpec[];
  resources?: Array<{ uri: string; name?: string; mimeType?: string }>;
  scopes?: string[];
}

/** Hình dạng tối thiểu của một MCP server (CommonJS trong `mcp_servers/`). */
export interface McpServerModule {
  descriptor: McpServerDescriptor;
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
}

export interface McpCallResult<T = unknown> {
  serverName: string;
  toolName: string;
  data: T;
  attempts: number;
  durationMs: number;
  idempotencyKey: string | null;
  replayed: boolean;
}

export interface McpDispatcherOptions {
  servers: Record<string, McpServerModule>;
  /** Mặc định 5s — đủ cho truy vấn DB nội bộ, không đủ để treo cả run. */
  timeoutMs?: number;
  /** Số lần THỬ LẠI tối đa (không tính attempt đầu). */
  maxRetries?: number;
  retryDelayMs?: number;
  auditAgentEvent?: (event: AuditEventPayload) => Promise<AuditEventResult>;
  traceEvent?: (ctx: AuthContext, partial: TraceEventInput) => unknown;
}

export class McpTimeoutError extends Error {
  readonly code = 'TIMEOUT';
  readonly retryable = true;

  constructor(timeoutMs: number) {
    super(`MCP call quá thời gian ${timeoutMs}ms`);
    this.name = 'McpTimeoutError';
  }
}

export class McpDispatchError extends Error {
  readonly code: string;
  readonly serverName: string;
  readonly toolName: string;

  constructor(code: string, serverName: string, toolName: string, message?: string) {
    super(message || `${serverName}:${toolName} thất bại (${code})`);
    this.name = 'McpDispatchError';
    this.code = code;
    this.serverName = serverName;
    this.toolName = toolName;
  }
}

const TRANSIENT_CODES = new Set([
  'TRANSIENT_ERROR',
  'ETIMEDOUT',
  'TIMEOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'EAI_AGAIN',
]);

const errorCode = (err: unknown): string => {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : '';
};

const isTransient = (err: unknown): boolean => {
  if (err instanceof McpTimeoutError) return true;
  if ((err as { retryable?: unknown } | null)?.retryable === true) return true;
  return TRANSIENT_CODES.has(errorCode(err));
};

/** JSON ổn định (sắp khoá) để cùng tham số ⇒ cùng idempotencyKey. */
const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`;
};

const buildIdempotencyKey = (
  ctx: AuthContext,
  serverName: string,
  toolName: string,
  args: Record<string, unknown>,
): string => {
  const digest = createHash('sha1').update(stableStringify(args)).digest('hex').slice(0, 16);
  return `${ctx.runId}:${serverName}:${toolName}:${digest}`;
};

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    if (typeof timer.unref === 'function') timer.unref();
  });

const callWithTimeout = <T>(
  server: McpServerModule,
  toolName: string,
  args: Record<string, unknown>,
  timeoutMs: number,
): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new McpTimeoutError(timeoutMs)), timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();
  });

  return Promise.race([server.callTool(toolName, args) as Promise<T>, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
};

export interface McpDispatcher {
  descriptors: McpServerDescriptor[];
  findTool: (serverName: string, toolName: string) => McpToolSpec;
  call: <T = unknown>(
    ctx: AuthContext,
    serverName: string,
    toolName: string,
    args?: Record<string, unknown>,
  ) => Promise<McpCallResult<T>>;
}

export const createMcpDispatcher = (options: McpDispatcherOptions): McpDispatcher => {
  const { servers } = options;
  if (!servers || Object.keys(servers).length === 0) {
    throw new McpDispatchError('MCP_SERVERS_REQUIRED', 'mcp', 'dispatch', 'Cần ít nhất một MCP server');
  }

  const timeoutMs = Math.max(1, options.timeoutMs ?? 5_000);
  const maxRetries = Math.max(0, Math.min(options.maxRetries ?? 2, 2));
  const retryDelayMs = Math.max(0, options.retryDelayMs ?? 5);

  const descriptors = Object.values(servers).map((server) => server.descriptor);

  const findServer = (serverName: string): McpServerModule => {
    const server = servers[serverName];
    if (!server) {
      throw new McpDispatchError('MCP_SERVER_NOT_FOUND', serverName, 'dispatch');
    }
    return server;
  };

  const findTool = (serverName: string, toolName: string): McpToolSpec => {
    const tool = findServer(serverName).descriptor.tools.find((item) => item.name === toolName);
    if (!tool) {
      throw new McpDispatchError('MCP_TOOL_NOT_FOUND', serverName, toolName);
    }
    return tool;
  };

  const guardedCache = new Map<string, ReturnType<typeof withToolGuard>>();

  const guardedCall = (serverName: string, toolName: string) => {
    const cacheKey = `${serverName}:${toolName}`;
    const cached = guardedCache.get(cacheKey);
    if (cached) return cached;

    const spec = findTool(serverName, toolName);
    const server = findServer(serverName);

    const guarded = withToolGuard<Record<string, unknown>, McpCallResult>(
      {
        name: spec.name,
        agentName: 'sales',
        resource: spec.resource,
        action: spec.action,
        node: 'sales_agent',
      },
      async (_ctx, args) => {
        const startedAt = Date.now();
        const idempotencyKey = spec.action === 'write'
          ? String(args.idempotencyKey || '').trim() || null
          : null;

        let lastError: unknown = null;

        for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
          try {
            const data = await callWithTimeout<unknown>(server, toolName, args, timeoutMs);
            return {
              serverName,
              toolName,
              data,
              attempts: attempt + 1,
              durationMs: Date.now() - startedAt,
              idempotencyKey,
              replayed: Boolean((data as { replayed?: unknown } | null)?.replayed),
            };
          } catch (err) {
            lastError = err;
            const retryable = isTransient(err);
            if (!retryable || attempt >= maxRetries) break;
            await delay(retryDelayMs * (attempt + 1));
          }
        }

        const code = errorCode(lastError) || 'MCP_CALL_FAILED';
        throw new McpDispatchError(code, serverName, toolName, lastError instanceof Error
          ? lastError.message
          : String(lastError));
      },
      {
        auditAgentEvent: options.auditAgentEvent,
        traceEvent: options.traceEvent,
      },
    );

    guardedCache.set(cacheKey, guarded);
    return guarded;
  };

  const call = async <T = unknown>(
    ctx: AuthContext,
    serverName: string,
    toolName: string,
    args: Record<string, unknown> = {},
  ): Promise<McpCallResult<T>> => {
    const spec = findTool(serverName, toolName);
    const prepared: Record<string, unknown> = { ...(args || {}) };

    if (spec.action === 'write' && !String(prepared.idempotencyKey || '').trim()) {
      prepared.idempotencyKey = buildIdempotencyKey(ctx, serverName, toolName, prepared);
    }

    const result = await guardedCall(serverName, toolName)(ctx, prepared);
    return result as McpCallResult<T>;
  };

  return { descriptors, findTool, call };
};
