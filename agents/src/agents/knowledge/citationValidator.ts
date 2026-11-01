/**
 * agents/knowledge/citationValidator.ts — Không có trích dẫn hợp lệ thì không có
 * câu trả lời.
 *
 * ============================================================================
 * VÌ SAO KIỂM TRA Ở ĐÂY, KHÔNG TIN PROMPT
 * ============================================================================
 * Model có thể trả về một câu rất hợp lý kèm `docCode` và số điều trông đúng —
 * nhưng tài liệu đó không hề nằm trong tập vừa truy xuất, hoặc `quote` không có
 * trong chunk. Người dùng không có cách nào phân biệt. Vì vậy câu trả lời chỉ
 * được coi là hợp lệ khi TỪNG trích dẫn khớp 100% với chunk đã truy xuất:
 *
 *   1. `docCode` + `version` phải có trong tập truy xuất.
 *   2. `sectionHeading` phải khớp một chunk của đúng tài liệu/phiên bản đó.
 *   3. `quote` (sau chuẩn hoá dấu/khoảng trắng) phải là chuỗi con của nội dung
 *      chunk đó.
 *
 * Một trích dẫn sai ⇒ toàn bộ câu trả lời bị bác (không phải chỉ bỏ dòng đó): câu
 * trả lời đã được viết dựa trên thông tin bịa, giữ lại phần còn lại là giữ lại
 * một nửa lời nói dối.
 */

export interface Citation {
  docCode: string;
  version: string;
  sectionHeading: string;
  quote: string;
}

/** Chunk đã truy xuất trong lượt hỏi này — TẬP DUY NHẤT được phép trích dẫn. */
export interface RetrievedChunk {
  docCode: string;
  version: string;
  sectionHeading: string;
  content: string;
}

export interface CitationValidation {
  valid: boolean;
  errors: string[];
  citations: Citation[];
}

const MIN_QUOTE_CHARS = 8;

/**
 * Chuẩn hoá để so khớp: bỏ dấu tiếng Việt, bỏ ký tự trang trí, gộp khoảng trắng.
 *
 * Nhờ vậy "Điều 3. Hạn mức" và "điều 3 - hạn mức" được coi là cùng một mục, còn
 * nội dung bịa vẫn lệch.
 */
export const normalizeText = (value: string): string =>
  String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

export const validateCitations = (
  citations: Citation[] | null | undefined,
  chunks: RetrievedChunk[] | null | undefined,
): CitationValidation => {
  const pool = Array.isArray(chunks) ? chunks : [];
  const list = Array.isArray(citations) ? citations : [];

  if (list.length === 0) {
    return { valid: false, errors: ['no_citations'], citations: [] };
  }

  const errors: string[] = [];
  const accepted: Citation[] = [];

  for (const citation of list) {
    const docCode = String(citation?.docCode ?? '').trim();
    const version = String(citation?.version ?? '').trim();
    const sectionHeading = String(citation?.sectionHeading ?? '').trim();
    const quote = String(citation?.quote ?? '').trim();

    if (!docCode || !version || !sectionHeading) {
      errors.push('citation_missing_fields');
      continue;
    }

    const sameDoc = pool.filter(
      (chunk) => chunk.docCode === docCode && String(chunk.version) === version,
    );
    if (sameDoc.length === 0) {
      errors.push(`doc_not_retrieved:${docCode}@${version}`);
      continue;
    }

    const normalizedHeading = normalizeText(sectionHeading);
    const sameSection = sameDoc.filter(
      (chunk) => normalizeText(chunk.sectionHeading) === normalizedHeading,
    );
    if (sameSection.length === 0) {
      errors.push(`section_not_retrieved:${docCode}@${version}#${sectionHeading}`);
      continue;
    }

    const normalizedQuote = normalizeText(quote);
    if (normalizedQuote.length < MIN_QUOTE_CHARS) {
      errors.push(`quote_too_short:${docCode}@${version}`);
      continue;
    }

    const found = sameSection.some((chunk) =>
      normalizeText(chunk.content).includes(normalizedQuote));
    if (!found) {
      errors.push(`quote_not_in_chunk:${docCode}@${version}#${sectionHeading}`);
      continue;
    }

    accepted.push(citation);
  }

  return { valid: errors.length === 0, errors, citations: accepted };
};
