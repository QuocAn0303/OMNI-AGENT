const ExcelJS = require('exceljs');

const exportToExcel = async (data, columns, sheetName = 'Sheet1') => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);
  ws.columns = columns.map(c => ({ header: c.header, key: c.key, width: c.width || 20 }));
  ws.addRows(data);
  const buf = await wb.xlsx.writeBuffer();
  return buf;
};

module.exports = { exportToExcel };
