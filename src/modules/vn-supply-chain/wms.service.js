'use strict';

const { z } = require('zod');
const { randomUUID } = require('node:crypto');
const { createCatalog } = require('./data/catalog');
const { quoteShipping } = require('./services/logistics.service');
const v = require('./services/wms.validation');
const { calculateEOQ, calculateROP, planningSchema } = require('./services/replenishment.service');
const { evaluateSupplyChainSignals } = require('./scoringAdapter');

const DAY_MS = 86400000;
const ACTIVE = new Set(['RESERVED', 'PICKED', 'PACKED']);
const boxes = [
  { id: 'THUNG-S', volumeCm3: 8000, maxWeightGram: 3000, tareWeightGram: 150 },
  { id: 'THUNG-M', volumeCm3: 27000, maxWeightGram: 10000, tareWeightGram: 300 },
  { id: 'THUNG-L', volumeCm3: 64000, maxWeightGram: 25000, tareWeightGram: 600 },
];
function ensure(condition, message) { if (!condition) throw new Error(message); }
const copy = value => structuredClone(value);
const cellKey = r => r.warehouseId + '/' + r.sku + '/' + r.binId;
const sum = (rows, field) => rows.reduce((total, row) => total + row[field], 0);
const canonical = value => JSON.stringify(value, (_, val) => val && typeof val === 'object' && !Array.isArray(val)
  ? Object.fromEntries(Object.keys(val).sort().map(key => [key, val[key]])) : val);

/**
 * One isolated, synchronous WMS instance per tenant/site scope.
 * Commands clone, validate and commit atomically in this process; no database/3PL I/O.
 */
function createWmsService(options = {}) {
  const config = z.object({ initialInventory: v.initialSchema.default([]), clock: z.function().optional(),
    customStrategyFn: z.any().optional() }).strict().parse(options);
  const clock = config.clock || (() => new Date());
  const catalog = createCatalog();
  let state = { inventory: [], shipments: [], receipts: [], orders: [], defectReports: [], alerts: [],
    inventoryMovementLog: [], workflowEvents: [], lastEventAt: null };
  const replays = new Map();
  let strategyRunning = false;
  const now = () => {
    const value = clock();
    const date = value instanceof Date ? value : new Date(value);
    ensure(Number.isFinite(date.getTime()), 'Clock không hợp lệ');
    return date.toISOString();
  };
  function product(sku) {
    const found = catalog.products.find(p => p.sku === sku);
    ensure(found, 'SKU không tồn tại: ' + sku);
    return found;
  }
  function warehouse(id) {
    const found = catalog.warehouses.find(w => w.id === id);
    ensure(found, 'Kho không tồn tại: ' + id);
    return found;
  }
  function bin(warehouseId, binId, zones) {
    warehouse(warehouseId);
    const found = catalog.bins.find(b => b.id === binId && b.warehouseId === warehouseId);
    ensure(found && (!zones || zones.includes(found.zone)), 'Ô kệ sai kho hoặc sai zone: ' + binId);
    return found;
  }
  function cell(draft, warehouseId, sku, binId) {
    product(sku);
    bin(warehouseId, binId);
    let row = draft.inventory.find(r => r.warehouseId === warehouseId && r.sku === sku && r.binId === binId);
    if (!row) {
      row = { warehouseId, sku, binId, onHandQty: 0, reservedQty: 0, quarantineQty: 0, inTransitQty: 0, atpQty: 0 };
      draft.inventory.push(row);
    }
    return row;
  }
  function stock(draft, input) {
    const query = v.stockQuerySchema.parse(input);
    warehouse(query.warehouseId);
    product(query.sku);
    if (query.binId) bin(query.warehouseId, query.binId);
    const rows = draft.inventory.filter(r => r.warehouseId === query.warehouseId && r.sku === query.sku
      && (!query.binId || r.binId === query.binId));
    return { ...query, onHandQty: sum(rows, 'onHandQty'), reservedQty: sum(rows, 'reservedQty'),
      quarantineQty: sum(rows, 'quarantineQty'), inTransitQty: sum(rows, 'inTransitQty'),
      atpQty: sum(rows, 'onHandQty') - sum(rows, 'reservedQty') };
  }
  function orderedCells(draft, warehouseId, sku) {
    return draft.inventory.filter(r => r.warehouseId === warehouseId && r.sku === sku
      && bin(warehouseId, r.binId).sellable).sort((a, b) => a.binId.localeCompare(b.binId, 'en', { numeric: true }));
  }
  function validate(draft) {
    for (const row of draft.inventory) {
      row.atpQty = row.onHandQty - row.reservedQty;
      for (const field of ['onHandQty', 'reservedQty', 'quarantineQty', 'inTransitQty', 'atpQty']) v.qty.parse(row[field]);
      const location = bin(row.warehouseId, row.binId);
      ensure(location.sellable || row.onHandQty === 0, 'Hàng bán được ở sai zone');
      ensure(location.zone === 'Q' || (row.quarantineQty === 0 && row.inTransitQty === 0), 'Hàng chờ ở sai zone');
      const reservations = draft.orders.filter(o => o.warehouseId === row.warehouseId && ACTIVE.has(o.status))
        .flatMap(o => o.allocations).filter(a => a.sku === row.sku && a.binId === row.binId);
      ensure(sum(reservations, 'quantity') === row.reservedQty, 'Reserved không khớp phiếu nhặt');
      const inbound = draft.shipments.filter(s => s.warehouseId === row.warehouseId && s.quarantineBinId === row.binId)
        .flatMap(s => s.items).filter(i => i.sku === row.sku);
      ensure(inbound.reduce((n, i) => n + i.quantity - i.receivedQty, 0) === row.inTransitQty, 'Hàng đi đường không khớp lịch');
      const receiptLines = draft.receipts.filter(r => r.warehouseId === row.warehouseId && r.quarantineBinId === row.binId)
        .flatMap(r => r.items).filter(i => i.sku === row.sku);
      ensure(receiptLines.reduce((n, i) => n + i.receivedQty - i.putawayQty - i.returnedDefectQty, 0) === row.quarantineQty,
        'Quarantine không khớp GRN');
    }
  }
  function run(command, input, action) {
    ensure(!strategyRunning, 'Không được thay đổi WMS trong khi đánh giá chiến lược');
    const fingerprint = canonical({ command, input });
    const replay = replays.get(input.requestId);
    if (replay) {
      ensure(replay.fingerprint === fingerprint, 'requestId đã được dùng cho nội dung khác');
      return copy(replay.result);
    }
    const draft = copy(state);
    const at = now();
    ensure(!draft.lastEventAt || at >= draft.lastEventAt, 'Clock không được quay ngược');
    const result = action(draft, at);
    validate(draft);
    for (const after of draft.inventory) {
      const previous = state.inventory.find(row => cellKey(row) === cellKey(after));
      const before = previous || { ...after, onHandQty: 0, reservedQty: 0, quarantineQty: 0, inTransitQty: 0, atpQty: 0 };
      if (canonical(before) !== canonical(after)) {
        draft.inventoryMovementLog.push({ id: 'MOV-' + (draft.inventoryMovementLog.length + 1), command,
          requestId: input.requestId, at, warehouseId: after.warehouseId, sku: after.sku, binId: after.binId,
          before: copy(before), after: copy(after),
          delta: Object.fromEntries(['onHandQty', 'reservedQty', 'quarantineQty', 'inTransitQty', 'atpQty'].map(f => [f, after[f] - before[f]])) });
      }
    }
    draft.workflowEvents.push({ id: 'EVT-' + (draft.workflowEvents.length + 1), command, requestId: input.requestId,
      at, input: copy(input) });
    draft.lastEventAt = at;
    state = draft;
    replays.set(input.requestId, { fingerprint, result: copy(result) });
    return copy(result);
  }
  function registerInboundShipment(input) {
    const args = v.shipmentSchema.parse(input);
    return run('REGISTER_INBOUND', args, (draft, at) => {
      ensure(!draft.shipments.some(s => s.shipmentId === args.shipmentId), 'shipmentId đã tồn tại');
      bin(args.warehouseId, args.quarantineBinId, ['Q']);
      ensure(Date.parse(args.expectedArrivalAt) >= Date.parse(at), 'ETA phải từ hiện tại trở đi');
      ensure(Date.parse(args.expectedAvailableAt) >= Date.parse(args.expectedArrivalAt), 'Ngày sẵn sàng không được trước ETA');
      if (args.sourceType === 'PO') {
        ensure(!args.sourceWarehouseId, 'PO không có kho nguồn');
        const supplier = catalog.suppliers.find(s => s.id === args.supplierId);
        ensure(supplier && args.items.every(i => supplier.offers.some(o => o.sku === i.sku)), 'NCC không cung cấp SKU');
      } else {
        ensure(!args.supplierId && args.sourceWarehouseId !== args.warehouseId, 'Điều chuyển phải khác kho, không có NCC');
        warehouse(args.sourceWarehouseId);
        for (const item of args.items) {
          ensure(stock(draft, { warehouseId: args.sourceWarehouseId, sku: item.sku }).atpQty >= item.quantity, 'Kho nguồn thiếu ATP');
          let remaining = item.quantity;
          for (const row of orderedCells(draft, args.sourceWarehouseId, item.sku)) {
            const take = Math.min(remaining, row.onHandQty - row.reservedQty);
            row.onHandQty -= take;
            remaining -= take;
          }
        }
      }
      const shipment = { ...args, dispatchedAt: at, status: 'IN_TRANSIT', items: args.items.map(i => ({ ...i, receivedQty: 0 })) };
      for (const item of args.items) cell(draft, args.warehouseId, item.sku, args.quarantineBinId).inTransitQty += item.quantity;
      draft.shipments.push(shipment);
      return shipment;
    });
  }
  function recordQc(draft, receipt, line, passQty, defectQty, at) {
    ensure(passQty + defectQty > 0 && passQty + defectQty === line.pendingQcQty, 'QC phải phân loại đủ lượng đang chờ');
    line.pendingQcQty = 0;
    line.passQty += passQty;
    line.defectQty += defectQty;
    if (defectQty) draft.defectReports.push({ id: 'DEF-' + receipt.receiptId + '-' + line.sku,
      receiptId: receipt.receiptId, shipmentId: receipt.shipmentId, sku: line.sku, quantity: defectQty,
      reason: 'Không đạt kiểm định đầu vào', disposition: receipt.sourceType === 'PO' ? 'RETURN_TO_SUPPLIER'
        : receipt.sourceType === 'TRANSFER' ? 'RETURN_TO_SOURCE' : 'HOLD_FOR_DISPOSITION',
      supplierId: receipt.supplierId || null, sourceWarehouseId: receipt.sourceWarehouseId || null, at });
  }
  function receiveInboundGoods(input) {
    const args = v.receiveSchema.parse(input);
    return run('RECEIVE', args, (draft, at) => {
      const shipment = draft.shipments.find(s => s.shipmentId === args.shipmentId);
      ensure(shipment, 'Không tìm thấy chuyến hàng');
      ensure(!draft.receipts.some(r => r.receiptId === args.receiptId), 'receiptId đã tồn tại');
      const receipt = { receiptId: args.receiptId, shipmentId: shipment.shipmentId, warehouseId: shipment.warehouseId,
        quarantineBinId: shipment.quarantineBinId, sourceType: shipment.sourceType, supplierId: shipment.supplierId,
        sourceWarehouseId: shipment.sourceWarehouseId, receivedAt: at, items: [] };
      for (const item of args.items) {
        const source = shipment.items.find(i => i.sku === item.sku);
        ensure(source && item.quantity <= source.quantity - source.receivedQty, 'Nhận vượt số lượng chuyến hàng');
        source.receivedQty += item.quantity;
        const row = cell(draft, shipment.warehouseId, item.sku, shipment.quarantineBinId);
        row.inTransitQty -= item.quantity;
        row.quarantineQty += item.quantity;
        const line = { sku: item.sku, receivedQty: item.quantity, pendingQcQty: item.quantity,
          passQty: 0, defectQty: 0, putawayQty: 0, returnedDefectQty: 0 };
        receipt.items.push(line);
        if (item.passQty !== undefined) recordQc(draft, receipt, line, item.passQty, item.defectQty, at);
      }
      shipment.status = shipment.items.every(i => i.receivedQty === i.quantity) ? 'RECEIVED' : 'PARTIALLY_RECEIVED';
      draft.receipts.push(receipt);
      return receipt;
    });
  }
  function inspectInboundGoods(input) {
    const args = v.inspectSchema.parse(input);
    return run('QC', args, (draft, at) => {
      const receipt = draft.receipts.find(r => r.receiptId === args.receiptId);
      ensure(receipt, 'GRN không tồn tại');
      for (const result of args.results) {
        const line = receipt.items.find(i => i.sku === result.sku);
        ensure(line, 'SKU không nằm trong GRN');
        recordQc(draft, receipt, line, result.passQty, result.defectQty, at);
      }
      return receipt;
    });
  }
  function receiveReturnedGoods(input) {
    const args = v.returnSchema.parse(input);
    return run('RECEIVE_RETURN', args, (draft, at) => {
      const order = draft.orders.find(o => o.orderId === args.orderId);
      ensure(order && order.status === 'HANDED_OVER_CARRIER', 'Chỉ nhận hoàn từ đơn đã xuất');
      ensure(!draft.receipts.some(r => r.receiptId === args.receiptId), 'receiptId đã tồn tại');
      bin(order.warehouseId, args.receivingBinId, ['R']);
      bin(order.warehouseId, args.quarantineBinId, ['Q']);
      const receipt = { receiptId: args.receiptId, orderId: order.orderId, warehouseId: order.warehouseId,
        receivingBinId: args.receivingBinId, quarantineBinId: args.quarantineBinId,
        sourceType: 'RETURN', receivedAt: at, items: [] };
      for (const item of args.items) {
        const sold = order.items.find(i => i.sku === item.sku);
        const returned = draft.receipts.filter(r => r.sourceType === 'RETURN' && r.orderId === order.orderId)
          .flatMap(r => r.items).filter(i => i.sku === item.sku);
        ensure(sold && item.quantity + sum(returned, 'receivedQty') <= sold.quantity, 'Nhận hoàn vượt lượng đã xuất');
        cell(draft, order.warehouseId, item.sku, args.quarantineBinId).quarantineQty += item.quantity;
        receipt.items.push({ sku: item.sku, receivedQty: item.quantity, pendingQcQty: item.quantity,
          passQty: 0, defectQty: 0, putawayQty: 0, returnedDefectQty: 0 });
      }
      draft.receipts.push(receipt);
      return receipt;
    });
  }
  function putawayToBin(input) {
    const args = v.putawaySchema.parse(input);
    return run('PUTAWAY', args, draft => {
      const receipt = draft.receipts.find(r => r.receiptId === args.receiptId);
      ensure(receipt, 'GRN không tồn tại');
      bin(receipt.warehouseId, args.binId, ['A', 'B']);
      const line = receipt.items.find(i => i.sku === args.sku);
      ensure(line && args.quantity <= line.passQty - line.putawayQty, 'Không đủ hàng đạt QC để lên kệ');
      cell(draft, receipt.warehouseId, args.sku, receipt.quarantineBinId).quarantineQty -= args.quantity;
      const destination = cell(draft, receipt.warehouseId, args.sku, args.binId);
      destination.onHandQty += args.quantity;
      line.putawayQty += args.quantity;
      return stock(draft, { warehouseId: receipt.warehouseId, sku: args.sku, binId: args.binId });
    });
  }
  function returnDefectiveGoods(input) {
    const args = v.defectSchema.parse(input);
    return run('RETURN_DEFECT', args, draft => {
      const receipt = draft.receipts.find(r => r.receiptId === args.receiptId);
      ensure(receipt, 'GRN không tồn tại');
      ensure(receipt.sourceType !== 'RETURN', 'Hàng hoàn lỗi phải chờ quyết định xử lý, không tự trả NCC');
      const line = receipt.items.find(i => i.sku === args.sku);
      ensure(line && args.quantity <= line.defectQty - line.returnedDefectQty, 'Không đủ hàng lỗi để trả');
      cell(draft, receipt.warehouseId, args.sku, receipt.quarantineBinId).quarantineQty -= args.quantity;
      line.returnedDefectQty += args.quantity;
      return receipt;
    });
  }
  function getOrCreateOrder(draft, args) {
    warehouse(args.warehouseId);
    args.items.forEach(i => product(i.sku));
    let order = draft.orders.find(o => o.orderId === args.orderId);
    if (order) {
      ensure(order.warehouseId === args.warehouseId && order.channel === args.channel
        && canonical(order.items) === canonical(args.items), 'Nội dung đơn không khớp');
    } else {
      order = { orderId: args.orderId, warehouseId: args.warehouseId, channel: args.channel,
        items: copy(args.items), status: 'AWAITING_STOCK', allocations: [] };
      draft.orders.push(order);
    }
    return order;
  }
  function release(draft, order) {
    for (const allocation of order.allocations) cell(draft, order.warehouseId, allocation.sku, allocation.binId).reservedQty -= allocation.quantity;
    order.allocations = [];
    order.status = 'AWAITING_STOCK';
  }
  function allocate(draft, order) {
    if (order.items.some(i => stock(draft, { warehouseId: order.warehouseId, sku: i.sku }).atpQty < i.quantity)) return false;
    for (const item of order.items) {
      let remaining = item.quantity;
      for (const row of orderedCells(draft, order.warehouseId, item.sku)) {
        const take = Math.min(remaining, row.onHandQty - row.reservedQty);
        if (take) {
          row.reservedQty += take;
          order.allocations.push({ sku: item.sku, binId: row.binId, quantity: take });
          remaining -= take;
        }
      }
    }
    order.status = 'RESERVED';
    return true;
  }
  function reserveOrder(input) {
    const args = v.orderSchema.parse(input);
    return run('RESERVE', args, (draft, at) => {
      const order = getOrCreateOrder(draft, args);
      ensure(order.status === 'AWAITING_STOCK', 'Đơn không ở trạng thái chờ giữ chỗ');
      ensure(allocate(draft, order), 'Không đủ ATP để giữ chỗ');
      order.reservedAt = at;
      return order;
    });
  }
  function pick(draft, args, at) {
    const order = getOrCreateOrder(draft, args);
    ensure(['AWAITING_STOCK', 'RESERVED'].includes(order.status), 'Đơn không thể nhặt ở trạng thái hiện tại');
    for (const count of args.binCounts) {
      ensure(order.items.some(i => i.sku === count.sku), 'Kiểm đếm SKU ngoài đơn');
      bin(order.warehouseId, count.binId, ['A', 'B']);
      const row = cell(draft, order.warehouseId, count.sku, count.binId);
      ensure(count.actualOnHandQty <= row.onHandQty, 'Pick-Short không dùng để điều chỉnh tăng tồn');
      if (count.actualOnHandQty === row.onHandQty) continue;
      const affected = draft.orders.filter(o => o.warehouseId === order.warehouseId && o.status === 'RESERVED'
        && o.allocations.some(a => a.binId === count.binId && a.sku === count.sku));
      const locked = draft.orders.filter(o => o.warehouseId === order.warehouseId && ['PICKED', 'PACKED'].includes(o.status))
        .flatMap(o => o.allocations).filter(a => a.binId === count.binId && a.sku === count.sku);
      ensure(count.actualOnHandQty >= sum(locked, 'quantity'), 'Kiểm đếm xung đột với hàng đã nhặt/đóng gói');
      const shortageQty = row.onHandQty - count.actualOnHandQty;
      affected.forEach(o => release(draft, o));
      row.onHandQty = count.actualOnHandQty;
      draft.alerts.push({ id: 'SHORT-' + (draft.alerts.length + 1), type: 'PICK_SHORT', at,
        warehouseId: order.warehouseId, sku: count.sku, binId: count.binId, shortageQty,
        actualOnHandQty: count.actualOnHandQty, affectedOrderIds: [...new Set([order.orderId, ...affected.map(o => o.orderId)])] });
    }
    if (order.status === 'RESERVED') release(draft, order);
    if (!allocate(draft, order)) {
      // Preserve the physical count and alert; do not pretend that the pick succeeded.
      order.status = 'AWAITING_STOCK';
      return order;
    }
    order.status = 'PICKED';
    order.pickedAt = at;
    order.pickList = order.allocations.map(a => ({ ...a, orderId: order.orderId, warehouseId: order.warehouseId }))
      .sort((a, b) => a.binId.localeCompare(b.binId, 'en', { numeric: true }) || a.sku.localeCompare(b.sku));
    return order;
  }
  function pickOrderItems(input) {
    const args = v.pickSchema.parse(input);
    return run('PICK', args, (draft, at) => pick(draft, args, at));
  }
  function pickWave(input) {
    const args = v.waveSchema.parse(input);
    return run('PICK_WAVE', args, (draft, at) => {
      const orders = args.orders.map(order => pick(draft, order, at));
      return { orders, pickList: orders.filter(o => o.status === 'PICKED').flatMap(o => o.pickList)
        .sort((a, b) => a.warehouseId.localeCompare(b.warehouseId) || a.binId.localeCompare(b.binId, 'en', { numeric: true })
          || a.sku.localeCompare(b.sku) || a.orderId.localeCompare(b.orderId)) };
    });
  }
  function packOrder(input) {
    const args = v.packSchema.parse(input);
    return run('PACK', args, (draft, at) => {
      const order = draft.orders.find(o => o.orderId === args.orderId);
      ensure(order && order.status === 'PICKED', 'Chỉ đóng gói đơn đã nhặt đủ');
      const weight = order.items.reduce((n, i) => n + product(i.sku).weightGram * i.quantity, 0);
      const volume = order.items.reduce((n, i) => n + product(i.sku).volumeCm3 * i.quantity, 0);
      ensure(args.measuredVolumeCm3 >= volume, 'Thể tích kiện nhỏ hơn tổng thể tích hàng');
      const box = boxes.find(b => args.measuredVolumeCm3 <= b.volumeCm3 && args.measuredWeightGram <= b.maxWeightGram
        && Math.abs(args.measuredWeightGram - weight - b.tareWeightGram) <= Math.max(50, (weight + b.tareWeightGram) * 0.05));
      ensure(box, 'Không có thùng phù hợp hoặc trọng lượng lệch quá dung sai');
      const quote = quoteShipping({ carrierId: args.carrierId, lane: args.lane,
        originCity: warehouse(order.warehouseId).city, destinationCity: args.destinationCity,
        distanceKm: args.distanceKm, weightGram: args.measuredWeightGram, volumeCm3: args.measuredVolumeCm3 });
      order.package = { box: copy(box), measuredWeightGram: args.measuredWeightGram, measuredVolumeCm3: args.measuredVolumeCm3,
        carrierId: args.carrierId, trackingNumber: args.carrierId + '-SIM-' + randomUUID(),
        labelMode: 'SIMULATED', quote, destinationCity: args.destinationCity };
      order.status = 'PACKED';
      order.packedAt = at;
      return order;
    });
  }
  function shipOrderOut(input) {
    const args = v.orderCommandSchema.parse(input);
    return run('SHIP', args, (draft, at) => {
      const order = draft.orders.find(o => o.orderId === args.orderId);
      ensure(order && order.status === 'PACKED', 'Chỉ xuất đơn đã đóng gói');
      for (const allocation of order.allocations) {
        const row = cell(draft, order.warehouseId, allocation.sku, allocation.binId);
        row.onHandQty -= allocation.quantity;
        row.reservedQty -= allocation.quantity;
      }
      order.status = 'HANDED_OVER_CARRIER';
      order.shippedAt = at;
      order.slaDueAt = new Date(Date.parse(at) + order.package.quote.slaHours * 3600000).toISOString();
      return order;
    });
  }
  function cancelOrder(input) {
    const args = v.orderCommandSchema.parse(input);
    return run('CANCEL', args, draft => {
      const order = draft.orders.find(o => o.orderId === args.orderId);
      ensure(order && ['RESERVED', 'AWAITING_STOCK'].includes(order.status), 'Chỉ hủy đơn chưa nhặt');
      release(draft, order);
      order.status = 'CANCELLED';
      return order;
    });
  }
  function projectedAtp(input) {
    const args = v.projectionSchema.parse(input);
    const current = stock(state, { warehouseId: args.warehouseId, sku: args.sku });
    const timestamp = Date.parse(now());
    const cutoff = timestamp + args.daysAhead * DAY_MS;
    const scheduledReceipts = state.shipments.filter(s => s.warehouseId === args.warehouseId
      && Date.parse(s.expectedAvailableAt) > timestamp && Date.parse(s.expectedAvailableAt) <= cutoff)
      .flatMap(s => s.items).filter(i => i.sku === args.sku).reduce((n, i) => n + i.quantity - i.receivedQty, 0);
    const forecastDemand = args.forecastDaily ? args.forecastDaily.reduce((a, b) => a + b, 0)
      : (args.dailyDemand ?? product(args.sku).baseDailyDemand * warehouse(args.warehouseId).demandShare) * args.daysAhead;
    return { warehouseId: args.warehouseId, sku: args.sku, daysAhead: args.daysAhead, atpQty: current.atpQty,
      scheduledReceipts, forecastDemand, projectedAtpQty: current.atpQty + scheduledReceipts - forecastDemand };
  }
  function planReplenishment(input = {}, customStrategyFn = config.customStrategyFn) {
    const args = planningSchema.parse(input);
    const plans = [], signals = [];
    const timestamp = Date.parse(now());
    for (const hub of catalog.warehouses) for (const p of catalog.products) {
      const current = stock(state, { warehouseId: hub.id, sku: p.sku });
      const primary = catalog.suppliers.find(s => s.group === p.group && s.role === 'PRIMARY');
      const backup = catalog.suppliers.find(s => s.group === p.group && s.role === 'BACKUP');
      const dailyDemand = p.baseDailyDemand * hub.demandShare;
      const open = state.shipments.filter(s => s.warehouseId === hub.id && s.items.some(i => i.sku === p.sku && i.receivedQty < i.quantity));
      const overdue = open.some(s => s.sourceType === 'PO' && s.supplierId === primary.id && Date.parse(s.expectedArrivalAt) < timestamp);
      const projection = projectedAtp({ warehouseId: hub.id, sku: p.sku, daysAhead: primary.leadTimeDays, dailyDemand });
      const supplier = overdue || projection.projectedAtpQty < 0 ? backup : primary;
      const safetyStock = Math.ceil(dailyDemand * args.safetyStockDays);
      const rop = calculateROP({ dailyDemand, leadTimeDays: supplier.leadTimeDays, safetyStock });
      const timely = open.filter(s => Date.parse(s.expectedAvailableAt) > timestamp
        && Date.parse(s.expectedAvailableAt) <= timestamp + (supplier.leadTimeDays + args.reviewDays) * DAY_MS)
        .flatMap(s => s.items).filter(i => i.sku === p.sku).reduce((n, i) => n + i.quantity - i.receivedQty, 0);
      const position = current.atpQty + timely;
      const eoq = calculateEOQ({ annualDemand: dailyDemand * 365, orderingCost: args.orderingCost,
        holdingCostPerUnitPerYear: p.holdingCostPerDay * 365, moq: supplier.moq });
      const quantity = position <= rop ? Math.ceil(Math.max(eoq.orderQty, rop + dailyDemand * args.reviewDays - position) / supplier.moq) * supplier.moq : 0;
      const unitCost = supplier.offers.find(o => o.sku === p.sku).unitCost;
      plans.push({ warehouseId: hub.id, sku: p.sku, supplierId: supplier.id, supplierRole: supplier.role,
        reason: overdue ? 'PRIMARY_DELAY' : projection.projectedAtpQty < 0 ? 'PROJECTED_SHORTAGE' : 'ROP_REPLENISHMENT',
        action: quantity ? args.procurementMode : 'NONE', quantity, moq: supplier.moq, eoq: eoq.orderQty, rop,
        inventoryPosition: position, unitCost, totalCost: quantity * unitCost, currency: 'VNĐ',
        leadTimeDays: supplier.leadTimeDays, projectedAtpQty: projection.projectedAtpQty });
      signals.push({ warehouseId: hub.id, sku: p.sku, atpQty: current.atpQty, inTransitQty: current.inTransitQty,
        quarantineQty: current.quarantineQty, dailyDemand, leadTimeDays: supplier.leadTimeDays,
        stockoutPenaltyPerUnit: p.stockoutPenaltyPerUnit, unitCost });
    }
    ensure(!strategyRunning, 'Không được gọi lồng chiến lược');
    strategyRunning = true;
    let scores;
    try { scores = evaluateSupplyChainSignals({ signals }, customStrategyFn); }
    finally { strategyRunning = false; }
    return scores.map(score => ({ ...plans.find(p => p.warehouseId === score.warehouseId && p.sku === score.sku),
      priorityScore: score.priorityScore, scoringReason: score.reason }));
  }

  run('OPENING', { requestId: '_WMS_OPENING' }, (draft) => {
    for (const row of config.initialInventory) {
      bin(row.warehouseId, row.binId, ['A', 'B']);
      cell(draft, row.warehouseId, row.sku, row.binId).onHandQty = row.quantity;
    }
    return { initialized: true };
  });
  return Object.freeze({ registerInboundShipment, receiveInboundGoods, inspectInboundGoods, putawayToBin,
    receiveReturnedGoods, returnDefectiveGoods, reserveOrder, pickOrderItems, pickWave, packOrder, shipOrderOut, cancelOrder,
    getInventory: input => stock(state, input), getSnapshot: () => copy(state), projectedAtp, planReplenishment });
}
module.exports = { createWmsService, calculateEOQ, calculateROP };
