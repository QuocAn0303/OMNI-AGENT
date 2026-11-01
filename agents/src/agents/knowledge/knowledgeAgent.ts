/**
 * agents/knowledge/knowledgeAgent.ts — UC-002: hỏi đáp SOP có trích dẫn, có ACL.
 *
 * ============================================================================
 * BA ĐIỀU KHÔNG ĐƯỢC LÀM SAI
 * ============================================================================
 * 1. KHÔNG tự trả lời khi không có chunk. "Không tìm thấy quy định" + gợi ý
 *    phòng ban là câu trả lời đúng; dùng kiến thức chung để đoán một hạn mức
 *    tiền là loại lỗi gây thiệt hại thật.
 * 2. KHÔNG lọc tài liệu ở đây. ACL và hiệu lực phiên bản đã nằm trong `WHERE`
 *    của `kb/search` theo actor gốc; agent chỉ nhận tập đã lọc. Thêm một lớp lọc
 *    phía client nghe thì an toàn nhưng che mất việc server lọc sai.
 * 3. KHÔNG trả câu trả lời khi `validateCitations` thất bại — bác toàn bộ.
 *
 * Mọi lời gọi tool đi qua `withToolGuard` (tầng 2): `authorizeTool` theo actor
 * gốc, audit fail-closed trước khi chạy, `fieldProjection` trên kết quả.
 */
import type { AuthContext } from '../../contracts/types';
import type { OpsSubtask } from '../../orchestrator/state';
import type { KbChunkResult, KbSearchResult, KbService } from '../../erp/erpClient';
import { ToolDeniedError, withToolGuard } from '../../policy/toolWrapper';
import { traceEvent, type TraceEventInput } from '../../telemetry/auditAndTrace';
import type { AuditEventPayload, AuditEventResult } from '../../erp/erpClient';
import {
  normalizeText,
  validateCitations,
  type Citation,
  type RetrievedChunk,
} from './citationValidator';

export type KnowledgeStatus = 'ANSWERED' | 'NO_ANSWER' | 'DENIED';

export interface KnowledgeAnswer {
  status: KnowledgeStatus;
  answer: string;
  citations: Citation[];
  /** Phòng ban nên liên hệ khi không có câu trả lời (luôn có, kể cả khi ANSWERED). */
  suggestions: string[];
  /** Mã lý do — KHÔNG chứa dữ liệu nghiệp vụ. */
  reason: string | null;
  chunks: KbChunkResult[];
  runId: string;
}

/**
 * Runner có kiểu trả về rõ ràng (vẫn gán được vào `AgentRunner`).
 *
 * Giữ `KnowledgeAnswer` thay vì `unknown` để orchestrator/test đọc được `status`
 * mà không phải ép kiểu — ép kiểu ở đây sẽ che mất việc agent trả sai hình dạng.
 */
export type KnowledgeRunner = (
  ctx: AuthContext,
  subtask: OpsSubtask,
) => Promise<KnowledgeAnswer>;

/** Sinh câu trả lời + trích dẫn từ tập chunk đã truy xuất (thay được trong test). */
export type AnswerSynthesizer = (
  ctx: AuthContext,
  question: string,
  chunks: KbChunkResult[],
) => { answer: string; citations: Citation[] };

export interface KnowledgeAgentDeps {
  /** Bắt buộc khi chạy thật; `undefined` ⇒ subtask báo lỗi cấu hình rõ ràng. */
  erp?: KbService;
  /** Ngưỡng liên quan tối thiểu; dưới ngưỡng ⇒ NO_ANSWER. */
  minScore?: number;
  synthesizer?: AnswerSynthesizer;
  traceEvent?: (ctx: AuthContext, partial: TraceEventInput) => unknown;
  auditAgentEvent?: (event: AuditEventPayload) => Promise<AuditEventResult>;
}

const DEFAULT_MIN_SCORE = 0.5;

/** Gợi ý phòng ban phụ trách — tất định, theo từ khoá đã chuẩn hoá dấu. */
const DEPARTMENT_HINTS: Array<{ department: string; keywords: string[] }> = [
  {
    department: 'HR',
    keywords: ['luong', 'nhan su', 'nghi phep', 'cham cong', 'tuyen dung', 'bao hiem', 'hop dong lao dong'],
  },
  {
    department: 'FINANCE',
    keywords: ['chi phi', 'thanh toan', 'hoa don', 'cong tac phi', 'ngan sach', 'thue', 'ke toan', 'tam ung'],
  },
  {
    department: 'SALES',
    keywords: ['bao gia', 'chiet khau', 'khach hang', 'ban hang', 'don hang', 'hoa hong'],
  },
  {
    department: 'OPS',
    keywords: ['quy trinh', 'van hanh', 'kho', 'ton kho', 'giao hang', 'kiem ke'],
  },
];

/** Luôn trả đủ 4 phòng ban, phòng đoán trước — người hỏi không bị bỏ rơi. */
export const suggestDepartments = (question: string): string[] => {
  const normalized = normalizeText(question);
  const primary = DEPARTMENT_HINTS.find((hint) =>
    hint.keywords.some((keyword) => normalized.includes(keyword)))?.department;
  const all = DEPARTMENT_HINTS.map((hint) => hint.department);
  return primary ? [primary, ...all.filter((dept) => dept !== primary)] : all;
};

export const buildNoAnswer = (suggestions: string[]): string =>
  'Tôi không tìm thấy quy định nội bộ nào trong kho SOP trả lời câu hỏi này, '
  + 'nên tôi không tự suy đoán để tránh cung cấp thông tin sai. '
  + `Vui lòng liên hệ phòng ban phụ trách để xác nhận: ${suggestions.join(', ')}.`;

const toRetrieved = (chunk: KbChunkResult): RetrievedChunk => ({
  docCode: chunk.docCode,
  version: chunk.version,
  sectionHeading: chunk.sectionHeading,
  content: chunk.content,
});

/**
 * Trích một DÒNG có thật trong chunk (không cắt giữa từ) để làm `quote`.
 *
 * Ưu tiên dòng chứa từ khoá của câu hỏi; bỏ dòng tiêu đề/bảng để câu trả lời đọc
 * được, nhưng dòng được chọn vẫn là chuỗi con nguyên vẹn của chunk.
 */
const pickQuote = (chunk: KbChunkResult, tokens: string[]): string => {
  const lines = String(chunk.content ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#') && !line.startsWith('```'));

  const prose = lines.filter((line) => !line.startsWith('|'));
  const containing = prose.find((line) => {
    const normalized = normalizeText(line);
    return tokens.some((token) => normalized.includes(token));
  });

  return containing || prose[0] || lines[0] || String(chunk.content ?? '').trim();
};

const defaultSynthesizer: AnswerSynthesizer = (_ctx, question, chunks) => {
  const tokens = normalizeText(question).split(' ').filter((token) => token.length >= 2);

  const citations: Citation[] = chunks.map((chunk) => ({
    docCode: chunk.docCode,
    version: chunk.version,
    sectionHeading: chunk.sectionHeading,
    quote: pickQuote(chunk, tokens),
  }));

  const answer = citations
    .map((citation, index) => {
      const source = `${citation.docCode} v${citation.version} — ${citation.sectionHeading}`;
      const body = citation.quote;
      return `${index + 1}. Theo ${source}: ${body}`;
    })
    .join('\n\n');

  return { answer, citations };
};

/**
 * Runner cho `targetAgent === 'knowledge'`.
 *
 * Trả `KnowledgeAnswer` (không ném) cho các trường hợp nghiệp vụ: không có kết
 * quả, dưới ngưỡng, trích dẫn không hợp lệ, bị từ chối quyền. Chỉ NÉM khi lỗi hạ
 * tầng (audit fail-closed, mạng) — những lỗi đó phải nổi lên orchestrator.
 */
export const createKnowledgeRunner = (deps: KnowledgeAgentDeps): KnowledgeRunner => {
  const minScore = typeof deps.minScore === 'number' ? deps.minScore : DEFAULT_MIN_SCORE;
  const trace = deps.traceEvent ?? traceEvent;
  const synthesize = deps.synthesizer ?? defaultSynthesizer;

  type KbSearchArgs = { query: string; asOf?: string | null; topK?: number };

  const guardedSearch = withToolGuard<KbSearchArgs, KbSearchResult>(
    {
      name: 'kb.search',
      agentName: 'knowledge',
      resource: 'sop',
      action: 'read',
      node: 'knowledge_agent',
    },
    async (_ctx, args) => {
      if (!deps.erp) throw new Error('kb_not_configured: thiếu KbService để tra cứu SOP');
      return deps.erp.searchKb({
        query: args.query,
        asOf: args.asOf ?? null,
        topK: args.topK ?? 5,
      });
    },
    { auditAgentEvent: deps.auditAgentEvent, traceEvent: deps.traceEvent },
  );

  return async (ctx, subtask): Promise<KnowledgeAnswer> => {
    const inputs = subtask.inputs || {};
    const question = String(inputs.query ?? inputs.question ?? subtask.action ?? '').trim();
    const suggestions = suggestDepartments(question);

    const noAnswer = (reason: string, extra: Partial<KnowledgeAnswer> = {}): KnowledgeAnswer => ({
      status: 'NO_ANSWER',
      answer: buildNoAnswer(suggestions),
      citations: [],
      suggestions,
      reason,
      chunks: [],
      runId: ctx.runId,
      ...extra,
    });

    let result: KbSearchResult;
    try {
      result = await guardedSearch(ctx, {
        query: question,
        asOf: inputs.asOf === undefined ? null : (inputs.asOf as string | null),
        topK: typeof inputs.topK === 'number' ? inputs.topK : 5,
      });
    } catch (err) {
      // Từ chối quyền là kết quả nghiệp vụ, không phải sự cố — nhưng KHÔNG lộ dữ liệu.
      if (err instanceof ToolDeniedError) {
        trace(ctx, {
          node: 'knowledge_agent',
          assigned_agent: 'knowledge',
          error: `tool_denied:${err.code}`,
        });
        return {
          status: 'DENIED',
          answer: 'Bạn không có quyền tra cứu nội dung này. Vui lòng liên hệ quản trị viên.',
          citations: [],
          suggestions,
          reason: err.code,
          chunks: [],
          runId: ctx.runId,
        };
      }
      throw err;
    }

    const chunks = Array.isArray(result?.chunks) ? result.chunks : [];
    const relevant = chunks.filter((chunk) => Number(chunk.score) >= minScore);

    if (relevant.length === 0) {
      trace(ctx, {
        node: 'knowledge_agent',
        assigned_agent: 'knowledge',
        tool_call: {
          name: 'kb.search',
          params: { query: question, asOf: inputs.asOf ?? null },
          result_summary: 'no_relevant_chunk',
          duration_ms: null,
        },
      });
      return noAnswer(chunks.length === 0 ? 'no_chunk_retrieved' : 'below_relevance_threshold');
    }

    const draft = synthesize(ctx, question, relevant);
    const validation = validateCitations(draft.citations, relevant.map(toRetrieved));

    if (!validation.valid) {
      // Câu trả lời đã dựa trên trích dẫn bịa ⇒ bỏ TOÀN BỘ, không "sửa" lại.
      trace(ctx, {
        node: 'knowledge_agent',
        assigned_agent: 'knowledge',
        error: `citation_invalid:${validation.errors.join(',')}`,
      });
      return noAnswer('citation_validation_failed');
    }

    return {
      status: 'ANSWERED',
      answer: draft.answer,
      citations: validation.citations,
      suggestions,
      reason: null,
      chunks: relevant,
      runId: ctx.runId,
    };
  };
};
