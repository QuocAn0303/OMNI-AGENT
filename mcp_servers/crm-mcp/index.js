/**
 * mcp_servers/crm-mcp — MCP server quản lý khách hàng & deal cho UC-005.
 *
 * ============================================================================
 * CHỐNG TẠO TRÙNG KHÁCH HÀNG (0% duplicate)
 * ============================================================================
 * Thứ tự quyết định, KHÔNG được đảo:
 *   1. Chuẩn hoá SĐT (`+84…` → `0…`), email (lowercase), tên (bỏ dấu/khoảng trắng).
 *   2. Khớp CHÍNH XÁC SĐT hoặc email ⇒ cập nhật bản ghi cũ
 *      (`reusedExisting: true`), tuyệt đối không tạo mới.
 *   3. Không khớp SĐT/email nhưng có tên trùng/gần giống ⇒
 *      `CUSTOMER_AMBIGUOUS` + `candidates[]`, KHÔNG ghi gì.
 *   4. Chỉ khi cả ba bước trên đều trống mới tạo khách hàng mới.
 *
 * Server là hàm thuần theo nghĩa không tự kết nối DB: repository được truyền
 * vào. Nhờ vậy cùng một logic chạy được ở test (in-memory) và ở gateway
 * (Prisma), không có bản sao thứ hai của quy tắc chống trùng.
 *
 * KHÔNG có tool xoá khách hàng. Role CASHIER (CSKH) chỉ được tìm kiếm, tạo/
 * cập nhật thông tin cơ bản và ghi chú; mọi nỗ lực đổi hạn mức tín dụng/chiết
 * khấu bị từ chối với `FORBIDDEN_FIELD`.
 */

'use strict';

const SERVER_NAME = 'crm-mcp';
const SERVER_VERSION = '1.0.0';

/** Ngưỡng tương đồng tên để coi là "gần giống". */
const MIN_NAME_SIMILARITY = 0.82;

const CASHIER_FORBIDDEN_FIELDS = Object.freeze([
  'creditLimit',
  'discountLimit',
  'discountPercent',
  'tier',
]);

class CrmToolError extends Error {
  constructor(code, message, issues = [], retryable = false) {
    super(message || code);
    this.name = 'CrmToolError';
    this.code = code;
    this.issues = issues;
    this.retryable = retryable;
  }
}

const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * Chuẩn hoá SĐT Việt Nam về dạng nội địa `0xxxxxxxxx`.
 * `+84 90 123 4567`, `0084...`, `84...` đều thành `0901234567`.
 */
const normalizePhone = (value) => {
  let digits = String(value ?? '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('0084')) digits = `0${digits.slice(4)}`;
  else if (digits.startsWith('84') && digits.length >= 11) digits = `0${digits.slice(2)}`;
  return digits;
};

const normalizeEmail = (value) => String(value ?? '').trim().toLowerCase();

/** Bỏ dấu tiếng Việt, bỏ ký tự trang trí, gộp khoảng trắng. */
const normalizeName = (value) =>
  String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');

const levenshtein = (left, right) => {
  if (left === right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;

  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost);
    }
    previous = current;
  }
  return previous[right.length];
};

/** Điểm tương đồng 0..1 giữa hai tên đã chuẩn hoá. */
const nameSimilarity = (left, right) => {
  const a = normalizeName(left);
  const b = normalizeName(right);
  if (!a || !b) return 0;
  if (a === b) return 1;

  const distance = levenshtein(a, b);
  const editScore = 1 - distance / Math.max(a.length, b.length);

  const aTokens = new Set(a.split(' ').filter(Boolean));
  const bTokens = new Set(b.split(' ').filter(Boolean));
  const intersection = [...aTokens].filter((token) => bTokens.has(token)).length;
  const union = new Set([...aTokens, ...bTokens]).size;
  const jaccard = union ? intersection / union : 0;

  return Math.max(editScore, jaccard);
};

const publicCustomer = (row) => {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    phone: row.phone || null,
    email: row.email || null,
    address: row.address || null,
    taxCode: row.taxCode || null,
    creditLimit: row.creditLimit === undefined || row.creditLimit === null
      ? null
      : toNumber(row.creditLimit),
    tier: row.tier || null,
    isActive: row.isActive !== false,
  };
};

const candidateOf = (customer, score, reasons) => ({
  ...publicCustomer(customer),
  score: Number(score.toFixed(3)),
  reasons,
});

const descriptor = {
  serverName: SERVER_NAME,
  version: SERVER_VERSION,
  description: 'CRM khách hàng & deal cho báo giá bán hàng (UC-005).',
  tools: [
    {
      name: 'crm.search_customer',
      description: 'Tìm khách hàng theo SĐT/email/tên đã chuẩn hoá, trả ứng viên gần đúng.',
      resource: 'crm.customer',
      action: 'read',
      idempotent: true,
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          phone: { type: 'string' },
          email: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 50 },
        },
        additionalProperties: true,
      },
      outputSchema: {
        type: 'object',
        required: ['status', 'customers'],
        properties: {
          status: { type: 'string', enum: ['OK'] },
          total: { type: 'integer' },
          customers: { type: 'array', items: { type: 'object' } },
        },
      },
    },
    {
      name: 'crm.upsert_customer',
      description: 'Tạo/cập nhật khách hàng chống trùng; trả CUSTOMER_AMBIGUOUS nếu tên gần giống.',
      resource: 'crm.customer',
      action: 'write',
      idempotent: true,
      inputSchema: {
        type: 'object',
        required: ['customer'],
        properties: {
          customer: {
            type: 'object',
            required: ['name'],
            properties: {
              name: { type: 'string' },
              phone: { type: 'string' },
              email: { type: 'string' },
              address: { type: 'string' },
              taxCode: { type: 'string' },
              creditLimit: { type: 'number' },
            },
          },
          actorRole: { type: 'string' },
          idempotencyKey: { type: 'string' },
        },
        additionalProperties: true,
      },
      outputSchema: {
        type: 'object',
        required: ['status', 'reusedExisting'],
        properties: {
          status: { type: 'string', enum: ['CREATED', 'UPDATED', 'CUSTOMER_AMBIGUOUS'] },
          reusedExisting: { type: 'boolean' },
          matchedBy: { type: 'string', enum: ['phone', 'email', 'name', null] },
          customer: { type: ['object', 'null'] },
          candidates: { type: 'array', items: { type: 'object' } },
        },
      },
    },
    {
      name: 'crm.update_deal',
      description: 'Cập nhật deal CRM (không có tool xoá). CASHIER chỉ được đổi nextStep.',
      resource: 'crm.deal',
      action: 'write',
      idempotent: true,
      inputSchema: {
        type: 'object',
        required: ['dealId', 'patch'],
        properties: {
          dealId: { type: 'string' },
          patch: { type: 'object' },
          actorRole: { type: 'string' },
          idempotencyKey: { type: 'string' },
        },
        additionalProperties: true,
      },
      outputSchema: {
        type: 'object',
        required: ['status', 'dealId'],
        properties: {
          status: { type: 'string', enum: ['UPDATED'] },
          dealId: { type: 'string' },
          deal: { type: ['object', 'null'] },
        },
      },
    },
  ],
  resources: [
    { uri: 'crm://customers', name: 'customers', mimeType: 'application/json' },
    { uri: 'crm://deals', name: 'deals', mimeType: 'application/json' },
  ],
  scopes: ['crm.customer.read', 'crm.customer.write', 'crm.deal.write'],
};

const assertCustomer = (customer) => {
  if (!customer || typeof customer !== 'object' || Array.isArray(customer)) {
    throw new CrmToolError('INVALID_CUSTOMER', 'customer phải là object');
  }
  if (!String(customer.name || '').trim()) {
    throw new CrmToolError('INVALID_CUSTOMER', 'customer.name là bắt buộc');
  }
};

const assertNotCashierEscalation = (role, payload, keys) => {
  if (String(role || '').toUpperCase() !== 'CASHIER') return;
  const forbidden = keys.filter((key) => payload[key] !== undefined && payload[key] !== null);
  if (forbidden.length > 0) {
    throw new CrmToolError(
      'FORBIDDEN_FIELD',
      `Role CASHIER không được thay đổi: ${forbidden.join(', ')}`,
      forbidden.map((field) => ({ code: 'FORBIDDEN_FIELD', field })),
    );
  }
};

/**
 * @param {{
 *   repository: {
 *     listCustomers: () => Promise<object[]>,
 *     createCustomer: (data: object, options?: object) => Promise<object>,
 *     updateCustomer: (id: string, patch: object) => Promise<object>,
 *     getDeal: (id: string) => Promise<object|null>,
 *     updateDeal: (id: string, patch: object) => Promise<object>,
 *   },
 * }} deps
 */
const createCrmServer = ({ repository } = {}) => {
  if (!repository || typeof repository.listCustomers !== 'function') {
    throw new CrmToolError('CRM_REPOSITORY_REQUIRED', 'crm-mcp cần repository.listCustomers');
  }

  const idempotency = new Map();

  const readIdempotent = async (key) => {
    if (!key) return null;
    if (idempotency.has(key)) return idempotency.get(key);
    if (typeof repository.getIdempotency === 'function') {
      const stored = await repository.getIdempotency(key);
      if (stored) idempotency.set(key, stored);
      return stored || null;
    }
    return null;
  };

  const writeIdempotent = async (key, value) => {
    if (!key) return;
    idempotency.set(key, value);
    if (typeof repository.saveIdempotency === 'function') {
      await repository.saveIdempotency(key, value);
    }
  };

  const searchCustomer = async (args = {}) => {
    const query = String(args.query || '').trim();
    const phone = normalizePhone(args.phone || query);
    const email = normalizeEmail(args.email || query);
    const nameQuery = normalizeName(query);
    const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 50);

    const rows = await repository.listCustomers();
    const scored = [];

    for (const row of rows) {
      if (row.isActive === false) continue;
      const reasons = [];
      let score = 0;
      if (phone && normalizePhone(row.phone) && normalizePhone(row.phone) === phone) {
        reasons.push('phone');
        score = Math.max(score, 1);
      }
      if (email && normalizeEmail(row.email) && normalizeEmail(row.email) === email) {
        reasons.push('email');
        score = Math.max(score, 1);
      }
      if (nameQuery) {
        const similarity = nameSimilarity(row.name, query);
        if (similarity >= MIN_NAME_SIMILARITY) {
          reasons.push('name');
          score = Math.max(score, similarity);
        }
      }
      if (reasons.length > 0) scored.push(candidateOf(row, score, reasons));
    }

    scored.sort((left, right) => right.score - left.score || left.name.localeCompare(right.name));
    return {
      status: 'OK',
      query: query || null,
      total: scored.length,
      customers: scored.slice(0, limit),
    };
  };

  const upsertCustomer = async (args = {}) => {
    const key = String(args.idempotencyKey || '').trim();
    if (key) {
      const cached = await readIdempotent(key);
      if (cached) return { ...cached, replayed: true };
    }

    assertCustomer(args.customer);
    const role = String(args.actorRole || '').toUpperCase();
    assertNotCashierEscalation(role, args.customer, CASHIER_FORBIDDEN_FIELDS);

    const input = args.customer;
    const name = String(input.name).trim();
    const phone = normalizePhone(input.phone);
    const email = normalizeEmail(input.email);

    const rows = await repository.listCustomers();
    const active = rows.filter((row) => row.isActive !== false);

    const phoneMatches = phone ? active.filter((row) => normalizePhone(row.phone) === phone) : [];
    const emailMatches = email ? active.filter((row) => normalizeEmail(row.email) === email) : [];

    // SĐT và email trỏ về HAI khách khác nhau: không được gộp mù. Trả ứng viên
    // để người dùng quyết định — tạo mới hay gộp sẽ làm sai hồ sơ.
    if (
      phoneMatches.length > 0
      && emailMatches.length > 0
      && phoneMatches[0].id !== emailMatches[0].id
    ) {
      const candidates = [
        candidateOf(phoneMatches[0], 1, ['phone']),
        candidateOf(emailMatches[0], 1, ['email']),
      ];
      return {
        status: 'CUSTOMER_AMBIGUOUS',
        reusedExisting: false,
        matchedBy: null,
        customer: null,
        candidates,
      };
    }

    const existing = phoneMatches[0] || emailMatches[0] || null;
    if (existing) {
      const patch = {};
      if (name) patch.name = name;
      if (phone) patch.phone = phone;
      if (email) patch.email = email;
      if (input.address !== undefined) patch.address = String(input.address || '').trim() || null;
      if (input.taxCode !== undefined) patch.taxCode = String(input.taxCode || '').trim() || null;
      if (role !== 'CASHIER' && input.creditLimit !== undefined) {
        patch.creditLimit = toNumber(input.creditLimit);
      }

      const updated = await repository.updateCustomer(existing.id, patch);
      const result = {
        status: 'UPDATED',
        reusedExisting: true,
        matchedBy: phoneMatches.length > 0 ? 'phone' : 'email',
        customer: publicCustomer(updated),
        candidates: [],
      };
      await writeIdempotent(key, result);
      return result;
    }

    // Không khớp SĐT/email: kiểm tra tên gần giống TRƯỚC khi tạo.
    const nameCandidates = active
      .map((row) => ({ row, score: nameSimilarity(row.name, name) }))
      .filter(({ score }) => score >= MIN_NAME_SIMILARITY)
      .sort((left, right) => right.score - left.score)
      .slice(0, 5)
      .map(({ row, score }) => candidateOf(row, score, ['name']));

    if (nameCandidates.length > 0) {
      return {
        status: 'CUSTOMER_AMBIGUOUS',
        reusedExisting: false,
        matchedBy: 'name',
        customer: null,
        candidates: nameCandidates,
      };
    }

    const data = {
      name,
      phone: phone || null,
      email: email || null,
      address: input.address === undefined ? null : String(input.address || '').trim() || null,
      taxCode: input.taxCode === undefined ? null : String(input.taxCode || '').trim() || null,
    };
    if (role !== 'CASHIER' && input.creditLimit !== undefined) {
      data.creditLimit = toNumber(input.creditLimit);
    }

    const created = await repository.createCustomer(data, { idempotencyKey: key || null });
    const result = {
      status: 'CREATED',
      reusedExisting: false,
      matchedBy: null,
      customer: publicCustomer(created),
      candidates: [],
    };
    await writeIdempotent(key, result);
    return result;
  };

  const updateDeal = async (args = {}) => {
    const key = String(args.idempotencyKey || '').trim();
    if (key) {
      const cached = await readIdempotent(key);
      if (cached) return { ...cached, replayed: true };
    }

    const dealId = String(args.dealId || '').trim();
    if (!dealId) throw new CrmToolError('INVALID_DEAL', 'dealId là bắt buộc');
    if (!args.patch || typeof args.patch !== 'object' || Array.isArray(args.patch)) {
      throw new CrmToolError('INVALID_DEAL', 'patch phải là object');
    }

    const role = String(args.actorRole || '').toUpperCase();
    assertNotCashierEscalation(role, args.patch, ['value', 'discountPercent', 'discountLimit', 'creditLimit']);

    const deal = await repository.getDeal(dealId);
    if (!deal) throw new CrmToolError('DEAL_NOT_FOUND', `Không tìm thấy deal ${dealId}`);

    const allowed = role === 'CASHIER'
      ? ['nextStep']
      : ['dealName', 'nextStep', 'value', 'probability', 'expectedCloseDate', 'lostReason', 'stageId'];
    const patch = {};
    for (const field of allowed) {
      if (args.patch[field] !== undefined) patch[field] = args.patch[field];
    }
    if (Object.keys(patch).length === 0) {
      throw new CrmToolError('INVALID_DEAL', 'patch không có trường được phép cập nhật');
    }

    const updated = await repository.updateDeal(dealId, patch);
    const result = { status: 'UPDATED', dealId, deal: updated || null };
    await writeIdempotent(key, result);
    return result;
  };

  const handlers = {
    'crm.search_customer': searchCustomer,
    'crm.upsert_customer': upsertCustomer,
    'crm.update_deal': updateDeal,
  };

  const callTool = async (name, args = {}) => {
    const handler = handlers[name];
    if (!handler) throw new CrmToolError('TOOL_NOT_FOUND', `crm-mcp không có tool ${name}`);
    return handler(args);
  };

  return { descriptor, callTool };
};

module.exports = {
  SERVER_NAME,
  SERVER_VERSION,
  MIN_NAME_SIMILARITY,
  CrmToolError,
  normalizePhone,
  normalizeEmail,
  normalizeName,
  nameSimilarity,
  descriptor,
  createCrmServer,
};
