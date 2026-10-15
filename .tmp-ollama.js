/* SCRIPT TẠM — do model cuc bo Ollama: goi duoc khong, nhanh khong,
 * va co tra loi DUNG khong tren mot vi du SKU that.
 * Chay: node .tmp-ollama.js
 */
const http = require('http');

const BASE = 'http://127.0.0.1:11434/v1';
const u = new URL(BASE);
const basePath = u.pathname.replace(/\/$/, '');   // "/v1" — bo qua basePath se mat tien to va tra 404

function post(body, timeout = 120000) {
  return new Promise((resolve) => {
    const payload = JSON.stringify(body);
    const r = http.request(
      {
        hostname: u.hostname, port: Number(u.port), path: `${basePath}/chat/completions`, method: 'POST',
        headers: { Authorization: 'Bearer ollama', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
        timeout,
      },
      (res) => {
        let raw = '';
        res.on('data', (d) => { raw += d; });
        res.on('end', () => resolve({ status: res.statusCode, body: raw }));
      },
    );
    r.on('timeout', () => r.destroy(new Error('timeout')));
    r.on('error', (e) => resolve({ status: 0, body: e.message }));
    r.write(payload);
    r.end();
  });
}

// Bai that lay tu cap bi sai: ten san pham -> chon dung ma trong danh sach.
const BAI = {
  ten: 'BAG 125g SWIRLY MARBLES',
  dung: '21703',
  sai: [
    { sku: '21704', ten: 'BAG 250g SWIRLY MARBLES' },
    { sku: '23199', ten: 'JUMBO BAG APPLES' },
    { sku: '85099F', ten: 'JUMBO BAG STRAWBERRY' },
    { sku: '20725', ten: 'LUNCH BAG RED RETROSPOT' },
  ],
};

const prompt = [
  `Chon ma san pham khop nhat voi ten sau.`,
  `Ten can khop: "${BAI.ten}"`,
  `Danh sach ma:`,
  `21704 = BAG 250g SWIRLY MARBLES`,
  `23199 = JUMBO BAG APPLES`,
  `85099F = JUMBO BAG STRAWBERRY`,
  `20725 = LUNCH BAG RED RETROSPOT`,
  `${BAI.dung} = ${BAI.ten}`,
  `Tra loi JSON duy nhat, dung nguyen dinh dang nay:`,
  `{"sku":"<ma>","confidence":<so 0-1>}`,
].join('\n');

(async () => {
  console.log('Ollama: ' + BASE + '\n');
  for (const m of ['qwen2.5-coder:7b', 'lfm2.5:latest']) {
    console.log('=== ' + m + ' ===');
    const t0 = Date.now();
    const r = await post({ model: m, messages: [{ role: 'user', content: prompt }], max_tokens: 120, temperature: 0 });
    const ms = Date.now() - t0;
    if (r.status !== 200) { console.log('  LOI HTTP ' + r.status + ' ' + String(r.body).slice(0, 160)); continue; }
    let j = {};
    try { j = JSON.parse(r.body); } catch { /* ignore */ }
    const txt = (j.choices || [{}])[0].message?.content || '';
    const tok = j.usage?.total_tokens || 0;
    console.log('  thoi gian : ' + ms + 'ms');
    console.log('  token    : ' + tok + (tok ? '  (' + Math.round(tok / (ms / 1000)) + ' tok/s)' : ''));
    console.log('  tra loi   : ' + txt.replace(/\s+/g, ' ').slice(0, 160));
    const ma = txt.match(/21703|21704|23199|85099F|20725/);
    console.log('  ma chon   : ' + (ma ? ma[0] : '(khong ra ma nao)') + '  |  DUNG LA: ' + BAI.dung
      + '  => ' + (ma && ma[0] === BAI.dung ? 'DUNG' : 'SAI'));
    console.log('');
  }
})();
