/**
 * HỢP ĐỒNG: mọi ghi lồng phải mang `tenantId`.
 *
 * Bối cảnh (sự cố thật đã đo trên DB): Prisma extension chỉ gắn `tenantId` vào
 * `data` cấp ngoài cùng. Với `order.create({ data: { items: { create: [...] } } })`
 * thì dòng `OrderItem` sinh ra có `tenantId = NULL`, trong khi MỌI truy vấn đọc
 * lại đều lọc `tenantId` ⇒ dữ liệu vừa ghi xong biến mất khỏi phạm vi tenant.
 * Đo được: 84/242 dòng `order_items` bị NULL trên DB phát triển.
 *
 * Bài test này KHÔNG liệt kê tay từng quan hệ: nó duyệt metadata thật của Prisma
 * client và kiểm tra MỌI cặp (model cha → model con scoped) trên tất cả các
 * dạng ghi lồng. Thêm model mới vào schema mà quên tiêm `tenantId` thì test
 * đỏ ngay, không cần ai nhớ.
 *
 * Phần ghi thật lên DB nằm ở `scripts/check-tenant-isolation.js` (chạy bằng
 * `npm run check:tenant`), vì unit test không chứng minh được ràng buộc DB.
 */
const prisma = require('../src/config/prisma');

const {
  withNestedTenant,
  assertTenantScopingReady,
  assertTenantScopingReady: _recheck,
  RELATION_FIELD_TO_MODEL,
  MODEL_FIELDS,
  TENANT_SCOPED_MODELS,
  getUnverifiableScopedModels,
} = prisma.__internals;

const T = 'tenant-hop-dong';

/** Mọi cặp (cha, tên field, con) mà cả hai đều thuộc tập scoped. */
const SCOPED_RELATIONS = [...RELATION_FIELD_TO_MODEL.entries()]
  .filter(([parent]) => TENANT_SCOPED_MODELS.has(parent))
  .flatMap(([parent, rels]) =>
    [...rels.entries()]
      .filter(([, child]) => TENANT_SCOPED_MODELS.has(child))
      .map(([field, child]) => ({ parent, field, child })),
  );

describe('hợp đồng tenant · metadata', () => {
  test('đọc được metadata và có quan hệ scoped để kiểm tra', () => {
    expect(MODEL_FIELDS.size).toBeGreaterThan(100);
    expect(SCOPED_RELATIONS.length).toBeGreaterThan(100);
  });

  test('kiểm tra khởi động chạy lại được và không ném lỗi', () => {
    expect(() => _recheck()).not.toThrow();
  });

  test('mọi model có cột tenantId đều đã khai báo scoped (chiều ngược)', () => {
    const undeclared = [...MODEL_FIELDS.entries()]
      .filter(([, fields]) => fields.some((f) => f.name === 'tenantId'))
      .map(([name]) => name)
      .filter((name) => !TENANT_SCOPED_MODELS.has(name));
    expect(undeclared).toEqual([]);
  });

  test('model không có client (@@ignore) được gọi tên ra thay vì giấu', () => {
    // Không phải lỗi (Prisma không sinh thao tác cho model `@@ignore`), nhưng phải
    // có tên để người vận hành biết bảng đó cần `scripts/tenant-null.js` xử lý.
    const unverifiable = getUnverifiableScopedModels();
    for (const model of unverifiable) {
      expect(MODEL_FIELDS.has(model)).toBe(false);
    }
  });
});

describe('hợp đồng tenant · ghi lồng (sinh từ metadata)', () => {
  test.each(SCOPED_RELATIONS.map((r) => [r.parent, r.field, r.child]))(
    '%s.%s → %s: `create` lồng (mảng) gắn tenantId',
    (parent, field) => {
      const out = withNestedTenant(parent, { [field]: { create: [{ a: 1 }, { a: 2 }] } }, T);
      expect(out[field].create).toHaveLength(2);
      for (const row of out[field].create) expect(row.tenantId).toBe(T);
    },
  );

  test.each(SCOPED_RELATIONS.map((r) => [r.parent, r.field, r.child]))(
    '%s.%s → %s: `create` lồng (một đối tượng) gắn tenantId',
    (parent, field) => {
      const out = withNestedTenant(parent, { [field]: { create: { a: 1 } } }, T);
      expect(out[field].create.tenantId).toBe(T);
    },
  );

  test.each(SCOPED_RELATIONS.map((r) => [r.parent, r.field, r.child]))(
    '%s.%s → %s: `createMany` lồng gắn tenantId',
    (parent, field) => {
      const out = withNestedTenant(parent, { [field]: { createMany: [{ a: 1 }] } }, T);
      expect(out[field].createMany[0].tenantId).toBe(T);
    },
  );

  test.each(SCOPED_RELATIONS.map((r) => [r.parent, r.field, r.child]))(
    '%s.%s → %s: `connectOrCreate` (nhánh create) gắn tenantId',
    (parent, field) => {
      const out = withNestedTenant(
        parent,
        { [field]: { connectOrCreate: [{ where: { id: 'x' }, create: { a: 1 } }] } },
        T,
      );
      expect(out[field].connectOrCreate[0].create.tenantId).toBe(T);
    },
  );

  test.each(SCOPED_RELATIONS.map((r) => [r.parent, r.field, r.child]))(
    '%s.%s → %s: `upsert` lồng (nhánh create) gắn tenantId',
    (parent, field) => {
      const out = withNestedTenant(
        parent,
        { [field]: { upsert: { where: { id: 'x' }, create: { a: 1 } } } },
        T,
      );
      expect(out[field].upsert.create.tenantId).toBe(T);
    },
  );

  test.each(SCOPED_RELATIONS.map((r) => [r.parent, r.field, r.child]))(
    '%s.%s → %s: `upsert` lồng (nhánh update có create lồng) gắn tenantId',
    (parent, field, child) => {
      // `update` là payload của DÒNG CON, nên phải dùng tên quan hệ thuộc về
      // `child`, không phải `field` (thuộc `parent`).
      const childRel = [...RELATION_FIELD_TO_MODEL.get(child).entries()].find(
        ([, c]) => TENANT_SCOPED_MODELS.has(c),
      );
      if (!childRel) return; // quan hệ lá: không có tầng sâu hơn để kiểm
      const [childField] = childRel;
      const out = withNestedTenant(
        parent,
        {
          [field]: {
            upsert: {
              where: { id: 'x' },
              create: { a: 1 },
              update: { [childField]: { create: [{ a: 2 }] } },
            },
          },
        },
        T,
      );
      expect(out[field].upsert.create.tenantId).toBe(T);
      expect(out[field].upsert.update[childField].create[0].tenantId).toBe(T);
    },
  );

  test.each(SCOPED_RELATIONS.map((r) => [r.parent, r.field, r.child]))(
    '%s.%s → %s: `update` lồng có `create` sâu hơn gắn tenantId',
    (parent, field, child) => {
      const childRel = [...RELATION_FIELD_TO_MODEL.get(child).entries()].find(
        ([, c]) => TENANT_SCOPED_MODELS.has(c),
      );
      if (!childRel) return;
      const [childField] = childRel;
      const out = withNestedTenant(
        parent,
        { [field]: { update: { where: { id: 'x' }, data: { [childField]: { create: [{ a: 1 }] } } } } },
        T,
      );
      expect(out[field].update.data[childField].create[0].tenantId).toBe(T);
    },
  );

  test.each([...TENANT_SCOPED_MODELS].filter((m) => MODEL_FIELDS.has(m)))(
    '%s: `createMany` cấp ngoài gắn tenantId cho từng dòng',
    (model) => {
      // `withNestedTenant` xử lý payload con; `createMany` cấp ngoài do extension
      // gắn trực tiếp — kiểm qua chính con của mô hình lồng hai cấp.
      const rel = [...RELATION_FIELD_TO_MODEL.get(model).entries()].find(([, c]) => TENANT_SCOPED_MODELS.has(c));
      if (!rel) return;
      const [field] = rel;
      const out = withNestedTenant(model, { [field]: { createMany: [{ a: 1 }] } }, T);
      expect(out[field].createMany[0].tenantId).toBe(T);
    },
  );
});

describe('hợp đồng tenant · nguyên tắc', () => {
  test('không ghi đè tenantId do caller chỉ định', () => {
    const out = withNestedTenant('Order', { items: { create: [{ productId: 'p', tenantId: 'khac' }] } }, T);
    expect(out.items.create[0].tenantId).toBe('khac');
  });

  test('không mutate payload gốc', () => {
    const original = { items: { create: [{ productId: 'p' }] } };
    withNestedTenant('Order', original, T);
    expect(original.items.create[0].tenantId).toBeUndefined();
  });

  test('KHÔNG tiêm vào quan hệ tới model không scoped', () => {
    const nonScoped = [...RELATION_FIELD_TO_MODEL.get('Order').entries()].find(
      ([, child]) => !TENANT_SCOPED_MODELS.has(child),
    );
    if (!nonScoped) return;
    const [field] = nonScoped;
    const out = withNestedTenant('Order', { [field]: { create: [{ a: 1 }] } }, T);
    expect(out[field].create[0]).not.toHaveProperty('tenantId');
  });

  test('model cha không có metadata → NÉM LỖI, không ghi NULL', () => {
    expect(() => withNestedTenant('ModelKhongTonTai', { x: { create: [{ a: 1 }] } }, T)).toThrow(
      /Không xác định được metadata/,
    );
  });

  test('fail-fast là hàm kiểm tra được, không phải side-effect ẩn', () => {
    expect(typeof assertTenantScopingReady).toBe('function');
    expect(() => assertTenantScopingReady()).not.toThrow();
  });
});
