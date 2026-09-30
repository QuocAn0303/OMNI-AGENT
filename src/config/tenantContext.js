/**
 * config/tenantContext.js — AsyncLocalStorage cho multi-tenant scoping
 *
 * Cơ chế:
 * - tenantStorage.run({ tenantId, bypassTenant }, callback) tạo context
 * - Prisma extension đọc tenantStorage.getStore() để auto-inject tenantId
 * - Context tự động propagate qua async/await/Promise (nhờ Node async_hooks)
 *
 * Usage trong middleware:
 *   tenantStorage.run({ tenantId: req.user.tenantId }, () => next())
 *
 * Usage trong public route (QR ordering):
 *   const { setTenantContext } = require('../config/tenantContext')
 *   setTenantContext(table.tenantId)  // set trước khi query
 */
const { AsyncLocalStorage } = require('async_hooks');

const tenantStorage = new AsyncLocalStorage();

const getTenantContext = () => tenantStorage.getStore() || null;
const getTenantId = () => tenantStorage.getStore()?.tenantId || null;
const isBypassTenant = () => tenantStorage.getStore()?.bypassTenant === true;

/**
 * Chạy `fn` trong tenant context.
 *
 * QUAN TRỌNG: wrapper phải là `async` + `await fn()`. Nếu chỉ `tenantStorage.run(ctx, fn)`
 * thì khi caller viết `runWithTenant(t, () => service())` (arrow đồng bộ trả về promise),
 * Prisma extension đọc `getTenantId()` ở nhánh async được tạo NGOÀI AsyncLocalStorage
 * frame → trả `null` → KHÔNG inject tenantId → đọc/cross-tenant dữ liệu.
 * `await fn()` tạo promise frame bên trong frame nên context luân chuyển đúng.
 *
 * Caller KHÔNG cần tự viết `async` ở callback nữa — cả hai kiểu đều an toàn.
 */
const runWithTenant = (tenantId, fn, bypass = false) =>
  tenantStorage.run({ tenantId, bypassTenant: bypass }, async () => await fn());

module.exports = {
  tenantStorage,
  getTenantContext,
  getTenantId,
  isBypassTenant,
  runWithTenant,
};
