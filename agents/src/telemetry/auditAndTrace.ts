/**
 * telemetry/auditAndTrace.ts — Hai đường ghi TÁCH RỜI (yêu cầu UC-009).
 *
 *   auditAgentEvent → HTTP tới `POST /api/agent-gateway/audit-events`
 *                     ⇒ AuditLog, append-only, THROW khi hỏng (fail-closed).
 *   traceEvent      → file JSONL cục bộ (`traces/<run_id>.jsonl` +
 *                     `traces/agent-traces.jsonl`), append-only, mask PII/token.
 *
 * Vì sao tách: audit là bằng chứng kiểm soát (không được mất, không được sửa);
 * trace là chẩn đoán (đầy đủ tham số/kết quả, không phải nguồn quyết định).
 * Gộp hai thứ vào một bảng/file sẽ khiến một bên hỏng kéo theo bên kia.
 */
import fs from 'fs';
import path from 'path';

import type {
  AuthContext,
  TraceRecord,
  ToolCallRecord,
  UsageRecord,
} from '../contracts/types';
import { ErpClient, type AuditEventPayload, type AuditEventResult } from '../erp/erpClient';

export class AuditTrailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuditTrailError';
  }
}

let defaultClient: ErpClient | null = null;

const getDefaultClient = (): ErpClient => {
  if (!defaultClient) defaultClient = new ErpClient();
  return defaultClient;
};

/** Dùng trong test/CLI để thay client mà không cần env. */
export const setDefaultErpClient = (client: ErpClient | null): void => {
  defaultClient = client;
};

/**
 * Ghi audit qua ERP. FAIL-CLOSED: mọi lỗi mạng/non-2xx đều ném
 * `AuditTrailError` để caller dừng an toàn.
 */
export const auditAgentEvent = async (
  event: AuditEventPayload,
  client: ErpClient = getDefaultClient(),
): Promise<AuditEventResult> => {
  try {
    return await client.postAuditEvent(event);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new AuditTrailError(`Không ghi được audit-events (fail-closed): ${detail}`);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Trace JSONL
// ─────────────────────────────────────────────────────────────────────────────

export type TraceEventInput = Partial<Omit<TraceRecord, 'run_id' | 'timestamp' | 'actor'>> & {
  run_id?: string;
};

/** Thư mục trace: `AGENT_TRACE_DIR` hoặc `agents/traces` (cả src lẫn dist đều trỏ đúng). */
export const traceDir = (): string =>
  path.resolve(process.env.AGENT_TRACE_DIR || path.join(__dirname, '..', '..', 'traces'));

const ensuredDirs = new Set<string>();
const ensureDir = (dir: string): void => {
  if (ensuredDirs.has(dir)) return;
  fs.mkdirSync(dir, { recursive: true });
  ensuredDirs.add(dir);
};

/** `run_id` do orchestrator sinh; vẫn chặn ký tự lạ để không thoát khỏi thư mục. */
const safeRunId = (runId: string): string => String(runId || 'unknown').replace(/[^A-Za-z0-9._-]/g, '_');

// ── Mask PII/token ──────────────────────────────────────────────────────────

const REDACTED = '[REDACTED]';

const SENSITIVE_KEYS = new Set([
  'password',
  'currentPassword',
  'newPassword',
  'secret',
  'token',
  'accessToken',
  'refreshToken',
  'access_token',
  'refresh_token',
  'apiKey',
  'api_key',
  'authorization',
  'cccd',
  'idNumber',
  'bankAccount',
  'bank_account',
  'bankAccountNumber',
  'baseSalary',
  'salary',
  'phone',
  'mobile',
  'mobileNo',
  'email',
  'taxCode',
  'socialInsuranceCode',
]);

/** Khoá số liệu KHÔNG bị coi là token dù tên chứa "tokens". */
const METRIC_KEYS = new Set([
  'input_tokens',
  'output_tokens',
  'cached_tokens',
  'cache_hit_rate',
  'estimated_cost_usd',
  'latency_ms',
  'duration_ms',
  'result_summary',
  'params',
]);

const isSensitiveKey = (key: string): boolean => {
  if (METRIC_KEYS.has(key)) return false;
  if (SENSITIVE_KEYS.has(key)) return true;
  return /(token|secret|password|apikey|api_key|authorization)$/i.test(key);
};

const SENSITIVE_VALUE_PATTERNS = [
  /^eyJ[\w-]+\.[\w-]+\.[\w-]+$/, // JWT
  /^sk-[A-Za-z0-9_-]{8,}$/, // API key kiểu OpenAI
  /^Bearer\s+\S+$/i,
  /^\d{10,}$/, // số tài khoản/CCCD trần
];

const isSensitiveString = (value: string): boolean =>
  SENSITIVE_VALUE_PATTERNS.some((re) => re.test(value));

/** Deep mask, trả object mới (không mutate). */
export const maskSensitive = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map((item) => maskSensitive(item));
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (isSensitiveKey(key)) {
        out[key] = REDACTED;
        continue;
      }
      out[key] = maskSensitive(child);
    }
    return out;
  }
  if (typeof value === 'string' && isSensitiveString(value)) return REDACTED;
  return value;
};

// ─────────────────────────────────────────────────────────────────────────────
// Ghi JSONL
// ─────────────────────────────────────────────────────────────────────────────

export const buildTraceRecord = (ctx: AuthContext, partial: TraceEventInput = {}): TraceRecord => ({
  run_id: partial.run_id || ctx.runId,
  timestamp: new Date().toISOString(),
  actor: {
    userId: ctx.userId,
    role: ctx.role,
    department: ctx.department,
    tenantId: ctx.tenantId,
  },
  node: partial.node ?? null,
  assigned_agent: partial.assigned_agent ?? null,
  tool_call: partial.tool_call ?? null,
  skill_call: partial.skill_call ?? null,
  authz_decision: partial.authz_decision ?? null,
  usage: partial.usage ?? null,
  approval_decision: partial.approval_decision ?? null,
  job_id: partial.job_id ?? null,
  report_period: partial.report_period ?? null,
  error: partial.error ?? null,
});

/**
 * Ghi MỘT dòng JSONL vào cả file theo run và file gộp.
 *
 * @returns bản ghi ĐÃ mask (đúng thứ đã ghi ra đĩa) — test đọc lại file để đối chiếu.
 */
export const traceEvent = (ctx: AuthContext, partial: TraceEventInput = {}): TraceRecord => {
  const record = buildTraceRecord(ctx, partial);
  const masked = maskSensitive(record) as TraceRecord;
  const line = `${JSON.stringify(masked)}\n`;
  const dir = traceDir();
  ensureDir(dir);
  fs.appendFileSync(path.join(dir, `${safeRunId(record.run_id)}.jsonl`), line, 'utf8');
  fs.appendFileSync(path.join(dir, 'agent-traces.jsonl'), line, 'utf8');
  return masked;
};

/** Đọc lại trace của một run (dùng cho kiểm chứng/eval). */
export const readTraceLines = (runId: string): TraceRecord[] => {
  const file = path.join(traceDir(), `${safeRunId(runId)}.jsonl`);
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as TraceRecord);
};

/** Dựng `ToolCallRecord` với `result_summary` ngắn, đã bị cắt — không nhét cả payload. */
export const summarizeToolResult = (value: unknown, max = 500): string => {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? null);
  const safe = text ?? '';
  return safe.length > max ? `${safe.slice(0, max - 3)}...` : safe;
};

export type { ToolCallRecord, UsageRecord };
