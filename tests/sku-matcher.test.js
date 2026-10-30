'use strict';

/**
 * Unit test cho `src/modules/import/sku-matcher.js` (mock — không đụng DB).
 *
 * Trục kiểm chứng: (1) mỗi tín hiệu đo đúng; (2) ba trạng thái trả về đúng ngưỡng;
 * (3) trường hợp nguy hiểm — hai mã gần như giống nhau KHÔNG được tự khớp.
 */

const {
  SkuMatcher,
  MATCH_STATUS,
  AUTO_ACCEPT_SCORE,
  REVIEW_SCORE,
  normalize,
  trigrams,
  diceSet,
  levRatio,
} = require('../src/modules/import/sku-matcher');

const CATALOG = [
  { sku: '10002', name: 'INFLATABLE POLITICAL GLOBE' },
  { sku: '15034', name: 'PAPER POCKET TRAVELING FAN' },
  { sku: '22578', name: 'WOODEN STAR CHRISTMAS SCANDINAVIAN' },
  { sku: '71053', name: 'SET 7 BABUSHKA NIKOLA' },
];

const matcher = new SkuMatcher(CATALOG);

describe('normalize', () => {
  it('bỏ dấu, hạ chữ thường, gom khoảng trắng', () => {
    expect(normalize('  Áo Len  Nữ 2XL - Xanh ')).toBe('ao len nu 2xl xanh');
  });
  it('null/undefined không ném lỗi', () => {
    expect(normalize(null)).toBe('');
    expect(normalize(undefined)).toBe('');
  });
});

describe('tín hiệu đo', () => {
  it('trigram giống hệt = 1, rỗng = 0', () => {
    expect(diceSet(trigrams('abc'), trigrams('abc'))).toBe(1);
    expect(diceSet(new Set(), trigrams('abc'))).toBe(0);
  });
  it('trigram bắt được lỗi gõ', () => {
    expect(diceSet(trigrams('wooll hat red'), trigrams('wool hat red'))).toBeGreaterThan(0.7);
  });
  it('levRatio chuẩn hoá 0..1', () => {
    expect(levRatio('abc', 'abc')).toBe(1);
    expect(levRatio('', 'abc')).toBe(0);
    expect(levRatio('kitten', 'sitting')).toBeGreaterThan(0.4);
  });
});

describe('match — ba trạng thái', () => {
  it('mã hàng trùng tuyệt đối ⇒ AUTO_ACCEPT, score 1', () => {
    const r = matcher.match('tên sai hoàn toàn', { inputSku: '10002' });
    expect(r.status).toBe(MATCH_STATUS.AUTO);
    expect(r.sku).toBe('10002');
    expect(r.score).toBe(1);
  });

  it('tên đúng viết hoa/thêm ký tự ⇒ AUTO_ACCEPT', () => {
    const r = matcher.match('inflatable political  globe!!!');
    expect(r.status).toBe(MATCH_STATUS.AUTO);
    expect(r.sku).toBe('10002');
  });

  it('tên mơ hồ nằm giữa hai mã ⇒ NEEDS_REVIEW, không tự quyết', () => {
    const r = matcher.match('wooden star christmas');
    expect(r.status).toBe(MATCH_STATUS.REVIEW);
    expect(r.sku).toBe('22578');
    expect(r.candidates.length).toBeGreaterThan(1);
  });

  it('rác không liên quan ⇒ NO_MATCH, sku null, vào hàng đợi', () => {
    const r = matcher.match('mua iphone 15 pro max');
    expect(r.status).toBe(MATCH_STATUS.NO_MATCH);
    expect(r.sku).toBeNull();
  });

  it('điểm luôn nằm trong [0,1]', () => {
    for (const n of ['a', 'wooden star', 'zzz qqq', 'set 7 babushka nikola']) {
      const r = matcher.match(n);
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(1);
      for (const c of r.candidates) {
        expect(c.total).toBeGreaterThanOrEqual(0);
        expect(c.total).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('NGƯỠNG — hằng số công khai, không ẩn trong mã', () => {
  it('ngưỡng đúng thứ tự', () => {
    expect(REVIEW_SCORE).toBeLessThan(AUTO_ACCEPT_SCORE);
    expect(REVIEW_SCORE).toBeGreaterThan(0);
    expect(AUTO_ACCEPT_SCORE).toBeLessThanOrEqual(1);
  });
});

describe('KHÔNG tự khớp khi bất an', () => {
  it('hai mã gần như trùng tên: điểm cao nhưng cách hạng nhất nhỏ ⇒ REVIEW', () => {
    const twin = new SkuMatcher([
      { sku: 'A1', name: 'WOOL HAT RED' },
      { sku: 'A2', name: 'WOOL HAT RED' },
    ]);
    const r = twin.match('wool hat red');
    expect(r.status).toBe(MATCH_STATUS.REVIEW);
    expect(r.reason).toMatch(/gần nhau/);
  });

  it('catalog rỗng ⇒ NO_MATCH chứ không ném lỗi', () => {
    const empty = new SkuMatcher([]);
    const r = empty.match('bất cứ thứ gì');
    expect(r.status).toBe(MATCH_STATUS.NO_MATCH);
    expect(r.reason).toMatch(/catalog rỗng/);
  });
});

describe('matchBatch — tách khớp và hàng đợi người xác nhận', () => {
  it('tách đúng, không mất dòng nào, số liệu khớp tổng', () => {
    const inputs = [
      { ref: 'a', name: 'inflatable political globe' },
      { ref: 'b', sku: '15034', name: 'gì đó khác' },
      { ref: 'c', name: 'tên lạ hoắc không có trong catalog zzz' },
      { ref: 'd', name: 'wooden star christmas' },
    ];
    const out = matcher.matchBatch(inputs);
    expect(out.matched.length + out.reviewQueue.length).toBe(inputs.length);
    expect(out.stats.total).toBe(inputs.length);
    expect(out.stats.auto).toBe(out.matched.length);
    expect(out.stats.review + out.stats.noMatch).toBe(out.reviewQueue.length);
    // Dòng trùng SKU luôn AUTO, không bao giờ vào hàng đợi.
    expect(out.matched.find((r) => r.ref === 'b').sku).toBe('15034');
    // Dòng mơ hồ phải nằm trong hàng đợi, KHÔNG tự ghi.
    expect(out.reviewQueue.some((r) => r.ref === 'd')).toBe(true);
  });

  it('chạy lại cho kết quả y hệt (tất định)', () => {
    const inputs = [{ name: 'wooden star christmas scandinavian' }, { name: 'babushka nikola set' }];
    const a = matcher.matchBatch(inputs);
    const b = new SkuMatcher(CATALOG).matchBatch(inputs);
    expect(JSON.stringify(a.stats)).toBe(JSON.stringify(b.stats));
    expect(a.reviewQueue.map((r) => r.sku)).toEqual(b.reviewQueue.map((r) => r.sku));
  });
});