/**
 * agents/src/memory/memoryBoundary.ts — ranh giới nghiệp vụ của memory (UC-007).
 *
 * Cùng một bộ luật với `src/modules/agent-gateway/memory-boundary.js`. Memory
 * KHÔNG BAO GIỜ được dùng để ghi đè bảng giá, hạn mức chiết khấu, tồn kho,
 * RBAC hay SOP.
 */

export const BOUNDARY_CATEGORIES = [
  'approval_bypass',
  'discount_authority',
  'pricing_override',
  'inventory_override',
  'rbac_override',
  'sop_override',
] as const;

export type BoundaryCategory = (typeof BOUNDARY_CATEGORIES)[number];

export interface BoundaryScanResult {
  blocked: boolean;
  categories: BoundaryCategory[];
  categoryLabels: string[];
}

interface BoundaryCore {
  BOUNDARY_CATEGORIES: readonly string[];
  BOUNDARY_CATEGORY_LABELS: Record<string, string>;
  scanMemoryBoundary(value: unknown): BoundaryScanResult;
}

// eslint-disable-next-line @typescript-eslint/no-var-requires
const core = require('../../../src/modules/agent-gateway/memory-boundary') as BoundaryCore;

export const BOUNDARY_CATEGORY_LABELS = core.BOUNDARY_CATEGORY_LABELS;
export const scanMemoryBoundary = (value: unknown): BoundaryScanResult =>
  core.scanMemoryBoundary(value);

export class MemoryBoundaryError extends Error {
  readonly code = 'MEMORY_BOUNDARY_FORBIDDEN';

  readonly status = 422;

  readonly details: BoundaryScanResult;

  constructor(result: BoundaryScanResult) {
    super('Bộ nhớ không được ghi đè quy tắc nghiệp vụ (giá, hạn mức, tồn kho, RBAC, SOP)');
    this.name = 'MemoryBoundaryError';
    this.details = result;
  }
}

export const assertMemoryBoundary = (value: unknown): BoundaryScanResult => {
  const result = scanMemoryBoundary(value);
  if (result.blocked) throw new MemoryBoundaryError(result);
  return result;
};
