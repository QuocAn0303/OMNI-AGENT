'use strict';

const { createHash } = require('crypto');
const fixture = require('../../../data/company/candora.json');

// Stable UUIDs are shared by the seed, verification and domain fixture adapters.
const fixtureId = (kind, code) => {
  const hex = createHash('sha256').update(`se373:c03:${kind}:${code}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};
const tenantId = fixtureId('tenant', fixture.company.slug);

function validateFixture(data) {
  const required = ['EXEC', 'FINANCE', 'SALES', 'HR', 'OPS', 'WAREHOUSE'];
  if (!data.fixture || data.schemaVersion !== '1.0.0') throw new Error('INVALID_FIXTURE_VERSION');
  if (data.departments.length !== 6 || required.some(c => !data.departments.some(d => d.code === c))) {
    throw new Error('INVALID_DEPARTMENTS');
  }
  if (data.employees.length < 30 || data.employees.length > 35) throw new Error('INVALID_HEADCOUNT');
  const roles = ['ADMIN', 'MANAGER', 'ACCOUNTANT', 'CASHIER', 'WAREHOUSE'];
  for (const key of ['code', 'email']) {
    if (new Set(data.employees.map(e => e[key])).size !== data.employees.length) throw new Error(`DUPLICATE_${key}`);
  }
  for (const e of data.employees) {
    if (!required.includes(e.department) || !roles.includes(e.role) || !e.email.endsWith('@candora.example')) {
      throw new Error(`INVALID_EMPLOYEE:${e.code}`);
    }
    const visited = new Set([e.code]);
    let manager = e.reportsTo;
    while (manager) {
      if (visited.has(manager)) throw new Error('REPORTING_CYCLE');
      visited.add(manager);
      const parent = data.employees.find(p => p.code === manager);
      if (!parent) throw new Error('UNKNOWN_MANAGER');
      manager = parent.reportsTo;
    }
  }
  return data;
}

// Check every identity BEFORE mutating anything, including cross-tenant unique keys.
async function assertOwnership(tx) {
  const tenant = await tx.tenant.findUnique({ where: { slug: fixture.company.slug } });
  if (tenant && tenant.id !== tenantId) throw new Error('TENANT_SLUG_COLLISION');
  const byId = await tx.tenant.findUnique({ where: { id: tenantId } });
  if (byId && byId.slug !== fixture.company.slug) throw new Error('TENANT_ID_COLLISION');
  for (const d of fixture.departments) {
    const row = await tx.department.findUnique({ where: { id: fixtureId('department', d.code) } });
    if (row && row.tenantId !== tenantId) throw new Error('DEPARTMENT_OWNERSHIP_COLLISION');
  }
  for (const e of fixture.employees) {
    const id = fixtureId('user', e.code);
    const users = await tx.user.findMany({ where: { OR: [{ id }, { email: e.email }] } });
    if (users.some(u => u.id !== id || u.email !== e.email || u.tenantId !== tenantId)) {
      throw new Error(`USER_OWNERSHIP_COLLISION:${e.code}`);
    }
    const employeeId = fixtureId('employee', e.code);
    const employees = await tx.employee.findMany({ where: { OR: [{ id: employeeId }, { userId: id }, { employeeCode: e.code }] } });
    if (employees.some(r => r.id !== employeeId || r.userId !== id || r.tenantId !== tenantId || r.employeeCode !== e.code)) {
      throw new Error(`EMPLOYEE_OWNERSHIP_COLLISION:${e.code}`);
    }
  }
}

function differs(row, data) {
  return !row || Object.entries(data).some(([key, value]) => row[key] !== value);
}

async function seedCompany(prisma, passwordHash) {
  validateFixture(fixture);
  return prisma.$transaction(async tx => {
    // Serializes concurrent invocations; transaction rollback preserves foreign data on failure.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(373003)`;
    await assertOwnership(tx);
    let writes = 0;
    const upsertChanged = async (model, id, data, extraCreate = {}) => {
      const previous = await tx[model].findUnique({ where: { id } });
      if (!differs(previous, data)) return;
      await tx[model].upsert({ where: { id }, create: { id, ...data, ...extraCreate }, update: data });
      if (model === 'user') {
        await tx.auditLog.create({ data: {
          tenantId, userId: id, action: previous ? 'UPDATE_USER' : 'CREATE_USER',
          entity: 'User', entityId: id,
          meta: { fixture: 'C-03', seedVersion: fixture.schemaVersion },
        } });
      }
      writes += 1;
    };
    await upsertChanged('tenant', tenantId, { ...fixture.company, isActive: true });
    for (const d of fixture.departments) {
      await upsertChanged('department', fixtureId('department', d.code), {
        tenantId, name: d.name, description: `SE373 C-03 | ${d.code}`, isActive: true,
      });
    }
    // Create all users before adding reportsTo foreign keys.
    for (const e of fixture.employees) {
      await upsertChanged('user', fixtureId('user', e.code), {
        tenantId, email: e.email, fullName: e.fullName, role: e.role,
        department: e.department, isActive: true, emailVerified: true, registrationStatus: 'APPROVED',
      }, { password: passwordHash });
    }
    for (const e of fixture.employees) {
      const id = fixtureId('user', e.code);
      const reportsToId = e.reportsTo ? fixtureId('user', e.reportsTo) : null;
      const row = await tx.user.findUnique({ where: { id } });
      if (row.reportsToId !== reportsToId) {
        await tx.user.update({ where: { id }, data: { reportsToId } });
        await tx.auditLog.create({ data: { tenantId, userId: id, action: 'UPDATE_USER', entity: 'User', entityId: id, meta: { fixture: 'C-03', field: 'reportsToId' } } });
        writes += 1;
      }
      await upsertChanged('employee', fixtureId('employee', e.code), {
        tenantId, userId: id, employeeCode: e.code, position: e.position,
        departmentId: fixtureId('department', e.department), isActive: true,
      });
    }
    return { tenantId, departments: fixture.departments.length, users: fixture.employees.length, employees: fixture.employees.length, writes };
  }, { timeout: 60000 });
}

async function verifyCompany(prisma) {
  const [tenant, departments, users, employees] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: tenantId } }),
    prisma.department.findMany({ where: { tenantId } }),
    prisma.user.findMany({ where: { tenantId } }),
    prisma.employee.findMany({ where: { tenantId } }),
  ]);
  if (!tenant || departments.length !== 6 || users.length !== 32 || employees.length !== 32) throw new Error('COUNTS_MISMATCH');
  for (const e of fixture.employees) {
    const user = users.find(u => u.id === fixtureId('user', e.code));
    const employee = employees.find(r => r.id === fixtureId('employee', e.code));
    const department = departments.find(d => d.id === fixtureId('department', e.department));
    if (!user || !employee || !department || user.role !== e.role || user.department !== e.department
      || user.email !== e.email || !user.isActive || !user.emailVerified || user.registrationStatus !== 'APPROVED'
      || user.reportsToId !== (e.reportsTo ? fixtureId('user', e.reportsTo) : null)
      || employee.userId !== user.id || employee.departmentId !== department.id || !employee.isActive) {
      throw new Error(`IDENTITY_MISMATCH:${e.code}`);
    }
  }
  // Password hashes stay in memory and never enter CLI output or evidence.
  return { tenantId, departments: departments.length, users: users.length, employees: employees.length };
}

module.exports = { fixture, fixtureId, tenantId, validateFixture, seedCompany, verifyCompany };
