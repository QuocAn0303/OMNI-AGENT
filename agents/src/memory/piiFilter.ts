/**
 * agents/src/memory/piiFilter.ts — vỏ CÓ KIỂU quanh bộ lọc PII dùng chung.
 *
 * Luật thật nằm ở `src/modules/agent-gateway/memory-pii.js`, tệp mà
 * `memory.service.js` cũng require. Nhờ vậy agent và HTTP API không bao giờ lệch
 * nhau: thêm một mẫu chặn ở một bên là bên kia chặn ngay.
 *
 * Đường dẫn `../../../src/...` đúng cho CẢ HAI vị trí:
 *   - `agents/src/memory/piiFilter.ts` (ts-jest)
 *   - `agents/dist/memory/piiFilter.js` (sau `tsc`)
 */

export const PII_CATEGORIES = [
  'cccd',
  'bank_account',
  'salary',
  'credential',
  'health',
] as const;

export type PiiCategory = (typeof PII_CATEGORIES)[number];

export interface PiiDetection {
  category: PiiCategory;
  sample: string;
}

export interface PiiScanResult {
  blocked: boolean;
  categories: PiiCategory[];
  categoryLabels: string[];
  detections: PiiDetection[];
}

interface PiiCore {
  PII_CATEGORIES: readonly string[];
  PII_CATEGORY_LABELS: Record<string, string>;
  foldText(value: unknown): string;
  scanPii(value: unknown): PiiScanResult;
  redact(value: unknown): string;
}

// eslint-disable-next-line @typescript-eslint/no-var-requires
const core = require('../../../src/modules/agent-gateway/memory-pii') as PiiCore;

export const PII_CATEGORY_LABELS = core.PII_CATEGORY_LABELS;
export const foldText = (value: unknown): string => core.foldText(value);
export const redact = (value: unknown): string => core.redact(value);

/** Quét PII. Không trả chuỗi gốc — chỉ danh mục + bản che. */
export const scanPii = (value: unknown): PiiScanResult => core.scanPii(value);

/** Lỗi 422 tương ứng `PII_FORBIDDEN` của HTTP layer. */
export class PiiForbiddenError extends Error {
  readonly code = 'PII_FORBIDDEN';

  readonly status = 422;

  readonly details: PiiScanResult;

  constructor(result: PiiScanResult) {
    super('PII_FORBIDDEN: Không được lưu dữ liệu cá nhân nhạy cảm vào bộ nhớ dài hạn');
    this.name = 'PiiForbiddenError';
    this.details = result;
  }
}

/** Ném `PiiForbiddenError` nếu có PII; trả kết quả sạch nếu không. */
export const assertNoPii = (value: unknown): PiiScanResult => {
  const result = scanPii(value);
  if (result.blocked) throw new PiiForbiddenError(result);
  return result;
};
