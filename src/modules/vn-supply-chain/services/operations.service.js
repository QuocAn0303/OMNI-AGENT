'use strict';

const { createCatalog } = require('../data/catalog');
const { optionsSchema } = require('./validation');
const { quoteShipping } = require('./logistics.service');

const DAY_MS = 86400000;
const addDays = (date, count) => new Date(Date.parse(date + 'T00:00:00.000Z') + count * DAY_MS).toISOString().slice(0, 10);
const sum = (rows, field) => rows.reduce((total, row) => total + row[field], 0);

function createRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function saleEvent(date) {
  if (date.slice(5) === '11-11') return '11/11';
  if (date.slice(5) === '12-12') return '12/12';
  return null;
}

/**
 * Cohorts contain one-unit orders aggregated by date / hub / SKU / channel.
 * Sale issues mean dispatched units (not delivered revenue).
 * Only GRNs and QC-approved returns enter sellable stock.
 */
function generateTwoMonthOperationsLog(input = {}) {
  const options = optionsSchema.parse(input);
  const { startDate, days, seed } = options;
  const endDate = addDays(startDate, days - 1);
  const catalog = createCatalog();
  const random = createRandom(seed);
  const demand = [], inventory = [], purchaseOrders = [], goodsReceipts = [], returns = [];
  const initialInventory = [];
  const state = new Map();
  const pending = [];
  const returnQueue = new Map();
  const prefix = startDate.replaceAll('-', '') + '-' + seed;
  const stockKey = (warehouseId, sku) => warehouseId + '/' + sku;
  const location = (warehouse, zone) => warehouse.prefix + '-' + zone + '-01-R1-B01';

  for (const warehouse of catalog.warehouses) {
    for (const product of catalog.products) {
      const base = product.baseDailyDemand * warehouse.demandShare;
      const quantity = Math.ceil(base * (product.strategy === 'PULL' ? 5 : 9));
      state.set(stockKey(warehouse.id, product.sku), { quantity, recentDemand: [], poCount: 0 });
      initialInventory.push({ id: 'OPEN-' + warehouse.id + '-' + product.sku,
        warehouseId: warehouse.id, sku: product.sku, quantity,
        binId: location(warehouse, product.group === 'A' ? 'A' : 'B') });
    }
  }

  for (let dayIndex = 0; dayIndex < days; dayIndex += 1) {
    const date = addDays(startDate, dayIndex);
    const megaSale = saleEvent(date);
    for (const warehouse of catalog.warehouses) {
      for (const product of catalog.products) {
        const key = stockKey(warehouse.id, product.sku);
        const current = state.get(key);
        const opening = current.quantity;
        let grnReceived = 0;
        let qcReturns = 0;
        for (const po of pending.filter(p => p.warehouseId === warehouse.id && p.sku === product.sku && p.expectedReceiptDate === date)) {
          const grn = { id: 'GRN-' + po.id, poId: po.id, date, warehouseId: warehouse.id, sku: product.sku,
            supplierId: po.supplierId, receivedQuantity: po.quantity, acceptedQuantity: po.quantity, rejectedQuantity: 0,
            quarantineBinId: location(warehouse, 'Q'), putawayBinId: location(warehouse, product.group === 'A' ? 'A' : 'B'),
            qcStatus: 'PASSED', qcDate: date, currency: 'VNĐ', amount: po.totalCost };
          goodsReceipts.push(grn);
          po.status = 'RECEIVED';
          po.actualReceiptDate = date;
          grnReceived += grn.acceptedQuantity;
        }
        for (const event of returnQueue.get(date + '/' + key) || []) {
          event.status = 'QC_COMPLETED';
          event.acceptedQuantity = event.plannedAcceptedQuantity;
          event.rejectedQuantity = event.quantity - event.acceptedQuantity;
          qcReturns += event.acceptedQuantity;
        }
        current.quantity += grnReceived + qcReturns;
        const channelWeights = product.strategy === 'PUSH_PULL'
          ? [0.36 + 0.08 * Math.sin(dayIndex), 0.35 - 0.08 * Math.sin(dayIndex), 0.19, 0.1]
          : [0.40, 0.30, 0.20, 0.10];
        let actualDemand = 0;
        let shipped = 0;
        let failed = 0;
        for (let channelIndex = 0; channelIndex < catalog.channels.length; channelIndex += 1) {
          const channel = catalog.channels[channelIndex];
          const saleMultiplier = megaSale ? (product.group === 'SEASONAL' ? 8 : product.group === 'B' ? 3.5 : 2) : 1;
          const fluctuation = product.group === 'A' ? 0.94 + random() * 0.12 : 0.75 + random() * 0.5;
          const quantity = Math.max(1, Math.round(product.baseDailyDemand * warehouse.demandShare
            * channelWeights[channelIndex] * saleMultiplier * fluctuation));
          const fulfilledQuantity = Math.min(quantity, current.quantity);
          current.quantity -= fulfilledQuantity;
          actualDemand += quantity;
          shipped += fulfilledQuantity;
          const online = channel !== 'POS';
          const targetRtsRate = online ? (megaSale ? 0.12 : 0.06) : 0;
          const failedQuantity = online ? Math.min(fulfilledQuantity, Math.floor(fulfilledQuantity * targetRtsRate + random())) : 0;
          failed += failedQuantity;
          const carrierId = !online ? null : channel === 'Shopee' || channel === 'TikTok Shop' ? 'GHN'
            : dayIndex % 3 === 0 ? 'AHAMOVE_2H' : dayIndex % 3 === 1 ? 'GHTK' : 'VTP';
          const lane = carrierId === 'AHAMOVE_2H' ? 'INTRACITY'
            : carrierId === 'VTP' && warehouse.id === 'WH-HCM' ? 'INTERREGIONAL' : 'REGIONAL';
          const destinationCity = lane === 'INTRACITY' ? warehouse.city : lane === 'INTERREGIONAL'
            ? 'Đà Nẵng' : (warehouse.id === 'WH-HCM' ? 'Đồng Nai' : 'Hải Phòng');
          const quote = online ? quoteShipping({ carrierId, lane, originCity: warehouse.city,
            destinationCity, weightGram: product.weightGram, volumeCm3: product.volumeCm3, distanceKm: 5 }) : null;
          const deliveryDate = online ? addDays(date, Math.floor(quote.slaHours / 24)) : date;
          const id = 'DEM-' + prefix + '-' + date + '-' + warehouse.id + '-' + product.sku + '-' + channelIndex;
          const row = { id, date, warehouseId: warehouse.id, sku: product.sku, channel, megaSale,
            actualDemand: quantity, fulfilledQuantity, stockoutQuantity: quantity - fulfilledQuantity,
            orderCount: fulfilledQuantity, carrierId, lane: online ? lane : null, originCity: warehouse.city,
            destinationCity: online ? destinationCity : warehouse.city, slaHours: quote ? quote.slaHours : 0,
            deliveryDate, deliveryStatus: deliveryDate <= endDate ? 'COMPLETED' : 'IN_TRANSIT',
            failedDeliveryQuantity: deliveryDate <= endDate ? failedQuantity : 0,
            plannedFailedDeliveryQuantity: failedQuantity,
            targetRtsRate, plannedRtsRate: fulfilledQuantity ? failedQuantity / fulfilledQuantity : 0,
            realizedRtsRate: fulfilledQuantity && deliveryDate <= endDate ? failedQuantity / fulfilledQuantity : 0,
            codOrders: 0, prepaidOrders: fulfilledQuantity, currency: 'VNĐ',
            unitPrice: product.sellingPrice, grossAmount: fulfilledQuantity * product.sellingPrice,
            shippingFee: quote ? quote.amount * fulfilledQuantity : 0,
            stockoutPenalty: (quantity - fulfilledQuantity) * product.stockoutPenaltyPerUnit };
          demand.push(row);
          if (failedQuantity > 0) {
            const returnedDate = addDays(deliveryDate, 3);
            const qcDate = addDays(returnedDate, 1);
            const accepted = Math.max(0, failedQuantity - (random() < 0.15 ? 1 : 0));
            const event = { id: 'RTS-' + id, demandId: id, warehouseId: warehouse.id, sku: product.sku,
              dispatchedDate: date, failedDeliveryDate: deliveryDate, returnedDate, qcDate,
              quantity: failedQuantity, plannedAcceptedQuantity: accepted, acceptedQuantity: 0, rejectedQuantity: 0,
              receivingBinId: location(warehouse, 'R'), quarantineBinId: location(warehouse, 'Q'),
              putawayBinId: location(warehouse, product.group === 'A' ? 'A' : 'B'),
              status: returnedDate <= endDate ? 'AWAITING_QC' : 'RETURN_IN_TRANSIT' };
            returns.push(event);
            const queueKey = qcDate + '/' + key;
            if (!returnQueue.has(queueKey)) returnQueue.set(queueKey, []);
            returnQueue.get(queueKey).push(event);
          }
        }
        current.recentDemand.push(actualDemand);
        const primary = catalog.suppliers.find(s => s.group === product.group && s.role === 'PRIMARY');
        const backup = catalog.suppliers.find(s => s.group === product.group && s.role === 'BACKUP');
        const outstanding = pending.filter(p => p.warehouseId === warehouse.id && p.sku === product.sku && p.status === 'OPEN');
        const baseline = product.baseDailyDemand * warehouse.demandShare;
        const recent = current.recentDemand.slice(-3);
        const observed = recent.reduce((total, n) => total + n, 0) / recent.length;
        const dailyRate = product.strategy === 'PUSH' ? baseline
          : product.strategy === 'PUSH_PULL' ? Math.max(baseline, observed) : observed;
        const position = current.quantity + sum(outstanding, 'quantity');
        const issuePo = (supplier, reason) => {
          current.poCount += 1;
          const isPrimary = supplier.role === 'PRIMARY';
          // First primary order per SKU/hub is delayed to exercise backup sourcing.
          const delayDays = isPrimary && current.poCount === 1 ? 3 : 0;
          const desired = isPrimary ? Math.max(product.eoq, Math.ceil(dailyRate * (supplier.leadTimeDays + 7) - position))
            : Math.ceil(dailyRate * (supplier.leadTimeDays + 3) - current.quantity);
          const quantity = Math.max(supplier.moq, Math.ceil(desired / supplier.moq) * supplier.moq);
          const unitCost = supplier.offers.find(o => o.sku === product.sku).unitCost;
          const promisedDate = addDays(date, supplier.leadTimeDays);
          const po = { id: 'PO-' + prefix + '-' + warehouse.id + '-' + product.sku + '-' + current.poCount,
            date, warehouseId: warehouse.id, sku: product.sku, supplierId: supplier.id, supplierRole: supplier.role,
            strategy: product.strategy, reason, quantity, moq: supplier.moq, unitCost, currency: 'VNĐ',
            totalCost: quantity * unitCost, leadTimeDays: supplier.leadTimeDays, promisedDate,
            expectedReceiptDate: addDays(promisedDate, delayDays), delayDays, actualReceiptDate: null,
            paymentTerms: supplier.paymentTerms, paymentDueDate: addDays(date, supplier.paymentDueDays), status: 'OPEN' };
          pending.push(po);
          purchaseOrders.push(po);
        };
        if (position <= dailyRate * (primary.leadTimeDays + 2) && !outstanding.some(p => p.supplierRole === 'PRIMARY')) {
          issuePo(primary, product.strategy === 'PULL' ? 'PULL_DEMAND_SIGNAL' : product.strategy === 'PUSH_PULL' ? 'MULTICHANNEL_REPLENISHMENT' : 'PUSH_REPLENISHMENT');
        }
        const latePrimary = outstanding.some(p => p.supplierRole === 'PRIMARY' && p.promisedDate <= date && p.expectedReceiptDate > date);
        if (!outstanding.some(p => p.supplierRole === 'BACKUP')
          && current.quantity < dailyRate * (backup.leadTimeDays + 2)
          && (latePrimary || megaSale || actualDemand > baseline * 1.3)) {
          issuePo(backup, latePrimary ? 'PRIMARY_DELAY' : 'DEMAND_SURGE');
        }
        inventory.push({ id: 'INV-' + prefix + '-' + date + '-' + warehouse.id + '-' + product.sku,
          date, warehouseId: warehouse.id, sku: product.sku, opening, grnReceived, qcReturns,
          salesIssued: shipped, closing: current.quantity, actualDemand, stockoutQuantity: actualDemand - shipped,
          plannedRtsQuantity: failed, currency: 'VNĐ', holdingCost: current.quantity * product.holdingCostPerDay });
      }
    }
  }

  // POS is prepaid. Allocate the 65% COD target over online one-unit orders.
  // Integer rounding is applied once globally, so error is at most half an order.
  const totalOrders = sum(demand, 'orderCount');
  const onlineOrders = sum(demand.filter(row => row.channel !== 'POS'), 'orderCount');
  const targetCodOrders = Math.round(totalOrders * 0.65);
  if (targetCodOrders > onlineOrders) throw new Error('Không đủ đơn online để phân bổ 65% COD');
  let onlineSoFar = 0;
  let codSoFar = 0;
  const codSettlements = [];
  for (const row of demand) {
    if (row.channel !== 'POS') {
      onlineSoFar += row.orderCount;
      const cumulativeCod = onlineOrders ? Math.round(onlineSoFar * targetCodOrders / onlineOrders) : 0;
      row.codOrders = cumulativeCod - codSoFar;
      codSoFar = cumulativeCod;
      row.prepaidOrders = row.orderCount - row.codOrders;
      const failedCod = row.orderCount ? Math.round(row.plannedFailedDeliveryQuantity * row.codOrders / row.orderCount) : 0;
      row.failedCodOrders = failedCod;
      row.failedPrepaidOrders = row.plannedFailedDeliveryQuantity - failedCod;
      const deliveredCod = row.codOrders - failedCod;
      if (deliveredCod > 0) {
        const carrier = catalog.carriers.find(c => c.id === row.carrierId);
        const settlementDate = addDays(row.deliveryDate, carrier.codSettlementDays);
        codSettlements.push({ id: 'COD-' + row.id, demandId: row.id, carrierId: row.carrierId,
          deliveryDate: row.deliveryDate, settlementDate, cycle: carrier.codCycle,
          orders: deliveredCod, amount: deliveredCod * row.unitPrice, currency: 'VNĐ',
          status: settlementDate <= endDate ? 'SETTLED' : 'PENDING' });
      }
    } else {
      row.failedCodOrders = 0;
      row.failedPrepaidOrders = 0;
    }
    row.codAmount = row.codOrders * row.unitPrice;
    row.prepaidAmount = row.prepaidOrders * row.unitPrice;
  }
  const dailyLogs = Array.from({ length: days }, (_, dayIndex) => {
    const date = addDays(startDate, dayIndex);
    const rows = demand.filter(row => row.date === date);
    const stocks = inventory.filter(row => row.date === date);
    return { id: 'DAY-' + prefix + '-' + date, date, dayNumber: dayIndex + 1,
      weekNumber: Math.floor(dayIndex / 7) + 1, megaSale: saleEvent(date),
      actualDemand: sum(rows, 'actualDemand'), orders: sum(rows, 'orderCount'),
      codOrders: sum(rows, 'codOrders'), prepaidOrders: sum(rows, 'prepaidOrders'),
      opening: sum(stocks, 'opening'), grnReceived: sum(stocks, 'grnReceived'),
      qcReturns: sum(stocks, 'qcReturns'), salesIssued: sum(stocks, 'salesIssued'), closing: sum(stocks, 'closing'),
      failedDeliveryQuantity: sum(demand.filter(row => row.deliveryDate === date), 'plannedFailedDeliveryQuantity'),
      rtsReceived: sum(returns.filter(row => row.returnedDate === date), 'quantity'),
      codSettledAmount: sum(codSettlements.filter(row => row.settlementDate === date), 'amount'), currency: 'VNĐ' };
  });
  return {
    metadata: { schemaVersion: 1, startDate, endDate, days, seed, currency: 'VNĐ', timezone: 'Asia/Ho_Chi_Minh',
      isSimulation: true, orderModel: 'ONE_UNIT_ORDERS_AGGREGATED_BY_DAY_HUB_SKU_CHANNEL',
      inventoryBasis: 'SELLABLE_STOCK', codTargetRate: 0.65, prepaidTargetRate: 0.35,
      totalOrders, codOrders: targetCodOrders, prepaidOrders: totalOrders - targetCodOrders,
      realizedCodRate: totalOrders ? targetCodOrders / totalOrders : 0,
      completeWeeks: 8, remainingDays: 4 },
    initialInventory, dailyLogs, demand, inventory, purchaseOrders, goodsReceipts, returns, codSettlements,
  };
}

module.exports = { generateTwoMonthOperationsLog, addDays };
