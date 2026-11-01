/**
 * agents/knowledge/chunker.ts — Cắt Markdown SOP theo MỤC/ĐIỀU KHOẢN.
 *
 * ============================================================================
 * VÌ SAO KHÔNG CẮT THEO SỐ KÝ TỰ
 * ============================================================================
 * Chunk cắt giữa bảng hạn mức sẽ trả về đúng nửa câu "trên 50 triệu phải..." —
 * câu trả lời có trích dẫn nhưng sai nghĩa, loại lỗi khó phát hiện nhất. Cắt
 * theo mục giữ nguyên bảng Markdown và TIÊU ĐỀ MỤC trong từng chunk, nên đoạn
 * trích dẫn luôn tự đứng được một mình.
 *
 * Ranh giới mới:
 *   - `#`..`######` (tiêu đề Markdown)
 *   - "Điều 3", "Mục IV", "Chương 2", "Phần 1" (dòng ngắn, kèm dấu . : ) -)
 * Nội dung trước tiêu đề đầu tiên vẫn thành chunk "Mở đầu".
 *
 * Dòng nằm trong khối ``` / ~~~ KHÔNG phải tiêu đề: ví dụ code có `# comment`
 * không được xé thành mục giả.
 */

export interface SopChunk {
  /** Tiêu đề mục — trùng `section_heading` lưu trong `ai_documents`. */
  sectionHeading: string;
  /** Nội dung chunk, GIỮ cả dòng tiêu đề + bảng Markdown. */
  content: string;
  chunkIndex: number;
}

const HEADING = /^(#{1,6})\s+(.+?)\s*$/;

/** Chỉ nhận dòng NGẮN để không bắt nhầm câu văn bắt đầu bằng "Mục tiêu...". */
const ARTICLE = /^((?:Điều|Mục|Chương|Phần)\s+(?:\d+|[IVXLC]+))\s*[.:)\-–]?\s*(.{0,120})$/i;

const MAX_ARTICLE_LINE = 160;

const FENCE = /^\s*(```|~~~)/;

export const chunkSopMarkdown = (markdown: string): SopChunk[] => {
  const lines = String(markdown ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n');

  const chunks: SopChunk[] = [];
  let heading = '';
  let buffer: string[] = [];
  let inFence = false;

  const flush = (): void => {
    const content = buffer.join('\n').trim();
    buffer = [];
    if (!content) return;
    chunks.push({
      sectionHeading: heading || 'Mở đầu',
      content,
      chunkIndex: chunks.length,
    });
  };

  for (const line of lines) {
    if (FENCE.test(line)) {
      inFence = !inFence;
      buffer.push(line);
      continue;
    }

    if (!inFence) {
      const md = line.match(HEADING);
      const article = !md && line.length <= MAX_ARTICLE_LINE ? line.match(ARTICLE) : null;

      if (md || article) {
        flush();
        heading = md
          ? md[2].trim()
          : `${article![1].trim()}${article![2] && article![2].trim() ? `. ${article![2].trim()}` : ''}`;
        buffer.push(line);
        continue;
      }
    }

    buffer.push(line);
  }

  flush();
  return chunks;
};
