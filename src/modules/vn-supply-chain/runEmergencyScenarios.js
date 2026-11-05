'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { simulateSupplierDelay14Days, simulateDemandSurge50Percent } = require('./oms-logistics.service');

function buildEmergencyReport() {
  const scenarios = [simulateSupplierDelay14Days(), simulateDemandSurge50Percent()];
  const lines = ['# So sánh hai tình huống khẩn cấp', '',
    'Kết quả mô phỏng theo cấu hình mặc định, không phải cam kết dịch vụ thực tế.', '',
    '| Tình huống | Thiếu hàng trước | Thiếu hàng sau | SLA bàn giao trước | SLA bàn giao sau | Chênh lệch tồn |',
    '| --- | ---: | ---: | ---: | ---: | ---: |'];
  for (const s of scenarios) lines.push('| ' + [
    s.scenario, s.before.metrics.stockoutUnits, s.after.metrics.stockoutUnits,
    (s.before.metrics.dispatchSlaRate * 100).toFixed(2) + '%',
    (s.after.metrics.dispatchSlaRate * 100).toFixed(2) + '%', s.after.audit.difference,
  ].join(' | ') + ' |');
  lines.push('', 'SLA là lượng đơn một đơn vị được cấp hàng và đóng gói/bàn giao đúng ngày chia tổng cầu. Bảng dùng cả kỳ 28 ngày.',
    'Kịch bản B kiểm tra riêng 14 ngày tăng cầu: ' + (scenarios[1].peakSlaRate * 100).toFixed(2) + '%.',
    'Cân bằng bao gồm hàng còn trên xe điều chuyển; hàng mua được QC và lên kệ đầu ngày nhận theo giả định mô phỏng.',
    'Mỗi kịch bản chứa PO, GRN, phiếu điều chuyển, tồn từng ngày và phương án ứng phó trong tệp JSON đi kèm.', '');
  return { scenarios, markdown: lines.join('\n') };
}
if (require.main === module) {
  if (process.argv.length > 2) throw new Error('CLI không nhận tham số; dùng API JS để thay cấu hình');
  const report = buildEmergencyReport();
  const directory = path.join(__dirname, 'data', 'generated');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'emergency-scenarios.json'), JSON.stringify(report.scenarios, null, 2) + '\n', 'utf8');
  fs.writeFileSync(path.join(directory, 'emergency-scenarios.md'), report.markdown, 'utf8');
  process.stdout.write(report.markdown);
}
module.exports = { buildEmergencyReport };
