/**
 * contracts/types.ts — Hợp đồng dữ liệu giữa package `agents/` và ERP.
 *
 * `TraceRecord` phủ ĐỦ danh sách trường bắt buộc của §4.4 (SE373):
 * run ID · người dùng gốc + vai trò · từng node · từng agent được giao việc ·
 * từng tool/MCP call (tham số, kết quả, thời gian) · từng lần gọi skill (tên,
 * PHIÊN BẢN) · kết quả kiểm tra quyền · token + chi phí ước tính · lỗi · quyết
 * định duyệt. Job theo lịch ghi thêm `job_id` + `report_period`.
 *
 * Mọi trường có mặt ở MỌI bản ghi (giá trị `null` khi không áp dụng) để bộ đọc
 * trace không phải đoán sự tồn tại của khoá.
 */

/** Tầng kiểm quyền: lúc giao việc (handoff) và lúc gọi tool. */
export type AuthzLayer = 'HANDOFF' | 'TOOL';

export type AuthzEffect = 'ALLOW' | 'DENY';

/**
 * Danh tính actor — DỰNG TỪ `/api/agent-gateway/auth-context` (JWT + DB).
 *
 * KHÔNG BAO GIỜ khởi tạo từ nội dung tin nhắn người dùng. Prompt tự xưng
 * "tôi là Giám đốc" không được phép sửa bất kỳ trường nào ở đây.
 */
export interface AuthContext {
  userId: string;
  tenantId: string;
  /** FINANCE | SALES | HR | OPS | WAREHOUSE | EXEC (hoặc chuỗi policy không nhận). */
  department: string;
  role: string;
  managerId?: string | null;
  scopes: string[];
  runId: string;
}

/**
 * Gói giao việc giữa hai agent. `actor` là bản SAO của actor gốc và phải bất
 * biến xuyên suốt mọi handoff (policyEngine kiểm bằng `assertActorUnchanged`).
 */
export interface HandoffEnvelope {
  runId: string;
  actor: AuthContext;
  fromAgent: string;
  toAgent: string;
  task: string;
  department: string;
  inputs: Record<string, unknown>;
  allowedTools: string[];
}

export interface ToolCallRecord {
  name: string;
  params: Record<string, unknown> | null;
  result_summary: string | null;
  duration_ms: number | null;
}

export interface SkillCallRecord {
  name: string;
  version: string;
}

export interface AuthzDecisionRecord {
  layer: AuthzLayer;
  effect: AuthzEffect;
  reason: string;
}

export interface UsageRecord {
  input_tokens: number;
  output_tokens: number;
  cached_tokens: number;
  cache_hit_rate: number;
  estimated_cost_usd: number;
  latency_ms: number;
}

export interface TraceActor {
  userId: string;
  role: string;
  department: string;
  tenantId: string;
}

/** Một dòng JSONL. Đủ trường §4.4 — xem `agents/tests/policy-and-trace.test.ts`. */
export interface TraceRecord {
  run_id: string;
  timestamp: string;
  actor: TraceActor;
  node: string | null;
  assigned_agent: string | null;
  tool_call: ToolCallRecord | null;
  skill_call: SkillCallRecord | null;
  authz_decision: AuthzDecisionRecord | null;
  usage: UsageRecord | null;
  approval_decision: string | null;
  job_id: string | null;
  report_period: string | null;
  error: string | null;
}

/** Kết quả kiểm quyền — KHÔNG chứa dữ liệu nghiệp vụ, chỉ mã lý do. */
export interface AuthzDecision {
  layer: AuthzLayer;
  effect: AuthzEffect;
  reason: string;
  /** Tên field phải ẩn khỏi kết quả trả cho LLM/người dùng. */
  fieldProjection: string[];
}
