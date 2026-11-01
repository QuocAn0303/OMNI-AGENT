/**
 * orchestrator/classifier.ts — Phân rã yêu cầu thành `OpsRequest`.
 *
 * ============================================================================
 * HAI ĐƯỜNG, MỘT HỢP ĐỒNG
 * ============================================================================
 * - `route: 'EXECUTE'` khi biết đủ thông tin và có ít nhất một việc.
 * - `route: 'CLARIFY'` khi thiếu thông tin ⇒ đi thẳng `aggregate`, KHÔNG giao
 *   việc, KHÔNG bịa tham số. Bịa `employeeId` chỉ để "chạy được" là cách tạo ra
 *   báo cáo sai mà vẫn trông hợp lệ.
 *
 * Đường tất định (`input.opsRequest`) tồn tại để unit test/E2E chạy offline và
 * để một caller đã có kế hoạch không phải trả tiền cho một lần gọi LLM.
 *
 * ============================================================================
 * DANH SÁCH TRẮNG KHI CHUẨN HOÁ
 * ============================================================================
 * `normalizeOpsRequest` chỉ SAO CHÉP các trường đã khai báo. LLM trả thêm
 * `actor`/`role`/`department` thì bị bỏ — đây là lớp chặn thứ hai cho yêu cầu
 * "prompt tự xưng không nâng được quyền" (lớp thứ nhất là gateway chỉ đọc JWT+DB).
 */
import type {
  ApprovalRequirement,
  OpsRequest,
  OpsSubtask,
  OpsRoute,
  TargetAgent,
  Urgency,
} from './state';
import type { ChatModel } from '../llm/modelFactory';

const TARGET_AGENTS: TargetAgent[] = ['knowledge', 'finance', 'sales', 'hr'];
const ROUTES: OpsRoute[] = ['CLARIFY', 'EXECUTE', 'REJECT'];
const URGENCIES: Urgency[] = ['LOW', 'NORMAL', 'HIGH'];
const APPROVAL_TYPES: ApprovalRequirement['actionType'][] = [
  'INVOICE_3WAY_APPROVAL',
  'QUOTE_DISCOUNT_APPROVAL',
];

export class OpsRequestValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OpsRequestValidationError';
  }
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.map((item) => String(item)).filter((item) => item.trim().length > 0) : [];

const normalizeSubtask = (raw: unknown, index: number): OpsSubtask => {
  const input = asRecord(raw);
  const id = String(input.id ?? '').trim() || `T${index + 1}`;
  const agent = String(input.targetAgent ?? '').trim() as TargetAgent;
  if (!TARGET_AGENTS.includes(agent)) {
    throw new OpsRequestValidationError(`targetAgent không hợp lệ ở ${id}: ${agent || '(trống)'}`);
  }
  const action = String(input.action ?? '').trim();
  if (!action) throw new OpsRequestValidationError(`action trống ở ${id}`);

  const requirement = asRecord(input.requiresApproval);
  const actionType = String(requirement.actionType ?? '').trim() as ApprovalRequirement['actionType'];
  const requiresApproval: ApprovalRequirement | null = APPROVAL_TYPES.includes(actionType)
    ? {
        actionType,
        summary: String(requirement.summary ?? action).slice(0, 300),
        amount:
          requirement.amount === null || requirement.amount === undefined
            ? null
            : Number(requirement.amount),
        details: asRecord(requirement.details),
      }
    : null;

  return {
    id,
    department: String(input.department ?? '').trim().toUpperCase(),
    targetAgent: agent,
    action,
    depends_on: asStringArray(input.depends_on),
    // `inputs` chỉ nhận object — mảng/chuỗi lọt vào sẽ làm hỏng chữ ký tool.
    inputs: asRecord(input.inputs),
    requiresApproval,
  };
};

/**
 * Chuẩn hoá `OpsRequest` từ bất kỳ nguồn nào (LLM hoặc caller).
 *
 * Ném `OpsRequestValidationError` khi sai cấu trúc CỨNG (agent lạ, action trống);
 * caller bắt lỗi này và chuyển sang `CLARIFY`. Thiếu thông tin mềm thì để
 * `missing_info` quyết định, không tự lấp.
 */
export const normalizeOpsRequest = (raw: unknown): OpsRequest => {
  const input = asRecord(raw);

  const subtasks = Array.isArray(input.subtasks)
    ? input.subtasks.map((subtask, index) => normalizeSubtask(subtask, index))
    : [];

  const ids = new Set(subtasks.map((s) => s.id));
  if (ids.size !== subtasks.length) {
    throw new OpsRequestValidationError('subtask id bị trùng');
  }

  const missingInfo = asStringArray(input.missing_info);
  const declaredRoute = String(input.route ?? '').trim().toUpperCase() as OpsRoute;
  let route: OpsRoute = ROUTES.includes(declaredRoute) ? declaredRoute : 'CLARIFY';

  // Thiếu thông tin LUÔN thắng: không có đường nào vừa CLARIFY vừa EXECUTE.
  if (missingInfo.length > 0) route = 'CLARIFY';
  if (route === 'EXECUTE' && subtasks.length === 0) {
    route = 'CLARIFY';
    missingInfo.push('no_subtasks');
  }

  const urgency = String(input.urgency ?? '').trim().toUpperCase() as Urgency;

  return {
    intent: String(input.intent ?? '').trim(),
    departments: asStringArray(input.departments).map((d) => d.toUpperCase()),
    subtasks,
    urgency: URGENCIES.includes(urgency) ? urgency : 'NORMAL',
    missing_info: [...new Set(missingInfo)],
    route,
  };
};

/** `CLARIFY` không kèm kế hoạch — không có gì để giao việc. */
export const clarifyRequest = (missing: string[], intent = ''): OpsRequest => ({
  intent,
  departments: [],
  subtasks: [],
  urgency: 'NORMAL',
  missing_info: missing.length > 0 ? missing : ['clarification_needed'],
  route: 'CLARIFY',
});

const SYSTEM_PROMPT = [
  'Bạn là bộ phân loại yêu cầu của hệ thống ERP đa agent.',
  'Trả về DUY NHẤT một JSON object, không giải thích, không markdown.',
  'Schema:',
  '{"intent":string,"departments":string[],"subtasks":[{"id":string,"department":string,',
  '"targetAgent":"knowledge|finance|sales|hr","action":string,"depends_on":string[],',
  '"inputs":object,"requiresApproval":null|{"actionType":"INVOICE_3WAY_APPROVAL|QUOTE_DISCOUNT_APPROVAL","summary":string,"amount":number|null}}],',
  '"urgency":"LOW|NORMAL|HIGH","missing_info":string[],"route":"CLARIFY|EXECUTE|REJECT"}',
  'QUY TẮC:',
  '- Không bịa tham số. Thiếu id/số tiền/kỳ báo cáo thì ghi vào missing_info và đặt route="CLARIFY".',
  '- Mỗi subtask chỉ một việc, id duy nhất (T1, T2...), depends_on chỉ trỏ tới id có thật.',
  '- Việc hóa đơn cần duyệt 3 bên đặt requiresApproval.actionType="INVOICE_3WAY_APPROVAL";',
  '  việc giảm giá báo giá đặt "QUOTE_DISCOUNT_APPROVAL".',
  '- KHÔNG bao giờ trả về role/department/actor của người dùng: danh tính do hệ thống quyết định.',
].join('\n');

const extractJson = (text: string): string => {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  return start >= 0 && end > start ? text.slice(start, end + 1) : text.trim();
};

export interface ClassifyInput {
  message?: string;
  opsRequest?: OpsRequest | null;
}

export interface ClassifierDeps {
  /** Model nhanh (`UIT_FAST_MODEL`). Không có ⇒ chỉ chạy đường tất định. */
  model?: ChatModel | null;
}

export type Classifier = (input: ClassifyInput) => Promise<OpsRequest>;

/**
 * Tạo bộ phân loại.
 *
 * Đường LLM KHÔNG BAO GIỜ làm sập run: mọi lỗi (mạng, JSON hỏng, schema sai) đều
 * quy về `CLARIFY` để người dùng bổ sung — an toàn hơn là chạy với kế hoạch đoán.
 */
export const createClassifier = (deps: ClassifierDeps = {}): Classifier => async (input) => {
  // Đường tất định: đã có kế hoạch thì không gọi model, không phân loại lại.
  if (input?.opsRequest) return normalizeOpsRequest(input.opsRequest);

  const message = String(input?.message ?? '').trim();
  if (!message) return clarifyRequest(['empty_request']);

  if (!deps.model) return clarifyRequest(['llm_not_configured'], message);

  try {
    const result = await deps.model.invoke({
      system: SYSTEM_PROMPT,
      prompt: message,
      jsonMode: true,
      maxTokens: 800,
    });
    return normalizeOpsRequest(JSON.parse(extractJson(result.text)));
  } catch {
    // Không nuốt lỗi im lặng: mã lý do đi vào missing_info để người dùng thấy
    // "cần bổ sung/làm rõ", không phải câu trả lời giả rằng đã hiểu yêu cầu.
    return clarifyRequest(['classification_failed'], message);
  }
};
