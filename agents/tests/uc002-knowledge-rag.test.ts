/**
 * tests/uc002-knowledge-rag.test.ts — Sáu bài kiểm chứng UC-002 (SOP/KB).
 *
 * Mỗi bài khoá một lỗi có thật:
 *   1. Cắt chunk giữa bảng ⇒ trích dẫn sai nghĩa; ingest chạy lại sinh bản trùng.
 *   2. Lọc tài liệu SAU khi lấy về ⇒ tài liệu HR confidential lọt vào context.
 *   3. Trộn phiên bản ⇒ trả hạn mức 5 triệu của 2025 cho câu hỏi hiện hành.
 *   4. Tin trích dẫn do model sinh ⇒ câu trả lời có nguồn bịa.
 *   5. Không có dữ liệu mà vẫn trả lời ⇒ bịa quy định.
 *   6. Agent knowledge không chạy được qua đồ thị ⇒ tính năng chỉ là thư viện rời.
 *
 * Chạy: `cd agents && npm test`
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

import { MemorySaver } from '@langchain/langgraph';

import type { AuthContext } from '../src/contracts/types';
import type { AuditEventPayload, KbSearchInput, KbSearchResult, KbService } from '../src/erp/erpClient';
import { chunkSopMarkdown } from '../src/agents/knowledge/chunker';
import { normalizeText, validateCitations } from '../src/agents/knowledge/citationValidator';
import { createKnowledgeRunner } from '../src/agents/knowledge/knowledgeAgent';
import { createOrchestrator } from '../src/orchestrator/graph';
import type { OpsRequest, OpsSubtask } from '../src/orchestrator/state';
import { readTraceLines, traceEvent } from '../src/telemetry/auditAndTrace';

const TRACE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aduu-knowledge-traces-'));
process.env.AGENT_TRACE_DIR = TRACE_ROOT;

afterAll(() => {
  fs.rmSync(TRACE_ROOT, { recursive: true, force: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tiện ích
// ─────────────────────────────────────────────────────────────────────────────

const makeCtx = (overrides: Partial<AuthContext> = {}): AuthContext => ({
  userId: 'u-knowledge-1',
  tenantId: 'tenant-1',
  department: 'SALES',
  role: 'CASHIER',
  managerId: null,
  scopes: ['agent:handoff'],
  runId: 'run-uc002-1',
  ...overrides,
});

const makeSubtask = (inputs: Record<string, unknown>): OpsSubtask => ({
  id: 'T1',
  department: 'HR',
  targetAgent: 'knowledge',
  action: 'kb.search',
  depends_on: [],
  inputs,
  requiresApproval: null,
});

let auditSeq = 0;
const auditOk = async (_event: AuditEventPayload): Promise<{ id: string }> => {
  auditSeq += 1;
  return { id: `audit-${auditSeq}` };
};

const noopTrace = (): undefined => undefined;

interface FakeSopDoc {
  docCode: string;
  version: string;
  department: string;
  accessLevel: string;
  sectionHeading: string;
  content: string;
  effectiveDate: string;
  supersededAt: string | null;
  chunkIndex: number;
}

const FULL_ACCESS_ROLES = new Set(['SUPER_OMEGA_ULTRA_ADMIN', 'SUPER_ADMIN', 'ADMIN']);

/** Chấm điểm giống server: khớp từ trên tiêu đề mục nặng hơn trong nội dung. */
const scoreChunk = (doc: FakeSopDoc, tokens: string[]): number => {
  const heading = normalizeText(doc.sectionHeading);
  const body = normalizeText(doc.content);
  const code = normalizeText(doc.docCode);

  const count = (text: string, token: string): number =>
    text.split(' ').filter((word) => word === token).length;

  let raw = 0;
  for (const token of tokens) {
    const inHeading = count(heading, token);
    const inBody = count(body, token);
    const inCode = count(code, token);
    if (inHeading + inBody + inCode === 0) continue;
    raw += inHeading * 3 + Math.min(inBody, 5) + inCode * 2;
  }
  if (raw === 0) return 0;
  return Number((raw / Math.sqrt(1 + body.split(' ').length / 120)).toFixed(6));
};

/**
 * KB giả mô phỏng ĐÚNG mệnh đề WHERE của server: tenant + ACL + hiệu lực phiên
 * bản lọc trước, rồi mới xếp hạng. Nếu server lọc sai, test ACL ở đây vẫn xanh —
 * nên phần ACL thật còn được kiểm bằng `check:agent-gateway` trên DB thật.
 */
const createFakeKb = (docs: FakeSopDoc[]) => {
  const state = { actor: null as AuthContext | null, calls: [] as Array<Record<string, unknown>> };

  const service: KbService = {
    async searchKb(input: KbSearchInput): Promise<KbSearchResult> {
      const actor = state.actor;
      if (!actor) throw new Error('fake kb: chưa setActor');
      state.calls.push({ ...input });

      const asOf = input.asOf ? new Date(input.asOf) : new Date('2026-10-31T00:00:00.000Z');
      const role = actor.role;
      const dept = actor.department;
      const fullAccess = FULL_ACCESS_ROLES.has(role) || dept === 'EXEC';

      const visible = docs.filter((doc) => {
        const effective = new Date(doc.effectiveDate);
        if (effective > asOf) return false;
        const stillValid = doc.supersededAt === null || new Date(doc.supersededAt) > asOf;
        if (!stillValid) return false;

        if (fullAccess) return true;
        if (doc.accessLevel === 'public' || doc.accessLevel === 'internal') return true;
        const scopedLevel = doc.accessLevel === 'department_only'
          || (doc.accessLevel === 'manager_only' && role === 'MANAGER');
        return scopedLevel && (doc.department === dept || doc.department === 'COMPANY');
      });

      const tokens = normalizeText(input.query)
        .split(' ')
        .filter((token) => token.length >= 2);

      const scored = visible
        .map((doc) => ({ doc, score: scoreChunk(doc, tokens) }))
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score);

      const topK = input.topK ?? 5;

      return {
        query: input.query,
        asOf: asOf.toISOString(),
        includeHistorical: Boolean(input.includeHistorical),
        topK,
        total: scored.length,
        chunks: scored.slice(0, topK).map(({ doc, score }) => ({
          docCode: doc.docCode,
          title: doc.docCode,
          version: doc.version,
          department: doc.department,
          accessLevel: doc.accessLevel,
          sectionHeading: doc.sectionHeading,
          chunkIndex: doc.chunkIndex,
          content: doc.content,
          effectiveDate: doc.effectiveDate,
          supersededAt: doc.supersededAt,
          score,
        })),
      };
    },
  };

  return {
    service,
    calls: state.calls,
    setActor: (actor: AuthContext): void => {
      state.actor = actor;
    },
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// 1. Chunking theo mục + ingest idempotent
// ─────────────────────────────────────────────────────────────────────────────

test('1. Chunk theo mục/điều khoản giữ tiêu đề + bảng Markdown; ingest 2 lần không nhân bản', () => {
  const markdown = [
    '# Quy chế công tác phí',
    '',
    'Áp dụng cho toàn bộ nhân viên.',
    '',
    '## Điều 3. Hạn mức phê duyệt',
    '',
    '| Hạn mức | Người duyệt |',
    '| --- | --- |',
    '| Trên 50 triệu | Giám đốc |',
    '',
    '```bash',
    '# đây là comment trong khối code, KHÔNG phải mục',
    'echo ok',
    '```',
    '',
    '### Mục 4. Hồ sơ thanh toán',
    '',
    '- Hóa đơn gốc',
  ].join('\n');

  const chunks = chunkSopMarkdown(markdown);

  expect(chunks.map((chunk) => chunk.sectionHeading)).toEqual([
    'Quy chế công tác phí',
    'Điều 3. Hạn mức phê duyệt',
    'Mục 4. Hồ sơ thanh toán',
  ]);

  // Bảng + tiêu đề mục nằm TRONG chunk để trích dẫn tự đứng được.
  expect(chunks[1].content).toContain('Điều 3. Hạn mức phê duyệt');
  expect(chunks[1].content).toContain('| Trên 50 triệu | Giám đốc |');

  // `#` trong khối code không được sinh mục giả.
  expect(chunks.map((chunk) => chunk.content).join('\n')).toContain('echo ok');

  // Ingest idempotent: khoá `docCode@version#chunkIndex`.
  const store = new Map<string, string>();
  const ingest = (input: ReturnType<typeof chunkSopMarkdown>): void => {
    for (const chunk of input) {
      store.set(`tenant-1:SOP-FIN-001@1.0#${chunk.chunkIndex}`, chunk.content);
    }
  };

  ingest(chunks);
  const afterFirst = store.size;
  ingest(chunkSopMarkdown(markdown));

  expect(afterFirst).toBe(3);
  expect(store.size).toBe(afterFirst);
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. ACL trước khi retrieve
// ─────────────────────────────────────────────────────────────────────────────

const HR_SECRET = 'Quỹ lương thưởng mật của phòng HR là 900 triệu đồng.';

const aclDocs: FakeSopDoc[] = [
  {
    docCode: 'SOP-HR-009',
    version: '1.0',
    department: 'HR',
    accessLevel: 'confidential',
    sectionHeading: 'Điều 9. Quỹ lương thưởng',
    content: `# Điều 9. Quỹ lương thưởng\n${HR_SECRET}`,
    effectiveDate: '2026-01-01T00:00:00.000Z',
    supersededAt: null,
    chunkIndex: 0,
  },
  {
    docCode: 'SOP-HR-010',
    version: '1.0',
    department: 'HR',
    accessLevel: 'department_only',
    sectionHeading: 'Điều 10. Quỹ lương thưởng dự phòng',
    content: '# Điều 10. Quỹ lương thưởng dự phòng\nQuỹ lương thưởng dự phòng chỉ HR được xem.',
    effectiveDate: '2026-01-01T00:00:00.000Z',
    supersededAt: null,
    chunkIndex: 0,
  },
  {
    docCode: 'SOP-OPS-001',
    version: '1.0',
    department: 'OPS',
    accessLevel: 'public',
    sectionHeading: 'Điều 1. Kiểm kê kho',
    content: '# Điều 1. Kiểm kê kho\nKiểm kê kho định kỳ mỗi tháng.',
    effectiveDate: '2026-01-01T00:00:00.000Z',
    supersededAt: null,
    chunkIndex: 0,
  },
];

test('2. Nhân viên SALES không nhận chunk HR confidential/department_only (0 rò rỉ)', async () => {
  const kb = createFakeKb(aclDocs);
  const sales = makeCtx({ role: 'CASHIER', department: 'SALES' });
  kb.setActor(sales);

  const runner = createKnowledgeRunner({
    erp: kb.service,
    auditAgentEvent: auditOk,
    traceEvent: noopTrace,
  });

  const answer = await runner(sales, makeSubtask({ query: 'quỹ lương thưởng mật' }));

  expect(answer.status).toBe('NO_ANSWER');
  expect(answer.chunks).toHaveLength(0);
  expect(answer.reason).toBe('no_chunk_retrieved');
  expect(JSON.stringify(answer)).not.toContain('900 triệu');

  // Cùng câu hỏi, người có quyền (ADMIN/EXEC) vẫn đọc được — chứng minh bộ lọc
  // có mục tiêu, không phải "chặn tất cả".
  const admin = makeCtx({ role: 'ADMIN', department: 'EXEC', userId: 'u-admin' });
  kb.setActor(admin);
  const adminAnswer = await runner(admin, makeSubtask({ query: 'quỹ lương thưởng mật' }));

  expect(adminAnswer.status).toBe('ANSWERED');
  expect(adminAnswer.citations[0].docCode).toBe('SOP-HR-009');
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Kiểm soát phiên bản
// ─────────────────────────────────────────────────────────────────────────────

const versionDocs: FakeSopDoc[] = [
  {
    docCode: 'SOP-FIN-001',
    version: '1.0',
    department: 'FINANCE',
    accessLevel: 'internal',
    sectionHeading: 'Điều 3. Hạn mức công tác phí',
    content: '# Điều 3. Hạn mức công tác phí\nHạn mức công tác phí là 5 triệu đồng cho mỗi chuyến.',
    effectiveDate: '2025-01-01T00:00:00.000Z',
    supersededAt: '2026-01-01T00:00:00.000Z',
    chunkIndex: 0,
  },
  {
    docCode: 'SOP-FIN-001',
    version: '2.0',
    department: 'FINANCE',
    accessLevel: 'internal',
    sectionHeading: 'Điều 3. Hạn mức công tác phí',
    content: '# Điều 3. Hạn mức công tác phí\nHạn mức công tác phí là 10 triệu đồng cho mỗi chuyến.',
    effectiveDate: '2026-01-01T00:00:00.000Z',
    supersededAt: null,
    chunkIndex: 0,
  },
];

test('3. Hỏi hiện hành ra v2.0 (10 triệu); hỏi asOf 2025 ra v1.0 (5 triệu)', async () => {
  const kb = createFakeKb(versionDocs);
  const actor = makeCtx({ role: 'ACCOUNTANT', department: 'FINANCE' });
  kb.setActor(actor);

  const runner = createKnowledgeRunner({
    erp: kb.service,
    auditAgentEvent: auditOk,
    traceEvent: noopTrace,
  });

  const current = await runner(actor, makeSubtask({ query: 'hạn mức công tác phí' }));
  expect(current.status).toBe('ANSWERED');
  expect(current.answer).toContain('10 triệu');
  expect(current.answer).not.toContain('5 triệu');
  expect(current.citations[0]).toMatchObject({ docCode: 'SOP-FIN-001', version: '2.0' });

  const historical = await runner(
    actor,
    makeSubtask({ query: 'hạn mức công tác phí', asOf: '2025-06-01T00:00:00.000Z' }),
  );
  expect(historical.status).toBe('ANSWERED');
  expect(historical.answer).toContain('5 triệu');
  expect(historical.answer).not.toContain('10 triệu');
  expect(historical.citations[0]).toMatchObject({ docCode: 'SOP-FIN-001', version: '1.0' });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Citation validator
// ─────────────────────────────────────────────────────────────────────────────

test('4. Trích dẫn hợp lệ qua 100%; trích dẫn bịa bị bác 100%', async () => {
  const retrieved = [
    {
      docCode: 'SOP-FIN-001',
      version: '2.0',
      sectionHeading: 'Điều 3. Hạn mức công tác phí',
      content: '# Điều 3. Hạn mức công tác phí\nHạn mức công tác phí là 10 triệu đồng cho mỗi chuyến.',
    },
  ];

  const valid = validateCitations(
    [
      {
        docCode: 'SOP-FIN-001',
        version: '2.0',
        sectionHeading: 'điều 3 - hạn mức công tác phí',
        quote: 'Hạn mức công tác phí là 10 triệu đồng cho mỗi chuyến.',
      },
    ],
    retrieved,
  );
  expect(valid.valid).toBe(true);
  expect(valid.errors).toHaveLength(0);

  // Sai docCode.
  expect(validateCitations(
    [{ docCode: 'SOP-FIN-999', version: '2.0', sectionHeading: 'Điều 3', quote: 'Hạn mức công tác phí là 10 triệu đồng' }],
    retrieved,
  ).errors).toContain('doc_not_retrieved:SOP-FIN-999@2.0');

  // Sai tiêu đề mục.
  expect(validateCitations(
    [{ docCode: 'SOP-FIN-001', version: '2.0', sectionHeading: 'Điều 7. Không tồn tại', quote: 'Hạn mức công tác phí là 10 triệu đồng' }],
    retrieved,
  ).valid).toBe(false);

  // Quote không có trong chunk.
  const fabricatedQuote = validateCitations(
    [{ docCode: 'SOP-FIN-001', version: '2.0', sectionHeading: 'Điều 3. Hạn mức công tác phí', quote: 'Hạn mức là 500 triệu đồng' }],
    retrieved,
  );
  expect(fabricatedQuote.valid).toBe(false);
  expect(fabricatedQuote.errors[0]).toContain('quote_not_in_chunk');

  // Agent: synthesizer bịa nguồn ⇒ câu trả lời bị bác, không phải "sửa lại".
  const kb = createFakeKb(versionDocs);
  const actor = makeCtx({ role: 'ACCOUNTANT', department: 'FINANCE' });
  kb.setActor(actor);

  const malicious = createKnowledgeRunner({
    erp: kb.service,
    auditAgentEvent: auditOk,
    traceEvent: noopTrace,
    synthesizer: () => ({
      answer: 'Theo quy định, hạn mức là 500 triệu đồng.',
      citations: [
        {
          docCode: 'SOP-FIN-001',
          version: '2.0',
          sectionHeading: 'Điều 3. Hạn mức công tác phí',
          quote: 'Hạn mức là 500 triệu đồng',
        },
      ],
    }),
  });

  const rejected = await malicious(actor, makeSubtask({ query: 'hạn mức công tác phí' }));
  expect(rejected.status).toBe('NO_ANSWER');
  expect(rejected.reason).toBe('citation_validation_failed');
  expect(rejected.citations).toHaveLength(0);
  expect(rejected.answer).not.toContain('500 triệu');
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. NO_ANSWER + gợi ý phòng ban
// ─────────────────────────────────────────────────────────────────────────────

test('5. Không có trong kho SOP ⇒ NO_ANSWER kèm phòng ban phụ trách', async () => {
  const kb = createFakeKb([]);
  const actor = makeCtx({ role: 'CASHIER', department: 'SALES' });
  kb.setActor(actor);

  const runner = createKnowledgeRunner({
    erp: kb.service,
    auditAgentEvent: auditOk,
    traceEvent: noopTrace,
  });

  const answer = await runner(actor, makeSubtask({ query: 'quy định nghỉ phép năm' }));

  expect(answer.status).toBe('NO_ANSWER');
  expect(answer.suggestions[0]).toBe('HR');
  expect(answer.suggestions).toEqual(expect.arrayContaining(['HR', 'FINANCE', 'SALES', 'OPS']));
  expect(answer.answer).toContain('HR');
  expect(answer.answer).toContain('FINANCE');
  // Không được tự bịa con số/điều khoản nào.
  expect(answer.answer).not.toMatch(/\d+\s*(triệu|ngày)/);
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. E2E qua Orchestrator
// ─────────────────────────────────────────────────────────────────────────────

test('6. Orchestrator chạy knowledge thật: handoff → tool → aggregate, có audit + trace', async () => {
  const kb = createFakeKb(versionDocs);
  const actor = makeCtx({ role: 'CASHIER', department: 'SALES', runId: 'run-uc002-e2e' });
  kb.setActor(actor);

  const audits: AuditEventPayload[] = [];
  const audit = async (event: AuditEventPayload): Promise<{ id: string }> => {
    audits.push(event);
    return { id: `e2e-audit-${audits.length}` };
  };

  const request: OpsRequest = {
    intent: 'hỏi hạn mức công tác phí hiện hành',
    departments: ['FINANCE'],
    subtasks: [
      {
        id: 'T1',
        department: 'FINANCE',
        targetAgent: 'knowledge',
        action: 'kb.search',
        depends_on: [],
        inputs: { query: 'hạn mức công tác phí' },
        requiresApproval: null,
      },
    ],
    urgency: 'NORMAL',
    missing_info: [],
    route: 'EXECUTE',
  };

  const orchestrator = createOrchestrator({
    actor,
    kb: kb.service,
    auditAgentEvent: audit,
    traceEvent,
    checkpointer: new MemorySaver(),
  });

  const result = await orchestrator.run({ message: request.intent, opsRequest: request });
  const report = result.report;

  expect(report?.dagValid).toBe(true);
  expect(report?.completed).toHaveLength(1);
  expect(report?.denied_or_blocked).toHaveLength(0);

  const completed = report!.completed[0].result as { status: string; answer: string };
  expect(completed.status).toBe('ANSWERED');
  expect(completed.answer).toContain('10 triệu');

  // Handoff + tool call đều có audit; handoff cho knowledge được phép với SALES.
  const knowledgeAudits = audits.filter((event) => event.agentName === 'knowledge');
  expect(knowledgeAudits.length).toBeGreaterThanOrEqual(2);
  expect(knowledgeAudits.every((event) => event.decision === 'ALLOW')).toBe(true);

  // Trace JSONL đủ trường và có node giao việc cho knowledge.
  const lines = readTraceLines(actor.runId);
  expect(lines.length).toBeGreaterThan(0);
  expect(lines.some((line) => line.assigned_agent === 'knowledge')).toBe(true);
  expect(lines.some((line) => line.tool_call?.name === 'kb.search')).toBe(true);
  expect(lines.every((line) => line.actor.userId === actor.userId)).toBe(true);
});
