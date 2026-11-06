'use strict';
const { z } = require('zod');
const { createCatalog } = require('../data/catalog');
const catalog = createCatalog();
const hubs = ['WH-HCM', 'WH-HN'];
const integer = z.number().int().nonnegative().max(1000000);
const positive = integer.refine(n => n > 0, 'Phải dương');
const hubValues = z.object({ 'WH-HCM': integer, 'WH-HN': integer }).strict();
const sharesSchema = z.object({ Shopee: z.number().min(0).max(1), 'TikTok Shop': z.number().min(0).max(1),
  Website: z.number().min(0).max(1), POS: z.number().min(0).max(1) }).strict()
  .refine(s => Math.abs(Object.values(s).reduce((a, b) => a + b, 0) - 1) < 1e-9, 'Tỷ trọng kênh phải bằng 1');
const defaultShares = { Shopee: 0.4, 'TikTok Shop': 0.3, Website: 0.2, POS: 0.1 };
const skuSchema = z.enum(catalog.products.map(p => p.sku));
function allocate(quantity, shares) {
  const rows = Object.entries(shares).map(([channel, weight]) => ({ channel, quantity: Math.floor(quantity * weight), remainder: quantity * weight % 1 }));
  let remaining = quantity - rows.reduce((n, r) => n + r.quantity, 0);
  for (const row of [...rows].sort((a, b) => b.remainder - a.remainder)) if (remaining-- > 0) row.quantity++;
  return rows.map(({ channel, quantity: count }) => ({ channel, quantity: count }));
}
function suppliers(sku) {
  const p = catalog.products.find(r => r.sku === sku);
  return { product: p, primary: catalog.suppliers.find(s => s.group === p.group && s.role === 'PRIMARY'),
    backup: catalog.suppliers.find(s => s.group === p.group && s.role === 'BACKUP') };
}
function purchase(id, warehouseId, supplier, sku, needed, arrivalDay, leadTimeDays) {
  const quantity = Math.ceil(Math.max(0, needed) / supplier.moq) * supplier.moq;
  return { id, warehouseId, supplierId: supplier.id, supplierRole: supplier.role, sku, quantity,
    orderDay: 0, arrivalDay, leadTimeDays, moq: supplier.moq,
    unitCost: supplier.offers.find(o => o.sku === sku).unitCost,
    totalCost: quantity * supplier.offers.find(o => o.sku === sku).unitCost, currency: 'VNĐ' };
}

/** Quantities received at start of day; demand is lost if unserved, never silently backlogged. */
function runScenario({ sku, days, opening, demandByHub, capacity, purchaseOrders, transfers = [], shares = defaultShares, pushShare = 0.7 }) {
  const stock = { ...opening }, ledger = [], goodsReceipts = [], transferMovements = [];
  const pipeline = [];
  for (let day = 1; day <= days; day++) {
    for (const warehouseId of hubs) {
      const start = stock[warehouseId];
      const arrivals = purchaseOrders.filter(p => p.arrivalDay === day && p.warehouseId === warehouseId && p.quantity > 0);
      const poReceived = arrivals.reduce((n, p) => n + p.quantity, 0);
      for (const po of arrivals) goodsReceipts.push({ id: 'GRN-' + po.id, poId: po.id, day, warehouseId, sku, quantity: po.quantity, qcStatus: 'PASSED' });
      const outgoing = transfers.filter(t => t.departureDay === day && t.sourceWarehouseId === warehouseId);
      const incoming = transfers.filter(t => t.arrivalDay === day && t.destinationWarehouseId === warehouseId);
      const transferOut = outgoing.reduce((n, t) => n + t.quantity, 0);
      const transferIn = incoming.reduce((n, t) => n + t.quantity, 0);
      if (transferOut > start + poReceived + transferIn) throw new Error('Điều chuyển vượt tồn nguồn');
      outgoing.forEach(t => transferMovements.push({ transferId: t.id, warehouseId, day, direction: 'OUT', quantity: t.quantity }));
      incoming.forEach(t => transferMovements.push({ transferId: t.id, warehouseId, day, direction: 'IN', quantity: t.quantity }));
      const available = start + poReceived + transferIn - transferOut;
      const demand = demandByHub[warehouseId][day - 1];
      const dailyCapacity = Array.isArray(capacity[warehouseId]) ? capacity[warehouseId][day - 1] : capacity[warehouseId];
      const sold = Math.min(available, demand, dailyCapacity);
      stock[warehouseId] = available - sold;
      ledger.push({ day, warehouseId, sku, opening: start, poReceived, transferIn, transferOut,
        demand, capacity: dailyCapacity, sold, closing: stock[warehouseId],
        stockoutUnits: Math.max(0, demand - available), capacityDelayedUnits: Math.max(0, Math.min(demand, available) - sold),
        unfulfilled: demand - sold, channelAllocation: allocate(sold, shares).map(c => ({ ...c,
          pushQty: Math.floor(c.quantity * pushShare), pullQty: c.quantity - Math.floor(c.quantity * pushShare) })) });
    }
    pipeline.push({ day, inTransitQty: transfers.filter(t => t.departureDay <= day && t.arrivalDay > day).reduce((n, t) => n + t.quantity, 0) });
  }
  const total = field => ledger.reduce((n, r) => n + r[field], 0);
  const result = { sku, days, opening, purchaseOrders, transfers, goodsReceipts, transferMovements, pipeline, ledger,
    metrics: { demand: total('demand'), fulfilled: total('sold'), stockoutUnits: total('stockoutUnits'),
      unfulfilled: total('unfulfilled'), stockoutRate: total('demand') ? total('stockoutUnits') / total('demand') : 0,
      dispatchSlaRate: total('demand') ? total('sold') / total('demand') : 1,
      stockoutDay: ledger.find(r => r.stockoutUnits > 0)?.day ?? null, closing: { ...stock } } };
  result.audit = auditScenario(result);
  return result;
}
function auditScenario(result) {
  const previous = { ...result.opening };
  const seen = new Set();
  let receivedTotal = 0, soldTotal = 0;
  for (let day = 1; day <= result.days; day++) {
    for (const warehouseId of hubs) {
      const rows = result.ledger.filter(r => r.day === day && r.warehouseId === warehouseId);
      if (rows.length !== 1) throw new Error('Thiếu/trùng dòng tồn');
      const row = rows[0];
      for (const field of ['opening', 'poReceived', 'transferIn', 'transferOut', 'sold', 'closing', 'demand', 'unfulfilled', 'stockoutUnits', 'capacityDelayedUnits', 'capacity']) {
        if (!Number.isSafeInteger(row[field]) || row[field] < 0) throw new Error('Số lượng sai');
      }
      const grns = result.goodsReceipts.filter(g => g.day === day && g.warehouseId === warehouseId);
      for (const grn of grns) {
        const po = result.purchaseOrders.find(p => p.id === grn.poId);
        if (!po || seen.has(po.id) || grn.quantity !== po.quantity || po.arrivalDay !== day || po.warehouseId !== warehouseId) throw new Error('GRN không khớp PO');
        seen.add(po.id);
      }
      const receipt = grns.reduce((n, r) => n + r.quantity, 0);
      const moves = direction => result.transferMovements.filter(t => t.day === day && t.warehouseId === warehouseId && t.direction === direction).reduce((n, t) => n + t.quantity, 0);
      if (row.opening !== previous[warehouseId] || row.poReceived !== receipt || row.transferIn !== moves('IN') || row.transferOut !== moves('OUT')
        || row.opening + receipt + row.transferIn - row.transferOut - row.sold !== row.closing
        || row.sold + row.unfulfilled !== row.demand || row.sold > row.capacity
        || row.stockoutUnits !== Math.max(0, row.demand - row.opening - receipt - row.transferIn + row.transferOut)
        || row.unfulfilled !== row.stockoutUnits + row.capacityDelayedUnits
        || row.channelAllocation.reduce((n, c) => n + c.quantity, 0) !== row.sold) throw new Error('Mất cân bằng tồn kho');
      previous[warehouseId] = row.closing;
      receivedTotal += receipt;
      soldTotal += row.sold;
    }
    const transit = result.transfers.filter(t => t.departureDay <= day && t.arrivalDay > day).reduce((n, t) => n + t.quantity, 0);
    if (result.pipeline.find(p => p.day === day)?.inTransitQty !== transit
      || Object.values(result.opening).reduce((a, b) => a + b, 0) + receivedTotal - soldTotal
        !== Object.values(previous).reduce((a, b) => a + b, 0) + transit) throw new Error('Mất cân bằng toàn hệ thống/hàng đi đường');
  }
  if (result.ledger.length !== result.days * 2) throw new Error('Thừa dòng tồn');
  const demand = result.ledger.reduce((n, r) => n + r.demand, 0);
  const shortage = result.ledger.reduce((n, r) => n + r.stockoutUnits, 0);
  if (result.metrics.fulfilled !== soldTotal || result.metrics.demand !== demand
    || result.metrics.stockoutUnits !== shortage || result.metrics.unfulfilled !== demand - soldTotal
    || result.metrics.dispatchSlaRate !== (demand ? soldTotal / demand : 1)
    || result.metrics.stockoutRate !== (demand ? shortage / demand : 0)) throw new Error('Chỉ số không khớp sổ tồn');
  for (const po of result.purchaseOrders) {
    if (po.quantity > 0 && po.arrivalDay <= result.days && !seen.has(po.id)) throw new Error('PO đến hạn thiếu GRN');
  }
  for (const transfer of result.transfers) {
    for (const [direction, day, warehouseId] of [['OUT', transfer.departureDay, transfer.sourceWarehouseId], ['IN', transfer.arrivalDay, transfer.destinationWarehouseId]]) {
      const moves = result.transferMovements.filter(m => m.transferId === transfer.id && m.direction === direction);
      if (day <= result.days && (moves.length !== 1 || moves[0].day !== day || moves[0].warehouseId !== warehouseId || moves[0].quantity !== transfer.quantity)) throw new Error('Chứng từ điều chuyển không khớp');
    }
  }
  return { balanced: true, checkedRows: result.ledger.length, difference: 0 };
}
function compare(before, after) {
  return ['stockoutUnits', 'stockoutRate', 'unfulfilled', 'dispatchSlaRate'].map(metric => ({
    metric, before: before.metrics[metric], after: after.metrics[metric],
    change: after.metrics[metric] - before.metrics[metric] }));
}
function simulateSupplierDelay14Days(input = {}) {
  const args = z.object({ sku: skuSchema.default('VN-A-001'), days: z.number().int().min(20).max(60).default(28),
    targetWarehouseId: z.enum(hubs).default('WH-HCM'), opening: hubValues.default({ 'WH-HCM': 80, 'WH-HN': 800 }),
    dailyDemand: hubValues.default({ 'WH-HCM': 40, 'WH-HN': 20 }),
    primaryArrivalDay: z.number().int().min(1).max(5).default(3), primaryQuantity: positive.default(600),
    transferLeadDays: z.number().int().min(1).max(4).default(1),
  }).strict().parse(input);
  const { primary, backup } = suppliers(args.sku);
  const target = args.targetWarehouseId, donor = hubs.find(h => h !== target);
  const delayedDay = args.primaryArrivalDay + 14;
  const delayedPo = purchase('PRIMARY-DELAYED', target, primary, args.sku, args.primaryQuantity, delayedDay, primary.leadTimeDays);
  delayedPo.orderDay = args.primaryArrivalDay - primary.leadTimeDays;
  delayedPo.promisedArrivalDay = args.primaryArrivalDay;
  delayedPo.delayDays = 14;
  const demandByHub = Object.fromEntries(hubs.map(h => [h, Array(args.days).fill(args.dailyDemand[h])]));
  const capacity = Object.fromEntries(hubs.map(h => [h, args.dailyDemand[h]]));
  const base = { sku: args.sku, days: args.days, opening: args.opening, demandByHub, capacity };
  const before = runScenario({ ...base, purchaseOrders: [delayedPo] });
  const bridgeNeed = Math.max(0, args.dailyDemand[target] * 3 - args.opening[target]);
  const donorSurplus = Math.max(0, args.opening[donor] - args.dailyDemand[donor] * (args.days + 2));
  const transferQty = Math.min(bridgeNeed, donorSurplus);
  const transfers = transferQty > 0 ? [{ id: 'LATERAL-1', sourceWarehouseId: donor, destinationWarehouseId: target,
    quantity: transferQty, departureDay: 1, arrivalDay: 1 + args.transferLeadDays }] : [];
  const emergencyNeed = Math.max(0, args.dailyDemand[target] * (delayedDay - 1) - args.opening[target] - transferQty,
    args.dailyDemand[target] * args.days - args.opening[target] - transferQty - delayedPo.quantity);
  const emergencyPo = purchase('BACKUP-URGENT', target, backup, args.sku, emergencyNeed, 4, 4);
  const after = runScenario({ ...base, purchaseOrders: [delayedPo, emergencyPo].filter(p => p.quantity > 0), transfers });
  return { scenario: 'SUPPLIER_DELAY_14_DAYS', assumptions: { delayDays: 14, emergencyLeadTimeDays: 4,
    emergencyLeadTimeIsScenarioAgreement: true, receiptsQcAndPutawayAtStartOfArrivalDay: true },
    stockoutDay: before.ledger.find(r => r.warehouseId === target && r.stockoutUnits > 0)?.day ?? null,
    responsePlan: { delayedPo, lateralTransfers: transfers, emergencyPo, donorProtectedDemandDays: args.days + 2 },
    before, after, comparison: compare(before, after),
    feasible: after.metrics.stockoutUnits === 0,
    unresolvedShortage: after.metrics.stockoutUnits, currency: 'VNĐ' };
}
function simulateDemandSurge50Percent(input = {}) {
  const args = z.object({ sku: skuSchema.default('VN-A-001'), opening: hubValues.default({ 'WH-HCM': 360, 'WH-HN': 240 }),
    baselineDailyDemand: hubValues.default({ 'WH-HCM': 60, 'WH-HN': 40 }),
    maxOvertimeMultiplier: z.number().finite().min(1).max(3).default(1.6),
    channelDemandShares: sharesSchema.default({ Shopee: 0.45, 'TikTok Shop': 0.35, Website: 0.12, POS: 0.08 }),
  }).strict().parse(input);
  const { primary, backup } = suppliers(args.sku);
  const days = 28, primaryDay = primary.leadTimeDays;
  const demandByHub = Object.fromEntries(hubs.map(h => [h, Array.from({ length: days }, (_, i) => i < 14 ? Math.ceil(args.baselineDailyDemand[h] * 1.5) : args.baselineDailyDemand[h])]));
  const original = [], adjusted = [], safetyStock = {}, overtime = {}, capacity = {};
  for (const hub of hubs) {
    const daily = args.baselineDailyDemand[hub], peak = Math.ceil(daily * 1.5);
    original.push(purchase('BASE-' + hub, hub, primary, args.sku, daily * days - args.opening[hub], primaryDay, primaryDay));
    safetyStock[hub] = { before: daily * 2, after: peak * 3 };
    const urgent = purchase('BACKUP-' + hub, hub, backup, args.sku,
      peak * (primaryDay - 1) - args.opening[hub], 4, 4);
    const primaryPo = purchase('PRIMARY-' + hub, hub, primary, args.sku,
      demandByHub[hub].reduce((a, b) => a + b, 0) + safetyStock[hub].after - args.opening[hub] - urgent.quantity, primaryDay, primaryDay);
    adjusted.push(urgent, primaryPo);
    const peakCapacity = Math.min(Math.ceil(peak / 0.95), Math.floor(daily * args.maxOvertimeMultiplier));
    capacity[hub] = Array.from({ length: days }, (_, i) => i < 14 ? peakCapacity : daily);
    overtime[hub] = { days: 14, normalUnitsPerDay: daily, unitsPerDay: peakCapacity, additionalUnitsPerDay: peakCapacity - daily };
  }
  const base = { sku: args.sku, days, opening: args.opening, demandByHub };
  const before = runScenario({ ...base, capacity: args.baselineDailyDemand, purchaseOrders: original.filter(p => p.quantity) });
  const after = runScenario({ ...base, capacity, purchaseOrders: adjusted.filter(p => p.quantity), shares: args.channelDemandShares, pushShare: 0.4 });
  const peakRows = after.ledger.filter(r => r.day <= 14);
  const peakDemand = peakRows.reduce((n, r) => n + r.demand, 0);
  const peakSlaRate = peakDemand ? peakRows.reduce((n, r) => n + r.sold, 0) / peakDemand : 1;
  return { scenario: 'DEMAND_SURGE_50_PERCENT', assumptions: { surgeMultiplier: 1.5, surgeDays: 14,
    emergencyLeadTimeDays: 4, slaMetric: 'SAME_DAY_DISPATCH_UNITS_OVER_DEMAND', oneUnitPerOrder: true,
    receiptsQcAndPutawayAtStartOfArrivalDay: true, capacityIsUnitsPerDay: true },
    responsePlan: { safetyStock, overtime, purchaseOrders: adjusted.filter(p => p.quantity),
      pushPull: { before: { push: 0.7, pull: 0.3 }, after: { push: 0.4, pull: 0.6 } },
      channelAllocation: { before: defaultShares, after: args.channelDemandShares } },
    before, after, comparison: compare(before, after), peakSlaRate,
    feasible: peakSlaRate >= 0.95 && after.metrics.stockoutUnits === 0,
    unresolvedShortage: after.metrics.stockoutUnits, currency: 'VNĐ' };
}
module.exports = { simulateSupplierDelay14Days, simulateDemandSurge50Percent, auditScenario };
