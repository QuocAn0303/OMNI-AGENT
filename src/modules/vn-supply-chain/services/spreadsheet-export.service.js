'use strict';
const ExcelJS = require('exceljs');
const { PNL, CASH } = require('../metrics-finance.service');
function spreadsheetTables(report) {
  return {
    Summary: [{reportId:report.reportId,currency:'VNĐ',startDate:report.metadata.startDate,endDate:report.metadata.endDate,...report.pnl,...report.cashFlow}],
    PnL:report.periods.map(p=>Object.fromEntries(['period','label','startDate','endDate',...PNL].map(k=>[k,p[k]]))),
    CashFlow:report.periods.map(p=>Object.fromEntries(['period','label','startDate','endDate','cashOpening',...CASH,'cashClosing'].map(k=>[k,p[k]]))),
    KPI:Object.entries(report.kpis).flatMap(([group,values])=>Object.entries(values).map(([metric,value])=>({group,metric,value}))),
    EOQ_ROP:report.eoqRop,
    Scenarios:Object.entries(report.scenarios).flatMap(([scenario,r])=>r.comparison.map(c=>({scenario,...c}))),
    FinanceDaily:report.daily, Journal:report.journal, InventoryValue:report.inventoryDaily,
    ...Object.fromEntries(Object.entries(report.sources).filter(([,v])=>Array.isArray(v)).map(([name,rows])=>[name,rows])),
    Policy:Object.entries(report.policy).map(([parameter,value])=>({parameter,value})),
    Notes:report.notes.map(note=>({note})),
  };
}
const scalar = value => value && typeof value==='object'?JSON.stringify(value):value ?? '';
const csv = value => {
  let text=String(scalar(value));
  if(typeof value==='string' && /^[=+@\-\t\r]/.test(text))text="'"+text;
  return '"'+text.replaceAll('"','""')+'"';
};
async function exportSpreadsheetData(report, format='json') {
  if(!['json','csv','xlsx'].includes(format))throw new Error('Định dạng xuất không hỗ trợ');
  if(format==='json')return {contentType:'application/json; charset=utf-8',filename:'vn-supply-chain.json',data:Buffer.from(JSON.stringify(report))};
  const tables=spreadsheetTables(report);
  if(format==='csv') {
    const lines=['table,row,field,value'];
    for(const [name,rows] of Object.entries(tables))rows.forEach((row,index)=>Object.entries(row).forEach(([field,value])=>{
      lines.push([name,index+1,field,value].map(csv).join(','));
    }));
    return {contentType:'text/csv; charset=utf-8',filename:'vn-supply-chain.csv',data:Buffer.from('\uFEFF'+lines.join('\r\n'))};
  }
  const wb=new ExcelJS.Workbook();
  wb.creator='Aduu ERP';wb.calcProperties.fullCalcOnLoad=true;
  for(const [name,rows] of Object.entries(tables)) {
    const sheet=wb.addWorksheet(name.slice(0,31),{views:[{state:'frozen',ySplit:1}],properties:{tabColor:{argb:'FF0D9488'}}});
    const keys=[...new Set(rows.flatMap(r=>Object.keys(r)))];
    sheet.columns=keys.map(key=>({header:key,key,width:key==='note'?110:key.toLowerCase().includes('date')?15:24}));
    rows.forEach(row=>sheet.addRow(Object.fromEntries(keys.map(k=>[k,scalar(row[k])]))));
    const col=k=>sheet.getColumn(keys.indexOf(k)+1).letter;
    const formula=(row,key,expression,value)=>{sheet.getCell(row,keys.indexOf(key)+1).value={formula:expression,result:value};};
    if(name==='PnL')rows.forEach((p,i)=>{
      const row=i+2,ref=k=>col(k)+row;
      formula(row,'netRevenue',ref('grossRevenue')+'-'+ref('returnsValue'),p.netRevenue);
      formula(row,'grossProfit',ref('netRevenue')+'-'+ref('cogs'),p.grossProfit);
      formula(row,'operatingProfit',ref('grossProfit')+'-'+['outboundFreight','returnFreight','holdingCost','packingCost','repackCost','writeOffCost'].map(ref).join('-'),p.operatingProfit);
    });
    if(name==='CashFlow')rows.forEach((p,i)=>{
      const row=i+2,ref=k=>col(k)+row;
      if(i)formula(row,'cashOpening',col('cashClosing')+(row-1),p.cashOpening);
      formula(row,'cashClosing',ref('cashOpening')+'+'+ref('prepaidReceipts')+'+'+ref('codReceipts')+'-'+['refundsPaid','supplierDeposit','supplierBalance','cashExpenses'].map(ref).join('-'),p.cashClosing);
    });
    if(name==='EOQ_ROP')rows.forEach((p,i)=>{
      const row=i+2,ref=k=>col(k)+row;
      formula(row,'eoq','CEILING(SQRT(2*'+ref('annualDemand')+'*'+ref('orderingCost')+'/'+ref('holdingCostPerUnitPerYear')+'),'+ref('moq')+')',p.eoq);
      formula(row,'rop','ROUNDUP('+ref('dailyDemand')+'*'+ref('leadTimeDays')+'+'+ref('safetyStock')+',0)',p.rop);
    });
    sheet.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};
    sheet.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF123B48'}};
    sheet.getRow(1).height=30;
    sheet.autoFilter={from:{row:1,column:1},to:{row:Math.max(1,rows.length+1),column:Math.max(1,keys.length)}};
    sheet.eachRow((row,index)=>{if(index>1){row.eachCell(cell=>{
      cell.alignment={vertical:'top',wrapText:name==='Notes'};
      if(typeof cell.value==='number'||cell.value?.formula)cell.numFmt='#,##0.00;[Red](#,##0.00);–';
    });if(name==='Notes')row.height=45;}});
  }
  return {contentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',filename:'vn-supply-chain.xlsx',data:Buffer.from(await wb.xlsx.writeBuffer())};
}
module.exports={exportSpreadsheetData,spreadsheetTables};
