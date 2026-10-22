const express = require('express');

jest.mock('../src/config/prisma', () => ({
  product: { findMany: jest.fn() },
  agentSession: { create: jest.fn().mockResolvedValue({ id: 'session-1' }), update: jest.fn() },
  agentStep: { create: jest.fn() },
}));
jest.mock('../src/modules/replenishment/replenishment.suggest', () => ({ previewForProduct: jest.fn() }));
jest.mock('../src/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), truncateLog: (v) => v }));
jest.mock('../src/modules/ai/agent.brain', () => ({
  decide: jest.fn().mockResolvedValue(null), WRITE_TOOLS: new Set(), DB_TOOLS: new Set(),
}));
let mockUser = { id: 'admin-1', tenantId: 'tenant-1', role: 'ADMIN' };
jest.mock('../src/middleware/auth.middleware', () => ({
  authenticate: (req, res, next) => { req.user = mockUser; next(); },
  authorize: () => (req, res, next) => next(),
}));
jest.mock('../src/middleware/plan.middleware', () => ({ requireModule: () => (req, res, next) => next() }));

const prisma = require('../src/config/prisma');
const brain = require('../src/modules/ai/agent.brain');
const { getTenantId } = require('../src/config/tenantContext');
const { previewForProduct } = require('../src/modules/replenishment/replenishment.suggest');
const { normalizeName, matchProductNames } = require('../src/modules/ai/product-name-match');
const { queryReplenishment, detectReplenishmentRequest, CHOICE_PROMPT } = require('../src/modules/ai/replenishment-chat.service');

const catalog = [
  { id: 'p1', sku: 'SP001501', name: 'Cà phê Trung Nguyên ít ngọt 160 gói' },
  { id: 'p2', sku: 'SP001502', name: 'Sữa tươi Vinamilk 180ml' },
  { id: 'p3', sku: 'SP001503', name: 'Đường trắng Biên Hòa 1kg' },
];
const preview = (product = catalog[0], needed = true) => ({
  product: { ...product, unit: 'gói' },
  plan: {
    status: needed ? 'NEED_REPLENISHMENT' : 'OK',
    atp: { atp: 8, onOrder: needed ? 0 : 100 }, rop: { rop: 33 },
    order: { orderQty: needed ? 49 : 0 },
  },
});

beforeEach(() => {
  jest.clearAllMocks();
  mockUser = { id: 'admin-1', tenantId: 'tenant-1', role: 'ADMIN' };
  prisma.product.findMany.mockResolvedValue(catalog);
  previewForProduct.mockResolvedValue(preview());
  brain.decide.mockResolvedValue(null);
});

describe('Khớp tên hàng trong chat', () => {
  test.each(['ca phe trug nguyen', 'cà phê trung nguyne', 'caphe trungnguyen', 'CÀ PHÊ TRUNG NGUYÊN'])('nhận diện tên không dấu / gõ sai: %s', (query) => {
    expect(matchProductNames(query, catalog)).toMatchObject({ status: 'MATCH', product: { id: 'p1' } });
  });
  test('giữ chữ đ và tìm sản phẩm bằng mã chính xác', () => {
    expect(normalizeName('Đường')).toBe('duong');
    expect(matchProductNames('duong bien hoa', catalog).product.id).toBe('p3');
    expect(matchProductNames('sp001502', catalog).product.id).toBe('p2');
  });
  test('không đoán SKU gần giống và không bịa sản phẩm không có', () => {
    expect(matchProductNames('SP001509', catalog).status).toBe('NONE');
    expect(matchProductNames('may giat samsung', catalog).status).toBe('NONE');
  });
  test('tên giống nhau phải hỏi lại, không ưu tiên hàng cần nhập để chọn SKU', () => {
    const variants = [catalog[0], { id: 'p4', sku: 'SP4', name: 'Cà phê Trung Nguyên ít ngọt 180 gói' }];
    expect(matchProductNames('ca phe trug nguyen', variants).status).toBe('REVIEW');
  });
  test('mô tả không nằm trong tên hàng chỉ cho phép gợi ý ứng viên, không tự chọn', () => {
    const demoNames = [
      { id: 'd1', sku: 'D1', name: 'Legend Trung Nguyên Ít ngọt 160 gói' },
      { id: 'd2', sku: 'D2', name: 'Gourmet Trung Nguyên Ít ngọt 500 gói' },
    ];
    expect(matchProductNames('ca phe trug nguyen', demoNames)).toMatchObject({
      status: 'REVIEW', candidates: expect.arrayContaining(demoNames),
    });
  });
  test('không sửa số phân biệt loại / dung tích', () => {
    const variants = [
      { id: 'v1', sku: 'V1', name: 'Phô mai Oishi Loại 1' },
      { id: 'v2', sku: 'V2', name: 'Phô mai Oishi Loại 2' },
    ];
    expect(matchProductNames('pho mai oshi loai 1', variants)).toMatchObject({ status: 'MATCH', product: { id: 'v1' } });
    expect(matchProductNames('sua tuoi vinamilk 160ml', catalog).status).toBe('NONE');
  });
});

describe('Nhận diện câu hỏi nhập hàng không phụ thuộc LLM', () => {
  test.each([
    ['cà phê trug nguyen có cần nhập không?', 'ca phe trug nguyen'],
    ['kiểm tra ca phe trug nguyen cần nhập không', 'ca phe trug nguyen'],
    ['Có cần nhập sữa tươi vinamlik không?', 'sua tuoi vinamlik'],
    ['mặt hàng nào cần nhập?', ''],
    ['cho mình biết món hàng nào sắp hết', ''],
    ['tôi muốn biết sản phẩm nào cần nhập hôm nay', ''],
  ])('%s', (message, query) => {
    expect(detectReplenishmentRequest(message)).toEqual({ query });
  });
  test('giữ tên Không Độ và số Loại 1', () => {
    expect(detectReplenishmentRequest('trà xanh Không Độ cần nhập không?').query).toBe('tra xanh khong do');
    expect(detectReplenishmentRequest('phô mai Oishi Loại 1 cần nhập không').query).toBe('pho mai oishi loai 1');
  });
  test('không chặn lệnh tạo đơn nhập hay tra cứu khác', () => {
    expect(detectReplenishmentRequest('tạo PO cà phê cần nhập 5 gói')).toBeNull();
    expect(detectReplenishmentRequest('tạo đơn hàng 3 cái áo')).toBeNull();
    expect(detectReplenishmentRequest('doanh thu tháng này')).toBeNull();
  });
});

describe('Tra cứu dữ liệu thật qua service, không ghi đề xuất hoặc PO', () => {
  test('tìm tên sai rồi dùng preview chung trong đúng tenant', async () => {
    previewForProduct.mockImplementation(async () => { expect(getTenantId()).toBe('tenant-1'); return preview(); });
    const result = await queryReplenishment({ query: 'ca phe trug nguyen' }, mockUser);
    expect(result).toContain('Cà phê Trung Nguyên');
    expect(result).toContain('CẦN NHẬP');
    expect(result).toContain('49 gói');
    expect(prisma.product.findMany.mock.calls[0][0].where).toEqual({ tenantId: 'tenant-1', isActive: true });
    expect(previewForProduct).toHaveBeenCalledWith({ productId: 'p1' });
  });
  test('tìm danh mục đầy đủ sau trang thứ nhất', async () => {
    const page = Array.from({ length: 500 }, (_, index) => ({ id: `x${index}`, sku: `X${index}`, name: `Bánh kẹo ${index}` }));
    prisma.product.findMany.mockResolvedValueOnce(page).mockResolvedValueOnce([catalog[0]]);
    expect(await queryReplenishment({ query: 'ca phe trug nguyen' }, mockUser)).toContain('SP001501');
    expect(prisma.product.findMany.mock.calls[1][0]).toMatchObject({ cursor: { id: 'x499' }, skip: 1 });
  });
  test('sản phẩm đã đủ hàng phải nói chưa cần nhập', async () => {
    previewForProduct.mockResolvedValue(preview(catalog[0], false));
    expect(await queryReplenishment({ query: 'SP001501' }, mockUser)).toContain('CHƯA CẦN NHẬP');
  });
  test('tên mơ hồ hỏi lại trước khi tính số', async () => {
    prisma.product.findMany.mockResolvedValue([catalog[0], { ...catalog[0], id: 'p4', sku: 'SP4' }]);
    const result = await queryReplenishment({ query: 'ca phe trug nguyen' }, mockUser);
    expect(result).toContain(CHOICE_PROMPT);
    expect(result).toContain('SP001501');
    expect(result).toContain('SP4');
    expect(previewForProduct).not.toHaveBeenCalled();
  });
  test('câu hỏi chung chỉ liệt kê hàng cần nhập', async () => {
    previewForProduct.mockImplementation(async ({ productId }) => preview(catalog.find((p) => p.id === productId), productId === 'p1'));
    const result = await queryReplenishment({}, mockUser);
    expect(result).toContain('3/3');
    expect(result).toContain('SP001501');
    expect(result).not.toContain('SP001502');
  });
  test('thiếu dữ liệu và lỗi DB không được giả vờ biết cần nhập', async () => {
    previewForProduct.mockResolvedValue(null);
    expect(await queryReplenishment({ query: 'SP001501' }, mockUser)).toContain('chưa đủ dữ liệu');
    prisma.product.findMany.mockRejectedValue(new Error('DB unavailable'));
    await expect(queryReplenishment({}, mockUser)).rejects.toThrow('DB unavailable');
  });
  test('thiếu tenant không được đọc danh mục', async () => {
    await expect(queryReplenishment({ query: 'cà phê' }, {})).rejects.toMatchObject({ status: 403 });
    expect(prisma.product.findMany).not.toHaveBeenCalled();
  });
});

describe('HTTP /api/agent/chat', () => {
  let server;
  let url;
  beforeAll((done) => {
    const app = express();
    app.use(express.json());
    app.use('/api/agent', require('../src/modules/ai/agent.routes'));
    app.use((error, req, res, next) => res.status(error.status || 500).json({ success: false, message: error.message }));
    server = app.listen(0, () => { url = `http://127.0.0.1:${server.address().port}/api/agent/chat`; done(); });
  });
  afterAll(async () => new Promise((resolve) => server.close(resolve)));
  const chat = async (messages) => {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages }) });
    return { status: response.status, body: await response.json() };
  };
  test('câu hỏi sai chính tả đi đến dữ liệu thay vì lời đáp chung của LLM', async () => {
    brain.decide.mockResolvedValue({ mode: 'reply', text: 'Tôi không có dữ liệu' });
    const result = await chat([{ role: 'user', content: 'ca phe trug nguyen cần nhập không?' }]);
    expect(result.status).toBe(200);
    expect(result.body.data.response).toContain('SP001501');
    expect(result.body.data.response).toContain('CẦN NHẬP');
    expect(brain.decide).not.toHaveBeenCalled();
    expect(prisma.agentStep.create.mock.calls[0][0].data.toolName).toBe('queryReplenishment');
  });
  test('trả lời bằng SKU sau câu hỏi chọn hàng vẫn hoạt động khi LLM tắt', async () => {
    const result = await chat([
      { role: 'user', content: 'ca phe cần nhập không' },
      { role: 'assistant', content: `• Cà phê (SKU: SP001501)\n${CHOICE_PROMPT}` },
      { role: 'user', content: 'SP001501' },
    ]);
    expect(result.status).toBe(200);
    expect(result.body.data.response).toContain('49 gói');
  });
  test('tool do brain chọn cũng được truyền tenant từ người đăng nhập', async () => {
    brain.decide.mockResolvedValue({ mode: 'tool', tool: 'queryReplenishment', params: { query: 'sua tuoi vinamlik', tenantId: 'tenant-other' } });
    previewForProduct.mockResolvedValue(preview(catalog[1]));
    const result = await chat([{ role: 'user', content: 'Xem giúp mức đặt lại của sữa tươi vinamlik' }]);
    expect(result.status).toBe(200);
    expect(prisma.product.findMany.mock.calls[0][0].where.tenantId).toBe('tenant-1');
  });
});
