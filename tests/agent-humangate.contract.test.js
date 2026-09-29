/**
 * tests/agent-humangate.contract.test.js — Human-Gate: payload ↔ Prisma schema contract
 *
 * BỐI CẢNH (vì sao test này bắt buộc phải có):
 * 447 test đều xanh trong khi Human-Gate chết hoàn toàn, vì mọi test agent đều
 * `prisma.agentHumanGate.create = jest.fn()`. Mock trả thành công vô điều kiện nên không
 * bao giờ phát hiện payload:
 *   - thiếu field BẮT BUỘC `actionSummary` (schema: String @db.Text, không @default)
 *   - decide dùng sai tên field: `resolvedAt/resolvedBy/resolvedNote` trong khi schema
 *     định nghĩa `decidedAt/decidedById/decisionNote`
 * Cả hai lỗi bị `.catch(() => {})` nuốt → mất gate trong im lặng.
 *
 * TEST NÀY KHÔNG MOCK PRISMA cho phần kiểm tra payload. Prisma Client validate `data`
 * ở PHÍA CLIENT TRƯỚC khi gửi query, nên payload sai luôn bị PrismaClientValidationError
 * từ chối — chỉ cần client thật, không cần database sống.
 *
 * 4 lớp:
 *  A. payload từ builder đối chiếu trực tiếp prisma/schema.prisma (nguồn sự thật).
 *  B. validator THẬT của Prisma Client: payload sai phải bị từ chối, payload builder phải được chấp nhận.
 *  C. createGate/sweepExpiredHumanGates không nuốt lỗi; gate write-action vẫn có actionSummary.
 *  D. static guard chống tái diễn: không còn resolvedAt/resolvedBy/resolvedNote, không còn
 *     create rải rác ngoài module humangate, không còn .catch(() => {}), cron phải sweep EXPIRED.
 */
const fs = require('fs');
const path = require('path');

const {
  GATE_TTL_MS,
  clip,
  buildDataRequestGate,
  buildWriteActionGate,
  buildReminderGate,
  buildDecisionData,
  createGate,
  sweepExpiredHumanGates,
} = require('../src/modules/ai/agent.humangate');

// Prisma client THẬT (không jest.mock). pg Pool connect lười → khởi tạo không cần DB.
const prisma = require('../src/config/prisma');

// DB sống có thể mất vài giây cho mỗi query (connectionTimeoutMillis = 10s).
jest.setTimeout(30000);

const SCHEMA_PATH = path.join(__dirname, '..', 'prisma', 'schema.prisma');
const SCHEMA_SRC = fs.readFileSync(SCHEMA_PATH, 'utf8');
const AI_DIR = path.join(__dirname, '..', 'src', 'modules', 'ai');

// ─── Parser schema.prisma — đọc trực tiếp nguồn sự thật, không chép tay ───

function modelFields(model) {
  const re = new RegExp(`^model\\s+${model}\\s*\\{([\\s\\S]*?)^\\}`, 'm');
  const m = SCHEMA_SRC.match(re);
  if (!m) throw new Error(`Không tìm thấy model ${model} trong prisma/schema.prisma`);
  const fields = new Map();
  for (const raw of m[1].split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('//') || line.startsWith('///') || line.startsWith('@@')) continue;
    const [name, type] = line.split(/\s+/);
    fields.set(name, {
      name,
      type: type.replace(/\?$/, '').replace(/\[\]$/, ''),
      // Field không bắt buộc: nullable, list, có @default/@id (Prisma tự sinh),
      // @relation (field quan hệ — không phải column bắt buộc trong data), @updatedAt.
      optional:
        type.endsWith('?') ||
        type.endsWith('[]') ||
        /@id\b/.test(line) ||
        /@default\s*\(/.test(line) ||
        /@relation\s*\(/.test(line) ||
        /@updatedAt\b/.test(line),
    });
  }
  return fields;
}

function enumValues(name) {
  const re = new RegExp(`^enum\\s+${name}\\s*\\{([\\s\\S]*?)^\\}`, 'm');
  const m = SCHEMA_SRC.match(re);
  if (!m) return null;
  return m[1]
    .split(/\r?\n/)
    .map((l) => l.trim().split(/\s+/)[0])
    .filter((l) => l && !l.startsWith('//'));
}

const FIELDS = modelFields('AgentHumanGate');
const REQUIRED = [...FIELDS.values()].filter((f) => !f.optional).map((f) => f.name);
const GATE_STATUS = enumValues('HumanGateStatus') || [];

/**
 * Đối chiếu payload `data` với schema. Throw khi:
 *  - dùng field không tồn tại (bắt đúng lỗi resolvedAt/resolvedBy/resolvedNote)
 *  - thiếu field bắt buộc (bắt đúng lỗi thiếu actionSummary) — chỉ khi không phải update
 *  - sai kiểu String/DateTime/Json/enum
 *
 * @param {boolean} [opts.partial] true = payload của update() → không đòi field bắt buộc,
 *                                 nhưng VẪN chặn field lạ và sai kiểu (đủ bắt bug resolvedAt).
 */
function assertMatchesSchema(data, label, { partial = false } = {}) {
  const problems = [];

  for (const [key, value] of Object.entries(data)) {
    const field = FIELDS.get(key);
    if (!field) {
      const similar = [...FIELDS.keys()].filter((k) => k.startsWith(key.slice(0, 6)));
      problems.push(`field "${key}" KHÔNG tồn tại trong AgentHumanGate (gần đúng: ${similar.join(', ') || 'không có'})`);
      continue;
    }
    if (value === undefined || value === null) {
      if (!field.optional) problems.push(`field bắt buộc "${key}" nhận giá trị null/undefined`);
      continue;
    }
    if (field.type === 'String' && typeof value !== 'string') {
      problems.push(`field "${key}" phải là String, nhận ${typeof value}`);
    }
    if (field.type === 'DateTime' && !(value instanceof Date && !Number.isNaN(value.getTime()))) {
      problems.push(`field "${key}" phải là Date, nhận ${JSON.stringify(value)}`);
    }
    if (field.type === 'Json' && typeof value !== 'object') {
      problems.push(`field "${key}" phải là Json (object), nhận ${typeof value}`);
    }
    const allowed = enumValues(field.type);
    if (allowed && !allowed.includes(value)) {
      problems.push(`field "${key}" = "${value}" không thuộc enum ${field.type} [${allowed.join(', ')}]`);
    }
  }

  for (const name of REQUIRED) {
    if (!partial && data[name] === undefined) problems.push(`THIẾU field bắt buộc "${name}"`);
  }

  if (problems.length) throw new Error(`${label} lệch schema AgentHumanGate:\n  - ${problems.join('\n  - ')}`);
}

// ─── Lớp A: payload do builder sinh ra phải khớp schema ───

describe('Human-Gate builders — contract với prisma/schema.prisma', () => {
  it('schema AgentHumanGate bắt buộc có actionSummary + expiresAt (nền của các test dưới)', () => {
    // Nếu ai đó thêm @default cho actionSummary thì test "thiếu actionSummary bị từ chối"
    // ở lớp B trở nên vô nghĩa — assert này báo động sớm cho tình huống đó.
    expect(REQUIRED).toEqual(expect.arrayContaining(['sessionId', 'actionType', 'actionSummary', 'expiresAt']));
    expect(FIELDS.has('actionPayload')).toBe(true);
  });

  it('enum HumanGateStatus có đủ 4 trạng thái mà code đang dùng', () => {
    expect(GATE_STATUS).toEqual(expect.arrayContaining(['PENDING', 'APPROVED', 'REJECTED', 'EXPIRED']));
  });

  it('buildDataRequestGate khớp schema (PENDING, có actionSummary)', () => {
    const data = buildDataRequestGate({
      sessionId: 'sess-1',
      tool: 'searchCustomer',
      params: { keyword: 'An' },
      role: 'CASHIER',
      requestedById: 'u-1',
    });
    assertMatchesSchema(data, 'buildDataRequestGate');
    expect(data.status).toBe('PENDING');
    expect(data.actionType).toBe('DATA_REQUEST');
    expect(data.actionSummary.length).toBeGreaterThan(0);
    expect(data.actionSummary).toContain('searchCustomer');
    expect(data.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(GATE_TTL_MS).toBe(24 * 60 * 60 * 1000);
  });

  it('buildWriteActionGate khớp schema (APPROVED sẵn, có decidedById/decidedAt)', () => {
    const data = buildWriteActionGate({
      sessionId: 'sess-1',
      actionType: 'CREATE_ORDER',
      params: { customerId: 'c-1' },
      summary: 'Agent tạo đơn ORD-20260927-0001, tổng 2.500.000đ',
      decidedById: 'u-admin',
    });
    assertMatchesSchema(data, 'buildWriteActionGate');
    expect(data.status).toBe('APPROVED');
    expect(data.actionSummary).toContain('ORD-20260927-0001');
    expect(data.decidedAt).toBeInstanceOf(Date);
    expect(data.decidedById).toBe('u-admin');
  });

  it('buildReminderGate khớp schema', () => {
    const data = buildReminderGate({
      sessionId: 'sess-1',
      debtId: 'debt-1',
      customerName: 'Công ty TNHH Minh Anh',
      remaining: 4500000,
      message: 'Nhắn nhắc nợ',
    });
    assertMatchesSchema(data, 'buildReminderGate');
    expect(data.status).toBe('PENDING');
    expect(data.actionSummary).toContain('Công ty TNHH Minh Anh');
  });

  it('buildDecisionData chỉ dùng tên field của schema (decidedById/decisionNote/decidedAt)', () => {
    const data = buildDecisionData({ decision: 'APPROVED', note: 'OK', userId: 'u-admin' });
    // partial = true: đây là payload update() nên không cần field bắt buộc của create(),
    // nhưng mọi field phải CÓ THẬT trong schema — đủ để chặn resolvedAt/resolvedBy/resolvedNote.
    assertMatchesSchema(data, 'buildDecisionData', { partial: true });
    expect(Object.keys(data).sort()).toEqual(['decidedAt', 'decidedById', 'decisionNote', 'status']);
    expect(data).not.toHaveProperty('resolvedAt');
    expect(data).not.toHaveProperty('resolvedBy');
    expect(data).not.toHaveProperty('resolvedNote');
  });

  it('buildDecisionData sinh ra đúng bộ field cần thiết để audit trail còn vết', () => {
    const before = Date.now();
    const data = buildDecisionData({ decision: 'REJECTED', note: 'Không có thẩm quyền', userId: 'u-manager' });
    expect(data.status).toBe('REJECTED');
    expect(data.decidedById).toBe('u-manager');
    expect(data.decisionNote).toBe('Không có thẩm quyền');
    expect(data.decidedAt.getTime()).toBeGreaterThanOrEqual(before);
    // decisionNote rỗng phải thành null (cot nullable), khong phai chuoi rong
    expect(buildDecisionData({ decision: 'APPROVED', userId: 'u-1' }).decisionNote).toBeNull();
  });

  it('clip() luôn trả chuỗi để actionSummary (NOT NULL) không bao giờ vô nghĩa', () => {
    expect(clip(null)).toBe('');
    expect(typeof clip(undefined)).toBe('string');
    expect(clip('a'.repeat(500)).length).toBe(300);
    // builder không bao giờ để actionSummary rỗng kể cả khi caller quên truyền summary
    expect(buildWriteActionGate({ sessionId: 's', actionType: 'X' }).actionSummary.trim().length).toBeGreaterThan(0);
  });
});

// ─── Lớp B: validator THẬT của Prisma Client (không mock, không stub) ───
//
// Prisma validate `data` ngay trong client, TRƯỚC khi gửi query: payload thiếu field bắt
// buộc / chứa field lạ → PrismaClientValidationError trong vài ms, kể cả khi DB chết.
// Payload hợp lệ → lỗi ở tầng request (P2003 FK vì sessionId ma). Nhờ đó phân biệt được
// "payload sai" (bug thật) với "không có DB" (môi trường test).

const NIL_UUID = '00000000-0000-0000-0000-000000000000';

/**
 * Phân biệt "payload sai" với "payload đúng nhưng request fail".
 * Lưu ý: Prisma mở đầu message của CẢ validation error lẫn request error bằng
 * `Invalid \`prisma.xxx()\` invocation` → không được dùng chuỗi đó để nhận diện.
 * Chỉ tin tên class, và coi mọi lỗi có `code` Pxxxx là lỗi ở tầng request.
 */
const isValidationError = (err) => {
  if (!err) return false;
  const name = String(err.name || err.constructor?.name || '');
  if (name === 'PrismaClientValidationError') return true;
  if (/PrismaClientKnownRequestError|PrismaClientInitializationError|PrismaClientNetworkRequestError/.test(name)) {
    return false;
  }
  if (typeof err.code === 'string' && /^P\d{4}$/.test(err.code)) return false;
  return /Unknown arg|Argument `|is missing/i.test(String(err.message || ''));
};

/** Gửi payload thật tới Prisma; trả về lỗi nếu có, dọn row nếu chẳng may ghi được. */
async function tryCreate(data) {
  let err = null;
  let created = null;
  try {
    created = await prisma.agentHumanGate.create({ data });
  } catch (e) {
    err = e;
  }
  if (created) await prisma.agentHumanGate.delete({ where: { id: created.id } }).catch(() => {});
  return err;
}

afterAll(async () => {
  await prisma.$disconnect().catch(() => {});
});

describe('Prisma Client validator thật — bắt đúng 2 lỗi từng làm Human-Gate chết', () => {
  it('payload của buildDataRequestGate được Prisma chấp nhận (chỉ lỗi FK vì sessionId ma)', async () => {
    const err = await tryCreate(
      buildDataRequestGate({ sessionId: NIL_UUID, tool: 'searchCustomer', params: {}, role: 'CASHIER' }),
    );
    expect(isValidationError(err)).toBe(false);
    if (err) {
      // DB sống → P2003 (FK vì sessionId ma); DB chết → P1001/P1017/connection reset.
      // Điều duy nhất không được phép xảy ra: Prisma phàn nàn về chính payload.
      expect(String(err.message)).not.toMatch(/actionSummary|Unknown arg/i);
    }
  });

  it('REGRESSION: thiếu actionSummary → Prisma từ chối (đây chính là bug cũ)', async () => {
    const { actionSummary, ...withoutSummary } = buildDataRequestGate({
      sessionId: NIL_UUID,
      tool: 'searchCustomer',
      params: {},
    });
    expect(actionSummary.length).toBeGreaterThan(0);

    const err = await tryCreate(withoutSummary);
    expect(isValidationError(err)).toBe(true);
    expect(String(err.message)).toMatch(/actionSummary/);
  });

  it('REGRESSION: decide dùng resolvedAt/resolvedBy/resolvedNote → Prisma từ chối', async () => {
    let err = null;
    try {
      // payload cũ của POST /human-gates/:id/decide
      await prisma.agentHumanGate.update({
        where: { id: NIL_UUID },
        data: { status: 'APPROVED', resolvedAt: new Date(), resolvedBy: 'u-1', resolvedNote: 'ok' },
      });
    } catch (e) {
      err = e;
    }
    expect(isValidationError(err)).toBe(true);
    expect(String(err.message)).toMatch(/resolvedAt|resolvedBy|resolvedNote/);
  });

  it('REGRESSION: payload decide mới (decidedById/decisionNote/decidedAt) được chấp nhận', async () => {
    let err = null;
    try {
      await prisma.agentHumanGate.update({
        where: { id: NIL_UUID },
        data: buildDecisionData({ decision: 'REJECTED', note: 'Không đúng thẩm quyền', userId: NIL_UUID }),
      });
    } catch (e) {
      err = e;
    }
    // Gate không tồn tại → P2025; DB chết → lỗi kết nối. Miễn KHÔNG phải validation error.
    expect(isValidationError(err)).toBe(false);
  });
});

// ─── Lớp C: createGate / sweepExpiredHumanGates không được nuốt lỗi ───
//
// Fake client ở đây là DB-seam của chính module (tham số `client`), KHÔNG phải jest.mock
// toàn cục — payload đã được Prisma thật kiểm ở lớp B nên lớp C chỉ test điều khiển lỗi.

describe('createGate / sweepExpiredHumanGates — lỗi phải nổi lên, không im lặng', () => {
  const fakeClient = (impl) => ({ agentHumanGate: impl });

  it('createGate trả về gate đã lưu khi create thành công', async () => {
    const data = buildDataRequestGate({ sessionId: 's1', tool: 'searchCustomer' });
    const created = { id: 'gate-1', ...data };
    const client = fakeClient({
      create: async (args) => {
        expect(args.data).toEqual(data);
        return created;
      },
    });
    await expect(createGate(data, client)).resolves.toBe(created);
  });

  it('createGate REJECT và log error khi Prisma từ chối payload (bug cũ: .catch(() => {}))', async () => {
    const logger = require('../src/utils/logger');
    const spy = jest.spyOn(logger, 'error').mockImplementation(() => {});
    const client = fakeClient({
      create: async () => {
        throw new Error("Argument `actionSummary` is missing");
      },
    });
    await expect(createGate(buildDataRequestGate({ sessionId: 's', tool: 'x' }), client)).rejects.toThrow(
      /actionSummary/,
    );
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('sweepExpiredHumanGates chuyển PENDING quá hạn → EXPIRED và trả số gate đã quét', async () => {
    let args = null;
    const client = fakeClient({
      updateMany: async (a) => {
        args = a;
        return { count: 3 };
      },
    });
    await expect(sweepExpiredHumanGates(client)).resolves.toBe(3);
    expect(args.where.status).toBe('PENDING');
    expect(args.where.expiresAt.lt).toBeInstanceOf(Date);
    expect(args.data).toEqual({ status: 'EXPIRED' });
    // enum phải nhận được 'EXPIRED' — nếu schema đổi tên thì payload sẽ bị Prisma chặn
    expect(GATE_STATUS).toContain(args.data.status);
  });

  it('sweepExpiredHumanGates ném lỗi thật khi DB lỗi để cron log lại', async () => {
    const client = fakeClient({
      updateMany: async () => {
        throw new Error('connect ETIMEDOUT');
      },
    });
    await expect(sweepExpiredHumanGates(client)).rejects.toThrow(/ETIMEDOUT/);
  });
});

// ─── Lớp D: static guard — chống đúng các pattern đã gây ra sự cố ───

describe('Static guard — pattern gây chết Human-Gate không được quay lại', () => {
  const aiFiles = fs.readdirSync(AI_DIR).filter((f) => f.endsWith('.js'));
  const read = (dir, f) => fs.readFileSync(path.join(dir, f), 'utf8');

  it('module ai dùng duy nhất agent.humangate để tạo gate (không còn create rải rác)', () => {
    const offenders = aiFiles.filter(
      (f) => f !== 'agent.humangate.js' && /agentHumanGate\s*\.\s*create\s*\(/.test(read(AI_DIR, f)),
    );
    expect(offenders).toEqual([]);
  });

  it('không còn .catch(() => {}) nuốt lỗi lời gọi agentHumanGate', () => {
    const offenders = aiFiles.filter((f) =>
      /agentHumanGate[\s\S]{0,400}?\.catch\(\s*\(\)\s*=>\s*\{\s*\}\s*\)/.test(read(AI_DIR, f)),
    );
    expect(offenders).toEqual([]);
  });

  it('agent.routes.js decide dùng buildDecisionData và báo user khi gate fail', () => {
    const src = read(AI_DIR, 'agent.routes.js');
    expect(src).toMatch(/buildDecisionData\(/);
    expect(src).toMatch(/buildWriteActionGate\(/);
    // gate fail phải có tin nhắn cho user, không được trả lời "đã tạo yêu cầu" giả dối
    expect(src).toMatch(/DATA_REQUEST_FAILED_REPLY/);
    expect(src).not.toMatch(/resolvedAt|resolvedBy|resolvedNote/);
  });

  it('db-agent.service.js tạo gate nhắc nợ qua builder (không inline payload)', () => {
    const src = read(AI_DIR, 'db-agent.service.js');
    expect(src).toMatch(/buildReminderGate\(/);
    expect(src).toMatch(/createGate\(/);
  });

  it('cron đăng ký sweep human-gate hết hạn', () => {
    const src = read(path.join(__dirname, '..', 'src', 'jobs'), 'cron.js');
    expect(src).toMatch(/sweepExpiredHumanGates/);

    // Parse AST thay vì so chuỗi: "*/5 * * * *" hay '*/5 * * * *' đều chấp nhận,
    // nhưng nếu ai xóa/sửa lịch thì test phải báo.
    const ast = require('acorn').parse(src, { ecmaVersion: 'latest', sourceType: 'script' });
    const cronCalls = [];
    const walk = (node, depth = 0) => {
      if (!node || typeof node !== 'object' || depth > 60) return;
      if (node.type === 'CallExpression' && node.callee?.type === 'MemberExpression' &&
          node.callee.object?.name === 'cron' && node.callee.property?.name === 'schedule') {
        cronCalls.push(node.arguments[0]?.value);
      }
      for (const [k, v] of Object.entries(node)) {
        if (k === 'loc' || k === 'start' || k === 'end') continue;
        if (Array.isArray(v)) v.forEach((c) => walk(c, depth + 1));
        else if (v && typeof v === 'object' && v.type) walk(v, depth + 1);
      }
    };
    walk(ast);
    expect(cronCalls).toContain('*/5 * * * *');
  });
});
