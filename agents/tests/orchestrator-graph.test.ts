/**
 * tests/orchestrator-graph.test.ts — Sáu bài kiểm chứng bộ điều phối LangGraph.
 *
 * Cách chạy: `cd agents && npm test`
 *
 * Nguyên tắc: mỗi bài phải bắt được một lỗi ĐÃ XẢY RA THẬT ở lớp điều phối:
 *   1. Đồ thị hỏng (chu trình / phụ thuộc ma) mà vẫn giao việc ⇒ agent chạy trên
 *      thứ tự không tồn tại.
 *   2. Chạy tuần tự dù khai báo song song ⇒ mất tác dụng của fan-out.
 *   3. Một subtask lỗi làm sập cả run ⇒ mất kết quả của các nhánh đã xong.
 *   4. Giao việc chỉ kiểm một lần rồi quên tầng handoff ⇒ nhân viên SALES đọc
 *      được lương qua agent HR.
 *   5. `resumePayload` được tin tuyệt đối ⇒ tự duyệt gate bằng cách gửi
 *      `{ status: 'APPROVED' }`.
 *   6. Orchestrator lén import Prisma / đăng ký tool ghi ⇒ phá ranh giới bảo mật.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

import { MemorySaver } from '@langchain/langgraph';

import type { AuthContext } from '../src/contracts/types';
import type { AgentGate, AuditEventPayload, CreateGateInput, GateService } from '../src/erp/erpClient';
import {
  createOrchestrator,
  resumeOrchestratorRun,
  type OrchestratorDeps,
} from '../src/orchestrator/graph';
import { validateDag } from '../src/orchestrator/dagValidator';
import type { AgentRegistry } from '../src/orchestrator/workers';
import type { OpsRequest, OrchestratorReport } from '../src/orchestrator/state';
import { readTraceLines, traceEvent } from '../src/telemetry/auditAndTrace';

const TRACE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aduu-orchestrator-traces-'));
process.env.AGENT_TRACE_DIR = TRACE_ROOT;

afterAll(() => {
  fs.rmSync(TRACE_ROOT, { recursive: true, force: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tiện ích
// ─────────────────────────────────────────────────────────────────────────────

const makeCtx = (overrides: Partial<AuthContext> = {}): AuthContext => ({
  userId: 'u-1',
  tenantId: 'tenant-1',
  department: 'EXEC',
  role: 'ADMIN',
  managerId: null,
  scopes: ['agent:handoff'],
  runId: 'run-orch-1',
  ...overrides,
});

/** Kế hoạch mặc định: route EXECUTE, không thiếu thông tin. */
const makeRequest = (subtasks: OpsRequest['subtasks'], overrides: Partial<OpsRequest> = {}): OpsRequest => ({
  intent: 'kiểm chứng điều phối',
  departments: [...new Set(subtasks.map((s) => s.department))],
  subtasks,
  urgency: 'NORMAL',
  missing_info: [],
  route: 'EXECUTE',
  ...overrides,
});

const subtask = (
  id: string,
  targetAgent: 'knowledge' | 'finance' | 'sales' | 'hr',
  department: string,
  dependsOn: string[] = [],
  extra: Record<string, unknown> = {},
) => ({
  id,
  department,
  targetAgent,
  action: `${targetAgent}_${id.toLowerCase()}`,
  depends_on: dependsOn,
  inputs: {},
  ...extra,
});

interface GateFixture extends GateService {
  gates: Map<string, AgentGate>;
  calls: CreateGateInput[];
  setStatus: (gateId: string, status: string) => void;
}

/** Gate giả có ĐÚNG ngữ nghĩa idempotency mà ERP thật cài đặt. */
const makeGateService = (): GateFixture => {
  const gates = new Map<string, AgentGate>();
  const calls: CreateGateInput[] = [];

  return {
    gates,
    calls,
    async createGate(input: CreateGateInput): Promise<AgentGate> {
      calls.push(input);
      const key = `${input.runId}:${input.nodeId}`;
      const existing = [...gates.values()].find(
        (gate) => (gate.actionPayload as Record<string, unknown>)?.idempotencyKey === key,
      );
      if (existing) return existing;

      const gate: AgentGate = {
        id: `gate-${gates.size + 1}`,
        actionType: input.actionType,
        status: 'PENDING',
        actionSummary: input.summary,
        actionPayload: { idempotencyKey: key, ...(input.details || {}) },
        expiresAt: null,
        decidedAt: null,
        decisionNote: null,
      };
      gates.set(gate.id, gate);
      return gate;
    },
    async getGate(gateId: string): Promise<AgentGate> {
      const gate = gates.get(gateId);
      if (!gate) throw new Error(`gate không tồn tại: ${gateId}`);
      return { ...gate };
    },
    setStatus(gateId: string, status: string): void {
      const gate = gates.get(gateId);
      if (!gate) throw new Error(`gate không tồn tại: ${gateId}`);
      gate.status = status;
    },
  };
};

/** Sink audit: ghi lại để assert, không gọi mạng (không phụ thuộc backend). */
const makeAuditSink = () => {
  const events: AuditEventPayload[] = [];
  return {
    events,
    auditAgentEvent: async (event: AuditEventPayload) => {
      events.push(event);
      return { id: `audit-${events.length}` };
    },
  };
};

const baseDeps = (
  actor: AuthContext,
  registry: AgentRegistry,
  extra: Partial<OrchestratorDeps> = {},
): OrchestratorDeps => ({
  actor,
  registry,
  traceEvent,
  // Mặc định KHÔNG gọi mạng. Thiếu dòng này, `authorize_handoffs` fail-closed vì
  // không có backend ⇒ mọi subtask bị DENY và test đọc sai nguyên nhân.
  auditAgentEvent: async () => ({ id: 'audit-offline' }),
  ...extra,
});

const reportOf = (value: OrchestratorReport | null): OrchestratorReport => {
  if (!value) throw new Error('run không trả báo cáo — đồ thị dừng giữa đường');
  return value;
};

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('Orchestrator LangGraph — an toàn và chịu lỗi', () => {
  test('1. DAG có chu trình hoặc phụ thuộc không tồn tại bị chặn tại validate_dag', async () => {
    const actor = makeCtx({ runId: 'run-dag-1' });

    // Kiểm tra thuần trước: hàm tất định, không cần đồ thị.
    expect(validateDag([subtask('A', 'finance', 'FINANCE', ['B']), subtask('B', 'finance', 'FINANCE', ['A'])])).toMatchObject({
      valid: false,
    });
    expect(validateDag([subtask('A', 'finance', 'FINANCE', ['T9'])]).errors).toEqual(['unknown_dependency:A->T9']);

    const runner = jest.fn(async () => ({ ok: true }));
    const { events, auditAgentEvent } = makeAuditSink();

    const orchestrator = createOrchestrator(
      baseDeps(
        actor,
        { finance: runner },
        { auditAgentEvent, checkpointer: new MemorySaver() },
      ),
    );

    const cyclic = await orchestrator.run({
      message: 'chu trình',
      opsRequest: makeRequest([
        subtask('A', 'finance', 'FINANCE', ['B']),
        subtask('B', 'finance', 'FINANCE', ['A']),
      ]),
    });

    const report = reportOf(cyclic.report);
    expect(report.dagValid).toBe(false);
    expect(report.dagError).toContain('cycle_detected');
    expect(report.denied_or_blocked.map((item) => item.id).sort()).toEqual(['A', 'B']);
    expect(report.denied_or_blocked.every((item) => item.reason === 'dag_invalid')).toBe(true);
    expect(report.completed).toHaveLength(0);

    // KHÔNG agent nào được gọi, KHÔNG audit giao việc nào được ghi.
    expect(runner).not.toHaveBeenCalled();
    expect(events).toHaveLength(0);
  });

  test('2. T1/T2 chạy song song; T3 chỉ chạy sau khi cả hai COMPLETED', async () => {
    const actor = makeCtx({ runId: 'run-parallel-2' });
    const timeline: string[] = [];

    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    // T1 chậm hơn T2: nếu chạy tuần tự, T2:start sẽ nằm SAU T1:end.
    const registry: AgentRegistry = {
      sales: async () => {
        timeline.push('T1:start');
        await sleep(50);
        timeline.push('T1:end');
        return { revenue: 1_000 };
      },
      finance: async (_ctx, task) => {
        timeline.push(`${task.id}:start`);
        await sleep(task.id === 'T2' ? 10 : 5);
        timeline.push(`${task.id}:end`);
        return { id: task.id, ok: true };
      },
    };

    const orchestrator = createOrchestrator(
      baseDeps(actor, registry, { checkpointer: new MemorySaver() }),
    );

    const result = await orchestrator.run({
      message: 'song song',
      opsRequest: makeRequest([
        subtask('T1', 'sales', 'SALES'),
        subtask('T2', 'finance', 'FINANCE'),
        subtask('T3', 'finance', 'FINANCE', ['T1', 'T2']),
      ]),
    });

    const report = reportOf(result.report);
    expect(report.completed.map((item) => item.id).sort()).toEqual(['T1', 'T2', 'T3']);

    const index = (mark: string) => {
      const at = timeline.indexOf(mark);
      expect(at).toBeGreaterThanOrEqual(0);
      return at;
    };

    // Song song thật: T2 bắt đầu khi T1 còn đang chạy.
    expect(index('T2:start')).toBeLessThan(index('T1:end'));
    // Barrier thật: T3 không được bắt đầu trước khi cả hai xong.
    expect(index('T3:start')).toBeGreaterThan(index('T1:end'));
    expect(index('T3:start')).toBeGreaterThan(index('T2:end'));
  });

  test('3. Một nhánh lỗi không làm sập run — báo cáo giữ kết quả T1 và lỗi T2', async () => {
    const actor = makeCtx({ runId: 'run-partial-3' });
    const { events, auditAgentEvent } = makeAuditSink();

    const registry: AgentRegistry = {
      sales: async () => ({ revenue: 900 }),
      finance: async () => {
        throw new Error('ERP sập khi đọc công nợ');
      },
    };

    const orchestrator = createOrchestrator(
      baseDeps(actor, registry, { auditAgentEvent, checkpointer: new MemorySaver() }),
    );

    const result = await orchestrator.run({
      message: 'lỗi một phần',
      opsRequest: makeRequest([
        subtask('T1', 'sales', 'SALES'),
        subtask('T2', 'finance', 'FINANCE'),
      ]),
    });

    const report = reportOf(result.report);
    expect(report.completed).toHaveLength(1);
    expect(report.completed[0]).toMatchObject({ id: 'T1', result: { revenue: 900 } });
    expect(report.failed).toHaveLength(1);
    expect(report.failed[0].id).toBe('T2');
    expect(report.failed[0].error).toContain('ERP sập');

    // Lỗi runtime vẫn để lại dấu vết: một sự kiện DENY cho T2.
    expect(events.some((e) => e.decision === 'DENY' && e.toolName === 'finance_t2')).toBe(true);

    const lines = readTraceLines(actor.runId);
    expect(lines.some((line) => line.node === 'aggregate')).toBe(true);
    expect(lines.some((line) => line.error?.includes('ERP sập'))).toBe(true);
  });

  test('4. SALES đọc doanh thu được duyệt, đọc lương HR bị chặn ở authorize_handoffs', async () => {
    const actor = makeCtx({
      userId: 'u-cashier',
      role: 'CASHIER',
      department: 'SALES',
      scopes: ['agent:handoff', 'tool:read:sales'],
      runId: 'run-acl-4',
    });
    const { events, auditAgentEvent } = makeAuditSink();

    const salesRunner = jest.fn(async () => ({ revenue: 5_000 }));
    const hrRunner = jest.fn(async () => ({ baseSalary: 30_000_000 }));

    const orchestrator = createOrchestrator(
      baseDeps(
        actor,
        { sales: salesRunner, hr: hrRunner },
        { auditAgentEvent, checkpointer: new MemorySaver() },
      ),
    );

    const result = await orchestrator.run({
      message: 'doanh thu và lương',
      opsRequest: makeRequest([
        subtask('T1', 'sales', 'SALES'),
        subtask('T2', 'hr', 'HR'),
      ]),
    });

    const report = reportOf(result.report);
    expect(report.completed.map((item) => item.id)).toEqual(['T1']);
    expect(salesRunner).toHaveBeenCalledTimes(1);

    // T2 bị chặn 100%: runner HR không bao giờ được gọi.
    expect(hrRunner).not.toHaveBeenCalled();
    expect(report.denied_or_blocked).toHaveLength(1);
    expect(report.denied_or_blocked[0]).toMatchObject({ id: 'T2', status: 'DENIED' });
    expect(report.denied_or_blocked[0].reason).toBe('handoff_not_permitted:CASHIER->HR');

    const denyEvent = events.find((e) => e.decision === 'DENY');
    expect(denyEvent).toBeDefined();
    expect(denyEvent?.toolName).toBe('hr_t2');
    expect(denyEvent?.reason).toBe('handoff_not_permitted:CASHIER->HR');
    expect(events.filter((e) => e.decision === 'ALLOW')).toHaveLength(1);
  });

  test('5. Gate PENDING ⇒ interrupt; resume chỉ tin trạng thái ERP và chỉ tạo 1 gate', async () => {
    const actor = makeCtx({
      userId: 'u-accountant',
      role: 'ACCOUNTANT',
      department: 'FINANCE',
      scopes: ['agent:handoff', 'tool:read', 'gate:decide:finance'],
      runId: 'run-gate-5',
    });
    const erp = makeGateService();
    const checkpointer = new MemorySaver();
    const financeRunner = jest.fn(async () => ({ approved: true }));

    const registry: AgentRegistry = { finance: financeRunner };

    const plan = makeRequest([
      subtask('T1', 'finance', 'FINANCE', [], {
        requiresApproval: {
          actionType: 'INVOICE_3WAY_APPROVAL',
          summary: 'Duyệt hóa đơn 3 bên cho PO-001',
          amount: 25_000_000,
        },
      }),
    ]);

    const orchestrator = createOrchestrator(
      baseDeps(actor, registry, { erp, checkpointer }),
    );

    const paused = await orchestrator.run({ message: 'duyệt hóa đơn', opsRequest: plan });

    // Đồ thị DỪNG tại interrupt, chưa aggregate.
    expect(paused.interrupts).toHaveLength(1);
    expect(paused.interrupts[0].value).toMatchObject({ subtaskId: 'T1', gateId: 'gate-1' });
    expect(paused.report).toBeNull();
    expect(financeRunner).not.toHaveBeenCalled();
    expect(erp.gates.size).toBe(1);

    const snapshot = await orchestrator.snapshot();
    expect(snapshot.next).toEqual(['agent_worker']);

    // Người duyệt xử lý trên ERP thật.
    erp.setStatus('gate-1', 'APPROVED');

    // resumePayload nói APPROVED — nhưng quyết định phải đến từ ERP.
    const resumed = await resumeOrchestratorRun(actor, 'APPROVED', {
      registry,
      erp,
      checkpointer,
      traceEvent,
    });

    const report = reportOf(resumed.report);
    expect(report.completed.map((item) => item.id)).toEqual(['T1']);
    expect(financeRunner).toHaveBeenCalledTimes(1);

    // Idempotency: mọi lần gọi đều cùng khoá, và chỉ có MỘT gate được tạo.
    expect(erp.gates.size).toBe(1);
    expect(erp.calls.every((call) => `${call.runId}:${call.nodeId}` === 'run-gate-5:T1')).toBe(true);

    // ── Nửa thứ hai: ERP nói REJECTED thì resumePayload "APPROVED" vô hiệu.
    const erpRejected = makeGateService();
    const rejectedRunId = 'run-gate-rejected-5';
    const rejectedActor = { ...actor, runId: rejectedRunId };
    const runner2 = jest.fn(async () => ({ approved: true }));
    const checkpointer2 = new MemorySaver();
    const orchestrator2 = createOrchestrator(
      baseDeps(rejectedActor, { finance: runner2 }, { erp: erpRejected, checkpointer: checkpointer2 }),
    );

    await orchestrator2.run({ message: 'duyệt hóa đơn', opsRequest: plan });
    erpRejected.setStatus('gate-1', 'REJECTED');

    // resumePayload nói "APPROVED", nhưng ERP nói REJECTED ⇒ phải theo ERP.
    const rejected = await resumeOrchestratorRun(rejectedActor, 'APPROVED', {
      registry: { finance: runner2 },
      erp: erpRejected,
      checkpointer: checkpointer2,
      traceEvent,
    });

    const rejectedReport = reportOf(rejected.report);
    expect(rejectedReport.denied_or_blocked).toEqual([
      { id: 'T1', status: 'DENIED', reason: 'gate_rejected' },
    ]);
    expect(rejectedReport.completed).toHaveLength(0);
    expect(runner2).not.toHaveBeenCalled();

    // Resume mà không có đúng checkpointer ⇒ NÉM, tuyệt đối không chạy lại từ đầu
    // (chạy lại từ đầu sẽ thực thi subtask lần hai mà không có phê duyệt).
    await expect(
      resumeOrchestratorRun(rejectedActor, 'APPROVED', {
        registry: { finance: runner2 },
        erp: erpRejected,
        checkpointer: new MemorySaver(),
        traceEvent,
      }),
    ).rejects.toThrow(/checkpoint/);
    expect(runner2).not.toHaveBeenCalled();
  });

  test('6. Orchestrator không import Prisma và không đăng ký tool ghi', () => {
    const dir = path.resolve(__dirname, '..', 'src', 'orchestrator');
    const files = fs.readdirSync(dir).filter((name) => name.endsWith('.ts'));
    expect(files.length).toBeGreaterThanOrEqual(6);

    for (const file of files) {
      const source = fs.readFileSync(path.join(dir, file), 'utf8');

      // Soi ĐÚNG câu IMPORT/REQUIRE, không soi chú thích: chính ghi chú trong tệp
      // có nhắc tên gói Prisma để giải thích vì sao nó bị cấm.
      expect(source).not.toMatch(/(?:from|require\()\s*['"][^'"]*(?:@prisma|prisma\/config|config\/prisma)[^'"]*['"]/);
      expect(source).not.toMatch(/\bprisma\.\w+\.(create|update|updateMany|delete|deleteMany|upsert|executeRaw)/);
      // Không khai báo tool ghi trong bộ điều phối.
      expect(source).not.toMatch(/action:\s*['"]write['"]/);
      expect(source).not.toMatch(/\b(registerWriteTool|writeTool|insertRow|mutateRecord)\b/);

      // Truy cập Postgres (nếu có) CHỈ được nằm ở checkpointer — để chứa
      // checkpoint, không phải để đọc bảng nghiệp vụ.
      if (file !== 'checkpointer.ts') {
        expect(source).not.toMatch(/from\s+['"]@langchain\/langgraph-checkpoint-postgres['"]/);
        expect(source).not.toMatch(/require\(['"]pg['"]\)/);
      }
    }
  });
});
