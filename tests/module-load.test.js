/**
 * tests/module-load.test.js — chống "app không boot được"
 *
 * Bug thật đã xảy ra (commit ee6d6c0): src/modules/orders/invoice.service.js đặt
 * `module.exports = { ..., list }` TRƯỚC `const list = async ...` → ReferenceError (TDZ)
 * ngay khi require → `npm run dev` chết trước khi lên cổng, trong khi unit test khác vẫn xanh
 * vì không ai require file này.
 *
 * Việc load 184 module được chạy BẰNG NODE THẬT qua scripts/check-module-load.js, KHÔNG
 * require trong Jest: dep ESM-only (otplib v13) require được bởi Node >=22.12 nhưng không
 * được bởi Jest 29 → require trong Jest sẽ báo sai rằng "app không boot được".
 */
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const SCRIPT = path.join(ROOT, "scripts", "check-module-load.js");

describe("Module load — app phải boot được", () => {
  test("mọi *.service.js / *.routes.js dưới src/modules load được (chạy bằng Node thật)", () => {
    let stdout = "";
    try {
      stdout = execFileSync(process.execPath, [SCRIPT], {
        cwd: ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 20 * 1024 * 1024,
      });
    } catch (e) {
      const status = e.status ?? 1;
      throw new Error(
        `scripts/check-module-load.js thất bại (exit ${status}):\n${e.stdout || ""}${e.stderr || ""}`,
      );
    }
    expect(stdout).toContain("module load được");
  });

  test("orders/invoice.service.js export đủ hàm, gồm list (bug TDZ đã sửa)", () => {
    const invoiceService = require("../src/modules/orders/invoice.service");
    for (const fn of ["generateInvoice", "generateInvoicePDF", "getById", "sendEmail", "list"]) {
      expect(typeof invoiceService[fn]).toBe("function");
    }
  });
});
