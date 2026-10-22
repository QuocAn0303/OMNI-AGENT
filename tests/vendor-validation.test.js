/**
 * tests/vendor-validation.test.js — vendorSchema (Them/Sua NCC) chap nhan null tu DB
 *
 * Loi truoc khi sua: DB tra `null` cho MST/SDT/paymentTerms; form AntD sua NCC
 * setFieldsValue(row) roi submit lai `null` khi user de trong o. Zod `.optional()`
 * chi chap nhan undefined => PUT /accounting/vendors/:id tra 400 "Du lieu khong hop le"
 * (message chung cua ZodError trong error.middleware).
 *
 * Khoa hanh vi: null chuan hoa thanh undefined (khong dua null vao Prisma), va van
 * bat loi that khi name qua ngat / paymentTerms am.
 */

jest.mock('../src/config/prisma', () => new Proxy({}, { get: () => jest.fn() }));

const { __internals } = require('../src/modules/accounting/accounting.routes');
const { vendorSchema } = __internals;

describe('vendorSchema — Them/Sua NCC', () => {
  test('payload sua tu form (null cac o trong) van pass, null chuyen thanh undefined', () => {
    const parsed = vendorSchema.partial().parse({
      name: 'NHÀ CUNG CẤP',
      taxCode: null,
      phone: null,
      email: 'an7091@gmail.com',
      address: 'Cambodia',
      contactPerson: 'Phát',
      paymentTerms: null,
    });
    expect(parsed.name).toBe('NHÀ CUNG CẤP');
    expect(parsed.taxCode).toBeUndefined();
    expect(parsed.phone).toBeUndefined();
    expect(parsed.paymentTerms).toBeUndefined();
  });

  test('chuoi rong (user de trong o Input) van pass', () => {
    const parsed = vendorSchema.partial().parse({
      name: 'NHÀ CUNG CẤP',
      taxCode: '',
      phone: '',
      paymentTerms: 7,
    });
    expect(parsed.taxCode).toBe('');
    expect(parsed.paymentTerms).toBe(7);
  });

  test('payload tao day du van pass', () => {
    const parsed = vendorSchema.parse({
      code: 'NCC-TEST',
      name: 'NCC Test',
      taxCode: '0312345678',
      phone: '0901234567',
      email: 'an7091@gmail.com',
      address: 'Q1',
      contactPerson: 'Phat',
      paymentTerms: 30,
    });
    expect(parsed.code).toBe('NCC-TEST');
    expect(parsed.paymentTerms).toBe(30);
  });

  test('name qua ngat van bi bat loi', () => {
    expect(() => vendorSchema.partial().parse({ name: 'A' })).toThrow();
  });

  test('paymentTerms am van bi bat loi', () => {
    expect(() => vendorSchema.partial().parse({ name: 'NCC', paymentTerms: -1 })).toThrow();
  });
});
