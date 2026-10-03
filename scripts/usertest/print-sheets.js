'use strict';

/**
 * scripts/usertest/print-sheets.js — in bảng SKU + phiếu ra giấy
 *
 * Dùng khi chuẩn bị buổi thử: bài 1 KHÔNG có cột "Hệ thống đề xuất", bài 2 CÓ.
 * Nhầm cột là hỏng phiên nên script in **hai bảng tách biệt**, không bao giờ in
 * chung. Chỉ đọc tệp `sku-sets.json`, không chạm DB.
 *
 *   node scripts/usertest/print-sheets.js                    # in ra màn hình
 *   node scripts/usertest/print-sheets.js --out <thư mục>    # ghi .md để in
 *   node scripts/usertest/print-sheets.js --set A --cond 1   # chỉ một bảng
 */

const fs = require('fs');
const path = require('path');

const USERTEST_DIR = path.resolve(__dirname, '..', '..', 'docs', 'aisc26', 'usertest');
const num = (v) => Number(v || 0);
const nfmt = (v) => new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(num(v));

const args = process.argv.slice(2);
const get = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
};
const outDir = get('--out');
const onlySet = (get('--set') || '').toUpperCase();
const onlyCond = get('--cond');

const scenarioPath = get('--scenario') || path.join(USERTEST_DIR, 'sku-sets.json');
const p = JSON.parse(fs.readFileSync(scenarioPath, 'utf8'));

const COND = [
  {
    n: 1,
    id: 'COND1_NO_SYSTEM',
    title: 'BÀI 1 — KHÔNG có cột đề xuất',
    note:
      'In bảng này cho nhóm AB với bộ A / nhóm BA với bộ B. ' +
      'TUYỆT ĐỐI KHÔNG để lọt cột "Hệ thống đề xuất", "Tồn kho an toàn", "Điểm đặt lại".',
    extraCols: false,
  },
  {
    n: 2,
    id: 'COND2_WITH_SYSTEM',
    title: 'BÀI 2 — CÓ cột đề xuất của hệ thống',
    note:
      'In bảng này cho nhóm AB với bộ B / nhóm BA với bộ A. ' +
      'Cột đề xuất KHÔNG bắt buộc phải theo — nói rõ điều đó khi đọc chữ cho người thử.',
    extraCols: true,
  },
];

const table = (rows, extraCols) => {
  const head = ['#', 'SKU', 'Tên hàng', 'Tồn khả dụng', 'BQ bán/ngày', 'Thời gian nhận', 'Giá vốn'];
  if (extraCols) head.push('Tồn kho an toàn', 'Điểm đặt lại', 'HỆ THỐNG ĐỀ XUẤT');
  head.push('BẠN CHỌN ĐẶT');
  const line = (cells) => `| ${cells.join(' | ')} |`;
  const sep = `|${' --- |'.repeat(head.length)}`;
  const body = rows.map((c, i) =>
    line([
      i + 1,
      c.sku,
      String(c.name).replace(/\|/g, '/'),
      nfmt(c.atp),
      c.demandPerDay,
      `${c.leadTimeDays}${c.leadTimeEstimated ? ' ⚠' : ''}`,
      c.unitCost,
      ...(extraCols ? [c.safetyStock, c.rop, `**${nfmt(c.orderQty)}**`] : []),
      '',
    ]));
  return [line(head), sep, ...body].join('\n');
};

const blocks = [];
for (const cond of COND) {
  if (onlyCond && String(onlyCond) !== String(cond.n)) continue;
  for (const key of ['A', 'B']) {
    if (onlySet && onlySet !== key) continue;
    blocks.push(
      `## ${cond.title} — bộ SKU ${key}\n\n` +
      `> ${cond.note}\n>\n` +
      `> Bộ ${key}: ${p.sets[key].length} SKU · as-of **${p.asOf}** · Σ đề xuất của hệ thống = ` +
      `**${nfmt(p.sets[key].reduce((a, c) => a + num(c.orderQty), 0))}** đơn vị\n\n` +
      table(p.sets[key], cond.extraCols) +
      `\n\n⚠ = thời gian nhận là **ước lượng** (chưa đủ dữ liệu nhận hàng thật của nhà cung cấp).\n`,
    );
  }
}

const doc =
  '# Bài thử — bảng in ra giấy (sinh tự động)\n\n' +
  '> Nhãn dữ liệu: **MÔ PHỎNG** — dựng từ UCI Online Retail II (CC BY 4.0), xem\n' +
  '> `docs/aisc26/02-data.md`. Giá tính bằng **sterling của tệp dữ liệu**, KHÔNG phải VND,\n' +
  '> KHÔNG phải giá vốn của doanh nghiệp nào.\n\n' +
  `> Kịch bản as-of **${p.asOf}** · tenant \`${p.tenant.slug}\` · sha256 \`sku-sets.json\` xem ` +
  '`sku-sets.md`.\n\n' +
  '> **Cách dùng:** in riêng từng khối. Bài 1 không bao giờ được in cùng cột đề xuất.\n\n---\n\n' +
  blocks.join('\n---\n\n');

if (outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const f = path.join(outDir, 'sheets.md');
  fs.writeFileSync(f, doc, 'utf8');
  console.log(`Đã ghi ${f} (${blocks.length} khối)`);
} else {
  console.log(doc);
}
