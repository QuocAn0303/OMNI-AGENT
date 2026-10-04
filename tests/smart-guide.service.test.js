/**
 * Unit tests for smart-guide.service.js
 *
 * Tests the business logic: pricing insights, reorder suggestions,
 * health score calculation, and simple report generation.
 */
const prisma = require('../src/config/prisma');

jest.mock('../src/config/prisma', () => ({
  product: { findMany: jest.fn() },
  inventory: { findMany: jest.fn(), count: jest.fn() },
  orderItem: { findMany: jest.fn(), count: jest.fn() },
  purchaseItem: { findMany: jest.fn() },
  bankAccount: { findMany: jest.fn() },
  order: { aggregate: jest.fn(), count: jest.fn() },
  expense: { aggregate: jest.fn() },
  debt: { aggregate: jest.fn() },
  customer: { count: jest.fn() },
}));

describe('Smart Guide Service', () => {
  const service = require('../src/modules/smart-guide/smart-guide.service');

  beforeEach(() => jest.clearAllMocks());

  const emptyAggregate = { _sum: { total: 0 } };

  // ==================== GET PRICING INSIGHTS ====================
  describe('getPricingInsights', () => {
    test('returns structured response with products and summary', async () => {
      prisma.product.findMany.mockResolvedValue([]);

      const result = await service.getPricingInsights();

      expect(result).toHaveProperty('products');
      expect(result).toHaveProperty('summary');
      expect(Array.isArray(result.products)).toBe(true);
      expect(result.summary).toHaveProperty('total');
      expect(result.summary).toHaveProperty('belowCostCount');
      expect(result.summary).toHaveProperty('lowMarginCount');
      expect(result.summary).toHaveProperty('noCostCount');
      expect(result.summary).toHaveProperty('healthLabel');
    });

    test('each product has required fields', async () => {
      prisma.product.findMany.mockResolvedValue([
        {
          id: 'p1', name: 'SP1', sku: 'SKU1',
          costPrice: 50000, price: 100000, categoryId: null,
          category: null, inventories: [],
        },
      ]);

      const result = await service.getPricingInsights();

      expect(result.products.length).toBe(1);
      const p = result.products[0];
      expect(p).toHaveProperty('id');
      expect(p).toHaveProperty('name');
      expect(p).toHaveProperty('sku');
      expect(p).toHaveProperty('costPrice');
      expect(p).toHaveProperty('price');
      expect(p).toHaveProperty('warnings');
      expect(Array.isArray(p.warnings)).toBe(true);
    });

    test('summary numbers are consistent', async () => {
      prisma.product.findMany.mockResolvedValue([
        {
          id: 'p1', name: 'SP1', sku: 'SKU1',
          costPrice: 50000, price: 100000, categoryId: null,
          category: null, inventories: [],
        },
        {
          id: 'p2', name: 'SP2', sku: 'SKU2',
          costPrice: 80000, price: 50000, categoryId: null,
          category: null, inventories: [],
        },
      ]);

      const result = await service.getPricingInsights();

      expect(result.summary.total).toBe(result.products.length);
      expect(result.summary.belowCostCount).toBe(1);
      expect(result.summary.lowMarginCount).toBeGreaterThanOrEqual(0);
      expect(result.summary.noCostCount).toBeGreaterThanOrEqual(0);
    });

    test('BELOW_COST warning when price < costPrice', async () => {
      prisma.product.findMany.mockResolvedValue([
        {
          id: 'p2', name: 'SP2', sku: 'SKU2',
          costPrice: 80000, price: 50000, categoryId: null,
          category: null, inventories: [],
        },
      ]);

      const result = await service.getPricingInsights();

      const belowCost = result.products.filter((p) =>
        p.warnings.some((w) => w.type === 'BELOW_COST')
      );
      expect(belowCost.length).toBe(result.summary.belowCostCount);
      expect(belowCost.length).toBe(1);
    });
  });

// ==================== GET REORDER SUGGESTIONS ====================
  //
  // 2026-10-04: `getReorderSuggestions` chuyển sang dùng engine ROP của module
  // `replenishment` (trước đây tự tính bằng `(minStock*2 - qty) * 1.2` với ngưỡng
  // `10` hard-code). Test mock theo ĐÚNG nguồn dữ liệu mới — gồm cả lịch sử bán —
  // vì bỏ lịch sử bán thì `planReplenishment` cho ROP = 0 và không có gì để đề
  // xuất. Các khẳng định cũ (qty > 0, thứ tự ưu tiên, trường bắt buộc) GIỮ NGUYÊN.
  describe('getReorderSuggestions', () => {
    const daysAgo = (n) => new Date(Date.now() - n * 86400000);

    /** 28 ngày bán đều đặn => nhu cầu > 0 => ROP > 0. */
    const salesRows = (productId, perDay = 5) =>
      Array.from({ length: 28 }, (_, i) => ({
        productId,
        quantity: perDay,
        order: { createdAt: daysAgo(27 - i) },
      }));

    const candidate = (id, qty, minStock = 10, perDay = 5) => ({
      id,
      sku: `SKU${id}`,
      name: `SP${id}`,
      unit: 'cái',
      costPrice: 10000,
      category: null,
      inventories: [{ quantity: qty, minStock, warehouse: { name: 'Kho 1' } }],
    });

    /** Mock trọn bộ đầu vào cho một danh sách SKU. */
    const seed = (rows) => {
      prisma.product.findMany.mockResolvedValue(rows);
      prisma.inventory.findMany.mockResolvedValue(
        rows.flatMap((r) =>
          r.inventories.map((inv, i) => ({
            id: `inv-${r.id}-${i}`,
            productId: r.id,
            quantity: inv.quantity,
            reserved: 0,
          }))
        )
      );
      prisma.orderItem.findMany.mockResolvedValue(rows.flatMap((r) => salesRows(r.id)));
      prisma.purchaseItem.findMany.mockResolvedValue([]);
    };

    test('returns structured response with suggestions and summary', async () => {
      seed([candidate('p1', 0)]);

      const result = await service.getReorderSuggestions();

      expect(result).toHaveProperty('suggestions');
      expect(result).toHaveProperty('summary');
      expect(Array.isArray(result.suggestions)).toBe(true);
      expect(result.summary).toHaveProperty('total');
      expect(result.summary).toHaveProperty('urgentCount');
      expect(result.summary).toHaveProperty('highCount');
      expect(result.summary).toHaveProperty('noVendorCount');
    });

    test('ghi rõ engine đã dùng (không còn công thức riêng)', async () => {
      seed([candidate('p1', 0)]);
      const result = await service.getReorderSuggestions();
      expect(result.summary.engine).toBe('replenishment/planReplenishment');
    });

    test('each suggestion has required fields', async () => {
      seed([candidate('p1', 0)]);

      const result = await service.getReorderSuggestions();

      expect(result.suggestions.length).toBeGreaterThan(0);
      const s = result.suggestions[0];
      expect(s).toHaveProperty('productId');
      expect(s).toHaveProperty('productName');
      expect(s).toHaveProperty('currentStock');
      expect(s).toHaveProperty('minStock');
      expect(s).toHaveProperty('suggestedReorderQty');
      expect(s).toHaveProperty('priority');
      expect(s).toHaveProperty('message');
      // Bằng chứng để người dùng tin con số: ROP, lead time, cờ "ước lượng".
      expect(s).toHaveProperty('rop');
      expect(s).toHaveProperty('leadTimeDays');
      expect(s).toHaveProperty('leadTimeEstimated');
      expect(['URGENT', 'HIGH', 'MEDIUM', 'LOW']).toContain(s.priority);
    });

    test('suggestions are sorted by priority', async () => {
      seed([candidate('p1', 0), candidate('p2', 4), candidate('p3', 60)]);

      const result = await service.getReorderSuggestions();

      const order = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
      const priorities = result.suggestions.map((s) => order[s.priority] ?? 4);
      for (let i = 1; i < priorities.length; i++) {
        expect(priorities[i]).toBeGreaterThanOrEqual(priorities[i - 1]);
      }
    });

    test('suggested reorder quantity is positive', async () => {
      seed([candidate('p1', 0), candidate('p2', 4)]);

      const result = await service.getReorderSuggestions();

      expect(result.suggestions.length).toBeGreaterThan(0);
      for (const s of result.suggestions) {
        expect(s.suggestedReorderQty).toBeGreaterThan(0);
      }
    });

    test('không đề xuất khi tồn còn dồn (ROP = 0 => không có nhu cầu)', async () => {
      // Không lịch sử bán => nhu cầu 0 => ROP 0 => KHÔNG được bịa "cần nhập".
      prisma.product.findMany.mockResolvedValue([candidate('p1', 0)]);
      prisma.inventory.findMany.mockResolvedValue([{ productId: 'p1', quantity: 0, reserved: 0 }]);
      prisma.orderItem.findMany.mockResolvedValue([]);
      prisma.purchaseItem.findMany.mockResolvedValue([]);

      const result = await service.getReorderSuggestions();

      expect(result.suggestions).toEqual([]);
      expect(result.summary.total).toBe(0);
    });
  });

  // ==================== GET BUSINESS HEALTH ====================
  describe('getBusinessHealth', () => {
    beforeEach(() => {
      prisma.bankAccount.findMany.mockResolvedValue([]);
      prisma.order.aggregate.mockResolvedValue(emptyAggregate);
      prisma.expense.aggregate.mockResolvedValue(emptyAggregate);
      prisma.debt.aggregate.mockResolvedValue(emptyAggregate);
      prisma.inventory.count.mockResolvedValue(0);
      prisma.inventory.findMany.mockResolvedValue([]);
    });

    test('returns score between 0 and 100', async () => {
      const result = await service.getBusinessHealth();

      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
    });

    test('returns label and color', async () => {
      const result = await service.getBusinessHealth();

      expect(result).toHaveProperty('label');
      expect(result).toHaveProperty('color');
      expect(typeof result.label).toBe('string');
      expect(result.color).toMatch(/^#[0-9a-f]{6}$/);
    });

    test('breakdown weights sum to 100', async () => {
      const result = await service.getBusinessHealth();

      const totalWeight = Object.values(result.breakdown).reduce(
        (sum, b) => sum + b.weight, 0
      );
      expect(totalWeight).toBe(100);
    });

    test('each breakdown has score, weight, label', async () => {
      const result = await service.getBusinessHealth();

      for (const [, val] of Object.entries(result.breakdown)) {
        expect(val.score).toBeGreaterThanOrEqual(0);
        expect(val.score).toBeLessThanOrEqual(100);
        expect(val.weight).toBeGreaterThan(0);
        expect(typeof val.label).toBe('string');
      }
    });

    test('metrics object has required keys', async () => {
      const result = await service.getBusinessHealth();

      expect(result.metrics).toHaveProperty('bankBalance');
      expect(result.metrics).toHaveProperty('monthRevenue');
      expect(result.metrics).toHaveProperty('monthExpenses');
      expect(result.metrics).toHaveProperty('monthProfit');
      expect(result.metrics).toHaveProperty('marginPercent');
      expect(result.metrics).toHaveProperty('growthPercent');
      expect(result.metrics).toHaveProperty('arOutstanding');
      expect(result.metrics).toHaveProperty('arOverdue');
    });

    test('insights are array with area and suggestion', async () => {
      const result = await service.getBusinessHealth();

      expect(Array.isArray(result.insights)).toBe(true);
      for (const ins of result.insights) {
        expect(ins).toHaveProperty('area');
        expect(ins).toHaveProperty('suggestion');
        expect(ins).toHaveProperty('icon');
      }
    });
  });

  // ==================== GET SIMPLE REPORT ====================
  describe('getSimpleReport', () => {
    beforeEach(() => {
      prisma.bankAccount.findMany.mockResolvedValue([]);
      prisma.order.aggregate.mockResolvedValue(emptyAggregate);
      prisma.expense.aggregate.mockResolvedValue(emptyAggregate);
      prisma.debt.aggregate.mockResolvedValue(emptyAggregate);
      prisma.inventory.count.mockResolvedValue(0);
      prisma.inventory.findMany.mockResolvedValue([]);
      prisma.product.findMany.mockResolvedValue([]);
      prisma.orderItem.findMany.mockResolvedValue([]);
      prisma.purchaseItem.findMany.mockResolvedValue([]);
      prisma.order.count.mockResolvedValue(0);
      prisma.customer.count.mockResolvedValue(0);
    });

    test('returns structured report', async () => {
      const result = await service.getSimpleReport();

      expect(result).toHaveProperty('generatedAt');
      expect(result).toHaveProperty('health');
      expect(result).toHaveProperty('today');
      expect(result).toHaveProperty('month');
      expect(result).toHaveProperty('narrative');
      expect(result).toHaveProperty('urgentActions');
    });

    test('narrative is an array of strings', async () => {
      const result = await service.getSimpleReport();

      expect(Array.isArray(result.narrative)).toBe(true);
      for (const line of result.narrative) {
        expect(typeof line).toBe('string');
        expect(line.length).toBeGreaterThan(0);
      }
    });

    test('urgent actions have required properties', async () => {
      const result = await service.getSimpleReport();

      for (const action of result.urgentActions) {
        expect(action).toHaveProperty('action');
        expect(action).toHaveProperty('detail');
        expect(action).toHaveProperty('link');
      }
    });

    test('report includes health score', async () => {
      const result = await service.getSimpleReport();

      expect(result.health).toHaveProperty('score');
      expect(result.health).toHaveProperty('label');
    });
  });
});
