/**
 * policy/skillContract.ts — Kiểm tra TĨNH hợp đồng skill trước khi nạp.
 *
 * ============================================================================
 * VÌ SAO CÓ LỚP NÀY
 * ============================================================================
 * `authorizeTool` chỉ biết tool nào agent ĐANG GỌI. Nó không đọc được một skill
 * tự sinh (manifest) để biết skill đó khai báo `bash`/`curl`/`eval`/
 * `mail.send_external` rồi sẽ gọi chúng. Kiểm tra tĩnh ở đây chặn manifest độc
 * hại NGAY LÚC NẠP, trước khi bất kỳ tool nào được đăng ký.
 *
 * Hai lớp bổ sung nhau, không thay nhau:
 *   1. `validateSkillContract` — allowlist tĩnh + lệnh nguy hiểm trong manifest.
 *   2. `authorizeTool` (default-deny) — chặn lời gọi tool ngoài phạm vi agent.
 * Test `uc009-security-attacks` kiểm cả hai: manifest bị bác VÀ handler không chạy.
 */

/** Tool bị cấm tuyệt đối, kể cả khi manifest khai "hợp lệ". */
export const FORBIDDEN_TOOLS: ReadonlySet<string> = new Set([
  'bash',
  'sh',
  'shell',
  'zsh',
  'cmd',
  'powershell',
  'pwsh',
  'curl',
  'wget',
  'eval',
  'exec',
  'system',
  'node.child_process',
  'child_process',
  'mail.send_external',
  'mail.send',
  'smtp.send',
  'http.fetch',
]);

/** Segment nguy hiểm: bắt cả `finance.bash`, `tool.eval`, ... */
const FORBIDDEN_SEGMENTS: ReadonlySet<string> = new Set([
  'bash', 'shell', 'curl', 'wget', 'eval', 'exec', 'child_process',
]);

/** Tên tool phải có namespace `dept.thing` — không có tool trần. */
const NAMESPACED_TOOL = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_.-]*$/;

/** Ký tự shell/đường dẫn tuyệt đối trong `command` khai báo. */
const DANGEROUS_COMMAND = /(;|&&|\|\||\||`|\$\(|>\s*\/|\bnc\b|\brm\s+-rf\b|\bchmod\s+\+x\b)/;

export interface SkillToolDeclaration {
  name: string;
  command?: string;
}

export interface SkillContractInput {
  name?: string;
  version?: string;
  /** Allowlist tool mà skill được phép gọi. */
  allowedTools?: string[];
  /** Tool khai báo kèm lệnh — nếu có `command`, nó phải an toàn. */
  tools?: SkillToolDeclaration[];
}

export interface SkillContractValidation {
  valid: boolean;
  errors: string[];
  blockedTools: string[];
}

const isForbiddenTool = (name: string): boolean => {
  const normalized = String(name || '').trim().toLowerCase();
  if (!normalized) return false;
  if (FORBIDDEN_TOOLS.has(normalized)) return true;
  return normalized.split(/[._-]/).some((segment) => FORBIDDEN_SEGMENTS.has(segment));
};

/**
 * Kiểm tra manifest skill. Trả LỖI (không ném) để caller quyết định log/audit;
 * `valid === false` nghĩa là skill KHÔNG được nạp.
 */
export const validateSkillContract = (input: SkillContractInput = {}): SkillContractValidation => {
  const errors: string[] = [];
  const blocked = new Set<string>();

  const name = String(input.name || '').trim();
  if (!/^[a-z][a-z0-9-]{2,40}$/.test(name)) errors.push('skill_name_invalid');

  const version = String(input.version || '').trim();
  if (!version) errors.push('skill_version_missing');

  const allowedTools = Array.isArray(input.allowedTools)
    ? input.allowedTools.map((tool) => String(tool || '').trim()).filter(Boolean)
    : [];
  if (allowedTools.length === 0) errors.push('allowed_tools_empty');

  const seen = new Set<string>();
  for (const tool of allowedTools) {
    if (seen.has(tool)) {
      errors.push(`duplicate_tool:${tool}`);
      continue;
    }
    seen.add(tool);

    if (isForbiddenTool(tool)) {
      errors.push(`forbidden_tool:${tool}`);
      blocked.add(tool);
    } else if (!NAMESPACED_TOOL.test(tool)) {
      errors.push(`tool_not_namespaced:${tool}`);
    }
  }

  const declaredTools = Array.isArray(input.tools) ? input.tools : [];
  for (const tool of declaredTools) {
    const toolName = String(tool?.name || '').trim();
    if (!toolName) {
      errors.push('tool_name_missing');
      continue;
    }
    if (!allowedTools.includes(toolName)) errors.push(`tool_not_allowlisted:${toolName}`);
    if (isForbiddenTool(toolName)) {
      errors.push(`forbidden_tool:${toolName}`);
      blocked.add(toolName);
    }
    const command = String(tool?.command || '');
    if (command && DANGEROUS_COMMAND.test(command)) {
      errors.push(`dangerous_command:${toolName}`);
      blocked.add(toolName);
    }
  }

  return {
    valid: errors.length === 0,
    errors: [...new Set(errors)],
    blockedTools: [...blocked],
  };
};
