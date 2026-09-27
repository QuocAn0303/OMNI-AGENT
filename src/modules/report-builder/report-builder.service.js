/**
 * modules/report-builder/report-builder.service.js — Safe query builder cho báo cáo
 * 
 * Tổng quan:
 * - Xây dựng truy vấn an toàn với whitelist bảng + cột, parameterized queries
 * - CRUD báo cáo đã lưu (saved reports)
 * 
 * Hàm:
 * - getTables(): Trả về danh sách bảng + cột được phép truy vấn
 * - validateConfig(config): Kiểm tra table/fields/groupBy/orderBy/aggregate có hợp lệ không
 * - runQuery(config, {limit}): Thực thi truy vấn raw an toàn qua prisma.$queryRawUnsafe với tham số hoá
 * - listReports(userId): Lấy danh sách báo cáo của user hoặc public
 * - createReport(userId, data): Tạo báo cáo mới, kèm validate config
 * - updateReport(id, userId, data): Cập nhật báo cáo, validate lại config nếu có
 * - deleteReport(id): Xoá báo cáo
 * - executeReport(id, params): Chạy báo cáo đã lưu dựa trên config
 */
// src/modules/report-builder/report-builder.service.js
// Safe query builder — whitelist tables + columns, parameterized queries
const prisma = require("../../config/prisma");
const { getTenantId, isBypassTenant } = require("../../config/tenantContext");

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
    fields: ["id", "name", "phone", "email", "totalSpent", "orderCount", "loyaltyPoints", "createdAt",
      // CRM/SRM (Mục 3): RFM động + CLV + churn
      "leadStatus", "referralSource", "rfmSegment", "rfmFrequency", "rfmRecencyDays", "rfmMonetary", "clvPredicted", "churnProbability"],
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
  // ==================== CRM/SRM upgrade (Mục 8 — nguồn dữ liệu R-04 → R-09) ====================
  vendors: {
    fields: ["id", "code", "name", "kraljicCategory", "profitImpactScore", "supplyRiskScore", "otifScore", "defectRate", "vendorGrade", "isActive"],
    label: "Nhà cung cấp",
  },
  debts: {
    fields: ["id", "type", "status", "amount", "paidAmount", "dueDate", "customerId", "vendorId", "createdAt"],
    label: "Công nợ",
  },
  churn_alerts: {
    fields: ["id", "customerId", "riskLevel", "churnScore", "voucherCode", "promotionId", "status", "expiresAt", "resolvedAt", "createdAt"],
    label: "Cảnh báo rời bỏ (Churn)",
  },
  goods_receipt_items: {
    fields: ["id", "grnId", "productId", "purchaseItemId", "receivedQty", "passQty", "rejectQty", "createdAt"],
    label: "Chi tiết phiếu nhận hàng (QC)",
  },
  campaign_recipients: {
    fields: ["id", "campaignId", "customerId", "status", "sentAt", "error"],
    label: "Người nhận chiến dịch",
  },
  purchase_invoice_records: {
    fields: ["id", "purchaseOrderId", "invoiceNumber", "invoiceAmount", "invoiceTax", "matchStatus", "varianceAmount", "variancePct", "createdAt"],
    label: "Hoá đơn NCC (3-way matching)",
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
  if (aggregate) {
    if (!ALLOWED_AGGREGATES.includes(aggregate.fn?.toUpperCase())) throw { status: 400, message: `Hàm tổng hợp không hợp lệ` };
    if (!aggregate.field || !allowed.includes(aggregate.field)) throw { status: 400, message: `Cột tổng hợp '${aggregate?.field}' không hợp lệ` };
  }
};

// Execute a safe query via prisma.$queryRawUnsafe with parameterized values
const runQuery = async (config, { limit = 100 } = {}) => {
  const { table, fields, filters = [], groupBy, orderBy, aggregate } = config;
  validateConfig(config);

  // ---- Multi-tenant: luôn ép WHERE tenantId (trừ SUPER_OMEGA bypass) ----
  const tenantId = getTenantId();
  const bypass = isBypassTenant();
  if (!tenantId && !bypass) throw { status: 403, message: 'Thiếu tenant context khi truy vấn' };

  const params = [];
  let paramIdx = 1;

  // SELECT clause
  let selectParts = fields.map((f) => `"${f}"`);
  if (aggregate) {
    selectParts = [`${aggregate.fn.toUpperCase()}("${aggregate.field}") AS "agg_value"`, ...(groupBy ? [`"${groupBy}"`] : [])];
  }

  // WHERE clause — simple comparisons only + tenantId
  const whereParts = [];
  if (tenantId) {
    whereParts.push(`"tenantId" = $${paramIdx}`);
    params.push(tenantId);
    paramIdx++;
  }
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
  const existing = await prisma.savedReport.findUnique({ where: { id }, select: { createdById: true } });
  if (!existing) throw { status: 404, message: 'Không tìm thấy báo cáo' };
  if (existing.createdById !== userId) throw { status: 403, message: 'Không có quyền sửa báo cáo này' };
  return prisma.savedReport.update({ where: { id }, data });
};

const deleteReport = async (id, userId) => {
  const existing = await prisma.savedReport.findUnique({ where: { id }, select: { createdById: true } });
  if (!existing) throw { status: 404, message: 'Không tìm thấy báo cáo' };
  if (existing.createdById !== userId) throw { status: 403, message: 'Không có quyền xóa báo cáo này' };
  return prisma.savedReport.delete({ where: { id } });
};

const executeReport = async (id, userId = null, params = {}) => {
  const report = await prisma.savedReport.findUnique({ where: { id } });
  if (!report) throw { status: 404, message: 'Không tìm thấy báo cáo' };
  if (!report.isPublic && report.createdById !== userId) throw { status: 403, message: 'Không có quyền chạy báo cáo này' };
  return runQuery(report.config, params);
};

module.exports = { getTables, runQuery, listReports, createReport, updateReport, deleteReport, executeReport };
