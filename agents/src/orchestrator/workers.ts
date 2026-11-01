/**
 * orchestrator/workers.ts — Thực thi một subtask, gồm cả human-gate.
 *
 * ============================================================================
 * HAI ĐIỀU DỄ LÀM HỎNG NHẤT
 * ============================================================================
 * 1. `interrupt()` KHÔNG phải lỗi. Nó ném `GraphInterrupt` để LangGraph lưu
 *    checkpoint rồi dừng. Bọc `try/catch` rồi trả `status: 'FAILED'` sẽ biến một
 *    lần chờ duyệt thành một lần thất bại, và run không bao giờ resume được.
 *    Vì vậy mọi `catch` ở đây đều kiểm `isControlFlowSignal` và RETHROW nguyên trạng.
 *
 * 2. `resumePayload` KHÔNG phải nguồn sự thật. Người gọi có thể nhét
 *    `{ status: 'APPROVED' }` vào resume. Sau khi resume, node chạy lại và hỏi
 *    ERP bằng `getGate(gate.id)`; chỉ trạng thái ERP mới quyết định.
 *
 * Orchestrator KHÔNG có tool ghi: mọi runner ở đây đều được dựng qua
 * `createGuardedRunner` (đọc) hoặc do caller cắm vào, và không có nhánh nào tự
 * ghi dữ liệu nghiệp vụ.
 */
import { interrupt, isGraphBubbleUp, isGraphInterrupt } from '@langchain/langgraph';

import type { AuthContext } from '../contracts/types';
import type {
  AgentGate,
  AuditEventPayload,
  AuditEventResult,
  GateService,
} from '../erp/erpClient';
import { withToolGuard, type ToolDefinition, type ToolGuardDeps } from '../policy/toolWrapper';
import {
  auditAgentEvent,
  summarizeToolResult,
  traceEvent,
  type TraceEventInput,
} from '../telemetry/auditAndTrace';
import type { ApprovalRequirement, OpsSubtask, OrchestratorUpdate, SubtaskState } from './state';

/**
 * Tín hiệu điều khiển của LangGraph (interrupt/Command). Phải được RETHROW,
 * tuyệt đối không được biến thành `FAILED`.
 */
export const isControlFlowSignal = (err: unknown): boolean => {
  if (isGraphInterrupt(err) || isGraphBubbleUp(err)) return true;
  const name = (err as { name?: string } | null)?.name || '';
  return name === 'GraphInterrupt' || name === 'GraphBubbleUp' || name === 'NodeInterrupt';
};

/** Một agent nghiệp vụ: nhận actor gốc + subtask, trả kết quả đã qua tool guard. */
export type AgentRunner = (ctx: AuthContext, subtask: OpsSubtask) => Promise<unknown>;

/** `targetAgent` → runner. Thiếu agent ⇒ subtask FAILED, không đoán thay. */
export type AgentRegistry = Record<string, AgentRunner>;

export interface WorkerDeps {
  registry: AgentRegistry;
  erp: GateService;
  auditAgentEvent?: (event: AuditEventPayload) => Promise<AuditEventResult>;
  traceEvent?: (ctx: AuthContext, partial: TraceEventInput) => unknown;
}

/** Dữ liệu `Send` đẩy vào `agent_worker`. Node nhận ĐÚNG payload này, không phải toàn state. */
export interface WorkerInput {
  subtask: SubtaskState;
  actor: AuthContext;
}

/**
 * Runner đọc dữ liệu có kiểm quyền — ĐƯỜNG CHUẨN để một agent chạm dữ liệu.
 *
 * `withToolGuard` lo cả ba việc: `authorizeTool` theo actor gốc, audit trước khi
 * chạy (fail-closed), và `fieldProjection` trên kết quả.
 */
export const createGuardedRunner = <TArgs extends Record<string, unknown> = Record<string, unknown>>(
  tool: ToolDefinition,
  handler: (ctx: AuthContext, args: TArgs) => Promise<unknown> | unknown,
  deps: ToolGuardDeps = {},
): AgentRunner => {
  const guarded = withToolGuard<TArgs, unknown>(tool, handler, deps);
  return (ctx, subtask) => guarded(ctx, { ...(subtask.inputs || {}) } as TArgs);
};

/**
 * Xin người duyệt: tạo gate PENDING, idempotent theo `${runId}:${subtask.id}`.
 *
 * Khoá idempotency do server ghép từ `runId` + `nodeId`; ta truyền `subtask.id`
 * làm `nodeId` nên node chạy lại sau resume KHÔNG sinh gate thứ hai.
 */
export const requestHumanApproval = async (
  ctx: AuthContext,
  subtask: Pick<OpsSubtask, 'id' | 'requiresApproval'>,
  erp: GateService,
  trace: (ctx: AuthContext, partial: TraceEventInput) => unknown = traceEvent,
): Promise<AgentGate> => {
  const requirement = subtask.requiresApproval as ApprovalRequirement | null | undefined;
  if (!requirement) {
    throw new Error('requestHumanApproval: subtask không yêu cầu phê duyệt');
  }

  const gate = await erp.createGate({
    actionType: requirement.actionType,
    runId: ctx.runId,
    nodeId: subtask.id,
    summary: requirement.summary,
    amount: requirement.amount ?? null,
    details: requirement.details || {},
  });

  trace(ctx, {
    node: 'request_human_approval',
    approval_decision: gate.status,
  });

  return gate;
};

const fail = (
  subtask: SubtaskState,
  error: string,
  extra: Partial<SubtaskState> = {},
): OrchestratorUpdate => ({
  subtasks: [{ ...subtask, status: 'FAILED', error, ...extra }],
});

/**
 * Node `agent_worker`.
 *
 * Trả `OrchestratorUpdate` để reducer gộp theo `id`. Lỗi runtime của MỘT subtask
 * (không phải interrupt) chỉ đánh dấu subtask đó FAILED — các nhánh `Send` còn
 * lại vẫn chạy xong.
 */
export const createWorkerNode = (deps: WorkerDeps) => async (
  input: WorkerInput,
): Promise<OrchestratorUpdate> => {
  const { actor: ctx, subtask } = input;
  const trace = deps.traceEvent ?? traceEvent;
  const audit = deps.auditAgentEvent ?? auditAgentEvent;

  try {
    let gateId: string | null = null;
    let approval: 'APPROVED' | 'REJECTED' | null = null;

    // ── Human-gate: tạo (idempotent) → dừng nếu PENDING → xác minh lại từ ERP.
    if (subtask.requiresApproval) {
      const gate = await requestHumanApproval(ctx, subtask, deps.erp, trace);
      gateId = gate.id;

      let gateState = await deps.erp.getGate(gate.id);

      if (gateState.status === 'PENDING') {
        // NÉM GraphInterrupt: checkpoint được lưu, đồ thị dừng ở đây.
        interrupt({
          gateId: gate.id,
          subtaskId: subtask.id,
          actionType: gateState.actionType,
          summary: gateState.actionSummary,
        });

        // Chạy lại sau resume: `resumePayload` KHÔNG được tin — hỏi lại ERP.
        gateState = await deps.erp.getGate(gate.id);
      }

      if (gateState.status !== 'APPROVED') {
        approval = 'REJECTED';
        trace(ctx, {
          node: 'agent_worker',
          assigned_agent: subtask.targetAgent,
          approval_decision: gateState.status,
        });
        return {
          subtasks: [
            {
              ...subtask,
              status: 'DENIED',
              reason: `gate_${String(gateState.status).toLowerCase()}`,
              gateId,
              approval,
            },
          ],
          approvals: {
            [subtask.id]: {
              subtaskId: subtask.id,
              gateId: gate.id,
              actionType: gateState.actionType,
              status: gateState.status,
            },
          },
        };
      }

      approval = 'APPROVED';
    }

    const runner = deps.registry[subtask.targetAgent];
    if (!runner) throw new Error(`agent_chua_dang_ky:${subtask.targetAgent}`);

    const startedAt = Date.now();
    const result = await runner(ctx, subtask);

    trace(ctx, {
      node: 'agent_worker',
      assigned_agent: subtask.targetAgent,
      tool_call: {
        name: subtask.action,
        params: subtask.inputs,
        result_summary: summarizeToolResult(result),
        duration_ms: Date.now() - startedAt,
      },
      approval_decision: approval,
    });

    return {
      subtasks: [{ ...subtask, status: 'COMPLETED', result, gateId, approval, error: null, reason: null }],
      ...(gateId
        ? {
            approvals: {
              [subtask.id]: {
                subtaskId: subtask.id,
                gateId,
                actionType: subtask.requiresApproval?.actionType || '',
                status: 'APPROVED',
              },
            },
          }
        : {}),
    };
  } catch (err) {
    // Interrupt KHÔNG phải lỗi: rethrow nguyên trạng để LangGraph lưu checkpoint.
    if (isControlFlowSignal(err)) throw err;

    const message = err instanceof Error ? err.message : String(err);

    // Audit lỗi ghi nhận DENY để vẫn còn dấu vết "đã cố chạy nhưng bị chặn".
    try {
      await audit({
        runId: ctx.runId,
        decision: 'DENY',
        agentName: subtask.targetAgent,
        toolName: subtask.action,
        resource: `${subtask.department.toLowerCase()}.${subtask.action}`,
        reason: `runtime_error:${message}`.slice(0, 2000),
        department: ctx.department,
        node: 'agent_worker',
      });
    } catch {
      // Không che lỗi gốc: audit hỏng ở đây không đổi được việc subtask đã lỗi.
    }

    trace(ctx, {
      node: 'agent_worker',
      assigned_agent: subtask.targetAgent,
      error: message,
    });

    return fail(subtask, message, { gateId: subtask.gateId || null });
  }
};
