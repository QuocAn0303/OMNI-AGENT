'use strict';
const { createCatalog } = require('../data/catalog');
const { addDays } = require('./operations.service');

/** Convert real demo OMS/WMS documents to the same transaction grain as the 60-day seed. */
function normalizeFinanceSources(dataset, demo) {
  const log = structuredClone(dataset.operations);
  if (!demo) return log;
  const catalog = createCatalog(), date = timestamp => timestamp?.slice(0, 10);
  const products = new Map(catalog.products.map(p => [p.sku, p]));
  for (const po of demo.purchaseOrders) for (const item of po.items) {
    const unitCost = catalog.suppliers.find(s => s.id === po.supplierId).offers.find(o => o.sku === item.sku).unitCost;
    log.purchaseOrders.push({ id: 'LIVE-' + po.poId + '-' + item.sku, date: date(po.history[0].at), sku: item.sku,
      warehouseId: po.warehouseId, supplierId: po.supplierId, quantity: item.quantity, unitCost, totalCost: unitCost * item.quantity });
  }
  for (const receipt of demo.wms.receipts.filter(r => r.sourceType === 'PO')) for (const line of receipt.items) {
    const shipment = demo.wms.shipments.find(s => s.shipmentId === receipt.shipmentId);
    const po = log.purchaseOrders.find(p => p.id === 'LIVE-' + shipment.sourceId + '-' + line.sku);
    const history = demo.purchaseOrders.find(p => p.poId === shipment.sourceId).history;
    const qc = history.find(h => h.status === 'QC_COMPLETED');
    // QC losses are recognized on inspection, even if no units ever reach a shelf.
    if (qc) log.goodsReceipts.push({ id: 'LIVE-' + receipt.receiptId + '-' + line.sku + '-QC', poId: po.id,
      date: date(qc.at), sku: line.sku, warehouseId: receipt.warehouseId,
      acceptedQuantity: 0, receivedQuantity: line.receivedQty, rejectedQuantity: line.defectQty });
    if (line.putawayQty) log.goodsReceipts.push({ id: 'LIVE-' + receipt.receiptId + '-' + line.sku, poId: po.id,
      date: date(history.find(h => h.status === 'PUTAWAY_DONE').at),
      sku: line.sku, warehouseId: receipt.warehouseId, acceptedQuantity: line.putawayQty, receivedQuantity: 0,
      rejectedQuantity: 0 });
  }
  for (const f of demo.fulfillments.filter(f => f.shippedAt)) {
    const order = demo.orders.find(o => o.orderId === f.orderId);
    const failed = f.attempts.length === 3 && f.attempts.every(a => a.outcome === 'FAILED');
    const resultDate = f.deliveredAt || (failed ? f.attempts[2].at : null);
    const totalUnits = f.items.reduce((n, i) => n + i.quantity, 0);
    let remainingFee = f.package.quote.amount;
    for (let index = 0; index < f.items.length; index++) {
      const item = f.items[index], p = products.get(item.sku), id = 'LIVE-' + f.fulfillmentId + '-' + item.sku;
      const shippingFee = index === f.items.length - 1 ? remainingFee : Math.floor(f.package.quote.amount * item.quantity / totalUnits);
      remainingFee -= shippingFee;
      const ret = demo.returnOrders.find(r => r.fulfillmentId === f.fulfillmentId);
      log.demand.push({ id, date: date(f.shippedAt), sku: item.sku, warehouseId: f.warehouseId, channel: order.channel,
        actualDemand: item.quantity, fulfilledQuantity: item.quantity, orderCount: item.quantity,
        unitPrice: p.sellingPrice, grossAmount: item.quantity * p.sellingPrice, shippingFee,
        deliveryDate: date(resultDate) || null, slaHours: f.package.quote.slaHours,
        deliveredOnTime: f.deliverySlaMet ?? false, failedDeliveryQuantity: failed ? item.quantity : 0,
        plannedFailedDeliveryQuantity: failed ? item.quantity : 0,
        codOrders: order.paymentMethod === 'COD' ? item.quantity : 0,
        prepaidOrders: order.paymentMethod === 'Prepaid' ? item.quantity : 0,
        prepaidAmount: order.paymentMethod === 'Prepaid' ? item.quantity * p.sellingPrice : 0,
        failedPrepaidOrders: failed && order.paymentMethod === 'Prepaid' ? item.quantity : 0,
        carrierId: f.package.carrierId, customerReturn: !!ret && !failed });
      if (f.codSettlement) log.codSettlements.push({ id: 'COD-' + id, demandId: id,
        settlementDate: date(f.codSettlement.dueAt), amount: item.quantity * p.sellingPrice });
      if (ret) {
        const grade = ret.grades?.find(g => g.sku === item.sku);
        log.returns.push({ id: 'RET-' + id, demandId: id, warehouseId: f.warehouseId, sku: item.sku,
          quantity: item.quantity, failedDeliveryDate: date(resultDate), returnedDate: date(ret.receivedAt) || null,
          qcDate: date(ret.receivedAt) || null, acceptedQuantity: grade ? grade.aQty + grade.bQty : 0,
          rejectedQuantity: grade?.cQty || 0, repackCost: grade ? Math.round(ret.repackCost * grade.bQty / (ret.grades.reduce((n,g)=>n+g.bQty,0) || 1)) : 0,
          returnFreightCost: Math.round(ret.returnFreightCost * item.quantity / totalUnits),
          status: ret.status === 'QC_COMPLETED' ? 'QC_COMPLETED' : 'RETURN_IN_TRANSIT',
          customerReturn: !failed, refundDate: date(ret.receivedAt) || null });
      }
    }
  }
  return log;
}
module.exports = { normalizeFinanceSources };
