// src/modules/report-builder/report-builder.service.js
// Safe query builder — whitelist tables + columns, parameterized queries
const prisma = require("../../config/prisma");

// Whitelisted tables + their allowed fields for reporting
const ALLOWED_TABLES = {
  orders: {
    fields: ["id", "orderCode", "status", "total", "currency", "createdAt", "paymentStatus", "paymentMethod"],
    label: "Đơn hàng",
  },
  products: {
    fields: ["id", "sku", "name", "price", "costPrice", "unit", "isActive"],
    label: "Sản phẩm",
  },
  customers: {
    fields: ["id", "name", "phone", "email", "totalSpent", "orderCount", "loyaltyPoints", "createdAt"],
    label: "Khách hàng",
  },
  order_items: {
    fields: ["id", "productId", "quantity", "unitPrice", "totalPrice"],
    label: "Chi tiết đơn hàng",
  },
  payments: {
    fields: ["id", "orderId", "amount", "method", "currency", "createdAt"],
    label: "Thanh toán",
  },
  expenses: {
    fields: ["id", "title", "amount", "status", "date", "categoryId"],
    label: "Chi phí",
  },
  inventory_transactions: {
    fields: ["id", "type", "quantity", "productId", "warehouseId", "createdAt"],
    label: "Giao dịch kho",
  },
  journal_entries: {
    fields: ["id", "entryCode", "date", "description", "source", "status"],
    label: "Bút toán kế toán",
  },
};

const ALLOWED_AGGREGATES = ["SUM", "COUNT", "AVG", "MIN", "MAX"];

const getTables = () => Object.entries(ALLOWED_TABLES).map(([key, v]) => ({ key, label: v.label, fields: v.fields }));

const validateConfig = ({ table, fields, filters = [], groupBy, orderBy, aggregate }) => {
  if (!ALLOWED_TABLES[table]) throw { status: 400, message: `Bảng '${table}' không được phép` };
  const allowed = ALLOWED_TABLES[table].fields;
  for (const f of fields) {
    if (!allowed.includes(f)) throw { status: 400, message: `Cột '${f}' không tồn tại trong bảng '${table}'` };
  }
  if (groupBy && !allowed.includes(groupBy)) throw { status: 400, message: `groupBy '${groupBy}' không hợp lệ` };
  if (orderBy?.field && !allowed.includes(orderBy.field)) throw { status: 400, message: `orderBy '${orderBy.field}' không hợp lệ` };
  if (aggregate && !ALLOWED_AGGREGATES.includes(aggregate.fn?.toUpperCase())) throw { status: 400, message: `Hàm tổng hợp không hợp lệ` };
};

// Execute a safe query via prisma.$queryRawUnsafe with parameterized values
const runQuery = async (config, { limit = 100 } = {}) => {
  const { table, fields, filters = [], groupBy, orderBy, aggregate } = config;
  validateConfig(config);

  const params = [];
  let paramIdx = 1;

  // SELECT clause
  let selectParts = fields.map((f) => `"${f}"`);
  if (aggregate) {
    selectParts = [`${aggregate.fn.toUpperCase()}("${aggregate.field}") AS "agg_value"`, ...(groupBy ? [`"${groupBy}"`] : [])];
  }

  // WHERE clause — simple comparisons only
  const whereParts = [];
  for (const f of filters) {
    if (!ALLOWED_TABLES[table].fields.includes(f.field)) continue;
    const op = ["=", "!=", ">", "<", ">=", "<=", "LIKE", "ILIKE"].includes(f.op) ? f.op : "=";
    whereParts.push(`"${f.field}" ${op} $${paramIdx}`);
    params.push(f.value);
    paramIdx++;
  }

  const whereClause = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";
  const groupByClause = groupBy ? `GROUP BY "${groupBy}"` : "";
  const orderByClause = orderBy?.field ? `ORDER BY "${orderBy.field}" ${orderBy.dir === "desc" ? "DESC" : "ASC"}` : "";
  const limitClause = `LIMIT ${Math.min(Number(limit) || 100, 5000)}`;

  const sql = `SELECT ${selectParts.join(", ")} FROM ${table} ${whereClause} ${groupByClause} ${orderByClause} ${limitClause}`;

  return prisma.$queryRawUnsafe(sql, ...params);
};

// CRUD for saved reports
const listReports = (userId) =>
  prisma.savedReport.findMany({
    where: { OR: [{ createdById: userId }, { isPublic: true }] },
    orderBy: { updatedAt: "desc" },
    include: { createdBy: { select: { fullName: true } } },
  });

const createReport = (userId, { name, description, config, isPublic = false }) => {
  validateConfig(config);
  return prisma.savedReport.create({ data: { name, description, config, isPublic, createdById: userId } });
};

const updateReport = async (id, userId, data) => {
  if (data.config) validateConfig(data.config);
  return prisma.savedReport.update({ where: { id }, data });
};

const deleteReport = (id) => prisma.savedReport.delete({ where: { id } });

const executeReport = async (id, params = {}) => {
  const report = await prisma.savedReport.findUniqueOrThrow({ where: { id } });
  return runQuery(report.config, params);
};

module.exports = { getTables, runQuery, listReports, createReport, updateReport, deleteReport, executeReport };
