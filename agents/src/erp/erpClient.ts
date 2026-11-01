/**
 * erp/erpClient.ts — HTTP client tới ERP (`/api/agent-gateway`).
 *
 * ============================================================================
 * RÀNG BUỘC
 * ============================================================================
 * - Package này KHÔNG `require` Prisma. Ranh giới quyền vì vậy là biên giới VẬT
 *   LÝ: agent không có đường nào query DB để bỏ qua policy.
 * - Timeout HỮU HẠN mọi request (mặc định 15s) — treo mạng không được làm treo
 *   cả đồ thị agent.
 * - `postAuditEvent` FAIL-CLOSED: lỗi mạng hoặc non-2xx đều NÉM. Không có
 *   nhánh "ghi audit thất bại nhưng vẫn chạy tiếp".
 */
import type { AuthContext } from '../contracts/types';
import type {
  DuplicateInvoiceRef,
  GrnSnapshot,
  PaymentDraft,
  PaymentDraftRequest,
  PurchaseOrderSnapshot,
} from '../agents/finance/financeContract';

export interface ErpClientOptions {
  baseUrl?: string;
  jwt?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface AuditEventPayload {
  runId: string;
  decision: 'ALLOW' | 'DENY';
  agentName?: string;
  toolName?: string;
  resource?: string;
  reason?: string;
  department?: string;
  skillName?: string;
  skillVersion?: string;
  node?: string;
  params?: Record<string, unknown>;
  resultSummary?: string;
  approvalDecision?: string;
  jobId?: string;
  reportPeriod?: string;
}

export interface AuditEventResult {
  id: string;
  runId?: string;
  decision?: string;
}

/** Gate phê duyệt — hình dạng một dòng `AgentHumanGate` do ERP trả về. */
export interface AgentGate {
  id: string;
  actionType: string;
  /** PENDING | APPROVED | REJECTED | EXPIRED */
  status: string;
  actionSummary: string;
  actionPayload?: Record<string, unknown> | null;
  expiresAt?: string | null;
  decidedAt?: string | null;
  decisionNote?: string | null;
}

export interface CreateGateInput {
  actionType: 'INVOICE_3WAY_APPROVAL' | 'QUOTE_DISCOUNT_APPROVAL';
  runId: string;
  /** Orchestrator truyền `subtask.id` — server ghép `${runId}:${nodeId}`. */
  nodeId: string;
  summary: string;
  amount?: number | null;
  details?: Record<string, unknown>;
}

/**
 * Hợp đồng tối thiểu cho human-gate. `ErpClient` hiện thực nó; test cắm bản giả.
 */
export interface GateService {
  createGate(input: CreateGateInput): Promise<AgentGate>;
  getGate(gateId: string): Promise<AgentGate>;
}

// ─────────────────────────────────────────────────────────────────────────────
// UC-002 — Kho SOP/KB
// ─────────────────────────────────────────────────────────────────────────────

/** Một mục (chunk) của tài liệu SOP, đã cắt theo tiêu đề mục/điều khoản. */
export interface KbChunkInput {
  sectionHeading: string;
  content: string;
  chunkIndex?: number;
}

export interface IngestKbInput {
  docCode: string;
  title?: string | null;
  /** FINANCE | SALES | HR | OPS | WAREHOUSE | EXEC | COMPANY */
  department: string;
  /** public | internal | department_only | manager_only | confidential */
  accessLevel?: string;
  version?: string;
  effectiveDate?: string | null;
  supersededAt?: string | null;
  /** Bản bị thay thế — server đóng dấu `superseded_at` ngay tại `effectiveDate`. */
  supersedesVersion?: string | null;
  /** Có `chunks` thì dùng luôn; chỉ có `content` thì server tự cắt theo mục. */
  chunks?: KbChunkInput[];
  content?: string;
}

export interface IngestKbResult {
  docCode: string;
  title: string;
  department: string;
  accessLevel: string;
  version: string;
  effectiveDate: string;
  supersededAt: string | null;
  chunks: number;
  upserted: number;
  removed: number;
  superseded: number;
}

export interface KbSearchInput {
  query: string;
  /** Mốc thời gian hỏi quy định (ISO). Bỏ trống = hiện tại. */
  asOf?: string | null;
  topK?: number;
  includeHistorical?: boolean;
}

/** Chunk do ERP trả về — đây là TẬP DUY NHẤT được phép trích dẫn. */
export interface KbChunkResult {
  docCode: string;
  title: string;
  version: string;
  department: string;
  accessLevel: string;
  sectionHeading: string;
  chunkIndex: number;
  content: string;
  effectiveDate: string | null;
  supersededAt: string | null;
  score: number;
}

export interface KbSearchResult {
  query: string;
  asOf: string;
  includeHistorical: boolean;
  topK: number;
  total: number;
  chunks: KbChunkResult[];
}

/** Hợp đồng tối thiểu cho kho SOP. Test cắm bản giả (không cần DB). */
export interface KbService {
  searchKb(input: KbSearchInput): Promise<KbSearchResult>;
  ingestKbDocument?(input: IngestKbInput): Promise<IngestKbResult>;
}

// ─────────────────────────────────────────────────────────────────────────────
// UC-004 — Đối chiếu 3 bên PO ↔ GRN ↔ Invoice
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Hợp đồng tối thiểu cho dữ liệu tài chính. Server quyết định dữ liệu trả về
 * (đã lọc tenant); agent không có đường đọc DB trực tiếp.
 *
 * `createPaymentDraft` là tool GHI duy nhất: server tự đối chiếu lại và luôn lấy
 * STK từ `Vendor.bankAccount` (master data), không lấy từ hoá đơn.
 */
export interface FinanceService {
  lookupPurchaseOrder(input: { poNumber: string }): Promise<PurchaseOrderSnapshot | null>;
  lookupGrn(input: { poNumber: string }): Promise<GrnSnapshot>;
  checkDuplicateInvoice(input: {
    vendorTaxCode: string;
    invoiceNumber: string;
  }): Promise<DuplicateInvoiceRef[]>;
  createPaymentDraft(input: PaymentDraftRequest): Promise<PaymentDraft>;
}

// ─────────────────────────────────────────────────────────────────────────────
// UC-009 — Tra cứu audit + ma trận phân quyền (009-12)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Bộ lọc tra cứu audit. Server quyết định phạm vi: role thường bị ÉP CỨNG
 * `userId = actor.userId`, nên truyền `userId` ở đây không mở rộng được quyền.
 */
export interface AuditLogQuery {
  runId?: string;
  userId?: string;
  agentName?: string;
  toolName?: string;
  decision?: 'ALLOW' | 'DENY';
  department?: string;
  /** ISO date — lọc `createdAt >= fromDate`. */
  fromDate?: string;
  /** ISO date — lọc `createdAt <= toDate`. */
  toDate?: string;
  page?: number;
  /** Mặc định 50, tối đa 200 (server cắt). */
  limit?: number;
}

/** Một dòng AuditLog do ERP trả về (đã bỏ các cột không cần cho UI tra cứu). */
export interface AuditLogEntry {
  id: string;
  tenantId: string | null;
  userId: string | null;
  runId: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  agentName: string | null;
  toolName: string | null;
  resource: string | null;
  decision: string | null;
  reason: string | null;
  department: string | null;
  skillName: string | null;
  skillVersion: string | null;
  meta: Record<string, unknown> | null;
  createdAt: string;
}

export interface AuditLogPage {
  items: AuditLogEntry[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface PermissionRuleView {
  role: string;
  department: string;
  resource: string;
  actions: string[];
  effect?: 'ALLOW' | 'DENY';
  projection?: string[];
  note?: string;
}

export interface ApprovalRuleView {
  actionType: string;
  approverRoles: string[];
  /** Hạn mức VND theo role; `null` = không giới hạn. */
  limits: Record<string, number | null>;
  selfApprovalAllowed: boolean;
}

/**
 * Ma trận phân quyền hiện hành — đọc từ `agents/src/policy/policy.config.json`
 * phía server. UI chỉ hiển thị; KHÔNG dùng object này để tự quyết định quyền.
 */
export interface PermissionMatrix {
  version: string | null;
  defaultEffect: string;
  roles: string[];
  departments: string[];
  agentDepartments: Record<string, string>;
  agentResources: Record<string, string[]>;
  alwaysAllowedAgents: string[];
  handoffTargets: Record<string, string[]>;
  fieldProjection: { default: string[]; individualSalary: string[] };
  rules: PermissionRuleView[];
  approval: {
    selfApprovalAllowed: string[];
    rules: ApprovalRuleView[];
  };
  viewer: {
    userId: string;
    role: string;
    department: string | null;
  };
  generatedAt: string;
}

/** Hợp đồng tối thiểu cho tra cứu audit/matrix. Test cắm bản giả. */
export interface AuditQueryService {
  queryAuditLogs?(input?: AuditLogQuery): Promise<AuditLogPage>;
  getPermissionMatrix?(): Promise<PermissionMatrix>;
}

export class ErpHttpError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ErpHttpError';
    this.status = status;
  }
}

const DEFAULT_BASE_URL = 'http://localhost:4000/api';
const DEFAULT_TIMEOUT_MS = 15_000;

export class ErpClient implements GateService {
  private readonly baseUrl: string;
  private readonly jwt: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ErpClientOptions = {}) {
    const env = process.env;
    this.baseUrl = (options.baseUrl || env.ERP_API_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.jwt = options.jwt ?? env.ERP_ACTOR_JWT ?? '';
    const envTimeout = Number(env.ERP_HTTP_TIMEOUT_MS);
    this.timeoutMs = options.timeoutMs ?? (Number.isFinite(envTimeout) && envTimeout > 0 ? envTimeout : DEFAULT_TIMEOUT_MS);
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    if (typeof this.fetchImpl !== 'function') {
      throw new Error('ErpClient: môi trường không có fetch — dùng Node >= 18 hoặc truyền fetchImpl');
    }
  }

  /** Endpoint + timeout hiện tại (không lộ JWT). */
  describe(): { baseUrl: string; timeoutMs: number; hasJwt: boolean } {
    return { baseUrl: this.baseUrl, timeoutMs: this.timeoutMs, hasJwt: Boolean(this.jwt) };
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(this.jwt ? { Authorization: `Bearer ${this.jwt}` } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });

      // Đọc text trước: body lỗi có thể không phải JSON, và `json()` sẽ ném.
      const raw = await res.text();
      let parsed: unknown = null;
      try {
        parsed = raw ? JSON.parse(raw) : null;
      } catch {
        parsed = null;
      }

      if (!res.ok) {
        const message = (parsed as { message?: string } | null)?.message || raw.slice(0, 300);
        throw new ErpHttpError(`ERP ${method} ${path} → HTTP ${res.status}: ${message}`, res.status);
      }
      return parsed as T;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Danh tính actor — LẤY TỪ ERP (JWT + DB), không từ tham số người dùng. */
  async getAuthContext(runId?: string): Promise<AuthContext> {
    const query = runId ? `?runId=${encodeURIComponent(runId)}` : '';
    const json = await this.request<{ data?: AuthContext }>('GET', `/agent-gateway/auth-context${query}`);
    if (!json?.data?.userId) {
      throw new ErpHttpError('ERP trả auth-context không hợp lệ (thiếu userId)', 502);
    }
    return json.data;
  }

  /**
   * Tạo gate PENDING (idempotent theo `${runId}:${nodeId}` phía server).
   *
   * Không kiểm `status` ở đây: node LangGraph chạy lại sau resume sẽ gọi hàm này
   * lần nữa và PHẢI nhận lại đúng gate cũ, không phải gate mới.
   */
  async createGate(input: CreateGateInput): Promise<AgentGate> {
    const json = await this.request<{ data?: AgentGate }>('POST', '/agent-gateway/gates', input);
    if (!json?.data?.id) {
      throw new ErpHttpError('ERP trả gates không hợp lệ (thiếu id)', 502);
    }
    return json.data;
  }

  /** Trạng thái THẬT của gate — nguồn sự thật duy nhất sau khi resume. */
  async getGate(gateId: string): Promise<AgentGate> {
    const json = await this.request<{ data?: AgentGate }>(
      'GET',
      `/agent-gateway/gates/${encodeURIComponent(gateId)}`,
    );
    if (!json?.data?.id) {
      throw new ErpHttpError('ERP trả gate không hợp lệ (thiếu id)', 502);
    }
    return json.data;
  }

  /**
   * Nạp tài liệu SOP. Server cắt chunk theo mục nếu chỉ gửi `content`.
   * Idempotent theo `docCode + version + chunkIndex`.
   */
  async ingestKbDocument(input: IngestKbInput): Promise<IngestKbResult> {
    const json = await this.request<{ data?: IngestKbResult }>('POST', '/agent-gateway/kb/ingest', input);
    if (!json?.data?.docCode) {
      throw new ErpHttpError('ERP trả kb/ingest không hợp lệ (thiếu docCode)', 502);
    }
    return json.data;
  }

  /**
   * Tra cứu SOP. ACL + phiên bản đã được lọc trong SQL phía server theo actor;
   * client không có tham số nào để nới quyền.
   */
  async searchKb(input: KbSearchInput): Promise<KbSearchResult> {
    const json = await this.request<{ data?: KbSearchResult }>('POST', '/agent-gateway/kb/search', input);
    if (!json?.data || !Array.isArray(json.data.chunks)) {
      throw new ErpHttpError('ERP trả kb/search không hợp lệ (thiếu chunks)', 502);
    }
    return json.data;
  }

  // ── UC-004: dữ liệu đối chiếu 3 bên ──────────────────────────────────────

  /** PO + dòng hàng + STK CHUẨN của NCC. `null` = không có PO trong tenant. */
  async lookupPurchaseOrder(input: { poNumber: string }): Promise<PurchaseOrderSnapshot | null> {
    const json = await this.request<{ data?: PurchaseOrderSnapshot | null }>(
      'POST',
      '/agent-gateway/finance/po/lookup',
      input,
    );
    if (!json || !('data' in json)) {
      throw new ErpHttpError('ERP trả finance/po/lookup không hợp lệ (thiếu data)', 502);
    }
    return json.data ?? null;
  }

  /** Số lượng thực nhận luỹ kế trên các GRN `POSTED`. */
  async lookupGrn(input: { poNumber: string }): Promise<GrnSnapshot> {
    const json = await this.request<{ data?: GrnSnapshot }>(
      'POST',
      '/agent-gateway/finance/grn/lookup',
      input,
    );
    if (!json?.data || typeof json.data.found !== 'boolean' || !Array.isArray(json.data.lines)) {
      throw new ErpHttpError('ERP trả finance/grn/lookup không hợp lệ', 502);
    }
    return json.data;
  }

  /** Lịch sử trùng theo cặp `(vendorTaxCode, invoiceNumber)` — trên mọi PO. */
  async checkDuplicateInvoice(input: {
    vendorTaxCode: string;
    invoiceNumber: string;
  }): Promise<DuplicateInvoiceRef[]> {
    const json = await this.request<{ data?: DuplicateInvoiceRef[] }>(
      'POST',
      '/agent-gateway/finance/invoice/check-duplicate',
      input,
    );
    if (!Array.isArray(json?.data)) {
      throw new ErpHttpError('ERP trả finance/invoice/check-duplicate không hợp lệ', 502);
    }
    return json.data;
  }

  /**
   * Tạo bản nháp đề nghị thanh toán. Server đối chiếu lại và trả STK master —
   * client KHÔNG được tự dựng số tài khoản.
   */
  async createPaymentDraft(input: PaymentDraftRequest): Promise<PaymentDraft> {
    const json = await this.request<{ data?: PaymentDraft }>(
      'POST',
      '/agent-gateway/finance/payment-drafts',
      input,
    );
    if (!json?.data?.status || !json.data.bankAccount) {
      throw new ErpHttpError('ERP trả finance/payment-drafts không hợp lệ', 502);
    }
    return json.data;
  }

  /**
   * Ghi audit. THROW khi lỗi mạng hoặc non-2xx — `withToolGuard` dựa vào điều
   * này để dừng trước khi chạy handler.
   */
  async postAuditEvent(payload: AuditEventPayload): Promise<AuditEventResult> {
    const json = await this.request<{ data?: AuditEventResult }>('POST', '/agent-gateway/audit-events', payload);
    if (!json?.data?.id) {
      throw new ErpHttpError('ERP trả audit-events không hợp lệ (thiếu id)', 502);
    }
    return json.data;
  }

  /**
   * Tra cứu AuditLog. Phạm vi do SERVER quyết định theo JWT — client không có
   * tham số nào để xem audit của người khác nếu role không đủ.
   */
  async queryAuditLogs(input: AuditLogQuery = {}): Promise<AuditLogPage> {
    const params = new URLSearchParams();
    const append = (key: keyof AuditLogQuery, value: unknown): void => {
      if (value === undefined || value === null || value === '') return;
      params.set(key, String(value));
    };
    append('runId', input.runId);
    append('userId', input.userId);
    append('agentName', input.agentName);
    append('toolName', input.toolName);
    append('decision', input.decision);
    append('department', input.department);
    append('fromDate', input.fromDate);
    append('toDate', input.toDate);
    append('page', input.page);
    append('limit', input.limit);

    const query = params.toString();
    const json = await this.request<{
      data?: AuditLogEntry[];
      pagination?: Partial<AuditLogPage>;
    }>('GET', `/agent-gateway/audit-logs${query ? `?${query}` : ''}`);

    if (!Array.isArray(json?.data)) {
      throw new ErpHttpError('ERP trả audit-logs không hợp lệ (thiếu mảng data)', 502);
    }

    const pagination = json.pagination || {};
    return {
      items: json.data,
      page: Number(pagination.page ?? input.page ?? 1),
      limit: Number(pagination.limit ?? input.limit ?? 50),
      total: Number(pagination.total ?? json.data.length),
      totalPages: Number(pagination.totalPages ?? 0),
    };
  }

  /**
   * Ma trận phân quyền hiện hành. Dùng cho màn hình tra cứu 009-12 — KHÔNG
   * dùng để tự quyết định quyền trong agent (quyền vẫn do `policyEngine` +
   * server quyết định).
   */
  async getPermissionMatrix(): Promise<PermissionMatrix> {
    const json = await this.request<{ data?: PermissionMatrix }>(
      'GET',
      '/agent-gateway/permission-matrix',
    );
    const matrix = json?.data;
    if (!matrix || !Array.isArray(matrix.rules) || !matrix.agentDepartments) {
      throw new ErpHttpError('ERP trả permission-matrix không hợp lệ', 502);
    }
    return matrix;
  }
}
