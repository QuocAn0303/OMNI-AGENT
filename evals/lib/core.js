/**
 * evals/lib/core.js — hạ tầng dùng chung cho `npm run eval:all` (Bước 10).
 *
 * Ở ĐÂY CHỈ CÓ HÀM THUẦN: đọc JSON, dựng đối tượng chỉ số, đếm usage.
 * Không import Prisma, không gọi mạng — nhờ vậy `evals/lib/core.js` dùng được
 * trong cả chế độ baseline (mô phỏng cấu hình cũ) và improved (hệ thống thật).
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DATASET_DIR = path.resolve(__dirname, '..', 'datasets');
const RESULT_DIR = path.resolve(__dirname, '..', 'results');

/** Đọc một tệp dataset; lỗi đọc/parse phải NỔI LÊN, không trả mảng rỗng im lặng. */
const loadDataset = (fileName) => {
  const file = path.join(DATASET_DIR, fileName);
  const raw = fs.readFileSync(file, 'utf8');
  return JSON.parse(raw);
};

/**
 * Một chỉ số luôn có đủ 5 trường đề yêu cầu:
 *   { passed, total, rate, threshold, passedThreshold }
 *
 * `direction` quyết định cách hiểu `rate`:
 *   - 'min' (mặc định): rate = passed/total, đạt khi rate >= threshold.
 *     Dùng cho recall/accuracy (càng cao càng tốt).
 *   - 'max': rate = (total - passed)/total, đạt khi rate <= threshold.
 *     Dùng cho leak_rate/violation_rate (càng thấp càng tốt). Nhờ vậy tên chỉ
 *     số và ngưỡng trong báo cáo khớp đúng văn bản của đề SE373.
 */
const metric = ({ passed, total, threshold, direction = 'min', note = null, failures = [] }) => {
  const safeTotal = Number(total) || 0;
  const safePassed = Math.max(0, Math.min(Number(passed) || 0, safeTotal));
  const rate = safeTotal === 0
    ? 0
    : direction === 'max'
      ? (safeTotal - safePassed) / safeTotal
      : safePassed / safeTotal;
  const passedThreshold = safeTotal > 0 && (
    direction === 'max' ? rate <= threshold : rate >= threshold
  );

  return {
    passed: safePassed,
    total: safeTotal,
    rate: Number(rate.toFixed(4)),
    threshold,
    passedThreshold,
    direction,
    ...(note ? { note } : {}),
    ...(failures.length > 0 ? { failureSample: failures.slice(0, 3) } : {}),
  };
};

/**
 * Đếm usage KHÔNG gọi LLM.
 *
 * Bản eval này chạy tất định (không gọi model), nên `estimated_cost_usd` = 0 và
 * `llm_calls` = 0 là con số TRUNG THỰC. `input_tokens`/`output_tokens` được ước
 * lượng từ ký tự (≈4 ký tự/token) để so sánh chi phí giữa baseline và improved
 * nếu sau này cắm LLM thật vào cùng khung đo. `cached_tokens` đếm phần ngữ cảnh
 * SOP lặp lại giữa các câu hỏi (cache hit thật của tầng retrieval).
 */
const approxTokens = (text) => Math.ceil(String(text || '').length / 4);

class UsageMeter {
  constructor() {
    this.inputTokens = 0;
    this.outputTokens = 0;
    this.cachedTokens = 0;
    this.llmCalls = 0;
    this.latencies = [];
    this._seenContext = new Set();
  }

  /**
   * Ghi một lượt xử lý. `contextKey` giống nhau ở nhiều lượt ⇒ đó là ngữ cảnh
   * được tái sử dụng (retrieval cache), không phải đọc mới.
   */
  record({ input = '', output = '', latencyMs = 0, contextKey = null, llmCall = false } = {}) {
    const inputTokens = approxTokens(input);
    this.inputTokens += inputTokens;
    this.outputTokens += approxTokens(output);
    if (typeof latencyMs === 'number' && Number.isFinite(latencyMs)) {
      this.latencies.push(latencyMs);
    }
    if (llmCall) this.llmCalls += 1;

    if (contextKey) {
      if (this._seenContext.has(contextKey)) {
        this.cachedTokens += inputTokens;
      } else {
        this._seenContext.add(contextKey);
      }
    }
  }

  summary() {
    const avgLatency = this.latencies.length === 0
      ? 0
      : this.latencies.reduce((sum, value) => sum + value, 0) / this.latencies.length;

    return {
      input_tokens: this.inputTokens,
      output_tokens: this.outputTokens,
      cached_tokens: this.cachedTokens,
      cache_hit_rate: this.inputTokens === 0
        ? 0
        : Number((this.cachedTokens / this.inputTokens).toFixed(4)),
      estimated_cost_usd: 0,
      avg_latency_ms: Number(avgLatency.toFixed(2)),
      llm_calls: this.llmCalls,
      pricingBasis: 'deterministic: không gọi LLM, chi phí 0 USD; token ước lượng ~4 ký tự/token',
    };
  }
}

/** Bỏ dấu tiếng Việt + lowercase — dùng để so khớp keyword ground-truth. */
const fold = (value) => String(value ?? '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/đ/g, 'd')
  .replace(/\s+/g, ' ')
  .trim();

/** So khớp mọi keyword (đã bỏ dấu) trong một chuỗi. */
const containsAllKeywords = (haystack, keywords) => {
  if (!Array.isArray(keywords) || keywords.length === 0) return true;
  const text = fold(haystack);
  return keywords.every((keyword) => text.includes(fold(keyword)));
};

const ensureDir = (dir) => {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

const writeJson = (file, value) => {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return file;
};

const pct = (value) => `${(Number(value) * 100).toFixed(1)}%`;

/**
 * Kiểm tra cấu trúc + số lượng tối thiểu của cả 6 bộ dữ liệu.
 * Trả `{ ok, errors, counts }` thay vì ném, để runner/check script cùng đọc được.
 */
const validateDatasets = () => {
  const errors = [];
  const counts = {};

  const read = (fileName) => {
    try {
      return loadDataset(fileName);
    } catch (err) {
      errors.push(`${fileName}: ${err.message}`);
      return null;
    }
  };

  const sop = read('sop_documents.json');
  const sopQuestions = read('sop_questions.json');
  const invoices = read('invoices_3way.json');
  const crm = read('crm_quotes_emails.json');
  const memory = read('leave_and_memory_cases.json');
  const routing = read('routing_and_security_cases.json');

  const docs = Array.isArray(sop?.documents) ? sop.documents : [];
  counts.sopDocuments = docs.length;
  if (docs.length < 25) errors.push(`sop_documents.json: cần ≥25 tài liệu, có ${docs.length}`);

  const supersededPairs = docs.filter((doc) => doc.supersededAt && doc.version);
  if (supersededPairs.length < 2) {
    errors.push(`sop_documents.json: cần ≥2 bản cũ bị thay thế, có ${supersededPairs.length}`);
  }
  const confidential = docs.filter((doc) => ['confidential', 'manager_only'].includes(doc.accessLevel));
  if (confidential.length < 1) errors.push('sop_documents.json: thiếu tài liệu confidential/manager_only');
  const docsWithSections = docs.filter(
    (doc) => Array.isArray(doc.sections) && doc.sections.length > 0
      && doc.sections.every((section) => section.heading && section.content),
  );
  if (docsWithSections.length !== docs.length) {
    errors.push('sop_documents.json: có tài liệu thiếu mục/điều khoản');
  }

  const questions = Array.isArray(sopQuestions?.questions) ? sopQuestions.questions : [];
  counts.sopQuestions = questions.length;
  if (questions.length < 25) errors.push(`sop_questions.json: cần ≥25 câu hỏi, có ${questions.length}`);
  const allowedStatus = ['ANSWERED', 'NO_ANSWER', 'DENIED_CONFIDENTIAL'];
  const badStatus = questions.filter((q) => !allowedStatus.includes(q.expectedStatus));
  if (badStatus.length > 0) errors.push(`sop_questions.json: expectedStatus lạ ở ${badStatus.length} câu`);
  if (questions.filter((q) => q.expectedStatus === 'NO_ANSWER').length < 5) {
    errors.push('sop_questions.json: cần ≥5 câu không có đáp án');
  }
  if (questions.filter((q) => q.expectedStatus === 'DENIED_CONFIDENTIAL').length < 3) {
    errors.push('sop_questions.json: cần ≥3 câu kiểm tra rò rỉ confidential');
  }
  if (questions.filter((q) => q.asOf && q.expectedStatus === 'ANSWERED').length < 1) {
    errors.push('sop_questions.json: thiếu câu hỏi lịch sử asOf');
  }
  const docCodes = new Set(docs.map((doc) => doc.docCode));
  const danglingQuestion = questions.filter(
    (q) => q.expectedDocCode && !docCodes.has(q.expectedDocCode),
  );
  if (danglingQuestion.length > 0) {
    errors.push(`sop_questions.json: ${danglingQuestion.length} câu trỏ tới docCode không tồn tại`);
  }

  const invoiceCases = Array.isArray(invoices?.cases) ? invoices.cases : [];
  counts.invoiceCases = invoiceCases.length;
  if (invoiceCases.length < 15) errors.push(`invoices_3way.json: cần ≥15 bộ, có ${invoiceCases.length}`);
  const invoiceLabels = [
    'MATCHED_3WAY', 'MATH_ERROR', 'DUPLICATE_INVOICE', 'QTY_EXCEEDS_GRN',
    'MISSING_PO_OR_GRN', 'PRICE_MISMATCH', 'PROMPT_INJECTION_DETECTED',
  ];
  const badInvoiceLabel = invoiceCases.filter((c) => !invoiceLabels.includes(c.expectedClassification));
  if (badInvoiceLabel.length > 0) errors.push(`invoices_3way.json: ${badInvoiceLabel.length} nhãn phân loại lạ`);
  const missingInvoiceField = invoiceCases.filter(
    (c) => !c.invoice || typeof c.expectedGateCreated !== 'boolean' || !('expectedVendorBankAccount' in c),
  );
  if (missingInvoiceField.length > 0) {
    errors.push(`invoices_3way.json: ${missingInvoiceField.length} bộ thiếu trường ground-truth`);
  }

  const crmCases = Array.isArray(crm?.cases) ? crm.cases : [];
  counts.crmCases = crmCases.length;
  if (crmCases.length < 15) errors.push(`crm_quotes_emails.json: cần ≥15 email, có ${crmCases.length}`);
  if (!crmCases.some((c) => c.expected?.gateRequired === true)) {
    errors.push('crm_quotes_emails.json: thiếu ca cần gate chiết khấu');
  }
  if (!crmCases.some((c) => c.expected?.customerStatus === 'CUSTOMER_AMBIGUOUS')) {
    errors.push('crm_quotes_emails.json: thiếu ca CUSTOMER_AMBIGUOUS');
  }
  if (!crmCases.some((c) => c.expected?.injection === true)) {
    errors.push('crm_quotes_emails.json: thiếu ca prompt injection');
  }
  if (!crmCases.some((c) => c.expected?.mcpRetry === true)) {
    errors.push('crm_quotes_emails.json: thiếu ca MCP retry');
  }

  const memoryCases = Array.isArray(memory?.cases) ? memory.cases : [];
  counts.memoryCases = memoryCases.length;
  if (memoryCases.length < 15) {
    errors.push(`leave_and_memory_cases.json: cần ≥15 ca, có ${memoryCases.length}`);
  }
  const requiredKinds = [
    'cross_session_recall', 'pii_block_create', 'pii_block_update', 'pii_block_import',
    'boundary_block', 'supersede', 'ttl', 'isolation', 'compaction',
  ];
  const kinds = new Set(memoryCases.map((c) => c.kind));
  const missingKind = requiredKinds.filter((kind) => !kinds.has(kind));
  if (missingKind.length > 0) {
    errors.push(`leave_and_memory_cases.json: thiếu loại ca ${missingKind.join(', ')}`);
  }

  const routingCases = Array.isArray(routing?.routingCases) ? routing.routingCases : [];
  const securityCases = Array.isArray(routing?.securityCases) ? routing.securityCases : [];
  counts.routingCases = routingCases.length;
  counts.securityCases = securityCases.length;
  if (routingCases.length < 40) errors.push(`routing_and_security_cases.json: cần ≥40 ca định tuyến, có ${routingCases.length}`);
  const crossDepartment = routingCases.filter((c) => c.expected?.crossDepartment === true);
  counts.crossDepartmentCases = crossDepartment.length;
  if (crossDepartment.length < 10) errors.push('routing_and_security_cases.json: cần ≥10 ca liên phòng ban');
  if (securityCases.length !== 6) {
    errors.push(`routing_and_security_cases.json: cần đúng 6 ca tấn công, có ${securityCases.length}`);
  }

  return { ok: errors.length === 0, errors, counts };
};

module.exports = {
  DATASET_DIR,
  RESULT_DIR,
  loadDataset,
  validateDatasets,
  metric,
  UsageMeter,
  approxTokens,
  fold,
  containsAllKeywords,
  ensureDir,
  writeJson,
  pct,
};
