'use strict';
const { z } = require('zod');
const { createHash } = require('node:crypto');
const { buildVnSeedData, auditInventory } = require('./vnSeedData');
const { addDays } = require('./services/operations.service');
const { normalizeFinanceSources } = require('./services/finance-normalizer');
const { calculateEOQ, calculateROP } = require('./services/replenishment.service');
const { simulateSupplierDelay14Days, simulateDemandSurge50Percent } = require('./oms-logistics.service');
const money = z.number().int().nonnegative().max(1000000000000);
const policySchema = z.object({ initialCash: money.default(500000000), packingCostPerUnit: money.default(3000),
  repackCostPerUnit: money.default(2000), orderingCost: money.positive().default(200000),
  primaryNetDays: z.union([z.literal(15),z.literal(30)]).default(30),
  backupNetDays: z.union([z.literal(15),z.literal(30)]).default(15) }).strict();
const sum = (rows, field) => rows.reduce((n, r) => n + (r[field] || 0), 0);
const ratio = (a, b) => b ? a / b : null;
const elapsed = (a,b) => (Date.parse(b) - Date.parse(a)) / 86400000;
const PNL = ['grossRevenue','returnsValue','netRevenue','cogs','grossProfit','outboundFreight','returnFreight','holdingCost','packingCost','repackCost','writeOffCost','operatingProfit'];
const CASH = ['prepaidReceipts','codReceipts','refundsPaid','supplierDeposit','supplierBalance','cashExpenses'];

function calculateMetricsFinance({ dataset = buildVnSeedData(), demoSnapshot = null, policy: rawPolicy = {} } = {}) {
  auditInventory(dataset.catalog, dataset.operations);
  const policy = policySchema.parse(rawPolicy);
  const log = normalizeFinanceSources(dataset, demoSnapshot), catalog = dataset.catalog;
  const products = new Map(catalog.products.map(p => [p.sku,p]));
  const poMap = new Map(log.purchaseOrders.map(p=>[p.id,p]));
  const rows = new Map(log.demand.map(r=>[r.id,r]));
  const { startDate, endDate, days } = log.metadata;
  const daily = Array.from({length:days},(_,i)=>({date:addDays(startDate,i),
    ...Object.fromEntries([...PNL,...CASH].map(k=>[k,0])), inventoryValue:0, codReceivable:0, cashOpening:0,cashClosing:0}));
  const dayMap = new Map(daily.map(d=>[d.date,d])), journal = [], lots = new Map(), issued = new Map();
  const key = r => r.warehouseId + '/' + r.sku;
  const emit = (date, kind, amount, sourceId) => {
    if (!Number.isSafeInteger(amount) || amount < 0) throw new Error('Số tiền không hợp lệ: ' + kind);
    if (!amount || !date) return;
    journal.push({id:'FIN-'+(journal.length+1),date,kind,amount,sourceId,currency:'VNĐ'});
    if (dayMap.has(date)) dayMap.get(date)[kind] += amount;
  };
  const push = (k,quantity,unitCost) => { if (!lots.has(k)) lots.set(k,[]); if(quantity) lots.get(k).push({quantity,unitCost}); };
  const take = (k, quantity) => {
    const result = [];
    for (const lot of lots.get(k) || []) {
      const count = Math.min(quantity,lot.quantity);
      if (count) result.push({quantity:count,unitCost:lot.unitCost});
      quantity -= count; lot.quantity -= count;
    }
    if (quantity) throw new Error('FIFO thiếu hàng: '+k);
    return result;
  };
  const portion = (chunks, quantity, offset=0) => {
    const result=[];
    for(const lot of chunks) {
      const skipped=Math.min(offset,lot.quantity); offset-=skipped;
      const count=Math.min(quantity,lot.quantity-skipped);
      if(count)result.push({quantity:count,unitCost:lot.unitCost});
      quantity-=count;
    }
    if(quantity)throw new Error('Số lượng hoàn vượt giá vốn gốc');
    return result;
  };
  const cost = chunks => chunks.reduce((n,l)=>n+l.quantity*l.unitCost,0);
  for(const r of log.initialInventory)push(key(r),r.quantity,products.get(r.sku).unitCost);
  for(const po of log.purchaseOrders) {
    const supplier=catalog.suppliers.find(s=>s.id===po.supplierId);
    const deposit=Math.round(po.totalCost*0.3);
    emit(po.date,'supplierDeposit',deposit,po.id);
    emit(addDays(po.date,supplier.role==='PRIMARY'?policy.primaryNetDays:policy.backupNetDays),'supplierBalance',po.totalCost-deposit,po.id);
  }
  for(const cod of log.codSettlements)emit(cod.settlementDate,'codReceipts',cod.amount,cod.id);
  let cash=policy.initialCash, receivable=0;
  const newRevenue={value:0}, service={demand:sum(log.demand,'actualDemand'),shipped:sum(log.demand,'fulfilledQuantity'),resolved:0,delivered:0,onTime:0,returned:0,cycleWeighted:0};
  const inventoryDaily=[];
  for(const d of daily) {
    for(const g of log.goodsReceipts.filter(g=>g.date===d.date)) {
      const po=poMap.get(g.poId);
      if(!po)throw new Error('GRN thiếu PO');
      push(key(g),g.acceptedQuantity,po.unitCost);
      emit(d.date,'writeOffCost',(g.rejectedQuantity||0)*po.unitCost,g.id);
    }
    for(const ret of log.returns.filter(r=>r.qcDate===d.date && r.status==='QC_COMPLETED')) {
      const original=issued.get(ret.demandId);
      if(!original)throw new Error('Hàng hoàn chưa có lần xuất gốc');
      const accepted=portion(original,ret.acceptedQuantity);
      accepted.forEach(l=>push(key(ret),l.quantity,l.unitCost));
      emit(d.date,'writeOffCost',cost(portion(original,ret.rejectedQuantity,ret.acceptedQuantity)),ret.id);
      emit(d.date,'repackCost',ret.repackCost ?? ret.acceptedQuantity*policy.repackCostPerUnit,ret.id);
    }
    for(const r of log.demand.filter(r=>r.date===d.date)) {
      issued.set(r.id,take(key(r),r.fulfilledQuantity));
      emit(d.date,'outboundFreight',r.shippingFee,r.id);
      emit(d.date,'packingCost',r.fulfilledQuantity*policy.packingCostPerUnit,r.id);
      emit(d.date,'prepaidReceipts',r.prepaidAmount,r.id);
    }
    for(const r of log.demand.filter(r=>r.deliveryDate===d.date)) {
      const chunks=issued.get(r.id), failed=r.failedDeliveryQuantity, successful=r.fulfilledQuantity-failed;
      emit(d.date,'grossRevenue',r.grossAmount,r.id);
      emit(d.date,'returnsValue',failed*r.unitPrice,r.id);
      emit(d.date,'cogs',cost(chunks)-cost(portion(chunks,failed)),r.id);
      emit(d.date,'refundsPaid',r.failedPrepaidOrders*r.unitPrice,r.id);
      const goodCod=r.codOrders-(r.failedCodOrders ?? (failed ? r.codOrders:0));
      receivable+=goodCod*r.unitPrice;
      service.resolved+=r.fulfilledQuantity; service.delivered+=successful; service.returned+=failed;
      // Seed delivery dates equal modeled SLA; demo carries actual deliverySlaMet.
      const onTime=r.deliveredOnTime ?? (elapsed(r.date,r.deliveryDate)*24<=r.slaHours);
      if(onTime)service.onTime+=successful;
      service.cycleWeighted+=successful*elapsed(r.date,r.deliveryDate);
      if(products.get(r.sku).group==='SEASONAL')newRevenue.value+=successful*r.unitPrice;
    }
    for(const ret of log.returns.filter(r=>r.returnedDate===d.date)) {
      const r=rows.get(ret.demandId);
      const rate=['GHN','GHTK'].includes(r.carrierId)?0.5:1;
      const fee=ret.returnFreightCost ?? Math.ceil((r.fulfilledQuantity?r.shippingFee/r.fulfilledQuantity:0)*ret.quantity*rate);
      emit(d.date,'returnFreight',fee,ret.id);
      if(ret.customerReturn) {
        emit(d.date,'returnsValue',ret.quantity*r.unitPrice,ret.id);
        emit(d.date,'refundsPaid',ret.quantity*r.unitPrice,ret.id);
        // Reverse original COGS; defective units are recognized separately as write-off.
        d.cogs-=cost(portion(issued.get(r.id),ret.quantity));
        journal.push({id:'FIN-'+(journal.length+1),date:d.date,kind:'cogs',amount:-cost(portion(issued.get(r.id),ret.quantity)),sourceId:ret.id,currency:'VNĐ'});
        service.returned+=ret.quantity;
        if(products.get(r.sku).group==='SEASONAL')newRevenue.value-=ret.quantity*r.unitPrice;
      }
    }
    for(const [k,batches] of lots) {
      const quantity=sum(batches,'quantity'), value=cost(batches), sku=k.split('/')[1];
      d.inventoryValue+=value;
      emit(d.date,'holdingCost',quantity*products.get(sku).holdingCostPerDay,k);
      inventoryDaily.push({date:d.date,warehouseId:k.split('/')[0],sku,quantity,value,currency:'VNĐ'});
    }
    d.netRevenue=d.grossRevenue-d.returnsValue;
    d.grossProfit=d.netRevenue-d.cogs;
    d.operatingProfit=d.grossProfit-d.outboundFreight-d.returnFreight-d.holdingCost-d.packingCost-d.repackCost-d.writeOffCost;
    d.cashExpenses=d.outboundFreight+d.returnFreight+d.holdingCost+d.packingCost+d.repackCost;
    receivable-=d.codReceipts; d.codReceivable=receivable;
    if(receivable<0)throw new Error('Đối soát COD vượt khoản thu hộ');
    d.cashOpening=cash;
    cash+=d.prepaidReceipts+d.codReceipts-d.refundsPaid-d.supplierDeposit-d.supplierBalance-d.cashExpenses;
    d.cashClosing=cash;
  }
  const periods=Array.from({length:9},(_,i)=>{
    const slice=daily.slice(i*7,Math.min((i+1)*7,60));
    return {period:i+1,label:i===8?'4 ngày cuối kỳ':'Tuần '+(i+1),startDate:slice[0].date,endDate:slice.at(-1).date,days:slice.length,
      ...Object.fromEntries([...PNL,...CASH].map(k=>[k,sum(slice,k)])),cashOpening:slice[0].cashOpening,cashClosing:slice.at(-1).cashClosing};
  });
  const pnl=Object.fromEntries(PNL.map(k=>[k,sum(daily,k)]));
  const avgInventory=sum(daily,'inventoryValue')/days, avgReceivable=sum(daily,'codReceivable')/days;
  const scenarios={delay:simulateSupplierDelay14Days(),surge:simulateDemandSurge50Percent()};
  const peak=scenarios.surge.after.ledger.filter(r=>r.day<=14);
  const baselinePeak=scenarios.surge.before.ledger.filter(r=>r.day<=14);
  const manufacturingDays=log.goodsReceipts.filter(g=>g.acceptedQuantity>0).map(g=>elapsed(poMap.get(g.poId).date,g.date));
  const kpis={
    customerService:{otifPercent:ratio(service.onTime,service.resolved)===null?null:100*service.onTime/service.resolved,
      orderFillRatePercent:100*(ratio(service.shipped,service.demand)||0),orderCycleTimeDays:ratio(service.cycleWeighted,service.delivered),
      returnRtsRatePercent:service.resolved?100*service.returned/service.resolved:null,resolvedUnits:service.resolved,pendingUnits:service.shipped-service.resolved},
    internalEfficiency:{averageInventoryValue:avgInventory,inventoryTurnover:ratio(pnl.cogs,avgInventory),
      daysOfInventory:pnl.cogs?days*avgInventory/pnl.cogs:null,
      logisticsCostToRevenuePercent:pnl.netRevenue?100*(pnl.outboundFreight+pnl.returnFreight+pnl.holdingCost+pnl.packingCost+pnl.repackCost)/pnl.netRevenue:null,
      grossMarginPercent:pnl.netRevenue?100*pnl.grossProfit/pnl.netRevenue:null,
      operatingAssetReturnPercent:avgInventory+avgReceivable?100*pnl.operatingProfit/(avgInventory+avgReceivable):null,
      roaPercent:null},
    demandFlexibility:{responseDays:Math.min(...scenarios.surge.responsePlan.purchaseOrders.filter(p=>p.supplierRole==='BACKUP').map(p=>p.arrivalDay)),
      additionalUnits14Days:sum(peak,'sold')-sum(scenarios.surge.after.ledger.filter(r=>r.day>14),'demand'),
      recoveredUnits14Days:sum(peak,'sold')-sum(baselinePeak,'sold'),peakDispatchSlaPercent:scenarios.surge.peakSlaRate*100,
      feasible:scenarios.surge.feasible},
    productDevelopment:{seasonalRevenue:newRevenue.value,seasonalRevenueSharePercent:pnl.netRevenue?100*newRevenue.value/pnl.netRevenue:null,
      timeToMarketDays:null,poToShelfDays:manufacturingDays.length?manufacturingDays.reduce((a,b)=>a+b,0)/manufacturingDays.length:null},
  };
  const eoqRop=catalog.products.map(p=>({sku:p.sku,annualDemand:p.baseDailyDemand*365,orderingCost:policy.orderingCost,
    holdingCostPerUnitPerYear:p.holdingCostPerDay*365,moq:p.moq,leadTimeDays:catalog.suppliers.find(s=>s.group===p.group&&s.role==='PRIMARY').leadTimeDays,
    dailyDemand:p.baseDailyDemand,safetyStock:p.baseDailyDemand*3,
    eoq:calculateEOQ({annualDemand:p.baseDailyDemand*365,orderingCost:policy.orderingCost,holdingCostPerUnitPerYear:p.holdingCostPerDay*365,moq:p.moq}).orderQty,
    rop:calculateROP({dailyDemand:p.baseDailyDemand,leadTimeDays:catalog.suppliers.find(s=>s.group===p.group&&s.role==='PRIMARY').leadTimeDays,safetyStock:p.baseDailyDemand*3})}));
  const report={metadata:{...log.metadata,periodConvention:'8_WEEKS_PLUS_4_DAYS',revenueRecognition:'DELIVERY',costMethod:'FIFO',
      cashBasis:'SIMULATED_CONTRACT_SCHEDULE',currency:'VNĐ'},policy,pnl,periods,daily,kpis,eoqRop,journal,inventoryDaily,
    cashFlow:{openingCash:policy.initialCash,closingCash:cash,...Object.fromEntries(CASH.map(k=>[k,sum(daily,k)])),
      codReceivable:daily.at(-1).codReceivable,supplierPaymentsAfterPeriod:sum(journal.filter(j=>j.date>endDate&&['supplierDeposit','supplierBalance'].includes(j.kind)),'amount')},
    sources:log,scenarios,
    notes:['8 tuần = 56 ngày; 4 ngày cuối kỳ hiển thị riêng, tổng báo cáo đủ 60 ngày.',
      'Ghi nhận doanh thu khi hoàn tất giao; đơn còn trên đường chưa ghi doanh thu/COGS. Giá vốn FIFO gồm giá NCC dự phòng.',
      'Đặt cọc 30% ngày PO, 70% Net 30 NCC chính / Net 15 dự phòng từ ngày PO: chính sách mô phỏng Phần 4 thay điều khoản cũ.',
      'Chi phí đóng gói/tân trang lấy từ chính sách hoặc chứng từ. Chi tiền vận hành và hoàn prepaid giả định vào ngày phát sinh.',
      'OTIF mẫu số là đơn đã có kết quả giao; fill rate là xuất/cầu. Đơn mô phỏng một đơn vị; demo cũng quy đổi về đơn vị.',
      'ROA thực và Time-to-Market chưa có tổng tài sản/mốc bắt đầu phát triển; hiển thị chưa đủ dữ liệu. PO-to-shelf là chỉ số thay thế riêng.',
      'Khả năng tăng thêm là kết quả kịch bản +50% theo nguồn lực đã cấu hình, không phải trần sản xuất đã tối ưu.',
      'Tồn bình quân gồm hàng khả dụng, không gồm hàng đi đường/QC. Operating asset return dùng tồn khả dụng + COD phải thu, không phải ROA kế toán.']};
  report.reportId=createHash('sha256').update(JSON.stringify(report)).digest('hex').slice(0,16);
  return report;
}
module.exports={calculateMetricsFinance,PNL,CASH};
