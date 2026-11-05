'use strict';

const express = require('express');
const http = require('node:http');
const createRouter = require('../routes/vn-supply-chain.routes');

describe('Router riêng: auth, validation, phân trang', () => {
  let server;
  let authorize;
  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    authorize = jest.fn(() => (req, res, next) => req.headers['x-role'] === 'ADMIN'
      ? next() : res.sendStatus(403));
    app.use('/api/vn-supply-chain', createRouter({
      auth: {
        authenticate: (req, res, next) => req.headers.authorization ? next() : res.sendStatus(401),
        authorize,
      },
      response: { success: (res, data) => res.json({ success: true, data }) },
    }));
    app.use((error, req, res, next) => {
      res.status(error.name === 'ZodError' ? 400 : 500).json({ success: false });
    });
    server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  });
  afterAll(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  function request(url, { authenticated = true, role = 'ADMIN', body } = {}) {
    return new Promise((resolve, reject) => {
      const payload = body ? JSON.stringify(body) : null;
      const req = http.request({
        host: '127.0.0.1', port: server.address().port, path: '/api/vn-supply-chain' + url,
        method: body ? 'POST' : 'GET',
        headers: { ...(authenticated ? { authorization: 'test' } : {}), 'x-role': role,
          ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}) },
      }, res => {
        let text = '';
        res.on('data', data => { text += data; });
        res.on('end', () => resolve({ status: res.statusCode, body: text.startsWith('{') ? JSON.parse(text) : text }));
      });
      req.on('error', reject);
      req.end(payload);
    });
  }
  test('router từ chối thiếu auth và role sai', async () => {
    expect((await request('/catalog', { authenticated: false })).status).toBe(401);
    expect((await request('/catalog', { role: 'CASHIER' })).status).toBe(403);
    expect(authorize).toHaveBeenCalledWith('ADMIN', 'MANAGER', 'WAREHOUSE', 'ACCOUNTANT');
  });
  test('catalog và audit trả dữ liệu theo response chuẩn', async () => {
    const catalog = await request('/catalog');
    expect(catalog.status).toBe(200);
    expect(catalog.body.data.warehouses).toHaveLength(2);
    const audit = await request('/audit');
    expect(audit.body.data).toMatchObject({ balanced: true, checkedDays: 60, difference: 0 });
  });
  test('lọc đúng kho/ngày/kênh và phân trang', async () => {
    const response = await request('/operations?date=2026-11-11&warehouseId=WH-HCM&channel=Shopee&limit=2&page=2');
    expect(response.status).toBe(200);
    expect(response.body.data.rows).toHaveLength(2);
    expect(response.body.data.pagination).toEqual({ page: 2, limit: 2, total: 5, totalPages: 3 });
    expect(response.body.data.rows.every(row => row.date === '2026-11-11' && row.warehouseId === 'WH-HCM' && row.channel === 'Shopee')).toBe(true);
  });
  test.each(['limit=0', 'limit=201', 'limit=abc', 'page=-1', 'warehouseId=OTHER', 'date=2026-02-30', 'extra=1', 'limit=1&limit=2'])('400 query sai %s', async query => {
    expect((await request('/operations?' + query)).status).toBe(400);
  });
  test('400 phí không hợp lệ, không gây lỗi 500', async () => {
    expect((await request('/shipping-quote', { body: { carrierId: 'OTHER' } })).status).toBe(400);
  });
});
