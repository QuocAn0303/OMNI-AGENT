const { fixture, fixtureId, tenantId, validateFixture, seedCompany } = require('../scripts/seed/company/seed');

test('fixture có đúng cơ cấu, identity và cây báo cáo hợp lệ', () => {
  expect(validateFixture(fixture)).toBe(fixture);
  expect(fixture.employees).toHaveLength(32);
  const ids = fixture.employees.map(e => fixtureId('user', e.code));
  expect(new Set(ids).size).toBe(32);
  expect(ids.every(id => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/.test(id))).toBe(true);
});

test.each(['email', 'code'])('từ chối định danh trùng %s', key => {
  const copy = JSON.parse(JSON.stringify(fixture));
  copy.employees[1][key] = copy.employees[0][key];
  expect(() => validateFixture(copy)).toThrow('DUPLICATE_');
});

test('từ chối cây quản lý có chu trình', () => {
  const copy = JSON.parse(JSON.stringify(fixture));
  copy.employees[0].reportsTo = copy.employees[1].code;
  expect(() => validateFixture(copy)).toThrow('REPORTING_CYCLE');
});

test('từ chối email thuộc tenant khác trước mọi thao tác ghi', async () => {
  const tx = {
    $executeRaw: jest.fn(),
    tenant: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn() },
    department: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn() },
    user: { findMany: jest.fn().mockResolvedValue([{ id: fixtureId('user', fixture.employees[0].code), email: fixture.employees[0].email, tenantId: 'foreign' }]), upsert: jest.fn() },
    employee: { findMany: jest.fn(), upsert: jest.fn() },
  };
  await expect(seedCompany({ $transaction: fn => fn(tx) }, 'not-a-real-hash')).rejects.toThrow('USER_OWNERSHIP_COLLISION');
  expect(tx.tenant.upsert).not.toHaveBeenCalled();
  expect(tx.department.upsert).not.toHaveBeenCalled();
  expect(tx.user.upsert).not.toHaveBeenCalled();
  expect(tx.employee.upsert).not.toHaveBeenCalled();
  expect(tenantId).not.toBe('foreign');
});
