/**
 * middleware/plan.middleware.js — Kiểm tra giới hạn gói dịch vụ (Subscription Plan Enforcement)
 * 
 * Tổng quan:
 * - Middleware kiểm tra subscription plan của tenant trước khi cho phép tạo resource
 * - 2 cấp độ: feature-level (checkFeature) và module-level (requireModule)
 * - Hỗ trợ đếm số lượng hiện tại và so sánh với quota trong features JSON của plan
 * 
 * Hàm:
 * - getActiveSubscription(tenantId): Lấy subscription ACTIVE/TRIAL mới nhất của tenant
 * - checkFeature(featureKey): Middleware kiểm tra quota (maxUsers, maxWarehouses, maxProducts)
 *     - Nếu limit là false/0 → chặn
 *     - Nếu limit là number → đếm hiện tại, nếu >= limit → chặn
 * - requireModule(moduleKey): Middleware kiểm tra module có trong allowedModules không
 *     - Wildcard "*" → cho phép tất cả
 * - getMyPlanFeatures(tenantId): Helper lấy features + isExpired + isAllowed() cho frontend
 */

const prisma = require("../config/prisma");

// B2: cache plan theo tenant (30s) — getEffectivePlan được gọi trên MỌI request
// có requireModule/checkFeature → trước đây 1-2 query DB mỗi request
const CACHE_TTL_MS = 30 * 1000;
const planCache = new Map(); // tenantId -> { sub, plan, expiresAt }

const loadPlanBundle = async (tenantId) => {
  const sub = await prisma.tenantSubscription.findFirst({
    where: { tenantId, status: { in: ["ACTIVE", "TRIAL"] } },
    include: { plan: true },
    orderBy: { createdAt: "desc" },
  });
  if (sub) return { sub, plan: sub.plan };
  const freePlan = await prisma.subscriptionPlan.findUnique({ where: { key: "free" } });
  return { sub: null, plan: freePlan || null };
};

const getPlanBundle = async (tenantId) => {
  if (!tenantId) return { sub: null, plan: null };
  const cached = planCache.get(tenantId);
  if (cached && cached.expiresAt > Date.now()) return cached;
  const bundle = await loadPlanBundle(tenantId);
  planCache.set(tenantId, { ...bundle, expiresAt: Date.now() + CACHE_TTL_MS });
  return bundle;
};

const getActiveSubscription = async (tenantId) => {
  if (!tenantId) return null;
  return (await getPlanBundle(tenantId)).sub;
};

// M10: tenant không có subscription → mặc định gói FREE (key "free" trong seed)
// Không bypass nữa — plan có module "free" mới được dùng
const getEffectivePlan = async (tenantId) => {
  if (!tenantId) return null;
  return (await getPlanBundle(tenantId)).plan;
};

// Gọi sau khi đổi subscription (create/change/cancel/webhook PayOS/expire)
const invalidatePlanCache = (tenantId) => {
  if (tenantId) planCache.delete(tenantId);
  else planCache.clear();
};

const checkFeature = (featureKey) => {
  return async (req, res, next) => {
    try {
      const tenantId = req.user?.tenantId;
      if (!tenantId) return next();

      const plan = await getEffectivePlan(tenantId);
      if (!plan) return next();

      const features = plan.features || {};
      const limit = features[featureKey];

      if (limit === false || limit === 0) {
        return next({ status: 403, message: `Gói hiện tại không hỗ trợ tính năng này` });
      }

      if (typeof limit === "number") {
        let count = 0;
        switch (featureKey) {
          case "maxUsers":
            count = await prisma.user.count({ where: { tenantId, isActive: true } });
            break;
          case "maxWarehouses":
            count = await prisma.warehouse.count({ where: { isActive: true } });
            break;
          case "maxProducts":
            count = await prisma.product.count({ where: { isActive: true } });
            break;
        }
        if (count >= limit) {
          return next({ status: 403, message: `Đã đạt giới hạn ${featureKey} (${limit}) của gói ${plan.name}` });
        }
      }

      next();
    } catch (err) {
      next(err);
    }
  };
};

const requireModule = (moduleKey) => {
  return async (req, res, next) => {
    try {
      const tenantId = req.user?.tenantId;
      if (!tenantId) return next();

      const plan = await getEffectivePlan(tenantId);
      if (!plan) return next();

      const features = plan.features || {};
      const allowedModules = features.allowedModules || [];

      if (allowedModules.includes("*")) return next();

      if (!allowedModules.includes(moduleKey)) {
        return next({ status: 403, message: `Gói ${plan.name} không hỗ trợ tính năng này. Vui lòng nâng cấp gói.` });
      }

      next();
    } catch (err) {
      next(err);
    }
  };
};

const getMyPlanFeatures = async (tenantId) => {
  if (!tenantId) return null;
  const plan = await getEffectivePlan(tenantId);
  if (!plan) return null;
  const sub = await getActiveSubscription(tenantId).catch(() => null);
  return {
    plan,
    subscription: sub,
    features: plan.features || {},
    isExpired: sub?.status === "EXPIRED",
    isAllowed: (moduleKey) => {
      const allowed = plan.features?.allowedModules || [];
      return allowed.includes("*") || allowed.includes(moduleKey);
    },
  };
};

module.exports = { checkFeature, requireModule, getMyPlanFeatures, invalidatePlanCache };
