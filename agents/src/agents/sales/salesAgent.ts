/**
 * agents/sales/salesAgent.ts — UC-005: cập nhật CRM + soạn báo giá qua 3 MCP server.
 *
 * ============================================================================
 * BẢY BẤT BIẾN (test `uc005-sales-mcp` khoá lại)
 * ============================================================================
 * 1. Hợp đồng skill `quote-generation@1.0.0` được nạp + kiểm TĨNH trước khi chạy
 *    bất kỳ tool nào.
 * 2. MỌI tool đi qua MCP dispatcher → `withToolGuard` (authorize theo actor gốc,
 *    audit fail-closed, field projection). Không gọi server trần.
 * 3. Không LLM nào tính tiền. `pricingEngine` (lõi JS dùng chung với gateway) là
 *    nguồn sự thật duy nhất; `validateQuoteMath` kiểm lại độc lập.
 * 4. Chống trùng khách hàng: `crm.upsert_customer` trả `CUSTOMER_AMBIGUOUS` ⇒
 *    KHÔNG tạo báo giá, KHÔNG tạo gate, KHÔNG tạo nháp.
 * 5. Nội dung email khách gửi bị quét prompt injection TRƯỚC khi dùng; dính cờ
 *    ⇒ bác bỏ mức chiết khấu giả mạo, không ghi gì.
 * 6. Chiết khấu > 10% ⇒ gate `QUOTE_DISCOUNT_APPROVAL` PENDING + `interrupt()`,
 *    CHƯA tạo nháp. Chỉ sau khi `getGate(...).status === 'APPROVED'` mới gọi
 *    `mail.create_draft`.
 * 7. `mail-mcp` chỉ tạo `DRAFT` / `sent: false`; agent không có đường gửi thư.
 */
import { interrupt } from '@langchain/langgraph';

import type { AuthContext } from '../../contracts/types';
import type {
  AuditEventPayload,
  AuditEventResult,
  GateService,
  KbService,
} from '../../erp/erpClient';
import type { OpsSubtask } from '../../orchestrator/state';
import { requestHumanApproval, type AgentRunner } from '../../orchestrator/workers';
import { AuditTrailError } from '../../policy/toolWrapper';
import { PromptInjectionError, guardUntrustedContent } from '../../policy/untrustedContent';
import {
  auditAgentEvent,
  traceEvent,
  type TraceEventInput,
} from '../../telemetry/auditAndTrace';
import type { McpCallResult, McpDispatcher } from './mcpClient';
import {
  PricingError,
  assertQuoteMath,
  computeQuote,
} from './pricingEngine';
import type {
  CustomerInput,
  CustomerRecord,
  CustomerUpsertResult,
  PriceList,
  QuoteIssue,
  QuoteValidation,
  SalesAgentResult,
  SalesEmailDraft,
  SalesQuote,
  SalesQuoteRequest,
  SalesQuoteSheet,
} from './salesContract';
import {
  assertValidSkillManifest,
  loadSkillManifest,
  type LoadedSkillManifest,
} from './skillManifest';

/** Mặc định 10% — hạn mức tự quyết của nhân viên SALES. */
export const SALES_DISCOUNT_THRESHOLD_PERCENT = 10;

export interface SalesAgentDeps {
  mcp: McpDispatcher;
  gate: GateService;
  kb?: KbService;
  /** Ngưỡng chiết khấu tự quyết; mặc định 10%. */
  discountThresholdPercent?: number;
  auditAgentEvent?: (event: AuditEventPayload) => Promise<AuditEventResult>;
  traceEvent?: (ctx: AuthContext, partial: TraceEventInput) => unknown;
  skillManifest?: LoadedSkillManifest;
  skillManifestPath?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const errorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

const formatVnd = (value: number): string =>
  `${Math.round(value).toLocaleString('vi-VN')} VND`;

const toCustomer = (value: unknown): CustomerRecord | null =>
  isRecord(value) ? (value as unknown as CustomerRecord) : null;

export const createSalesAgent = (deps: SalesAgentDeps): AgentRunner => {
  const manifest = deps.skillManifest ?? loadSkillManifest(deps.skillManifestPath);
  assertValidSkillManifest(manifest);

  const audit = deps.auditAgentEvent ?? auditAgentEvent;
  const trace = deps.traceEvent ?? traceEvent;
  const skillRef = { name: manifest.name, version: manifest.version };
  const threshold = Number.isFinite(deps.discountThresholdPercent)
    ? Number(deps.discountThresholdPercent)
    : SALES_DISCOUNT_THRESHOLD_PERCENT;

  const recordSkillCall = async (ctx: AuthContext): Promise<void> => {
    try {
      await audit({
        runId: ctx.runId,
        decision: 'ALLOW',
        agentName: 'sales',
        toolName: 'skill.load',
        resource: 'sales.skill',
        reason: 'skill_contract_valid',
        department: ctx.department,
        skillName: manifest.name,
        skillVersion: manifest.version,
        node: 'sales_agent',
        params: { skill_call: { ...skillRef } },
        resultSummary: `skill_manifest:${manifest.filePath}`,
      });
    } catch (err) {
      throw new AuditTrailError(`Dừng an toàn: không ghi được audit skill (${errorMessage(err)})`);
    }

    trace(ctx, {
      node: 'sales_agent',
      assigned_agent: 'sales',
      skill_call: { ...skillRef },
      authz_decision: { layer: 'TOOL', effect: 'ALLOW', reason: 'skill_contract_valid' },
    });
  };

  const recordDenial = async (
    ctx: AuthContext,
    reason: string,
    issues: QuoteIssue[] = [],
  ): Promise<void> => {
    try {
      await audit({
        runId: ctx.runId,
        decision: 'DENY',
        agentName: 'sales',
        toolName: 'sales.quote',
        resource: 'sales.quote',
        reason,
        department: ctx.department,
        skillName: manifest.name,
        skillVersion: manifest.version,
        node: 'sales_agent',
        params: { issueCodes: issues.map((issue) => issue.code) },
        resultSummary: 'quote_blocked',
      });
    } catch (err) {
      throw new AuditTrailError(`Dừng an toàn: không ghi được audit từ chối (${errorMessage(err)})`);
    }

    trace(ctx, {
      node: 'sales_agent',
      assigned_agent: 'sales',
      authz_decision: { layer: 'TOOL', effect: 'DENY', reason },
      error: reason,
    });
  };

  const call = <T>(
    ctx: AuthContext,
    server: string,
    tool: string,
    args: Record<string, unknown>,
  ): Promise<McpCallResult<T>> => deps.mcp.call<T>(ctx, server, tool, args);

  const runner: AgentRunner = async (ctx, subtask) => {
    if (!ctx?.userId || !ctx?.tenantId || !ctx?.department) {
      throw new Error('sales_agent: thiếu actor đã xác thực');
    }

    await recordSkillCall(ctx);

    const inputs = (subtask.inputs || {}) as unknown as SalesQuoteRequest;
    if (!isRecord(inputs.customer) || !String(inputs.customer.name || '').trim()) {
      throw new Error('sales_agent: thiếu inputs.customer.name');
    }
    if (!Array.isArray(inputs.lines) || inputs.lines.length === 0) {
      throw new Error('sales_agent: thiếu inputs.lines');
    }

    const baseResult = (
      status: SalesAgentResult['status'],
      extra: Partial<SalesAgentResult> = {},
    ): SalesAgentResult => ({
      status,
      quote: null,
      validation: null,
      customer: null,
      candidates: [],
      gateId: null,
      sheet: null,
      draft: null,
      issues: [],
      skill: { ...skillRef },
      runId: ctx.runId,
      ...extra,
    });

    // ── 1. Nội dung email khách gửi: đọc (nếu có id) rồi quét TRƯỚC mọi thao tác ghi.
    let inboundContent = '';
    if (inputs.emailId) {
      const email = await call<{ status: string; email: { subject?: string; body?: string } }>(
        ctx,
        'mail-mcp',
        'mail.read_email',
        { id: String(inputs.emailId) },
      );
      inboundContent = String(email.data?.email?.body || '');
    }
    if (inputs.emailBody) inboundContent = String(inputs.emailBody);
    if (inputs.email?.body) inboundContent = `${inboundContent}\n${String(inputs.email.body)}`;

    if (inboundContent.trim()) {
      try {
        await guardUntrustedContent(
          ctx,
          {
            content: inboundContent,
            agentName: 'sales',
            toolName: 'mail.read_email',
            resource: 'sales.mail',
            node: 'sales_agent',
          },
          { auditAgentEvent: deps.auditAgentEvent, traceEvent: deps.traceEvent },
        );
      } catch (err) {
        if (err instanceof PromptInjectionError) {
          const issues: QuoteIssue[] = err.signals.map((signal) => ({
            code: 'PROMPT_INJECTION_DETECTED',
            detail: signal,
          }));
          trace(ctx, {
            node: 'sales_agent',
            assigned_agent: 'sales',
            authz_decision: { layer: 'TOOL', effect: 'DENY', reason: err.code },
            error: err.code,
          });
          return baseResult('PROMPT_INJECTION_DETECTED', { issues });
        }
        throw err;
      }
    }

    // ── 2. CRM: tra cứu rồi upsert chống trùng (server quyết định tạo/cập nhật).
    const customerInput = inputs.customer as CustomerInput;
    await call(ctx, 'crm-mcp', 'crm.search_customer', {
      query: customerInput.phone || customerInput.email || customerInput.name,
      phone: customerInput.phone,
      email: customerInput.email,
      limit: 10,
    });

    const upsert = await call<CustomerUpsertResult>(ctx, 'crm-mcp', 'crm.upsert_customer', {
      customer: customerInput,
      actorRole: ctx.role,
    });

    if (upsert.data?.status === 'CUSTOMER_AMBIGUOUS') {
      await recordDenial(ctx, 'customer_ambiguous', [
        { code: 'CUSTOMER_AMBIGUOUS', detail: 'trùng tên gần giống — cần người dùng xác nhận' },
      ]);
      return baseResult('CUSTOMER_AMBIGUOUS', {
        customer: toCustomer(upsert.data.customer),
        candidates: Array.isArray(upsert.data.candidates) ? upsert.data.candidates : [],
        issues: [{ code: 'CUSTOMER_AMBIGUOUS' }],
      });
    }

    const customer = toCustomer(upsert.data?.customer);
    if (!customer?.id) {
      throw new Error('sales_agent: crm.upsert_customer không trả customer.id');
    }

    // ── 3. Bảng giá CHUẨN từ sheets-mcp. Không lấy giá từ nội dung khách gửi.
    const priceRes = await call<{ status: string; priceList: PriceList }>(
      ctx,
      'sheets-mcp',
      'sheets.read_price_list',
      { priceListId: inputs.priceListId },
    );
    const priceList = priceRes.data?.priceList;
    if (!priceList || !Array.isArray(priceList.items)) {
      throw new Error('sales_agent: sheets.read_price_list trả bảng giá không hợp lệ');
    }

    // ── 4. Tính tiền 100% tất định + validator độc lập.
    let quote: SalesQuote;
    let validation: QuoteValidation;
    try {
      quote = computeQuote(
        {
          lines: inputs.lines,
          discountPercent: inputs.discountPercent ?? 0,
          vatRate: inputs.vatRate,
          quoteNumber: inputs.quoteNumber ?? null,
        },
        priceList.items,
      );
      validation = assertQuoteMath(quote, priceList.items);
    } catch (err) {
      const issue: QuoteIssue = err instanceof PricingError
        ? { code: err.code, detail: err.message }
        : { code: 'QUOTE_MATH_MISMATCH', detail: errorMessage(err) };
      await recordDenial(ctx, issue.code, [issue]);
      return baseResult('BLOCKED', {
        customer,
        validation: err instanceof PricingError
          ? { valid: false, code: err.code, issues: err.issues }
          : { valid: false, code: 'QUOTE_MATH_MISMATCH', issues: [issue] },
        issues: [issue],
      });
    }

    // ── 5. Cập nhật deal CRM (nếu có). Không có tool xoá deal.
    // `value` là trường tài chính: CASHIER không được đổi (crm-mcp từ chối
    // `FORBIDDEN_FIELD`), nên chỉ gửi `nextStep` cho vai trò này.
    if (inputs.dealId) {
      const dealPatch: Record<string, unknown> = {
        nextStep: `Báo giá ${quote.quoteNumber || ''}`.trim(),
      };
      if (String(ctx.role || '').toUpperCase() !== 'CASHIER') {
        dealPatch.value = quote.totalAmount;
      }
      await call(ctx, 'crm-mcp', 'crm.update_deal', {
        dealId: String(inputs.dealId),
        actorRole: ctx.role,
        patch: dealPatch,
      });
    }

    // ── 6. Vượt hạn mức ⇒ gate PENDING + interrupt, CHƯA tạo nháp.
    let gateId: string | null = null;
    if (quote.discountPercent > threshold) {
      const gate = await requestHumanApproval(
        ctx,
        {
          id: subtask.id,
          requiresApproval: {
            actionType: 'QUOTE_DISCOUNT_APPROVAL',
            summary: `Chiết khấu ${quote.discountPercent}% (${formatVnd(quote.discountAmount)}) cho ${customer.name} vượt hạn mức ${threshold}%`,
            amount: quote.discountAmount,
            details: {
              quoteNumber: quote.quoteNumber,
              customerId: customer.id,
              customerName: customer.name,
              dealId: inputs.dealId ? String(inputs.dealId) : null,
              discountPercent: quote.discountPercent,
              discountAmount: quote.discountAmount,
              totalAmount: quote.totalAmount,
              quote,
              skill: { ...skillRef },
            },
          },
        },
        deps.gate,
        trace,
      );
      gateId = gate.id;

      let gateState = await deps.gate.getGate(gate.id);

      if (gateState.status === 'PENDING') {
        trace(ctx, {
          node: 'sales_agent',
          assigned_agent: 'sales',
          skill_call: { ...skillRef },
          approval_decision: 'PENDING',
        });

        // Dừng đồ thị — LangGraph lưu checkpoint. KHÔNG bắt tín hiệu này.
        interrupt({
          gateId: gate.id,
          subtaskId: subtask.id,
          actionType: gateState.actionType || 'QUOTE_DISCOUNT_APPROVAL',
          summary: gateState.actionSummary,
          amount: quote.discountAmount,
          discountPercent: quote.discountPercent,
        });

        // Chạy lại sau resume: `resumePayload` không được tin, hỏi ERP.
        gateState = await deps.gate.getGate(gate.id);
      }

      if (gateState.status !== 'APPROVED') {
        trace(ctx, {
          node: 'sales_agent',
          assigned_agent: 'sales',
          approval_decision: gateState.status,
        });
        return baseResult('REJECTED', {
          quote,
          validation,
          customer,
          gateId,
        });
      }

      try {
        await audit({
          runId: ctx.runId,
          decision: 'ALLOW',
          agentName: 'sales',
          toolName: 'sales.quote',
          resource: 'sales.quote',
          reason: 'quote_discount_approved',
          department: ctx.department,
          skillName: manifest.name,
          skillVersion: manifest.version,
          node: 'sales_agent',
          approvalDecision: 'APPROVED',
          params: {
            gateId,
            quoteNumber: quote.quoteNumber,
            discountPercent: quote.discountPercent,
          },
          resultSummary: 'quote_discount_approved',
        });
      } catch (err) {
        throw new AuditTrailError(
          `Dừng an toàn: không ghi được audit chốt báo giá (${errorMessage(err)})`,
        );
      }
    }

    // ── 7. Xuất file báo giá qua sheets-mcp (allowlist data/quotes/).
    const sheetRes = await call<SalesQuoteSheet>(
      ctx,
      'sheets-mcp',
      'sheets.generate_quote_sheet',
      {
        lines: quote.lines.map((line) => ({ sku: line.sku, qty: line.qty })),
        discountPercent: quote.discountPercent,
        vatRate: quote.vatRate,
        quoteNumber: quote.quoteNumber,
        priceListId: inputs.priceListId,
      },
    );
    const sheet = sheetRes.data;
    if (!sheet || sheet.status !== 'GENERATED') {
      throw new Error('sales_agent: sheets.generate_quote_sheet không tạo được báo giá');
    }

    // ── 8. Thư nháp qua mail-mcp. Không có tool gửi.
    const recipient = String(inputs.email?.to || customer.email || '').trim();
    if (!recipient) {
      await recordDenial(ctx, 'RECIPIENT_MISSING', [{ code: 'RECIPIENT_MISSING' }]);
      return baseResult('BLOCKED', {
        quote,
        validation,
        customer,
        gateId,
        sheet,
        issues: [{ code: 'RECIPIENT_MISSING' }],
      });
    }

    const draftBody = [
      `Kính gửi ${customer.name},`,
      '',
      `Công ty chúng tôi gửi báo giá ${quote.quoteNumber || '(nháp)'}:`,
      ...quote.lines.map(
        (line) => `- ${line.name} (${line.sku}) × ${line.qty}: ${formatVnd(line.lineTotal)}`,
      ),
      '',
      `Tạm tính: ${formatVnd(quote.subtotal)}`,
      `Chiết khấu: ${quote.discountPercent}% = ${formatVnd(quote.discountAmount)}`,
      `VAT: ${(quote.vatRate * 100).toFixed(2)}% = ${formatVnd(quote.vatAmount)}`,
      `Tổng cộng: ${formatVnd(quote.totalAmount)}`,
      '',
      'Trân trọng.',
    ].join('\n');

    const draftRes = await call<{ status: string; sent: boolean; draft: SalesEmailDraft }>(
      ctx,
      'mail-mcp',
      'mail.create_draft',
      {
        to: recipient,
        subject: String(inputs.email?.subject || `Báo giá ${quote.quoteNumber || ''} - ${customer.name}`).trim(),
        body: draftBody,
        dealId: inputs.dealId ? String(inputs.dealId) : undefined,
        customerId: customer.id,
        quoteId: quote.quoteNumber || undefined,
      },
    );

    const draft = draftRes.data?.draft;
    if (!draft || draft.status !== 'DRAFT' || draft.sent !== false) {
      throw new Error('sales_agent: mail.create_draft trả trạng thái không phải DRAFT');
    }

    trace(ctx, {
      node: 'sales_agent',
      assigned_agent: 'sales',
      skill_call: { ...skillRef },
      tool_call: {
        name: 'mail.create_draft',
        params: { to: recipient, quoteNumber: quote.quoteNumber },
        result_summary: `draft:${draft.id || 'unknown'}`,
        duration_ms: 0,
      },
      approval_decision: gateId ? 'APPROVED' : null,
    });

    return {
      status: 'DRAFT_CREATED',
      quote,
      validation,
      customer,
      candidates: [],
      gateId,
      sheet,
      draft,
      issues: [],
      skill: { ...skillRef },
      runId: ctx.runId,
    } satisfies SalesAgentResult;
  };

  return runner;
};

/** Alias đặt tên theo orchestrator (`create<Agent>Runner`). */
export const createSalesRunner = createSalesAgent;

/** Kiểu subtask tối thiểu mà runner cần — export để test dựng fixture. */
export type SalesSubtask = Pick<OpsSubtask, 'id' | 'inputs'>;
