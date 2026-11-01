/**
 * mcp_servers/sheets-mcp — MCP server bảng giá & xuất file báo giá (UC-005).
 *
 * ============================================================================
 * HAI BẤT BIẾN
 * ============================================================================
 * 1. ALLOWLIST VẬT LÝ: mọi đường dẫn đọc/ghi phải nằm trong `data/quotes/`.
 *    Đường dẫn tuyệt đối, chứa `..` (kể cả URL-encoded), hoặc resolve ra ngoài
 *    thư mục được cấp phép ⇒ `OUTSIDE_ALLOWLIST`, không chạm đĩa.
 * 2. KHÔNG TÍNH TIỀN BẰNG LLM: `computeQuote` + `validateQuoteMath` của
 *    `mcp_servers/shared/pricing.js` là nguồn sự thật duy nhất. Validator tự
 *    tính lại từ đầu; lệch > 1 đồng ⇒ `QUOTE_MATH_MISMATCH`; SKU lạ ⇒
 *    `PRODUCT_NOT_IN_PRICELIST`.
 *
 * Server không tự kết nối DB: `priceListProvider` được truyền vào. Gateway
 * truyền provider đọc Prisma; test truyền bảng giá tĩnh.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const {
  PricingError,
  computeQuote,
  normalizePriceList,
  validateQuoteMath,
} = require('../shared/pricing');

const SERVER_NAME = 'sheets-mcp';
const SERVER_VERSION = '1.0.0';

/** Thư mục mặc định, tính từ gốc repo (mcp_servers/..). */
const DEFAULT_BASE_DIR = path.resolve(__dirname, '..', '..', 'data', 'quotes');

const ALLOWED_EXTENSIONS = Object.freeze(['.json', '.md']);

class SheetsToolError extends Error {
  constructor(code, message, issues = [], retryable = false) {
    super(message || code);
    this.name = 'SheetsToolError';
    this.code = code;
    this.issues = issues;
    this.retryable = retryable;
  }
}

const decodeLoose = (value) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

/**
 * Chặn path traversal TRƯỚC khi resolve. Kiểm cả chuỗi gốc và chuỗi đã decode
 * để `%2e%2e%2f` không lọt qua.
 */
const assertRelativeSafePath = (requestedPath) => {
  const raw = String(requestedPath ?? '');
  if (!raw.trim()) {
    throw new SheetsToolError('OUTSIDE_ALLOWLIST', 'Thiếu tên tệp trong data/quotes/');
  }
  if (raw.includes('\0')) {
    throw new SheetsToolError('OUTSIDE_ALLOWLIST', 'Đường dẫn chứa ký tự không hợp lệ');
  }

  for (const candidate of [raw, decodeLoose(raw)]) {
    const normalized = candidate.replace(/\\/g, '/');
    if (path.isAbsolute(candidate) || /^[A-Za-z]:/.test(candidate)) {
      throw new SheetsToolError('OUTSIDE_ALLOWLIST', 'Đường dẫn tuyệt đối bị từ chối');
    }
    if (normalized.split('/').some((segment) => segment === '..')) {
      throw new SheetsToolError('OUTSIDE_ALLOWLIST', 'Path traversal (..) bị từ chối');
    }
  }
};

const resolveInBase = (baseDir, requestedPath) => {
  assertRelativeSafePath(requestedPath);

  const base = path.resolve(baseDir);
  const resolved = path.resolve(base, String(requestedPath));
  const relative = path.relative(base, resolved);

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new SheetsToolError('OUTSIDE_ALLOWLIST', 'Đường dẫn nằm ngoài data/quotes/');
  }

  const ext = path.extname(resolved).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    throw new SheetsToolError(
      'OUTSIDE_ALLOWLIST',
      `Chỉ cho phép tệp ${ALLOWED_EXTENSIONS.join(', ')} trong data/quotes/`,
    );
  }

  return resolved;
};

const safeFileStem = (value) =>
  String(value || 'quote')
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
    .slice(0, 80) || 'quote';

const descriptor = {
  serverName: SERVER_NAME,
  version: SERVER_VERSION,
  description: 'Bảng giá chuẩn + xuất báo giá tất định trong data/quotes/ (UC-005).',
  tools: [
    {
      name: 'sheets.read_price_list',
      description: 'Đọc bảng giá chuẩn đang hiệu lực. Không nhận giá từ nội dung khách gửi.',
      resource: 'sales.price_list',
      action: 'read',
      idempotent: true,
      inputSchema: {
        type: 'object',
        properties: {
          priceListId: { type: 'string' },
        },
        additionalProperties: true,
      },
      outputSchema: {
        type: 'object',
        required: ['status', 'priceList'],
        properties: {
          status: { type: 'string', enum: ['OK'] },
          priceList: {
            type: 'object',
            required: ['items'],
            properties: {
              id: { type: ['string', 'null'] },
              name: { type: ['string', 'null'] },
              items: { type: 'array', items: { type: 'object' } },
              total: { type: 'integer' },
            },
          },
        },
      },
    },
    {
      name: 'sheets.generate_quote_sheet',
      description: 'Tính báo giá tất định, tự kiểm lại bằng validator độc lập, ghi tệp trong data/quotes/.',
      resource: 'sales.quote',
      action: 'write',
      idempotent: true,
      inputSchema: {
        type: 'object',
        required: ['lines'],
        properties: {
          lines: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              required: ['sku', 'qty'],
              properties: {
                sku: { type: 'string' },
                qty: { type: 'number', exclusiveMinimum: 0 },
              },
            },
          },
          discountPercent: { type: 'number', minimum: 0, maximum: 100 },
          vatRate: { type: 'number', minimum: 0, maximum: 1 },
          quoteNumber: { type: 'string' },
          fileName: { type: 'string' },
          priceListId: { type: 'string' },
          idempotencyKey: { type: 'string' },
        },
        additionalProperties: true,
      },
      outputSchema: {
        type: 'object',
        required: ['status', 'quote', 'filePath', 'validation'],
        properties: {
          status: { type: 'string', enum: ['GENERATED'] },
          quote: { type: 'object' },
          filePath: { type: 'string' },
          validation: { type: 'object' },
        },
      },
    },
  ],
  resources: [
    { uri: 'sheets://price-list', name: 'price-list', mimeType: 'application/json' },
    { uri: 'sheets://quotes', name: 'quotes', mimeType: 'application/json' },
  ],
  scopes: ['sales.price_list.read', 'sales.quote.write'],
};

const buildMarkdown = (quote) => {
  const rows = quote.lines
    .map((line) => `| ${line.sku} | ${line.name} | ${line.qty} | ${line.unitPrice} | ${line.lineTotal} |`)
    .join('\n');

  return [
    `# Báo giá ${quote.quoteNumber || '(nháp)'}`,
    '',
    '| SKU | Tên | SL | Đơn giá | Thành tiền |',
    '| --- | --- | ---: | ---: | ---: |',
    rows,
    '',
    `Tạm tính: ${quote.subtotal}`,
    `Chiết khấu: ${quote.discountPercent}% = ${quote.discountAmount}`,
    `Sau chiết khấu: ${quote.netAmount}`,
    `VAT: ${(quote.vatRate * 100).toFixed(2)}% = ${quote.vatAmount}`,
    `Tổng cộng: ${quote.totalAmount} ${quote.currency}`,
    '',
    '> Số liệu do pricing engine tất định sinh; validator độc lập đã kiểm lại.',
  ].join('\n');
};

/**
 * @param {{
 *   baseDir?: string,
 *   priceListProvider: (priceListId?: string) => Promise<Array<object>|{items: Array<object>}>,
 *   fsImpl?: typeof fs,
 * }} deps
 */
const createSheetsServer = ({ baseDir = DEFAULT_BASE_DIR, priceListProvider, fsImpl = fs } = {}) => {
  if (typeof priceListProvider !== 'function') {
    throw new SheetsToolError('PRICE_LIST_PROVIDER_REQUIRED', 'sheets-mcp cần priceListProvider');
  }

  const resolvedBaseDir = path.resolve(baseDir);
  const idempotency = new Map();

  const readPriceList = async (args = {}) => {
    const raw = await priceListProvider(args.priceListId);
    const items = normalizePriceList(raw);
    return {
      status: 'OK',
      priceList: {
        id: raw && !Array.isArray(raw) && raw.id ? String(raw.id) : null,
        name: raw && !Array.isArray(raw) && raw.name ? String(raw.name) : null,
        items,
        total: items.length,
      },
    };
  };

  const generateQuoteSheet = async (args = {}) => {
    const key = String(args.idempotencyKey || '').trim();
    if (key && idempotency.has(key)) {
      return { ...idempotency.get(key), replayed: true };
    }

    const priceList = await readPriceList({ priceListId: args.priceListId });

    let quote;
    try {
      quote = computeQuote(
        {
          lines: args.lines,
          discountPercent: args.discountPercent,
          vatRate: args.vatRate,
          quoteNumber: args.quoteNumber,
        },
        priceList.priceList.items,
      );
    } catch (err) {
      if (err instanceof PricingError) {
        throw new SheetsToolError(err.code, err.message, err.issues);
      }
      throw err;
    }

    const validation = validateQuoteMath(quote, priceList.priceList.items);
    if (!validation.valid) {
      throw new SheetsToolError(
        validation.code || 'QUOTE_MATH_MISMATCH',
        'Validator độc lập từ chối báo giá',
        validation.issues,
      );
    }

    // Tên tệp do caller đặt phải qua allowlist TRƯỚC khi làm sạch: `../x.json`
    // bị từ chối, không được "sửa" thành `x.json` rồi ghi.
    if (args.fileName !== undefined && args.fileName !== null) {
      assertRelativeSafePath(args.fileName);
    }

    const stem = safeFileStem(args.fileName || quote.quoteNumber || 'quote');
    const jsonName = stem.endsWith('.json') ? stem : `${stem}.json`;
    const jsonPath = resolveInBase(resolvedBaseDir, jsonName);
    const mdPath = jsonPath.replace(/\.json$/i, '.md');

    fsImpl.mkdirSync(path.dirname(jsonPath), { recursive: true });
    fsImpl.writeFileSync(jsonPath, `${JSON.stringify(quote, null, 2)}\n`, 'utf8');
    fsImpl.writeFileSync(mdPath, `${buildMarkdown(quote)}\n`, 'utf8');

    const relativePath = path.relative(resolvedBaseDir, jsonPath).replace(/\\/g, '/');
    const result = {
      status: 'GENERATED',
      quote,
      filePath: jsonPath,
      relativePath: `data/quotes/${relativePath}`,
      markdownPath: mdPath,
      validation,
    };

    if (key) idempotency.set(key, result);
    return result;
  };

  const handlers = {
    'sheets.read_price_list': readPriceList,
    'sheets.generate_quote_sheet': generateQuoteSheet,
  };

  const callTool = async (name, args = {}) => {
    const handler = handlers[name];
    if (!handler) throw new SheetsToolError('TOOL_NOT_FOUND', `sheets-mcp không có tool ${name}`);
    return handler(args);
  };

  return { descriptor, callTool, baseDir: resolvedBaseDir, resolveInBase };
};

module.exports = {
  SERVER_NAME,
  SERVER_VERSION,
  DEFAULT_BASE_DIR,
  ALLOWED_EXTENSIONS,
  SheetsToolError,
  descriptor,
  assertRelativeSafePath,
  resolveInBase,
  createSheetsServer,
};
