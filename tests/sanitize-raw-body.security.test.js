/**
 * tests/sanitize-raw-body.security.test.js — M6 regression
 *
 * Lỗi gốc: `app.js` mount `express.raw({ type: 'application/json' })` cho các path
 * webhook TRƯỚC `express.json`, rồi `sanitize` chạy sau. Với content-type JSON,
 * `req.body` lúc đó là **Buffer**. `Object.entries(Buffer)` biến nó thành object chỉ
 * số byte ({"0":123,"1":34,...}) → `JSON.parse(rawBody)` ném lỗi → webhook hợp lệ
 * của GHTK/GHN/SePay/PayOS/MoMo... bị chết 500 im lặng.
 *
 * Vấn đề bảo mật đi kèm: HMAC được verify trên body đã bị bóp méo nên luôn 401 —
 * tức lớp bảo vệ fail-open ở H3 bị che lấp bởi bug này. Sửa M6 mà chưa sửa H3
 * sẽ vô tình mở đường nhận webhook giả.
 */
const sanitize = require("../src/middleware/sanitize.middleware");

const run = (req) => sanitize()(req, {}, () => {});

describe("M6 — không phá raw body của webhook", () => {
  test("Buffer body được giữ nguyên (verify HMAC cần byte thô)", () => {
    const raw = Buffer.from('{"ReferenceCode":"HD-1","Amount":100}', "utf8");
    const req = { body: raw, query: {} };
    run(req);
    expect(Buffer.isBuffer(req.body)).toBe(true);
    expect(req.body.toString("utf8")).toBe('{"ReferenceCode":"HD-1","Amount":100}');
    // quan trọng: JSON.parse được trên đúng payload gốc
    expect(JSON.parse(req.body.toString("utf8")).ReferenceCode).toBe("HD-1");
  });

  test("Buffer rỗng cũng giữ nguyên", () => {
    const req = { body: Buffer.alloc(0), query: {} };
    run(req);
    expect(Buffer.isBuffer(req.body)).toBe(true);
    expect(req.body.length).toBe(0);
  });

  test("TypedArray / ArrayBuffer không bị bóp méo", () => {
    const req = { body: new Uint8Array([1, 2, 3]), query: {} };
    run(req);
    expect(req.body).toBeInstanceOf(Uint8Array);
  });

  test("plain object VẪN được sanitize như trước", () => {
    const req = {
      body: { name: "Nhan <script>alert(1)</script>Viet", note: "<b>ok</b>" },
      query: {},
    };
    run(req);
    expect(req.body.name).toBe("Nhan Viet");
    // không có allowTags → tag bị gỡ hết
    expect(req.body.note).toBe("ok");
  });

  test("allowTags giữ tag hợp lệ, gỡ javascript: URL", () => {
    const req = {
      body: { desc: '<b>in đậm</b><script>alert(1)</script><a href="javascript:alert(1)">x</a>' },
      query: {},
    };
    sanitize(["desc"])(req, {}, () => {});
    expect(req.body.desc).toContain("<b>in đậm</b>");
    expect(req.body.desc).not.toContain("<script");
    expect(req.body.desc).not.toContain("javascript:");
  });

  test("nested object/array vẫn sanitize đệ quy", () => {
    const req = {
      body: { items: [{ name: "<img src=x onerror=alert(1)>A" }], meta: { k: "<i>b</i>" } },
      query: {},
    };
    run(req);
    expect(req.body.items[0].name).toBe("A");
    expect(req.body.meta.k).toBe("b");
  });

  test("query string vẫn stripTags", () => {
    const req = { body: {}, query: { search: "<script>x</script>abc" } };
    run(req);
    expect(req.query.search).toBe("abc");
  });

  test("body undefined không ném lỗi", () => {
    const req = { query: {} };
    expect(() => run(req)).not.toThrow();
  });
});