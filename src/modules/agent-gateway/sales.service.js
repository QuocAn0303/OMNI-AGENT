/**
 * modules/agent-gateway/sales.service.js — UC-005: CRM + báo giá + thư nháp.
 *
 * ============================================================================
 * TÁCH BIỆT KHỎI MUA HÀNG
 * ============================================================================
 * Báo giá bán hàng ở đây KHÔNG dùng `RfqQuotation`/`PurchaseOrder`. Mọi phép
 * tính tiền dùng chung `mcp_servers/shared/pricing.js` với agent TypeScript —
 * một nguồn sự thật, sai số ≤ 1 đồng.
 *
 * ============================================================================
 * BA MCP SERVER, HAI REPOSITORY
 * ============================================================================
 * Server CommonJS trong `mcp_servers/` nhận repository từ tệp này:
 *   - crm-mcp   → Prisma Customer/CrmDeal
 *   - sheets-mcp→ Product.price + allowlist `data/quotes/`
 *   - mail-mcp  → SalesQuoteDraft + CrmCommunication
 *
 * Không có tool gửi thư. Thư luôn `DRAFT` / `sent: false`.
 */
const path = require('path');

const prisma = require('../../config/prisma');
const logger = require('../../utils/logger');
const ApiError = require('../../utils/apiError');
const { createGatewayGate, getGatewayGate } = require('./agent-gateway.service');

const { createCrmServer } = require('../../../mcp_servers/crm-mcp');
const { createSheetsServer } = require('../../../mcp_servers/sheets-mcp');
const { createMailServer } = require('../../../mcp_servers/mail-mcp');
const { computeQuote, validateQuoteMath, PricingError } = require('../../../mcp_servers/shared/pricing');

const QUOTE_ACTION_TYPE = 'QUOTE_DISCOUNT_APPROVAL';
/** Hạn mức tự quyết của nhân viên SALES — khớp policy `agents/`. */
const SALES_DISCOUNT_THRESHOLD_PERCENT = 10;
const QUOTE_DIR = path.resolve(__dirname, '../../../data/quotes');

const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const trimText = (value) => String(value ?? '').trim();

const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const formatVnd = (value) => `${Math.round(toNumber(value)).toLocaleString('vi-VN')} VND`;

const customerSelect = {
  id: true,
  name: true,
  phone: true,
  email: true,
  address: true,
  taxCode: true,
  creditLimit: true,
  tier: true,
  isActive: true,
};

// ─────────────────────────────────────────────────────────────────────────────
// Repository cho crm-mcp
// ─────────────────────────────────────────────────────────────────────────────

const crmRepository = {
  async listCustomers() {
    return prisma.customer.findMany({
      where: { isActive: true },
      select: customerSelect,
    });
  },

  async createCustomer(data) {
    return prisma.customer.create({
      data: {
        name: data.name,
        phone: data.phone || null,
        email: data.email || null,
        address: data.address || null,
        taxCode: data.taxCode || null,
        ...(data.creditLimit === undefined ? {} : { creditLimit: data.creditLimit }),
      },
      select: customerSelect,
    });
  },

  async updateCustomer(id, patch) {
    const data = { ...patch };
    if (data.creditLimit !== undefined) data.creditLimit = toNumber(data.creditLimit);
    return prisma.customer.update({
      where: { id },
      data,
      select: customerSelect,
    });
  },

  async getDeal(dealId) {
    return prisma.crmDeal.findFirst({
      where: { id: dealId },
      include: { customer: { select: { id: true, name: true, email: true } } },
    });
  },

  async updateDeal(dealId, patch) {
    const data = { ...patch };
    if (data.value !== undefined) data.value = toNumber(data.value);
    return prisma.crmDeal.update({
      where: { id: dealId },
      data,
      include: { customer: { select: { id: true, name: true, email: true } } },
    });
  },
};

const crmServer = createCrmServer({ repository: crmRepository });

// ─────────────────────────────────────────────────────────────────────────────
// Repository cho sheets-mcp
// ─────────────────────────────────────────────────────────────────────────────

const priceListProvider = async () => {
  const products = await prisma.product.findMany({
    where: { isActive: true },
    select: { sku: true, name: true, price: true },
    orderBy: { sku: 'asc' },
  });

  return {
    id: 'standard',
    name: 'Bảng giá chuẩn',
    items: products.map((product) => ({
      sku: product.sku,
      name: product.name,
      unitPrice: toNumber(product.price),
      vatRate: 0.1,
      active: true,
    })),
  };
};

const sheetsServer = createSheetsServer({
  baseDir: QUOTE_DIR,
  priceListProvider,
});

// ─────────────────────────────────────────────────────────────────────────────
// Repository cho mail-mcp
// ─────────────────────────────────────────────────────────────────────────────

const recipientAllowlist = String(process.env.SALES_EMAIL_ALLOWLIST || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

const mailRepository = {
  async listInbox({ limit }) {
    const rows = await prisma.crmCommunication.findMany({
      where: { type: 'EMAIL' },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map((row) => ({
      id: row.id,
      from: row.direction === 'INBOUND' ? 'customer' : 'company',
      subject: row.subject,
      body: row.content,
      createdAt: row.createdAt,
    }));
  },

  async readEmail(id) {
    const row = await prisma.crmCommunication.findFirst({ where: { id } });
    if (!row) return null;
    return {
      id: row.id,
      from: row.direction === 'INBOUND' ? 'customer' : 'company',
      subject: row.subject,
      body: row.content,
      createdAt: row.createdAt,
    };
  },

  async getDealCustomerEmail(dealId) {
    const deal = await prisma.crmDeal.findFirst({
      where: { id: dealId },
      include: { customer: { select: { email: true } } },
    });
    return deal?.customer?.email || null;
  },

  async createDraft(data) {
    // Idempotency key do mail-mcp sinh (ổn định xuyên retry/resume). Nếu thiếu,
    // dựng khoá từ chính nội dung để unique constraint vẫn chặn bản ghi thứ hai.
    const idempotencyKey = trimText(data.idempotencyKey)
      || `mail:${trimText(data.quoteId) || 'quote'}:${trimText(data.to)}:${trimText(data.subject)}`;

    const existing = await prisma.salesQuoteDraft.findFirst({ where: { idempotencyKey } });
    if (existing) return existing;

    return prisma.salesQuoteDraft.create({
      data: {
        quoteNumber: data.quoteId || null,
        customerId: data.customerId || null,
        dealId: data.dealId || null,
        status: 'DRAFT',
        sent: false,
        recipient: data.to,
        subject: data.subject,
        body: data.body,
        lines: [],
        idempotencyKey,
      },
    });
  },
};

const mailServer = createMailServer({
  repository: mailRepository,
  recipientAllowlist,
});

const servers = {
  'crm-mcp': crmServer,
  'sheets-mcp': sheetsServer,
  'mail-mcp': mailServer,
};

const callTool = async (serverName, toolName, args) => {
  const server = servers[serverName];
  if (!server) throw new ApiError(500, `MCP server chưa cấu hình: ${serverName}`);
  try {
    return await server.callTool(toolName, args || {});
  } catch (err) {
    logger.warn(`[sales-mcp] ${serverName}:${toolName} lỗi ${err.code || err.name}: ${err.message}`);
    throw new ApiError(
      err.code === 'CUSTOMER_AMBIGUOUS' ? 409 : 400,
      err.message || `MCP call thất bại (${toolName})`,
      {
        code: err.code || 'MCP_CALL_FAILED',
        server: serverName,
        tool: toolName,
        issues: err.issues || [],
      },
    );
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Nghiệp vụ
// ─────────────────────────────────────────────────────────────────────────────

const searchCustomers = async ({ query, phone, email, limit }) =>
  callTool('crm-mcp', 'crm.search_customer', { query, phone, email, limit });

const upsertCustomer = async ({ customer, actorRole, idempotencyKey }) => {
  if (!isRecord(customer) || !trimText(customer.name)) {
    throw new ApiError(400, 'customer.name là bắt buộc');
  }
  return callTool('crm-mcp', 'crm.upsert_customer', {
    customer,
    actorRole,
    idempotencyKey,
  });
};

const updateDeal = async ({ dealId, patch, actorRole, idempotencyKey }) => {
  if (!trimText(dealId)) throw new ApiError(400, 'dealId là bắt buộc');
  if (!isRecord(patch)) throw new ApiError(400, 'patch phải là object');
  return callTool('crm-mcp', 'crm.update_deal', {
    dealId: trimText(dealId),
    patch,
    actorRole,
    idempotencyKey,
  });
};

const readPriceList = async ({ priceListId } = {}) =>
  callTool('sheets-mcp', 'sheets.read_price_list', { priceListId });

const ensurePriceList = async (priceListId) => {
  const result = await readPriceList({ priceListId });
  return result.priceList;
};

const computeAndValidate = (input, priceList) => {
  try {
    const quote = computeQuote(input, priceList.items);
    const validation = validateQuoteMath(quote, priceList.items);
    if (!validation.valid) {
      throw new ApiError(400, 'Báo giá không khớp phép tính tất định', {
        code: validation.code || 'QUOTE_MATH_MISMATCH',
        issues: validation.issues,
      });
    }
    return { quote, validation };
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (err instanceof PricingError) {
      throw new ApiError(400, err.message, { code: err.code, issues: err.issues });
    }
    throw err;
  }
};

const buildDraftBody = (customer, quote) => [
  `Kính gửi ${customer.name},`,
  '',
  `Công ty chúng tôi gửi báo giá ${quote.quoteNumber || '(nháp)'}:`,
  ...quote.lines.map(
    (line) => `- ${line.name} (${line.sku}) × ${line.qty}: ${formatVnd(line.lineTotal)}`,
  ),
  '',
  `Tạm tính: ${formatVnd(quote.subtotal)}`,
  `Chiết khấu: ${quote.discountPercent}% = ${formatVnd(quote.discountAmount)}`,
  `VAT: ${(quote.vatRate * 100).toFixed(2)}% = ${formatVnd(quote.vatAmount)}`,
  `Tổng cộng: ${formatVnd(quote.totalAmount)}`,
  '',
  'Trân trọng.',
].join('\n');

const finalizeQuote = async ({
  quote,
  validation,
  customer,
  dealId,
  email,
  gateId,
  idempotencyKey,
  runId,
  nodeId,
  actor,
}) => {
  const sheetKey = `${idempotencyKey}:sheet`;
  const sheet = await callTool('sheets-mcp', 'sheets.generate_quote_sheet', {
    lines: quote.lines.map((line) => ({ sku: line.sku, qty: line.qty })),
    discountPercent: quote.discountPercent,
    vatRate: quote.vatRate,
    quoteNumber: quote.quoteNumber,
    fileName: quote.quoteNumber ? `${quote.quoteNumber}.json` : undefined,
    idempotencyKey: sheetKey,
  });

  const recipient = trimText(email?.to || customer.email);
  if (!recipient) {
    throw new ApiError(400, 'Thiếu email người nhận của khách hàng/deal');
  }

  const draftKey = `${idempotencyKey}:draft`;
  const draftResult = await callTool('mail-mcp', 'mail.create_draft', {
    to: recipient,
    subject: trimText(email?.subject) || `Báo giá ${quote.quoteNumber || ''} - ${customer.name}`.trim(),
    body: buildDraftBody(customer, quote),
    dealId: dealId || undefined,
    customerId: customer.id,
    quoteId: quote.quoteNumber || undefined,
    idempotencyKey: draftKey,
  });

  const draft = draftResult.draft;
  if (!draft || draft.status !== 'DRAFT' || draft.sent !== false) {
    throw new ApiError(500, 'mail-mcp trả trạng thái không phải DRAFT');
  }

  // Bổ sung số liệu báo giá vào đúng dòng nháp vừa tạo (mail-mcp chỉ biết
  // người nhận/nội dung). Không tạo dòng thứ hai.
  const persisted = await prisma.salesQuoteDraft.update({
    where: { id: draft.id },
    data: {
      quoteNumber: quote.quoteNumber,
      customerId: customer.id,
      dealId: dealId || null,
      gateId: gateId || null,
      lines: quote.lines,
      currency: quote.currency,
      subtotal: quote.subtotal,
      discountPercent: quote.discountPercent,
      discountAmount: quote.discountAmount,
      netAmount: quote.netAmount,
      vatRate: quote.vatRate,
      vatAmount: quote.vatAmount,
      totalAmount: quote.totalAmount,
      sheetPath: sheet.relativePath,
      createdById: actor?.userId || null,
    },
  });

  logger.info(
    `[sales] báo giá ${quote.quoteNumber || '(nháp)'} → nháp ${persisted.id} (sent=false) `
    + `run=${runId} node=${nodeId}`,
  );

  return {
    status: 'DRAFT_CREATED',
    gateId: gateId || null,
    quote,
    validation,
    customer,
    sheet: {
      relativePath: sheet.relativePath,
      filePath: sheet.filePath,
      markdownPath: sheet.markdownPath,
    },
    draft: {
      id: persisted.id,
      to: persisted.recipient,
      subject: persisted.subject,
      body: persisted.body,
      status: persisted.status,
      sent: persisted.sent,
      dealId: persisted.dealId,
      customerId: persisted.customerId,
      quoteNumber: persisted.quoteNumber,
    },
  };
};

/**
 * Tạo báo giá. ≤10%: xuất file + nháp ngay. >10%: tạo gate PENDING, KHÔNG nháp.
 */
const createQuote = async ({
  runId,
  nodeId,
  customer,
  lines,
  discountPercent = 0,
  vatRate,
  quoteNumber,
  dealId,
  email,
  priceListId,
  idempotencyKey,
  actor,
}) => {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new ApiError(400, 'lines phải có ít nhất một dòng hàng');
  }

  const key = trimText(idempotencyKey) || `${runId || 'run'}:${nodeId || 'node'}:quote`;

  // 1. CRM trước — chống trùng khách hàng.
  const upsert = await upsertCustomer({
    customer,
    actorRole: actor?.role,
    idempotencyKey: `${key}:customer`,
  });
  if (upsert.status === 'CUSTOMER_AMBIGUOUS') {
    throw new ApiError(409, 'CUSTOMER_AMBIGUOUS: cần xác nhận khách hàng trước khi báo giá', {
      code: 'CUSTOMER_AMBIGUOUS',
      candidates: upsert.candidates || [],
    });
  }
  if (!upsert.customer?.id) {
    throw new ApiError(500, 'crm-mcp không trả customer.id');
  }

  // 2. Bảng giá chuẩn + tính tất định.
  const priceList = await ensurePriceList(priceListId);
  const { quote, validation } = computeAndValidate(
    { lines, discountPercent, vatRate, quoteNumber },
    priceList,
  );

  // 3. Cập nhật deal (nếu có). `value` là trường tài chính — CASHIER không
  // được đổi (crm-mcp trả FORBIDDEN_FIELD), chỉ gửi nextStep.
  if (dealId) {
    const patch = { nextStep: `Báo giá ${quote.quoteNumber || ''}`.trim() };
    if (String(actor?.role || '').toUpperCase() !== 'CASHIER') {
      patch.value = quote.totalAmount;
    }
    await updateDeal({
      dealId,
      actorRole: actor?.role,
      patch,
      idempotencyKey: `${key}:deal`,
    });
  }

  // 4. Vượt hạn mức ⇒ gate PENDING, chưa xuất file/nháp.
  if (quote.discountPercent > SALES_DISCOUNT_THRESHOLD_PERCENT) {
    if (!trimText(runId) || !trimText(nodeId)) {
      throw new ApiError(400, 'runId và nodeId là bắt buộc khi chiết khấu vượt hạn mức');
    }

    const { gate, reused } = await createGatewayGate({
      actionType: QUOTE_ACTION_TYPE,
      runId: trimText(runId),
      nodeId: trimText(nodeId),
      summary: `Chiết khấu ${quote.discountPercent}% (${formatVnd(quote.discountAmount)}) cho ${upsert.customer.name} vượt hạn mức ${SALES_DISCOUNT_THRESHOLD_PERCENT}%`,
      amount: quote.discountAmount,
      details: {
        quoteNumber: quote.quoteNumber,
        customerId: upsert.customer.id,
        customerName: upsert.customer.name,
        dealId: dealId || null,
        discountPercent: quote.discountPercent,
        discountAmount: quote.discountAmount,
        totalAmount: quote.totalAmount,
        quote,
        skill: { name: 'quote-generation', version: '1.0.0' },
      },
      actor,
    });

    return {
      status: 'PENDING_APPROVAL',
      gateId: gate.id,
      reused,
      quote,
      validation,
      customer: upsert.customer,
      sheet: null,
      draft: null,
    };
  }

  // 5. Trong hạn mức ⇒ xuất file + nháp ngay.
  const finalized = await finalizeQuote({
    quote,
    validation,
    customer: upsert.customer,
    dealId,
    email,
    gateId: null,
    idempotencyKey: key,
    runId,
    nodeId,
    actor,
  });

  return { ...finalized, customer: upsert.customer, reusedCustomer: upsert.reusedExisting === true };
};

/**
 * Chốt báo giá sau khi gate đã APPROVED. Endpoint này KHÔNG tự duyệt; nó đọc
 * lại trạng thái thật từ DB, PENDING/REJECTED ⇒ 409.
 */
const finalizeApprovedQuote = async ({
  gateId,
  runId,
  nodeId,
  quote,
  lines,
  discountPercent,
  vatRate,
  quoteNumber,
  priceListId,
  customer,
  dealId,
  email,
  idempotencyKey,
  actor,
}) => {
  const id = trimText(gateId);
  if (!id) throw new ApiError(400, 'gateId là bắt buộc');

  const gate = await getGatewayGate(id);
  if (gate.actionType !== QUOTE_ACTION_TYPE) {
    throw new ApiError(409, `Gate không phải ${QUOTE_ACTION_TYPE}`);
  }
  if (gate.status !== 'APPROVED') {
    throw new ApiError(409, `Gate chưa được duyệt (status=${gate.status})`);
  }

  const priceList = await ensurePriceList(priceListId);
  let computed;
  if (quote && typeof quote === 'object') {
    // Client gửi lại quote: KHÔNG tin số tiền — tính lại từ lines + bảng giá.
    computed = computeAndValidate(
      { lines: quote.lines, discountPercent: quote.discountPercent, vatRate: quote.vatRate, quoteNumber: quote.quoteNumber },
      priceList,
    );
  } else {
    computed = computeAndValidate(
      { lines, discountPercent, vatRate, quoteNumber },
      priceList,
    );
  }

  const customerRecord = isRecord(customer) && customer.id
    ? customer
    : (await prisma.customer.findFirst({ where: { id: String(gate.actionPayload?.customerId || '') }, select: customerSelect }));

  if (!customerRecord?.id) {
    throw new ApiError(400, 'Thiếu customer của báo giá');
  }

  const key = trimText(idempotencyKey) || `${id}:final`;
  const finalized = await finalizeQuote({
    quote: computed.quote,
    validation: computed.validation,
    customer: customerRecord,
    dealId: dealId || gate.actionPayload?.dealId || null,
    email,
    gateId: id,
    idempotencyKey: key,
    runId,
    nodeId,
    actor,
  });

  await prisma.salesQuoteDraft.updateMany({
    where: { id: finalized.draft.id },
    data: { gateId: id },
  }).catch(() => {});

  return { ...finalized, gateId: id };
};

const getQuoteDraft = async ({ id, actor }) => {
  const draft = await prisma.salesQuoteDraft.findFirst({ where: { id: String(id) } });
  if (!draft) throw new ApiError(404, 'Không tìm thấy báo giá/nháp');

  // Role thường chỉ thấy bản ghi của mình; ADMIN/SUPER xem toàn tenant.
  const role = String(actor?.role || '').toUpperCase();
  const seesAll = ['ADMIN', 'MANAGER', 'SUPER_ADMIN', 'SUPER_OMEGA_ULTRA_ADMIN'].includes(role);
  if (!seesAll && draft.createdById && draft.createdById !== actor?.userId) {
    throw new ApiError(404, 'Không tìm thấy báo giá/nháp');
  }

  return {
    id: draft.id,
    quoteNumber: draft.quoteNumber,
    customerId: draft.customerId,
    dealId: draft.dealId,
    gateId: draft.gateId,
    status: draft.status,
    sent: draft.sent,
    recipient: draft.recipient,
    subject: draft.subject,
    body: draft.body,
    currency: draft.currency,
    lines: draft.lines,
    subtotal: toNumber(draft.subtotal),
    discountPercent: toNumber(draft.discountPercent),
    discountAmount: toNumber(draft.discountAmount),
    netAmount: toNumber(draft.netAmount),
    vatRate: toNumber(draft.vatRate),
    vatAmount: toNumber(draft.vatAmount),
    totalAmount: toNumber(draft.totalAmount),
    sheetPath: draft.sheetPath,
    createdAt: draft.createdAt,
  };
};

module.exports = {
  SALES_DISCOUNT_THRESHOLD_PERCENT,
  QUOTE_ACTION_TYPE,
  servers,
  searchCustomers,
  upsertCustomer,
  updateDeal,
  readPriceList,
  createQuote,
  finalizeApprovedQuote,
  getQuoteDraft,
  // Cho test/kiểm chứng: cùng instance server mà route dùng.
  crmServer,
  sheetsServer,
  mailServer,
};
