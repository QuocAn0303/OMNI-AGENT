/**
 * tests/journal-entry-code.test.js
 *
 * KHOÁ HÀNH VI: sinh mã bút toán phải chống được CẢ HAI bẫy:
 *   1. LỖ HỔNG trong chuỗi (đã xoá/đảo bút toán) — `count + 1` sinh mã đã tồn tại.
 *   2. NHIỀU TENANT cùng ghi — `entryCode` unique TOÀN CỤC, nếu đọc bằng `findFirst`
 *      (bị extension lọc theo tenant) thì hai tenant cùng thấy `max` giống nhau.
 *
 * Cả hai đã xảy ra thật 2026-10-12:
 *   - 39 bút toán tenant demo (max 0039) + 18 dòng `tenantId = NULL` (0040..0057)
 *     ⇒ tenant demo sinh `0040` rồi đụng P2002, `smoke:grn-posting` rớt 16→11.
 *
 * Ghi chú: unit test ở đây KHÔNG đủ — bug này chỉ lộ ra trên DB thật khi có
 * dữ liệu thật của nhiều tenant. Xem `scripts/smoke-grn-posting.js`.
 */

jest.mock("../src/config/prisma", () => ({
  journalEntry: { findFirst: jest.fn() },
  // `generateEntryCode` đọc bằng raw SQL để không bị tenant extension lọc.
  $queryRawUnsafe: jest.fn(),
}));

const prisma = require("../src/config/prisma");
const { generateEntryCode } = require("../src/modules/accounting/journal.service");

const TODAY = new Date().toISOString().slice(0, 10).replace(/-/g, "");
const PREFIX = `JE-${TODAY}-`;

beforeEach(() => {
  prisma.$queryRawUnsafe.mockReset();
});

describe("generateEntryCode", () => {
  test("chưa có bút toán nào hôm nay → 0001", async () => {
    prisma.$queryRawUnsafe.mockResolvedValue([]);
    expect(await generateEntryCode(prisma)).toBe(`${PREFIX}0001`);
  });

  test("mã cao nhất là 0007 → 0008", async () => {
    prisma.$queryRawUnsafe.mockResolvedValue([{ entryCode: `${PREFIX}0007` }]);
    expect(await generateEntryCode(prisma)).toBe(`${PREFIX}0008`);
  });

  test("LỖ HỔNG: đã xoá JE-0003, JE-0009 còn → phải ra 0010 chứ không phải 0004", async () => {
    prisma.$queryRawUnsafe.mockResolvedValue([{ entryCode: `${PREFIX}0009` }]);
    const code = await generateEntryCode(prisma);
    expect(code).toBe(`${PREFIX}0010`);
    expect(code).not.toBe(`${PREFIX}0004`);
  });

  test("ĐỌC TOÀN CỤC, không lọc theo tenant (vì entryCode unique toàn cục)", async () => {
    prisma.$queryRawUnsafe.mockResolvedValue([{ entryCode: `${PREFIX}0057` }]);
    const code = await generateEntryCode(prisma);
    // Nếu bị lọc theo tenant, tenant demo (max 0039) sẽ sinh 0040 và đụng dòng
    // `tenantId = NULL` đã chiếm 0040..0057.
    expect(code).toBe(`${PREFIX}0058`);
    // Truy vấn KHÔNG được thêm điều kiện tenantId — đó là toàn bộ ý nghĩa.
    const sql = prisma.$queryRawUnsafe.mock.calls[0][0];
    expect(sql).not.toMatch(/tenantId/i);
  });

  test("sắp xếp giảm dần theo MÃ để lấy số thứ tự lớn nhất", async () => {
    prisma.$queryRawUnsafe.mockResolvedValue([{ entryCode: `${PREFIX}0012` }]);
    await generateEntryCode(prisma);
    const sql = prisma.$queryRawUnsafe.mock.calls[0][0];
    expect(sql).toMatch(/ORDER BY "entryCode" DESC/);
  });
});