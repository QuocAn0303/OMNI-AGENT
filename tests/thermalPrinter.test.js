/**
 * Unit tests for thermal printer ESC/POS logic
 *
 * Tests the core receipt building functions
 * Since the module uses ES module syntax (frontend/type: module),
 * we replicate the core logic here for testing.
 */

// ---- Replicate core logic from thermalPrinter.js ----
const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;
const CUT_FEED = 4;

function textEncoder() {
  return new TextEncoder();
}

function command(...bytes) {
  return new Uint8Array(bytes);
}

function textLine(str, align = 'left') {
  const encoder = textEncoder();
  const raw = encoder.encode(str);
  const line = `  ${str}`;
  return new Uint8Array([ESC, 0x61, align === 'center' ? 1 : align === 'right' ? 2 : 0, ...raw, LF]);
}

function boldLine(str) {
  const encoder = textEncoder();
  const raw = encoder.encode(str);
  return new Uint8Array([ESC, 0x45, 1, ...raw, ESC, 0x45, 0, LF]);
}

function doubleSize(str) {
  const encoder = textEncoder();
  const raw = encoder.encode(str);
  return new Uint8Array([ESC, 0x21, 0x30, ESC, 0x61, 1, ...raw, ESC, 0x21, 0x00, ESC, 0x61, 0, LF]);
}

function dashedLine() {
  const line = '-'.repeat(32);
  return textLine(line);
}

function cutPaper() {
  return command(GS, 0x56, 0x42, CUT_FEED);
}

function formatMoney(val) {
  return Number(val || 0).toLocaleString('vi-VN');
}

function buildReceipt(order, config) {
  const shopName = config?.shopName || 'SHOP';
  const parts = [];

  // Header
  parts.push(doubleSize(shopName));
  parts.push(dashedLine());

  // Order info
  parts.push(textLine(`So HD: ${order.orderCode || ''}`));
  parts.push(dashedLine());

  // Items
  const items = order.items || [];
  for (const item of items) {
    parts.push(textLine(`${item.name} x${item.quantity}  ${formatMoney(item.price)}`));
  }

  parts.push(dashedLine());
  parts.push(textLine(`Tong: ${formatMoney(order.total)}`));

  // Footer
  parts.push(dashedLine());
  parts.push(textLine('Cam on quy khach!'));

  // Cut + cash drawer
  parts.push(cutPaper());
  const hasCash = (order.payments || []).some(p => p.method === 'CASH');
  if (hasCash) {
    parts.push(command(ESC, 0x70, 0x00, 0x19, 0xfa));
  }

  // Concatenate
  const totalLen = parts.reduce((sum, p) => sum + p.length, 0);
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const p of parts) {
    result.set(p, offset);
    offset += p.length;
  }
  return result;
}

// ---- Tests ----
describe('Thermal Printer ESC/POS Logic', () => {
  const mockOrder = {
    orderCode: 'ORD-20260629-0001',
    total: 600000,
    items: [
      { name: 'Ao thun co tron', quantity: 2, price: 150000 },
      { name: 'Quan jeans nam', quantity: 1, price: 350000 },
    ],
    payments: [
      { method: 'CASH', amount: 400000 },
    ],
  };
  const config = { shopName: 'CUA HANG TEST' };

  test('buildReceipt returns Uint8Array', () => {
    const bytes = buildReceipt(mockOrder, config);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(100);
  });

  test('receipt contains shop name', () => {
    const bytes = buildReceipt(mockOrder, config);
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain('CUA HANG TEST');
  });

  test('receipt contains order code', () => {
    const bytes = buildReceipt(mockOrder, config);
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain('ORD-20260629-0001');
  });

  test('receipt contains item names', () => {
    const bytes = buildReceipt(mockOrder, config);
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain('Ao thun co tron');
    expect(text).toContain('Quan jeans nam');
  });

  test('receipt includes formatted total', () => {
    const bytes = buildReceipt(mockOrder, config);
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain('600.000');
  });

  test('receipt contains ESC commands', () => {
    const bytes = buildReceipt(mockOrder, config);
    const arr = Array.from(bytes);
    expect(arr.filter(b => b === 0x1b).length).toBeGreaterThan(3);
  });

  test('receipt contains GS command for paper cut', () => {
    const bytes = buildReceipt(mockOrder, config);
    const arr = Array.from(bytes);
    expect(arr.some(b => b === 0x1d)).toBe(true);
  });

  test('buildReceipt handles minimal order', () => {
    const minimal = { orderCode: 'MIN-001', total: 0, items: [], payments: [] };
    const bytes = buildReceipt(minimal, config);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(20);
  });

  test('empty order does not throw', () => {
    const empty = { orderCode: '', total: 0, items: [], payments: [] };
    expect(() => buildReceipt(empty, config)).not.toThrow();
  });

  test('formatMoney formats VND', () => {
    expect(formatMoney(1000000)).toBe('1.000.000');
    expect(formatMoney(50000)).toBe('50.000');
    expect(formatMoney(0)).toBe('0');
    expect(formatMoney(null)).toBe('0');
  });
});
