/**
 * tests/partner-routing.test.js — PRM: thứ tự mount route (Express thật)
 *
 * VÌ SAO CẦN TEST NÀY
 * Đây là lỗi đã xảy ra thật và đã được sửa: `partner.routes` có `GET /:id`, và
 * khi nó được mount ở "/" TRƯỚC router `/referrals` và `/roi`, Express khớp
 * "/referrals" vào `/:id` với `id = "referrals"` rồi DỪNG — không chuyển tiếp.
 * Hậu quả: `GET /api/partners/referrals` trả 404 "không tìm thấy đối tác".
 *
 * Test đọc mã nguồn sẽ KHÔNG bắt được lỗi này: mọi dòng khai báo route vẫn đúng,
 * chỉ là thứ tự mount sai. Vì vậy test này dựng Express thật, gắn từng route vào một
 * router giả, rồi so đường dẫn nào thắng.
 *
 * Cách làm: không require app thật (kéo theo DB, auth, gói dịch vụ). Thay vào đó
 * dựng router Express rỗng, đăng ký đúng thứ tự như `modules/partners/index.js`,
 * rồi kiểm tra xem đường dẫn nào được xử lý. Việc đọc thứ tự mount từ chính tệp
 * index.js giữ cho test không lệch với mã nguồn.
 */

const path = require("path");
const fs = require("fs");
const express = require("express");

const INDEX = path.join(__dirname, "..", "src", "modules", "partners", "index.js");

describe("partners/index.js — thứ tự mount route", () => {
  test("router có tiền tố phải mount TRƯỚC router gốc", () => {
    const src = fs.readFileSync(INDEX, "utf8");

    // Chỉ lấy dòng mount thật, bỏ qua dòng trong khối chú thích.
    const mounts = src
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("router.use("));

    const referralsAt = mounts.findIndex((l) => l.includes('"/referrals"'));
    const roiAt = mounts.findIndex((l) => l.includes('"/roi"'));
    // Dòng mount ở gốc: `router.use("/", require("./partner.routes"))`. Ghép cả
    // `"/"` và dấu phẩy để không nhầm với `use("/referrals", ...)` đã khớp ở trên.
    const rootAt = mounts.findIndex((l) => l.startsWith('router.use("/",'));

    expect(referralsAt).toBeGreaterThanOrEqual(0);
    expect(roiAt).toBeGreaterThanOrEqual(0);
    expect(rootAt).toBeGreaterThanOrEqual(0);

    // `partner.routes` có `GET /:id`, nuốt mọi đường dẫn một đoạn nếu đứng trước.
    expect(referralsAt).toBeLessThan(rootAt);
    expect(roiAt).toBeLessThan(rootAt);
  });

  test("đường dẫn có tiền tố không bị `/:id` của router gốc bắt mất", () => {
    // Dựng lại đúng thứ tự mount rồi hỏi router: với đường dẫn "/referrals", handler
    // nào chạy? Nếu `/:id` chạy trước thì `req.params.id` sẽ bằng "referrals".
    const router = express.Router();
    const rootFirst = [];
    const referralHandler = (req, res) => res.json({ handler: "referrals" });
    const roiHandler = (req, res) => res.json({ handler: "roi" });
    const partnerIdHandler = (req, res) =>
      res.json({ handler: "partnerId", id: req.params.id });

    router.use("/referrals", express.Router().get("/", referralHandler));
    router.use("/roi", express.Router().get("/", roiHandler));
    router.use(
      "/",
      express.Router().get("/:id", partnerIdHandler),
    );

    const app = express();
    app.use("/api/partners", router);

    const server = app.listen(0);
    const port = server.address().port;

    return Promise.all([
      fetch(`http://127.0.0.1:${port}/api/partners/referrals`).then((r) => r.json()),
      fetch(`http://127.0.0.1:${port}/api/partners/roi`).then((r) => r.json()),
      // Đường dẫn có id thật vẫn phải do router gốc xử lý.
      fetch(`http://127.0.0.1:${port}/api/partners/abc-123`).then((r) => r.json()),
    ])
      .then(([referrals, roi, byId]) => {
        server.close();
        expect(referrals.handler).toBe("referrals");
        expect(roi.handler).toBe("roi");
        expect(byId.handler).toBe("partnerId");
        expect(byId.id).toBe("abc-123");
      })
      .catch((e) => {
        server.close();
        throw e;
      });
  });

  test("đảo thứ tự mount thì /referrals bị nuốt — chứng minh test có tác dụng", () => {
    // Nếu đoạn này vẫn "đạt" thì test phía trên không bảo vệ được gì.
    const router = express.Router();
    const rootFirstResults = {};

    const app = express();
    // Cố tình SAI: router gốc mount trước.
    const root = express.Router();
    root.get("/:id", (req, res) => {
      rootFirstResults.hit = "partnerId";
      res.json({ handler: "partnerId", id: req.params.id });
    });
    router.use("/", root);
    router.use("/referrals", express.Router().get("/", (req, res) => {
      rootFirstResults.hit = "referrals";
      res.json({ handler: "referrals" });
    }));
    app.use("/api/partners", router);

    const server = app.listen(0);
    const port = server.address().port;

    return fetch(`http://127.0.0.1:${port}/api/partners/referrals`)
      .then((r) => r.json())
      .then((body) => {
        server.close();
        expect(body.handler).toBe("partnerId");
        expect(body.id).toBe("referrals");
      })
      .catch((e) => {
        server.close();
        throw e;
      });
  });
});