/**
 * agents/finance/financeAgent.ts — UC-004: đối chiếu 3 bên + đề nghị thanh toán.
 *
 * ============================================================================
 * BẢY BẤT BIẾN (test `uc004-finance-reconciliation` khoá lại)
 * ============================================================================
 * 1. Hợp đồng skill được nạp + kiểm TĨNH trước khi chạy bất kỳ tool nào.
 * 2. Mọi tool đi qua `withToolGuard`: authorize theo actor gốc, audit fail-closed
 *    TRƯỚC handler, field projection trên kết quả.
 * 3. Không LLM nào tính tiền. `invoiceValidator` là nguồn sự thật duy nhất.
 * 4. Trùng hoá đơn / thiếu PO-GRN / sai số học ⇒ KHÔNG tạo đề nghị, KHÔNG gate.
 * 5. STK đề nghị thanh toán LUÔN lấy từ master NCC; hoá đơn ghi STK khác ⇒ chặn.
 * 6. `MATCHED_3WAY` vẫn phải qua human-gate `INVOICE_3WAY_APPROVAL` — không có
 *    nhánh nào chi tiền trực tiếp.
 * 7. Chỉ sau khi `getGate(gateId).status === 'APPROVED'` mới trả đề nghị đã chốt.
 *
 * `resumePayload` KHÔNG phải nguồn sự thật: sau resume node chạy lại và hỏi ERP
 * bằng `getGate`. Người gọi nhét `{ status: 'APPROVED' }` vào resume không mở
 * được cửa duyệt.
 */
import { interrupt } from '@langchain/langgraph';

import type { AuthContext } from '../../contracts/types';
import type {
  AuditEventPayload,
  AuditEventResult,
  FinanceService,
  GateService,
  KbService,
  KbSearchResult,
} from '../../erp/erpClient';
import type { OpsSubtask } from '../../orchestrator/state';
import { requestHumanApproval, type AgentRunner } from '../../orchestrator/workers';
import { AuditTrailError, withToolGuard } from '../../policy/toolWrapper';
import { PromptInjectionError, guardUntrustedContent } from '../../policy/untrustedContent';
import {
  auditAgentEvent,
  traceEvent,
  type TraceEventInput,
} from '../../telemetry/auditAndTrace';
import type {
  DuplicateInvoiceRef,
  ExtractedInvoice,
  GrnSnapshot,
  InvoiceClassification,
  InvoiceIssue,
  PaymentDraft,
  PurchaseOrderSnapshot,
  ReconcileResult,
} from './financeContract';
import { reconcileInvoice, validateInvoiceSchema } from './invoiceValidator';
import {
  assertValidSkillManifest,
  loadSkillManifest,
  type LoadedSkillManifest,
} from './skillManifest';

export interface FinanceAgentDeps {
  /** Nguồn dữ liệu PO/GRN/trùng + tạo nháp đề nghị thanh toán. */
  finance: FinanceService;
  /** Human-gate — tạo gate PENDING và đọc trạng thái THẬT sau resume. */
  gate: GateService;
  /** Tuỳ chọn: tra quy định thanh toán qua `kb.search`. */
  kb?: KbService;
  auditAgentEvent?: (event: AuditEventPayload) => Promise<AuditEventResult>;
  traceEvent?: (ctx: AuthContext, partial: TraceEventInput) => unknown;
  skillManifest?: LoadedSkillManifest;
  skillManifestPath?: string;
}

export interface FinanceAgentResult {
  status: 'APPROVED' | 'REJECTED' | 'BLOCKED';
  classification: InvoiceClassification;
  issues: InvoiceIssue[];
  paymentDraft: PaymentDraft | null;
  gateId: string | null;
  invoiceNumber: string | null;
  skill: { name: string; version: string };
  runId: string;
}

type ExtractArgs = { invoice: unknown };
type ExtractToolResult = {
  invoice: unknown;
  schemaValid: boolean;
  schemaIssues: InvoiceIssue[];
};

type LookupArgs = { poNumber: string };
type DuplicateArgs = { vendorTaxCode: string; invoiceNumber: string };
type MatchArgs = {
  invoice: unknown;
  purchaseOrder: PurchaseOrderSnapshot | null;
  grn: GrnSnapshot | null;
  duplicates: DuplicateInvoiceRef[];
};
type DraftArgs = { invoice: unknown; poNumber: string };
type KbArgs = { query: string; asOf?: string | null; topK?: number };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const errorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

/**
 * Bảy tool của hợp đồng. Tất cả đi qua `withToolGuard`; không có handler trần.
 * `kb.search` chỉ chạy khi caller truyền `kbQuery` — vẫn đăng ký để policy kiểm.
 */
const buildTools = (deps: FinanceAgentDeps, skill: LoadedSkillManifest) => {
  const common = {
    agentName: 'finance',
    node: 'finance_agent',
    skillName: skill.name,
    skillVersion: skill.version,
  };
  const guardDeps = {
    auditAgentEvent: deps.auditAgentEvent,
    traceEvent: deps.traceEvent,
  };

  return {
    extractInvoice: withToolGuard<ExtractArgs, ExtractToolResult>(
      { ...common, name: 'invoice.extract', resource: 'invoice.extract', action: 'read' },
      (_ctx, args) => {
        const parsed = validateInvoiceSchema(args.invoice);
        return {
          invoice: parsed.invoice ?? args.invoice,
          schemaValid: parsed.valid,
          schemaIssues: parsed.issues,
        };
      },
      guardDeps,
    ),

    lookupPo: withToolGuard<LookupArgs, PurchaseOrderSnapshot | null>(
      { ...common, name: 'po.lookup', resource: 'finance.purchase_order', action: 'read' },
      (_ctx, args) => {
        const poNumber = String(args.poNumber || '').trim();
        if (!poNumber) return Promise.resolve(null);
        return deps.finance.lookupPurchaseOrder({ poNumber });
      },
      guardDeps,
    ),

    lookupGrn: withToolGuard<LookupArgs, GrnSnapshot>(
      { ...common, name: 'grn.lookup', resource: 'finance.goods_receipt', action: 'read' },
      (_ctx, args) => deps.finance.lookupGrn({ poNumber: String(args.poNumber || '') }),
      guardDeps,
    ),

    checkDuplicate: withToolGuard<DuplicateArgs, DuplicateInvoiceRef[]>(
      { ...common, name: 'invoice.check_duplicate', resource: 'invoice.duplicate', action: 'read' },
      (_ctx, args) =>
        deps.finance.checkDuplicateInvoice({
          vendorTaxCode: String(args.vendorTaxCode || ''),
          invoiceNumber: String(args.invoiceNumber || ''),
        }),
      guardDeps,
    ),

    threeWayMatch: withToolGuard<MatchArgs, ReconcileResult>(
      {
        ...common,
        name: 'invoice.three_way_match',
        resource: 'invoice.three_way_match',
        action: 'read',
      },
      (_ctx, args) =>
        reconcileInvoice({
          invoice: args.invoice,
          purchaseOrder: args.purchaseOrder,
          grn: args.grn,
          duplicates: args.duplicates,
        }),
      guardDeps,
    ),

    createDraft: withToolGuard<DraftArgs, PaymentDraft>(
      { ...common, name: 'payment.create_draft', resource: 'finance.payment', action: 'write' },
      (_ctx, args) =>
        deps.finance.createPaymentDraft({
          invoice: args.invoice,
          poNumber: String(args.poNumber || ''),
        }),
      guardDeps,
    ),

    searchKb: withToolGuard<KbArgs, KbSearchResult>(
      { ...common, name: 'kb.search', resource: 'kb', action: 'read' },
      (_ctx, args) => {
        if (!deps.kb) throw new Error('finance_agent: kb.search chưa được cấu hình');
        return deps.kb.searchKb({
          query: String(args.query || ''),
          asOf: args.asOf ?? null,
          topK: args.topK,
        });
      },
      guardDeps,
    ),
  };
};

/**
 * Tạo runner `finance` cho orchestrator. Hợp đồng skill được nạp + kiểm NGAY
 * LÚC KHỞI TẠO — sai hợp đồng thì không có runner nào được đăng ký.
 */
export const createFinanceAgent = (deps: FinanceAgentDeps): AgentRunner => {
  const manifest = deps.skillManifest ?? loadSkillManifest(deps.skillManifestPath);
  assertValidSkillManifest(manifest);

  const tools = buildTools(deps, manifest);
  const audit = deps.auditAgentEvent ?? auditAgentEvent;
  const trace = deps.traceEvent ?? traceEvent;
  const skillRef = { name: manifest.name, version: manifest.version };

  /** Ghi `skill_call` vào audit + trace. Audit hỏng ⇒ dừng (fail-closed). */
  const recordSkillCall = async (ctx: AuthContext): Promise<void> => {
    try {
      await audit({
        runId: ctx.runId,
        decision: 'ALLOW',
        agentName: 'finance',
        toolName: 'skill.load',
        resource: 'finance.skill',
        reason: 'skill_contract_valid',
        department: ctx.department,
        skillName: manifest.name,
        skillVersion: manifest.version,
        node: 'finance_agent',
        params: { skill_call: { ...skillRef } },
        resultSummary: `skill_manifest:${manifest.filePath}`,
      });
    } catch (err) {
      throw new AuditTrailError(
        `Dừng an toàn: không ghi được audit skill (${errorMessage(err)})`,
      );
    }

    trace(ctx, {
      node: 'finance_agent',
      assigned_agent: 'finance',
      skill_call: { ...skillRef },
      authz_decision: { layer: 'TOOL', effect: 'ALLOW', reason: 'skill_contract_valid' },
    });
  };

  /** Audit DENY cho kết quả không được phép chi tiền. Chỉ chứa mã, không dữ liệu. */
  const recordDenial = async (
    ctx: AuthContext,
    classification: InvoiceClassification,
    issues: InvoiceIssue[],
  ): Promise<void> => {
    const codes = issues.map((issue) => issue.code);
    const reason = classification === 'PROMPT_INJECTION_DETECTED'
      ? `untrusted_content_injection:${codes.join('+') || 'unknown'}`
      : `reconciliation_blocked:${classification}`;

    try {
      await audit({
        runId: ctx.runId,
        decision: 'DENY',
        agentName: 'finance',
        toolName: 'invoice.three_way_match',
        resource: 'invoice.three_way_match',
        reason,
        department: ctx.department,
        skillName: manifest.name,
        skillVersion: manifest.version,
        node: 'finance_agent',
        // Chỉ mã lỗi — KHÔNG gửi STK/số tiền thật vào audit.
        params: { classification, issueCodes: codes },
        resultSummary: 'payment_blocked',
      });
    } catch (err) {
      throw new AuditTrailError(
        `Dừng an toàn: không ghi được audit từ chối (${errorMessage(err)})`,
      );
    }

    trace(ctx, {
      node: 'finance_agent',
      assigned_agent: 'finance',
      authz_decision: { layer: 'TOOL', effect: 'DENY', reason },
      error: reason,
    });
  };

  const blockedResult = (
    ctx: AuthContext,
    classification: InvoiceClassification,
    issues: InvoiceIssue[],
    invoiceNumber: string | null,
  ): FinanceAgentResult => ({
    status: 'BLOCKED',
    classification,
    issues,
    paymentDraft: null,
    gateId: null,
    invoiceNumber,
    skill: { ...skillRef },
    runId: ctx.runId,
  });

  const runner: AgentRunner = async (ctx, subtask) => {
    if (!ctx?.userId || !ctx?.tenantId || !ctx?.department) {
      throw new Error('finance_agent: thiếu actor đã xác thực');
    }

    await recordSkillCall(ctx);

    const inputs = subtask.inputs || {};
    if (!('invoice' in inputs)) {
      throw new Error('finance_agent: thiếu inputs.invoice');
    }

    const rawInvoice = inputs.invoice;
    const invoiceNumber = isRecord(rawInvoice) && typeof rawInvoice.invoiceNumber === 'string'
      ? rawInvoice.invoiceNumber.trim()
      : null;

    // 1) Chuẩn hoá + schema. Schema hỏng ⇒ MATH_ERROR, không gọi mạng.
    const extracted = await tools.extractInvoice(ctx, { invoice: rawInvoice });
    if (!extracted.schemaValid) {
      const issues = extracted.schemaIssues;
      await recordDenial(ctx, 'MATH_ERROR', issues);
      return blockedResult(ctx, 'MATH_ERROR', issues, invoiceNumber);
    }

    const invoice = extracted.invoice as ExtractedInvoice;

    // 2) Quét nội dung không tin cậy TRƯỚC khi dùng làm context.
    if (invoice.rawText) {
      try {
        await guardUntrustedContent(
          ctx,
          {
            content: invoice.rawText,
            agentName: 'finance',
            toolName: 'invoice.extract',
            resource: 'invoice.extract',
            node: 'finance_agent',
          },
          { auditAgentEvent: deps.auditAgentEvent, traceEvent: deps.traceEvent },
        );
      } catch (err) {
        if (err instanceof PromptInjectionError) {
          const issues: InvoiceIssue[] = [{ code: 'prompt_injection', detail: err.code }];
          trace(ctx, {
            node: 'finance_agent',
            assigned_agent: 'finance',
            authz_decision: { layer: 'TOOL', effect: 'DENY', reason: err.code },
            error: err.code,
          });
          return blockedResult(ctx, 'PROMPT_INJECTION_DETECTED', issues, invoice.invoiceNumber);
        }
        throw err;
      }
    }

    // 3) Tra cứu PO/GRN/lịch sử trùng — mọi lời gọi đều qua tool guard.
    const purchaseOrder = invoice.poNumber
      ? await tools.lookupPo(ctx, { poNumber: invoice.poNumber })
      : null;
    const grn = purchaseOrder && invoice.poNumber
      ? await tools.lookupGrn(ctx, { poNumber: invoice.poNumber })
      : null;
    const duplicates = await tools.checkDuplicate(ctx, {
      vendorTaxCode: invoice.vendorTaxCode,
      invoiceNumber: invoice.invoiceNumber,
    });

    // 4) Đối chiếu tất định.
    const match = await tools.threeWayMatch(ctx, {
      invoice,
      purchaseOrder,
      grn,
      duplicates,
    });

    if (match.classification !== 'MATCHED_3WAY') {
      await recordDenial(ctx, match.classification, match.issues);
      return blockedResult(ctx, match.classification, match.issues, invoice.invoiceNumber);
    }

    // 5) Tạo nháp đề nghị thanh toán — server dùng STK master.
    const draft = await tools.createDraft(ctx, {
      invoice,
      poNumber: invoice.poNumber,
    });

    if (draft.status !== 'pending_approval' || draft.bankAccountSource !== 'vendor_master') {
      throw new Error(`finance_agent: đề nghị thanh toán không hợp lệ (status=${draft.status})`);
    }

    // Bất biến: STK trên đề nghị phải trùng STK master của PO. Nếu server trả
    // khác, dừng — không có nhánh "lấy STK trên hoá đơn cho xong".
    const canonicalBank = purchaseOrder?.vendor?.vendorBankAccount || '';
    if (!canonicalBank || draft.bankAccount !== canonicalBank) {
      const issues: InvoiceIssue[] = [{ code: 'bank_account_mismatch' }];
      await recordDenial(ctx, 'PROMPT_INJECTION_DETECTED', issues);
      return blockedResult(ctx, 'PROMPT_INJECTION_DETECTED', issues, invoice.invoiceNumber);
    }

    // 6) Human-gate. Khoá idempotency = `${runId}:${subtask.id}` do server ghép.
    const gate = await requestHumanApproval(
      ctx,
      {
        id: subtask.id,
        requiresApproval: {
          actionType: 'INVOICE_3WAY_APPROVAL',
          summary: `Đề nghị thanh toán HĐ ${invoice.invoiceNumber} theo ${purchaseOrder?.poCode}: ${invoice.totalAmount} VND`,
          amount: invoice.totalAmount,
          details: {
            invoiceNumber: invoice.invoiceNumber,
            poCode: purchaseOrder?.poCode || invoice.poNumber,
            vendorId: purchaseOrder?.vendor?.id || null,
            vendorName: purchaseOrder?.vendor?.name || invoice.vendorName,
            vendorTaxCode: purchaseOrder?.vendor?.taxCode || invoice.vendorTaxCode,
            bankAccount: draft.bankAccount,
            paymentDraft: draft,
            classification: match.classification,
            skill: { ...skillRef },
          },
        },
      },
      deps.gate,
      trace,
    );

    let gateState = await deps.gate.getGate(gate.id);

    if (gateState.status === 'PENDING') {
      trace(ctx, {
        node: 'finance_agent',
        assigned_agent: 'finance',
        skill_call: { ...skillRef },
        approval_decision: 'PENDING',
      });

      // Dừng đồ thị — LangGraph lưu checkpoint. KHÔNG bắt tín hiệu này.
      interrupt({
        gateId: gate.id,
        subtaskId: subtask.id,
        actionType: gateState.actionType || 'INVOICE_3WAY_APPROVAL',
        summary: gateState.actionSummary,
        amount: invoice.totalAmount,
        invoiceNumber: invoice.invoiceNumber,
      });

      // Chạy lại sau resume: `resumePayload` không được tin, hỏi ERP.
      gateState = await deps.gate.getGate(gate.id);
    }

    // 7) Chưa APPROVED thì không có lệnh chi.
    if (gateState.status !== 'APPROVED') {
      trace(ctx, {
        node: 'finance_agent',
        assigned_agent: 'finance',
        approval_decision: gateState.status,
      });
      return {
        status: 'REJECTED',
        classification: match.classification,
        issues: [],
        paymentDraft: null,
        gateId: gate.id,
        invoiceNumber: invoice.invoiceNumber,
        skill: { ...skillRef },
        runId: ctx.runId,
      };
    }

    const finalized: PaymentDraft = {
      ...draft,
      status: 'approved',
      finalized: true,
    };

    try {
      await audit({
        runId: ctx.runId,
        decision: 'ALLOW',
        agentName: 'finance',
        toolName: 'payment.create_draft',
        resource: 'finance.payment',
        reason: 'invoice_3way_approved',
        department: ctx.department,
        skillName: manifest.name,
        skillVersion: manifest.version,
        node: 'finance_agent',
        approvalDecision: 'APPROVED',
        params: { gateId: gate.id, invoiceNumber: invoice.invoiceNumber },
        resultSummary: 'payment_draft_approved',
      });
    } catch (err) {
      throw new AuditTrailError(
        `Dừng an toàn: không ghi được audit chốt đề nghị (${errorMessage(err)})`,
      );
    }

    trace(ctx, {
      node: 'finance_agent',
      assigned_agent: 'finance',
      skill_call: { ...skillRef },
      approval_decision: 'APPROVED',
      tool_call: {
        name: 'payment.create_draft',
        params: { invoiceNumber: invoice.invoiceNumber, gateId: gate.id },
        result_summary: 'payment_draft_approved',
        duration_ms: 0,
      },
    });

    return {
      status: 'APPROVED',
      classification: 'MATCHED_3WAY',
      issues: [],
      paymentDraft: finalized,
      gateId: gate.id,
      invoiceNumber: invoice.invoiceNumber,
      skill: { ...skillRef },
      runId: ctx.runId,
    } satisfies FinanceAgentResult;
  };

  return runner;
};

/** Alias đặt tên theo orchestrator (`create<Agent>Runner`). */
export const createFinanceRunner = createFinanceAgent;

/** Kiểu subtask tối thiểu mà runner cần — export để test dựng fixture. */
export type FinanceSubtask = Pick<OpsSubtask, 'id' | 'inputs'>;
