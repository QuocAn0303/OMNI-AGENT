/**
 * scripts/lib/cleanup-registry.js — Ghi nhớ dữ liệu đã tạo để dọn dẹp
 *
 * Script kiểm chứng tạo tenant/user/product thật rồi xoá. Hai đường thoát
 * không kiểm soát được: tiến trình bị Ctrl+C, và lỗi ném ra ngoài try/catch.
 * `finally` không cứu được trường hợp đó — dữ liệu sẽ nằm lại trong DB.
 *
 * Cách dùng:
 *   const { track, cleanup } = require("./lib/cleanup-registry");
 *   const t = await prisma.tenant.create({ data: {...} });
 *   track(() => prisma.tenant.deleteMany({ where: { id: t.id } }));
 *   ...
 *   await cleanup();          // gọi trong finally
 *
 * `cleanup()` chạy theo thứ tự đảo ngược (xóa con trước, cha sau) và chỉ
 * chạy mỗi callback một lần. Lỗi của một callback không chặn các callback
 * còn lại.
 */

const steps = [];
let running = false;

/** Đăng ký một bước dọn dẹp. */
const track = (fn) => {
  if (typeof fn === "function") steps.push(fn);
};

/** Xóa mọi dữ liệu đã đăng ký, theo thứ tự ngược. Không ném lỗi. */
const cleanup = async () => {
  if (running) return;
  running = true;
  while (steps.length) {
    const step = steps.pop();
    try {
      await step();
    } catch (e) {
      console.error("Khong cleanup duoc:", e.message);
    }
  }
  running = false;
};

/** Gắt xử lý Ctrl+C / tín hiệu dừng để không bỏ lại dữ liệu. */
const installSignalHandlers = (label) => {
  const bail = async (signal) => {
    console.error(`\n[${label}] nhan ${signal} — dang don dep du lieu test...`);
    await cleanup();
    process.exit(130);
  };
  process.on("SIGINT", () => bail("SIGINT"));
  process.on("SIGTERM", () => bail("SIGTERM"));
};

module.exports = { track, cleanup, installSignalHandlers };