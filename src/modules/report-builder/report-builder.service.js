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
  // ==================== CRM Sales Pipeline (Lead / Deal / Organization) ====================
  crm_leads: {
    fields: ["id", "leadName", "email", "mobileNo", "jobTitle", "source", "status", "leadOwnerId",
      "organizationId", "expectedValue", "convertedAt", "lastContactedAt", "createdAt"],
    label: "Lead (CRM Pipeline)",
  },
  crm_deals: {
    fields: ["id", "dealName", "organizationId", "contactId", "leadId", "customerId", "stageId", "kind",
      "value", "currency", "probability", "expectedCloseDate", "dealOwnerId", "closedAt", "lostReason", "orderId", "createdAt"],
    label: "Deal (CRM Pipeline)",
  },
  crm_organizations: {
    fields: ["id", "name", "website", "industry", "annualRevenue", "taxCode", "phone", "isActive", "createdAt"],
    label: "Tổ chức (CRM Pipeline)",
  },
  crm_contacts: {
    fields: ["id", "fullName", "email", "phone", "jobTitle", "isPrimary", "organizationId", "customerId", "isActive", "createdAt"],
    label: "Liên hệ (CRM Pipeline)",
  },
  crm_communications: {
    fields: ["id", "type", "direction", "subject", "leadId", "dealId", "contactId", "createdById", "createdAt"],
    label: "Trao đổi với khách (Timeline CRM)",
  },
};

const ALLOWED_AGGREGATES = ["SUM", "COUNT", "AVG", "MIN", "MAX"];

/**
 * CRM audit M2 — bảng CRM trong report builder PHẢI áp record-level permission.
 *
 * Trước đây `runQuery` ép `tenantId` thủ công (đúng, không rò tenant) nhưng KHÔNG áp
 * `ownerScopeForTeam`. Route cho phép MANAGER chạy ⇒ MANAGER đọc được toàn bộ
 * lead/deal của tenant qua report builder — lách đúng cơ chế "CASHIER chỉ thấy của
 * mình" mà các endpoint CRM khác áp dụng.
 *
 * Đây là đường bypass DUY NHẤT đọc bảng CRM ngoài Prisma extension, và nó an toàn
 * hoàn toàn nhờ code thủ công — ai thêm bảng mới vào `ALLOWED_TABLES` mà quên
 * khai báo ở `CRM_OWNER_COLUMN` thì rò ngay. Vì vậy map bắt buộc phải nằm cạnh
 * `ALLOWED_TABLES` và có test bên cạnh.
 */
const CRM_OWNER_COLUMN = {
  crm_leads: "leadOwnerId",
  crm_deals: "dealOwnerId",
};

/**
 * @returns {string[]|null} danh sách owner id được phép xem, hoặc null = không áp
 *   (bảng không phải CRM, hoặc không xác định được cây báo cáo → hành vi Phase 2/3).
 */
const resolveCrmOwnerIds = async (table, user) => {
  const column = CRM_OWNER_COLUMN[table];
  if (!column || !user) return null;
  // Require động: report-builder không phụ thuộc crm/* ở top-level.
  const { getTeamUserIds } = require("../crm/hierarchy.service");
  const { isManager } = require("../crm/scope");
  const team = await getTeamUserIds(user);
  if (!Array.isArray(team)) {
    // Cây chưa cấu hình: MANAGER+ vẫn toàn tenant (khớp scope.js), role khác
    // vẫn bị giới hạn về chính mình.
    return isManager(user) ? null : [user.id].filter(Boolean);
  }
  return team.length ? team : [user.id].filter(Boolean);
};

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
const runQuery = async (config, { limit = 100, user = null } = {}) => {
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

  // CRM audit M2 — record-level permission cho bảng lead/deal (xem CRM_OWNER_COLUMN)
  const ownerIds = await resolveCrmOwnerIds(table, user);
  if (ownerIds) {
    const column = CRM_OWNER_COLUMN[table];
    if (ownerIds.length === 1) {
      whereParts.push(`"${column}" = $${paramIdx}`);
      params.push(ownerIds[0]);
      paramIdx += 1;
    } else {
      const placeholders = ownerIds.map((id) => {
        const slot = `$${paramIdx}`;
        params.push(id);
        paramIdx += 1;
        return slot;
      });
      whereParts.push(`"${column}" IN (${placeholders.join(", ")})`);
    }
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

const executeReport = async (id, userId = null, params = {}, user = null) => {
  const report = await prisma.savedReport.findUnique({ where: { id } });
  if (!report) throw { status: 404, message: 'Không tìm thấy báo cáo' };
  if (!report.isPublic && report.createdById !== userId) throw { status: 403, message: 'Không có quyền chạy báo cáo này' };
  // `user` truyền xuống `runQuery` để áp owner scope (CRM audit M2). Nếu caller
  // cũ không truyền thì bảng CRM sẽ KHÔNG bị giới hạn — đó là hành vi không an toàn,
  // nên route phải luôn truyền `req.user` (đã cập nhật).
  return runQuery(report.config, { ...params, user: user || { id: userId } });
};

module.exports = { getTables, runQuery, listReports, createReport, updateReport, deleteReport, executeReport, CRM_OWNER_COLUMN };
