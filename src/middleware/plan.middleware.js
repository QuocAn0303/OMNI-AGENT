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

const getActiveSubscription = async (tenantId) => {
  if (!tenantId) {
    return null;
  }
  return prisma.tenantSubscription.findFirst({
    where: { tenantId, status: { in: ["ACTIVE", "TRIAL"] } },
    include: { plan: true },
    orderBy: { createdAt: "desc" },
  });
};

const checkFeature = (featureKey) => {
  return async (req, res, next) => {
    try {
      const tenantId = req.user?.tenantId;
      if (!tenantId) return next();

      const sub = await getActiveSubscription(tenantId);
      if (!sub) return next();

      const features = sub.plan.features || {};
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
          return next({ status: 403, message: `Đã đạt giới hạn ${featureKey} (${limit}) của gói ${sub.plan.name}` });
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

      const sub = await getActiveSubscription(tenantId);
      if (!sub) return next();

      const features = sub.plan.features || {};
      const allowedModules = features.allowedModules || [];

      if (allowedModules.includes("*")) return next();

      if (!allowedModules.includes(moduleKey)) {
        return next({ status: 403, message: `Gói ${sub.plan.name} không hỗ trợ tính năng này. Vui lòng nâng cấp gói.` });
      }

      next();
    } catch (err) {
      next(err);
    }
  };
};

const getMyPlanFeatures = async (tenantId) => {
  if (!tenantId) return null;
  const sub = await getActiveSubscription(tenantId);
  if (!sub) return null;
  return {
    plan: sub.plan,
    subscription: sub,
    features: sub.plan.features || {},
    isExpired: sub.status === "EXPIRED",
    isAllowed: (moduleKey) => {
      const allowed = sub.plan.features?.allowedModules || [];
      return allowed.includes("*") || allowed.includes(moduleKey);
    },
  };
};

module.exports = { checkFeature, requireModule, getMyPlanFeatures };
