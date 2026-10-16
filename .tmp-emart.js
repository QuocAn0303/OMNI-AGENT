/* SCRIPT TẢM — khảo sát emartmall: robots.txt + trang có phải SPA không,
 * có endpoint danh sách sản phẩm không.
 * CHƯA tải dữ liệu hàng loạt — chỉ xem cấu trúc.
 * Chạy: node .tmp-emart.js
 */
const https = require('https');
const fs = require('fs');

const lay = (url, max = 200000) => new Promise((resolve) => {
  const u = new URL(url);
  let done = false;
  const xong = (r) => { if (!done) { done = true; resolve(r); } };
  const req = https.request(
    { hostname: u.hostname, port: 443, path: u.pathname + u.search, method: 'GET', timeout: 15000, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; research)' } },
    (res) => {
      let s = '';
      res.on('data', (d) => { s += d; if (s.length > max) req.destroy(); });
      res.on('close', () => xong({ status: res.statusCode, body: s, type: res.headers['content-type'] }));
    },
  );
  req.on('timeout', () => { req.destroy(); xong({ status: 0, body: '' }); });
  req.on('error', (e) => xong({ status: 0, body: '', err: e.code }));
  req.end();
  setTimeout(() => xong({ status: 0, body: '' }), 20000);
});

(async () => {
  console.log('=== 1. robots.txt ===');
  const rb = await lay('https://emartmall.com.vn/robots.txt', 20000);
  if (rb.status === 200) {
    console.log(rb.body.split('\n').slice(0, 28).map((l) => '   ' + l).join('\n'));
  } else {
    console.log('   HTTP ' + rb.status + (rb.err ? ' (' + rb.err + ')' : ' — may khong co robots.txt'));
  }

  console.log('\n=== 2. Trang chu — co phai SPA khong? ===');
  const hp = await lay('https://emartmall.com.vn/');
  const b = hp.body;
  console.log('   HTTP ' + hp.status + ' · ' + b.length + ' byte · ' + (hp.type || '?'));
  const dau = [
    ['__NEXT_DATA__', b.includes('__NEXT_DATA__')],
    ['__NUXT__', b.includes('__NUXT__')],
    ['window.__INITIAL', /window\.__[A-Z_]{4,}/.test(b)],
    ['nuxt', /__nuxt|nuxt-link/i.test(b)],
    ['next', /_next\/static/.test(b)],
    ['react root #__next', /id="__next"/.test(b)],
  ];
  dau.forEach(([n, c]) => console.log('   ' + (c ? 'CO ' : 'khong') + '  ' + n));

  console.log('\n=== 3. Tim duong dan san pham / API trong HTML ===');
  const duong = [...new Set((b.match(/\/[a-z0-9\-_\/]{3,60}\/[a-z0-9\-_\/]{0,40}/g) || [])
    .filter((s) => /product|san-pham|api|category|danh-muc|search|collections/i.test(s)))].slice(0, 18);
  duong.forEach((d) => console.log('   ' + d));
  if (!duong.length) console.log('   (khong thay duong dan nao khop)');

  console.log('\n=== 4. Co bao gia tien san khong? (dau hieu du lieu nhung server) ===');
  const gia = [...new Set((b.match(/\d{1,3}(?:[.,]\d{3})+\s*(?:đ|₫|VND)/g) || []))].slice(0, 6);
  console.log('   ' + (gia.length ? gia.join(' | ') : '(trang chu khong co gia san — du lieu den tu API)'));
})();
