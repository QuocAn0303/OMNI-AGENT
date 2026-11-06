'use strict';
const { createWmsService, calculateEOQ, calculateROP } = require('../wms.service');
const { evaluateSupplyChainSignals } = require('../scoringAdapter');
const HCM = 'WH-HCM', HN = 'WH-HN', SKU = 'VN-B-001';
const A = 'HCM-A-01-R1-B01', B = 'HCM-A-02-R1-B01', Q = 'HCM-Q-01-R1-B01';
const NOW = '2026-11-01T02:00:00.000Z';
const initial = (quantity = 10, binId = A) => ({ warehouseId: HCM, sku: SKU, binId, quantity });
const create = rows => createWmsService({ clock: () => NOW, initialInventory: rows || [] });
const order = (orderId = 'O1', quantity = 2) => ({ orderId, warehouseId: HCM, channel: 'Shopee', items: [{ sku: SKU, quantity }] });
const shipment = (overrides = {}) => ({ requestId: 'schedule', shipmentId: 'S1', sourceId: 'PO1', sourceType: 'PO',
  supplierId: 'SUP-B-PRIMARY', warehouseId: HCM, quarantineBinId: Q, items: [{ sku: SKU, quantity: 10 }],
  expectedArrivalAt: '2026-11-03T02:00:00.000Z', expectedAvailableAt: '2026-11-04T02:00:00.000Z', ...overrides });
const pack = (overrides = {}) => ({ requestId: 'pack', orderId: 'O1', carrierId: 'GHN', lane: 'INTRACITY',
  destinationCity: 'TP.HCM', measuredWeightGram: 910, measuredVolumeCm3: 2500, ...overrides });
const stock = (w, binId) => w.getInventory({ warehouseId: HCM, sku: SKU, ...(binId ? { binId } : {}) });

describe('WMS: 5 bước và nhật ký từng bin', () => {
  test('Nhập → QC → Lưu → Nhặt → Đóng gói → Xuất; ATP và SLA chính xác', () => {
    let time = NOW;
    const w = createWmsService({ clock: () => time });
    w.registerInboundShipment(shipment());
    expect(stock(w)).toMatchObject({ inTransitQty: 10, onHandQty: 0, atpQty: 0 });
    w.receiveInboundGoods({ requestId: 'receive', receiptId: 'R1', shipmentId: 'S1',
      items: [{ sku: SKU, quantity: 10, passQty: 8, defectQty: 2 }] });
    expect(stock(w, Q)).toMatchObject({ inTransitQty: 0, quarantineQty: 10, atpQty: 0 });
    expect(w.getSnapshot().defectReports[0]).toMatchObject({ quantity: 2, disposition: 'RETURN_TO_SUPPLIER' });
    w.putawayToBin({ requestId: 'put', receiptId: 'R1', sku: SKU, binId: A, quantity: 8 });
    expect(stock(w)).toMatchObject({ quarantineQty: 2, onHandQty: 8, atpQty: 8 });
    w.returnDefectiveGoods({ requestId: 'defect', receiptId: 'R1', sku: SKU, quantity: 2 });
    expect(stock(w).quarantineQty).toBe(0);
    const picked = w.pickOrderItems({ requestId: 'pick', ...order() });
    expect(picked.status).toBe('PICKED');
    expect(stock(w)).toMatchObject({ onHandQty: 8, reservedQty: 2, atpQty: 6 });
    const packed = w.packOrder(pack());
    expect(packed.package.trackingNumber).toMatch(/^GHN-SIM-/);
    expect(packed.package.box.id).toBe('THUNG-S');
    expect(stock(w).reservedQty).toBe(2);
    time = '2026-11-01T03:00:00.000Z';
    const shipped = w.shipOrderOut({ requestId: 'ship', orderId: 'O1' });
    expect(shipped).toMatchObject({ status: 'HANDED_OVER_CARRIER', shippedAt: time, slaDueAt: '2026-11-02T03:00:00.000Z' });
    expect(stock(w)).toMatchObject({ onHandQty: 6, reservedQty: 0, atpQty: 6 });
    for (const movement of w.getSnapshot().inventoryMovementLog) {
      expect(movement.after.atpQty).toBe(movement.after.onHandQty - movement.after.reservedQty);
      for (const field of ['onHandQty', 'reservedQty', 'quarantineQty', 'inTransitQty', 'atpQty']) {
        expect(movement.after[field]).toBeGreaterThanOrEqual(0);
        expect(movement.before[field] + movement.delta[field]).toBe(movement.after[field]);
      }
    }
    expect(new Set(w.getSnapshot().inventoryMovementLog.map(m => m.command)))
      .toEqual(new Set(['REGISTER_INBOUND', 'RECEIVE', 'PUTAWAY', 'RETURN_DEFECT', 'PICK', 'SHIP']));
  });
  test('nhận từng phần, chờ QC, lên kệ từng phần; không nhập trùng', () => {
    const w = create();
    w.registerInboundShipment(shipment());
    w.receiveInboundGoods({ requestId: 'r1', receiptId: 'R1', shipmentId: 'S1', items: [{ sku: SKU, quantity: 6 }] });
    expect(stock(w)).toMatchObject({ inTransitQty: 4, quarantineQty: 6, atpQty: 0 });
    expect(() => w.putawayToBin({ requestId: 'bad', receiptId: 'R1', sku: SKU, binId: A, quantity: 1 })).toThrow(/QC/);
    w.inspectInboundGoods({ requestId: 'qc', receiptId: 'R1', results: [{ sku: SKU, passQty: 5, defectQty: 1 }] });
    w.putawayToBin({ requestId: 'put1', receiptId: 'R1', sku: SKU, binId: A, quantity: 2 });
    w.putawayToBin({ requestId: 'put2', receiptId: 'R1', sku: SKU, binId: B, quantity: 3 });
    expect(stock(w)).toMatchObject({ onHandQty: 5, quarantineQty: 1, inTransitQty: 4, atpQty: 5 });
    expect(() => w.receiveInboundGoods({ requestId: 'r2', receiptId: 'R2', shipmentId: 'S1', items: [{ sku: SKU, quantity: 5 }] })).toThrow();
    w.receiveInboundGoods({ requestId: 'r3', receiptId: 'R2', shipmentId: 'S1', items: [{ sku: SKU, quantity: 4, passQty: 4, defectQty: 0 }] });
    expect(w.getSnapshot().shipments[0].status).toBe('RECEIVED');
    expect(() => w.inspectInboundGoods({ requestId: 'qc2', receiptId: 'R1', results: [{ sku: SKU, passQty: 5, defectQty: 1 }] })).toThrow();
  });
  test('điều chuyển bảo toàn hàng; không lấy hàng đang giữ chỗ', () => {
    const w = create([initial()]);
    w.reserveOrder({ requestId: 'reserve', ...order('O1', 3) });
    const args = shipment({ sourceType: 'TRANSFER', sourceId: 'TRANSFER1', supplierId: undefined,
      sourceWarehouseId: HCM, warehouseId: HN, quarantineBinId: 'HN-Q-01-R1-B01', items: [{ sku: SKU, quantity: 7 }] });
    w.registerInboundShipment(args);
    expect(stock(w)).toMatchObject({ onHandQty: 3, reservedQty: 3, atpQty: 0 });
    expect(w.getInventory({ warehouseId: HN, sku: SKU }).inTransitQty).toBe(7);
    w.receiveInboundGoods({ requestId: 'receive', receiptId: 'R1', shipmentId: 'S1', items: [{ sku: SKU, quantity: 7, passQty: 6, defectQty: 1 }] });
    expect(w.getSnapshot().defectReports[0].disposition).toBe('RETURN_TO_SOURCE');
    w.putawayToBin({ requestId: 'put', receiptId: 'R1', sku: SKU, binId: 'HN-B-01-R1-B01', quantity: 6 });
    expect(w.getSnapshot().inventory.reduce((n, r) => n + r.onHandQty + r.inTransitQty + r.quarantineQty, 0)).toBe(10);
    expect(() => w.registerInboundShipment({ ...args, requestId: 'too-much', shipmentId: 'S2' })).toThrow(/ATP/);
  });
  test('thất bại giữa chừng rollback toàn bộ SKU và không thêm nhật ký', () => {
    const w = create([initial()]);
    const before = w.getSnapshot();
    expect(() => w.reserveOrder({ requestId: 'reserve', ...order(), items: [
      { sku: SKU, quantity: 2 }, { sku: 'VN-A-001', quantity: 1 },
    ] })).toThrow(/ATP/);
    expect(w.getSnapshot()).toEqual(before);
  });
  test('replay không đổi tồn/log; cùng requestId khác payload bị chặn', () => {
    const w = create([initial()]);
    const input = { requestId: 'pick', ...order() };
    const first = w.pickOrderItems(input), before = w.getSnapshot();
    expect(w.pickOrderItems(input)).toEqual(first);
    expect(w.getSnapshot()).toEqual(before);
    expect(() => w.pickOrderItems({ ...input, items: [{ sku: SKU, quantity: 3 }] })).toThrow(/requestId/);
    w.packOrder(pack());
    const command = { requestId: 'ship', orderId: 'O1' };
    const shipped = w.shipOrderOut(command), after = w.getSnapshot();
    expect(w.shipOrderOut(command)).toEqual(shipped);
    expect(w.getSnapshot()).toEqual(after);
    expect(() => w.shipOrderOut({ ...command, requestId: 'ship2' })).toThrow();
  });
});

describe('ATP, nhặt hàng và lệch kệ', () => {
  test('hàng hoàn từ R sang Q chỉ tăng ATP sau QC và lên kệ; không nhận hoàn quá lượng xuất', () => {
    const w = create([initial(2)]);
    w.pickOrderItems({ requestId: 'pick', ...order() });
    w.packOrder(pack());
    w.shipOrderOut({ requestId: 'ship', orderId: 'O1' });
    const input = { requestId: 'return', receiptId: 'RTS1', orderId: 'O1', receivingBinId: 'HCM-R-01-R1-B01',
      quarantineBinId: Q, items: [{ sku: SKU, quantity: 2 }] };
    w.receiveReturnedGoods(input);
    expect(stock(w)).toMatchObject({ onHandQty: 0, atpQty: 0, quarantineQty: 2 });
    expect(() => w.receiveReturnedGoods({ ...input, requestId: 'return2', receiptId: 'RTS2' })).toThrow(/vượt/);
    w.inspectInboundGoods({ requestId: 'qc', receiptId: 'RTS1', results: [{ sku: SKU, passQty: 1, defectQty: 1 }] });
    expect(stock(w).atpQty).toBe(0);
    expect(() => w.returnDefectiveGoods({ requestId: 'bad', receiptId: 'RTS1', sku: SKU, quantity: 1 })).toThrow();
    w.putawayToBin({ requestId: 'put', receiptId: 'RTS1', sku: SKU, binId: B, quantity: 1 });
    expect(stock(w)).toMatchObject({ onHandQty: 1, atpQty: 1, quarantineQty: 1 });
  });
  test.each(['Shopee', 'TikTok Shop', 'Website', 'POS'])('giữ chỗ kênh %s, chặn bán trùng và giải phóng khi hủy', channel => {
    const w = create([initial(2)]);
    w.reserveOrder({ requestId: 'r1', ...order(), channel });
    expect(stock(w).atpQty).toBe(0);
    expect(() => w.reserveOrder({ requestId: 'r2', ...order('O2', 1) })).toThrow(/ATP/);
    w.cancelOrder({ requestId: 'cancel', orderId: 'O1' });
    expect(stock(w).atpQty).toBe(2);
  });
  test('Pick-Short ghi giảm tồn thực tế, cảnh báo và nhặt ô dự phòng', () => {
    const w = create([initial(5), initial(5, B)]);
    w.reserveOrder({ requestId: 'reserve', ...order('O1', 4) });
    const picked = w.pickOrderItems({ requestId: 'pick', ...order('O1', 4),
      binCounts: [{ sku: SKU, binId: A, actualOnHandQty: 0 }] });
    expect(picked.status).toBe('PICKED');
    expect(picked.pickList).toEqual([{ sku: SKU, binId: B, quantity: 4, orderId: 'O1', warehouseId: HCM }]);
    expect(stock(w)).toMatchObject({ onHandQty: 5, reservedQty: 4, atpQty: 1 });
    expect(w.getSnapshot().alerts[0]).toMatchObject({ type: 'PICK_SHORT', shortageQty: 5 });
  });
  test('thiếu toàn kho vẫn lưu chênh lệch và chuyển đơn về chờ', () => {
    const w = create([initial(4)]);
    w.reserveOrder({ requestId: 'reserve', ...order('O1', 4) });
    const result = w.pickOrderItems({ requestId: 'pick', ...order('O1', 4), binCounts: [{ sku: SKU, binId: A, actualOnHandQty: 1 }] });
    expect(result.status).toBe('AWAITING_STOCK');
    expect(stock(w)).toMatchObject({ onHandQty: 1, reservedQty: 0, atpQty: 1 });
    expect(w.getSnapshot().alerts).toHaveLength(1);
    expect(() => w.packOrder(pack())).toThrow();
  });
  test('lệch ô có đơn khác giữ chỗ: giải phóng nguyên đơn, không reserved âm', () => {
    const w = create([initial(8), initial(4, B)]);
    w.reserveOrder({ requestId: 'r1', ...order('O1', 4) });
    w.reserveOrder({ requestId: 'r2', ...order('O2', 4) });
    w.pickOrderItems({ requestId: 'pick', ...order('O1', 4), binCounts: [{ sku: SKU, binId: A, actualOnHandQty: 0 }] });
    expect(w.getSnapshot().orders.find(o => o.orderId === 'O2').status).toBe('AWAITING_STOCK');
    expect(stock(w)).toMatchObject({ onHandQty: 4, reservedQty: 4, atpQty: 0 });
  });
  test('không giảm tồn vượt hàng đã nhặt của đơn khác', () => {
    const w = create([initial()]);
    w.pickOrderItems({ requestId: 'p1', ...order('O1', 4) });
    const before = w.getSnapshot();
    expect(() => w.pickOrderItems({ requestId: 'p2', ...order('O2'), binCounts: [{ sku: SKU, binId: A, actualOnHandQty: 1 }] })).toThrow(/xung đột/);
    expect(w.getSnapshot()).toEqual(before);
  });
  test('wave sắp xếp dãy/kệ/ô, không vượt ATP khi nhiều đơn', () => {
    const w = create([initial(2, B), initial(2, A)]);
    const result = w.pickWave({ requestId: 'wave', orders: [order('O2'), order('O1'), order('O3')] });
    expect(result.orders.map(o => o.status)).toEqual(['PICKED', 'PICKED', 'AWAITING_STOCK']);
    expect(result.pickList.map(r => r.binId)).toEqual([A, B]);
    expect(stock(w)).toMatchObject({ onHandQty: 4, reservedQty: 4, atpQty: 0 });
  });
  test('ATP dự kiến chỉ tính PO đúng hạn khả dụng; không cộng trùng GRN/QC', () => {
    const w = create([initial(5)]);
    w.reserveOrder({ requestId: 'reserve', ...order() });
    w.registerInboundShipment(shipment());
    expect(w.projectedAtp({ warehouseId: HCM, sku: SKU, daysAhead: 2, dailyDemand: 1 }).projectedAtpQty).toBe(1);
    expect(w.projectedAtp({ warehouseId: HCM, sku: SKU, daysAhead: 3, forecastDaily: [1, 2, 3] }))
      .toMatchObject({ atpQty: 3, scheduledReceipts: 10, forecastDemand: 6, projectedAtpQty: 7 });
    w.receiveInboundGoods({ requestId: 'receive', receiptId: 'R1', shipmentId: 'S1', items: [{ sku: SKU, quantity: 4 }] });
    expect(w.projectedAtp({ warehouseId: HCM, sku: SKU, daysAhead: 3, dailyDemand: 1 }).projectedAtpQty).toBe(6);
    expect(w.projectedAtp({ warehouseId: HCM, sku: SKU, daysAhead: 0 }).projectedAtpQty).toBe(3);
    expect(w.projectedAtp({ warehouseId: HCM, sku: SKU, daysAhead: 10, dailyDemand: 10 }).projectedAtpQty).toBe(-91);
    expect(stock(w).atpQty).toBe(3);
  });
  test('snapshot và giá trị trả về không sửa được trạng thái nội bộ', () => {
    const w = create([initial()]);
    w.getSnapshot().inventory[0].onHandQty = -999;
    const result = w.reserveOrder({ requestId: 'r1', ...order() });
    result.allocations[0].quantity = 999;
    expect(stock(w)).toMatchObject({ onHandQty: 10, reservedQty: 2, atpQty: 8 });
  });
});

describe('Đóng gói và kiểm tra đầu vào', () => {
  test.each(['GHN', 'GHTK', 'VTP', 'AHAMOVE_2H'])('sinh nhãn %s và SLA từ thời điểm xuất', carrierId => {
    const w = create([initial()]);
    w.pickOrderItems({ requestId: 'pick', ...order() });
    const result = w.packOrder(pack({ carrierId }));
    expect(result.package.trackingNumber.startsWith(carrierId + '-SIM-')).toBe(true);
    if (carrierId === 'AHAMOVE_2H') {
      expect(w.shipOrderOut({ requestId: 'ship', orderId: 'O1' }).slaDueAt).toBe('2026-11-01T04:00:00.000Z');
    }
  });
  test.each([{ measuredWeightGram: 500 }, { measuredVolumeCm3: 100 }, { measuredWeightGram: 999999 },
    { carrierId: 'AHAMOVE_2H', lane: 'INTERREGIONAL' }])('từ chối kiện/tuyến sai %j và rollback', changes => {
    const w = create([initial()]);
    w.pickOrderItems({ requestId: 'pick', ...order() });
    const before = w.getSnapshot();
    expect(() => w.packOrder(pack(changes))).toThrow();
    expect(w.getSnapshot()).toEqual(before);
  });
  test('chặn các bước sai thứ tự', () => {
    const w = create([initial()]);
    expect(() => w.packOrder(pack())).toThrow();
    w.reserveOrder({ requestId: 'reserve', ...order() });
    expect(() => w.shipOrderOut({ requestId: 'ship', orderId: 'O1' })).toThrow();
    w.pickOrderItems({ requestId: 'pick', ...order() });
    expect(() => w.cancelOrder({ requestId: 'cancel', orderId: 'O1' })).toThrow();
    expect(() => w.pickOrderItems({ requestId: 'pick2', ...order() })).toThrow();
  });
  test.each([-1, 0.5, NaN, Infinity, '2'])('từ chối số lượng sai %s', quantity => {
    expect(() => create([initial(quantity)])).toThrow();
  });
  test.each([{ binId: Q }, { binId: 'HN-A-01-R1-B01' }, { sku: 'MISSING' }, { extra: true }])('từ chối tồn đầu sai %j', changes => {
    expect(() => create([{ ...initial(), ...changes }])).toThrow();
  });
  test('QC sai tổng, SKU/zone sai, dự báo thiếu ngày và số ngày âm bị chặn', () => {
    const w = create();
    w.registerInboundShipment(shipment());
    expect(() => w.receiveInboundGoods({ requestId: 'r', receiptId: 'R', shipmentId: 'S1', items: [{ sku: SKU, quantity: 5, passQty: 5, defectQty: 1 }] })).toThrow();
    expect(() => w.registerInboundShipment(shipment({ requestId: 's2', shipmentId: 'S2', quarantineBinId: A }))).toThrow();
    expect(() => w.projectedAtp({ warehouseId: HCM, sku: SKU, daysAhead: -1 })).toThrow();
    expect(() => w.projectedAtp({ warehouseId: HCM, sku: SKU, daysAhead: 3, forecastDaily: [1] })).toThrow();
  });
  test('clock quay ngược rollback', () => {
    let time = NOW;
    const w = createWmsService({ clock: () => time, initialInventory: [initial()] });
    time = '2026-10-31T02:00:00.000Z';
    expect(() => w.reserveOrder({ requestId: 'r', ...order() })).toThrow(/Clock/);
    expect(stock(w).reservedQty).toBe(0);
  });
});

describe('EOQ/ROP, kế hoạch và scoringAdapter', () => {
  const signals = { signals: [{ warehouseId: HCM, sku: SKU, atpQty: 0, inTransitQty: 5, quarantineQty: 2,
    dailyDemand: 10, leadTimeDays: 10, stockoutPenaltyPerUnit: 50000, unitCost: 100000 }] };
  test('EOQ đồng nhất đơn vị năm, làm tròn bội MOQ; ROP có safety stock', () => {
    expect(calculateEOQ({ annualDemand: 10000, orderingCost: 100000, holdingCostPerUnitPerYear: 2000, moq: 300 }))
      .toEqual({ rawEOQ: 1000, orderQty: 1200, moq: 300, currency: 'VNĐ' });
    expect(calculateROP({ dailyDemand: 10.5, leadTimeDays: 3, safetyStock: 5 })).toBe(37);
    expect(calculateEOQ({ annualDemand: 0, orderingCost: 1, holdingCostPerUnitPerYear: 1 }).orderQty).toBe(0);
    expect(() => calculateEOQ({ annualDemand: 10, orderingCost: 1, holdingCostPerUnitPerYear: 0 })).toThrow();
    expect(() => calculateEOQ({ annualDemand: 10, orderingCost: 1, holdingCostPerUnitPerYear: Number.MIN_VALUE })).toThrow(/an toàn/);
  });
  test('điểm mặc định tăng khi ATP giảm; plugin hàm hoặc module ghi đè', () => {
    const defaults = evaluateSupplyChainSignals(signals);
    expect(defaults[0].priorityScore).toBe(90);
    expect(evaluateSupplyChainSignals({ signals: [{ ...signals.signals[0], atpQty: 200 }] })[0].priorityScore).toBe(10);
    const custom = (snapshot, values) => values.map(row => ({ ...row, priorityScore: 42, reason: 'Chiến lược riêng' }));
    expect(evaluateSupplyChainSignals(signals, custom)[0].priorityScore).toBe(42);
    expect(evaluateSupplyChainSignals(signals, { evaluate: custom })[0].priorityScore).toBe(42);
  });
  test.each([() => [], () => [{ warehouseId: HCM, sku: SKU, priorityScore: NaN, reason: 'x' }],
    () => [{ warehouseId: HCM, sku: 'OTHER', priorityScore: 1, reason: 'x' }],
    () => [{ warehouseId: HCM, sku: SKU, priorityScore: 101, reason: 'x' }],
    () => Promise.resolve([]), {}])('từ chối plugin sai hợp đồng %#', strategy => {
    expect(() => evaluateSupplyChainSignals(signals, strategy)).toThrow();
  });
  test('plugin nhận snapshot đóng băng; không sửa tín hiệu gốc', () => {
    expect(() => evaluateSupplyChainSignals(signals, snapshot => { snapshot.signals[0].atpQty = 99; return []; })).toThrow();
    expect(signals.signals[0].atpQty).toBe(0);
  });
  test('kế hoạch thiếu hàng chọn dự phòng, đúng MOQ/VNĐ; tùy chỉnh thứ tự ưu tiên', () => {
    const w = create();
    const plans = w.planReplenishment({ procurementMode: 'SUBCONTRACT' }, (snapshot, defaults) => defaults.map(r => ({
      ...r, priorityScore: r.warehouseId === HCM && r.sku === SKU ? 100 : 0, reason: 'Ưu tiên SKU thử nghiệm',
    })));
    expect(plans[0]).toMatchObject({ warehouseId: HCM, sku: SKU, supplierRole: 'BACKUP', action: 'SUBCONTRACT', priorityScore: 100 });
    for (const p of plans) {
      expect(p.quantity % p.moq).toBe(0);
      expect(p.totalCost).toBe(p.quantity * p.unitCost);
      expect(p.currency).toBe('VNĐ');
    }
    expect(w.getSnapshot().shipments).toHaveLength(0);
    const stocked = create([initial(10000)]);
    expect(stocked.planReplenishment().find(p => p.warehouseId === HCM && p.sku === SKU))
      .toMatchObject({ quantity: 0, supplierRole: 'PRIMARY', action: 'NONE' });
  });
  test('PO chính trễ: không cộng ATP dự kiến, kế hoạch chọn dự phòng', () => {
    let time = NOW;
    const w = createWmsService({ clock: () => time, initialInventory: [initial()] });
    w.registerInboundShipment(shipment());
    time = '2026-11-05T02:00:00.000Z';
    expect(w.projectedAtp({ warehouseId: HCM, sku: SKU, daysAhead: 5, dailyDemand: 1 }).scheduledReceipts).toBe(0);
    expect(w.planReplenishment().find(p => p.warehouseId === HCM && p.sku === SKU))
      .toMatchObject({ supplierRole: 'BACKUP', reason: 'PRIMARY_DELAY' });
  });
  test('chặn plugin gọi mutation lồng; WMS dùng bình thường sau lỗi', () => {
    const w = create([initial()]);
    expect(() => w.planReplenishment({}, () => {
      w.reserveOrder({ requestId: 'malicious', ...order() });
      return [];
    })).toThrow(/chiến lược/);
    expect(stock(w).reservedQty).toBe(0);
    w.reserveOrder({ requestId: 'legitimate', ...order() });
    expect(stock(w).reservedQty).toBe(2);
  });
});


describe('ATP của hàng đạt QC chờ lên kệ', () => {
  test.each([0, 2, 10])('không bỏ sót hoặc cộng trùng với %i sản phẩm lỗi', defectQty => {
    const w = create();
    w.registerInboundShipment(shipment());
    const projection = daysAhead => w.projectedAtp({ warehouseId: HCM, sku: SKU, daysAhead, dailyDemand: 0 });
    expect(projection(4).projectedAtpQty).toBe(10);
    w.receiveInboundGoods({ requestId: 'r', receiptId: 'R1', shipmentId: 'S1', items: [{ sku: SKU, quantity: 10 }] });
    expect(projection(4).projectedAtpQty).toBe(0);
    w.inspectInboundGoods({ requestId: 'qc', receiptId: 'R1', results: [{ sku: SKU, passQty: 10 - defectQty, defectQty }] });
    expect(stock(w).atpQty).toBe(0);
    expect(projection(2).projectedAtpQty).toBe(0);
    expect(projection(4).projectedAtpQty).toBe(10 - defectQty);
    const plan = w.planReplenishment().find(p => p.warehouseId === HCM && p.sku === SKU);
    expect(plan.inventoryPosition).toBe(10 - defectQty);
    if (defectQty < 10) {
      w.putawayToBin({ requestId: 'put1', receiptId: 'R1', sku: SKU, binId: A, quantity: 3 });
      expect(projection(4).scheduledReceipts).toBe(7 - defectQty);
      expect(projection(4).projectedAtpQty).toBe(10 - defectQty);
      w.putawayToBin({ requestId: 'put2', receiptId: 'R1', sku: SKU, binId: A, quantity: 7 - defectQty });
      expect(projection(4).scheduledReceipts).toBe(0);
      expect(projection(4).projectedAtpQty).toBe(10 - defectQty);
    }
  });
  test('nhận một phần vẫn tính phần đang đi và chỉ phần đã đạt QC', () => {
    const w = create();
    w.registerInboundShipment(shipment());
    w.receiveInboundGoods({ requestId: 'r', receiptId: 'R1', shipmentId: 'S1',
      items: [{ sku: SKU, quantity: 4, passQty: 3, defectQty: 1 }] });
    expect(w.projectedAtp({ warehouseId: HCM, sku: SKU, daysAhead: 4, dailyDemand: 0 }).scheduledReceipts).toBe(9);
  });
});
