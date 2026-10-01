/**
 * scripts/verify.js — Chạy toàn bộ kiểm tra theo ĐÚNG THỨ TỰ, một lệnh duy nhất.
 *
 * Vì sao cần: trong Phase 4 đã mắc 3 lỗi vặt chỉ vì không có thứ tự chuẩn —
 *   1. Chạy `db:migrate:deploy` xong quên `prisma generate` → code mới không biết
 *      field mới, lỗi `Unknown argument 'reportsToId'`.
 *   2. Chạy test trước khi generate → test đỏ vì lý do không liên quan tới code.
 *   3. Không biết smoke nào thuộc Phase nào, phải đoán từ tên file.
 * Script này loại bỏ cả 3: thứ tự cố định, dừng ngay ở bước lỗi, in tổng kết.
 *
 * Chạy:
 *   npm run verify            # đầy đủ (cần DB đang chạy)
 *   npm run verify:quick      # bỏ các bước cần DB (smoke test) — dùng khi code-only
 *
 * Tham số:
 *   --quick     bỏ các bước cần DB (smoke trên DB thật)
 *   --keep      truyền xuống script smoke để giữ dữ liệu (debug)
 *
 * Exit code: 0 = tất cả pass, 1 = có bước fail.
 */
const { spawnSync } = require("child_process");
const path = require("path");

// Nạp .env TRƯỚC khi đọc biến môi trường ở phần cảnh báo cuối — không có nó thì
// CLIENT_URL/SMTP_HOST đều undefined và cảnh báo báo sai ("chưa đặt" trong khi
// .env có).
try {
  require("dotenv").config();
} catch {
  // Không có dotenv thì bỏ qua; các bước khác vẫn chạy bình thường
}

const ROOT = path.join(__dirname, "..");
const QUICK = process.argv.includes("--quick");
const KEEP = process.argv.includes("--keep");

const isWin = process.platform === "win32";

/**
 * Trên Windows, `spawnSync("npm.cmd", …, { shell: false })` trả `EINVAL` — Node
 * không chạy được batch file `.cmd` mà không có shell. Phải bật `shell: true` cho
 * các lệnh này.
 *
 * Dùng `shell: true` ở đây AN TOÀN vì toàn bộ argv là hằng số viết trong file này,
 * không có input người dùng ⇒ không có lỗ hổng shell-injection.
 */
const npm = isWin ? "npm.cmd" : "npm";
const npx = isWin ? "npx.cmd" : "npx";
const USE_SHELL = isWin;

const results = [];
let stepIndex = 0;

const C = {
  reset: "\u001b[0m",
  dim: "\u001b[2m",
  bold: "\u001b[1m",
  red: "\u001b[31m",
  green: "\u001b[32m",
  yellow: "\u001b[33m",
  cyan: "\u001b[36m",
};

/**
 * Bước KHÔNG được fail: cảnh báo cấu hình thiếu, vẫn chạy tiếp.
 * Dùng cho các thứ không chặn người khác verify (VD link tracking trỏ localhost).
 */
const step = ({ title, cmd, args = [], optional = false, note }) => {
  stepIndex += 1;
  const num = String(stepIndex).padStart(2, "0");
  console.log(`\n${C.bold}${C.cyan}[${num}] ${title}${C.reset}`);
  if (note) console.log(`${C.dim}     ${note}${C.reset}`);

  const t0 = Date.now();
  const r = spawnSync(cmd, args, {
    cwd: ROOT,
    stdio: "inherit",
    shell: USE_SHELL,
    env: process.env,
  });
  const ms = Date.now() - t0;
  const code = r.status === null ? 1 : r.status;
  const ok = code === 0;

  results.push({ title, ok, optional, code, ms });
  if (ok) {
    console.log(`${C.green}     ✓ ${title} (${(ms / 1000).toFixed(1)}s)${C.reset}`);
  } else if (optional) {
    console.log(`${C.yellow}     ! ${title} — thất bại nhưng KHÔNG chặn (optional)${C.reset}`);
  } else {
    console.log(`${C.red}     ✗ ${title} — exit code ${code}${C.reset}`);
  }
  return ok;
};

/** In cảnh báo cấu hình mà không chạy lệnh — rẻ hơn, và luôn chạy được. */
const warn = (title, message) => {
  console.log(`${C.yellow}     ! ${title}: ${message}${C.reset}`);
};

console.log(`${C.bold}Aduu ERP — verify${QUICK ? " (quick, bỏ bước cần DB)" : ""}${C.reset}`);

/** Chạy 1 lệnh im lặng, chỉ lấy exit code — dùng để probe. */
const runSilent = (cmd, args) => {
  try {
    const r = spawnSync(cmd, args, {
      cwd: ROOT,
      stdio: "pipe",
      encoding: "utf8",
      shell: USE_SHELL,
      env: process.env,
    });
    return { ok: r.status === 0, status: r.status, stderr: r.stderr || "", stdout: r.stdout || "" };
  } catch (e) {
    return { ok: false, status: null, stderr: e.message, stdout: "" };
  }
};

const dbReachable = runSilent(npx, ["prisma", "migrate", "status"]).ok;

if (!QUICK && !dbReachable) {
  console.log(
    `\n${C.red}${C.bold}Không kết nối được DB.${C.reset}\n` +
      `  Postgres chưa chạy → không thể chạy smoke test trên DB thật.\n` +
      `  Mở PowerShell (Run as Administrator):  Start-Service postgresql-x64-18\n` +
      `  Hoặc chạy bản không cần DB:          npm run verify:quick\n`,
  );
  process.exit(1);
}

// ── Bước 1: generate TRƯỚC mọi thứ ────────────────────────────────────────
// Đặt đầu tiên vì mọi bước sau đều cần client khớp schema. Đây chính là lỗi
// "Unknown argument" đã gặp.
step({
  title: "Prisma Client — generate",
  cmd: npx,
  args: ["prisma", "generate"],
  note: "Bắt buộc sau mỗi lần đổi schema.prisma",
});

// ── Bước 2: validate schema ──────────────────────────────────────────────
step({ title: "Prisma schema — validate", cmd: npx, args: ["prisma", "validate"] });

// ── Bước 3: migration đã áp hết chưa ─────────────────────────────────────
step({
  title: "Migration — đã áp đủ trên DB",
  cmd: npx,
  args: ["prisma", "migrate", "status"],
  note: "Nếu có migration chưa áp: chạy npm run db:migrate:deploy",
});

// ── Bước 3b: schema có khớp DB THẬT không ──────────────────────────────────
// `migrate status` chỉ so `_prisma_migrations` với thư mục migration, KHÔNG so
// schema với DB thật — nên nó báo "up to date" một cách sai lệch khi còn drift.
// CRM audit H11 đã tìm ra 2 drift thật bằng chính lệnh này (thiếu
// `currencies_code_key` ⇒ `POST /api/currencies` luôn 500; và index campaign
// có trong DB nhưng không có trong schema). Đây là bước RẺ nhất phát hiện drift.
step({
  title: "Migration — schema khớp DB thật (migrate diff)",
  cmd: npx,
  args: ["prisma", "migrate", "diff", "--from-url", process.env.DATABASE_URL || "", "--to-schema-datamodel", "prisma/schema.prisma", "--exit-code"],
  note: "Exit 2 = có drift cần migration mới (exit 0 = khớp, exit 1 = lỗi). Bỏ qua nếu chưa có DATABASE_URL.",
  optional: !process.env.DATABASE_URL,
});

// ── Bước 4: module load (bắt circular require / export undefined) ─────────
step({
  title: "Module load — circular require",
  cmd: npm,
  args: ["run", "check:modules"],
});

// ── Bước 5: unit test ────────────────────────────────────────────────────
step({ title: "Unit test (Jest)", cmd: npm, args: ["test"] });

// ── Bước 6: i18n key đồng bộ vi/en ────────────────────────────────────────
step({
  title: "i18n — key vi/en khớp nhau",
  cmd: npm,
  args: ["run", "check:i18n"],
  note: "Lệch key ⇒ UI hiện raw key hoặc rỗng",
});

// ── Bước 7-9: smoke trên DB thật ──────────────────────────────────────────
if (QUICK) {
  console.log(`\n${C.dim}     (bỏ smoke test — cần DB)${C.reset}`);
} else {
  step({
    title: "Smoke — CRM pipeline (schema + tenant scoping)",
    cmd: npm,
    args: ["run", "smoke:crm-pipeline"],
  });
  step({
    title: "Smoke — CRM Phase 2 (Lead → Deal → Order)",
    cmd: npm,
    args: ["run", "smoke:crm-phase2"],
  });
  step({
    title: "Smoke — CRM Phase 4 (campaign + hierarchy + insights)",
    cmd: npm,
    args: KEEP
      ? ["run", "smoke:crm-phase4-insights", "--", "--keep"]
      : ["run", "smoke:crm-phase4"],
    note: KEEP ? "--keep: giữ chỉ số RFM/CLV để xem trang FE" : undefined,
  });
}

// ── Bước cuối: cảnh báo cấu hình không chặn ───────────────────────────────
console.log(`\n${C.bold}${C.cyan}Cảnh báo cấu hình${C.reset}`);
{
  const trackingBase = process.env.TRACKING_BASE_URL || process.env.CLIENT_URL || "";
  if (!trackingBase) {
    warn(
      "Link tracking",
      "chưa đặt TRACKING_BASE_URL/CLIENT_URL ⇒ link từ chối trong email sẽ trỏ sai. " +
        "Đặt TRACKING_BASE_URL=https://<domain-cua-ban> trong .env production.",
    );
  } else if (/localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(trackingBase)) {
    warn(
      "Link tracking",
      `đang trỏ về ${trackingBase} ⇒ email gửi cho khách sẽ có link từ chối KHÔNG mở được. ` +
        "Đặt TRACKING_BASE_URL=https://<domain> khi deploy production.",
    );
  } else {
    console.log(`${C.green}     ✓ Link tracking: ${trackingBase}${C.reset}`);
  }

  if (!process.env.PAYOS_CLIENT_ID) {
    warn("PayOS", "chưa cấu hình ⇒ test luồng nâng cấp gói bị skip (không phải lỗi code).");
  }
  if (!process.env.SMTP_HOST) {
    warn("SMTP", "chưa cấu hình ⇒ email log ra console thay vì gửi thật.");
  }
}

// ── Tổng kết ──────────────────────────────────────────────────────────────
const hard = results.filter((r) => !r.ok && !r.optional);
const soft = results.filter((r) => !r.ok && r.optional);
const totalMs = results.reduce((s, r) => s + r.ms, 0);

console.log(`\n${C.bold}Tổng kết${C.reset}`);
for (const r of results) {
  const icon = r.ok ? `${C.green}✓${C.reset}` : r.optional ? `${C.yellow}!${C.reset}` : `${C.red}✗${C.reset}`;
  console.log(`  ${icon} ${r.title} ${C.dim}(${(r.ms / 1000).toFixed(1)}s)${C.reset}`);
}
console.log(
  `\n  ${results.length - hard.length - soft.length}/${results.length} pass · ` +
    `${(totalMs / 1000).toFixed(1)}s${QUICK ? " (quick)" : ""}`,
);

if (hard.length) {
  console.log(`${C.red}${C.bold}FAILED: ${hard.map((r) => r.title).join(" · ")}${C.reset}`);
  process.exit(1);
}
console.log(`${C.green}${C.bold}ALL PASS${C.reset}`);
process.exit(0);