/**
 * orchestrator/dagValidator.ts — Kiểm tra DAG của kế hoạch, TẤT ĐỊNH 100%.
 *
 * ============================================================================
 * VÌ SAO KHÔNG GỌI LLM Ở ĐÂY
 * ============================================================================
 * Đây là chốt chặn TRƯỚC khi bất kỳ tool nào chạy. Giao cho LLM nghĩa là một
 * lần model "đoán" có thể biến chu trình thành thứ tự chạy được, hoặc ngược lại
 * chặn một kế hoạch hợp lệ. Code thuần thì cùng đầu vào luôn cùng kết luận, và
 * test khoá được từng trường hợp hỏng.
 *
 * Ba lỗi bị chặn:
 *   1. ID trùng ⇒ hai việc khác nhau ghi vào cùng một ô kết quả.
 *   2. `depends_on` trỏ tới ID không tồn tại ⇒ việc không bao giờ đủ điều kiện
 *      chạy, đồ thị treo tới hết vòng lặp.
 *   3. Chu trình ⇒ không có thứ tự topo nào tồn tại.
 */
import type { OpsSubtask, SubtaskState, SubtaskStatus } from './state';

export interface DagValidationResult {
  valid: boolean;
  errors: string[];
  /** Thứ tự topo; rỗng khi DAG không hợp lệ. */
  order: string[];
}

const depsOf = (subtask: OpsSubtask): string[] =>
  Array.isArray(subtask?.depends_on) ? subtask.depends_on.map((dep) => String(dep)) : [];

/**
 * Kiểm tra cấu trúc DAG.
 *
 * Kahn để lấy thứ tự topo: `order.length !== số node` chính là dấu hiệu chu trình,
 * không cần DFS 3 màu riêng.
 */
export const validateDag = (
  subtasks: OpsSubtask[] | null | undefined,
): DagValidationResult => {
  const list = Array.isArray(subtasks) ? subtasks : [];
  if (list.length === 0) {
    return { valid: false, errors: ['dag_empty:không có việc nào trong kế hoạch'], order: [] };
  }

  const errors: string[] = [];
  const seen = new Set<string>();

  for (const subtask of list) {
    const id = String(subtask?.id ?? '').trim();
    if (!id) {
      errors.push('subtask_id_missing');
      continue;
    }
    if (seen.has(id)) errors.push(`duplicate_subtask_id:${id}`);
    seen.add(id);
  }

  for (const subtask of list) {
    if (!subtask?.id) continue;
    for (const dep of depsOf(subtask)) {
      if (dep === subtask.id) errors.push(`self_dependency:${subtask.id}`);
      else if (!seen.has(dep)) errors.push(`unknown_dependency:${subtask.id}->${dep}`);
    }
  }

  // Kahn: chỉ chạy khi cấu trúc đã sạch, để thông báo lỗi không bị nhiễu.
  if (errors.length > 0) return { valid: false, errors, order: [] };

  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  list.forEach((subtask) => {
    indegree.set(subtask.id, depsOf(subtask).length);
    depsOf(subtask).forEach((dep) => {
      dependents.set(dep, [...(dependents.get(dep) || []), subtask.id]);
    });
  });

  // Sắp theo thứ tự khai báo để kết quả tất định (test so sánh được).
  const queue = list.filter((s) => (indegree.get(s.id) || 0) === 0).map((s) => s.id);
  const order: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    order.push(id);
    for (const next of dependents.get(id) || []) {
      const left = (indegree.get(next) || 0) - 1;
      indegree.set(next, left);
      if (left === 0) queue.push(next);
    }
  }

  if (order.length !== list.length) {
    const inCycle = list.map((s) => s.id).filter((id) => !order.includes(id));
    return {
      valid: false,
      errors: [`cycle_detected:${inCycle.join('->')}`],
      order: [],
    };
  }

  return { valid: true, errors: [], order };
};

/** Trạng thái "chết": mọi việc phụ thuộc vào nó cũng không thể chạy. */
const TERMINAL_BLOCKING: SubtaskStatus[] = ['DENIED', 'BLOCKED', 'FAILED'];

/**
 * Lan truyền trạng thái chặn xuống các việc phụ thuộc (trực tiếp hoặc bắc cầu).
 *
 * Chạy lặp tới khi ổn định vì chuỗi phụ thuộc có thể dài: A bị DENY, B phụ thuộc
 * A, C phụ thuộc B — chỉ một lượt sẽ để C ở PENDING và đồ thị chờ mãi.
 */
export const propagateBlocked = (subtasks: SubtaskState[]): SubtaskState[] => {
  const byId = new Map(subtasks.map((s) => [s.id, { ...s }]));
  let changed = true;

  while (changed) {
    changed = false;
    for (const subtask of byId.values()) {
      if (subtask.status !== 'PENDING') continue;
      const blockers = depsOf(subtask).filter((dep) => {
        const target = byId.get(dep);
        return Boolean(target && TERMINAL_BLOCKING.includes(target.status));
      });
      if (blockers.length === 0) continue;
      const first = byId.get(blockers[0]) as SubtaskState;
      byId.set(subtask.id, {
        ...subtask,
        status: 'BLOCKED',
        reason: `dependency_${first.id}_${first.status.toLowerCase()}`,
      });
      changed = true;
    }
  }

  return subtasks.map((s) => byId.get(s.id) as SubtaskState);
};

/** Việc đang PENDING và mọi phụ thuộc đã COMPLETED. */
export const isRunnable = (subtask: SubtaskState, all: SubtaskState[]): boolean => {
  if (subtask.status !== 'PENDING') return false;
  const byId = new Map(all.map((s) => [s.id, s]));
  return depsOf(subtask).every((dep) => byId.get(dep)?.status === 'COMPLETED');
};

/** Việc còn PENDING và đủ điều kiện chạy — dùng để quyết định quay lại `schedule`. */
export const hasRunnable = (subtasks: SubtaskState[]): boolean =>
  subtasks.some((s) => isRunnable(s, subtasks));
