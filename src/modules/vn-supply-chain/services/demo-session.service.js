'use strict';
const { z } = require('zod');
const { randomUUID } = require('node:crypto');
const { createOmsLogisticsService } = require('../oms-logistics.service');
const { calculateMetricsFinance } = require('../metrics-finance.service');
const { buildVnSeedData } = require('../vnSeedData');
function createDemoSession() {
  let time='2026-12-18T02:00:00Z', stage=0, received=false, revision=0;
  const id=randomUUID(), dataset=buildVnSeedData();
  const oms=createOmsLogisticsService({clock:()=>time});
  const histories=[];
  let report;
  const currentReport=()=>report || (report=calculateMetricsFinance({dataset,demoSnapshot:oms.getSnapshot()}));
  function snapshot() {
    const state=oms.getSnapshot();
    return {sessionId:id,revision,stage,received,asOf:time,inventory:state.wms.inventory,
      orders:state.orders,fulfillments:state.fulfillments,returns:state.returnOrders,
      transitions:histories,report:currentReport()};
  }
  function advance(input) {
    const {step,phase}=z.object({step:z.number().int().min(1).max(5),
      phase:z.enum(['receive','putaway']).optional()}).strict().parse(input);
    if(step<=stage)return snapshot(); // Retrying a completed button is idempotent.
    if(step!==stage+1)throw Object.assign(new Error('Hãy hoàn tất bước trước'),{status:409});
    if(step!==1 && phase)throw Object.assign(new Error('phase chỉ dùng cho bước 1'),{status:400});
    if(step===1) {
      if(!received) {
        oms.createInboundPo({requestId:'demo-po',poId:'DEMO-PO',supplierId:'SUP-B-PRIMARY',warehouseId:'WH-HN',
          promisedAt:'2026-12-20T02:00:00Z',items:[{sku:'VN-B-001',quantity:200}]});
        for(const status of ['SUPPLIER_PRODUCTION','IN_TRANSIT_INBOUND'])oms.advanceInboundPo({requestId:status,poId:'DEMO-PO',status});
        time='2026-12-20T02:00:00Z';
        oms.advanceInboundPo({requestId:'dock',poId:'DEMO-PO',status:'ARRIVED_AT_DOCK'});
        histories.push({label:'GRN vào khu Q',inventory:oms.getSnapshot().wms.inventory});
        oms.advanceInboundPo({requestId:'qc',poId:'DEMO-PO',status:'QC_COMPLETED',qcResults:[{sku:'VN-B-001',passQty:198,defectQty:2}]});
        received=true;
      }
      if(phase==='putaway') {oms.advanceInboundPo({requestId:'put',poId:'DEMO-PO',status:'PUTAWAY_DONE'});stage=1;}
    } else if(step===2) {
      ['Shopee','TikTok Shop','Website'].forEach((channel,index)=>{
        const orderId='DEMO-'+index;
        oms.createOutboundOrder({requestId:'create-'+index,orderId,channel,region:'MIEN_BAC',destinationCity:'Hà Nội',
          paymentMethod:channel==='Website'?'Prepaid':'COD',dispatchDeadlineAt:'2026-12-21T02:00:00Z',items:[{sku:'VN-B-001',quantity:3}]});
        oms.routeOrderToOptimalHub({requestId:'route-'+index,orderId});
      });stage=2;
    } else if(step===3) {
      for(const f of oms.getSnapshot().fulfillments) {
        oms.pickFulfillment({requestId:'pick-'+f.fulfillmentId,fulfillmentId:f.fulfillmentId});
        oms.packFulfillment({requestId:'pack-'+f.fulfillmentId,fulfillmentId:f.fulfillmentId,
          carrierId:f.orderId==='DEMO-1'?'GHTK':'GHN',lane:'INTRACITY',measuredWeightGram:1290,measuredVolumeCm3:3600});
        oms.shipFulfillment({requestId:'ship-'+f.fulfillmentId,fulfillmentId:f.fulfillmentId});
      }stage=3;
    } else if(step===4) {
      time='2026-12-21T02:00:00Z';
      for(const f of oms.getSnapshot().fulfillments.filter(f=>f.orderId!=='DEMO-0'))
        oms.recordDeliveryAttempt({requestId:'delivered-'+f.fulfillmentId,fulfillmentId:f.fulfillmentId,attemptNumber:1,outcome:'DELIVERED'});
      for(let n=1;n<=3;n++) {
        time='2026-12-'+(20+n)+'T02:00:00Z';
        oms.recordDeliveryAttempt({requestId:'failure-'+n,fulfillmentId:'DEMO-0-F1',attemptNumber:n,outcome:'FAILED'});
      }
      time='2026-12-27T02:00:00Z';
      oms.processReturnedPackage({requestId:'return',returnId:'RTS-DEMO-0-F1',grades:[{sku:'VN-B-001',aQty:1,bQty:1,cQty:1}],repackCostPerUnit:5000});
      stage=4;
    } else stage=5;
    revision++; report=null;
    histories.push({label:'Bước '+step+(step===1&&stage===0?' · QC chờ lên kệ':''),inventory:oms.getSnapshot().wms.inventory});
    return snapshot();
  }
  return {snapshot,advance};
}
module.exports={createDemoSession};
