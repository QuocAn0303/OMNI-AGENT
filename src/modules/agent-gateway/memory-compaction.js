/**
 * modules/agent-gateway/memory-compaction.js — compaction 5 mục (UC-007).
 *
 * ============================================================================
 * CHECKPOINT PHẢI ĐỦ 5 MỤC, KHÔNG ĐƯỢC RƠI GATE
 * ============================================================================
 * Khi hội thoại dài, agent nén thành `StructuredCheckpoint` với ĐÚNG 5 mục:
 *   1. goal
 *   2. constraints
 *   3. completed_work
 *   4. current_state
 *   5. open_items_and_next_steps (chứa `open_gates`)
 *
 * `open_gates` là phần KHÔNG ĐƯỢC MẤT: mọi `gateId` / `poNumber` /
 * `invoiceNumber` / `quoteNumber` đang chờ duyệt phải còn nguyên trong bản nén.
 * `validateCompactionSummary` kiểm tự động cấu trúc + đối chiếu danh sách gate
 * server biết (đọc từ DB) với danh sách client nộp.
 *
 * Tệp này là lõi DÙNG CHUNG: `agents/src/memory/compaction.ts` chỉ bọc kiểu.
 */

const CHECKPOINT_SECTIONS = Object.freeze([
  'goal',
  'constraints',
  'completed_work',
  'current_state',
  'open_items_and_next_steps',
]);

const IDENTIFIER_FIELDS = Object.freeze([
  'gateId',
  'poNumber',
  'invoiceNumber',
  'quoteNumber',
]);

const nowIso = () => new Date().toISOString();

const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const text = (value, max = 2000) => String(value ?? '').trim().slice(0, max);

const asStringArray = (value) => (Array.isArray(value) ? value : [])
  .map((item) => text(item, 1000))
  .filter(Boolean);

const uniqueStrings = (values, max = 50) => [...new Set(values.map((v) => text(v, 1000)).filter(Boolean))]
  .slice(0, max);

const deepClone = (value) => {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
};

const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;

const hasNonEmptyValue = (value) => {
  if (isNonEmptyString(value)) return true;
  if (Array.isArray(value)) return value.some(hasNonEmptyValue);
  if (isRecord(value)) return Object.values(value).some(hasNonEmptyValue);
  return false;
};

/**
 * Chuẩn hoá một gate/chứng từ đang mở. Giữ NGUYÊN mọi trường (không lọc bớt) để
 * không đánh rơi dữ liệu caller cần.
 */
const normalizeOpenGate = (gate) => {
  if (isNonEmptyString(gate)) return { gateId: gate.trim() };
  if (!isRecord(gate)) return null;
  const copy = deepClone(gate);
  const hasIdentifier = IDENTIFIER_FIELDS.some((field) => isNonEmptyString(copy[field]));
  return hasIdentifier ? copy : null;
};

const gateIdentity = (gate) => {
  if (!isRecord(gate)) return '';
  const parts = IDENTIFIER_FIELDS
    .filter((field) => isNonEmptyString(gate[field]))
    .map((field) => `${field}:${String(gate[field]).trim()}`);
  return parts.length ? parts.join('|') : JSON.stringify(gate);
};

const mergeOpenGates = (...lists) => {
  const output = [];
  const seen = new Set();
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const raw of list) {
      const gate = normalizeOpenGate(raw);
      if (!gate) continue;
      const key = gateIdentity(gate);
      if (seen.has(key)) continue;
      seen.add(key);
      output.push(gate);
    }
  }
  return output;
};

/**
 * Trích gate/chứng từ đang mở từ các trường có NHÃN rõ ràng trong tin nhắn.
 * Không đoán số ngẫu nhiên để tránh biến mọi con số thành gate.
 */
const extractOpenGatesFromMessages = (messages = []) => {
  const gates = [];

  for (const message of Array.isArray(messages) ? messages : []) {
    if (!isRecord(message)) continue;
    if (Array.isArray(message.openGates)) gates.push(...message.openGates);

    const content = String(message.content ?? message.toolResult ?? '');
    if (!content) continue;

    const found = {};
    const patterns = {
      gateId: /gate[_\s-]?id["'\s:=]+([a-z0-9_-]{3,})/i,
      poNumber: /po\s*(?:number|code)?["'\s:=]+([a-z0-9_-]{3,})/i,
      invoiceNumber: /invoice\s*(?:number|no)?["'\s:=]+([a-z0-9_-]{3,})/i,
      quoteNumber: /(?:quote|bao\s*gia)\s*(?:number|no)?["'\s:=]+([a-z0-9_-]{3,})/i,
    };
    for (const [field, pattern] of Object.entries(patterns)) {
      const match = content.match(pattern);
      if (match) found[field] = match[1];
    }
    if (Object.keys(found).length) gates.push(found);
  }

  return mergeOpenGates(gates);
};

const CONSTRAINT_HINT = /(rang\s*buoc|han\s*muc|nguong|quyen|phan\s*quyen|chi\s*duoc|khong\s*duoc|phai|bat\s*buoc|phe\s*duyet|duyet|gate|sop|chiet\s*khau|discount|ton\s*kho|ngan\s*sach)/i;

const extractConstraints = (messages = []) => {
  const sentences = [];

  for (const message of Array.isArray(messages) ? messages : []) {
    if (!isRecord(message)) continue;
    for (const constraint of asStringArray(message.constraints)) sentences.push(constraint);

    const content = String(message.content ?? '').trim();
    if (!content) continue;

    const parts = content
      .split(/[\n;]+|(?<=[.!?])\s+/)
      .map((part) => part.trim())
      .filter(Boolean)
      .filter((part) => CONSTRAINT_HINT.test(part));
    sentences.push(...parts);
  }

  return uniqueStrings(sentences, 20);
};

const constraintsFromGates = (openGates = []) => {
  const output = [];
  const actionTypes = new Set(
    openGates.map((gate) => String(gate.actionType ?? '').trim()).filter(Boolean),
  );

  if (actionTypes.has('QUOTE_DISCOUNT_APPROVAL')) {
    output.push(
      'Chiết khấu vượt hạn mức phải qua gate QUOTE_DISCOUNT_APPROVAL; không được tự duyệt.',
    );
  }
  if (actionTypes.has('INVOICE_3WAY_APPROVAL')) {
    output.push(
      'Hoá đơn phải qua gate INVOICE_3WAY_APPROVAL trước khi thanh toán; không được tự duyệt.',
    );
  }
  return output;
};

const extractCompletedWork = (messages = []) => {
  const work = [];

  for (const message of Array.isArray(messages) ? messages : []) {
    if (!isRecord(message)) continue;

    if (message.role === 'tool' || message.toolName || message.toolResult) {
      const step = text(message.toolName || message.name || 'tool', 160) || 'tool';
      const result = text(message.toolResult || message.content || 'Đã hoàn tất', 1000);
      work.push({ step, result });
      continue;
    }

    const status = String(message.status ?? '').toLowerCase();
    if (['success', 'completed', 'done', 'ok'].includes(status) && String(message.content ?? '').trim()) {
      work.push({
        step: text(message.toolName || message.role || 'step', 160) || 'step',
        result: text(message.content, 1000),
      });
    }
  }

  const seen = new Set();
  const unique = work.filter((item) => {
    const key = `${item.step}|${item.result}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return unique.length
    ? unique.slice(0, 30)
    : [{ step: 'none', result: 'Chưa có công việc con nào hoàn tất.' }];
};

/**
 * Quyết định có nên nén chưa. Ngưỡng mặc định 75% budget (khoảng 70–80%).
 */
const shouldCompact = ({
  tokenBudget,
  currentTokens = 0,
  maxTurns,
  turnCount = 0,
  threshold = 0.75,
} = {}) => {
  const safeThreshold = Number.isFinite(Number(threshold)) ? Number(threshold) : 0.75;
  if (Number.isFinite(Number(tokenBudget)) && Number(tokenBudget) > 0) {
    return Number(currentTokens) >= Number(tokenBudget) * safeThreshold;
  }
  if (Number.isFinite(Number(maxTurns)) && Number(maxTurns) > 0) {
    return Number(turnCount) >= Number(maxTurns) * safeThreshold;
  }
  return false;
};

/**
 * Nén hội thoại thành checkpoint 5 mục.
 *
 * Input:
 * {
 *   messages?: Array<{role, content, toolName?, toolResult?, status?, openGates?, constraints?}>,
 *   goal?, constraints?, completedWork?, currentState?,
 *   openItems?, nextSteps?, openGates?,
 *   tokenBudget?, currentTokens?
 * }
 */
const compactConversation = (input = {}) => {
  const source = isRecord(input) ? input : {};
  const messages = Array.isArray(source.messages) ? source.messages : [];

  const explicitGates = Array.isArray(source.openGates) ? source.openGates : [];
  const messageGates = extractOpenGatesFromMessages(messages);
  const openGates = mergeOpenGates(explicitGates, messageGates);

  const firstUserMessage = messages.find(
    (message) => isRecord(message) && String(message.role ?? '').toLowerCase() === 'user'
      && String(message.content ?? '').trim(),
  );
  const goal = text(source.goal || firstUserMessage?.content || 'Chưa xác định mục tiêu.', 2000);

  const constraints = uniqueStrings([
    ...asStringArray(source.constraints),
    ...extractConstraints(messages),
    ...constraintsFromGates(openGates),
  ], 30);

  const completedWork = Array.isArray(source.completedWork) && source.completedWork.length
    ? deepClone(source.completedWork).slice(0, 30)
    : extractCompletedWork(messages);

  const assistantMessages = messages.filter(
    (message) => isRecord(message) && String(message.role ?? '').toLowerCase() === 'assistant'
      && String(message.content ?? '').trim(),
  );
  const currentState = text(
    source.currentState
      || assistantMessages[assistantMessages.length - 1]?.content
      || messages[messages.length - 1]?.content
      || 'Đang xử lý yêu cầu.',
    2000,
  );

  const derivedOpenItems = openGates.map((gate) => {
    const label = gate.actionType ? `Chờ duyệt ${gate.actionType}` : 'Chờ duyệt gate';
    const id = gate.gateId || gate.poNumber || gate.invoiceNumber || gate.quoteNumber || '';
    return id ? `${label} ${id}` : label;
  });

  const openItems = uniqueStrings([
    ...asStringArray(source.openItems),
    ...derivedOpenItems,
  ], 50);

  const nextSteps = uniqueStrings([
    ...asStringArray(source.nextSteps),
    ...(openGates.length
      ? ['Chờ người có thẩm quyền phê duyệt trước khi tiếp tục.']
      : []),
  ], 50);

  const checkpoint = {
    goal: goal || 'Chưa xác định mục tiêu.',
    constraints: constraints.length
      ? constraints
      : ['Tuân thủ phân quyền, hạn mức duyệt và quy định SOP hiện hành của ERP.'],
    completed_work: completedWork,
    current_state: currentState || 'Đang xử lý yêu cầu.',
    open_items_and_next_steps: {
      open_items: openItems.length ? openItems : ['Không có việc đang mở.'],
      next_steps: nextSteps.length ? nextSteps : ['Tiếp tục xử lý theo yêu cầu.'],
      // BẤT BIẾN: giữ nguyên 100% ID/trường của gate đang chờ.
      open_gates: openGates,
    },
    metadata: {
      compacted_at: nowIso(),
      source_message_count: messages.length,
      open_gate_count: openGates.length,
      token_budget: Number(source.tokenBudget) || null,
      current_tokens: Number(source.currentTokens) || null,
    },
  };

  return checkpoint;
};

/**
 * Chuẩn hoá danh sách expected gate. Chấp nhận:
 *   - mảng gate;
 *   - `{ openGates: [...] }`;
 *   - `{ gateIds: [...] }`.
 */
const normalizeExpectedGates = (expected) => {
  if (Array.isArray(expected)) return mergeOpenGates(expected);
  if (!isRecord(expected)) return [];
  if (Array.isArray(expected.openGates)) return mergeOpenGates(expected.openGates);
  if (Array.isArray(expected.gateIds)) {
    return mergeOpenGates(expected.gateIds.map((gateId) => ({ gateId })));
  }
  if (Array.isArray(expected.open_gates)) return mergeOpenGates(expected.open_gates);
  return [];
};

/**
 * Kiểm tra checkpoint.
 *
 * @param {object} summary
 * @param {Array|{openGates?: Array, gateIds?: Array}} [expected] danh sách gate server biết
 * @returns {{
 *   valid: boolean,
 *   errors: string[],
 *   missingSections: string[],
 *   missingGateIds: string[],
 *   missingIdentifiers: Array<{field: string, value: string}>
 * }}
 */
const validateCompactionSummary = (summary, expected = null) => {
  const errors = [];
  const missingSections = [];

  if (!isRecord(summary)) {
    return {
      valid: false,
      errors: ['checkpoint không phải object'],
      missingSections: [...CHECKPOINT_SECTIONS],
      missingGateIds: [],
      missingIdentifiers: [],
    };
  }

  if (!isNonEmptyString(summary.goal)) {
    missingSections.push('goal');
    errors.push('goal rỗng');
  }

  if (!Array.isArray(summary.constraints) || !summary.constraints.some(isNonEmptyString)) {
    missingSections.push('constraints');
    errors.push('constraints rỗng');
  }

  if (!Array.isArray(summary.completed_work) || !summary.completed_work.some(hasNonEmptyValue)) {
    missingSections.push('completed_work');
    errors.push('completed_work rỗng');
  }

  if (!isNonEmptyString(summary.current_state)) {
    missingSections.push('current_state');
    errors.push('current_state rỗng');
  }

  const openBlock = summary.open_items_and_next_steps;
  const hasOpenBlock = isRecord(openBlock)
    && Array.isArray(openBlock.open_items)
    && openBlock.open_items.some(isNonEmptyString)
    && Array.isArray(openBlock.next_steps)
    && openBlock.next_steps.some(isNonEmptyString)
    && Array.isArray(openBlock.open_gates);

  if (!hasOpenBlock) {
    missingSections.push('open_items_and_next_steps');
    errors.push('open_items_and_next_steps thiếu open_items/next_steps/open_gates');
  }

  const actualGates = hasOpenBlock ? mergeOpenGates(openBlock.open_gates) : [];
  const expectedGates = normalizeExpectedGates(expected);
  const missingGateIds = [];
  const missingIdentifiers = [];

  for (const wanted of expectedGates) {
    const identifiers = IDENTIFIER_FIELDS
      .filter((field) => isNonEmptyString(wanted[field]))
      .map((field) => ({ field, value: String(wanted[field]).trim() }));

    if (!identifiers.length) continue;

    const found = actualGates.some((actual) => identifiers.every(
      ({ field, value }) => isNonEmptyString(actual[field])
        && String(actual[field]).trim() === value,
    ));

    if (!found) {
      for (const identifier of identifiers) {
        missingIdentifiers.push(identifier);
        if (identifier.field === 'gateId') missingGateIds.push(identifier.value);
      }
      errors.push(`thiếu gate/chứng từ đang mở: ${identifiers.map((i) => `${i.field}=${i.value}`).join(', ')}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    missingSections: [...new Set(missingSections)],
    missingGateIds: [...new Set(missingGateIds)],
    missingIdentifiers,
  };
};

/** Ném lỗi mã ổn định khi checkpoint không hợp lệ. */
const assertValidCompactionSummary = (summary, expected = null) => {
  const result = validateCompactionSummary(summary, expected);
  if (!result.valid) {
    const error = new Error('Checkpoint nén không hợp lệ hoặc đã làm rơi gate đang mở');
    error.code = 'COMPACTION_INCOMPLETE';
    error.details = result;
    throw error;
  }
  return summary;
};

module.exports = {
  CHECKPOINT_SECTIONS,
  IDENTIFIER_FIELDS,
  shouldCompact,
  compactConversation,
  validateCompactionSummary,
  assertValidCompactionSummary,
  normalizeOpenGate,
  mergeOpenGates,
  extractOpenGatesFromMessages,
};
