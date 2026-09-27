const prisma = require("../config/prisma");
const logger = require("../utils/logger");

let cache = { timestamp: 0, data: {} };
const CACHE_TTL = 60000;

const loadPermissions = async () => {
  if (Date.now() - cache.timestamp < CACHE_TTL) return cache.data;
  const rows = await prisma.rolePermission.findMany({
    where: { isGranted: true },
  });
  const map = {};
  for (const rp of rows) {
    if (!map[rp.role]) map[rp.role] = [];
    map[rp.role].push(rp.permissionKey);
  }
  cache = { timestamp: Date.now(), data: map };
  return map;
};

const hasPermission = (role, permissionKey) => {
  if (["SUPER_OMEGA_ULTRA_ADMIN", "SUPER_ADMIN"].includes(role)) return true;
  const perms = cache.data[role] || [];
  return perms.includes(permissionKey);
};

const authorizePermission = (...permissionKeys) => {
  return async (req, res, next) => {
    try {
      await loadPermissions();
      const hasAll = permissionKeys.every(pk => hasPermission(req.user.role, pk));
      if (!hasAll) {
        return res.status(403).json({ success: false, message: "Bạn không có quyền thực hiện hành động này" });
      }
      next();
    } catch (err) {
      logger.error("[permission] error:", err.message);
      next(err);
    }
  };
};

const clearCache = () => { cache = { timestamp: 0, data: {} }; };

module.exports = { authorizePermission, hasPermission, clearCache };
