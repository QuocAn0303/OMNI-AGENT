/**
 * policy/toolWrapper.ts — Điểm vào DUY NHẤT để chạy một tool của agent.
 *
 * Thứ tự bắt buộc:
 *   1. `authorizeTool` (theo ACTOR GỐC, không theo prompt/agent đang đứng).
 *   2. `auditAgentEvent` — kể cả khi DENY; lỗi ghi audit ⇒ DỪNG, KHÔNG chạy handler.
 *   3. Chạy handler (chỉ khi ALLOW).
 *   4. `projectFields` — ẩn field nhạy cảm TRƯỚC khi trả kết quả.
 *   5. `traceEvent` — JSONL §4.4.
 *
 * Thông báo từ chối chỉ chứa MÃ LÝ DO, không chứa dữ liệu nghiệp vụ: câu trả lời
 * cho người dùng không được trở thành kênh rò rỉ.
 */
import type { AuthContext, AuthzDecision, ToolCallRecord } from '../contracts/types';
import { authorizeTool, projectFields } from './policyEngine';
import {
  AuditTrailError,
  auditAgentEvent,
  summarizeToolResult,
  traceEvent,
  type TraceEventInput,
} from '../telemetry/auditAndTrace';
import type { AuditEventPayload, AuditEventResult } from '../erp/erpClient';

export { AuditTrailError };

export interface ToolDefinition {
  name: string;
  /** Agent đang thực thi tool — quyết định phòng ban sở hữu tool. */
  agentName: string;
  /** Resource dạng `dept.thing`, ví dụ `hr.salary`. */
  resource: string;
  action: 'read' | 'write';
  node?: string;
  skillName?: string;
  skillVersion?: string;
  /** Job theo lịch: hai trường này đi vào MỌI audit + trace của tool call. */
  jobId?: string;
  reportPeriod?: string;
}

export interface ToolGuardDeps {
  auditAgentEvent?: (event: AuditEventPayload) => Promise<AuditEventResult>;
  traceEvent?: (ctx: AuthContext, partial: TraceEventInput) => unknown;
}

export class ToolDeniedError extends Error {
  readonly code: string;

  constructor(code: string) {
    // Chỉ mã lý do — không dữ liệu.
    super(`Bị từ chối theo chính sách phân quyền (code: ${code})`);
    this.name = 'ToolDeniedError';
    this.code = code;
  }
}

const decisionRecord = (decision: AuthzDecision) => ({
  layer: decision.layer,
  effect: decision.effect,
  reason: decision.reason,
});

/**
 * Bọc một tool. Trả về hàm `(ctx, args) => kết quả đã chiếu field`.
 */
export const withToolGuard = <
  TArgs extends Record<string, unknown> = Record<string, unknown>,
  TResult = unknown,
>(
  toolDef: ToolDefinition,
  handler: (ctx: AuthContext, args: TArgs) => Promise<TResult> | TResult,
  deps: ToolGuardDeps = {},
) => {
  const audit = deps.auditAgentEvent ?? auditAgentEvent;
  const trace = deps.traceEvent ?? traceEvent;

  return async (ctx: AuthContext, args: TArgs = {} as TArgs): Promise<TResult> => {
    const decision = authorizeTool(
      ctx,
      toolDef.agentName,
      toolDef.name,
      toolDef.resource,
      toolDef.action,
      args,
    );

    const auditPayload: AuditEventPayload = {
      runId: ctx.runId,
      decision: decision.effect,
      agentName: toolDef.agentName,
      toolName: toolDef.name,
      resource: toolDef.resource,
      reason: decision.reason,
      department: ctx.department,
      node: toolDef.node,
      params: args,
      ...(toolDef.skillName ? { skillName: toolDef.skillName } : {}),
      ...(toolDef.skillVersion ? { skillVersion: toolDef.skillVersion } : {}),
      ...(toolDef.jobId ? { jobId: toolDef.jobId } : {}),
      ...(toolDef.reportPeriod ? { reportPeriod: toolDef.reportPeriod } : {}),
    };

    // Job theo lịch: `job_id` + `report_period` phải có trên MỌI dòng trace, kể
    // cả nhánh DENY — nếu không, không truy được job nào đã cố vượt quyền.
    const jobFields = {
      ...(toolDef.jobId ? { job_id: toolDef.jobId } : {}),
      ...(toolDef.reportPeriod ? { report_period: toolDef.reportPeriod } : {}),
    };

    // ── Bước 2: audit TRƯỚC khi chạy. Lỗi ⇒ fail-closed.
    try {
      await audit(auditPayload);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      try {
        trace(ctx, {
          node: toolDef.node,
          assigned_agent: toolDef.agentName,
          authz_decision: decisionRecord(decision),
          error: 'AUDIT_WRITE_FAILED',
          ...jobFields,
        });
      } catch {
        // Đang xử lý lỗi audit — lỗi trace không được che lỗi gốc.
      }
      throw new AuditTrailError(`Dừng an toàn: không ghi được audit (${detail})`);
    }

    // ── Bước 2b: DENY ⇒ không chạy handler, không rò dữ liệu.
    if (decision.effect === 'DENY') {
      trace(ctx, {
        node: toolDef.node,
        assigned_agent: toolDef.agentName,
        tool_call: {
          name: toolDef.name,
          params: args,
          result_summary: null,
          duration_ms: 0,
        },
        authz_decision: decisionRecord(decision),
        ...jobFields,
      });
      throw new ToolDeniedError(decision.reason);
    }

    // ── Bước 3: chỉ chạy khi ALLOW.
    const startedAt = Date.now();
    try {
      const raw = await handler(ctx, args);
      const projected = projectFields(raw, decision.fieldProjection);
      const toolCall: ToolCallRecord = {
        name: toolDef.name,
        params: args,
        result_summary: summarizeToolResult(projected),
        duration_ms: Date.now() - startedAt,
      };

      trace(ctx, {
        node: toolDef.node,
        assigned_agent: toolDef.agentName,
        tool_call: toolCall,
        authz_decision: decisionRecord(decision),
        skill_call: toolDef.skillName && toolDef.skillVersion
          ? { name: toolDef.skillName, version: toolDef.skillVersion }
          : null,
        ...jobFields,
      });

      return projected;
    } catch (err) {
      trace(ctx, {
        node: toolDef.node,
        assigned_agent: toolDef.agentName,
        tool_call: {
          name: toolDef.name,
          params: args,
          result_summary: null,
          duration_ms: Date.now() - startedAt,
        },
        authz_decision: decisionRecord(decision),
        error: err instanceof Error ? err.message : String(err),
        ...jobFields,
      });
      throw err;
    }
  };
};
