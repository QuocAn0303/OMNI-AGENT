'use strict';
const { createOmsLogisticsService, OUTBOUND_STATES, INBOUND_STATES,
  simulateSupplierDelay14Days, simulateDemandSurge50Percent, auditScenario } = require('../oms-logistics.service');
const { createWmsService } = require('../wms.service');
const SKU = 'VN-B-001';
const NOW = '2026-11-01T02:00:00.000Z';
const inventory = (warehouseId, quantity, sku = SKU) => ({ warehouseId, sku,
  binId: (warehouseId === 'WH-HN' ? 'HN' : 'HCM') + '-A-01-R1-B01', quantity });
const create = (initialInventory = [inventory('WH-HN', 20), inventory('WH-HCM', 20)], extra = {}) =>
  createOmsLogisticsService({ initialInventory, clock: () => NOW, ...extra });
const order = (changes = {}) => ({ requestId: 'new', orderId: 'O1', channel: 'Shopee', region: 'MIEN_BAC',
  destinationCity: 'Hà Nội', paymentMethod: 'COD', dispatchDeadlineAt: '2026-11-02T02:00:00Z',
  items: [{ sku: SKU, quantity: 3 }], ...changes });
function dispatch(oms, changes = {}) {
  oms.createOutboundOrder(order(changes));
  const routed = oms.routeOrderToOptimalHub({ requestId: 'route', orderId: 'O1' });
  for (const f of routed.fulfillments) {
    const pWeight = f.items.reduce((n, i) => n + i.quantity * 380, 0);
    oms.pickFulfillment({ requestId: 'pick-' + f.fulfillmentId, fulfillmentId: f.fulfillmentId });
    oms.packFulfillment({ requestId: 'pack-' + f.fulfillmentId, fulfillmentId: f.fulfillmentId,
      carrierId: 'GHN', lane: 'INTERREGIONAL', measuredWeightGram: pWeight + 150,
      measuredVolumeCm3: f.items.reduce((n, i) => n + i.quantity * 1200, 0) });
    oms.shipFulfillment({ requestId: 'ship-' + f.fulfillmentId, fulfillmentId: f.fulfillmentId });
  }
  return routed.fulfillments;
}
function failedThree(oms, id = 'O1-F1') {
  for (let i = 1; i <= 3; i++) oms.recordDeliveryAttempt({ requestId: 'fail-' + id + '-' + i,
    fulfillmentId: id, attemptNumber: i, outcome: 'FAILED' });
  return oms.getSnapshot().returnOrders.find(r => r.fulfillmentId === id);
}

describe('OutboundOrderTracker và định tuyến', () => {
  test('vòng đời đúng thứ tự từ đơn mới đến giao thành công và đối soát COD', () => {
    const oms = create();
    dispatch(oms);
    const f = oms.recordDeliveryAttempt({ requestId: 'delivered', fulfillmentId: 'O1-F1', attemptNumber: 1, outcome: 'DELIVERED' });
    expect(f.status).toBe('DELIVERED');
    expect(f.collectedAmount).toBe(149000 * 3);
    expect(f.codSettlement).toEqual({ amount: 447000, dueAt: '2026-11-04T02:00:00.000Z', status: 'PENDING' });
    expect(oms.getSnapshot().orders[0].history.map(h => h.status)).toEqual(OUTBOUND_STATES.slice(0, 6));
    expect(oms.getInventory({ warehouseId: 'WH-HN', sku: SKU })).toMatchObject({ onHandQty: 17, reservedQty: 0, atpQty: 17 });
  });
  test.each([['MIEN_BAC', 'WH-HN'], ['BAC_TRUNG_BO', 'WH-HN'], ['NAM_TRUNG_BO', 'WH-HCM'], ['MIEN_NAM', 'WH-HCM']])('ưu tiên %s từ %s', (region, hub) => {
    const oms = create();
    oms.createOutboundOrder(order({ region }));
    expect(oms.routeOrderToOptimalHub({ requestId: 'route', orderId: 'O1' }).fulfillments[0].warehouseId).toBe(hub);
  });
  test('chuyển sang hub còn ATP và dự phòng công suất', () => {
    for (const oms of [
      create([inventory('WH-HCM', 10)]),
      create(undefined, { hubCapacity: { 'WH-HN': { unitsPerHour: 1, queuedUnits: 100 } } }),
    ]) {
      oms.createOutboundOrder(order());
      expect(oms.routeOrderToOptimalHub({ requestId: 'route', orderId: 'O1' }).fulfillments[0])
        .toMatchObject({ warehouseId: 'WH-HCM', routingReason: 'ATP_OR_CAPACITY_FALLBACK' });
    }
  });
  test('tách đơn khi mỗi hub chỉ đủ một phần; giữ chỗ không bán trùng', () => {
    const oms = create([inventory('WH-HN', 2), inventory('WH-HCM', 2)]);
    oms.createOutboundOrder(order());
    const result = oms.routeOrderToOptimalHub({ requestId: 'route', orderId: 'O1' });
    expect(result.fulfillments.map(f => [f.warehouseId, f.items[0].quantity])).toEqual([['WH-HN', 2], ['WH-HCM', 1]]);
    oms.createOutboundOrder(order({ requestId: 'new2', orderId: 'O2', items: [{ sku: SKU, quantity: 2 }] }));
    const before = oms.getSnapshot();
    expect(() => oms.routeOrderToOptimalHub({ requestId: 'route2', orderId: 'O2' })).toThrow(/ATP/);
    expect(oms.getSnapshot()).toEqual(before);
  });
  test('đơn tách chỉ hoàn tất khi tất cả kiện kết thúc', () => {
    const oms = create([inventory('WH-HN', 2), inventory('WH-HCM', 2)]);
    const fs = dispatch(oms);
    oms.recordDeliveryAttempt({ requestId: 'ok1', fulfillmentId: fs[0].fulfillmentId, attemptNumber: 1, outcome: 'DELIVERED' });
    expect(oms.getSnapshot().orders[0].status).toBe('IN_TRANSIT_3PL');
    oms.recordDeliveryAttempt({ requestId: 'ok2', fulfillmentId: fs[1].fulfillmentId, attemptNumber: 1, outcome: 'DELIVERED' });
    expect(oms.getSnapshot().orders[0].status).toBe('DELIVERED');
  });
  test('chặn bước sai, giao trùng, callback lệch số lần; replay không đổi tồn/log', () => {
    const oms = create();
    oms.createOutboundOrder(order());
    const before = oms.getSnapshot();
    expect(() => oms.shipFulfillment({ requestId: 'ship', fulfillmentId: 'O1-F1' })).toThrow();
    expect(oms.getSnapshot()).toEqual(before);
    const route = { requestId: 'route', orderId: 'O1' };
    const routed = oms.routeOrderToOptimalHub(route);
    const after = oms.getSnapshot();
    expect(oms.routeOrderToOptimalHub(route)).toEqual(routed);
    expect(oms.getSnapshot()).toEqual(after);
    expect(() => oms.createOutboundOrder(order({ orderId: 'O2' }))).toThrow(/requestId/);
    expect(() => oms.recordDeliveryAttempt({ requestId: 'bad', fulfillmentId: 'O1-F1', attemptNumber: 2, outcome: 'FAILED' })).toThrow();
  });
  test('dispatchSlaMet dựa vào giờ bàn giao thực tế', () => {
    let time = NOW;
    const oms = create(undefined, { clock: () => time });
    oms.createOutboundOrder(order());
    oms.routeOrderToOptimalHub({ requestId: 'r', orderId: 'O1' });
    oms.pickFulfillment({ requestId: 'p', fulfillmentId: 'O1-F1' });
    oms.packFulfillment({ requestId: 'pack', fulfillmentId: 'O1-F1', carrierId: 'GHN', lane: 'INTRACITY',
      measuredWeightGram: 1290, measuredVolumeCm3: 3600 });
    time = '2026-11-03T02:00:00Z';
    expect(oms.shipFulfillment({ requestId: 'ship', fulfillmentId: 'O1-F1' }).dispatchSlaMet).toBe(false);
  });
});

describe('Reverse Logistics COD', () => {
  test.each(['GHN', 'GHTK'])('%s tạo RTS đúng sau 3 lần giao, COD thất bại không có tiền thu', carrierId => {
    const oms = create();
    oms.createOutboundOrder(order());
    oms.routeOrderToOptimalHub({ requestId: 'r', orderId: 'O1' });
    oms.pickFulfillment({ requestId: 'p', fulfillmentId: 'O1-F1' });
    const packed = oms.packFulfillment({ requestId: 'pack', fulfillmentId: 'O1-F1', carrierId, lane: 'INTRACITY',
      measuredWeightGram: 1290, measuredVolumeCm3: 3600 });
    oms.shipFulfillment({ requestId: 's', fulfillmentId: 'O1-F1' });
    for (let n = 1; n <= 2; n++) {
      oms.recordDeliveryAttempt({ requestId: 'f' + n, fulfillmentId: 'O1-F1', attemptNumber: n, outcome: 'FAILED' });
      expect(oms.getSnapshot().returnOrders).toHaveLength(0);
    }
    oms.recordDeliveryAttempt({ requestId: 'f3', fulfillmentId: 'O1-F1', attemptNumber: 3, outcome: 'FAILED' });
    const ret = oms.getSnapshot().returnOrders[0];
    expect(ret).toMatchObject({ originalTrackingNumber: packed.package.trackingNumber, refundLiability: 0,
      returnFreightCost: Math.ceil(packed.package.quote.amount * 0.5) });
    expect(oms.getSnapshot().orders[0].status).toBe('DELIVERY_FAILED_RTS');
    expect(oms.getSnapshot().fulfillments[0].collectedAmount).toBe(0);
  });
  test('phân loại A/B/C: A/B vào ATP, C giữ R; phí repack và hao hụt đúng VNĐ', () => {
    const oms = create();
    dispatch(oms);
    const ret = failedThree(oms);
    const input = { requestId: 'returned', returnId: ret.returnId, grades: [{ sku: SKU, aQty: 1, bQty: 1, cQty: 1 }], repackCostPerUnit: 5000 };
    const result = oms.processReturnedPackage(input);
    expect(result).toMatchObject({ status: 'QC_COMPLETED', repackCost: 5000, writeOffCost: 85000,
      totalReverseCost: ret.returnFreightCost + 90000 });
    expect(oms.getInventory({ warehouseId: 'WH-HN', sku: SKU })).toMatchObject({ onHandQty: 19, atpQty: 19, quarantineQty: 1 });
    expect(oms.getInventory({ warehouseId: 'WH-HN', sku: SKU, binId: 'HN-R-01-R1-B01' }).quarantineQty).toBe(1);
    const snapshot = oms.getSnapshot();
    expect(snapshot.orders[0].status).toBe('RETURNED_TO_WAREHOUSE');
    expect(oms.processReturnedPackage(input)).toEqual(result);
    expect(oms.getSnapshot()).toEqual(snapshot);
    expect(() => oms.processReturnedPackage({ ...input, requestId: 'duplicate' })).toThrow();
    const movements = snapshot.wms.inventoryMovementLog.filter(m => m.command === 'RECEIVE_RETURN');
    expect(movements[0].binId).toBe('HN-R-01-R1-B01');
    expect(movements[0].after.quarantineQty).toBe(3);
  });
  test.each(['COD', 'Prepaid'])('khách yêu cầu trả đơn đã giao %s ghi nghĩa vụ hoàn tiền, không thu hai lần', paymentMethod => {
    const oms = create();
    dispatch(oms, { paymentMethod });
    oms.recordDeliveryAttempt({ requestId: 'ok', fulfillmentId: 'O1-F1', attemptNumber: 1, outcome: 'DELIVERED' });
    const ret = oms.requestCustomerReturn({ requestId: 'return', fulfillmentId: 'O1-F1', reason: 'Khách đổi ý' });
    expect(ret.refundLiability).toBe(447000);
    oms.processReturnedPackage({ requestId: 'qc', returnId: ret.returnId, grades: [{ sku: SKU, aQty: 3, bQty: 0, cQty: 0 }] });
    expect(oms.getInventory({ warehouseId: 'WH-HN', sku: SKU }).onHandQty).toBe(20);
    expect(oms.getSnapshot().fulfillments[0].collectedAmount).toBe(447000);
    expect(oms.getSnapshot().fulfillments[0].refundLiability).toBe(447000);
  });
  test('QC sai tổng không đổi OMS hoặc WMS', () => {
    const oms = create();
    dispatch(oms);
    const ret = failedThree(oms), before = oms.getSnapshot();
    expect(() => oms.processReturnedPackage({ requestId: 'qc', returnId: ret.returnId,
      grades: [{ sku: SKU, aQty: 4, bQty: 0, cQty: 0 }] })).toThrow();
    expect(oms.getSnapshot()).toEqual(before);
  });
});

describe('InboundPoTracker', () => {
  test('6 mốc PO liên tục; trễ 14 ngày, GRN/QC/putaway đúng tồn', () => {
    let time = NOW;
    const oms = create([], { clock: () => time });
    oms.createInboundPo({ requestId: 'new-po', poId: 'PO1', supplierId: 'SUP-B-PRIMARY', warehouseId: 'WH-HCM',
      promisedAt: '2026-11-03T02:00:00Z', items: [{ sku: SKU, quantity: 200 }] });
    const advance = (status, qcResults) => oms.advanceInboundPo({ requestId: status, poId: 'PO1', status, ...(qcResults ? { qcResults } : {}) });
    expect(() => advance('ARRIVED_AT_DOCK')).toThrow();
    advance('SUPPLIER_PRODUCTION');
    advance('IN_TRANSIT_INBOUND');
    expect(oms.getInventory({ warehouseId: 'WH-HCM', sku: SKU }).inTransitQty).toBe(200);
    time = '2026-11-17T02:00:00Z';
    expect(oms.getInboundPo('PO1')).toMatchObject({ delayDays: 14, delayAlert: true });
    advance('ARRIVED_AT_DOCK');
    expect(oms.getInventory({ warehouseId: 'WH-HCM', sku: SKU })).toMatchObject({ quarantineQty: 200, inTransitQty: 0 });
    advance('QC_COMPLETED', [{ sku: SKU, passQty: 198, defectQty: 2 }]);
    advance('PUTAWAY_DONE');
    time = '2026-11-20T02:00:00Z';
    const po = oms.getInboundPo('PO1');
    expect(po.history.map(h => h.status)).toEqual(INBOUND_STATES);
    expect(po.delayDays).toBe(14);
    expect(oms.getInventory({ warehouseId: 'WH-HCM', sku: SKU })).toMatchObject({ onHandQty: 198, atpQty: 198, quarantineQty: 2 });
  });
  test('giao dịch WMS nhiều lệnh rollback cả state/log/idempotency', () => {
    const wms = createWmsService({ clock: () => NOW, initialInventory: [inventory('WH-HCM', 3)] });
    const before = wms.getSnapshot();
    const reserve = { requestId: 'r1', orderId: 'O1', warehouseId: 'WH-HCM', channel: 'Shopee', items: [{ sku: SKU, quantity: 2 }] };
    expect(() => wms.transaction(() => {
      wms.reserveOrder(reserve);
      wms.reserveOrder({ ...reserve, requestId: 'r2', orderId: 'O2' });
    })).toThrow();
    expect(wms.getSnapshot()).toEqual(before);
    expect(wms.reserveOrder(reserve).status).toBe('RESERVED');
    expect(() => wms.transaction(async () => {})).toThrow();
  });
});

describe('Hai kịch bản khẩn cấp và cân bằng độc lập', () => {
  const delay = simulateSupplierDelay14Days();
  const surge = simulateDemandSurge50Percent();
  test('A: chạm đáy ngày 3, điều chuyển giữ donor an toàn, backup lead 4 ngày', () => {
    expect(delay.stockoutDay).toBe(3);
    expect(delay.responsePlan.delayedPo.arrivalDay).toBe(17);
    expect(delay.responsePlan.delayedPo.orderDay + delay.responsePlan.delayedPo.leadTimeDays + 14).toBe(17);
    expect(delay.responsePlan.emergencyPo.leadTimeDays).toBe(4);
    expect(delay.responsePlan.lateralTransfers[0].quantity).toBeGreaterThan(0);
    expect(delay.before.metrics.stockoutUnits).toBe(560);
    expect(delay.after.metrics.stockoutUnits).toBe(0);
    expect(delay.after.ledger.filter(r => r.warehouseId === 'WH-HN').every(r => r.stockoutUnits === 0)).toBe(true);
  });
  test('B: +50% trong 14 ngày, safety stock tăng, phối hợp NCC và overtime giữ SLA >=95%', () => {
    expect(surge.assumptions.surgeDays).toBe(14);
    expect(surge.after.ledger.find(r => r.day === 1 && r.warehouseId === 'WH-HCM').demand).toBe(90);
    expect(surge.after.ledger.find(r => r.day === 15 && r.warehouseId === 'WH-HCM').demand).toBe(60);
    expect(surge.responsePlan.safetyStock['WH-HCM'].after).toBeGreaterThan(surge.responsePlan.safetyStock['WH-HCM'].before);
    expect(new Set(surge.responsePlan.purchaseOrders.map(p => p.supplierRole))).toEqual(new Set(['PRIMARY', 'BACKUP']));
    expect(surge.peakSlaRate).toBeGreaterThanOrEqual(0.95);
    expect(surge.after.metrics.stockoutUnits).toBe(0);
    expect(surge.before.metrics.stockoutUnits).toBeGreaterThan(0);
    expect(surge.responsePlan.pushPull.after.pull).toBeGreaterThan(surge.responsePlan.pushPull.before.pull);
    for (const row of surge.after.ledger) {
      expect(row.channelAllocation.reduce((n, c) => n + c.pushQty + c.pullQty, 0)).toBe(row.sold);
    }
  });
  test.each([['A', delay], ['B', surge]])('%s: đối chiếu từng ngày với GRN, phiếu điều chuyển và hàng trên xe', (label, result) => {
    for (const run of [result.before, result.after]) {
      const previous = { ...run.opening };
      let receipts = 0, sales = 0;
      for (let day = 1; day <= run.days; day++) {
        for (const row of run.ledger.filter(r => r.day === day)) {
          const grn = run.goodsReceipts.filter(g => g.day === day && g.warehouseId === row.warehouseId).reduce((n, g) => n + g.quantity, 0);
          const outgoing = run.transfers.filter(t => t.departureDay === day && t.sourceWarehouseId === row.warehouseId).reduce((n, t) => n + t.quantity, 0);
          const incoming = run.transfers.filter(t => t.arrivalDay === day && t.destinationWarehouseId === row.warehouseId).reduce((n, t) => n + t.quantity, 0);
          expect(row.opening).toBe(previous[row.warehouseId]);
          expect(row.closing).toBe(row.opening + grn + incoming - outgoing - row.sold);
          expect(row.closing).toBeGreaterThanOrEqual(0);
          previous[row.warehouseId] = row.closing;
          receipts += grn;
          sales += row.sold;
        }
        const transit = run.transfers.filter(t => t.departureDay <= day && t.arrivalDay > day).reduce((n, t) => n + t.quantity, 0);
        expect(Object.values(run.opening).reduce((a, b) => a + b, 0) + receipts - sales)
          .toBe(Object.values(previous).reduce((a, b) => a + b, 0) + transit);
      }
      expect(run.audit).toEqual({ balanced: true, checkedRows: 56, difference: 0 });
      for (const po of run.purchaseOrders) {
        expect(po.quantity % po.moq).toBe(0);
        expect(po.totalCost).toBe(po.quantity * po.unitCost);
      }
    }
  });
  test('không hứa SLA hoặc không đứt hàng khi nguồn lực không đủ', () => {
    const limited = simulateDemandSurge50Percent({ maxOvertimeMultiplier: 1 });
    expect(limited.feasible).toBe(false);
    expect(limited.peakSlaRate).toBeLessThan(0.95);
    const empty = simulateSupplierDelay14Days({ opening: { 'WH-HCM': 0, 'WH-HN': 0 } });
    expect(empty.feasible).toBe(false);
    expect(empty.unresolvedShortage).toBeGreaterThan(0);
    expect(empty.after.audit.difference).toBe(0);
  });
  test.each(['VN-A-001', 'VN-A-002', 'VN-B-001', 'VN-B-002', 'VN-S-001'])('kịch bản tái lập và cân bằng SKU %s', sku => {
    expect(simulateSupplierDelay14Days({ sku }).after.audit.balanced).toBe(true);
    expect(simulateDemandSurge50Percent({ sku }).after.audit.balanced).toBe(true);
  });
  test('audit bắt chứng từ hoặc số dư bị sửa', () => {
    const modified = structuredClone(delay.after);
    modified.ledger[0].closing++;
    expect(() => auditScenario(modified)).toThrow();
    const phantom = structuredClone(delay.after);
    phantom.goodsReceipts[0].quantity++;
    expect(() => auditScenario(phantom)).toThrow();
    const fakeMetric = structuredClone(delay.before);
    fakeMetric.metrics.dispatchSlaRate = 1;
    expect(() => auditScenario(fakeMetric)).toThrow();
  });
});

describe('Validation và snapshot', () => {
  test.each([{ region: 'OTHER' }, { items: [{ sku: SKU, quantity: -1 }] }, { items: [{ sku: 'BAD', quantity: 1 }] },
    { dispatchDeadlineAt: '2026-02-30' }, { paymentMethod: 'OTHER' }, { extra: true }])('đơn sai bị từ chối %j', changes => {
    expect(() => create().createOutboundOrder(order(changes))).toThrow();
  });
  test.each([{ maxOvertimeMultiplier: 0 }, { opening: { 'WH-HCM': -1, 'WH-HN': 3 } }, { sku: 'BAD' },
    { channelDemandShares: { Shopee: 0.5, 'TikTok Shop': 0.5, Website: 0.5, POS: 0.5 } }])('kịch bản sai %j', args => {
    expect(() => simulateDemandSurge50Percent(args)).toThrow();
  });
  test('snapshot không làm rò trạng thái', () => {
    const oms = create();
    oms.createOutboundOrder(order());
    oms.getSnapshot().orders[0].status = 'DELIVERED';
    expect(oms.getSnapshot().orders[0].status).toBe('NEW_ORDER');
  });
});
