/**
 * orchestrator/state.ts — Kênh trạng thái của đồ thị + hợp đồng `OpsRequest`.
 *
 * ============================================================================
 * VÌ SAO `OpsRequest` NẰM Ở ĐÂY
 * ============================================================================
 * `classify` sinh ra `OpsRequest`, `validate_dag`/`authorize_handoffs`/`schedule`
 * đều đọc nó, `aggregate` báo cáo lại nó. Đặt hợp đồng cạnh trạng thái để không
 * có hai bản định nghĩa lệch nhau.
 *
 * ============================================================================
 * REDUCER — ĐIỂM DỄ SAI NHẤT
 * ============================================================================
 * Nhánh `Send` chạy SONG SONG nên nhiều `agent_worker` cùng trả về một mảng
 * `subtasks`. Reducer gộp THEO `id` (không nối mảng) — nối mảng sẽ sinh bản ghi
 * trùng và `collect` đếm sai số việc còn lại, khiến đồ thị lặp vô hạn.
 */
import { Annotation } from '@langchain/langgraph';

import type { AuthContext } from '../contracts/types';

// ─────────────────────────────────────────────────────────────────────────────
// Hợp đồng đầu vào/đầu ra
// ─────────────────────────────────────────────────────────────────────────────

export type OpsRoute = 'CLARIFY' | 'EXECUTE' | 'REJECT';

export type Urgency = 'LOW' | 'NORMAL' | 'HIGH';

/** Bốn loại agent nghiệp vụ mà orchestrator được phép giao việc. */
export type TargetAgent = 'knowledge' | 'finance' | 'sales' | 'hr';

/** Hai `actionType` cần người duyệt — khớp `agent-gateway.service.js`. */
export type ApprovalActionType = 'INVOICE_3WAY_APPROVAL' | 'QUOTE_DISCOUNT_APPROVAL';

export interface ApprovalRequirement {
  actionType: ApprovalActionType;
  summary: string;
  amount?: number | null;
  details?: Record<string, unknown>;
}

export interface OpsSubtask {
  id: string;
  department: string;
  targetAgent: TargetAgent;
  action: string;
  depends_on: string[];
  inputs: Record<string, unknown>;
  /** Có mặt ⇒ subtask phải qua human-gate trước khi chạy tool. */
  requiresApproval?: ApprovalRequirement | null;
}

/**
 * Phân rã câu hỏi của người dùng.
 *
 * KHÔNG chứa `actor`, `userId`, `role`, `department` — bộ chuẩn hoá
 * (`classifier.normalizeOpsRequest`) chỉ sao chép các trường trong danh sách
 * trắng, nên LLM có trả thêm `actor: { role: 'ADMIN' }` cũng bị bỏ.
 */
export interface OpsRequest {
  intent: string;
  departments: string[];
  subtasks: OpsSubtask[];
  urgency: Urgency;
  missing_info: string[];
  route: OpsRoute;
}

export interface OrchestratorInput {
  message: string;
  /** Truyền sẵn để chạy TẤT ĐỊNH (unit test/E2E) — bỏ qua LLM hoàn toàn. */
  opsRequest?: OpsRequest | null;
}

export type SubtaskStatus =
  | 'PENDING'
  | 'COMPLETED'
  | 'DENIED'
  | 'BLOCKED'
  | 'FAILED'
  | 'PENDING_APPROVAL';

export interface SubtaskState extends OpsSubtask {
  status: SubtaskStatus;
  reason?: string | null;
  error?: string | null;
  result?: unknown;
  gateId?: string | null;
  approval?: 'APPROVED' | 'REJECTED' | null;
}

/** Bản ghi quyết định duyệt, lưu theo `subtaskId`. */
export interface ApprovalRecord {
  subtaskId: string;
  gateId: string;
  actionType: string;
  status: string;
}

export interface OrchestratorReport {
  runId: string;
  intent: string;
  route: OpsRoute;
  dagValid: boolean;
  dagError: string | null;
  missingInfo: string[];
  completed: Array<{ id: string; agent: string; department: string; result: unknown }>;
  denied_or_blocked: Array<{ id: string; status: SubtaskStatus; reason: string }>;
  pending_approval: Array<{ id: string; gateId: string | null; actionType: string | null }>;
  failed: Array<{ id: string; error: string }>;
  /** Câu trả lời cho người dùng — chỉ chứa dữ liệu ĐÃ qua `fieldProjection`. */
  summary: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Kênh trạng thái
// ─────────────────────────────────────────────────────────────────────────────

/** Gộp subtask theo `id`; giữ thứ tự xuất hiện đầu tiên. */
export const mergeSubtasks = (
  left: SubtaskState[] = [],
  right: SubtaskState[] = [],
): SubtaskState[] => {
  if (!right || right.length === 0) return left;
  const byId = new Map<string, SubtaskState>();
  left.forEach((item) => byId.set(item.id, item));
  right.forEach((item) => {
    const previous = byId.get(item.id);
    byId.set(item.id, previous ? { ...previous, ...item } : item);
  });
  return [...byId.values()];
};

const lastValue = <T>(fallback: T) =>
  Annotation<T>({
    reducer: (current: T, incoming: T) => (incoming === undefined ? current : incoming),
    default: () => fallback,
  });

export const OrchestratorState = Annotation.Root({
  /** Câu hỏi gốc — KHÔNG dùng làm nguồn danh tính. */
  question: lastValue<string>(''),
  /** Actor GỐC do gateway trả về; bất biến xuyên suốt đồ thị. */
  actor: lastValue<AuthContext | null>(null),
  opsRequest: lastValue<OpsRequest | null>(null),
  dagValid: lastValue<boolean | null>(null),
  dagError: lastValue<string | null>(null),
  subtasks: Annotation<SubtaskState[]>({
    reducer: mergeSubtasks,
    default: () => [],
  }),
  approvals: Annotation<Record<string, ApprovalRecord>>({
    reducer: (current: Record<string, ApprovalRecord>, incoming: Record<string, ApprovalRecord>) => ({
      ...current,
      ...incoming,
    }),
    default: () => ({}),
  }),
  report: lastValue<OrchestratorReport | null>(null),
  /**
   * Chống lặp vô hạn: `schedule` tăng, `collect` đọc. Đồ thị vòng lặp mà không có
   * bộ đếm thì một lỗi logic trong điều kiện dừng sẽ treo cả run.
   */
  iterations: lastValue<number>(0),
});

export type OrchestratorStateType = typeof OrchestratorState.State;
export type OrchestratorUpdate = typeof OrchestratorState.Update;

// ─────────────────────────────────────────────────────────────────────────────
// Báo cáo
// ─────────────────────────────────────────────────────────────────────────────

const describeStatus = (status: SubtaskStatus): string => {
  switch (status) {
    case 'DENIED':
      return 'bị từ chối quyền';
    case 'BLOCKED':
      return 'bị chặn do phụ thuộc';
    case 'FAILED':
      return 'lỗi khi thực thi';
    case 'PENDING_APPROVAL':
      return 'chờ người duyệt';
    default:
      return 'chưa chạy';
  }
};

/**
 * Dựng báo cáo tách bạch bốn nhóm. Người đọc phải phân biệt được "chưa làm vì
 * không có quyền" với "chưa làm vì lỗi" — gộp lại là che mất sự cố.
 */
export const buildReport = (state: OrchestratorStateType): OrchestratorReport => {
  const subtasks = state.subtasks || [];
  const request = state.opsRequest;

  const completed = subtasks
    .filter((s) => s.status === 'COMPLETED')
    .map((s) => ({ id: s.id, agent: s.targetAgent, department: s.department, result: s.result }));

  const denied = subtasks
    .filter((s) => s.status === 'DENIED' || s.status === 'BLOCKED')
    .map((s) => ({ id: s.id, status: s.status, reason: s.reason || 'không rõ lý do' }));

  const pending = subtasks
    .filter((s) => s.status === 'PENDING_APPROVAL')
    .map((s) => ({
      id: s.id,
      gateId: s.gateId || null,
      actionType: s.requiresApproval?.actionType || null,
    }));

  const failed = subtasks
    .filter((s) => s.status === 'FAILED')
    .map((s) => ({ id: s.id, error: s.error || 'lỗi không rõ' }));

  const stillPending = subtasks.filter((s) => s.status === 'PENDING');

  const parts: string[] = [];
  if (!state.dagValid && state.dagError) {
    parts.push(`Kế hoạch không hợp lệ: ${state.dagError}`);
  }
  if (request && (request.route !== 'EXECUTE' || (request.missing_info || []).length > 0)) {
    const missing = [...(request.missing_info || [])];
    if (stillPending.length > 0) missing.push(...stillPending.map((s) => `${s.id}:${s.action}`));
    parts.push(
      missing.length > 0
        ? `Cần bổ sung thông tin: ${missing.join(', ')}`
        : 'Cần người dùng làm rõ yêu cầu trước khi thực thi.',
    );
  }
  if (completed.length > 0) {
    parts.push(`Đã hoàn tất ${completed.length} phần: ${completed.map((c) => c.id).join(', ')}`);
  }
  if (denied.length > 0) {
    parts.push(
      `${denied.length} phần ${describeStatus('DENIED')}: ${denied
        .map((d) => `${d.id} (${d.reason})`)
        .join('; ')}`,
    );
  }
  if (pending.length > 0) {
    parts.push(`Chờ duyệt: ${pending.map((p) => p.id).join(', ')}`);
  }
  if (failed.length > 0) {
    parts.push(`${failed.length} phần lỗi: ${failed.map((f) => `${f.id} (${f.error})`).join('; ')}`);
  }
  if (parts.length === 0) parts.push('Không có việc nào được thực thi.');

  return {
    runId: state.actor?.runId || '',
    intent: request?.intent || '',
    route: request?.route || 'CLARIFY',
    dagValid: state.dagValid === true,
    dagError: state.dagError || null,
    missingInfo: [...(request?.missing_info || [])],
    completed,
    denied_or_blocked: denied,
    pending_approval: pending,
    failed,
    summary: parts.join('. '),
  };
};
