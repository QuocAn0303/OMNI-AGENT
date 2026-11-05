'use strict';

const { z } = require('zod');
const { optionsSchema } = require('./validation');
const { addDays } = require('./operations.service');

function assert(condition, message) {
  if (!condition) throw new Error('Dữ liệu không hợp lệ: ' + message);
}
function unique(rows, label) {
  assert(Array.isArray(rows), label + ' phải là mảng');
  assert(rows.every(row => typeof row.id === 'string'), label + ' thiếu ID');
  assert(new Set(rows.map(row => row.id)).size === rows.length, label + ' trùng ID');
}
function aggregate(rows, field, keyOf) {
  const result = new Map();
  for (const row of rows) {
    z.number().int().nonnegative().safe().parse(row[field]);
    const key = keyOf(row);
    result.set(key, (result.get(key) || 0) + row[field]);
  }
  return result;
}

/** Reconciles ledgers with source documents, not just a precomputed closing field. */
function auditInventory(catalog, log) {
  const { startDate, days } = optionsSchema.parse({
    startDate: log.metadata.startDate, days: log.metadata.days, seed: log.metadata.seed,
  });
  const tables = ['initialInventory', 'dailyLogs', 'demand', 'inventory', 'purchaseOrders', 'goodsReceipts', 'returns', 'codSettlements'];
  for (const table of tables) unique(log[table], table);
  const pair = row => row.warehouseId + '/' + row.sku;
  const key = row => row.date + '/' + pair(row);
  const validPairs = new Set(catalog.warehouses.flatMap(w => catalog.products.map(p => w.id + '/' + p.sku)));
  const validKeys = new Set(Array.from({ length: days }, (_, index) => addDays(startDate, index))
    .flatMap(date => [...validPairs].map(item => date + '/' + item)));
  assert(log.inventory.length === validKeys.size, 'thiếu dòng tồn kho');
  assert(new Set(log.inventory.map(key)).size === validKeys.size, 'trùng khóa ngày/kho/SKU');
  assert(log.initialInventory.length === validPairs.size, 'thiếu tồn đầu');
  assert(new Set(log.initialInventory.map(pair)).size === validPairs.size, 'trùng tồn đầu');
  const previous = new Map();
  for (const row of log.initialInventory) {
    assert(validPairs.has(pair(row)), 'tồn đầu tham chiếu sai');
    z.number().int().nonnegative().safe().parse(row.quantity);
    previous.set(pair(row), row.quantity);
  }
  assert(log.demand.length === validKeys.size * catalog.channels.length, 'thiếu dữ liệu kênh');
  const channelKeys = new Set();
  for (const row of log.demand) {
    assert(validKeys.has(key(row)) && catalog.channels.includes(row.channel), 'sai tham chiếu cầu');
    channelKeys.add(key(row) + '/' + row.channel);
    for (const field of ['actualDemand', 'fulfilledQuantity', 'stockoutQuantity', 'orderCount', 'codOrders', 'prepaidOrders']) {
      z.number().int().nonnegative().safe().parse(row[field]);
    }
    assert(row.actualDemand === row.fulfilledQuantity + row.stockoutQuantity, 'cầu không khớp xuất/thiếu');
    assert(row.orderCount === row.fulfilledQuantity && row.orderCount === row.codOrders + row.prepaidOrders, 'số đơn không khớp');
  }
  assert(channelKeys.size === log.demand.length, 'trùng cầu theo kênh');
  const poById = new Map(log.purchaseOrders.map(po => [po.id, po]));
  const seenPoReceipts = new Set();
  for (const grn of log.goodsReceipts) {
    const po = poById.get(grn.poId);
    assert(po && po.status === 'RECEIVED' && pair(po) === pair(grn) && po.supplierId === grn.supplierId, 'GRN không khớp PO');
    assert(validKeys.has(key(grn)) && grn.date === po.actualReceiptDate && grn.date >= po.date, 'ngày GRN sai');
    assert(!seenPoReceipts.has(po.id), 'PO nhập nhiều lần');
    seenPoReceipts.add(po.id);
    assert(grn.receivedQuantity === po.quantity && grn.acceptedQuantity + grn.rejectedQuantity === grn.receivedQuantity, 'lượng GRN sai');
  }
  for (const po of log.purchaseOrders) {
    assert(validPairs.has(pair(po)), 'PO sai kho/SKU');
    const supplier = catalog.suppliers.find(s => s.id === po.supplierId);
    const offer = supplier && supplier.offers.find(o => o.sku === po.sku);
    assert(offer && po.unitCost === offer.unitCost && po.quantity >= supplier.moq && po.quantity % supplier.moq === 0, 'PO sai NCC/giá/MOQ');
    assert(po.totalCost === po.unitCost * po.quantity, 'giá trị PO sai');
    assert((po.status === 'RECEIVED') === seenPoReceipts.has(po.id), 'PO thiếu chứng từ nhận');
  }
  const demandById = new Map(log.demand.map(row => [row.id, row]));
  const seenReturns = new Set();
  for (const event of log.returns) {
    const source = demandById.get(event.demandId);
    assert(source && pair(source) === pair(event) && event.quantity === source.plannedFailedDeliveryQuantity, 'RTS không khớp xuất');
    assert(!seenReturns.has(source.id), 'trùng phiếu hoàn');
    seenReturns.add(source.id);
    assert(event.returnedDate > source.deliveryDate && event.qcDate > event.returnedDate, 'trình tự QC sai');
    if (event.status === 'QC_COMPLETED') {
      assert(event.qcDate <= log.metadata.endDate && event.acceptedQuantity + event.rejectedQuantity === event.quantity, 'QC sai số lượng/ngày');
    } else {
      assert(event.acceptedQuantity === 0 && event.rejectedQuantity === 0, 'hàng chưa QC được ghi nhận');
    }
  }
  const grn = aggregate(log.goodsReceipts, 'acceptedQuantity', key);
  const qc = aggregate(log.returns.filter(row => row.status === 'QC_COMPLETED'), 'acceptedQuantity',
    row => row.qcDate + '/' + pair(row));
  const sales = aggregate(log.demand, 'fulfilledQuantity', key);
  let openingTotal = 0, receiptTotal = 0, returnTotal = 0, salesTotal = 0;
  for (const row of [...log.inventory].sort((a, b) => a.date.localeCompare(b.date))) {
    assert(validKeys.has(key(row)), 'tồn kho sai ngày/kho/SKU');
    for (const field of ['opening', 'grnReceived', 'qcReturns', 'salesIssued', 'closing']) {
      z.number().int().nonnegative().safe().parse(row[field]);
    }
    assert(row.opening === previous.get(pair(row)), 'tồn đầu không bằng tồn cuối ngày trước: ' + row.id);
    assert(row.grnReceived === (grn.get(key(row)) || 0), 'nhập không khớp GRN');
    assert(row.qcReturns === (qc.get(key(row)) || 0), 'nhập hoàn không khớp QC');
    assert(row.salesIssued === (sales.get(key(row)) || 0), 'xuất không khớp đơn');
    assert(row.opening + row.grnReceived + row.qcReturns - row.salesIssued === row.closing, 'mất cân bằng: ' + row.id);
    previous.set(pair(row), row.closing);
    if (row.date === startDate) openingTotal += row.opening;
    receiptTotal += row.grnReceived;
    returnTotal += row.qcReturns;
    salesTotal += row.salesIssued;
  }
  const closingTotal = [...previous.values()].reduce((a, b) => a + b, 0);
  assert(openingTotal + receiptTotal + returnTotal - salesTotal === closingTotal, 'mất cân bằng toàn kỳ');
  assert(log.dailyLogs.length === days && new Set(log.dailyLogs.map(row => row.date)).size === days, 'số ngày sai');
  for (const daily of log.dailyLogs) {
    const stocks = log.inventory.filter(row => row.date === daily.date);
    assert(stocks.length === validPairs.size, 'ngày không có tồn kho');
    for (const field of ['opening', 'grnReceived', 'qcReturns', 'salesIssued', 'closing']) {
      assert(daily[field] === stocks.reduce((total, row) => total + row[field], 0), 'tổng ngày sai: ' + field);
    }
  }
  return { balanced: true, checkedDays: days, checkedInventoryRows: log.inventory.length,
    openingTotal, grnReceived: receiptTotal, qcReturns: returnTotal, salesIssued: salesTotal, closingTotal, difference: 0 };
}
module.exports = { auditInventory };
