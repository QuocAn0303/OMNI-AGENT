jest.mock('../src/config/prisma', () => ({
  agentHumanGate: { findFirst: jest.fn() },
}));
jest.mock('../src/utils/logger', () => ({ info: jest.fn(), error: jest.fn() }));

const prisma = require('../src/config/prisma');
const { explainProposalForGate } = require('../src/modules/replenishment/proposal-explain.service');
const { withPurchaseQuantity } = require('../src/modules/replenishment/proposal-quantity');

const proposal = () => ({
  id: 'gate-1', status: 'PENDING',
  actionPayload: {
    items: [{ productId: 'p1', sku: 'SP001501', productName: 'Cà phê 160 gói', quantity: 49, unitCost: 9231 }],
    totalEstimate: 452319, vendorName: 'NCC 83', leadTimeDays: 7,
    rationale: { atp: 8, rop: 33, demandPerDay: 3.286, safetyStock: 9 },
  },
});

beforeEach(() => {
  jest.clearAllMocks();
  prisma.agentHumanGate.findFirst.mockResolvedValue(proposal());
});

test.each([12, 75, 1])('tin NCC và tổng tiền dùng số người chọn %p, giải thích vẫn giữ số gợi ý', async (quantity) => {
  const result = await explainProposalForGate({ tenantId: 'tenant-1', gateId: 'gate-1', quantity, mode: 'template' });
  expect(result.vendorMessage).toContain(`cần ${quantity} Cà phê 160 gói`);
  expect(result.explanation).toContain('Đề xuất nhập 49');
  expect(result.numbers.orderQty).toBe(49);
  expect(result.selectedQuantity).toBe(quantity);
  expect(result.selectedTotal).toBe(quantity * 9231);
  expect(result.guardrail.passed).toBe(true);
  expect(result.guardrail.vendorCheckedNumbers).toContainEqual({ truong: 'orderQty', giaTri: quantity });
  expect(result.vendorMessageSent).toBe(false);
  expect(prisma.agentHumanGate.findFirst.mock.calls[0][0].where.tenantId).toBe('tenant-1');
});

test('xem trước không thay đổi payload và luôn giữ lại số gợi ý ban đầu', () => {
  const payload = proposal().actionPayload;
  const selected = withPurchaseQuantity(payload, 75);
  const changed = withPurchaseQuantity(selected, 12);
  expect(payload.items[0].quantity).toBe(49);
  expect(payload.totalEstimate).toBe(452319);
  expect(changed.suggestedQuantity).toBe(49);
  expect(changed.items[0].quantity).toBe(12);
  expect(changed.totalEstimate).toBe(110772);
});

test.each([NaN, Infinity, undefined, 0, -1, 2.5, null, '12', true])('không chấp nhận số lượng %p', (quantity) => {
  expect(() => withPurchaseQuantity(proposal().actionPayload, quantity)).toThrow();
});

test('tổng vượt độ chính xác cột tiền không được ghi', () => {
  const payload = proposal().actionPayload;
  payload.items[0].unitCost = 1e12;
  expect(() => withPurchaseQuantity(payload, 100)).toThrow();
});
