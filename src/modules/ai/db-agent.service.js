/**
 * modules/ai/db-agent.service.js — DB Agent: truy vấn database bằng ngôn ngữ tự nhiên
 * 
 * Tổng quan:
 * - 20+ tool handlers bao phủ tất cả model chính trong hệ thống
 * - Mỗi handler nhận params động, thực thi Prisma query, trả về { data, summary, message }
 * - Hỗ trợ phân trang, filter, sort, date range, aggregation
 * - Kết hợp với LLM để hiểu câu hỏi tự nhiên và format response
 * 
 * Flow:
 * 1. processQuery(text) → resolveIntent(text) → xác định tool + params
 * 2. Thực thi tool handler → raw data
 * 3. formatResponse(data, intent) → natural language
 * 4. Nếu có LLM → dùng LLM để paraphrase response
 */

const prisma = require('../../config/prisma');
const logger = require('../../utils/logger');
const { buildReminderGate, createGate } = require('./agent.humangate');
// PRM: hai tool tra cứu đối tác gọi thẳng service để dùng chung công thức lợi nhuận
// ròng. Nếu viết truy vấn riêng ở đây thì sẽ có hai nơi tính tiền và một nơi sai.
const roiService = require('../partners/roi.service');
const referralService = require('../partners/referral.service');
const { stripDiacritics } = require('../../utils/vietnamese');

// ─── HELPERS ───

function dateRange(period) {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
  const ranges = {
    today:       { gte: new Date(y, m, d) },
    yesterday:   { gte: new Date(y, m, d - 1), lt: new Date(y, m, d) },
    this_week:   { gte: new Date(now.getTime() - now.getDay() * 86400000) },
    last_week:   { gte: new Date(now.getTime() - (now.getDay() + 7) * 86400000), lt: new Date(now.getTime() - now.getDay() * 86400000) },
    this_month:  { gte: new Date(y, m, 1) },
    last_month:  { gte: new Date(y, m - 1, 1), lt: new Date(y, m, 1) },
    this_quarter:{ gte: new Date(y, Math.floor(m / 3) * 3, 1) },
    this_year:   { gte: new Date(y, 0, 1) },
  };
  if (period && ranges[period]) return ranges[period];
  if (period?.gte || period?.lte || period?.lt || period?.gt) return period;
  return {};
}

const META_KEYS = new Set(['search', 'limit', 'skip', 'sortBy', 'sortOrder', 'period', 'type',
  'lowStock', 'hasDebt', 'expiringSoon', 'minPrice', 'maxPrice', 'minTotal', 'maxTotal',
  'minSpent', 'categoryId', 'customerId', 'vendorId', 'productId', 'warehouseId',
  'tier', 'status', 'paymentStatus', 'isActive']);

function buildWhere(filters = {}, searchFields = [], extraKeys = []) {
  const allowed = new Set([...META_KEYS, ...extraKeys]);
  const where = {};
  for (const [k, v] of Object.entries(filters)) {
    if (!allowed.has(k)) where[k] = v;
  }
  if (filters.isActive === undefined) where.isActive = true;
  if (filters.search && searchFields.length > 0) {
    where.OR = searchFields.map(f => {
      if (f.includes('.')) {
        const [rel, field] = f.split('.');
        return { [rel]: { [field]: { contains: filters.search, mode: 'insensitive' } } };
      }
      return { [f]: { contains: filters.search, mode: 'insensitive' } };
    });
  }
  return where;
}

// ─── TOOL HANDLERS ───

/**
 * Tool có TÁC DỤNG PHỤ (ghi dữ liệu). Danh sách này là nguồn duy nhất —
 * mọi entrypoint phải hỏi ở đây trước khi execute, không tự liệt kê lại.
 *
 * Lý do tồn tại: `POST /api/db-agent/query` mặc định `useLlm=true`, LLM tự
 * chọn tool rồi `chat()` gọi thẳng `HANDLERS[tool]` — không kiểm tra tool có
 * phải write hay không. Trước khi có set này, CASHIER/WAREHOUSE đã đăng nhập
 * gọi được create_order/create_po mà không cần quyền, không audit, không gate.
 *
 * Write tool KHÔNG được chạy ở bất kỳ đường chat NL nào. Đường hợp lệ duy nhất
 * là tool nhận diện chủ động + human-gate: xem modules/ai/agent.routes.js.
 */
const WRITE_TOOLS = new Set(['create_order', 'create_po', 'send_reminder']);

/** Tool có ghi dữ liệu hay không (dùng bởi route và service để chặn trước khi execute). */
const isWriteTool = (tool) => WRITE_TOOLS.has(tool);

const HANDLERS = {

  search_products: async (params = {}) => {
    if (params.lowStock) {
      // Chuyển hướng sang inventory để lọc theo số lượng tồn thấp
      const invWhere = { quantity: { lte: 5 } };
      const invData = await prisma.inventory.findMany({
        where: invWhere,
        include: { product: { include: { category: { select: { name: true } } } } },
        orderBy: { quantity: 'asc' },
        take: params.limit || 20,
      });
      return {
        data: invData,
        total: invData.length,
        summary: `${invData.length} sản phẩm sắp hết hàng (tồn <= 5)`,
        message: invData.map(i =>
          `• ${i.product?.name} (SKU: ${i.product?.sku}) — Tồn: ${i.quantity} — Giá: ${Number(i.product?.price || 0).toLocaleString()}đ — DM: ${i.product?.category?.name || 'N/A'}`
        ).join('\n'),
      };
    }
    const where = buildWhere(params, ['name', 'sku']);
    if (params.categoryId) where.categoryId = params.categoryId;
    if (params.minPrice || params.maxPrice) {
      where.price = {};
      if (params.minPrice) where.price.gte = Number(params.minPrice);
      if (params.maxPrice) where.price.lte = Number(params.maxPrice);
    }

    const [data, total] = await Promise.all([
      prisma.product.findMany({
        where,
        include: { category: { select: { name: true } }, inventories: { take: 1 } },
        orderBy: params.sortBy ? { [params.sortBy]: params.sortOrder || 'desc' } : { createdAt: 'desc' },
        take: params.limit || 20,
        skip: params.skip || 0,
      }),
      prisma.product.count({ where }),
    ]);

    return {
      data,
      total,
      summary: `Tìm thấy ${total} sản phẩm`,
      message: data.map(p =>
        `• ${p.name} (SKU: ${p.sku}) — Giá: ${Number(p.price).toLocaleString()}đ — Kho: ${p.inventories?.[0]?.quantity || 0} — Danh mục: ${p.category?.name || 'N/A'}`
      ).join('\n'),
    };
  },

  search_orders: async (params = {}) => {
    const where = {};
    if (params.status) where.status = params.status;
    if (params.paymentStatus) where.paymentStatus = params.paymentStatus;
    if (params.customerId) where.customerId = params.customerId;
    if (params.minTotal || params.maxTotal) {
      where.total = {};
      if (params.minTotal) where.total.gte = Number(params.minTotal);
      if (params.maxTotal) where.total.lte = Number(params.maxTotal);
    }
    where.createdAt = dateRange(params.period);

    const [data, total, agg] = await Promise.all([
      prisma.order.findMany({
        where,
        include: { customer: { select: { name: true, phone: true } }, items: { take: 3, include: { product: { select: { name: true } } } } },
        orderBy: { createdAt: 'desc' }, take: params.limit || 20, skip: params.skip || 0,
      }),
      prisma.order.count({ where }),
      prisma.order.aggregate({ where, _sum: { total: true }, _count: { id: true } }),
    ]);

    return {
      data, total,
      summary: `Tổng: ${agg._count.id} đơn — Doanh thu: ${Number(agg._sum.total || 0).toLocaleString()}đ`,
      message: data.map(o =>
        `• ${o.orderCode} — ${o.status} — ${Number(o.total).toLocaleString()}đ — ${o.paymentStatus} — KH: ${o.customer?.name || 'N/A'} (${o.createdAt.toISOString().slice(0, 10)})`
      ).join('\n'),
    };
  },

  search_customers: async (params = {}) => {
    const where = buildWhere(params, ['name', 'phone', 'email']);
    if (params.minSpent) where.totalSpent = { gte: Number(params.minSpent) };
    if (params.tier) where.tier = params.tier;
    if (params.hasDebt) where.totalDebt = { gt: 0 };

    const [data, total] = await Promise.all([
      prisma.customer.findMany({
        where, orderBy: params.sortBy ? { [params.sortBy]: params.sortOrder || 'desc' } : { totalSpent: 'desc' },
        take: params.limit || 20, skip: params.skip || 0,
      }),
      prisma.customer.count({ where }),
    ]);

    return {
      data, total,
      summary: `Tìm thấy ${total} khách hàng`,
      message: data.map(c =>
        `• ${c.name} — SĐT: ${c.phone || 'N/A'} — Đã mua: ${Number(c.totalSpent).toLocaleString()}đ — Nợ: ${Number(c.totalDebt || 0).toLocaleString()}đ — Điểm: ${c.loyaltyPoints || 0}`
      ).join('\n'),
    };
  },

  search_inventory: async (params = {}) => {
    const where = {};
    if (params.warehouseId) where.warehouseId = params.warehouseId;
    if (params.lowStock) where.quantity = { lte: 5 };
    if (params.productId) where.productId = params.productId;

    const [data, total] = await Promise.all([
      prisma.inventory.findMany({
        where,
        include: { product: { select: { name: true, sku: true, price: true } }, warehouse: { select: { name: true } } },
        orderBy: { quantity: 'asc' }, take: params.limit || 20, skip: params.skip || 0,
      }),
      prisma.inventory.count({ where }),
    ]);

    const lowStockCount = data.filter(i => i.quantity <= (i.minStock || 5)).length;
    return {
      data, total,
      summary: `${total} dòng tồn kho — ${lowStockCount} sản phẩm sắp hết hàng`,
      message: data.map(i =>
        `• ${i.product?.name} (${i.product?.sku}) — Kho: ${i.warehouse?.name || 'N/A'} — Tồn: ${i.quantity} — Khả dụng: ${i.quantity - (i.reserved || 0)} — Min: ${i.minStock || 0}`
      ).join('\n'),
    };
  },

  get_revenue: async (params = {}) => {
    const where = {};
    where.createdAt = dateRange(params.period || 'this_month');
    if (params.status) where.status = params.status;
    else where.status = { not: 'CANCELLED' };

    const [agg, daily, byStatus] = await Promise.all([
      prisma.order.aggregate({ where, _sum: { total: true }, _avg: { total: true }, _count: { id: true } }),
      prisma.order.groupBy({ by: ['createdAt'], where, _sum: { total: true }, _count: { id: true }, orderBy: { createdAt: 'asc' } }),
      prisma.order.groupBy({ by: ['status'], where, _sum: { total: true }, _count: { id: true } }),
    ]);

    return {
      data: { total: agg._sum.total || 0, avgOrder: agg._avg.total || 0, count: agg._count.id, daily, byStatus },
      summary: `💰 Doanh thu: ${Number(agg._sum.total || 0).toLocaleString()}đ — ${agg._count.id} đơn — TB: ${Number(agg._avg.total || 0).toLocaleString()}đ/đơn`,
      message: '',
    };
  },

  search_finance: async (params = {}) => {
    const { type } = params;
    if (type === 'expenses' || !type) {
      const where = {};
      where.date = dateRange(params.period);
      if (params.categoryId) where.categoryId = params.categoryId;
      const [data, total, agg] = await Promise.all([
        prisma.expense.findMany({ where, include: { category: { select: { name: true } }, vendor: { select: { name: true } } }, orderBy: { date: 'desc' }, take: params.limit || 20 }),
        prisma.expense.count({ where }),
        prisma.expense.aggregate({ where, _sum: { amount: true }, _count: { id: true } }),
      ]);
      return { data, total, summary: `Tổng chi phí: ${Number(agg._sum.amount || 0).toLocaleString()}đ — ${agg._count.id} khoản`, message: data.map(e => `• ${e.date?.toISOString().slice(0, 10)} — ${e.category?.name || 'N/A'} — ${Number(e.amount).toLocaleString()}đ — ${e.vendor?.name || 'N/A'} — ${e.status}`).join('\n') };
    }
    if (type === 'journal') {
      const where = {};
      where.date = dateRange(params.period);
      const [data, total] = await Promise.all([
        prisma.journalEntry.findMany({ where, include: { lines: { take: 5, include: { account: { select: { code: true, name: true } } } } }, orderBy: { date: 'desc' }, take: params.limit || 20 }),
        prisma.journalEntry.count({ where }),
      ]);
      return { data, total, summary: `${total} bút toán kế toán`, message: data.map(j => `• ${j.entryCode || j.id} — ${j.date?.toISOString().slice(0, 10)} — ${j.description || 'N/A'} — ${j.status}`).join('\n') };
    }
    if (type === 'accounts') {
      const data = await prisma.account.findMany({ orderBy: { code: 'asc' } });
      return { data, total: data.length, summary: `${data.length} tài khoản kế toán`, message: data.map(a => `• ${a.code} — ${a.name} — ${a.nameVi || ''}`).join('\n') };
    }
    return { data: [], total: 0, summary: 'Không có dữ liệu', message: '' };
  },

  search_hr: async (params = {}) => {
    const { type, search } = params;
    if (type === 'payroll' || params.period) {
      const now = new Date();
      const where = {};
      if (params.period === 'this_month' || !params.period) {
        where.month = now.getMonth() + 1;
        where.year = now.getFullYear();
      } else if (params.period === 'last_month') {
        where.month = now.getMonth() === 0 ? 12 : now.getMonth();
        where.year = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
      }
      const [data, total] = await Promise.all([
        prisma.payroll.findMany({ where, include: { employee: { include: { user: { select: { fullName: true } } } } }, orderBy: { createdAt: 'desc' }, take: params.limit || 50 }),
        prisma.payroll.count({ where }),
      ]);
      const totalNet = data.reduce((s, p) => s + Number(p.finalSalary || 0), 0);
      return { data, total, summary: `${total} bảng lương — Tổng chi: ${totalNet.toLocaleString()}đ`, message: data.map(p => `• ${p.employee?.user?.fullName || 'N/A'} — Tháng ${p.month}/${p.year} — Lương: ${Number(p.finalSalary || 0).toLocaleString()}đ`).join('\n') };
    }
    if (type === 'attendance') {
      const where = {};
      if (params.date) where.date = new Date(params.date);
      const [data, total] = await Promise.all([
        prisma.shift.findMany({ where, include: { employee: { include: { user: { select: { fullName: true } } } } }, orderBy: { date: 'desc' }, take: params.limit || 50 }),
        prisma.shift.count({ where }),
      ]);
      return { data, total, summary: `${total} ca làm việc`, message: data.map(s => `• ${s.employee?.user?.fullName || 'N/A'} — ${s.date?.toISOString().slice(0, 10)} — ${s.type || s.shiftType}`).join('\n') };
    }
    const where = buildWhere({ ...params, search: undefined }, ['employeeCode']);
    const userFilter = params.search ? { fullName: { contains: params.search, mode: 'insensitive' } } : {};
    const [data, total] = await Promise.all([
      prisma.employee.findMany({
        where: { ...where, user: userFilter },
        include: { user: { select: { fullName: true, email: true, role: true } } },
        take: params.limit || 20,
      }),
      prisma.employee.count({ where: { ...where, user: userFilter } }),
    ]);
    return { data, total, summary: `${total} nhân viên`, message: data.map(e => `• ${e.user?.fullName || 'N/A'} (${e.employeeCode}) — ${e.position || 'N/A'} — SĐT: ${e.phone || 'N/A'}`).join('\n') };
  },

  search_production: async (params = {}) => {
    const { type } = params;
    if (type === 'work_orders' || !type) {
      const where = {};
      if (params.status) where.status = params.status;
      const [data, total] = await Promise.all([
        prisma.workOrder.findMany({ where, include: { product: { select: { name: true, sku: true } } }, orderBy: { createdAt: 'desc' }, take: params.limit || 20 }),
        prisma.workOrder.count({ where }),
      ]);
      return { data, total, summary: `${total} lệnh sản xuất`, message: data.map(wo => `• ${wo.code} — ${wo.product?.name || 'N/A'} — SL: ${wo.quantity} — ${wo.status} — ${wo.plannedStartDate?.toISOString().slice(0, 10) || ''}`).join('\n') };
    }
    if (type === 'bom') {
      const data = await prisma.bom.findMany({ where: { status: 'ACTIVE' }, include: { product: { select: { name: true } }, items: { include: { component: { select: { name: true } } } } } });
      return { data, total: data.length, summary: `${data.length} BOM đang hoạt động`, message: data.map(b => `• ${b.product?.name} — ${b.items.length} nguyên vật liệu`).join('\n') };
    }
    if (type === 'lots') {
      const where = {};
      if (params.expiringSoon) where.expDate = { lte: new Date(Date.now() + 30 * 86400000) };
      const [data, total] = await Promise.all([
        prisma.inventoryLot.findMany({ where, include: { product: { select: { name: true } } }, orderBy: { expDate: 'asc' }, take: params.limit || 20 }),
        prisma.inventoryLot.count({ where }),
      ]);
      const expiring = data.filter(l => l.expDate && l.expDate < new Date(Date.now() + 30 * 86400000)).length;
      return { data, total, summary: `${total} lô — ${expiring} lô sắp hết hạn`, message: data.map(l => `• ${l.lotCode} — ${l.product?.name || 'N/A'} — SL: ${l.quantity} — HSD: ${l.expDate?.toISOString().slice(0, 10) || 'N/A'}`).join('\n') };
    }
    return { data: [], total: 0, summary: '', message: '' };
  },

  search_projects: async (params = {}) => {
    const where = {};
    if (params.status) where.status = params.status;
    const [data, total] = await Promise.all([
      prisma.project.findMany({ where, include: { tasks: { take: 3 }, members: { take: 3, include: { user: { select: { fullName: true } } } } }, orderBy: { createdAt: 'desc' }, take: params.limit || 20 }),
      prisma.project.count({ where }),
    ]);
    return {
      data, total,
      summary: `${total} dự án`,
      message: data.map(p =>
        `• ${p.name} — ${p.status} — ${p.tasks?.length || 0} task — ${p.members?.length || 0} thành viên — ${p.startDate?.toISOString().slice(0, 10) || ''} → ${p.endDate?.toISOString().slice(0, 10) || ''}`
      ).join('\n'),
    };
  },

  search_debts: async (params = {}) => {
    const where = {};
    if (params.customerId) where.customerId = params.customerId;
    if (params.status) where.status = params.status;
    if (params.type) where.type = params.type;

    const [data, total] = await Promise.all([
      prisma.debt.findMany({ where, include: { customer: { select: { name: true, phone: true } }, payments: { take: 3, orderBy: { paidAt: 'desc' } } }, orderBy: { createdAt: 'desc' }, take: params.limit || 20 }),
      prisma.debt.count({ where }),
    ]);
    const totalRemaining = data.reduce((s, d) => s + Number(d.amount) - Number(d.paidAmount), 0);
    const totalOriginal = data.reduce((s, d) => s + Number(d.amount), 0);

    return {
      data, total,
      summary: `Tổng nợ: ${totalRemaining.toLocaleString()}đ / ${totalOriginal.toLocaleString()}đ`,
      message: data.map(d => {
        const remaining = Number(d.amount) - Number(d.paidAmount);
        return `• ${d.customer?.name || 'N/A'} — ${d.type} — ${d.status} — Gốc: ${Number(d.amount).toLocaleString()}đ — Còn: ${remaining.toLocaleString()}đ — Hạn: ${d.dueDate?.toISOString().slice(0, 10) || 'N/A'}`;
      }).join('\n'),
    };
  },

  search_vendors: async (params = {}) => {
    const where = buildWhere(params, ['name', 'taxCode']);
    const [data, total] = await Promise.all([
      prisma.vendor.findMany({ where, orderBy: { name: 'asc' }, take: params.limit || 20 }),
      prisma.vendor.count({ where }),
    ]);
    return { data, total, summary: `${total} nhà cung cấp`, message: data.map(v => `• ${v.name} — MST: ${v.taxCode || 'N/A'} — SĐT: ${v.phone || 'N/A'} — Email: ${v.email || 'N/A'}`).join('\n') };
  },

  search_purchase_orders: async (params = {}) => {
    const where = {};
    if (params.status) where.status = params.status;
    if (params.vendorId) where.vendorId = params.vendorId;
    where.createdAt = dateRange(params.period);

    const [data, total, agg] = await Promise.all([
      prisma.purchaseOrder.findMany({ where, include: { vendor: { select: { name: true } }, items: { take: 3, include: { product: { select: { name: true } } } } }, orderBy: { createdAt: 'desc' }, take: params.limit || 20 }),
      prisma.purchaseOrder.count({ where }),
      prisma.purchaseOrder.aggregate({ where, _sum: { total: true } }),
    ]);

    return { data, total, summary: `${total} đơn nhập — Tổng: ${Number(agg._sum.total || 0).toLocaleString()}đ`, message: data.map(po => `• ${po.poCode} — ${po.vendor?.name || 'N/A'} — ${po.status} — ${Number(po.total).toLocaleString()}đ — ${po.createdAt.toISOString().slice(0, 10)}`).join('\n') };
  },

  search_promotions: async (params = {}) => {
    const where = {};
    if (params.status) where.status = params.status;
    if (params.type) where.type = params.type;
    const [data, total] = await Promise.all([
      prisma.promotion.findMany({ where, orderBy: { createdAt: 'desc' }, take: params.limit || 20 }),
      prisma.promotion.count({ where }),
    ]);
    return { data, total, summary: `${total} chương trình khuyến mãi`, message: data.map(p => `• ${p.code} — ${p.name || 'N/A'} — ${p.type} — ${p.scope} — ${p.status} — Giá trị: ${p.value}${p.type === 'PERCENTAGE' ? '%' : 'đ'}`).join('\n') };
  },

  search_invoices: async (params = {}) => {
    const where = {};
    where.createdAt = dateRange(params.period);

    const [data, total] = await Promise.all([
      prisma.invoice.findMany({ where, include: { order: { select: { orderCode: true, total: true, status: true } } }, orderBy: { createdAt: 'desc' }, take: params.limit || 20 }),
      prisma.invoice.count({ where }),
    ]);

    return { data, total, summary: `${total} hóa đơn`, message: data.map(inv => `• ${inv.invoiceCode || inv.id} — Đơn: ${inv.order?.orderCode || 'N/A'} — ${Number(inv.order?.total || 0).toLocaleString()}đ — ${inv.order?.status || 'N/A'}`).join('\n') };
  },

  search_deliveries: async (params = {}) => {
    const where = {};
    if (params.status) where.status = params.status;
    if (params.provider) where.provider = params.provider;
    where.createdAt = dateRange(params.period);

    const [data, total] = await Promise.all([
      prisma.delivery.findMany({ where, include: { order: { select: { orderCode: true } } }, orderBy: { createdAt: 'desc' }, take: params.limit || 20 }),
      prisma.delivery.count({ where }),
    ]);
    return { data, total, summary: `${total} đơn giao hàng`, message: data.map(d => `• Đơn ${d.order?.orderCode || 'N/A'} — ${d.provider} — ${d.status} — Mã vận đơn: ${d.trackingCode || 'N/A'}`).join('\n') };
  },

  search_returns: async (params = {}) => {
    const where = {};
    where.createdAt = dateRange(params.period);
    if (params.status) where.status = params.status;

    const [data, total] = await Promise.all([
      prisma.orderReturn.findMany({ where, include: { order: { select: { orderCode: true } } }, orderBy: { createdAt: 'desc' }, take: params.limit || 20 }),
      prisma.orderReturn.count({ where }),
    ]);
    const totalRefund = data.reduce((s, r) => s + Number(r.refundAmount || 0), 0);
    return { data, total, summary: `${total} đơn trả — Tổng hoàn: ${totalRefund.toLocaleString()}đ`, message: data.map(r => `• ${r.returnCode} — Đơn ${r.order?.orderCode || 'N/A'} — ${r.status} — ${Number(r.refundAmount || 0).toLocaleString()}đ`).join('\n') };
  },

  get_dashboard: async () => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

    const [orderToday, revenueToday, orderMonth, revenueMonth, customers, lowStock, pendingPO, employees] = await Promise.all([
      prisma.order.count({ where: { createdAt: { gte: today } } }),
      prisma.order.aggregate({ where: { createdAt: { gte: today }, status: { not: 'CANCELLED' } }, _sum: { total: true } }),
      prisma.order.count({ where: { createdAt: { gte: monthStart } } }),
      prisma.order.aggregate({ where: { createdAt: { gte: monthStart }, status: { not: 'CANCELLED' } }, _sum: { total: true } }),
      prisma.customer.count({ where: { isActive: true } }),
      prisma.inventory.count({ where: { quantity: { lte: 5 } } }),
      prisma.purchaseOrder.count({ where: { status: 'PENDING' } }),
      prisma.employee.count({ where: { isActive: true } }),
    ]);

    return {
      data: { orderToday, revenueToday, orderMonth, revenueMonth, customers, lowStock, pendingPO, employees },
      summary: `📊 Tổng quan:\n• Hôm nay: ${orderToday} đơn — ${Number(revenueToday._sum.total || 0).toLocaleString()}đ\n• Tháng này: ${orderMonth} đơn — ${Number(revenueMonth._sum.total || 0).toLocaleString()}đ\n• ${customers} khách hàng — ${employees} nhân viên\n• ⚠️ ${lowStock} SP sắp hết hàng — ${pendingPO} PO chờ duyệt`,
      message: '',
    };
  },

  // ════════════════ CRM/SRM TOOLS (YeuCauKyThuat §3.3 — 17+ query tools) ════════════════

  search_churn_alerts: async (params = {}) => {
    const where = {};
    const VALID_STATUS = ['PENDING', 'TRIGGERED', 'RETAINED', 'LOST'];
    const VALID_RISK = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
    if (params.status && VALID_STATUS.includes(params.status)) where.status = params.status;
    if (params.riskLevel && VALID_RISK.includes(params.riskLevel)) where.riskLevel = params.riskLevel;
    const rows = await prisma.churnAlert.findMany({
      where,
      include: { customer: { select: { id: true, name: true, phone: true, churnProbability: true, rfmSegment: true } } },
      orderBy: { churnScore: 'desc' },
      take: params.limit || 20,
    });
    if (!rows.length) return { data: [], total: 0, summary: 'Không có cảnh báo churn nào.', message: '' };
    return {
      data: rows,
      total: rows.length,
      summary: `${rows.length} cảnh báo churn`,
      message: rows.map(a =>
        `• ${a.customer?.name} (${a.customer?.phone || 'N/A'}) — rủi ro ${a.riskLevel} — điểm ${Number(a.churnScore).toFixed(2)} — ${a.status}`
      ).join('\n'),
    };
  },

  search_customer_rfm: async (params = {}) => {
    const where = { isActive: true };
    const VALID_SEGMENTS = ['Champions', 'Loyal', 'Potential', 'At-Risk', 'Hibernating'];
    if (params.segment && VALID_SEGMENTS.includes(params.segment)) where.rfmSegment = params.segment;
    else if (params.tier) where.tier = params.tier;
    if (params.hasDebt) where.totalDebt = { gt: 0 };
    const rows = await prisma.customer.findMany({
      where,
      select: {
        id: true, name: true, phone: true, tier: true, loyaltyPoints: true, totalSpent: true,
        rfmRecencyDays: true, rfmFrequency: true, rfmMonetary: true, rfmSegment: true,
        clvPredicted: true, churnProbability: true,
      },
      orderBy: [{ rfmMonetary: 'desc' }, { totalSpent: 'desc' }],
      take: params.limit || 20,
    });
    if (!rows.length) return { data: [], total: 0, summary: 'Chưa có khách hàng nào được chấm điểm RFM.', message: '' };
    return {
      data: rows,
      total: rows.length,
      summary: `${rows.length} khách hàng phân khúc RFM`,
      message: rows.map(c =>
        `• ${c.name} — ${c.rfmSegment || 'Chưa segment'} — R:${c.rfmRecencyDays ?? '?'} F:${c.rfmFrequency ?? '?'} — CLV: ${Number(c.clvPredicted || 0).toLocaleString()}đ — churn: ${c.churnProbability != null ? Math.round(c.churnProbability * 100) + '%' : '?'}`
      ).join('\n'),
    };
  },

  search_leads: async (params = {}) => {
    const where = { referralSource: { not: null } };
    const VALID_LEAD_STATUS = ['NEW', 'CONTACTED', 'QUALIFIED', 'CUSTOMER', 'DEAD'];
    if (params.leadStatus && VALID_LEAD_STATUS.includes(params.leadStatus)) where.leadStatus = params.leadStatus;
    const rows = await prisma.customer.findMany({
      where,
      select: { id: true, name: true, phone: true, email: true, leadStatus: true, referralSource: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: params.limit || 20,
    });
    if (!rows.length) return { data: [], total: 0, summary: 'Chưa có lead nào.', message: '' };
    return {
      data: rows,
      total: rows.length,
      summary: `${rows.length} lead`,
      message: rows.map(l =>
        `• ${l.name} (${l.phone || 'N/A'}) — nguồn: ${l.referralSource} — trạng thái: ${l.leadStatus}`
      ).join('\n'),
    };
  },

  // ════════════════ PRM TOOLS (đối tác đầu ra — hoa hồng, hiệu quả) ════════════════

  /**
   * Xếp hạng hiệu quả đối tác.
   *
   * Dùng lại `roi.service.js` thay vì tự viết truy vấn: công thức lợi nhuận ròng có
   * ba chỗ phải chốt (CLV dự báo hay thực tế, hoa hồng theo tỷ lệ hay cố định, khách
   * thiếu dữ liệu thì tính sao) và nếu có hai nơi tính thì chắc chắn một nơi sai.
   *
   * Cố tình KHÔNG trả tên và số điện thoại khách hàng. `roi.service.js` xếp hạng
   * ở cấp đối tác, đây chỉ cần tên đối tác và số liệu — trả PII lên trợ lý sẽ phải
   * qua cổng phê duyệt và làm nhiễu câu trả lời.
   */
  search_partner_performance: async (params = {}) => {
    const SORT = { revenue: 'revenue', conversion: 'conversion', profit: 'profit', referrals: 'referrals' };
    const { partners, totals, metricLabel } = await roiService.ranking({
      metric: params.metric === 'actual' ? 'actual' : 'predicted',
      sortBy: SORT[params.sortBy] || 'profit',
      limit: Math.min(Number(params.limit) || 10, 50),
    });
    if (!partners.length) {
      return { data: [], total: 0, summary: 'Chưa có đối tác nào trong hệ thống.', message: '' };
    }
    return {
      data: partners,
      total: partners.length,
      summary:
        `${partners.length} đối tác · đo theo ${metricLabel} · ` +
        `${totals.converted}/${totals.referrals} lượt chuyển đổi ` +
        `(${totals.overallConversionRate}%) · lợi nhuận ròng ${Number(totals.netProfit).toLocaleString()}đ ` +
        `− hoa hồng ${Number(totals.commission).toLocaleString()}đ`,
      message: partners.map(p =>
        `#${p.rank} ${p.name} (${p.code}) — ${p.converted}/${p.referrals} khách chuyển đổi ` +
        `(${p.conversionRate}%) — giá trị ${Number(p.predictedValue).toLocaleString()}đ ` +
        `— hoa hồng ${Number(p.commission).toLocaleString()}đ — lợi nhuận ròng ${Number(p.netProfit).toLocaleString()}đ` +
        (p.coverage < 100 ? ` [chỉ ${p.coverage}% khách đủ dữ liệu dự báo]` : '')
      ).join('\n'),
    };
  },

  /** Chi tiết một đối tác và phễu chuyển đổi của họ. */
  search_partner_referrals: async (params = {}) => {
    // Cho phép gọi bằng MÃ đối tác (`ĐT-202610-0001`) vì đó là thứ người dùng đọc
    // trên báo cáo in ra, không phải UUID.
    let partnerId = params.partnerId || null;
    if (!partnerId && params.partnerCode) {
      // So khớp không phân biệt hoa thường và không phân biệt có dấu: người dùng gõ
      // "dt-202610-0001" (bàn phím không bật được dấu, hoặc chép lại từ báo cáo xuất
      // Excel) vẫn phải ra đúng đối tác. So khớp chính xác byte sẽ trả "không tìm
      // thấy" cho một đối tác có thật.
      // Prefilter theo đuôi số để không nạp toàn bảng partners mỗi lần chat.
      const wanted = stripDiacritics(String(params.partnerCode)).toLowerCase();
      const digits = String(params.partnerCode).replace(/\D/g, '');
      const tail = digits.length >= 4 ? digits.slice(-4) : digits;
      const candidates = await prisma.partner.findMany({
        where: tail ? { code: { contains: tail } } : {},
        select: { id: true, code: true },
        take: 50,
      });
      const byCode = candidates.find((p) => stripDiacritics(p.code).toLowerCase() === wanted);
      if (!byCode) {
        return {
          data: [],
          total: 0,
          summary: `Không tìm thấy đối tác mã ${params.partnerCode}.`,
          message: '',
        };
      }
      partnerId = byCode.id;
    }
    if (!partnerId) {
      return { data: [], total: 0, summary: 'Thiếu partnerId hoặc mã đối tác.', message: '' };
    }
    const [detail, funnelRow] = await Promise.all([
      roiService.detail(partnerId),
      referralService.funnel({ partnerId }),
    ]);
    const p = detail.partner;
    const f = funnelRow[0];
    return {
      data: { partner: p, customers: detail.customers, funnel: f },
      total: p.converted,
      summary: `${p.name} (${p.code}) — ${p.converted}/${p.referrals} lượt chuyển đổi (${p.conversionRate}%)`,
      message: [
        `Đối tác ${p.name} — loại ${p.type} — hoa hồng ${p.commissionType === 'PERCENT_OF_CLV' ? p.commissionPercent + '%' : Number(p.fixedCommission).toLocaleString() + 'đ/khách'}`,
        `Phễu: ${f ? f.funnel.map(s => `${s.stage} ${s.count}`).join(' → ') : 'chưa có dữ liệu lead'}${f && f.dead ? ` (loại ${f.dead})` : ''}`,
        ...detail.customers.slice(0, 10).map(c =>
          `• ${c.name || 'KH đã xoá mềm'}${c.rfmSegment ? ` [${c.rfmSegment}]` : ''} — ` +
          `CLV dự báo ${c.predictedValue != null ? Number(c.predictedValue).toLocaleString() + 'đ' : 'chưa đủ dữ liệu'}` +
          ` — đã chi ${Number(c.actualValue).toLocaleString()}đ` +
          (c.churnProbability != null ? ` — churn ${Math.round(c.churnProbability * 100)}%` : '')
        ),
      ].join('\n'),
    };
  },

  search_grn: async (params = {}) => {
    const where = {};
    const VALID_GRN_STATUS = ['DRAFT', 'QC_PENDING', 'QC_DONE', 'POSTED'];
    if (params.status && VALID_GRN_STATUS.includes(params.status)) where.status = params.status;
    const rows = await prisma.goodsReceiptNote.findMany({
      where,
      include: { purchaseOrder: { select: { poCode: true, vendor: { select: { name: true } } } } },
      orderBy: { receivedAt: 'desc' },
      take: params.limit || 20,
    });
    if (!rows.length) return { data: [], total: 0, summary: 'Không có phiếu nhập kho (GRN) nào.', message: '' };
    return {
      data: rows,
      total: rows.length,
      summary: `${rows.length} phiếu nhập kho`,
      message: rows.map(g =>
        `• ${g.grnCode} — ${g.purchaseOrder?.poCode} (${g.purchaseOrder?.vendor?.name || 'N/A'}) — ${g.status} — ${new Date(g.receivedAt).toISOString().slice(0, 10)}`
      ).join('\n'),
    };
  },

  search_purchase_invoices: async (params = {}) => {
    const where = {};
    const VALID_MATCH = ['PENDING', 'MATCHED', 'VARIANCE_HOLD', 'APPROVED_OVERRIDE'];
    if (params.matchStatus && VALID_MATCH.includes(params.matchStatus)) where.matchStatus = params.matchStatus;
    const rows = await prisma.purchaseInvoiceRecord.findMany({
      where,
      include: { purchaseOrder: { select: { poCode: true, vendor: { select: { name: true } } } } },
      orderBy: { receivedAt: 'desc' },
      take: params.limit || 20,
    });
    if (!rows.length) return { data: [], total: 0, summary: 'Không có hóa đơn NCC nào.', message: '' };
    return {
      data: rows,
      total: rows.length,
      summary: `${rows.length} hóa đơn NCC (3-way matching)`,
      message: rows.map(p =>
        `• ${p.invoiceNumber} — ${p.purchaseOrder?.poCode} (${p.purchaseOrder?.vendor?.name || 'N/A'}) — ${Number(p.invoiceAmount).toLocaleString()}đ — ${p.matchStatus}${p.variancePct != null ? ` — lệch ${Number(p.variancePct).toFixed(2)}%` : ''}`
      ).join('\n'),
    };
  },

  search_vendor_performance: async (params = {}) => {
    const rows = await prisma.vendor.findMany({
      where: { isActive: true },
      select: {
        id: true, code: true, name: true, kraljicCategory: true,
        otifScore: true, defectRate: true, vendorGrade: true, paymentTerms: true,
      },
      orderBy: [{ otifScore: 'desc' }, { name: 'asc' }],
      take: params.limit || 20,
    });
    if (!rows.length) return { data: [], total: 0, summary: 'Không có nhà cung cấp nào.', message: '' };
    return {
      data: rows,
      total: rows.length,
      summary: `${rows.length} nhà cung cấp — hiệu suất SRM`,
      message: rows.map(v =>
        `• ${v.name} (${v.code}) — Kraljic: ${v.kraljicCategory || 'chưa đánh giá'} — grade: ${v.vendorGrade || '?'} — OTIF: ${v.otifScore != null ? Number(v.otifScore).toFixed(1) : '?'} — lỗi: ${v.defectRate != null ? Number(v.defectRate).toFixed(1) + '%' : '?'}`
      ).join('\n'),
    };
  },

  // ════════════════ WRITE TOOLS ════════════════

  /**
   * Tra cứu khách hàng chịu lỗi dấu/chữ dư ("khách Bui Hoang", "Bui Hoang" vs
   * "Bùi Hoàng", SĐT ở cuốicâu).
   *
   * Lượt 1: `contains`Insensitive + SĐT — phủ đại đa số (tên gõ đúng)).
   * Lượt 2 (dự phòng): lấy tối đa 500 khách mới nhất rồi so sánh bằng
   * `stripDiacritics` — người dùng gõ không dấu ("bui hoang") vẫn khớp tên có
   * dấu ("Bùi Hoàng"). Giới hạn 500 vì tenant demo có thể có hàng nghìn khách,
   * quét vô hạn là mất kiểm soát.
   */
  findCustomerByQuery: async (query) => {
    const q = String(query || '').trim();
    if (!q) return null;
    const direct = await prisma.customer.findFirst({
      where: {
        isActive: true,
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { phone: { contains: q } },
        ],
      },
    });
    if (direct) return direct;
    try {
      const wanted = stripDiacritics(q).toLowerCase();
      const candidates = await prisma.customer.findMany({
        where: { isActive: true },
        orderBy: { createdAt: 'desc' },
        take: 500,
      });
      return (candidates || []).find((c) => stripDiacritics(c.name).toLowerCase().includes(wanted)) || null;
    } catch (e) {
      logger.error(`[DB Agent] Fallback tra cứu khách không dấu lỗi: ${e.message}`);
      return null;
    }
  },

  /**
   * Tra cứu sản phẩm chịu lỗi dấu / gõ SKU.
   *
   * Lượt 1: `name contains`Insensitive — phủ đại đa số (tên gõ đúng).
   * Lượt 2: `sku contains` — người dùng gõ mã thay vì tên.
   * Lượt 3 (dự phòng): quét tối đa 500 sản phẩm mới nhất so sánh bằng
   * `stripDiacritics` — "phan mai oishi loai 1" vẫn khớp "Phô mai Oishi
   * Loại 1". Giới hạn 500 giống findCustomerByQuery để không quét vô hạn
   * với tenant hàng nghìn SKU.
   */
  findProductByQuery: async (query) => {
    const q = String(query || '').trim();
    if (!q) return null;
    const byName = await prisma.product.findFirst({
      where: { isActive: true, name: { contains: q, mode: 'insensitive' } },
    });
    if (byName) return byName;
    const bySku = await prisma.product.findFirst({
      where: { isActive: true, sku: { contains: q, mode: 'insensitive' } },
    });
    if (bySku) return bySku;
    try {
      const wanted = stripDiacritics(q).toLowerCase();
      const candidates = await prisma.product.findMany({
        where: { isActive: true },
        orderBy: { createdAt: 'desc' },
        take: 500,
      });
      return (candidates || []).find((p) => stripDiacritics(p.name).toLowerCase().includes(wanted)) || null;
    } catch (e) {
      logger.error(`[DB Agent] Fallback tra cứu sản phẩm không dấu lỗi: ${e.message}`);
      return null;
    }
  },



  create_order: async (params = {}, userId = null) => {
    const orderService = require('../orders/order.service');

    const customerQuery = params.customerName || params.customerPhone || '';
    let customerId = params.customerId;
    if (!customerId && customerQuery) {
      const customer = await HANDLERS.findCustomerByQuery(customerQuery);
      if (customer) customerId = customer.id;
      else return { data: null, total: 0, summary: `Không tìm thấy khách hàng "${customerQuery}". Vui lòng kiểm tra lại tên hoặc SĐT.`, message: '' };
    }

    const productItems = params.items || [];
    if (!productItems.length && params.productName && params.quantity) {
      productItems.push({ productName: params.productName, quantity: parseInt(params.quantity) || 1 });
    }

    if (!productItems.length) {
      return { data: null, total: 0, summary: 'Vui lòng cung cấp sản phẩm và số lượng. VD: "tạo đơn hàng 5 áo polo cho khách Nguyễn Văn A"', message: '' };
    }

    const resolvedItems = [];
    for (const item of productItems) {
      const pid = item.productId;
      const name = item.productName || '';
      let product;
      if (pid) {
        product = await prisma.product.findUnique({ where: { id: pid } });
      } else if (name) {
        // findProductByQuery: name contains → SKU → quét không dấu. Trước đây
        // chỉ `name contains` nên "phan mai oishi loai 1" (không dấu) báo
        // không tìm thấy dù sản phẩm tồn tại.
        product = await HANDLERS.findProductByQuery(name);
      }
      if (!product) return { data: null, total: 0, summary: `Không tìm thấy sản phẩm "${name || pid}". Vui lòng kiểm tra lại.`, message: '' };
      // Giữ tên đã resolve để summary hiển thị TÊN thay vì UUID — `order.items`
      // trả về từ orderService.create có thể thiếu include product (bug thật
      // 17/10/2026: "1x efb21a2d-…" cho người dùng).
      resolvedItems.push({ productId: product.id, productName: product.name || name || pid, quantity: parseInt(item.quantity) || 1, price: Number(item.price || product.price) });
    }

    const order = await orderService.create({
      customerId: customerId || null,
      // orderService.create chỉ cần {productId, quantity, price} — không truyền
      // productName (trường phụ chỉ để dựng summary) vào items.
      items: resolvedItems.map((i) => ({ productId: i.productId, quantity: i.quantity, price: i.price })),
      paymentMethod: params.paymentMethod || 'CASH',
      status: params.status || 'PENDING',
      note: params.note || `[Tạo bởi AI Agent] ${params.note || ''}`,
      warehouseId: params.warehouseId || undefined,
    }, userId);

    return {
      data: order,
      total: 1,
      summary: `✅ Đã tạo đơn hàng ${order.orderCode} thành công!\nTổng tiền: ${Number(order.total).toLocaleString()}đ\nSản phẩm: ${resolvedItems.map(i => `${i.quantity}x ${i.productName || i.productId}`).join(', ')}`,
      message: '',
    };
  },

  create_po: async (params = {}, userId = null) => {
    const purchaseService = require('../accounting/purchase.service');
    const vendorService = require('../accounting/vendor.service');

    const vendorQuery = params.vendorName || params.vendorId || '';
    let vendorId = params.vendorId;
    if (!vendorId && vendorQuery) {
      const vendors = await vendorService.list({ search: vendorQuery, limit: 1 });
      if (vendors.items?.length) vendorId = vendors.items[0].id;
      else {
        const vendor = await prisma.vendor.findFirst({
          where: { name: { contains: vendorQuery, mode: 'insensitive' } },
        });
        if (vendor) vendorId = vendor.id;
        else return { data: null, total: 0, summary: `Không tìm thấy nhà cung cấp "${vendorQuery}".`, message: '' };
      }
    }

    // Bắt buộc có NCC — PurchaseOrder.vendorId là quan hệ bắt buộc.
    // Trước đây thiếu NCC vẫn gọi purchaseService.create với vendorId=undefined
    // → Prisma ném "Argument `vendor` is missing" (500) thay vì báo cho AI hỏi lại.
    if (!vendorId) {
      const suggestions = await prisma.vendor.findMany({
        where: { isActive: true },
        select: { name: true },
        orderBy: { name: 'asc' },
        take: 5,
      });
      const hint = suggestions.length
        ? ` Ví dụ: "${suggestions.map((v) => v.name).join('", "')}".`
        : ' Hãy tạo nhà cung cấp trước trong mục Nhà cung cấp.';
      return {
        data: null,
        total: 0,
        summary: 'Thiếu nhà cung cấp — vui lòng cho biết NCC của đơn nhập. '
          + 'Cú pháp: "tạo PO cho <sản phẩm> <số lượng> từ <tên NCC> giá <số tiền>".' + hint,
        message: '',
      };
    }

    // Copy để không mutate params.items của caller
    const productItems = [...(params.items || [])];
    if (!productItems.length && params.productName && params.quantity) {
      productItems.push({
        productName: params.productName,
        quantity: parseInt(params.quantity) || 1,
        // PHẢI truyền unitCost: nếu thiếu, resolvedItems rơi về product.costPrice
        // và câu "giá 5 triệu" bị âm thầm ghi thành 27.000đ (product giá sẵn có).
        ...(params.unitCost ? { unitCost: Number(params.unitCost) } : {}),
      });
    }

    if (!productItems.length) {
      return { data: null, total: 0, summary: 'Vui lòng cung cấp tên sản phẩm cần nhập (ví dụ: "tạo PO nến thơm 3 cái giá 5 triệu").', message: '' };
    }

    const resolvedItems = [];
    for (const item of productItems) {
      const pid = item.productId;
      const name = item.productName || '';
      let product;
      if (pid) {
        product = await prisma.product.findUnique({ where: { id: pid } });
      } else if (name) {
        // findProductByQuery: name contains → SKU → quét không dấu — như create_order
        product = await HANDLERS.findProductByQuery(name);
      }
      if (!product) return { data: null, total: 0, summary: `Không tìm thấy sản phẩm "${name || pid}".`, message: '' };
      resolvedItems.push({
        productId: product.id,
        // Giữ tên để summary hiển thị "3x Nến thơm" thay vì UUID
        productName: product.name || name || pid,
        quantity: parseInt(item.quantity) || 1,
        unitCost: Number(item.unitCost || product.costPrice || 0),
      });
    }

    const po = await purchaseService.create({
      vendorId,
      items: resolvedItems.map(i => ({ productId: i.productId, quantity: i.quantity, unitCost: i.unitCost })),
      note: params.note || `[Tạo bởi AI Agent] ${params.note || ''}`,
      expectedAt: params.expectedAt ? new Date(params.expectedAt) : undefined,
    }, userId);

    return {
      data: po,
      total: 1,
      summary: `✅ Đã tạo đơn nhập hàng ${po.poCode} thành công!\nNCC: ${po.vendor?.name || vendorQuery}\nTổng: ${Number(po.total).toLocaleString('vi-VN')}đ`
        + `\nSản phẩm: ${resolvedItems.map((i) => `${i.quantity}x ${i.productName || i.productId}`).join(', ')}`
        // PO >= ngưỡng duyệt → nhắc người dùng đi duyệt, tránh tưởng đã xong
        + (po.status === 'PENDING_APPROVAL' ? `\n⏳ Tổng >= ngưỡng duyệt → PO đang chờ DUYỆT tại mục Đơn nhập hàng.` : ''),
      message: '',
    };
  },

  send_reminder: async (params = {}, userId = null, sessionId = null) => {
    const notificationService = require('../notifications/notification.service');

    const customerQuery = params.customerName || '';
    const { debtId } = params;

    if (!debtId && !customerQuery) {
      return { data: null, total: 0, summary: 'Vui lòng cung cấp tên khách hàng hoặc ID công nợ cần nhắc.', message: '' };
    }

    let debt;
    if (debtId) {
      debt = await prisma.debt.findUnique({ where: { id: debtId }, include: { customer: { select: { name: true, phone: true } } } });
    } else if (customerQuery) {
      // Tra khách qua findCustomerByQuery (chịu lỗi dấu) rồi tìm công nợ theo
      // customerId — trước đây tra `customer.name contains customerQuery`, câu
      // có chữ dư ("nợ", "khách ...") làm trượt và báo sai "không có công nợ".
      const customer = await HANDLERS.findCustomerByQuery(customerQuery);
      if (customer) {
        debt = await prisma.debt.findFirst({
          where: { customerId: customer.id, status: { in: ['OPEN', 'PARTIAL', 'OVERDUE'] } },
          orderBy: { dueDate: 'asc' },
          include: { customer: { select: { name: true, phone: true } } },
        });
      }
    }

    if (!debt) {
      return { data: null, total: 0, summary: `Không tìm thấy công nợ cho khách "${customerQuery}".`, message: '' };
    }

    const remaining = Number(debt.amount) - Number(debt.paidAmount);
    const message = params.message || `Kính gửi ${debt.customer.name}, khoản nợ ${remaining.toLocaleString()} VND của quý khách đến hạn ngày ${new Date(debt.dueDate).toLocaleDateString('vi-VN')}. Vui lòng thanh toán.`;

    await notificationService.notifyRoles(['MANAGER', 'ADMIN'], {
      type: 'DEBT_OVERDUE',
      severity: 'WARNING',
      title: `Nhắc nợ khách ${debt.customer.name}`,
      message: `${debt.customer.name}: còn ${remaining.toLocaleString()} VND, hạn ${new Date(debt.dueDate).toLocaleDateString('vi-VN')}`,
      link: '/debts',
      meta: { debtId: debt.id, level: 'agent_reminder' },
    });

    // Note CRM chỉ là bản ghi phụ, không được chặn luồng nhắc nợ — nhưng mất note thì
    // PHẢI còn dấu vết trong log (trước đây .catch(() => {}) xoá sạch triệu chứng).
    try {
      await prisma.customerNote.create({
        data: {
          customerId: debt.customerId,
          content: `[AI Agent] Nhắc nợ: ${message}`,
          type: 'NOTE',
          createdById: userId,
        },
      });
    } catch (noteErr) {
      logger.error(`[DB Agent] Không ghi được note nhắc nợ cho debt ${debt.id}: ${noteErr.message}`);
    }

    // Create a human gate if sessionId is provided
    if (sessionId) {
      try {
        await createGate(buildReminderGate({
          sessionId,
          debtId: debt.id,
          customerName: debt.customer.name,
          remaining,
          message,
        }));
      } catch (gateErr) {
        logger.error(`[DB Agent] Không tạo được human-gate nhắc nợ cho debt ${debt.id}: ${gateErr.message}`);
      }
    }

    return {
      data: debt,
      total: 1,
      summary: `✅ Đã gửi nhắc nợ cho ${debt.customer.name}.\nSố tiền: ${remaining.toLocaleString()} VND\nHạn: ${new Date(debt.dueDate).toLocaleDateString('vi-VN')}`,
      message: '',
    };
  },

};

// ─── INTENT RESOLVER ───

const INTENT_MAP = [
  // Write intents MUST come first — they conflict with read patterns
  { patterns: ['tạo đơn hàng', 'tạo order', 'đặt hàng', 'bán cho'], tool: 'create_order' },
  { patterns: ['tạo đơn nhập', 'tạo po', 'đặt hàng nhập', 'nhập thêm', 'tạo purchase order'], tool: 'create_po' },
  { patterns: ['nhắc nợ', 'gửi nhắc', 'nhắc khách', 'đòi nợ', 'remind'], tool: 'send_reminder' },

  // CRM/SRM intents (Mục 3-6 đặc tả) — đặt trước các pattern chung chung
  { patterns: ['churn', 'khách sắp mất', 'khách có nguy cơ', 'giữ chân khách'], tool: 'search_churn_alerts' },
  { patterns: ['rfm', 'clv', 'phân khúc khách', 'giá trị vòng đời', 'churn probability'], tool: 'search_customer_rfm' },
  { patterns: ['lead', 'khách tiềm năng', 'nguồn khách', 'webhook lead'], tool: 'search_leads' },
  { patterns: ['phiếu nhập kho', 'grn', 'nhận hàng po', 'kiểm hàng'], tool: 'search_grn' },
  // Thêm 'hóa đơn ncc' vì "hóa đơn NCC" là thứ mua hàng, không phải hóa đơn bán ra.
  // Không có nó thì câu này rơi xuống `search_invoices` (hóa đơn bán) vì chuỗi "hóa đơn"
  // khớp trước — cùng bài toán chuỗi-con với "hóa **đơn**" bị bắt bởi nhóm đơn bán.
  { patterns: ['hóa đơn mua', 'hóa đơn ncc', 'hóa đơn nhập', 'đối soát hóa đơn', 'purchase invoice', '3-way', 'dung sai'], tool: 'search_purchase_invoices' },
  { patterns: ['kraljic', 'hiệu suất nhà cung cấp', 'scorecard', 'xếp hạng ncc', 'otif'], tool: 'search_vendor_performance' },
  // PRM — phải đặt TRƯỚC pattern của khách hàng và của nhà cung cấp, vì câu hỏi về
  // đối tác hay chứa từ khoá chung ("lợi nhuận", "người giới thiệu"). Đặt sau sẽ bị
  // pattern phía trên bắt mất và trả về nhầm phân hệ.
  //
  // `resolveIntent` khớp bằng `lower.includes(pattern)` trên danh sách này THEO THỨ
  // TỰ, nên chỉ pattern đầu tiên khớp mới thắng. Vì vậy nhóm đối tác gộp chung một
  // hàng, và tool chi tiết hơn (`search_partner_referrals`) được chọn khi câu hỏi
  // chỉ rõ đang hỏi về MỘT đối tác — kiểm bằng `tool` của pattern trước đó.
  { patterns: ['đối tác', 'doi tac', 'partner', 'affiliate', 'hoa hồng', 'người giới thiệu',
    // KHÔNG dùng `\b` trước `đ`. Trong regex, `\b` là ranh giới dựa trên `\w` =
    // [A-Za-z0-9_], mà `đ` (U+0111) không thuộc tập đó ⇒ `\bđ` không bao giờ khớp.
    // Ranh giới thật đã có sẵn ở đầu chuỗi và sau `-\d{4}` là khoảng trắng.
    'lượt giới thiệu', 'phễu giới thiệu', /đt-\d{6}-\d{4}\b/i],
    tool: 'search_partner_performance' },
  // Nhóm đối tác PHẢI đứng trước nhóm nhà cung cấp và nhóm khách hàng (đã đặt ở trên),
  // vì `resolveIntent` trả về hàng khớp đầu tiên. `search_partner_referrals` được
  // `resolvePartnerIntent` chọn riêng khi câu hỏi có mã đối tác — xem hàm đó.

  { patterns: ['work order', 'lệnh sản xuất', 'lệnh sx'], tool: 'search_production' },
  { patterns: ['bom', 'định mức', 'định mức nvl', 'định mức nguyên vật liệu'], tool: 'search_production' },
  { patterns: ['lô hàng', 'lô sắp hết', 'hạn sử dụng', 'hsd', 'gần hết hạn'], tool: 'search_production' },
  { patterns: ['đơn nhập', 'purchase order', 'nhập hàng', 'mua hàng'], tool: 'search_purchase_orders' },
  // `resolveIntent` dùng `lower.includes(pattern)` — chuỗi TRẦN rất dễ khớp nhầm:
  //   'po'  khớp "áo **po**lo", "**po**stcard"  ⇒ tra đơn nhập khi khách hỏi sản phẩm
  //   'đơn' khớp "**đơn** giá", "đơn vị"       ⇒ tra đơn bán khi khách hỏi giá
  // Vì vậy chỉ giữ cụm nhiều từ, và dùng `\b` cho mã PO có chữ bên cạnh.
  { patterns: [/\bpo\b/, 'p/o', 'tờ po', 'po này', 'po đó'], tool: 'search_purchase_orders' },
  // ĐÃ BỎ pattern trần 'đơn' khỏi nhóm dưới đây.
  //
  // Lý do: "hóa **đơn**" là câu hỏi hỏi về HÓA ĐƠN, nhưng chuỗi con 'đơn' lại khớp
  // nhóm này — và nhóm này đứng TRƯỚC `search_invoices`, nên trước khi sửa:
  //     "hóa đơn" → search_orders   (SAI)
  //     "hoa don" → search_invoices (đúng, vì 'đơn' có dấu không có trong "hoa don")
  // Tức là viết không dấu lại CHE LỜI chứ không gây lỗi — rủi ro của việc so khớp
  // chuỗi con trên tiếng Việt có dấu. Giữ lại cụm 'đơn hàng' và 'bán hàng' là đủ;
  // "đơn giá"/"đơn vị" rơi về null thay vì trả nhầm, đúng như ý định ghi chú.
  { patterns: ['đơn hàng', 'bán hàng', 'sale', 'order'], tool: 'search_orders' },
  { patterns: ['ca làm', 'chấm công', 'attendance', 'bảng lương', 'payroll', 'bang luong'], tool: 'search_hr' },
  { patterns: ['lương', 'nhân sự', 'nhân viên', 'employee', 'hr', 'hiệu suất', 'chấm công'], tool: 'search_hr' },
  { patterns: ['chi phí', 'expense', 'khoản chi', 'các khoản chi', 'bút toán', 'số dư', 'tài khoản kế toán'], tool: 'search_finance' },
  { patterns: ['tài chính', 'kế toán', 'finance', 'accounting'], tool: 'search_finance' },
  { patterns: ['tồn kho', 'hàng tồn', 'hàng trong kho', 'low stock', 'sap het', 'hết hàng', 'tồn kho', 'cảnh báo tồn', 'inventory'], tool: 'search_inventory' },
  { patterns: ['sản phẩm', 'hàng hóa', 'product', 'giá', 'còn hàng', 'bán chạy', 'lợi nhuận cao'], tool: 'search_products' },
  { patterns: ['khách hàng', 'customer', 'khách hàng'], tool: 'search_customers' },
  { patterns: ['doanh thu', 'revenue', 'bán được', 'thu nhập', 'doanh số', 'lợi nhuận', 'profit'], tool: 'get_revenue' },
  { patterns: ['sản xuất', 'production'], tool: 'search_production' },
  { patterns: ['dự án', 'project', 'task', 'tiến độ'], tool: 'search_projects' },
  { patterns: ['công nợ', 'nợ', 'debt', 'no', 'con no'], tool: 'search_debts' },
  { patterns: ['nhà cung cấp', 'vendor', 'nhà cung cấp', 'supplier'], tool: 'search_vendors' },
  { patterns: ['khuyến mãi', 'promotion', 'giảm giá', 'voucher', 'coupon'], tool: 'search_promotions' },
  { patterns: ['hóa đơn', 'invoice', 'hoa don', 'vat'], tool: 'search_invoices' },
  { patterns: ['giao hàng', 'delivery', 'vận chuyển', 'ship', 'đang giao'], tool: 'search_deliveries' },
  { patterns: ['trả hàng', 'return', 'tra hang', 'hoàn trả', 'trả lại'], tool: 'search_returns' },
  { patterns: ['dashboard', 'tổng quan', 'tình hình', 'tong quan', 'kpi', 'business'], tool: 'get_dashboard' },
];

// Chuẩn hoá pattern ngay lúc nạp module (xem giải thích ở `resolveIntent`).
normalizeIntentMap(INTENT_MAP);

/**
 * Tạo một biến thể của regex đã BỎ DẤU, giữ nguyên cờ.
 *
 * Vì sao cần: regex viết theo thói quen tiếng Việt có dấu (`/hôm nay/`) sẽ không
 * bao giờ khớp chuỗi đã bỏ dấu (`"hom nay"`). Bỏ dấu cả hai vế thì khớp.
 *
 * An toàn: chỉ bỏ dấu ở `source`. Cờ như `i`, `m` giữ nguyên, và bỏ cờ `g`/`y` vì
 * regex có các cờ đó giữ `lastIndex` giữa các lần `test()` — dùng chung một object
 * regex ở nhiều lần gọi cho kết quả xenh kẽ. Các regex trong tệp này đều là chuỗi
 * đơn giản (`\b`, `\d`, `|`) nên bỏ dấu không làm đổi ý nghĩa.
 *
 * Dùng `function` chứ không phải `const` arrow: `normalizeIntentMap(INTENT_MAP)` chạy
 * ngay sau khi khai báo `INTENT_MAP`, tức là trước dòng định nghĩa hàm này. Arrow
 * gán vào `const` không được hoisting nên sẽ ném `ReferenceError` lúc nạp module.
 */
function deaccentedRegex(re) {
  return new RegExp(stripDiacritics(re.source), re.flags.replace(/[gy]/g, ''));
}

/**
 * So khớp từ khoá trên CẢ HAI vế: câu hỏi giữ dấu, và câu hỏi đã bỏ dấu.
 *
 * Vì sao phải chuẩn hoá thay vì viết pattern có dấu cho đủ:
 *   - Người dùng gõ "sắp hết" (có dấu). Pattern viết "sap het" thì không khớp,
 *     `resolveIntent` trả null ⇒ câu trả lời "tôi chưa hiểu câu hỏi của bạn".
 *   - Người dùng gõ "hoa don" (không dấu). Pattern viết "hóa đơn" thì không khớp.
 *
 * Chuẩn hoá cả hai về thì bất kể gõ kiểu nào cũng khớp, và không phải thêm biến thể
 * không dấu cho từng pattern. Trước khi sửa, có pattern thiếu biến thể nên chỉ chạy
 * được với một kiểu gõ. Xem `utils/vietnamese.js`.
 *
 * Kết quả được tính MỘT LẦN lúc nạp module và ghi vào `intent.__norm`, vì
 * `resolveIntent` chạy ở mỗi lượt chat mà danh sách không đổi.
 */
function normalizeIntentMap(map) {
  for (const intent of map) {
    const seen = new Set();
    intent.__norm = intent.patterns.map((p) => {
      if (typeof p !== 'string') {
        // Regex: thử trên câu gốc và trên câu đã bỏ dấu, mỗi về một biến thể regex.
        return { raw: p, norm: deaccentedRegex(p) };
      }
      const key = stripDiacritics(p).toLowerCase();
      // Trùng sau khi bỏ dấu thì giữ một — `includes` chạy O(n) nên rút gọn danh
      // sách có lợi, mà pattern trùng nhau không đổi kết quả khớp.
      if (seen.has(key)) return null;
      seen.add(key);
      return key;
    });
  }
  return map;
}

function resolveIntent(text) {
  const raw = text.toLowerCase();
  const lower = stripDiacritics(text).toLowerCase();
  for (const intent of INTENT_MAP) {
    const hit = intent.__norm.some((p) => {
      if (p === null) return false;
      if (typeof p === 'string') return lower.includes(p);
      return p.raw.test(raw) || p.norm.test(lower);
    });
    if (hit) return intent.tool;
  }
  return null;
}

/**
 * Chọn tool PRM tinh vi hơn khi câu hỏi nêu rõ MỘT đối tác.
 *
 * Vì sao cần bước riêng: `INTENT_MAP` khớp theo thứ tự và trả về tool đầu tiên khớp,
 * nên không thể biết "đối tác A" và "tất cả đối tác" cùng nằm trong một hàng pattern.
 * Câu hỏi có chứa mã `ĐT-YYYYMM-XXXX` thì chắc chắn đang hỏi về một đối tác, và
 * trả về cả bảng xếp hạng sẽ là câu trả lời sai.
 *
 * @returns {string|null} tool PRM, hoặc null nếu câu hỏi không nêu mã đối tác
 */
function resolvePartnerIntent(text) {
  const raw = text.toLowerCase();
  const lower = stripDiacritics(text).toLowerCase();
  // `\b` trước `đ` không dùng được — xem giải thích ở INTENT_MAP.
  const hasCode = /đt-\d{6}-\d{4}\b/i.test(raw) || /\bdt-\d{6}-\d{4}\b/.test(lower);
  // Mã đối tác tự nó đã đủ để gọi tool chi tiết, không cần từ khoá "đối tác".
  // Người dùng nhìn mã trên báo cáo in ra và gõ thẳng là hợp lý.
  if (hasCode) return 'search_partner_referrals';
  if (/đối tác|partner|affiliate|giới thiệu|hoa hồng/.test(raw)
    || /doi tac|partner|affiliate|gioi thieu|hoa hong/.test(lower)) {
    return 'search_partner_performance';
  }
  return null;
}

function extractParams(text, tool) {
  const params = {};
  // So khớp phải chạy trên CẢ HAI dạng của câu hỏi.
  //
  //   raw   = giữ dấu, hạ chữ thường
  //   lower = đã bỏ dấu
  //
  // Regex bên dưới viết theo thói quen tiếng Việt CÓ DẤU (`/hôm nay/`). Nếu chỉ thử
  // trên `lower` thì regex đó không bao giờ khớp gì cả, vì `lower` không còn dấu. Nếu
  // chỉ thử trên `raw` thì câu gõ không dấu ("hom nay") lại trượt. Thử cả hai thì
  // không cần sửa hàng chục regex, và regex viết có hay không dấu đều chạy được.
  //
  // Xem `utils/vietnamese.js` để hiểu vì sao phải bỏ dấu riêng cho chữ `đ`.
  const raw = text.toLowerCase();
  const lower = stripDiacritics(text).toLowerCase();
  // Regex viết có dấu phải được thử trên bản ĐÃ BỎ DẤU của chính nó, không chỉ thử
  // nguyên bản trên `lower` — nếu không thì `/hôm nay/` không bao giờ khớp "hom nay".
  const hit = (re) => re.test(raw) || deaccentedRegex(re).test(lower);

  // Period detection
  if (hit(/hôm nay|today/i)) params.period = 'today';
  else if (hit(/hôm qua|yesterday/i)) params.period = 'yesterday';
  else if (hit(/tuần này|this week/i)) params.period = 'this_week';
  else if (hit(/tuần trước|last week/i)) params.period = 'last_week';
  else if (hit(/tháng trước|last month/i)) params.period = 'last_month';
  else if (hit(/tháng này|this month|trong tháng/i)) params.period = 'this_month';
  else if (hit(/quý này|this quarter/i)) params.period = 'this_quarter';
  else if (hit(/năm nay|this year/i)) params.period = 'this_year';

  // Order status
  if (hit(/chờ xác nhận|pending/i)) params.status = 'PENDING';
  else if (hit(/đã xác nhận|confirmed/i)) params.status = 'CONFIRMED';
  else if (hit(/đang giao|shipping/i)) params.status = 'SHIPPING';
  else if (hit(/hoàn thành|completed/i)) params.status = 'COMPLETED';
  else if (hit(/đã hủy|cancelled|hủy/i)) params.status = 'CANCELLED';

  // Payment status
  if (hit(/chưa thanh toán|unpaid/i)) params.paymentStatus = 'UNPAID';
  else if (hit(/đã thanh toán|paid/i)) params.paymentStatus = 'PAID';
  else if (hit(/thanh toán một phần|partial/i)) params.paymentStatus = 'PARTIAL';

  // Sort / limit
  const limitMatch = raw.match(/(\d+)\s*(mới nhất|gần đây|top|đầu|first|last)/)
    || lower.match(/(\d+)\s*(moi nhat|gan day|top|dau|first|last)/);
  if (limitMatch) params.limit = parseInt(limitMatch[1]);

  const topMatch = raw.match(/(top|trên|cao nhất|nhiều nhất|lớn nhất)\s*(\d+)/)
    || lower.match(/(top|tren|cao nhat|nhieu nhat|lon nhat)\s*(\d+)/);
  if (topMatch) { params.limit = parseInt(topMatch[2]); params.sortOrder = 'desc'; }

  // Search query (extract text after specific keywords)
  //
  // Cắt trên ĐÚNG bản mà tìm thấy. Trước đây tìm vị trí trên `lower` (đã bỏ dấu)
  // nhưng lại cắt trên `text` (còn dấu) — độ dài hai bản khác nhau nên câu tìm kiếm ra
  // rác. Ở đây thử `raw` trước (marker viết có dấu, khớp nguyên văn), không khớp mới
  // thử `lower` với marker đã bỏ dấu, và cắt trên bản tương ứng.
  const searchMarkers = ['sản phẩm', 'tìm', 'tên', 'mã', 'thông tin', 'về', 'của'];
  const suffixStrip = /^(là|này|đó|trên|nào)\s*/i;
  for (const marker of searchMarkers) {
    const markerNorm = stripDiacritics(marker);
    let hitIn = null;
    let at = raw.indexOf(marker.toLowerCase());
    if (at >= 0) hitIn = { text, at, len: marker.length };
    if (!hitIn) {
      at = lower.indexOf(markerNorm);
      if (at >= 0) hitIn = { text: lower, at, len: markerNorm.length };
    }
    if (!hitIn) continue;
    const after = hitIn.text
      .slice(hitIn.at + hitIn.len)
      .trim()
      .replace(suffixStrip, '')
      .trim();
    if (after.length > 1 && after.length < 100) {
      // Trả về bản CÓ DẦU nếu tìm thấy ở `raw`, vì đó là chuỗi người dùng gõ và
      // dùng cho `contains` ở tầng truy vấn.
      params.search = hitIn.text === lower ? stripDiacritics(after) : after;
      break;
    }
  }

  // Production type
  if (hit(/lệnh sản xuất|work order|lệnh/i)) params.type = 'work_orders';
  else if (hit(/bom|định mức/i)) params.type = 'bom';
  else if (hit(/lô|lot|hạn sử dụng|hsd/i)) params.type = 'lots';

  // HR type
  if (hit(/lương|payroll|bảng lương/i)) params.type = 'payroll';
  else if (hit(/chấm công|attendance|ca làm/i)) params.type = 'attendance';

  // Finance type
  if (hit(/chi phí|expense/i)) params.type = 'expenses';
  else if (hit(/bút toán|journal/i)) params.type = 'journal';
  else if (hit(/tài khoản|số dư tài khoản/i)) params.type = 'accounts';

  // Customer debt filter
  if (hit(/có nợ|đang nợ|công nợ/)) params.hasDebt = true;

  // PRM: tham số riêng cho hai tool đối tác.
  //
  // `sortBy` được chuyển thẳng từ câu hỏi vào `roi.service.js`, nơi có danh sách
  // hợp lệ (`profit`/`revenue`/`conversion`/`referrals`) và tự gán về `profit` khi
  // không khớp. Ở đây chỉ viết TỪ có nghĩa, không dịch từ khoá tiếng Việt thành
  // tên cột — dịch sai thì truy vấn rác mà không báo lỗi.
  //
  // Mã đối tác lấy NGOÀI khối `if` bên dưới, vì mã `ĐT-YYYYMM-XXXX` tự nó đã đủ
  // để gọi tool chi tiết mà không cần từ khoá "đối tác". Nếu để trong khối thì câu
  // "ĐT-202610-0001 hiệu quả thế nào" không lấy được mã, dù người dùng đã gõ rõ.
  //
  // Lấy từ `raw` chứ không phải `lower`: service tra cứu theo mã GỐC trong cơ sở dữ
  // liệu (`code = 'ĐT-202610-0001'`), còn `lower` đã bỏ dấu thành `DT-202610-0001`
  // nên sẽ không tìm thấy. Người dùng gõ không dấu vẫn tra được vì tra cứu bằng
  // `contains` sau khi chuẩn hoá — xem `search_partner_referrals`.
  // Mã đối tác nhận được CẢ BA cách gõ: "ĐT-…", "đt-…", "DT-…". Bắt trên `raw`
  // bằng regex có dấu, rồi trên `lower` bằng regex không dấu. Kết quả luôn được
  // chuẩn hoá về dạng có dấu `ĐT-…` vì đó là dạng lưu trong cơ sở dữ liệu.
  const partnerCodeMatch =
    raw.match(/đt-\d{6}-\d{4}\b/i) || lower.match(/\bdt-\d{6}-\d{4}\b/);
  if (partnerCodeMatch) {
    const digits = partnerCodeMatch[0].match(/\d{6}-\d{4}/)[0];
    params.partnerCode = `ĐT-${digits}`;
  }

  if (hit(/đối tác|partner|affiliate|giới thiệu|hoa hồng/)) {
    if (hit(/giá trị|doanh thu|revenue|clv/)) params.sortBy = 'revenue';
    else if (hit(/tỷ lệ|chuyển đổi|conversion/)) params.sortBy = 'conversion';
    else if (hit(/số lượt|lượt giới thiệu/)) params.sortBy = 'referrals';
    else params.sortBy = 'profit';
    if (hit(/thực tế|đã thu|actual/)) params.metric = 'actual';
  }

  // Low stock
  if (hit(/hết hàng|sắp hết|low stock|tồn thấp/)) params.lowStock = true;

  // Expiring lots
  if (hit(/sắp hết hạn|expiring|gần hết hạn/)) params.expiringSoon = true;

  return params;
}

// ─── MAIN ───

async function processQuery(text) {
  // PRM: câu hỏi có mã đối tác cần tool chi tiết hơn bảng xếp hạng tổng. Xử lý ở
  // đây (thay vì thêm hàng pattern thứ hai) vì `resolveIntent` dừng ở hàng khớp đầu.
  const partnerTool = resolvePartnerIntent(text);
  const tool = partnerTool || resolveIntent(text);
  if (!tool) {
    return {
      success: false,
      message: `Xin lỗi, tôi chưa hiểu câu hỏi của bạn. Tôi có thể giúp bạn tra cứu:\n` +
        `• 📦 Sản phẩm, tồn kho\n• 📋 Đơn hàng, hóa đơn\n• 👤 Khách hàng, công nợ\n` +
        `• 💰 Doanh thu, tài chính, chi phí\n• 👥 Nhân sự, lương, chấm công\n` +
        `• 🏭 Sản xuất, lệnh SX, BOM, lô hàng\n• 📊 Dashboard tổng quan\n` +
        `• 🎯 CRM/SRM: lead, phân khúc RFM/CLV, cảnh báo churn, GRN, hóa đơn NCC, Kraljic\n` +
        `• 🤝 PRM: đối tác, hoa hồng, lợi nhuận ròng theo đối tác, phễu chuyển đổi`,
      data: null,
    };
  }

  // Block write tools from processQuery — use POST /api/agent/chat for actions
  if (isWriteTool(tool)) {
    return {
      success: false,
      message: `Thao tác "${tool}" yêu cầu xác nhận. Vui lòng sử dụng chat agent (POST /api/agent/chat) để thực hiện hành động này.`,
      data: null,
    };
  }

  const params = extractParams(text, tool);
  logger.info(`[DB-Agent] Tool: ${tool}, Params:`, logger.truncateLog(params));

  try {
    const result = await HANDLERS[tool](params);
    return {
      success: true,
      tool,
      params,
      data: result.data,
      total: result.total,
      summary: result.summary,
      message: result.message,
    };
  } catch (err) {
    logger.error(`[DB-Agent] Error in ${tool}:`, err.message);
    return {
      success: false,
      message: `Lỗi khi truy vấn: ${err.message}`,
      data: null,
    };
  }
}

async function generateResponse(nlQuery, dbResult) {
  if (!dbResult.success) return dbResult.message;
  if (dbResult.data?.length === 0) return `Không tìm thấy dữ liệu phù hợp cho câu hỏi "${nlQuery}".`;

  let reply = dbResult.summary ? `${dbResult.summary}\n\n` : '';
  reply += dbResult.message || '';

  return reply.trim() || 'Đã tìm thấy dữ liệu.';
}

module.exports = {
  processQuery,
  generateResponse,
  HANDLERS,
  resolveIntent,
  resolvePartnerIntent,
  extractParams,
  WRITE_TOOLS,
  isWriteTool,
};
