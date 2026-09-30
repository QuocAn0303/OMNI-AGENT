/**
 * modules/crm/segments.service.js — Service phân khúc khách hàng
 * 
 * Tổng quan:
 * - Quản lý phân khúc khách hàng (CustomerSegment) dựa trên rules engine.
 * - Rules cho phép lọc theo: tier, totalSpent, loyaltyPoints, lastOrderDate,
 *   orderCount, tag, hasDebt.
 * - Hỗ trợ tổ hợp AND/OR giữa các rules, post-filter cho orderCount không thể
 *   biểu diễn trực tiếp bằng Prisma where.
 * - Ghi audit log cho mọi thao tác CRUD.
 * 
 * Hàm:
 * - SUPPORTED_FIELDS: Mảng các field được hỗ trợ trong rule builder.
 * - buildRuleWhere(rule): Build Prisma where fragment từ một rule (field, op, value).
 * - compileRules(rules): Compile mảng rules thành Prisma where + postFilter.
 * - evaluateSegment(rules, {limit}): Đánh giá segment, trả về {customers, total}.
 * - countMatching(rules): Đếm số khách hàng matching rules.
 * - list(): Danh sách tất cả segment.
 * - getById(id): Chi tiết segment.
 * - create(data, userId): Tạo segment mới, tính customerCount.
 * - update(id, data, userId): Cập nhật segment; recalculate customerCount nếu rules thay đổi.
 * - remove(id, userId): Xóa segment.
 * - preview(id, limit): Xem trước khách hàng matching segment đã lưu.
 * - previewByRules(rules, limit): Xem trước khách hàng matching rules chưa lưu.
 * - buildWhereForSegment(segmentId): Trả về { where, postFilter } của segment đã lưu
 *   để module khác gộp vào query chính (không liệt kê id).
 */
// src/modules/crm/segments.service.js
const prisma = require("../../config/prisma");
const auditService = require("../audit/audit.service");

const SUPPORTED_FIELDS = [
  "tier",
  "totalSpent",
  "loyaltyPoints",
  "lastOrderDate",
  "orderCount",
  "tag",
  "hasDebt",
];

const SEGMENT_SELECT = {
  id: true,
  name: true,
  description: true,
  rules: true,
  customerCount: true,
  createdAt: true,
  updatedAt: true,
  createdBy: { select: { id: true, fullName: true } },
};

// Build Prisma `where` clause for a single rule against Customer.
// Trả về fragment để hợp nhất vào AND/OR.
const buildRuleWhere = (rule) => {
  if (!rule || !rule.field) return null;
  const { field, op, value } = rule;

  switch (field) {
    case "tier": {
      // op: in / notIn / eq
      if (op === "in" || op === "notIn") {
        const arr = Array.isArray(value) ? value : [value];
        return op === "in" ? { tier: { in: arr } } : { tier: { notIn: arr } };
      }
      return { tier: value };
    }
    case "totalSpent":
    case "loyaltyPoints": {
      // op: gte / lte / eq / between
      if (op === "between" && Array.isArray(value) && value.length === 2) {
        return { [field]: { gte: Number(value[0]), lte: Number(value[1]) } };
      }
      const num = Number(value);
      if (op === "gte") return { [field]: { gte: num } };
      if (op === "lte") return { [field]: { lte: num } };
      if (op === "gt") return { [field]: { gt: num } };
      if (op === "lt") return { [field]: { lt: num } };
      return { [field]: num };
    }
    case "orderCount": {
      // op: gte / lte / eq — đếm orders không bị huỷ
      const num = Number(value);
      const filter = { every: undefined };
      let cmp;
      if (op === "gte") cmp = { gte: num };
      else if (op === "lte") cmp = { lte: num };
      else if (op === "gt") cmp = { gt: num };
      else if (op === "lt") cmp = { lt: num };
      else cmp = { equals: num };

      // Prisma không hỗ trợ direct count comparison, dùng _count filter
      return {
        orders: {
          ...(num > 0
            ? { some: { status: { not: "CANCELLED" } } }
            : { none: {} }),
        },
        // Bổ sung điều kiện thực qua raw không khả thi ở đây — dùng evaluate post-filter
        _orderCount: cmp,
      };
    }
    case "lastOrderDate": {
      // op: withinDays / beforeDays / never
      if (op === "never") {
        return { orders: { none: { status: { not: "CANCELLED" } } } };
      }
      const days = Number(value);
      const date = new Date(Date.now() - days * 86400000);
      if (op === "withinDays") {
        return {
          orders: {
            some: { status: { not: "CANCELLED" }, createdAt: { gte: date } },
          },
        };
      }
      if (op === "beforeDays") {
        return {
          orders: {
            none: { status: { not: "CANCELLED" }, createdAt: { gte: date } },
          },
        };
      }
      return null;
    }
    case "tag": {
      // op: hasAny / hasAll / hasNone
      const ids = Array.isArray(value) ? value : [value];
      if (!ids.length) return null;
      if (op === "hasNone") {
        return { tags: { none: { tagId: { in: ids } } } };
      }
      if (op === "hasAll") {
        return { AND: ids.map((tagId) => ({ tags: { some: { tagId } } })) };
      }
      // default hasAny
      return { tags: { some: { tagId: { in: ids } } } };
    }
    case "hasDebt": {
      // value: true/false
      const v = value === true || value === "true";
      return v
        ? { debts: { some: { status: { not: "CLOSED" } } } }
        : { debts: { none: { status: { not: "CLOSED" } } } };
    }
    default:
      return null;
  }
};

// Đánh giá rules → trả về { where, postFilter }
// postFilter dùng cho điều kiện không thể biểu diễn trực tiếp bằng Prisma where (vd: orderCount).
const compileRules = (rules) => {
  if (!rules || typeof rules !== "object") {
    return { where: { isActive: true }, postFilter: null };
  }
  const combinator = rules.all ? "AND" : rules.any ? "OR" : "AND";
  const list = rules.all || rules.any || [];

  const fragments = [];
  const postFilters = [];

  for (const r of list) {
    const built = buildRuleWhere(r);
    if (!built) continue;
    if (built._orderCount) {
      postFilters.push({ field: "orderCount", cmp: built._orderCount });
      delete built._orderCount;
    }
    if (Object.keys(built).length > 0) {
      fragments.push(built);
    }
  }

  const where = { isActive: true };
  if (fragments.length) {
    where[combinator] = fragments;
  }
  return { where, postFilter: postFilters.length ? { combinator, postFilters } : null };
};

const evaluateOrderCountCmp = (count, cmp) => {
  if (cmp.gte !== undefined) return count >= cmp.gte;
  if (cmp.lte !== undefined) return count <= cmp.lte;
  if (cmp.gt !== undefined) return count > cmp.gt;
  if (cmp.lt !== undefined) return count < cmp.lt;
  if (cmp.equals !== undefined) return count === cmp.equals;
  return true;
};

// Trả về { customers, total }
const evaluateSegment = async (rules, { limit = null } = {}) => {
  const { where, postFilter } = compileRules(rules);

  const needOrderCount = !!postFilter;
  const customers = await prisma.customer.findMany({
    where,
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      tier: true,
      totalSpent: true,
      loyaltyPoints: true,
      ...(needOrderCount && {
        orders: { where: { status: { not: "CANCELLED" } }, select: { id: true } },
      }),
    },
    orderBy: { totalSpent: "desc" },
    ...(limit ? { take: Number(limit) } : {}),
  });

  let filtered = customers;
  if (postFilter) {
    filtered = customers.filter((c) => {
      const count = c.orders?.length || 0;
      const checks = postFilter.postFilters.map((p) =>
        evaluateOrderCountCmp(count, p.cmp),
      );
      return postFilter.combinator === "OR" ? checks.some(Boolean) : checks.every(Boolean);
    });
  }

  // Bỏ field orders ra khỏi output
  const cleaned = filtered.map((c) => {
    const { orders, ...rest } = c;
    return rest;
  });

  return { customers: cleaned, total: cleaned.length };
};

const countMatching = async (rules) => {
  const { customers } = await evaluateSegment(rules);
  return customers.length;
};

const list = async () => {
  return prisma.customerSegment.findMany({
    select: SEGMENT_SELECT,
    orderBy: { updatedAt: "desc" },
  });
};

const getById = async (id) => {
  const segment = await prisma.customerSegment.findUnique({
    where: { id },
    select: SEGMENT_SELECT,
  });
  if (!segment) {
    const err = new Error("Segment không tồn tại");
    err.status = 404;
    throw err;
  }
  return segment;
};

const create = async (data, userId) => {
  const count = await countMatching(data.rules);
  const segment = await prisma.customerSegment.create({
    data: {
      name: data.name,
      description: data.description || null,
      rules: data.rules,
      customerCount: count,
      createdById: userId,
    },
    select: SEGMENT_SELECT,
  });
  auditService.log({
    userId,
    action: "CREATE_SEGMENT",
    entity: "CustomerSegment",
    entityId: segment.id,
    after: { name: segment.name, customerCount: count },
  });
  return segment;
};

const update = async (id, data, userId) => {
  const before = await prisma.customerSegment.findUnique({ where: { id } });
  if (!before) {
    const err = new Error("Segment không tồn tại");
    err.status = 404;
    throw err;
  }
  const patch = {};
  if (data.name !== undefined) patch.name = data.name;
  if (data.description !== undefined) patch.description = data.description;
  if (data.rules !== undefined) {
    patch.rules = data.rules;
    patch.customerCount = await countMatching(data.rules);
  }
  const updated = await prisma.customerSegment.update({
    where: { id },
    data: patch,
    select: SEGMENT_SELECT,
  });
  auditService.log({
    userId,
    action: "UPDATE_SEGMENT",
    entity: "CustomerSegment",
    entityId: id,
    before: { name: before.name, customerCount: before.customerCount },
    after: { name: updated.name, customerCount: updated.customerCount },
  });
  return updated;
};

const remove = async (id, userId) => {
  const segment = await prisma.customerSegment.findUnique({ where: { id } });
  if (!segment) {
    const err = new Error("Segment không tồn tại");
    err.status = 404;
    throw err;
  }
  await prisma.customerSegment.delete({ where: { id } });
  auditService.log({
    userId,
    action: "DELETE_SEGMENT",
    entity: "CustomerSegment",
    entityId: id,
    before: { name: segment.name },
  });
  return { id };
};

const preview = async (id, limit = 20) => {
  const segment = await getById(id);
  const { customers, total } = await evaluateSegment(segment.rules, { limit });
  return { segment, customers, total };
};

const previewByRules = async (rules, limit = 20) => {
  const { customers, total } = await evaluateSegment(rules, { limit });
  return { customers, total };
};

// Trả về { where, postFilter } của một segment ĐÃ LƯU, để module khác tái dùng
// (ví dụ customers/customer.service.getAll lọc danh sách khách hàng theo phân khúc).
// Ưu tiên gộp `where` vào query chính thay vì liệt kê id — tránh IN clause khổng lồ.
// Khi có postFilter (rule orderCount) thì caller phải fallback sang evaluateSegment.
const buildWhereForSegment = async (segmentId) => {
  const segment = await getById(segmentId);
  return { ...compileRules(segment.rules), rules: segment.rules };
};

module.exports = {
  SUPPORTED_FIELDS,
  list,
  getById,
  create,
  update,
  remove,
  preview,
  previewByRules,
  evaluateSegment,
  countMatching,
  buildWhereForSegment,
};
