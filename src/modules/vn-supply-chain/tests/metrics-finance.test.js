'use strict';
jest.setTimeout(60000);
const http=require('node:http');
const express=require('express');
const ExcelJS=require('exceljs');
const {calculateMetricsFinance,PNL,CASH}=require('../metrics-finance.service');
const {buildVnSeedData}=require('../vnSeedData');
const {exportSpreadsheetData,spreadsheetTables}=require('../services/spreadsheet-export.service');
const createRouter=require('../vn-supply-chain.routes');
const {createDemoSession}=require('../services/demo-session.service');
const dataset=buildVnSeedData(), report=calculateMetricsFinance({dataset});
const sum=(rows,field)=>rows.reduce((n,r)=>n+(r[field]||0),0);
describe('Tài chính 60 ngày: nguồn và đối chiếu',()=>{
  test('đủ 8 tuần + 4 ngày; daily/period/tổng PnL khớp tuyệt đối',()=>{
    expect(report.periods.map(p=>p.days)).toEqual([7,7,7,7,7,7,7,7,4]);
    expect(report.daily).toHaveLength(60);
    for(const field of PNL){
      expect(sum(report.periods,field)).toBe(report.pnl[field]);
      expect(sum(report.daily,field)).toBe(report.pnl[field]);
    }
    for(const d of report.daily){
      expect(d.netRevenue).toBe(d.grossRevenue-d.returnsValue);
      expect(d.grossProfit).toBe(d.netRevenue-d.cogs);
      expect(d.operatingProfit).toBe(d.grossProfit-d.outboundFreight-d.returnFreight-d.holdingCost-d.packingCost-d.repackCost-d.writeOffCost);
    }
  });
  test('doanh thu từ kết quả giao trong kỳ, không đọc kết quả tương lai',()=>{
    const delivered=dataset.operations.demand.filter(r=>r.deliveryDate<=report.metadata.endDate);
    expect(report.pnl.grossRevenue).toBe(sum(delivered,'grossAmount'));
    expect(report.pnl.returnsValue).toBe(delivered.reduce((n,r)=>n+r.failedDeliveryQuantity*r.unitPrice,0));
    const pending=dataset.operations.demand.filter(r=>r.deliveryDate>report.metadata.endDate);
    expect(report.kpis.customerService.pendingUnits).toBe(sum(pending,'fulfilledQuantity'));
    expect(report.pnl.grossRevenue).toBeLessThan(sum(dataset.operations.demand,'grossAmount'));
  });
  test('COD T+3/T+5 và tiền cuối kỳ khớp nguồn, không ghi thu hộ thất bại',()=>{
    const eligible=dataset.operations.codSettlements.filter(r=>r.settlementDate<=report.metadata.endDate);
    expect(report.cashFlow.codReceipts).toBe(sum(eligible,'amount'));
    let balance=report.policy.initialCash;
    for(const period of report.periods){
      expect(period.cashOpening).toBe(balance);
      balance+=period.prepaidReceipts+period.codReceipts-period.refundsPaid-period.supplierDeposit-period.supplierBalance-period.cashExpenses;
      expect(period.cashClosing).toBe(balance);
    }
    expect(report.cashFlow.closingCash).toBe(balance);
    for(const field of CASH)expect(sum(report.periods,field)).toBe(report.cashFlow[field]);
  });
  test('cọc 30%, balance 70% theo Net 15/30; chưa đến hạn không xuất tiền',()=>{
    for(const po of dataset.operations.purchaseOrders){
      const entries=report.journal.filter(j=>j.sourceId===po.id&&j.kind.startsWith('supplier'));
      expect(entries).toHaveLength(2);
      expect(sum(entries,'amount')).toBe(po.totalCost);
      expect(entries.find(e=>e.kind==='supplierDeposit').amount).toBe(Math.round(po.totalCost*0.3));
      const expectedDays=po.supplierRole==='PRIMARY'?30:15;
      expect((Date.parse(entries[1].date)-Date.parse(po.date))/86400000).toBe(expectedDays);
    }
    expect(report.cashFlow.supplierPaymentsAfterPeriod).toBeGreaterThan(0);
  });
  test('FIFO nhận giá NCC dự phòng; đối chiếu lượng tồn và chi phí giữ hàng với từng dòng nguồn',()=>{
    for(const row of dataset.operations.inventory){
      const actual=report.inventoryDaily.find(r=>r.date===row.date&&r.sku===row.sku&&r.warehouseId===row.warehouseId);
      expect(actual.quantity).toBe(row.closing);
    }
    expect(report.pnl.holdingCost).toBe(sum(dataset.operations.inventory,'holdingCost'));
    const altered=structuredClone(dataset);
    const backup=altered.catalog.suppliers.find(s=>s.role==='BACKUP');
    for(const offer of backup.offers)offer.unitCost+=1000;
    for(const po of altered.operations.purchaseOrders.filter(p=>p.supplierId===backup.id)){
      po.unitCost+=1000;po.totalCost=po.unitCost*po.quantity;
      for(const g of altered.operations.goodsReceipts.filter(g=>g.poId===po.id))g.amount=po.totalCost;
    }
    const result=calculateMetricsFinance({dataset:altered});
    expect(result.pnl.cogs).toBeGreaterThan(report.pnl.cogs);
    expect(result.cashFlow.supplierDeposit).toBeGreaterThan(report.cashFlow.supplierDeposit);
  });
  test('KPI lấy cùng PnL và nguồn; thiếu dữ liệu không giả thành 0',()=>{
    expect(report.kpis.internalEfficiency.grossMarginPercent).toBe(report.pnl.grossProfit/report.pnl.netRevenue*100);
    expect(report.kpis.internalEfficiency.roaPercent).toBeNull();
    expect(report.kpis.productDevelopment.timeToMarketDays).toBeNull();
    expect(report.kpis.demandFlexibility.additionalUnits14Days).toBe(700);
    expect(report.kpis.demandFlexibility.recoveredUnits14Days).toBe(1200);
  });
  test('chính sách sai và dữ liệu tồn mất cân bằng bị từ chối',()=>{
    expect(()=>calculateMetricsFinance({policy:{packingCostPerUnit:-1}})).toThrow();
    expect(()=>calculateMetricsFinance({policy:{primaryNetDays:7}})).toThrow();
    const bad=structuredClone(dataset);bad.operations.inventory[0].closing++;
    expect(()=>calculateMetricsFinance({dataset:bad})).toThrow();
  });
});
describe('Xuất bảng tính',()=>{
  test('JSON và CSV chứa cùng reportId và toàn bộ nguồn 60 ngày',async()=>{
    const json=await exportSpreadsheetData(report,'json');
    expect(JSON.parse(json.data.toString())).toEqual(report);
    const csv=await exportSpreadsheetData(report,'csv');
    expect(csv.data.toString()).toContain(report.reportId);
    expect(csv.data.toString()).toContain(report.sources.demand.at(-1).id);
    expect(csv.data.toString()).toContain('"PnL"');
    await expect(exportSpreadsheetData(report,'pdf')).rejects.toThrow();
  });
  test('XLSX mở được, công thức PnL/cash/EOQ có kết quả cache chính xác',async()=>{
    const result=await exportSpreadsheetData(report,'xlsx');
    const wb=new ExcelJS.Workbook();await wb.xlsx.load(result.data);
    const tables=spreadsheetTables(report);
    for(const [name,rows] of Object.entries(tables)){
      const sheet=wb.getWorksheet(name.slice(0,31));
      expect(sheet).toBeDefined();expect(sheet.rowCount).toBe(rows.length+1);
      const keys=[...new Set(rows.flatMap(r=>Object.keys(r)))];
      rows.forEach((row,i)=>keys.forEach((key,j)=>{
        const cell=sheet.getCell(i+2,j+1);
        if(cell.value?.formula)expect(cell.value.result).toBe(row[key]);
        else if(typeof row[key]==='number')expect(cell.value).toBe(row[key]);
      }));
    }
    expect(wb.getWorksheet('EOQ_ROP').getRow(2).values.some(v=>v?.formula?.includes('SQRT'))).toBe(true);
    expect(wb.getWorksheet('PnL').getCell('G2').value.formula).toBeDefined();
  });
});
describe('E2E HTTP: Nhập → Đơn → Xuất → Hoàn → KPI và xuất dữ liệu',()=>{
  let server;
  beforeAll(async()=>{
    const app=express();app.use(express.json());
    app.use('/api/vn-supply-chain',createRouter({
      auth:{authenticate:(req,res,next)=>{if(!req.headers['x-user'])return res.sendStatus(401);
        req.user={id:req.headers['x-user'],tenantId:req.headers['x-tenant']||'tenant-a',role:req.headers['x-role']||'ADMIN'};next();},
        authorize:(...roles)=>(req,res,next)=>roles.includes(req.user.role)?next():res.sendStatus(403)},
      response:{success:(res,data)=>res.json({success:true,data})},
    }));
    app.use((error,req,res,next)=>res.status(error.status||(error.name==='ZodError'?400:500)).json({message:error.message}));
    server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  });
  afterAll(()=>new Promise(resolve=>server.close(resolve)));
  const request=(path,body,headers={})=>new Promise((resolve,reject)=>{
    const payload=body?JSON.stringify(body):null;
    const req=http.request({host:'127.0.0.1',port:server.address().port,path:'/api/vn-supply-chain'+path,method:payload?'POST':'GET',
      headers:{'x-user':'alice',...headers,...(payload?{'content-type':'application/json','content-length':Buffer.byteLength(payload)}:{})}},
      res=>{const chunks=[];res.on('data',d=>chunks.push(d));res.on('end',()=>{
        const data=Buffer.concat(chunks);resolve({status:res.statusCode,headers:res.headers,raw:data,
          body:res.headers['content-type']?.includes('application/json')?JSON.parse(data):null});
      });});req.on('error',reject);req.end(payload);
  });
  test('chạy 5 bước thật qua Express/OMS/WMS; API = báo cáo = JSON = XLSX',async()=>{
    const baseline=(await request('/demo')).body.data;
    let result=await request('/demo/step',{step:1,phase:'receive'});
    expect(result.status).toBe(200);expect(sum(result.body.data.inventory,'quarantineQty')).toBe(200);
    result=await request('/demo/step',{step:1,phase:'putaway'});
    expect(sum(result.body.data.inventory,'atpQty')).toBe(198);
    result=await request('/demo/step',{step:2});
    expect(sum(result.body.data.inventory,'reservedQty')).toBe(9);
    result=await request('/demo/step',{step:3});
    expect(sum(result.body.data.inventory,'onHandQty')).toBe(189);
    expect(result.body.data.fulfillments.every(f=>f.package.trackingNumber)).toBe(true);
    result=await request('/demo/step',{step:4});
    expect(sum(result.body.data.inventory,'onHandQty')).toBe(191);
    expect(sum(result.body.data.inventory,'quarantineQty')).toBe(3);
    const final=(await request('/demo/step',{step:5})).body.data;
    expect(final.report.pnl.netRevenue-baseline.report.pnl.netRevenue).toBe(6*149000);
    const metrics=(await request('/metrics')).body.data;
    expect(metrics).toEqual(final.report);
    const json=await request('/export?format=json&reportId='+metrics.reportId);
    expect(json.body).toEqual(metrics);
    const excel=await request('/export?format=xlsx&reportId='+metrics.reportId);
    expect(excel.headers['x-report-id']).toBe(metrics.reportId);
    const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(excel.raw);
    expect(workbook.getWorksheet('Summary').getRow(2).values).toContain(metrics.pnl.operatingProfit);
    const repeated=(await request('/demo/step',{step:4})).body.data;
    expect(repeated.report.reportId).toBe(metrics.reportId);
    expect((await request('/export?format=json&reportId='+baseline.report.reportId)).status).toBe(409);
    const scenario=(await request('/scenarios',{scenario:'surge'})).body.data;
    expect(scenario.reportId).toBe(metrics.reportId);
    expect(scenario.after.audit.difference).toBe(0);
  },30000);
  test('phân quyền, tenant/user isolation, thứ tự bước và định dạng xuất',async()=>{
    expect((await request('/demo',null,{'x-user':''})).status).toBe(401);
    expect((await request('/demo',null,{'x-role':'CASHIER'})).status).toBe(403);
    const another=await request('/demo',null,{'x-tenant':'tenant-b'});
    expect(another.body.data.stage).toBe(0);
    expect((await request('/demo/step',{step:3},{'x-tenant':'tenant-b'})).status).toBe(409);
    expect((await request('/demo/step',{step:-1})).status).toBe(400);
    expect((await request('/export?format=pdf')).status).toBe(400);
    const bob=(await request('/demo',null,{'x-user':'bob'})).body.data;
    expect(bob.stage).toBe(0);
  });
});


describe('Hồi quy QC độc lập với lên kệ', () => {
  test.each([200, 2])('ghi nhận %i hàng lỗi ngay ngày QC và không ghi hai lần', defectQty => {
    const { createOmsLogisticsService } = require('../oms-logistics.service');
    let time = '2026-12-18T02:00:00Z';
    const oms = createOmsLogisticsService({ clock: () => time });
    const sku = 'VN-B-001';
    oms.createInboundPo({ requestId: 'po', poId: 'QC-PO', supplierId: 'SUP-B-PRIMARY', warehouseId: 'WH-HN',
      promisedAt: '2026-12-20T02:00:00Z', items: [{ sku, quantity: 200 }] });
    const advance = (status, qcResults) => oms.advanceInboundPo({ requestId: status, poId: 'QC-PO', status,
      ...(qcResults ? { qcResults } : {}) });
    advance('SUPPLIER_PRODUCTION');advance('IN_TRANSIT_INBOUND');
    time = '2026-12-20T02:00:00Z';advance('ARRIVED_AT_DOCK');
    expect(calculateMetricsFinance({ dataset, demoSnapshot: oms.getSnapshot() }).pnl.writeOffCost).toBe(report.pnl.writeOffCost);
    advance('QC_COMPLETED', [{ sku, passQty: 200 - defectQty, defectQty }]);
    const unitCost = dataset.catalog.suppliers.find(s => s.id === 'SUP-B-PRIMARY').offers.find(o => o.sku === sku).unitCost;
    const before = calculateMetricsFinance({ dataset, demoSnapshot: oms.getSnapshot() });
    expect(before.pnl.writeOffCost - report.pnl.writeOffCost).toBe(defectQty * unitCost);
    expect(before.kpis.productDevelopment.poToShelfDays).toBe(report.kpis.productDevelopment.poToShelfDays);
    const loss = before.journal.filter(j => j.kind === 'writeOffCost' && j.sourceId.includes('QC-PO'));
    expect(loss).toHaveLength(1);expect(loss[0].date).toBe('2026-12-20');
    time = '2026-12-21T02:00:00Z';advance('PUTAWAY_DONE');
    const after = calculateMetricsFinance({ dataset, demoSnapshot: oms.getSnapshot() });
    expect(after.pnl.writeOffCost).toBe(before.pnl.writeOffCost);
    const receipts = after.sources.goodsReceipts.filter(g => g.poId === 'LIVE-QC-PO-' + sku);
    expect(sum(receipts, 'receivedQuantity')).toBe(200);
    expect(sum(receipts, 'acceptedQuantity')).toBe(200 - defectQty);
    expect(sum(receipts, 'rejectedQuantity')).toBe(defectQty);
    expect(after.journal.filter(j => j.kind === 'writeOffCost' && j.sourceId.includes('QC-PO'))).toEqual(loss);
  });
});

test('PM2 giữ một worker cho phiên demo kể cả khi môi trường yêu cầu 4', () => {
  const previous = process.env.PM2_INSTANCES;
  try {
    process.env.PM2_INSTANCES = '4';
    jest.isolateModules(() => {
      expect(require('../../../../ecosystem.config').apps.find(a => a.name === 'erp-api').instances).toBe(1);
    });
  } finally {
    if (previous === undefined) delete process.env.PM2_INSTANCES;
    else process.env.PM2_INSTANCES = previous;
  }
});
