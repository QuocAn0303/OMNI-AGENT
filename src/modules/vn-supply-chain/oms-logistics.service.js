'use strict';
const { z } = require('zod');
const { createCatalog } = require('./data/catalog');
const { createWmsService } = require('./wms.service');
const v = require('./services/oms.validation');
const emergency = require('./services/emergency-simulation.service');

const OUTBOUND_STATES = Object.freeze(['NEW_ORDER', 'ROUTED_TO_WAREHOUSE', 'PICKING', 'PACKED',
  'IN_TRANSIT_3PL', 'DELIVERED', 'DELIVERY_FAILED_RTS', 'RETURNED_TO_WAREHOUSE']);
const INBOUND_STATES = Object.freeze(['PO_CREATED', 'SUPPLIER_PRODUCTION', 'IN_TRANSIT_INBOUND',
  'ARRIVED_AT_DOCK', 'QC_COMPLETED', 'PUTAWAY_DONE']);
const DAY = 86400000;
const copy = value => structuredClone(value);
const sumQty = items => items.reduce((n, i) => n + i.quantity, 0);
const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(k => [k, item[k]])) : item);
function ensure(condition, message) { if (!condition) throw new Error(message); }

/** Isolated OMS/TMS owns its WMS. No writes to ERP or real carrier APIs. */
function createOmsLogisticsService(options = {}) {
  const config = v.config.parse(options);
  const catalog = createCatalog();
  const clock = config.clock || (() => new Date());
  const now = () => {
    const date = new Date(clock());
    ensure(Number.isFinite(date.getTime()), 'Clock không hợp lệ');
    return date.toISOString();
  };
  let operationAt = now();
  const wms = createWmsService({ initialInventory: config.initialInventory, clock: () => operationAt });
  let state = { orders: [], fulfillments: [], purchaseOrders: [], returnOrders: [], events: [],
    capacity: copy(config.hubCapacity), lastEventAt: operationAt };
  const replay = new Map();
  const product = sku => {
    const found = catalog.products.find(p => p.sku === sku);
    ensure(found, 'SKU không tồn tại');
    return found;
  };
  const binId = (warehouseId, zone) => (warehouseId === 'WH-HN' ? 'HN' : 'HCM') + '-' + zone + '-01-R1-B01';
  function run(type, args, action) {
    const signature = canonical({ type, args });
    if (replay.has(args.requestId)) {
      const previous = replay.get(args.requestId);
      ensure(previous.signature === signature, 'requestId đã dùng cho nội dung khác');
      return copy(previous.result);
    }
    operationAt = now();
    ensure(operationAt >= state.lastEventAt, 'Clock không được quay ngược');
    const draft = copy(state);
    let step = 0;
    const wm = (method, input) => wms[method]({ ...input, requestId: 'OMS-' + (state.events.length + 1) + '-' + (++step) });
    const result = wms.transaction(() => action(draft, wm, operationAt));
    draft.events.push({ type, requestId: args.requestId, at: operationAt, input: copy(args) });
    draft.lastEventAt = operationAt;
    state = draft;
    replay.set(args.requestId, { signature, result: copy(result) });
    return copy(result);
  }
  function findOrder(draft, orderId) {
    const order = draft.orders.find(o => o.orderId === orderId);
    ensure(order, 'Không tìm thấy đơn bán');
    return order;
  }
  function findFulfillment(draft, id) {
    const found = draft.fulfillments.find(f => f.fulfillmentId === id);
    ensure(found, 'Không tìm thấy kiện hàng');
    return found;
  }
  function change(row, status, at) {
    row.status = status;
    row.history.push({ status, at });
  }
  function syncParent(draft, orderId, at) {
    const order = findOrder(draft, orderId);
    const parts = draft.fulfillments.filter(f => f.orderId === orderId);
    let status;
    if (parts.every(f => ['DELIVERED', 'RETURNED_TO_WAREHOUSE'].includes(f.status))) {
      status = parts.some(f => f.status === 'RETURNED_TO_WAREHOUSE') ? 'RETURNED_TO_WAREHOUSE' : 'DELIVERED';
    } else if (parts.some(f => f.status === 'DELIVERY_FAILED_RTS')) status = 'DELIVERY_FAILED_RTS';
    else status = ['ROUTED_TO_WAREHOUSE', 'PICKING', 'PACKED', 'IN_TRANSIT_3PL']
      .find(s => parts.some(f => f.status === s));
    if (status && status !== order.status) change(order, status, at);
  }
  function createOutboundOrder(input) {
    const args = v.order.parse(input);
    return run('NEW_ORDER', args, (draft, wm, at) => {
      ensure(!draft.orders.some(o => o.orderId === args.orderId), 'orderId đã tồn tại');
      ensure(Date.parse(args.dispatchDeadlineAt) > Date.parse(at), 'Hạn bàn giao phải nằm trong tương lai');
      args.items.forEach(i => product(i.sku));
      const row = { ...args, status: 'NEW_ORDER', createdAt: at, history: [{ status: 'NEW_ORDER', at }],
        grossAmount: args.items.reduce((n, i) => n + product(i.sku).sellingPrice * i.quantity, 0), currency: 'VNĐ' };
      draft.orders.push(row);
      return row;
    });
  }
  function routeOrderToOptimalHub(input) {
    const args = v.orderCmd.parse(input);
    return run('ROUTE', args, (draft, wm, at) => {
      const order = findOrder(draft, args.orderId);
      ensure(order.status === 'NEW_ORDER', 'Chỉ định tuyến đơn mới');
      const preferred = ['MIEN_BAC', 'BAC_TRUNG_BO'].includes(order.region) ? 'WH-HN' : 'WH-HCM';
      const hubs = [preferred, preferred === 'WH-HN' ? 'WH-HCM' : 'WH-HN'];
      const hours = Math.max(0, (Date.parse(order.dispatchDeadlineAt) - Date.parse(at)) / 3600000);
      const capacity = Object.fromEntries(hubs.map(h => [h, Math.max(0,
        Math.floor(draft.capacity[h].unitsPerHour * hours) - draft.capacity[h].queuedUnits)]));
      const atp = (hub, sku) => wms.getInventory({ warehouseId: hub, sku }).atpQty;
      const full = hubs.find(h => capacity[h] >= sumQty(order.items) && order.items.every(i => atp(h, i.sku) >= i.quantity));
      const allocations = [];
      if (full) allocations.push({ warehouseId: full, items: copy(order.items) });
      else {
        for (const item of order.items) {
          let remaining = item.quantity;
          for (const h of hubs) {
            const quantity = Math.min(remaining, atp(h, item.sku), capacity[h]);
            if (quantity > 0) {
              let allocation = allocations.find(a => a.warehouseId === h);
              if (!allocation) { allocation = { warehouseId: h, items: [] }; allocations.push(allocation); }
              allocation.items.push({ sku: item.sku, quantity });
              remaining -= quantity;
              capacity[h] -= quantity;
            }
          }
          ensure(remaining === 0, 'Không đủ ATP hoặc năng lực kho trước hạn SLA');
        }
      }
      const result = allocations.map((allocation, index) => {
        const fulfillmentId = order.orderId + '-F' + (index + 1);
        wm('reserveOrder', { orderId: fulfillmentId, warehouseId: allocation.warehouseId, channel: order.channel, items: allocation.items });
        draft.capacity[allocation.warehouseId].queuedUnits += sumQty(allocation.items);
        const row = { ...allocation, fulfillmentId, orderId: order.orderId, status: 'ROUTED_TO_WAREHOUSE',
          preferredWarehouseId: preferred, routingReason: allocation.warehouseId === preferred ? 'NEAREST_FEASIBLE' : 'ATP_OR_CAPACITY_FALLBACK',
          attempts: [], history: [{ status: 'ROUTED_TO_WAREHOUSE', at }], currency: 'VNĐ',
          collectedAmount: order.paymentMethod === 'Prepaid' ? allocation.items.reduce((n, i) => n + product(i.sku).sellingPrice * i.quantity, 0) : 0,
          refundLiability: 0 };
        draft.fulfillments.push(row);
        return row;
      });
      change(order, 'ROUTED_TO_WAREHOUSE', at);
      return { order, fulfillments: result };
    });
  }
  function pickFulfillment(input) {
    const args = v.fulfillmentCmd.parse(input);
    return run('PICKING', args, (draft, wm, at) => {
      const f = findFulfillment(draft, args.fulfillmentId);
      ensure(f.status === 'ROUTED_TO_WAREHOUSE', 'Kiện chưa được định tuyến hoặc đã nhặt');
      const order = findOrder(draft, f.orderId);
      const result = wm('pickOrderItems', { orderId: f.fulfillmentId, warehouseId: f.warehouseId, channel: order.channel, items: f.items });
      ensure(result.status === 'PICKED', 'Không nhặt đủ hàng');
      f.pickList = result.pickList;
      change(f, 'PICKING', at);
      syncParent(draft, f.orderId, at);
      return f;
    });
  }
  function packFulfillment(input) {
    const args = v.pack.parse(input);
    return run('PACKED', args, (draft, wm, at) => {
      const f = findFulfillment(draft, args.fulfillmentId);
      ensure(f.status === 'PICKING', 'Chỉ đóng gói kiện đang nhặt');
      const order = findOrder(draft, f.orderId);
      const { requestId, fulfillmentId, ...packing } = args;
      const result = wm('packOrder', { ...packing, orderId: fulfillmentId, destinationCity: order.destinationCity });
      f.package = result.package;
      change(f, 'PACKED', at);
      syncParent(draft, f.orderId, at);
      return f;
    });
  }
  function shipFulfillment(input) {
    const args = v.fulfillmentCmd.parse(input);
    return run('IN_TRANSIT_3PL', args, (draft, wm, at) => {
      const f = findFulfillment(draft, args.fulfillmentId);
      ensure(f.status === 'PACKED', 'Chỉ bàn giao kiện đã đóng gói');
      const result = wm('shipOrderOut', { orderId: f.fulfillmentId });
      f.shippedAt = result.shippedAt;
      f.slaDueAt = result.slaDueAt;
      f.dispatchSlaMet = Date.parse(at) <= Date.parse(findOrder(draft, f.orderId).dispatchDeadlineAt);
      draft.capacity[f.warehouseId].queuedUnits -= sumQty(f.items);
      change(f, 'IN_TRANSIT_3PL', at);
      syncParent(draft, f.orderId, at);
      return f;
    });
  }
  function makeReturn(draft, f, reason, at) {
    ensure(!draft.returnOrders.some(r => r.fulfillmentId === f.fulfillmentId), 'Kiện đã có phiếu hoàn');
    const rate = { GHN: 0.5, GHTK: 0.5, VTP: 1, AHAMOVE_2H: 1 }[f.package.carrierId];
    const row = { returnId: 'RTS-' + f.fulfillmentId, fulfillmentId: f.fulfillmentId, orderId: f.orderId,
      warehouseId: f.warehouseId, originalTrackingNumber: f.package.trackingNumber, carrierId: f.package.carrierId,
      items: copy(f.items), reason, status: 'RETURN_IN_TRANSIT', createdAt: at,
      returnFreightCost: Math.ceil(f.package.quote.amount * rate), repackCost: 0, writeOffCost: 0,
      refundLiability: f.collectedAmount, currency: 'VNĐ', isSimulatedTariff: true };
    f.refundLiability = f.collectedAmount;
    draft.returnOrders.push(row);
    return row;
  }
  function recordDeliveryAttempt(input) {
    const args = v.attempt.parse(input);
    return run('DELIVERY_ATTEMPT', args, (draft, wm, at) => {
      const f = findFulfillment(draft, args.fulfillmentId);
      ensure(f.status === 'IN_TRANSIT_3PL', 'Kiện không còn đang giao');
      ensure(args.attemptNumber === f.attempts.length + 1, 'Số lần giao không liên tục hoặc bị trùng');
      f.attempts.push({ attemptNumber: args.attemptNumber, outcome: args.outcome, at });
      if (args.outcome === 'DELIVERED') {
        const order = findOrder(draft, f.orderId);
        if (order.paymentMethod === 'COD') {
          f.collectedAmount = f.items.reduce((n, i) => n + product(i.sku).sellingPrice * i.quantity, 0);
          const carrier = catalog.carriers.find(c => c.id === f.package.carrierId);
          f.codSettlement = { amount: f.collectedAmount, dueAt: new Date(Date.parse(at) + carrier.codSettlementDays * DAY).toISOString(), status: 'PENDING' };
        }
        f.deliveredAt = at;
        f.deliverySlaMet = Date.parse(at) <= Date.parse(f.slaDueAt);
        change(f, 'DELIVERED', at);
      } else if (args.attemptNumber === 3) {
        change(f, 'DELIVERY_FAILED_RTS', at);
        makeReturn(draft, f, 'FAILED_AFTER_3_ATTEMPTS', at);
      }
      syncParent(draft, f.orderId, at);
      return f;
    });
  }
  function requestCustomerReturn(input) {
    const args = v.customerReturn.parse(input);
    return run('CUSTOMER_RETURN', args, (draft, wm, at) => {
      const f = findFulfillment(draft, args.fulfillmentId);
      ensure(f.status === 'DELIVERED', 'Đổi trả phải từ kiện đã giao');
      return makeReturn(draft, f, args.reason, at);
    });
  }
  function processReturnedPackage(input) {
    const args = v.processReturn.parse(input);
    return run('RETURN_QC', args, (draft, wm, at) => {
      const ret = draft.returnOrders.find(r => r.returnId === args.returnId);
      ensure(ret && ret.status === 'RETURN_IN_TRANSIT', 'Phiếu hoàn không tồn tại hoặc đã xử lý');
      ensure(args.grades.length === ret.items.length && args.grades.every(g => {
        const item = ret.items.find(i => i.sku === g.sku);
        return item && g.aQty + g.bQty + g.cQty === item.quantity;
      }), 'Phân loại A/B/C phải khớp toàn bộ hàng hoàn');
      const receiptId = 'RET-' + ret.fulfillmentId;
      const rBin = binId(ret.warehouseId, 'R');
      wm('receiveReturnedGoods', { receiptId, orderId: ret.fulfillmentId, receivingBinId: rBin, quarantineBinId: rBin, items: ret.items });
      wm('inspectInboundGoods', { receiptId, results: args.grades.map(g => ({ sku: g.sku, passQty: g.aQty + g.bQty, defectQty: g.cQty })) });
      for (const grade of args.grades) {
        const p = product(grade.sku);
        if (grade.aQty + grade.bQty) wm('putawayToBin', { receiptId, sku: grade.sku,
          binId: binId(ret.warehouseId, p.group === 'A' ? 'A' : 'B'), quantity: grade.aQty + grade.bQty });
        ret.repackCost += grade.bQty * args.repackCostPerUnit;
        ret.writeOffCost += grade.cQty * p.unitCost;
      }
      ret.grades = args.grades;
      ret.status = 'QC_COMPLETED';
      ret.receivedAt = at;
      ret.quarantineBinId = rBin;
      ret.cDisposition = 'HOLD_FOR_LIQUIDATION_OR_DESTRUCTION';
      ret.totalReverseCost = ret.returnFreightCost + ret.repackCost + ret.writeOffCost;
      change(findFulfillment(draft, ret.fulfillmentId), 'RETURNED_TO_WAREHOUSE', at);
      syncParent(draft, ret.orderId, at);
      return ret;
    });
  }
  function createInboundPo(input) {
    const args = v.po.parse(input);
    return run('PO_CREATED', args, (draft, wm, at) => {
      ensure(!draft.purchaseOrders.some(p => p.poId === args.poId), 'PO đã tồn tại');
      ensure(Date.parse(args.promisedAt) >= Date.parse(at), 'Ngày hẹn PO ở quá khứ');
      const supplier = catalog.suppliers.find(s => s.id === args.supplierId);
      ensure(supplier && args.items.every(i => supplier.offers.some(o => o.sku === i.sku)), 'NCC không cung cấp SKU');
      const po = { ...args, status: 'PO_CREATED', history: [{ status: 'PO_CREATED', at }], delayDays: 0,
        currency: 'VNĐ', totalCost: args.items.reduce((n, i) => n + i.quantity * supplier.offers.find(o => o.sku === i.sku).unitCost, 0) };
      draft.purchaseOrders.push(po);
      return po;
    });
  }
  function advanceInboundPo(input) {
    const args = v.advancePo.parse(input);
    return run('PO_PROGRESS', args, (draft, wm, at) => {
      const po = draft.purchaseOrders.find(p => p.poId === args.poId);
      ensure(po && INBOUND_STATES.indexOf(args.status) === INBOUND_STATES.indexOf(po.status) + 1, 'Mốc PO không liên tục');
      ensure(args.status === 'QC_COMPLETED' || args.qcResults === undefined, 'Chỉ truyền QC tại mốc QC_COMPLETED');
      if (args.status === 'IN_TRANSIT_INBOUND') {
        const eta = new Date(Math.max(Date.parse(po.promisedAt), Date.parse(at))).toISOString();
        wm('registerInboundShipment', { shipmentId: 'PO-' + po.poId, sourceId: po.poId, sourceType: 'PO',
          supplierId: po.supplierId, warehouseId: po.warehouseId, quarantineBinId: binId(po.warehouseId, 'Q'),
          items: po.items, expectedArrivalAt: eta, expectedAvailableAt: new Date(Date.parse(eta) + DAY).toISOString() });
      } else if (args.status === 'ARRIVED_AT_DOCK') {
        wm('receiveInboundGoods', { shipmentId: 'PO-' + po.poId, receiptId: 'GRN-' + po.poId, items: po.items });
        po.arrivedAt = at;
      } else if (args.status === 'QC_COMPLETED') {
        ensure(args.qcResults && args.qcResults.length === po.items.length
          && new Set(args.qcResults.map(r => r.sku)).size === po.items.length
          && args.qcResults.every(r => po.items.some(i => i.sku === r.sku && i.quantity === r.passQty + r.defectQty)), 'QC không khớp PO');
        wm('inspectInboundGoods', { receiptId: 'GRN-' + po.poId, results: args.qcResults });
        po.qcResults = args.qcResults;
      } else if (args.status === 'PUTAWAY_DONE') {
        for (const result of po.qcResults) if (result.passQty) wm('putawayToBin', {
          receiptId: 'GRN-' + po.poId, sku: result.sku, quantity: result.passQty,
          binId: binId(po.warehouseId, product(result.sku).group === 'A' ? 'A' : 'B') });
      }
      po.delayDays = Math.max(0, Math.ceil((Date.parse(po.arrivedAt || at) - Date.parse(po.promisedAt)) / DAY));
      po.delayAlert = po.delayDays > 0;
      change(po, args.status, at);
      return po;
    });
  }
  function getInboundPo(poId) {
    z.string().min(1).parse(poId);
    const po = state.purchaseOrders.find(p => p.poId === poId);
    ensure(po, 'PO không tồn tại');
    const delayDays = Math.max(0, Math.ceil((Date.parse(po.arrivedAt || now()) - Date.parse(po.promisedAt)) / DAY));
    return { ...copy(po), delayDays, delayAlert: delayDays > 0 };
  }
  return Object.freeze({ createOutboundOrder, routeOrderToOptimalHub, pickFulfillment, packFulfillment, shipFulfillment,
    recordDeliveryAttempt, requestCustomerReturn, processReturnedPackage, createInboundPo, advanceInboundPo, getInboundPo,
    getSnapshot: () => ({ ...copy(state), wms: wms.getSnapshot() }),
    getInventory: input => wms.getInventory(input) });
}
module.exports = { createOmsLogisticsService, OUTBOUND_STATES, INBOUND_STATES, ...emergency };
