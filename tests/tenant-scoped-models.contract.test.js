/**
 * tests/tenant-scoped-models.contract.test.js — Mọi model có `tenantId` phải được scope
 *
 * CRM audit C5: `AiDocument` là model DUY NHẤT có cột `tenantId` mà không khai báo trong
 * `TENANT_SCOPED_MODELS`. Rủi ro bị che vì model `@@ignore` và được truy cập qua
 * `$queryRawUnsafe` có filter `tenant_id` thủ công — nhưng đó là bảo vệ nguy cơ, không
 * phải thiết kế. Khi ai đó gỡ `@@ignore`, extension sẽ im lặng bỏ qua tenantId và mọi
 * query đọc/ghi trên model đó thành cross-tenant.
 *
 * Test này làm đối chiếu tự động thay cho việc so tay hơn 150 model bằng mắt — thứ đã
 * trơ ra một lần rồi sẽ trơ ra lần nữa nếu không có gate.
 */
const fs = require("fs");
const path = require("path");

const SCHEMA_PATH = path.join(__dirname, "..", "prisma", "schema.prisma");
const PRISMA_PATH = path.join(__dirname, "..", "src", "config", "prisma.js");

/** @returns {Map<string, { hasTenantId: boolean, ignored: boolean }>} */
const parseSchema = () => {
  const src = fs.readFileSync(SCHEMA_PATH, "utf8");
  const models = new Map();
  // Model không lồng nhau trong schema này → cắt theo `}` ở đầu dòng là đủ.
  const re = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm;
  let m;
  while ((m = re.exec(src)) !== null) {
    const [, name, body] = m;
    models.set(name, {
      hasTenantId: /^\s*tenantId\s+\w+/m.test(body),
      ignored: /@@ignore/.test(body),
    });
  }
  return models;
};

/**
 * Đọc TENANT_SCOPED_MODELS từ source `config/prisma.js` mà KHÔNG require nó
 * (require sẽ dựng Prisma client + pg Pool thật).
 */
const parseScopedModels = () => {
  const src = fs.readFileSync(PRISMA_PATH, "utf8");
  const start = src.indexOf("const TENANT_SCOPED_MODELS");
  if (start === -1) throw new Error("Không tìm thấy TENANT_SCOPED_MODELS trong config/prisma.js");
  const open = src.indexOf("[", start);
  const close = src.indexOf("]);", open);
  if (open === -1 || close === -1) throw new Error("Không cân bằng được mảng TENANT_SCOPED_MODELS");
  // eslint-disable-next-line no-new-func
  return new Function(`return ${src.slice(open, close + 1)};`)();
};

describe("contract: model có tenantId phải nằm trong TENANT_SCOPED_MODELS", () => {
  const models = parseSchema();
  const scoped = parseScopedModels();

  test("parser đọc được toàn bộ model của schema (>100 model)", () => {
    expect(models.size).toBeGreaterThan(100);
  });

  test("C5: không model nào có tenantId mà thiếu trong TENANT_SCOPED_MODELS", () => {
    const missing = [...models.entries()]
      .filter(([name, info]) => info.hasTenantId && !scoped.includes(name))
      .map(([name, info]) => `${name}${info.ignored ? " (@@ignore)" : ""}`);
    expect(missing).toEqual([]);
  });

  test("TENANT_SCOPED_MODELS không chứa model không tồn tại trong schema", () => {
    const unknown = scoped.filter((name) => !models.has(name));
    expect(unknown).toEqual([]);
  });

  test("AiDocument đã được đăng ký (hồi quy của C5)", () => {
    expect(models.get("AiDocument")?.hasTenantId).toBe(true);
    expect(scoped).toContain("AiDocument");
  });
});