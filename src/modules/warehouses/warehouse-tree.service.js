/**
 * modules/warehouses/warehouse-tree.service.js — CÂY VỊ TRÍ TRONG KHO (Odoo location)
 *
 * VÌ SAO CẦN
 * `Warehouse` trước đây là danh sách phẳng: một kho một dòng, không có "kho mẹ /
 * kho con", không phân biệt vị trí chứa hàng thật với vị trí trung gian của
 * luồng nhiều bước. Odoo dùng `stock.location` làm cây — mỗi kho có vị trí
 * nhập / lưu / xuất / lấy hàng, và có `usage` để biết chỗ nào thực sự chứa hàng.
 *
 * THIẾT KẾ AN TOÀN
 * Không tạo bảng mới. Mọi kho đã có mặc định `PHYSICAL` nên **hành vi không đổi**:
 * `Inventory`, GRN, lot, serial, chuyển kho, lệnh sản xuất vẫn tham chiếu
 * `warehouseId` như cũ. Cây chỉ là lớp tổ chức THÊM, không phải điều kiện để có
 * tồn kho.
 *
 * BA LUẬT ĐƯỢC GIỮ — vi phạm là mất tiền hoặc lộ dữ liệu:
 *   1. Chỉ `PHYSICAL` mới có tồn kho. `VIEW`/`INTERNAL` ghi tồn kho sẽ làm
 *      tổng tồn trong báo cáo sai ngay.
 *   2. Không cho tạo vòng lặp trong cây. Duyệt đệ quy gặp vòng là không bao giờ dừng,
 *      treo cả request.
 *   3. Xoá kho cha còn kho con bị DB chặn (`ON DELETE RESTRICT`) — không chặn thì
 *      mất luôn kho con và tồn kho trong đó.
 */
const prisma = require("../../config/prisma");
const auditService = require("../audit/audit.service");
const logger = require("../../utils/logger");

const LOCATION_TYPES = ["PHYSICAL", "VIEW", "INTERNAL"];
/** Chỉ vị trí thật mới chứa hàng. */
const STOCK_TYPES = ["PHYSICAL"];

const toNum = (v) => Number(v || 0);

/** Mã vị trí duy nhất trong cây: mã cha + "/" + mã con. */
const buildPath = (parentPath, code) => (parentPath ? `${parentPath}/${code}` : code);

/** Nút gốc = kho không có cha. */
const ROOT_PARENT = null;

/**
 * Lấy cây vị trí của một kho (mặc định hoặc kho cụ thể).
 *
 * Trả về cây đã tính sẵn `totalQuantity` (gồm cả vị trí con) để UI hiện tổng
 * mà không phải cộng tay, và `onHandHere` để phân biệt "tồn ở chính vị trí này"
 * với "tồn của cả nhánh".
 */
const INVENTORY_SELECT = {
  quantity: true,
  reserved: true,
  product: { select: { id: true, sku: true, name: true, unit: true } },
};

/** Tải TOÀN BỘ vị trí con (mọi cấp) của một kho gốc. */
const loadDescendants = async (rootId, client) => {
  const rows = await client.$queryRawUnsafe(
    `WITH RECURSIVE t(id) AS (
       SELECT id FROM warehouses WHERE id = $1
       UNION ALL SELECT w.id FROM warehouses w JOIN t ON w."parentId" = t.id
     ) SELECT id FROM t WHERE id <> $1`,
    rootId,
  );
  const ids = rows.map((r) => r.id);
  if (!ids.length) return [];
  // `ANY` với mảng rỗng trả về false ⇒ không cần nhánh đặc biệt.
  return client.warehouse.findMany({
    where: { id: { in: ids } },
    select: {
      id: true, code: true, name: true, locationType: true, parentId: true, path: true,
      isActive: true,
      inventories: { select: INVENTORY_SELECT },
    },
    orderBy: { code: "asc" },
  });
};

const getTree = async (warehouseId, client = prisma) => {
  const root = await client.warehouse.findUnique({
    where: { id: warehouseId },
    include: { inventories: { select: INVENTORY_SELECT } },
  });
  if (!root) throw { status: 404, message: "Không tìm thấy kho" };

  // Mọi cấp, không chỉ cấp con trực tiếp — bản đầu lọc `parentId = rootId` nên
  // vị trí cấp 2 trở đi rơi ra khỏi cây và `totalQuantity` báo sai.
  const all = await loadDescendants(warehouseId, client);

  const build = (node) => {
    const children = all.filter((c) => c.parentId === node.id).map(build);
    const ownQty = (node.inventories || []).reduce((s, i) => s + toNum(i.quantity), 0);
    const childTotal = children.reduce((s, c) => s + c.totalQuantity, 0);
    return {
      id: node.id,
      code: node.code,
      name: node.name,
      locationType: node.locationType,
      path: node.path,
      isActive: node.isActive,
      canHoldStock: STOCK_TYPES.includes(node.locationType),
      onHandHere: ownQty,
      totalQuantity: ownQty + childTotal,
      // Chỉ vị trí thật mới gán tồn kho. `VIEW` là góc nhìn gộp nên
      // `onHandHere` của nó là số tổng của nhánh, KHÔNG phải hàng ở đó.
      skus: (node.inventories || [])
        .filter((i) => i.product)
        .map((i) => ({
          productId: i.product.id, sku: i.product.sku, name: i.product.name,
          unit: i.product.unit, quantity: i.quantity, reserved: i.reserved,
          atp: toNum(i.quantity) - toNum(i.reserved),
        })),
      children,
    };
  };

  return build(root);
};

/** Tất cả kho dạng phẳng kèm đường dẫn — cho bảng điều khiển. */
const listFlat = async ({ warehouseId } = {}, client = prisma) => {
  const where = {};
  if (warehouseId) where.parentId = warehouseId;
  const rows = await client.warehouse.findMany({
    where,
    orderBy: [{ path: "asc" }, { code: "asc" }],
    select: {
      id: true, code: true, name: true, locationType: true, parentId: true,
      path: true, isActive: true, isDefault: true,
      inventories: { select: { quantity: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id, code: r.code, name: r.name, locationType: r.locationType,
    parentId: r.parentId, path: r.path || r.code,
    isActive: r.isActive, isDefault: r.isDefault,
    canHoldStock: STOCK_TYPES.includes(r.locationType),
    onHand: r.inventories.reduce((s, i) => s + toNum(i.quantity), 0),
  }));
};

/** Kiểm tra không tạo vòng lặp khi gắn `parentId`. */
const assertNoCycle = async (warehouseId, parentId, client = prisma) => {
  if (!parentId) return;
  if (parentId === warehouseId) {
    throw { status: 400, message: "Một vị trí không thể là cha của chính nó" };
  }
  // Đi ngược từ cha lên gốc; nếu gặp chính `warehouseId` thì sẽ tạo vòng.
  let cursor = parentId;
  const seen = new Set();
  let hops = 0;
  while (cursor) {
    if (cursor === warehouseId) {
      throw {
        status: 400,
        message: "Không thể đặt vị trí này bên trong chính nó — tạo vòng lặp trong cây kho",
      };
    }
    if (seen.has(cursor)) {
      throw { status: 500, message: "Cây kho đang có vòng lặp từ trước — cần sửa dữ liệu trước" };
    }
    seen.add(cursor);
    // Chặn vòng lặp vô hạn nếu dữ liệu bị hỏng: cây hợp lệ sâu không quá 50.
    if (++hops > 50) {
      throw { status: 500, message: "Cây kho sâu quá 50 cấp — có thể dữ liệu bị hỏng" };
    }
    const parent = await client.warehouse.findUnique({
      where: { id: cursor },
      select: { parentId: true },
    });
    if (!parent) break;
    cursor = parent.parentId;
  }
};

/**
 * Tạo vị trí con trong một kho.
 *
 * Chặn trước khi ghi:
 *   - `locationType` hợp lệ
 *   - không tạo vòng lặp
 *   - mã vị trí không trùng trong cùng kho (để đường dẫn đọc được)
 */
const createLocation = async (
  { warehouseId, code, name, locationType = "PHYSICAL" } = {},
  userId,
  client = prisma,
) => {
  if (!LOCATION_TYPES.includes(locationType)) {
    throw { status: 400, message: `Loại vị trí phải là: ${LOCATION_TYPES.join(", ")}` };
  }
  if (!code || !String(code).trim()) throw { status: 400, message: "Thiếu mã vị trí" };
  if (!name || !String(name).trim()) throw { status: 400, message: "Thiếu tên vị trí" };

  const parent = await client.warehouse.findUnique({ where: { id: warehouseId } });
  if (!parent) throw { status: 404, message: "Không tìm thấy kho cha" };

  const dup = await client.warehouse.findFirst({
    where: { parentId: warehouseId, code: String(code).trim() },
    select: { id: true },
  });
  if (dup) {
    throw { status: 400, message: `Mã vị trí "${code}" đã tồn tại trong kho này` };
  }

  const created = await client.warehouse.create({
    data: {
      code: String(code).trim(),
      name: String(name).trim(),
      locationType,
      parentId: warehouseId,
      path: buildPath(parent.path || parent.code, String(code).trim()),
      // Vị trí con không bao giờ là kho mặc định — mặc định là gốc.
      isDefault: false,
      isActive: true,
    },
    select: { id: true, code: true, name: true, locationType: true, parentId: true, path: true },
  });

  await auditService.log({
    userId,
    action: "CREATE_WAREHOUSE_LOCATION",
    entity: "Warehouse",
    entityId: created.id,
    after: { code: created.code, name: created.name, locationType, parentId: warehouseId, path: created.path },
  });

  return created;
};

/** Đổi loại vị trí — có chặn nếu vị trí đang chứa hàng. */
const setLocationType = async (id, locationType, userId, client = prisma) => {
  if (!LOCATION_TYPES.includes(locationType)) {
    throw { status: 400, message: `Loại vị trí phải là: ${LOCATION_TYPES.join(", ")}` };
  }
  const wh = await client.warehouse.findUnique({
    where: { id },
    select: { id: true, code: true, locationType: true, inventories: { select: { quantity: true } } },
  });
  if (!wh) throw { status: 404, message: "Không tìm thấy vị trí" };

  // Luật 1: vị trí không chứa hàng được đổi thành VIEW/INTERNAL.
  const onHand = wh.inventories.reduce((s, i) => s + toNum(i.quantity), 0);
  if (!STOCK_TYPES.includes(locationType) && onHand > 0) {
    throw {
      status: 400,
      message:
        `Vị trí đang có ${onHand} đơn vị hàng. Chuyển sang loại không chứa hàng sẽ làm tổng tồn trong báo cáo sai. ` +
        `Chuyển hàng đi trước đã.`,
    };
  }

  const updated = await client.warehouse.update({
    where: { id },
    data: { locationType },
    select: { id: true, code: true, locationType: true },
  });
  await auditService.log({
    userId, action: "SET_WAREHOUSE_LOCATION_TYPE", entity: "Warehouse", entityId: id,
    before: { locationType: wh.locationType }, after: { locationType },
  });
  return updated;
};

module.exports = {
  LOCATION_TYPES,
  STOCK_TYPES,
  getTree,
  listFlat,
  createLocation,
  setLocationType,
  assertNoCycle,
};