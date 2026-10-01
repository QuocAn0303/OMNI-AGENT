/**
 * tests/crm-hierarchy.test.js — Test cây báo cáo (Sales hierarchy) — CRM Phase 4
 *
 * Trọng tâm:
 * - `getDescendantIds` BFS: lấy đúng mọi bậc dưới (không chỉ con trực tiếp).
 * - **Chống vòng lặp** — đây là rủi ro sập server: 1 vòng trong `reportsToId`
 *   làm mọi truy vấn cây đệ quy treo vô tận.
 * - `getTeamUserIds` trả `null` khi cây phẳng → hành vi Phase 2/3 giữ nguyên
 *   (nếu trả `[self]` thì mọi manager mất quyền xem ngay sau khi deploy).
 * - `setReportsTo`: chặn tự gán, chặn vòng, chặn cross-tenant, chặn sai quyền.
 * - Cache phải hết hiệu lực sau khi đổi cây — nếu không, admin gán xong vẫn thấy
 *   phạm vi cũ (test này chặn đúng lỗi đó).
 */
const mockClient = {
  user: {
    findMany: jest.fn(),
    // C4: getTeamUserIds hỏi "tenant đã dựng cây chưa" bằng findFirst
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
};

jest.mock("../src/config/prisma", () => mockClient);
jest.mock("../src/modules/audit/audit.service", () => ({ log: jest.fn().mockResolvedValue(undefined) }));

const hierarchy = require("../src/modules/crm/hierarchy.service");

const MANAGER = { id: "u-boss", role: "MANAGER" };
const ADMIN = { id: "u-admin", role: "ADMIN" };
const CASHIER = { id: "u-cashier", role: "CASHIER" };

const U = (id, reportsToId = null, over = {}) => ({
  id,
  fullName: `User ${id}`,
  email: `${id}@x.vn`,
  role: "CASHIER",
  isActive: true,
  reportsToId,
  avatar: null,
  tenantId: "t1",
  ...over,
});

const withCount = (u) => ({ ...u, _count: { crmLeadsOwned: 0, crmDealsOwned: 0 } });

describe("crm/hierarchy.service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    hierarchy._resetCacheForTest();
    mockClient.user.findMany.mockResolvedValue([]);
    mockClient.user.findFirst.mockResolvedValue(null);
    mockClient.user.findUnique.mockResolvedValue(null);
  });

  describe("getDescendantIds", () => {
    test("không root → rỗng", async () => {
      expect((await hierarchy.getDescendantIds(null)).size).toBe(0);
    });

    test("bậc dưới 1 tầng", async () => {
      mockClient.user.findMany.mockResolvedValueOnce([{ id: "u-a", reportsToId: "u-boss" }]);
      expect([...await hierarchy.getDescendantIds("u-boss")]).toEqual(["u-a"]);
    });

    test("bậc dưới N tầng (con của con)", async () => {
      mockClient.user.findMany
        .mockResolvedValueOnce([{ id: "u-a", reportsToId: "u-boss" }])
        .mockResolvedValueOnce([{ id: "u-b", reportsToId: "u-a" }])
        .mockResolvedValueOnce([{ id: "u-c", reportsToId: "u-b" }]);
      expect([...await hierarchy.getDescendantIds("u-boss")].sort()).toEqual(["u-a", "u-b", "u-c"]);
    });

    test("VÒNG LẶP trong DB → không treo, trả kết quả đã gặp", async () => {
      // u-a → u-boss, u-boss → u-a: BFS phải dừng nhờ `visited`
      mockClient.user.findMany
        .mockResolvedValueOnce([{ id: "u-a", reportsToId: "u-boss" }])
        .mockResolvedValueOnce([{ id: "u-boss", reportsToId: "u-a" }])
        .mockResolvedValueOnce([{ id: "u-a", reportsToId: "u-boss" }]);
      const out = await hierarchy.getDescendantIds("u-boss");
      expect([...out]).toEqual(["u-a"]);
    });

    test("cây sâu hơn MAX_DEPTH → cắt, không treo", async () => {
      mockClient.user.findMany.mockImplementation(async ({ where }) => {
        const parent = where.reportsToId.in[0];
        const n = Number(String(parent).replace(/\D/g, "")) + 1;
        return [{ id: `u-${n}`, reportsToId: parent }];
      });
      const out = await hierarchy.getDescendantIds("u-0");
      expect(out.size).toBeLessThanOrEqual(hierarchy.MAX_DEPTH);
      // root không bao giờ nằm trong tập bậc dưới
      expect(out.has("u-0")).toBe(false);
    });

    test("client không có bảng user (mock thiếu) → rỗng, không ném", async () => {
      const saved = mockClient.user;
      mockClient.user = undefined;
      await expect(hierarchy.getDescendantIds("u-boss")).resolves.toBeInstanceOf(Set);
      mockClient.user = saved;
    });

    test("driver trả về thứ không iterable → dừng, không ném TypeError", async () => {
      mockClient.user.findMany.mockResolvedValueOnce(undefined);
      await expect(hierarchy.getDescendantIds("u-boss")).resolves.toBeInstanceOf(Set);
    });
  });

  describe("getTeamUserIds", () => {
    test("CASHIER → chỉ chính mình", async () => {
      expect(await hierarchy.getTeamUserIds(CASHIER)).toEqual(["u-cashier"]);
      expect(mockClient.user.findMany).not.toHaveBeenCalled();
    });

    test("không user → rỗng", async () => {
      expect(await hierarchy.getTeamUserIds(null)).toEqual([]);
    });

    test("MANAGER cây phẳng → null (giữ hành vi toàn tenant của Phase 2/3)", async () => {
      // findFirst = null ⇒ tenant CHƯA dựng cây ⇒ null (không áp dụng cây)
      mockClient.user.findMany.mockResolvedValue([]);
      expect(await hierarchy.getTeamUserIds(MANAGER)).toBeNull();
    });

    // CRM audit C4: phải phân biệt "chưa cấu hình cây" với "đã cấu hình nhưng
    // nhánh trống". Trường hợp 2 trả `null` trước đây ⇒ manager mất hết bậc dưới
    // là bất ngờ thấy TOÀN TENANT (fail-open / leo thang quyền).
    test("C4: cây ĐÃ cấu hình nhưng user không còn bậc dưới → [] (fail-closed)", async () => {
      mockClient.user.findMany.mockResolvedValue([]); // không có bậc dưới
      mockClient.user.findFirst.mockResolvedValue({ id: "u-x" }); // nhưng tenant CÓ cây
      expect(await hierarchy.getTeamUserIds(MANAGER)).toEqual([]);
    });

    test("C4: bậc dưới bị vô hiệu hoá (isActive=false) không tính vào cây", async () => {
      // getDescendantIds phải lọc isActive — nếu không, user khoá vẫn giữ bậc dưới
      // và cây không bao giờ rỗng (fail-open không kích hoạt được).
      mockClient.user.findMany.mockResolvedValue([]);
      mockClient.user.findFirst.mockResolvedValue({ id: "u-x" });
      await hierarchy.getTeamUserIds(MANAGER);
      expect(mockClient.user.findMany.mock.calls[0][0].where).toEqual(
        expect.objectContaining({ isActive: true }),
      );
    });

    test("MANAGER có cây → [mình + bậc dưới]", async () => {
      mockClient.user.findMany.mockResolvedValue([{ id: "u-a", reportsToId: "u-boss" }]);
      expect(await hierarchy.getTeamUserIds(MANAGER)).toEqual(["u-boss", "u-a"]);
    });

    test("cache: gọi lại trong TTL không query thêm", async () => {
      mockClient.user.findMany.mockResolvedValue([{ id: "u-a", reportsToId: "u-boss" }]);
      await hierarchy.getTeamUserIds(MANAGER);
      const afterFirst = mockClient.user.findMany.mock.calls.length;
      await hierarchy.getTeamUserIds(MANAGER);
      expect(mockClient.user.findMany.mock.calls.length).toBe(afterFirst);
    });

    test("sau TTL thì query lại (cây có thể đã đổi)", async () => {
      jest.useFakeTimers();
      try {
        mockClient.user.findMany.mockResolvedValue([{ id: "u-a", reportsToId: "u-boss" }]);
        await hierarchy.getTeamUserIds(MANAGER);
        const afterFirst = mockClient.user.findMany.mock.calls.length;
        jest.advanceTimersByTime(61_000);
        await hierarchy.getTeamUserIds(MANAGER);
        expect(mockClient.user.findMany.mock.calls.length).toBeGreaterThan(afterFirst);
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe("setReportsTo", () => {
    beforeEach(() => {
      mockClient.user.update.mockImplementation(async ({ where, data }) => U(where.id, data.reportsToId));
    });

    test("CASHIER bị chặn 403", async () => {
      await expect(hierarchy.setReportsTo("u-a", "u-boss", CASHIER)).rejects.toMatchObject({ status: 403 });
    });

    test("không có quyền → 403 (SUPER_OMEGA cũng qua vì đã ở set)", async () => {
      await expect(hierarchy.setReportsTo("u-a", "u-boss", { id: "x", role: "WAREHOUSE" }))
        .rejects.toMatchObject({ status: 403 });
    });

    // CRM audit H1: sửa cây = thay đổi "ai thấy pipeline ai". MANAGER tự gán mình
    // làm trưởng của người khác sẽ thu được phạm vi chi nhánh khác (leo thang cả
    // quyền GHI) → phải chặn.
    test("MANAGER sửa cây → 403 (leo thang quyền liên chi nhánh)", async () => {
      mockClient.user.findUnique.mockReset();
      mockClient.user.findUnique.mockResolvedValue(U("u-a"));
      await expect(hierarchy.setReportsTo("u-a", "u-boss", MANAGER)).rejects.toMatchObject({ status: 403 });
      expect(mockClient.user.update).not.toHaveBeenCalled();
    });

    test("SUPER_ADMIN / SUPER_OMEGA vẫn sửa được (đã thấy toàn tenant theo role)", async () => {
      mockClient.user.findUnique.mockReset();
      mockClient.user.findUnique
        .mockResolvedValueOnce(U("u-a"))
        .mockResolvedValueOnce(U("u-boss"))
        .mockResolvedValueOnce(null);
      await expect(hierarchy.setReportsTo("u-a", "u-boss", { id: "s", role: "SUPER_ADMIN" })).resolves.toBeDefined();

      mockClient.user.findUnique.mockReset();
      mockClient.user.findUnique
        .mockResolvedValueOnce(U("u-a"))
        .mockResolvedValueOnce(U("u-boss"))
        .mockResolvedValueOnce(null);
      await expect(
        hierarchy.setReportsTo("u-a", "u-boss", { id: "o", role: "SUPER_OMEGA_ULTRA_ADMIN" }),
      ).resolves.toBeDefined();
    });

    test("user không tồn tại → 404", async () => {
      mockClient.user.findUnique.mockResolvedValue(null);
      await expect(hierarchy.setReportsTo("u-a", "u-boss", ADMIN)).rejects.toMatchObject({ status: 404 });
    });

    test("quản lý không tồn tại → 404", async () => {
      mockClient.user.findUnique
        .mockResolvedValueOnce(U("u-a"))
        .mockResolvedValueOnce(null);
      await expect(hierarchy.setReportsTo("u-a", "u-ghost", ADMIN)).rejects.toMatchObject({ status: 404 });
    });

    test("tự gán mình → 400", async () => {
      mockClient.user.findUnique.mockResolvedValue(U("u-boss"));
      await expect(hierarchy.setReportsTo("u-boss", "u-boss", ADMIN)).rejects.toMatchObject({ status: 400 });
    });

    test("cross-tenant → 400", async () => {
      mockClient.user.findUnique
        .mockResolvedValueOnce(U("u-a", null, { tenantId: "t1" }))
        .mockResolvedValueOnce(U("u-boss", null, { tenantId: "t2" }));
      await expect(hierarchy.setReportsTo("u-a", "u-boss", ADMIN)).rejects.toMatchObject({ status: 400 });
    });

    test("gán hợp lệ → update + xoá cache cây", async () => {
      mockClient.user.findUnique.mockReset();
      mockClient.user.findUnique
        .mockResolvedValueOnce(U("u-a"))          // target
        .mockResolvedValueOnce(U("u-boss"))      // manager
        .mockResolvedValueOnce(null);            // manager không có cha → dừng
      const out = await hierarchy.setReportsTo("u-a", "u-boss", ADMIN);
      expect(out.reportsToId).toBe("u-boss");
      expect(mockClient.user.update).toHaveBeenCalledWith({
        where: { id: "u-a" }, data: { reportsToId: "u-boss" }, select: expect.any(Object),
      });
    });

    test("bỏ quản lý (null) → reportsToId = null", async () => {
      // mockReset vì các test trước đã xếp hàng findUnique — hàng đó có thể còn dư
      mockClient.user.findUnique.mockReset();
      mockClient.user.findUnique.mockResolvedValue(U("u-a"));
      const out = await hierarchy.setReportsTo("u-a", null, ADMIN);
      expect(out.reportsToId).toBeNull();
    });

    test("VÒNG LẶP: gán A làm trưởng của B khi B đã là trưởng của A → 400", async () => {
      // target = u-a; manager = u-boss, nhưng u-boss đang báo cáo cho u-a
      mockClient.user.findUnique
        .mockResolvedValueOnce(U("u-a"))                                  // target
        .mockResolvedValueOnce(U("u-boss", "u-a"))                        // manager, cha = u-a
        .mockResolvedValueOnce(U("u-a"));                                 // đi lên gặp u-a → vòng
      await expect(hierarchy.setReportsTo("u-a", "u-boss", ADMIN))
        .rejects.toMatchObject({ status: 400 });
      expect(mockClient.user.update).not.toHaveBeenCalled();
    });

    test("vòng dài 3 tầng vẫn bị chặn", async () => {
      mockClient.user.findUnique
        .mockResolvedValueOnce(U("u-a"))        // target
        .mockResolvedValueOnce(U("u-boss", "u-b"))
        .mockResolvedValueOnce(U("u-b", "u-a"))
        .mockResolvedValueOnce(U("u-a"));       // chạm u-a → vòng
      await expect(hierarchy.setReportsTo("u-a", "u-boss", ADMIN))
        .rejects.toMatchObject({ status: 400 });
    });

    test("dữ liệu bẩn tự vòng ở nhánh khác → vẫn thoát, không treo", async () => {
      mockClient.user.findUnique
        .mockResolvedValueOnce(U("u-a"))
        .mockResolvedValueOnce(U("u-boss", "u-z"))   // cha của boss
        .mockResolvedValueOnce(U("u-z", "u-boss"))   // z ↔ boss: vòng, nhưng không phải u-a
        .mockResolvedValueOnce(U("u-boss", "u-z"))
        .mockResolvedValueOnce(U("u-z", "u-boss"))
        .mockResolvedValueOnce(U("u-boss", "u-z"))
        .mockResolvedValueOnce(U("u-z", "u-boss"));
      // `seen` phát hiện lặp → break, cho phép gán (không tạo vòng MỚI)
      await expect(hierarchy.setReportsTo("u-a", "u-boss", ADMIN)).resolves.toBeDefined();
    });

    test("đổi cây → cache cũ không còn dùng", async () => {
      mockClient.user.findMany.mockResolvedValue([{ id: "u-a", reportsToId: "u-boss" }]);
      expect(await hierarchy.getTeamUserIds(MANAGER)).toEqual(["u-boss", "u-a"]);
      const callsBefore = mockClient.user.findMany.mock.calls.length;

      mockClient.user.findUnique
        .mockResolvedValueOnce(U("u-a"))
        .mockResolvedValueOnce(U("u-boss"))
        .mockResolvedValueOnce(null);
      await hierarchy.setReportsTo("u-a", null, ADMIN);

      // Truy vấn lại phải hit DB (cache đã bị xoá), không trả kết quả cũ
      mockClient.user.findMany.mockResolvedValue([]);
      expect(await hierarchy.getTeamUserIds(MANAGER)).toBeNull();
      expect(mockClient.user.findMany.mock.calls.length).toBeGreaterThan(callsBefore);
    });
  });

  describe("getTree", () => {
    test("dựng cây lồng nhau từ reportsToId", async () => {
      mockClient.user.findMany.mockResolvedValue([
        withCount(U("boss", null, { role: "ADMIN" })),
        withCount(U("mgr", "boss")),
        withCount(U("staff", "mgr")),
      ]);
      const { roots, totals } = await hierarchy.getTree(MANAGER);
      expect(roots).toHaveLength(1);
      expect(roots[0].id).toBe("boss");
      expect(roots[0].children[0].id).toBe("mgr");
      expect(roots[0].children[0].children[0].id).toBe("staff");
      expect(totals.users).toBe(3);
    });

    test("nhiều gốc khi chưa gán ai", async () => {
      mockClient.user.findMany.mockResolvedValue([
        withCount(U("a", null)), withCount(U("b", null)), withCount(U("c", null)),
      ]);
      const { roots } = await hierarchy.getTree(MANAGER);
      expect(roots.map((r) => r.id).sort()).toEqual(["a", "b", "c"]);
    });

    test("parent không có trong danh sách → user đó thành gốc (không rơi mất)", async () => {
      mockClient.user.findMany.mockResolvedValue([withCount(U("orphan", "ghost"))]);
      const { roots } = await hierarchy.getTree(MANAGER);
      expect(roots.map((r) => r.id)).toEqual(["orphan"]);
    });

    test("self-reference → coi là gốc, không tạo children vô hạn", async () => {
      mockClient.user.findMany.mockResolvedValue([withCount(U("self", "self"))]);
      const { roots } = await hierarchy.getTree(MANAGER);
      expect(roots).toHaveLength(1);
      expect(roots[0].children).toHaveLength(0);
    });

    test("cộng dồn số lead/deal", async () => {
      // `withCount` phải đặt SAU spread của _count, nếu không sẽ bị ghi đè về 0
      mockClient.user.findMany.mockResolvedValue([
        { ...U("a"), _count: { crmLeadsOwned: 3, crmDealsOwned: 1 } },
        { ...U("b"), _count: { crmLeadsOwned: 4, crmDealsOwned: 2 } },
      ]);
      const { totals } = await hierarchy.getTree(MANAGER);
      expect(totals).toMatchObject({ users: 2, leads: 7, deals: 3 });
    });
  });

  describe("listAssignable", () => {
    test("MANAGER → mọi user đang hoạt động", async () => {
      mockClient.user.findMany.mockResolvedValue([U("a"), U("b")]);
      expect(await hierarchy.listAssignable(MANAGER)).toHaveLength(2);
    });

    test("CASHIER → chỉ chính mình", async () => {
      // Query lấy `isActive: true`; user của CASHIER phải nằm trong tập đó
      mockClient.user.findMany.mockResolvedValue([U("a"), U(CASHIER.id)]);
      const out = await hierarchy.listAssignable(CASHIER);
      expect(out).toHaveLength(1);
      expect(out[0].id).toBe("u-cashier");
    });

    test("CASHIER không thấy người khác dù query trả về cả danh sách", async () => {
      mockClient.user.findMany.mockResolvedValue([U("boss"), U("a"), U(CASHIER.id)]);
      const out = await hierarchy.listAssignable(CASHIER);
      expect(out.map((r) => r.id)).toEqual(["u-cashier"]);
    });
  });
});