/**
 * modules/agent-gateway/evals.service.js — đọc kết quả eval cho Web UI (Bước 10).
 *
 * ============================================================================
 * CHỈ ĐỌC — KHÔNG CHẠY EVAL QUA HTTP
 * ============================================================================
 * Eval ghi DB/seed dữ liệu và phải dọn trong `finally`; chạy nó từ một route
 * nghĩa là bất kỳ ai đăng nhập cũng có thể kích hoạt ghi dữ liệu hàng loạt. Vì
 * vậy route chỉ trả nội dung đã có trong `evals/results/` (do `npm run eval:all`
 * sinh ra) + tình trạng hợp lệ của bộ dữ liệu. Không có nhánh nào tự sinh kết quả.
 *
 * Thiếu tệp là trạng thái hợp lệ: trả `available: false` kèm hướng dẫn chạy,
 * KHÔNG bịa số liệu và không ném lỗi 500 vì thiếu artefact.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ApiError = require('../../utils/apiError');
const core = require('../../../evals/lib/core');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const RESULT_DIR = path.join(REPO_ROOT, 'evals', 'results');
const REPORT_FILE = path.join(RESULT_DIR, 'regression-report.md');

const RESULT_FILES = Object.freeze({
  baseline: 'baseline.json',
  improved: 'improved.json',
});

const readJson = (file) => {
  try {
    return { available: true, data: JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch (err) {
    return {
      available: false,
      error: err.code === 'ENOENT' ? 'RESULT_NOT_FOUND' : `RESULT_UNREADABLE:${err.message}`,
    };
  }
};

/** Rút gọn một UC: giữ chỉ số + usage, bỏ mảng `cases` (có thể rất dài). */
const summarizeUseCase = (uc) => {
  if (!uc || typeof uc !== 'object') return null;
  return {
    useCase: uc.useCase,
    name: uc.name,
    caseCount: uc.caseCount ?? null,
    metrics: uc.metrics || {},
    usage: uc.usage || null,
    thresholdsPassed: Object.values(uc.metrics || {}).every((metric) => metric?.passedThreshold !== false),
  };
};

const summarizeMode = (mode, payload) => {
  if (!payload?.available) {
    return {
      available: false,
      mode,
      error: payload?.error || 'RESULT_NOT_FOUND',
      hint: 'Chạy `npm run eval:all` để sinh evals/results/*.json',
    };
  }

  const data = payload.data || {};
  const ucs = Object.values(data.ucs || {}).map(summarizeUseCase).filter(Boolean);
  const metrics = ucs.flatMap((uc) => Object.entries(uc.metrics || {}).map(([key, metric]) => ({
    useCase: uc.useCase,
    key,
    ...metric,
  })));

  return {
    available: true,
    mode,
    generatedAt: data.generatedAt || null,
    runtime: data.runtime || null,
    datasets: data.datasets || null,
    useCases: ucs,
    totals: {
      useCases: ucs.length,
      metrics: metrics.length,
      passedThresholds: metrics.filter((metric) => metric.passedThreshold).length,
      failedThresholds: metrics.filter((metric) => metric.passedThreshold === false).length,
      allThresholdsPassed: metrics.length > 0 && metrics.every((metric) => metric.passedThreshold),
    },
  };
};

/**
 * Tổng hợp cho `GET /evals/summary`.
 *
 * @param {{ actor?: object }} params
 */
const getEvalsSummary = ({ actor } = {}) => {
  if (!actor?.userId) throw new ApiError(401, 'Chưa xác thực tài khoản');

  const datasetCheck = core.validateDatasets();
  const baseline = summarizeMode('baseline', {
    ...readJson(path.join(RESULT_DIR, RESULT_FILES.baseline)),
  });
  const improved = summarizeMode('improved', {
    ...readJson(path.join(RESULT_DIR, RESULT_FILES.improved)),
  });

  let report = { available: false, file: 'evals/results/regression-report.md' };
  try {
    const content = fs.readFileSync(REPORT_FILE, 'utf8');
    report = {
      available: true,
      file: 'evals/results/regression-report.md',
      bytes: Buffer.byteLength(content, 'utf8'),
      content: content.slice(0, 20000),
    };
  } catch (err) {
    report.error = err.code === 'ENOENT' ? 'REPORT_NOT_FOUND' : err.message;
  }

  return {
    generatedAt: new Date().toISOString(),
    viewer: {
      userId: actor.userId,
      role: actor.role || null,
      department: actor.department || null,
    },
    datasets: datasetCheck,
    baseline,
    improved,
    regression: report,
    thresholds: {
      source: 'SE373 §5–6',
      baselinePassed: baseline.available ? baseline.totals.allThresholdsPassed : null,
      improvedPassed: improved.available ? improved.totals.allThresholdsPassed : null,
      improvedDelta: baseline.available && improved.available
        ? improved.totals.passedThresholds - baseline.totals.passedThresholds
        : null,
    },
  };
};

module.exports = { getEvalsSummary };
