/**
 * agents/src/memory/compaction.ts — compaction 5 mục (UC-007).
 *
 * Luật thật nằm ở `src/modules/agent-gateway/memory-compaction.js` (dùng chung
 * với route `PUT /sessions/:id/checkpoint-summary`). Tệp này chỉ bọc kiểu và
 * đặt tên API cho package agent.
 */

export interface OpenGateRef {
  gateId?: string;
  poNumber?: string;
  invoiceNumber?: string;
  quoteNumber?: string;
  actionType?: string;
  summary?: string;
  status?: string;
  [key: string]: unknown;
}

export interface CompletedWorkItem {
  step: string;
  result: string;
  [key: string]: unknown;
}

export interface OpenItemsAndNextSteps {
  open_items: string[];
  next_steps: string[];
  open_gates: OpenGateRef[];
  [key: string]: unknown;
}

export interface StructuredCheckpoint {
  goal: string;
  constraints: string[];
  completed_work: Array<CompletedWorkItem | string>;
  current_state: string;
  open_items_and_next_steps: OpenItemsAndNextSteps;
  metadata?: Record<string, unknown>;
}

export interface CompactionMessage {
  role?: string;
  content?: string;
  toolName?: string;
  name?: string;
  toolResult?: string;
  status?: string;
  openGates?: OpenGateRef[];
  constraints?: string[];
  [key: string]: unknown;
}

export interface CompactionInput {
  messages?: CompactionMessage[];
  goal?: string;
  constraints?: string[];
  completedWork?: Array<CompletedWorkItem | string>;
  currentState?: string;
  openItems?: string[];
  nextSteps?: string[];
  openGates?: OpenGateRef[];
  tokenBudget?: number;
  currentTokens?: number;
}

export interface CompactionValidation {
  valid: boolean;
  errors: string[];
  missingSections: string[];
  missingGateIds: string[];
  missingIdentifiers: Array<{ field: string; value: string }>;
}

export interface ExpectedGates {
  openGates?: OpenGateRef[];
  gateIds?: string[];
  open_gates?: OpenGateRef[];
}

interface CompactionCore {
  CHECKPOINT_SECTIONS: readonly string[];
  IDENTIFIER_FIELDS: readonly string[];
  shouldCompact(input: Record<string, unknown>): boolean;
  compactConversation(input: CompactionInput): StructuredCheckpoint;
  validateCompactionSummary(
    summary: unknown,
    expected?: OpenGateRef[] | ExpectedGates | null,
  ): CompactionValidation;
  assertValidCompactionSummary(
    summary: unknown,
    expected?: OpenGateRef[] | ExpectedGates | null,
  ): StructuredCheckpoint;
  mergeOpenGates(...lists: unknown[]): OpenGateRef[];
  extractOpenGatesFromMessages(messages: CompactionMessage[]): OpenGateRef[];
}

// eslint-disable-next-line @typescript-eslint/no-var-requires
const core = require('../../../src/modules/agent-gateway/memory-compaction') as CompactionCore;

export const CHECKPOINT_SECTIONS = core.CHECKPOINT_SECTIONS;
export const IDENTIFIER_FIELDS = core.IDENTIFIER_FIELDS;

/** Ngưỡng mặc định 75% budget (khoảng 70–80%). */
export const shouldCompact = (input: {
  tokenBudget?: number;
  currentTokens?: number;
  maxTurns?: number;
  turnCount?: number;
  threshold?: number;
}): boolean => core.shouldCompact(input as Record<string, unknown>);

/** Nén hội thoại thành checkpoint đủ 5 mục; KHÔNG làm rơi `open_gates`. */
export const compactConversation = (input: CompactionInput = {}): StructuredCheckpoint =>
  core.compactConversation(input);

/** Kiểm 5 mục + bảo toàn 100% gate/mã chứng từ server biết. */
export const validateCompactionSummary = (
  summary: unknown,
  expected?: OpenGateRef[] | ExpectedGates | null,
): CompactionValidation => core.validateCompactionSummary(summary, expected);

/** Ném lỗi `COMPACTION_INCOMPLETE` khi checkpoint không hợp lệ. */
export const assertValidCompactionSummary = (
  summary: unknown,
  expected?: OpenGateRef[] | ExpectedGates | null,
): StructuredCheckpoint => core.assertValidCompactionSummary(summary, expected);

export const mergeOpenGates = (...lists: unknown[]): OpenGateRef[] =>
  core.mergeOpenGates(...lists);

export const extractOpenGatesFromMessages = (
  messages: CompactionMessage[],
): OpenGateRef[] => core.extractOpenGatesFromMessages(messages);
