'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createCatalog, generateTwoMonthOperationsLog, buildVnSeedData, seedVnSupplyChain, auditInventory } = require('../vnSeedData');
const { addDays } = require('../services/operations.service');
const { quoteShipping } = require('../services/logistics.service');
const dataset = buildVnSeedData();
const { catalog, operations: log } = dataset;
const sum = (rows, field) => rows.reduce((total, row) => total + row[field], 0);

describe('Danh mục Việt Nam', () => {
  test('2 hub, đủ cây Zone → Aisle → Rack → Bin và ID không trùng', () => {
    expect(catalog.warehouses.map(w => w.id)).toEqual(['WH-HCM', 'WH-HN']);
    expect(catalog.bins).toHaveLength(96);
    expect(new Set(catalog.bins.map(b => b.id)).size).toBe(96);
    for (const hub of catalog.warehouses) {
      expect(hub.zones.map(z => z.code)).toEqual(['A', 'B', 'Q', 'R']);
      for (const zone of hub.zones) for (const aisle of zone.aisles) for (const rack of aisle.racks) {
        expect(rack.bins.length).toBeGreaterThan(0);
        for (const bin of rack.bins) {
          expect(bin.id).toMatch(/^(HCM|HN)-[ABQR]-\d{2}-R\d-B\d{2}$/);
          expect(bin.warehouseId).toBe(hub.id);
          expect(bin.sellable).toBe(['A', 'B'].includes(zone.code));
        }
      }
    }
  });
  test('5 SKU vật lý với 3 chiến lược và giá trị tiền nguyên VNĐ', () => {
    expect(catalog.products).toHaveLength(5);
    expect(new Set(catalog.products.map(p => p.strategy))).toEqual(new Set(['PUSH', 'PUSH_PULL', 'PULL']));
    for (const p of catalog.products) {
      expect(p.isPhysical).toBe(true);
      expect(p.currency).toBe('VNĐ');
      for (const field of ['unitCost', 'sellingPrice', 'weightGram', 'volumeCm3', 'eoq', 'moq', 'holdingCostPerDay', 'stockoutPenaltyPerUnit']) {
        expect(Number.isSafeInteger(p[field])).toBe(true);
        expect(p[field]).toBeGreaterThan(0);
      }
      expect(p.sellingPrice).toBeGreaterThan(p.unitCost);
    }
  });
  test('mỗi SKU có NCC chính và dự phòng, giá dự phòng +6–8%, đúng lead time/MOQ', () => {
    for (const product of catalog.products) {
      const offers = catalog.suppliers.filter(s => s.offers.some(o => o.sku === product.sku));
      expect(offers).toHaveLength(2);
      const primary = offers.find(s => s.role === 'PRIMARY');
      const backup = offers.find(s => s.role === 'BACKUP');
      expect(primary.leadTimeDays).toBeGreaterThanOrEqual(10);
      expect(primary.leadTimeDays).toBeLessThanOrEqual(14);
      expect(primary.paymentTerms).toBe('Net 30');
      expect(backup.leadTimeDays).toBeGreaterThanOrEqual(3);
      expect(backup.leadTimeDays).toBeLessThanOrEqual(5);
      expect(backup.moq).toBeLessThan(primary.moq);
      const price = backup.offers.find(o => o.sku === product.sku).unitCost;
      expect(price).toBeGreaterThanOrEqual(product.unitCost * 1.06);
      expect(price).toBeLessThanOrEqual(Math.ceil(product.unitCost * 1.08));
    }
  });
  test('4 3PL, cấu hình biểu phí SLA COD và giới hạn Ahamove 2H', () => {
    expect(catalog.carriers.map(c => c.id)).toEqual(['GHN', 'GHTK', 'VTP', 'AHAMOVE_2H']);
    expect(catalog.carriers.find(c => c.id === 'GHTK').supportsPartialDelivery).toBe(true);
    for (const carrier of catalog.carriers) {
      expect(['T+3', 'T+5']).toContain(carrier.codCycle);
      expect(carrier.isSimulatedTariff).toBe(true);
      expect(Object.keys(carrier.baseFees)).toEqual(Object.keys(carrier.slaHours));
    }
    expect(catalog.carriers.find(c => c.id === 'AHAMOVE_2H').slaHours).toEqual({ INTRACITY: 2 });
  });
  test('catalog được tạo mới, không rò trạng thái giữa các lần gọi', () => {
    const first = createCatalog();
    first.products[0].unitCost = 1;
    expect(createCatalog().products[0].unitCost).toBe(55000);
  });
});

describe('Nhật ký 60 ngày và cân bằng chứng từ', () => {
  test('60 ngày liên tục, 2400 dòng cầu theo 2 kho × 5 SKU × 4 kênh', () => {
    expect(log.dailyLogs).toHaveLength(60);
    expect(log.demand).toHaveLength(2400);
    expect(log.inventory).toHaveLength(600);
    expect(log.dailyLogs.map(row => row.date)).toEqual(Array.from({ length: 60 }, (_, i) => addDays('2026-11-01', i)));
    expect(log.metadata.endDate).toBe('2026-12-30');
    for (const daily of log.dailyLogs) expect(log.demand.filter(row => row.date === daily.date)).toHaveLength(40);
  });
  test('đỉnh 11/11 và 12/12 thể hiện trên cầu thật, không lấy xuất bán thay cầu', () => {
    for (const date of ['2026-11-11', '2026-12-12']) {
      const peak = log.demand.filter(r => r.date === date && r.sku === 'VN-S-001');
      const baseline = log.demand.filter(r => r.date === addDays(date, -1) && r.sku === 'VN-S-001');
      expect(sum(peak, 'actualDemand')).toBeGreaterThan(sum(baseline, 'actualDemand') * 5);
      expect(peak.every(row => row.megaSale !== null)).toBe(true);
    }
    expect(log.demand.some(row => row.stockoutQuantity > 0)).toBe(true);
  });
  test('đối chiếu độc lập 600 số dư với GRN, QC và xuất; liên tục 60 ngày', () => {
    const previous = new Map(log.initialInventory.map(row => [row.warehouseId + row.sku, row.quantity]));
    for (const row of log.inventory) {
      const matches = source => source.warehouseId === row.warehouseId && source.sku === row.sku;
      const received = sum(log.goodsReceipts.filter(g => matches(g) && g.date === row.date), 'acceptedQuantity');
      const returned = sum(log.returns.filter(r => matches(r) && r.qcDate === row.date && r.status === 'QC_COMPLETED'), 'acceptedQuantity');
      const issued = sum(log.demand.filter(d => matches(d) && d.date === row.date), 'fulfilledQuantity');
      expect(row.opening).toBe(previous.get(row.warehouseId + row.sku));
      expect(row.grnReceived).toBe(received);
      expect(row.qcReturns).toBe(returned);
      expect(row.salesIssued).toBe(issued);
      expect(row.closing).toBe(row.opening + received + returned - issued);
      expect(row.closing).toBeGreaterThanOrEqual(0);
      previous.set(row.warehouseId + row.sku, row.closing);
    }
    expect(sum(log.initialInventory, 'quantity') + sum(log.goodsReceipts, 'acceptedQuantity')
      + sum(log.returns, 'acceptedQuantity') - sum(log.demand, 'fulfilledQuantity'))
      .toBe([...previous.values()].reduce((a, b) => a + b, 0));
    expect(dataset.audit).toMatchObject({ balanced: true, checkedDays: 60, checkedInventoryRows: 600, difference: 0 });
  });
  test('COD 65% / Prepaid 35% làm tròn tối đa nửa đơn, POS trả trước', () => {
    const total = sum(log.demand, 'orderCount');
    const cod = sum(log.demand, 'codOrders');
    const prepaid = sum(log.demand, 'prepaidOrders');
    expect(cod + prepaid).toBe(total);
    expect(Math.abs(cod - total * 0.65)).toBeLessThanOrEqual(0.5);
    expect(log.demand.filter(row => row.channel === 'POS').every(row => row.codOrders === 0)).toBe(true);
    for (const row of log.demand) {
      expect(row.codAmount + row.prepaidAmount).toBe(row.grossAmount);
      expect(row.failedCodOrders).toBeLessThanOrEqual(row.codOrders);
      expect(row.failedPrepaidOrders).toBeLessThanOrEqual(row.prepaidOrders);
    }
  });
  test('PO đủ chính/dự phòng, đúng MOQ, thời gian nhập, giá và công nợ', () => {
    expect(new Set(log.purchaseOrders.map(p => p.supplierRole))).toEqual(new Set(['PRIMARY', 'BACKUP']));
    expect(log.purchaseOrders.some(p => p.reason === 'PRIMARY_DELAY')).toBe(true);
    expect(log.purchaseOrders.some(p => p.reason === 'DEMAND_SURGE')).toBe(true);
    for (const po of log.purchaseOrders) {
      const supplier = catalog.suppliers.find(s => s.id === po.supplierId);
      expect(po.quantity % supplier.moq).toBe(0);
      expect(po.quantity).toBeGreaterThanOrEqual(supplier.moq);
      expect(po.promisedDate).toBe(addDays(po.date, supplier.leadTimeDays));
      expect(po.expectedReceiptDate).toBe(addDays(po.promisedDate, po.delayDays));
      expect(po.paymentDueDate).toBe(addDays(po.date, supplier.paymentDueDays));
      expect(po.totalCost).toBe(po.quantity * po.unitCost);
      const receipts = log.goodsReceipts.filter(g => g.poId === po.id);
      expect(receipts).toHaveLength(po.status === 'RECEIVED' ? 1 : 0);
      if (receipts.length) expect(receipts[0].date).toBe(po.expectedReceiptDate);
    }
    expect(log.purchaseOrders.some(p => p.status === 'OPEN')).toBe(true);
  });
  test('hàng hoàn chưa QC và chứng từ ngoài kỳ không nhập vào tồn bán được', () => {
    expect(log.returns.some(row => row.rejectedQuantity > 0)).toBe(true);
    expect(log.returns.some(row => row.qcDate > log.metadata.endDate)).toBe(true);
    for (const event of log.returns) {
      expect(event.receivingBinId).toContain('-R-');
      expect(event.quarantineBinId).toContain('-Q-');
      if (event.qcDate > log.metadata.endDate) expect(event.acceptedQuantity).toBe(0);
      else expect(event.acceptedQuantity + event.rejectedQuantity).toBe(event.quantity);
    }
    expect(log.goodsReceipts.every(row => row.date <= log.metadata.endDate)).toBe(true);
  });
  test('đối soát COD sau giao thành công, không thu tiền đơn RTS', () => {
    for (const settlement of log.codSettlements) {
      const row = log.demand.find(d => d.id === settlement.demandId);
      const carrier = catalog.carriers.find(c => c.id === row.carrierId);
      expect(settlement.orders).toBe(row.codOrders - row.failedCodOrders);
      expect(settlement.amount).toBe(settlement.orders * row.unitPrice);
      expect(settlement.settlementDate).toBe(addDays(row.deliveryDate, carrier.codSettlementDays));
      expect(settlement.status).toBe(settlement.settlementDate <= log.metadata.endDate ? 'SETTLED' : 'PENDING');
    }
  });
  test('tái lập hoàn toàn theo seed, seed khác cho cầu khác', () => {
    expect(generateTwoMonthOperationsLog()).toEqual(log);
    expect(generateTwoMonthOperationsLog({ seed: 1 }).demand).not.toEqual(log.demand);
  });
  test.each([0, 1, 42, 4294967295])('cân bằng với seed biên %s', seed => {
    expect(buildVnSeedData({ seed }).audit.difference).toBe(0);
  });
  test('đúng ngày qua năm nhuận và giao năm', () => {
    expect(generateTwoMonthOperationsLog({ startDate: '2024-02-01' }).dailyLogs[28].date).toBe('2024-02-29');
    expect(generateTwoMonthOperationsLog({ startDate: '2026-12-20' }).dailyLogs[12].date).toBe('2027-01-01');
  });
  test.each([null, [], { days: 56 }, { days: 61 }, { seed: -1 }, { seed: 0.5 }, { seed: NaN },
    { seed: 4294967296 }, { seed: '1' }, { startDate: '2026-02-30' }, { startDate: '2026-2-01' },
    { startDate: 'abc' }, { startDate: '2100-01-01' }, { unsupported: true }])('từ chối input không hợp lệ %j', input => {
    expect(() => generateTwoMonthOperationsLog(input)).toThrow();
  });
  test('audit phát hiện cân bằng giả khi sửa cả nhập và tồn cuối', () => {
    const altered = structuredClone(log);
    altered.inventory[0].grnReceived += 1;
    altered.inventory[0].closing += 1;
    expect(() => auditInventory(catalog, altered)).toThrow(/GRN/);
  });
  test('audit phát hiện trùng khóa, đứt tồn đầu và sai chứng từ', () => {
    for (const tamper of [
      data => { data.inventory[10].opening += 1; },
      data => { data.inventory[1] = { ...data.inventory[0], id: 'different' }; },
      data => { data.goodsReceipts[0].poId = 'missing'; },
      data => { data.returns[0].acceptedQuantity += 1; },
    ]) {
      const altered = structuredClone(log);
      tamper(altered);
      expect(() => auditInventory(catalog, altered)).toThrow();
    }
  });
});

describe('Seed snapshot idempotent, ghi nguyên tử', () => {
  let directory;
  beforeEach(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vn-supply-chain-test-')); });
  afterEach(() => { jest.restoreAllMocks(); fs.rmSync(directory, { recursive: true, force: true }); });
  test('chạy 2 lần giữ nguyên byte, ID và số lượng; đổi seed thay snapshot', () => {
    const first = seedVnSupplyChain({}, directory);
    const bytes = fs.readFileSync(first.filePath, 'utf8');
    const second = seedVnSupplyChain({}, directory);
    expect(first.changed).toBe(true);
    expect(second.changed).toBe(false);
    expect(fs.readFileSync(second.filePath, 'utf8')).toBe(bytes);
    const third = seedVnSupplyChain({ seed: 8 }, directory);
    expect(third.changed).toBe(true);
    const stored = JSON.parse(fs.readFileSync(third.filePath, 'utf8'));
    expect(stored.operations.demand).toHaveLength(2400);
    expect(new Set(stored.operations.demand.map(row => row.id)).size).toBe(2400);
    expect(fs.readdirSync(directory)).toEqual(['vn-seed.json']);
  });
  test('input sai không ghi file', () => {
    expect(() => seedVnSupplyChain({ days: 59 }, directory)).toThrow();
    expect(fs.readdirSync(directory)).toEqual([]);
  });
  test('lỗi ghi giữ nguyên snapshot trước và dọn file tạm/lock', () => {
    const first = seedVnSupplyChain({}, directory);
    const bytes = fs.readFileSync(first.filePath, 'utf8');
    jest.spyOn(fs, 'renameSync').mockImplementation(() => { throw new Error('disk failure'); });
    expect(() => seedVnSupplyChain({ seed: 2 }, directory)).toThrow('disk failure');
    expect(fs.readFileSync(first.filePath, 'utf8')).toBe(bytes);
    expect(fs.readdirSync(directory)).toEqual(['vn-seed.json']);
  });
  test('không giành khóa của tiến trình khác', () => {
    fs.writeFileSync(path.join(directory, '.vn-seed.lock'), '');
    expect(() => seedVnSupplyChain({}, directory)).toThrow();
    expect(fs.readdirSync(directory)).toEqual(['.vn-seed.lock']);
  });
});

describe('Tính phí vận chuyển mô phỏng', () => {
  const base = { carrierId: 'GHN', lane: 'INTRACITY', originCity: 'TP.HCM', destinationCity: 'TP.HCM', weightGram: 500, volumeCm3: 1000 };
  test('trọng lượng thực/quy đổi và bậc tăng làm tròn lên, tiền nguyên VNĐ', () => {
    expect(quoteShipping(base)).toMatchObject({ amount: 22000, currency: 'VNĐ', slaHours: 24 });
    expect(quoteShipping({ ...base, weightGram: 501 }).amount).toBe(27000);
    expect(quoteShipping({ ...base, volumeCm3: 10000 })).toMatchObject({ amount: 37000, billableWeightGram: 2000 });
  });
  test('Ahamove đúng SLA 2 giờ và phí theo km', () => {
    expect(quoteShipping({ ...base, carrierId: 'AHAMOVE_2H', distanceKm: 6 })).toMatchObject({ amount: 35000, slaHours: 2 });
  });
  test.each([{ weightGram: -1 }, { volumeCm3: 0 }, { codAmount: 1.5 }, { carrierId: 'OTHER' },
    { lane: 'INTRACITY', destinationCity: 'Hà Nội' }, { carrierId: 'AHAMOVE_2H', lane: 'INTERREGIONAL' },
    { carrierId: 'AHAMOVE_2H', originCity: 'Đà Nẵng', destinationCity: 'Đà Nẵng' },
    { carrierId: 'AHAMOVE_2H', distanceKm: 16 }])('từ chối tuyến/tham số sai %j', changes => {
    expect(() => quoteShipping({ ...base, ...changes })).toThrow();
  });
});
