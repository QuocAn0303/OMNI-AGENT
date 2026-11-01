/**
 * agents/finance/skillManifest.ts — Nạp và kiểm tra TĨNH hợp đồng skill UC-004.
 *
 * ============================================================================
 * VÌ SAO NẠP TỪ TỆP THẬT, KHÔNG CHÉP HẰNG SỐ VÀO CODE
 * ============================================================================
 * `skills/invoice-reconciliation/SKILL.md` là hợp đồng mà người viết skill đọc.
 * Nếu agent dùng một bản sao hằng số trong TypeScript, hai bên sẽ lệch nhau âm
 * thầm: skill khai 7 tool nhưng agent đăng ký 5, hoặc thiếu mục an toàn. Nạp
 * đúng tệp + kiểm đủ 9 mục khiến "hợp đồng" có hiệu lực thật.
 *
 * Thứ tự kiểm tra:
 *   1. `validateSkillContract` — tên, phiên bản, allowlist tool, tool bị cấm;
 *   2. đúng phòng ban `FINANCE`;
 *   3. đủ 9 mục bắt buộc của SE373 §4.2.
 *
 * Sai bất kỳ mục nào ⇒ ném `SkillManifestError`; agent dừng trước khi gọi tool.
 */
import fs from 'fs';
import path from 'path';

import {
  validateSkillContract,
  type SkillContractValidation,
} from '../../policy/skillContract';

export const SKILL_NAME = 'invoice-reconciliation';
export const SKILL_VERSION = '1.0.0';
export const SKILL_DEPARTMENT = 'FINANCE';

/**
 * Chín mục bắt buộc của đề SE373 §4.2. So khớp CHÍNH XÁC tiêu đề H2 — đổi dấu
 * câu trong SKILL.md là test/agent báo lỗi ngay, không âm thầm bỏ qua.
 */
export const REQUIRED_SKILL_SECTIONS: readonly string[] = [
  '1. Skill name & Version',
  '2. Purpose',
  '3. When to use (trigger conditions)',
  '4. Owning department',
  '5. Allowed tools',
  '6. Input / Output schema',
  '7. Execution steps',
  '8. Safety constraints',
  '9. Example & Final check',
];

export interface LoadedSkillManifest {
  filePath: string;
  name: string;
  version: string;
  department: string;
  allowedTools: string[];
  sections: string[];
  validation: SkillContractValidation;
}

export class SkillManifestError extends Error {
  readonly code: string;
  readonly errors: string[];

  constructor(code: string, errors: string[] = []) {
    super(`Hợp đồng skill không hợp lệ (code: ${code})`);
    this.name = 'SkillManifestError';
    this.code = code;
    this.errors = errors;
  }
}

const unquote = (value: string): string => {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
};

interface ParsedFrontMatter {
  meta: Record<string, string>;
  allowedTools: string[];
  body: string;
}

/**
 * Parser front matter tối giản cho đúng cấu trúc của SKILL.md.
 *
 * Cố ý không thêm thư viện YAML: đầu vào chỉ có `key: value` và một danh sách
 * `allowed_tools`. Một parser nhỏ, dễ đọc, không có quyền thực thi gì.
 */
const parseFrontMatter = (raw: string): ParsedFrontMatter => {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  if (!match) return { meta: {}, allowedTools: [], body: raw };

  const meta: Record<string, string> = {};
  const allowedTools: string[] = [];
  let currentKey: string | null = null;

  for (const rawLine of match[1].split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, '');
    if (!line.trim() || line.trim().startsWith('#')) continue;

    const listItem = /^\s*-\s+(.+)$/.exec(line);
    if (listItem) {
      if (currentKey === 'allowed_tools') allowedTools.push(unquote(listItem[1]));
      continue;
    }

    const keyValue = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!keyValue) continue;

    currentKey = keyValue[1];
    const value = keyValue[2].trim();
    if (value) meta[currentKey] = unquote(value);
  }

  return { meta, allowedTools, body: raw.slice(match[0].length) };
};

/** Các vị trí có thể chứa SKILL.md (dev, test, dist, `agents/skills` dự phòng). */
export const skillManifestCandidates = (explicitPath?: string): string[] => {
  const cwd = process.cwd();
  const candidates: Array<string | undefined> = [
    explicitPath,
    path.resolve(cwd, 'skills/invoice-reconciliation/SKILL.md'),
    path.resolve(cwd, '../skills/invoice-reconciliation/SKILL.md'),
    path.resolve(__dirname, '../../../../skills/invoice-reconciliation/SKILL.md'),
    path.resolve(__dirname, '../../../skills/invoice-reconciliation/SKILL.md'),
  ];

  return [...new Set(candidates.filter((value): value is string => Boolean(value)))];
};

/**
 * Đọc + kiểm hợp đồng. Ném khi không tìm thấy tệp; KHÔNG ném khi hợp đồng sai
 * (caller gọi `assertValidSkillManifest` để quyết định dừng) — nhờ vậy test có
 * thể đọc lỗi chi tiết.
 */
export const loadSkillManifest = (explicitPath?: string): LoadedSkillManifest => {
  const candidates = skillManifestCandidates(explicitPath);
  const filePath = candidates.find((candidate) => fs.existsSync(candidate));
  if (!filePath) {
    throw new SkillManifestError('skill_manifest_not_found', candidates);
  }

  const raw = fs.readFileSync(filePath, 'utf8');
  const { meta, allowedTools, body } = parseFrontMatter(raw);

  const sections = body
    .split(/\r?\n/)
    .map((line) => /^##\s+(.+?)\s*$/.exec(line)?.[1] || '')
    .filter((heading) => heading.length > 0);

  const validation = validateSkillContract({
    name: meta.name,
    version: meta.version,
    allowedTools,
  });

  return {
    filePath,
    name: meta.name || '',
    version: meta.version || '',
    department: String(meta.department || '').trim().toUpperCase(),
    allowedTools,
    sections,
    validation,
  };
};

/**
 * Dừng an toàn nếu hợp đồng không đạt. Agent gọi hàm này ngay lúc khởi tạo — một
 * skill sai không được phép chạy dù chỉ một tool.
 */
export const assertValidSkillManifest = (manifest: LoadedSkillManifest): void => {
  const errors = [...manifest.validation.errors];

  if (manifest.name !== SKILL_NAME) {
    errors.push(`skill_name_mismatch:${manifest.name || 'missing'}`);
  }
  if (manifest.department !== SKILL_DEPARTMENT) {
    errors.push(`skill_department_mismatch:${manifest.department || 'missing'}`);
  }
  for (const section of REQUIRED_SKILL_SECTIONS) {
    if (!manifest.sections.includes(section)) {
      errors.push(`skill_section_missing:${section}`);
    }
  }

  if (errors.length > 0) {
    throw new SkillManifestError('skill_manifest_invalid', [...new Set(errors)]);
  }
};
