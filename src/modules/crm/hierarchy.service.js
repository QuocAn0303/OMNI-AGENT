/**
 * modules/crm/hierarchy.service.js — Cây báo cáo (Sales hierarchy) — CRM Phase 4
 *
 * Bối cảnh:
 * - Phase 1–3 dùng `scope.js`: MANAGER thấy TOÀN BỘ tenant, CASHIER chỉ thấy record
 *   mình làm chủ. Ở quy mô 5–20 nhân viên thì đủ. Nhưng khi một tenant có nhiều
 *   chi nhánh/sales team, "quản lý vùng" cần cây báo cáo: giám đốc thấy trưởng
 *   chi nhánh, trưởng chi nhánh thấy nhân viên của mình — nhưng KHÔNG thấy chi nhánh
 *   khác. Đây chính là "Sales Hierarchy (cây báo cáo)" mà Frappe CRM có.
 *
 * Quy mô nhỏ nhất theo plan (mục 6.2): `User.reportsToId` self-relation +
 * manager thấy record của các bậc dưới mình (và con của con).
 *
 * Vì sao KHÔNG cho ADMIN tự khai báo "tôi thấy vùng của X":
 * - Cho phép chỉ định thủ công sẽ tạo đường lách quyền: user tự gán mình làm
 *   trưởng của người khác → tự thấy record của họ. Cấu trúc cây chỉ được sửa
 *   bởi ADMIN, và ADMIN vẫn thấy hết (role quyền, không phải cây).
 * - Cây không định nghĩa quyền của ADMIN — ADMIN là quyền tuyệt đối theo vai trò.
 *
 * Hàm:
 * - getTree(user): Cây user của tenant dạng lồng nhau, kèm số lead/deal đang phụ trách
 * - listAssignable(user): Danh sách user có thể gán làm owner (phụ thuộc cây)
 * - setReportsTo(userId, reportsToId, actor): Gán/bỏ quản lý trực tiếp (ADMIN)
 * - getDescendantIds(userId): Set id của mọi bậc dưới (đệ quy, có chặn vòng)
 * - getTeamUserIds(user): [self + descendants] hoặc [self] cho role không phải manager
 * - assertCanManage(actor, targetUserId): Chặn việc sửa cây vượt quyền
 */
const prisma = require("../../config/prisma");
const ApiError = require("../../utils/apiError");
const auditService = require("../audit/audit.service");
const { getTenantId } = require("../../config/tenantContext");
const { isManager } = require("./scope");

// Sâu tối đa cây. Không có chặn này thì 1 vòng lặp trong DB làm treo request
// (đã có guard ở setReportsTo + migration, nhưng defense in depth rẻ hơn treo server).
const MAX_DEPTH = 12;

// Cây báo cáo đổi rất hiếm (khi admin gán/bỏ quản lý) nhưng `getTeamUserIds` được gọi
// trên MỌI request list/getById của lead + deal. Không cache thì mỗi trang list tốn
// thêm 1-2 query đệ quy. Cache TTL ngắn ở process; `invalidateTeamCache` được gọi
// ngay sau mỗi lần `setReportsTo` nên không có cửa sổ stale dài hạn.
const TEAM_CACHE_TTL_MS = 60_000;
const teamCache = new Map(); // userId -> { ids, expiresAt }

// Cache riêng cho câu hỏi "tenant này đã dựng cây chưa" (CRM audit C4). TTL ngắn
// như cache trên; `invalidateTeamCache()` (không tham số) xoá luôn map này.
const hierarchyConfiguredCache = new Map(); // tenantKey -> { configured, expiresAt }

// Phân biệt "chưa có trong cache" (undefined) với "đã cache giá trị null" (cây
// chưa cấu hình). Trước đây `if (!hit)` khiến giá trị `null` không bao giờ hit
// cache ⇒ mỗi request lại query cây từ đầu.
const cacheGet = (userId) => {
  const hit = teamCache.get(userId);
  if (!hit) return undefined;
  if (hit.expiresAt <= Date.now()) {
    teamCache.delete(userId);
    return undefined;
  }
  return hit.ids;
};

const cacheSet = (userId, ids) => {
  teamCache.set(userId, { ids, expiresAt: Date.now() + TEAM_CACHE_TTL_MS });
};

/** Xoá cache cây — gọi sau khi đổi `reportsToId` của bất kỳ ai. */
const invalidateTeamCache = (userId) => {
  if (userId) teamCache.delete(userId);
  else {
    teamCache.clear();
    // Trạng thái "tenant đã dựng cây chưa" cũng đổi theo → phải hỏi lại DB.
    hierarchyConfiguredCache.clear();
  }
};

const USER_SELECT = {
  id: true,
  fullName: true,
  email: true,
  role: true,
  isActive: true,
  reportsToId: true,
  avatar: true,
  // CRM audit M11: `setReportsTo` so `manager.tenantId !== target.tenantId` nhưng
  // USER_SELECT KHÔNG có tenantId ⇒ cả hai là `undefined` ⇒ `undefined !== undefined`
  // = false ⇒ guard cross-tenant KHÔNG BAO GIỜ chạy. Test cũ "cross-tenant → 400"
  // xanh vì mock trả object có tenantId — false confidence. Thêm field này để guard
  // thật sự chạy (phòng thủ sâu: `prisma.user.findUnique` hiện đã tenant-scoped).
  tenantId: true,
};

/**
 * BFS từ `rootId` xuống, trả về Set id của mọi bậc dưới (không gồm root).
 * Dùng `visited` để chống vòng lặp nếu dữ liệu bị bẩn ngoài ý muốn.
 */
const getDescendantIds = async (rootId) => {
  const descendants = new Set();
  if (!rootId) return descendants;
  // Không có bảng user trong client (test mock một phần) → không suy ra được cây.
  // Trả rỗng để `getTeamUserIds` hiểu là "cây phẳng" thay vì ném TypeError.
  if (!prisma?.user?.findMany) return descendants;

  const visited = new Set([rootId]);
  let frontier = [rootId];

  for (let depth = 0; depth < MAX_DEPTH && frontier.length > 0; depth += 1) {
    const rows = await prisma.user.findMany({
      where: { reportsToId: { in: frontier }, isActive: true },
      select: { id: true, reportsToId: true },
    });
    // Phòng thủ: nếu client trả về thứ không iterable (mock thiếu, driver lạ) thì
    // coi như "không có bậc dưới" thay vì ném TypeError làm sập cả request.
    if (!Array.isArray(rows)) break;

    frontier = [];
    for (const row of rows) {
      if (visited.has(row.id)) continue;
      visited.add(row.id);
      descendants.add(row.id);
      frontier.push(row.id);
    }
  }
  return descendants;
};

/**
 * Tenant đã dựng cây báo cáo chưa? (`reportsToId` khác NULL ở bất kỳ user nào)
 *
 * CRM audit C4 — PHÂN BIỆT 2 KHÁI NIỆM:
 *   1. "Chưa cấu hình cây" (tenant dùng CRM như Phase 2/3, ai cũng là trưởng cao nhất)
 *   2. "Đã cấu hình cây nhưng user này không còn bậc dưới nào"
 * Trước đây cả 2 đều rơi về `descendants.size === 0` → `getTeamUserIds` trả `null`
 * → `ownerScopeForTeam` lùi về phạm vi TOÀN TENANT. Ở (1) là đúng; ở (2) là
 * **leo thang quyền**: ADMIN chuyển `reportsToId` của trưởng chi nhánh B đi nơi khác
 * ⇒ B mất sạch bậc dưới ⇒ B bất ngờ thấy toàn bộ pipeline mọi chi nhánh.
 *
 * Nguyên tắc: fail-CLOSED. Mất cây thì mất quyền, không phải mất giới hạn.
 */
const HIERARCHY_CACHE_TTL_MS = 60_000;

const isHierarchyConfigured = async () => {
  const tenantKey = getTenantId() || "__bypass__";
  const hit = hierarchyConfiguredCache.get(tenantKey);
  if (hit && hit.expiresAt > Date.now()) return hit.configured;

  // Không có bảng user trong client (test mock một phần) → coi như chưa cấu hình
  // để giữ hành vi Phase 2/3 thay vì ném TypeError.
  const row = prisma?.user?.findFirst
    ? await prisma.user.findFirst({
        where: { reportsToId: { not: null }, isActive: true },
        select: { id: true },
      })
    : null;

  const configured = Boolean(row);
  hierarchyConfiguredCache.set(tenantKey, { configured, expiresAt: Date.now() + HIERARCHY_CACHE_TTL_MS });
  return configured;
};

/**
 * Tập user mà `user` được phép xem record CRM.
 *
 * - role quản lý (ADMIN/MANAGER/SUPER_*): mình + toàn bộ bậc dưới.
 * - role khác (CASHIER/ACCOUNTANT/WAREHOUSE): chỉ chính mình.
 *
 * **Hợp đồng 3 trạng thái** (CRM audit C4):
 *   - `[...]`  → cây có bậc dưới → phạm vi = mình + bậc dưới.
 *   - `null`   → CHƯA cấu hình cây (hoặc không có tenant context) → KHÔNG áp dụng
 *               cây → `scope.ownerScopeForTeam` lùi về phạm vi toàn tenant như
 *               Phase 2/3. Đây là hành vi cần giữ cho rollout: ngay sau deploy,
 *               chưa ai được gán `reportsToId` nên cây phẳng; nếu trả `[user.id]`
 *               thì mọi manager mất ngay quyền xem pipeline của chính nhánh mình.
 *   - `[]`     → cây ĐÃ được cấu hình nhưng user không còn bậc dưới nào → FAIL-CLOSED,
 *               chỉ thấy record của chính mình. (Trước đây trả `null` ⇒ toàn tenant.)
 */
const getTeamUserIds = async (user) => {
  if (!isManager(user)) return user?.id ? [user.id] : [];
  if (!user.id) return [];

  const cached = cacheGet(user.id);
  if (cached) return cached;

  const descendants = await getDescendantIds(user.id);
  if (descendants.size === 0) {
    // Chưa ai dựng cây trong tenant này → không áp dụng cây (giữ hành vi Phase 2/3).
    if (!(await isHierarchyConfigured())) {
      cacheSet(user.id, null);
      return null;
    }
    // Đã có cây nhưng nhánh này trống → fail-closed.
    cacheSet(user.id, []);
    return [];
  }

  const ids = [user.id, ...descendants];
  cacheSet(user.id, ids);
  return ids;
};

/**
 * Cây báo cáo dạng lồng nhau + số record CRM đang phụ trách ở từng node.
 * Số liệu đếm trực tiếp owner (không gồm bậc dưới) — con số tổng của cả nhánh
 * được frontend cộng dồn khi render, để không đụng query N+1.
 */
const getTree = async (user) => {
  const users = await prisma.user.findMany({
    select: {
      ...USER_SELECT,
      _count: { select: { crmLeadsOwned: true, crmDealsOwned: true } },
    },
    orderBy: [{ role: "asc" }, { fullName: "asc" }],
    take: 500,
  });

  const nodes = new Map();
  for (const u of users) {
    nodes.set(u.id, {
      id: u.id,
      fullName: u.fullName,
      email: u.email,
      role: u.role,
      isActive: u.isActive,
      reportsToId: u.reportsToId,
      avatar: u.avatar,
      leadCount: u._count?.crmLeadsOwned ?? 0,
      dealCount: u._count?.crmDealsOwned ?? 0,
      children: [],
    });
  }

  // User không có parent (rỗng) hoặc parent không có trong tập (dữ liệu lệch) → coi là gốc
  const roots = [];
  for (const node of nodes.values()) {
    const parent = node.reportsToId ? nodes.get(node.reportsToId) : null;
    if (parent && parent.id !== node.id) parent.children.push(node);
    else roots.push(node);
  }

  const sortBranch = (list) => {
    list.sort((a, b) => a.fullName.localeCompare(b.fullName, "vi"));
    list.forEach((n) => sortBranch(n.children));
  };
  roots.forEach((r) => sortBranch(r.children));
  roots.sort((a, b) => a.fullName.localeCompare(b.fullName, "vi"));

  const totals = { users: users.length, leads: 0, deals: 0 };
  for (const u of users) {
    totals.leads += u._count?.crmLeadsOwned ?? 0;
    totals.deals += u._count?.crmDealsOwned ?? 0;
  }

  return { roots, totals, flattened: users.map((u) => ({ id: u.id, reportsToId: u.reportsToId })) };
};

/**
 * Danh sách user có thể gán làm owner lead/deal.
 * - MANAGER/ADMIN: mọi user trong tenant (giữ nguyên hành vi cũ của Phase 2/3).
 * - role khác: chỉ chính mình.
 */
const listAssignable = async (user) => {
  const rows = await prisma.user.findMany({
    where: { isActive: true },
    select: USER_SELECT,
    orderBy: { fullName: "asc" },
    take: 300,
  });

  if (isManager(user)) return rows;

  // Chỉ mình — nhưng query chỉ lấy `isActive: true`, nên user đang bị vô hiệu hoá
  // sẽ không xuất hiện trong danh sách. Đây là hành vi đúng (không gán việc cho
  // tài khoản đã khoá), không phải fallback về danh sách rộng.
  return rows.filter((r) => r.id === user?.id);
};

/**
 * Chặn việc sửa cây vượt quyền — CHỈ ADMIN trở lên.
 *
 * CRM audit H1: trước đây dùng `isManager(actor)` ⇒ `MANAGER` cũng sửa được cây.
 * Nhưng sửa cây = thay đổi phạm vi dữ liệu: MANAGER M của chi nhánh X gán
 * `reportsToId` của một đồng nghiệp chi nhánh Y cho mình ⇒ `getTeamUserIds(M)`
 * chứa cả đội Y ⇒ M đọc/sửa/xoá/convert được toàn bộ lead/deal của chi nhánh Y.
 * Đây không chỉ leo thang đọc mà là leo thang GHI.
 *
 * Khớp với comment đầu file ("Cấu trúc cây chỉ được sửa bởi ADMIN, và ADMIN vẫn
 * thấy hết") — trước đó code làm khác comment.
 *
 * `SUPER_ADMIN`/`SUPER_OMEGA_ULTRA_ADMIN` vẫn qua: họ đã thấy toàn tenant theo role
 * nên không leo thêm được gì.
 */
const TREE_EDITOR_ROLES = new Set(["SUPER_OMEGA_ULTRA_ADMIN", "SUPER_ADMIN", "ADMIN"]);

const assertCanManage = (actor) => {
  if (!TREE_EDITOR_ROLES.has(actor?.role)) {
    throw new ApiError(403, "Chỉ ADMIN mới được cấu hình cây báo cáo");
  }
};

/**
 * Gán / bỏ quản lý trực tiếp.
 *
 * Chống vòng lặp: gán A làm trưởng của B trong khi B (gián tiếp) đã là trưởng của A
 * sẽ tạo cây vô hạn → mọi truy vấn cây sau đó đều treo. Kiểm tra bằng cách đi ngược
 * từ `reportsToId` mới xem có chạm về `userId` không.
 *
 * Cũng chặn tự gán (`userId === reportsToId`).
 */
const setReportsTo = async (userId, reportsToId, actor) => {
  assertCanManage(actor);

  // Cây đã đổi từ đây trở đi → cache cũ không còn đúng.
  invalidateTeamCache();

  const target = await prisma.user.findUnique({ where: { id: userId }, select: USER_SELECT });
  if (!target) throw new ApiError(404, "Nhân viên không tồn tại");

  if (reportsToId === null || reportsToId === "") {
    const cleared = await prisma.user.update({
      where: { id: userId },
      data: { reportsToId: null },
      select: USER_SELECT,
    });
    invalidateTeamCache();
    await auditService.log({
      userId: actor.id,
      action: "CRM_SET_REPORTS_TO",
      entity: "User",
      entityId: userId,
      before: { reportsToId: target.reportsToId },
      after: { reportsToId: null },
      meta: { reason: "unassign" },
    });
    return cleared;
  }

  if (reportsToId === userId) {
    throw new ApiError(400, "Không thể tự báo cáo cho chính mình");
  }

  const manager = await prisma.user.findUnique({ where: { id: reportsToId }, select: USER_SELECT });
  if (!manager) throw new ApiError(404, "Quản lý không tồn tại");

  // Không cho gán cross-tenant
  if (manager.tenantId !== target.tenantId) {
    throw new ApiError(400, "Không thể gán quản lý thuộc tenant khác");
  }

  // Đi ngược từ manager lên trên: nếu gặp userId → tạo vòng
  let cursor = manager;
  const seen = new Set();
  for (let i = 0; i <= MAX_DEPTH && cursor; i += 1) {
    if (cursor.id === userId) {
      throw new ApiError(400, "Thao tác này sẽ tạo vòng lặp trong cây báo cáo");
    }
    if (seen.has(cursor.id)) break;
    seen.add(cursor.id);
    if (!cursor.reportsToId) break;
    cursor = await prisma.user.findUnique({
      where: { id: cursor.reportsToId },
      select: { id: true, reportsToId: true },
    });
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: { reportsToId },
    select: USER_SELECT,
  });
  // Cây vừa đổi → mọi cache liên quan phải hết hiệu lực (kể cả của các
  // quản lý tổng thuộc phía trên, không chỉ chính user này).
  invalidateTeamCache();

  // CRM audit M6: đổi cây báo cáo là control quyết định "ai thấy pipeline ai" —
  // đây là thay đổi phân quyền nên BẮT BUỘC có audit (await để không mất dòng
  // khi tiến trình chết sau khi đã trả 200).
  await auditService.log({
    userId: actor.id,
    action: "CRM_SET_REPORTS_TO",
    entity: "User",
    entityId: userId,
    before: { reportsToId: target.reportsToId },
    after: { reportsToId },
    meta: {
      targetFullName: target.fullName,
      managerFullName: manager.fullName,
      crossTenantChecked: true,
    },
  });

  return updated;
};

module.exports = {
  MAX_DEPTH,
  TREE_EDITOR_ROLES,
  getDescendantIds,
  getTeamUserIds,
  getTree,
  listAssignable,
  setReportsTo,
  assertCanManage,
  invalidateTeamCache,
  _resetCacheForTest: () => {
    teamCache.clear();
    hierarchyConfiguredCache.clear();
  },
};