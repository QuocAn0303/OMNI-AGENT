/**
 * orchestrator/graph.ts — Đồ thị LangGraph của orchestrator.
 *
 *   START → classify → validate_dag → authorize_handoffs → schedule
 *         → (Send song song) agent_worker → collect
 *         → (còn việc đủ điều kiện) schedule | (hết) aggregate → END
 *
 * ============================================================================
 * VÌ SAO `classify` ĐI THẲNG `aggregate` KHI THIẾU THÔNG TIN
 * ============================================================================
 * Thiếu `employeeId`/kỳ báo cáo mà vẫn giao việc thì agent phải bịa tham số để
 * chạy. Báo cáo sinh ra sẽ trông hợp lệ và sai. Đi thẳng `aggregate` để hỏi lại
 * người dùng là hành vi duy nhất không tạo dữ liệu giả.
 *
 * ============================================================================
 * `thread_id` = `${tenantId}:${runId}`
 * ============================================================================
 * Mọi lần `invoke` đều đi qua `threadConfig` (checkpointer.ts). Không có đường
 * nào truyền `thread_id` thô, nên không có đường rò checkpoint giữa tenant.
 */
import {
  Command,
  END,
  Send,
  START,
  StateGraph,
  type BaseCheckpointSaver,
} from '@langchain/langgraph';

import type { AuthContext, HandoffEnvelope } from '../contracts/types';
import type {
  AgentGate,
  AuditEventPayload,
  AuditEventResult,
  FinanceService,
  GateService,
  KbService,
} from '../erp/erpClient';
import { createKnowledgeRunner } from '../agents/knowledge/knowledgeAgent';
import { createFinanceRunner } from '../agents/finance/financeAgent';
import { createSalesRunner } from '../agents/sales/salesAgent';
import type { McpDispatcher } from '../agents/sales/mcpClient';
import { assertActorUnchanged, authorizeHandoff, getAgentDepartment } from '../policy/policyEngine';
import { auditAgentEvent, summarizeToolResult, traceEvent, type TraceEventInput } from '../telemetry/auditAndTrace';
import {
  createClassifier,
  normalizeOpsRequest,
  type Classifier,
  type ClassifierDeps,
} from './classifier';
import { hasRunnable, isRunnable, propagateBlocked, validateDag } from './dagValidator';
import { threadConfig } from './checkpointer';
import {
  buildReport,
  OrchestratorState,
  type OrchestratorReport,
  type OrchestratorStateType,
  type OrchestratorUpdate,
  type SubtaskState,
} from './state';
import { createWorkerNode, type AgentRegistry, type WorkerInput } from './workers';

export interface OrchestratorDeps {
  actor: AuthContext;
  registry?: AgentRegistry;
  erp?: GateService;
  /** Kho SOP cho `targetAgent === 'knowledge'` (erpClient hiện thực cả hai). */
  kb?: KbService;
  /** UC-004: dữ liệu PO/GRN/trùng + tạo nháp đề nghị thanh toán cho agent finance. */
  finance?: FinanceService;
  /**
   * UC-005: MCP dispatcher (crm-mcp/sheets-mcp/mail-mcp) cho agent sales.
   * Chỉ đăng ký `sales` khi có dispatcher VÀ `erp` (GateService) — thiếu gate
   * thì nhánh chiết khấu >10% không thể xin duyệt, đăng ký non sẽ biến "chờ
   * duyệt" thành lỗi runtime khó hiểu.
   */
  sales?: { mcp: McpDispatcher };
  auditAgentEvent?: (event: AuditEventPayload) => Promise<AuditEventResult>;
  traceEvent?: (ctx: AuthContext, partial: TraceEventInput) => unknown;
  classifier?: Classifier;
  /** Dùng khi chưa có `classifier`; không có model ⇒ đường tất định/CLARIFY. */
  model?: ClassifierDeps['model'];
  checkpointer?: BaseCheckpointSaver;
  maxConcurrency?: number;
  maxIterations?: number;
}

export interface OrchestratorRunResult {
  runId: string;
  threadId: string;
  report: OrchestratorReport | null;
  /** Các gate đang chờ duyệt — caller hiển thị, không tự coi là đã duyệt. */
  interrupts: Array<{ id: string; value: unknown }>;
  raw: unknown;
}

export interface Orchestrator {
  graph: ReturnType<typeof buildOrchestratorGraph>;
  threadId: string;
  run: (input: { message: string; opsRequest?: OrchestratorStateType['opsRequest'] }) => Promise<OrchestratorRunResult>;
  resume: (resumePayload: unknown) => Promise<OrchestratorRunResult>;
  snapshot: () => Promise<{ next: string[]; values: OrchestratorStateType | null }>;
}

const DEFAULT_MAX_CONCURRENCY = 3;
const DEFAULT_MAX_ITERATIONS = 50;

/** `__interrupt__` là mảng do LangGraph gắn vào kết quả `invoke` khi dừng. */
export const extractInterrupts = (result: unknown): Array<{ id: string; value: unknown }> => {
  const raw = (result as { __interrupt__?: unknown } | null)?.__interrupt__;
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    const record = item as { id?: string; value?: unknown };
    return { id: String(record.id || ''), value: record.value };
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// Node
// ─────────────────────────────────────────────────────────────────────────────

export const buildOrchestratorGraph = (deps: OrchestratorDeps) => {
  const trace = deps.traceEvent ?? traceEvent;
  const audit = deps.auditAgentEvent ?? auditAgentEvent;
  const classifier =
    deps.classifier || createClassifier({ model: deps.model ?? null });
  const maxConcurrency = Math.max(1, deps.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY);
  const maxIterations = Math.max(1, deps.maxIterations ?? DEFAULT_MAX_ITERATIONS);

  const requireErp = (): GateService => {
    if (!deps.erp) {
      throw new Error('orchestrator: cần `erp` (GateService) cho subtask cần phê duyệt');
    }
    return deps.erp;
  };

  const actorOf = (state: OrchestratorStateType): AuthContext => {
    const actor = state.actor;
    if (!actor) throw new Error('orchestrator: state thiếu actor — từ chối chạy');
    return actor;
  };

  // Agent `knowledge` có sẵn từ package; caller khai `registry` thì ĐÈ lên.
  // Nhờ vậy giao việc hỏi đáp SOP chạy thật mà không phải cắm tay từng nơi.
  const registry: AgentRegistry = {
    knowledge: createKnowledgeRunner({
      erp: deps.kb,
      traceEvent: trace,
      auditAgentEvent: audit,
    }),
    // UC-004: agent finance chỉ được đăng ký khi có cả nguồn dữ liệu tài chính
    // VÀ gate service — thiếu gate thì nhánh MATCHED_3WAY không thể xin duyệt,
    // đăng ký non sẽ biến "chờ duyệt" thành lỗi runtime khó hiểu.
    ...(deps.finance && deps.erp
      ? {
          finance: createFinanceRunner({
            finance: deps.finance,
            gate: deps.erp,
            kb: deps.kb,
            traceEvent: trace,
            auditAgentEvent: audit,
          }),
        }
      : {}),
    // UC-005: agent sales dùng chung `erp` (gate) + kb; MCP dispatcher do caller
    // cấp để test có thể cắm server in-memory, production cắm server Prisma.
    ...(deps.sales && deps.erp
      ? {
          sales: createSalesRunner({
            mcp: deps.sales.mcp,
            gate: deps.erp,
            kb: deps.kb,
            traceEvent: trace,
            auditAgentEvent: audit,
          }),
        }
      : {}),
    ...(deps.registry || {}),
  };

  // ── classify
  const classifyNode = async (state: OrchestratorStateType): Promise<OrchestratorUpdate> => {
    const actor = actorOf(state);
    // Actor KHÔNG BAO GIỜ được suy lại từ câu hỏi; chỉ gateway được quyết định.
    const request = await classifier({ message: state.question, opsRequest: state.opsRequest });
    trace(actor, { node: 'classify', skill_call: null });
    return { opsRequest: request };
  };

  // ── validate_dag (tất định, không LLM)
  const validateDagNode = (state: OrchestratorStateType): OrchestratorUpdate => {
    const actor = actorOf(state);
    const planned = state.opsRequest?.subtasks || [];
    const result = validateDag(planned);

    if (!result.valid) {
      const error = result.errors.join('; ');
      trace(actor, { node: 'validate_dag', error });
      return {
        dagValid: false,
        dagError: error,
        subtasks: planned.map((subtask) => ({
          ...subtask,
          status: 'BLOCKED' as const,
          reason: 'dag_invalid',
        })),
      };
    }

    const byId = new Map(planned.map((subtask) => [subtask.id, subtask]));
    return {
      dagValid: true,
      dagError: null,
      // Xếp theo thứ tự topo để `authorize_handoffs` duyệt đúng thứ tự phụ thuộc.
      subtasks: result.order.map((id) => ({
        ...(byId.get(id) as (typeof planned)[number]),
        status: 'PENDING' as const,
      })),
    };
  };

  // ── authorize_handoffs (tầng 1, actor gốc bất biến)
  const authorizeHandoffsNode = async (
    state: OrchestratorStateType,
  ): Promise<OrchestratorUpdate> => {
    const actor = actorOf(state);
    const updated: SubtaskState[] = [];

    for (const subtask of state.subtasks) {
      if (subtask.status !== 'PENDING') {
        updated.push(subtask);
        continue;
      }

      const targetDepartment = getAgentDepartment(subtask.targetAgent);
      const envelope: HandoffEnvelope = {
        runId: actor.runId,
        // Bản SAO actor gốc — không thêm/bớt quyền nào.
        actor,
        fromAgent: 'orchestrator',
        toAgent: subtask.targetAgent,
        task: subtask.action,
        department: subtask.department || targetDepartment || '',
        inputs: subtask.inputs,
        allowedTools: [subtask.action],
      };

      const decision = authorizeHandoff(actor, envelope);

      try {
        await audit({
          runId: actor.runId,
          decision: decision.effect,
          agentName: subtask.targetAgent,
          toolName: subtask.action,
          resource: `${(targetDepartment || subtask.department || 'unknown').toLowerCase()}.${subtask.action}`,
          reason: decision.reason,
          department: actor.department,
          node: 'authorize_handoffs',
        });
      } catch (err) {
        // FAIL-CLOSED: không ghi được audit nghĩa là không được giao việc.
        const message = err instanceof Error ? err.message : String(err);
        trace(actor, { node: 'authorize_handoffs', error: `AUDIT_WRITE_FAILED:${message}` });
        updated.push({ ...subtask, status: 'DENIED', reason: 'audit_write_failed' });
        continue;
      }

      trace(actor, {
        node: 'authorize_handoffs',
        assigned_agent: subtask.targetAgent,
        authz_decision: {
          layer: decision.layer,
          effect: decision.effect,
          reason: decision.reason,
        },
      });

      updated.push(
        decision.effect === 'ALLOW'
          ? subtask
          : { ...subtask, status: 'DENIED', reason: decision.reason },
      );
    }

    // Việc phụ thuộc vào phần bị DENY cũng không được chạy.
    return { subtasks: propagateBlocked(updated) };
  };

  // ── schedule
  const scheduleNode = (state: OrchestratorStateType): OrchestratorUpdate => ({
    iterations: (state.iterations || 0) + 1,
    subtasks: state.subtasks,
  });

  const routeFromSchedule = (state: OrchestratorStateType) => {
    const all = state.subtasks || [];
    if ((state.iterations || 0) > maxIterations) return 'aggregate';

    const runnable = all.filter((subtask) => isRunnable(subtask, all)).slice(0, maxConcurrency);
    if (runnable.length === 0) return 'aggregate';

    // Fan-out song song; `collect` là điểm hội tụ (chạy MỘT lần sau khi tất cả xong).
    const actor = state.actor;
    if (!actor) return 'aggregate';
    return runnable.map(
      (subtask) => new Send('agent_worker', { subtask, actor } satisfies WorkerInput),
    );
  };

  // ── agent_worker (input là payload của Send, không phải toàn state)
  const workerNode = createWorkerNode({
    registry,
    get erp() {
      return requireErp();
    },
    auditAgentEvent: audit,
    traceEvent: trace,
  }) as unknown as (input: WorkerInput) => Promise<OrchestratorUpdate>;

  // ── collect
  const collectNode = (state: OrchestratorStateType): OrchestratorUpdate => ({
    subtasks: propagateBlocked(state.subtasks || []),
  });

  const routeFromCollect = (state: OrchestratorStateType) => {
    if ((state.iterations || 0) > maxIterations) return 'aggregate';
    return hasRunnable(state.subtasks || []) ? 'schedule' : 'aggregate';
  };

  // ── aggregate
  const aggregateNode = (state: OrchestratorStateType): OrchestratorUpdate => {
    const actor = actorOf(state);
    const report = buildReport(state);
    trace(actor, {
      node: 'aggregate',
      tool_call: {
        name: 'orchestrator_run',
        params: { intent: report.intent, route: report.route },
        result_summary: summarizeToolResult({
          completed: report.completed.length,
          denied_or_blocked: report.denied_or_blocked.length,
          failed: report.failed.length,
          pending_approval: report.pending_approval.length,
        }),
        duration_ms: null,
      },
      approval_decision: report.pending_approval.length > 0 ? 'PENDING' : null,
    });
    return { report };
  };

  const routeAfterClassify = (state: OrchestratorStateType) => {
    const request = state.opsRequest;
    const needsClarification =
      !request
      || request.route !== 'EXECUTE'
      || (request.missing_info || []).length > 0;
    return needsClarification ? 'aggregate' : 'validate_dag';
  };

  const routeAfterValidate = (state: OrchestratorStateType) =>
    (state.dagValid === true ? 'authorize_handoffs' : 'aggregate');

  const graph = new StateGraph(OrchestratorState)
    .addNode('classify', classifyNode)
    .addNode('validate_dag', validateDagNode)
    .addNode('authorize_handoffs', authorizeHandoffsNode)
    .addNode('schedule', scheduleNode)
    .addNode('agent_worker', workerNode)
    .addNode('collect', collectNode)
    .addNode('aggregate', aggregateNode)
    .addEdge(START, 'classify')
    .addConditionalEdges('classify', routeAfterClassify, ['validate_dag', 'aggregate'])
    .addConditionalEdges('validate_dag', routeAfterValidate, ['authorize_handoffs', 'aggregate'])
    .addEdge('authorize_handoffs', 'schedule')
    .addConditionalEdges('schedule', routeFromSchedule, ['agent_worker', 'aggregate'])
    .addEdge('agent_worker', 'collect')
    .addConditionalEdges('collect', routeFromCollect, ['schedule', 'aggregate'])
    .addEdge('aggregate', END);

  return graph.compile({ checkpointer: deps.checkpointer });
};

// ─────────────────────────────────────────────────────────────────────────────
// Orchestrator
// ─────────────────────────────────────────────────────────────────────────────

export const createOrchestrator = (deps: OrchestratorDeps): Orchestrator => {
  const actor = deps.actor;
  if (!actor?.userId || !actor?.runId) {
    throw new Error('createOrchestrator: actor phải có userId và runId từ gateway');
  }

  const graph = buildOrchestratorGraph(deps);
  const config = threadConfig(actor);

  const run: Orchestrator['run'] = async (input) => {
    const raw = await graph.invoke(
      {
        question: input.message || '',
        actor,
        opsRequest: input.opsRequest ? normalizeOpsRequest(input.opsRequest) : null,
        dagValid: null,
        dagError: null,
        subtasks: [],
        approvals: {},
        report: null,
        iterations: 0,
      },
      config,
    );
    return {
      runId: actor.runId,
      threadId: config.configurable.thread_id,
      report: (raw as { report?: OrchestratorReport | null }).report ?? null,
      interrupts: extractInterrupts(raw),
      raw,
    };
  };

  const resume: Orchestrator['resume'] = async (resumePayload) => {
    const snapshot = (await graph.getState(config)) as unknown as {
      values?: OrchestratorStateType;
      next?: string[];
    };
    const checkpointActor = snapshot?.values?.actor;
    if (!checkpointActor) {
      throw new Error(`resume: không có checkpoint cho thread ${config.configurable.thread_id}`);
    }
    // Không cho người khác resume run của người khác (kể cả cùng tenant).
    assertActorUnchanged(checkpointActor, actor);

    const raw = await graph.invoke(new Command({ resume: resumePayload }), config);
    return {
      runId: actor.runId,
      threadId: config.configurable.thread_id,
      report: (raw as { report?: OrchestratorReport | null }).report ?? null,
      interrupts: extractInterrupts(raw),
      raw,
    };
  };

  const snapshot: Orchestrator['snapshot'] = async () => {
    const state = (await graph.getState(config)) as unknown as {
      values?: OrchestratorStateType;
      next?: string[];
    };
    return { next: state.next || [], values: state.values || null };
  };

  return { graph, threadId: config.configurable.thread_id, run, resume, snapshot };
};

/**
 * Chạy tiếp một run đã dừng ở `interrupt()`.
 *
 * Với `MemorySaver`, caller PHẢI truyền đúng `checkpointer` đã dùng lúc chạy —
 * nếu không sẽ không tìm thấy thread và hàm ném lỗi thay vì chạy lại từ đầu
 * (chạy lại từ đầu sẽ giao việc lần hai).
 */
export const resumeOrchestratorRun = async (
  ctx: AuthContext,
  resumePayload: unknown,
  deps: Omit<OrchestratorDeps, 'actor'> = {},
): Promise<OrchestratorRunResult> => {
  const orchestrator = createOrchestrator({ ...deps, actor: ctx });
  return orchestrator.resume(resumePayload);
};

export type { AgentGate };
