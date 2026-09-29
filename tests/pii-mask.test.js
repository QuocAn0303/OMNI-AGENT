/**
 * tests/pii-mask.test.js — maskPII + chuẩn hoá JSON-safe
 *
 * Bug gốc: audit log PO crash với
 *   "Invalid prisma.auditLog.create()" — Decimal lộ {s,e,d}
 * vì maskObject giữ nguyên object Decimal của Prisma 7 rồi đẩy thẳng
 * vào cột JSON. Sau khi tạo PO, auditService.log nuốt lỗi (log error)
 * nhưng bản ghi kiểm toán bị MẤT.
 */
const { maskPII } = require('../src/utils/piiMask');

// Decimal.js giống Prisma 7 trả về
class FakeDecimal {
  constructor(v) { this._v = v; }
  toNumber() { return this._v; }
  toFixed() { return this._v.toFixed(2); }
  toString() { return String(this._v); }
}

describe('maskPII — chuẩn hoá giá trị JSON-unsafe', () => {
  test('Prisma Decimal → number', () => {
    const out = maskPII({ total: new FakeDecimal(5000000), status: 'PENDING_APPROVAL' }, null);
    expect(out.total).toBe(5_000_000);
    expect(typeof out.total).toBe('number');
  });

  test('Decimal lồng trong mảng và object con', () => {
    const out = maskPII({
      items: [{ unitCost: new FakeDecimal(27000), qty: 1 }],
      meta: { tax: new FakeDecimal(0) },
    }, null);
    expect(out.items[0].unitCost).toBe(27000);
    expect(out.meta.tax).toBe(0);
  });

  test('Date → ISO string', () => {
    const d = new Date('2026-09-29T07:52:26.026Z');
    expect(maskPII({ createdAt: d }, null).createdAt).toBe(d.toISOString());
  });

  test('BigInt → number (không throw)', () => {
    expect(maskPII({ count: 10n }, null).count).toBe(10);
  });

  test('toàn bộ object JSON.stringify được (điều kiện để ghi cột JSON)', () => {
    const payload = {
      poCode: 'PO-20260929-0003',
      total: new FakeDecimal(5000000),
      taxAmount: new FakeDecimal(0),
      createdAt: new Date('2026-09-29T07:52:26.026Z'),
      items: [{ unitCost: new FakeDecimal(27000) }],
    };
    const out = maskPII(payload, null);
    expect(() => JSON.stringify(out)).not.toThrow();
    expect(JSON.parse(JSON.stringify(out)).total).toBe(5_000_000);
  });
});

describe('maskPII — hành vi mask cũ không đổi', () => {
  test('role đầy đủ PII → trả nguyên data, không mask', () => {
    const data = { phone: '0912345678', email: 'a@b.com' };
    expect(maskPII(data, 'ADMIN')).toEqual(data);
  });

  test('role thấp / null → mask SĐT và email', () => {
    expect(maskPII({ phone: '0912345678' }, null).phone).toBe('09***5678');
    expect(maskPII({ email: 'nguyen@x.com' }, 'CASHIER').email).toBe('n***@x.com');
  });

  test('mask key PII lồng sâu trong Decimal-converted object', () => {
    const out = maskPII({ customer: { phone: '0912345678', total: new FakeDecimal(100) } }, null);
    expect(out.customer.phone).toBe('09***5678');
    expect(out.customer.total).toBe(100);
  });
});
