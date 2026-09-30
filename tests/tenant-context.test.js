const { tenantStorage, getTenantId, isBypassTenant, runWithTenant } = require("../src/config/tenantContext");

/**
 * Hồi quy: runWithTenant phải giữ được tenant context khi callback trả về promise.
 *
 * Trước đây runWithTenant = tenantStorage.run(ctx, fn). Với call site dạng
 * `runWithTenant(t, () => service())` (arrow đồng bộ), các nhánh async của promise
 * được tạo ngoài AsyncLocalStorage frame → getTenantId() trả null → Prisma
 * extension KHÔNG inject tenantId → rò rỉ dữ liệu giữa các tenant.
 *
 * Fix: wrapper là `async () => await fn()`.
 *
 * Test này dùng chính AsyncLocalStorage + extension của Prisma? Không — không mock
 * DB. Thay vào đó mô phỏng đúng cơ chế: đọc context ở trong một promise được tạo
 * bởi hàm trả về promise, đúng như cách Prisma extension đọc getTenantId().
 */

jest.mock("../src/config/prisma", () => ({}));

const prismaExt = require("../src/config/prisma");

// Mô phỏng $allOperations: đọc getTenantId() ở điểm extension được gọi
const simulatedExtension = async () => getTenantId();

beforeEach(() => jest.clearAllMocks());

describe("tenantContext.runWithTenant", () => {
  test("giữ context khi callback trả promise qua arrow đồng bộ", async () => {
    const service = () => simulatedExtension(); // trả về promise, không phải async fn

    const seen = await runWithTenant("tenant-A", () => service());

    expect(seen).toBe("tenant-A");
  });

  test("giữ context khi callback là async function", async () => {
    const service = async () => {
      await Promise.resolve();
      return getTenantId();
    };

    expect(await runWithTenant("tenant-A", service)).toBe("tenant-A");
  });

  test("context lồng nhau: khung trong đè đè khung ngoài", async () => {
    const inner = await runWithTenant("tenant-B", () =>
      (async () => {
        await Promise.resolve();
        return getTenantId();
      })(),
    );
    expect(inner).toBe("tenant-B");

    // sau khi khung trong kết thúc, context ngoài được khôi phục
    const after = await runWithTenant("tenant-A", async () => {
      await runWithTenant("tenant-B", async () => {
        await Promise.resolve();
      });
      return getTenantId();
    });
    expect(after).toBe("tenant-A");
  });

  test("trả về đúng giá trị cho callback đồng bộ (không phải promise)", async () => {
    expect(await runWithTenant("tenant-A", () => "giá trị")).toBe("giá trị");
    expect(await runWithTenant("tenant-A", () => 42)).toBe(42);
  });

  test("giữ context qua nhiều tầng await (mô phỏng chuỗi Prisma)", async () => {
    const deep = async () => {
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
      return getTenantId();
    };

    expect(await runWithTenant("tenant-A", () => deep())).toBe("tenant-A");
  });

  test("lỗi trong callback được ném ra, không nuốt", async () => {
    await expect(
      runWithTenant("tenant-A", async () => { throw new Error("boom"); }),
    ).rejects.toThrow("boom");

    await expect(
      runWithTenant("tenant-A", () => Promise.reject(new Error("boom2"))),
    ).rejects.toThrow("boom2");
  });

  test("bypass = true thì isBypassTenant trả true", async () => {
    const seen = await runWithTenant("tenant-A", async () => isBypassTenant(), true);
    expect(seen).toBe(true);
  });

  test("bypass mặc định false", async () => {
    const seen = await runWithTenant("tenant-A", async () => isBypassTenant());
    expect(seen).toBe(false);
  });

  test("ngoài runWithTenant thì getTenantId trả null", () => {
    expect(getTenantId()).toBeNull();
  });

  test("không rò context sang lần gọi sau", async () => {
    await runWithTenant("tenant-A", async () => { await Promise.resolve(); });
    expect(getTenantId()).toBeNull();
    expect(await runWithTenant("tenant-B", () => simulatedExtension())).toBe("tenant-B");
    expect(getTenantId()).toBeNull();
  });

  test("tenantStorage.getStore trả undefined ngoài context", () => {
    expect(tenantStorage.getStore()).toBeUndefined();
  });
});

// giữ tham chiếu prisma để eslint/jest không báo unused
void prismaExt;
