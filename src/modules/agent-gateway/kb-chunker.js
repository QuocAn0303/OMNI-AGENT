/**
 * modules/agent-gateway/kb-chunker.js — Cắt tài liệu SOP theo MỤC/ĐIỀU KHOẢN.
 *
 * ============================================================================
 * VÌ SAO KHÔNG CẮT THEO SỐ KÝ TỰ
 * ============================================================================
 * Một chunk bị cắt giữa bảng hạn mức phê duyệt sẽ trả cho người đọc đúng nửa câu
 * "trên 50 triệu phải..." — câu trả lời trông có trích dẫn nhưng sai nghĩa. Cắt
 * theo mục giữ nguyên bảng, giữ nguyên tiêu đề trong chunk, nên đoạn trích dẫn
 * luôn tự đứng được một mình.
 *
 * Ranh giới chunk:
 *   - Dòng tiêu đề Markdown `#`..`######`
 *   - Dòng bắt đầu bằng "Điều 3", "Mục IV", "Chương 2", "Phần 1" (kèm dấu . : ) -)
 * Nội dung TRƯỚC tiêu đề đầu tiên vẫn thành chunk riêng ("Mở đầu").
 *
 * Dòng trong khối ``` hoặc ~~~ KHÔNG được coi là tiêu đề — nếu không, một ví dụ
 * code chứa `# comment` sẽ bị xé thành mục giả.
 */

/** Tiêu đề Markdown. */
const HEADING = /^(#{1,6})\s+(.+?)\s*$/;

/** "Điều 3. Hạn mức phê duyệt" — chỉ nhận dòng NGẮN để không bắt nhầm câu văn. */
const ARTICLE = /^((?:Điều|Mục|Chương|Phần)\s+(?:\d+|[IVXLC]+))\s*[.:)\-–]?\s*(.{0,120})$/i;

/** Độ dài tối đa của dòng được coi là tiêu đề điều/mục. */
const MAX_ARTICLE_LINE = 160;

const FENCE = /^\s*(```|~~~)/;

/**
 * Cắt Markdown thành chunk theo mục.
 *
 * @param {string} markdown
 * @returns {Array<{ sectionHeading: string, content: string, chunkIndex: number }>}
 */
const chunkMarkdown = (markdown) => {
  const lines = String(markdown ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n');

  const chunks = [];
  let heading = '';
  let buffer = [];
  let inFence = false;

  const flush = () => {
    const content = buffer.join('\n').trim();
    buffer = [];
    if (!content) return;
    chunks.push({
      sectionHeading: heading || 'Mở đầu',
      content,
      // `chunkIndex` theo ĐÚNG thứ tự xuất hiện — khoá idempotency của ingest.
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
          : `${article[1].trim()}${article[2] && article[2].trim() ? `. ${article[2].trim()}` : ''}`;
        // Tiêu đề nằm TRONG chunk để đoạn trích dẫn luôn kèm ngữ cảnh mục.
        buffer.push(line);
        continue;
      }
    }

    buffer.push(line);
  }

  flush();
  return chunks;
};

module.exports = { chunkMarkdown };
