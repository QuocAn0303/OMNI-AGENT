/**
 * tests/plan-gate-order.contract.test.js — `requireModule` phải đứng SAU `authenticate`
 *
 * ============================================================================
 * VÌ SAO CÓ TEST NÀY
 * ============================================================================
 * `requireModule` đọc `req.user.tenantId` để biết tenant dùng gói nào:
 *
 *   const tenantId = req.user?.tenantId;
 *   if (!tenantId) return next();          // plan.middleware.js:109
 *
 * Nghĩa là `requireModule` đặt TRƯỚC `authenticate` là vô hiệu hoàn toàn — mọi gói,
 * kể cả Free, đều đi qua. Đây không phải lý thuyết: 16 file route từng ở đúng
 * tình trạng đó (`docs/aisc26/00-scope.md` §7 B1), và `ai` + `replenishment`
 * thì không được gate ở đâu cả ⇒ luồng AI mở cho mọi gói.
 *
 * Cái sai nằm ở THỨ TỰ MIDDLEWARE — thứ mắt thường không đọc — nên chỉ sửa một
 * lần thì sẽ trơ ra lần nữa. Test này là cái gạp: đọc source, tìm mọi file route
 * đăng ký `requireModule` mà không có `authenticate` đứng trước trong cùng chuỗi.
 *
 * allowlist = các route CỐ Ý công khai (không có JWT) nên không thể gate theo gói:
 * xem giải thích từng dòng ngay dưới.
 */
const fs = require("fs");
const path = require("path");

const MODULES_DIR = path.join(__dirname, "..", "src", "modules");

/**
 * Route công khai — không có `req.user`, nên `requireModule` bên cạnh là vô nghĩa.
 * Mỗi mục phải kèm LÝ DO, và thêm mục mới là phải trả lời được "vì sao".
 */
const PUBLIC_ROUTE_ALLOWLIST = [
  {
    file: path.join("delivery", "delivery.routes.js"),
    // Theo dõi vận đơn: frontend `DeliveryManagement.jsx` gọi kèm JWT, nhưng
    // đây là nghiệp vụ "khách tra cứa đơn" nên để public. Nếu đóng lại thì phải
    // dọn cả phía khách — không làm trong Vòng 2.
    reason: "tra cứu vận đơn công khai",
  },
  {
    file: path.join("portal", "portal.routes.js"),
    // Portal dùng `x-portal-token` (OTP), không phải JWT ⇒ `req.user` không tồn tại.
    // Gate theo gói ở đây cần sửa `plan.middleware` để nhận tenantId từ session.
    reason: "xac thuc bang OTP (x-portal-token), khong phai JWT",
  },
];

/** Bỏ comment + string, để không đếm nhầm từ khoá trong chú thích. */
const stripNoise = (line) =>
  line.replace(/\/\/.*$/, "").replace(/"(?:[^"\\]|\\.)*"/g, '""').trim();

/**
 * Trả về các dòng "code thật" (bỏ comment khối `/** … *\/`).
 * Nhiều file mở đầu bằng JSDoc ghi "Yêu cầu authenticate + requireModule('hr')"
 * — đọc bằng regex phẳng sẽ tưởng đó là khai báo middleware.
 * Giữ nguyên SỐ THỨ TỰ dòng để vị trí báo lỗi vẫn khớp file thật.
 */
const codeLines = (src) => {
  const out = [];
  let inBlock = false;
  for (const raw of src.split(/\r?\n/)) {
    let line = raw;
    if (inBlock) {
      const end = line.indexOf("*/");
      if (end === -1) {
        out.push("");
        continue;
      }
      line = line.slice(end + 2);
      inBlock = false;
    }
    const open = line.indexOf("/*");
    if (open !== -1) {
      const close = line.indexOf("*/", open + 2);
      if (close === -1) {
        line = line.slice(0, open);
        inBlock = true;
      } else {
        line = line.slice(0, open) + line.slice(close + 2);
      }
    }
    out.push(line);
  }
  return out;
};

const listRouteFiles = () => {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".routes.js")) out.push(full);
    }
  };
  walk(MODULES_DIR);
  return out;
};

/**
 * Trả về các "lần đăng ký `requireModule`" bị hỏng.
 *
 * Cách nhận biết: trong file, điểm đầu tiên `requireModule` xuất hiện PHẢI đứng sau
 * một middleware `authenticate` đã đăng ký. So sánh theo THỨ TỰ DÒNG, và coi mọi
 * dòng `authenticate` trong một lời gọi `router.use(...)` / `router.get(...)` là
 * cùng một điểm đăng ký — kể cả khi `authenticate` nằm ở dòng kế tiếp.
 */
/**
 * Trả về các "lần đăng ký `requireModule`" bị hỏng.
 *
 * `router.use(\n  authenticate,\n  requireModule("crm"),\n)` là MỘT lần đăng ký
 * đúng thứ tự, nhưng `authenticate` nằm ở dòng kế tiếp. Nên bước đầu phải GỘP
 * một lời gọi `router.x(...)` nhiều dòng thành một dòng logic (theo dấu ngoặc
 * đóng), rồi mới so thứ tự. Giữ nguyên số thứ tự dòng để vị trí báo lỗi khớp file.
 */
const statements = (src) => {
  const raw = codeLines(src);
  const out = [];
  let depth = 0;
  let start = 0;
  let buf = "";
  raw.forEach((line, i) => {
    const code = stripNoise(line);
    if (depth === 0) {
      start = i;
      buf = code;
    } else {
      buf += " " + code;
    }
    for (const ch of code) {
      if (ch === "(") depth += 1;
      else if (ch === ")") depth -= 1;
    }
    if (depth <= 0) {
      depth = 0;
      out.push({ line: start, code: buf });
    }
  });
  if (buf) out.push({ line: start, code: buf });
  return out;
};

const findBrokenGates = (file) => {
  const src = fs.readFileSync(file, "utf8");

  const authLines = [];
  const gateLines = [];
  for (const st of statements(src)) {
    if (!st.code) continue;
    const isRouteDecl = /router\.(use|get|post|put|patch|delete|all)\s*\(/.test(st.code);
    if (isRouteDecl && /\bauthenticate\b/.test(st.code)) authLines.push(st.line);
    if (/\brequireModule\s*\(/.test(st.code)) gateLines.push(st.line);
  }

  const firstAuth = authLines.length ? Math.min(...authLines) : -1;
  const firstGate = gateLines.length ? Math.min(...gateLines) : -1;
  if (firstGate === -1) return [];
  // `>=` vì `router.use(authenticate, requireModule("x"))` trên CÙNG dòng là
  // thứ tự ĐÚNG — authenticate chạy trước trong danh sách đối số.
  if (firstAuth !== -1 && firstGate >= firstAuth) return [];

  // `requireModule` đứng trước mọi `authenticate` (hoặc không có `authenticate` nào).
  return [{ line: firstGate + 1, hasAuth: firstAuth !== -1 }];
};

describe("plan gate: requireModule phải đứng sau authenticate", () => {
  const files = listRouteFiles();

  it("có file route để quét (không rỗng)", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  const broken = [];
  for (const file of files) {
    for (const hit of findBrokenGates(file)) {
      broken.push({ file: path.relative(path.join(__dirname, ".."), file), ...hit });
    }
  }

  it("không route nào đặt requireModule trước authenticate", () => {
    const real = broken.filter(
      (b) =>
        !PUBLIC_ROUTE_ALLOWLIST.some((a) => path.join("src", "modules", a.file) === b.file),
    );
    expect(real).toEqual([]);
  });

  it("allowlist vẫn còn đúng file (không để lại mục chết)", () => {
    for (const a of PUBLIC_ROUTE_ALLOWLIST) {
      expect(fs.existsSync(path.join(MODULES_DIR, a.file))).toBe(true);
      expect(typeof a.reason).toBe("string");
      expect(a.reason.length).toBeGreaterThan(10);
    }
  });

  it("module 'ai' và 'replenishment' phải được gate (nếu đã có dùng)", () => {
    // Nếu sau này ai đó gỡ `requireModule` khỏi 2 module này thì AI lại mở cho
    // mọi gói — đúng cái lỗi đã ghi ở `docs/aisc26/00-scope.md` F8.
    const ai = path.join(MODULES_DIR, "ai", "agent.routes.js");
    const rep = path.join(MODULES_DIR, "replenishment", "replenishment.routes.js");
    expect(fs.readFileSync(ai, "utf8")).toMatch(/requireModule\(\s*["']ai["']\s*\)/);
    expect(fs.readFileSync(rep, "utf8")).toMatch(/requireModule\(\s*["']replenishment["']\s*\)/);
  });

  it("authenticate phải idempotent (router-level + per-route là hợp lệ)", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "..", "src", "middleware", "auth.middleware.js"),
      "utf8",
    );
    expect(src).toMatch(/req\.authVerified/);
  });
});
