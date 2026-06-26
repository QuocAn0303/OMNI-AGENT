/**
 * modules/projects/project-access.middleware.js — Middleware kiểm tra quyền truy cập dự án
 *
 * Tổng quan:
 * - Middleware kiểm tra user có quyền truy cập vào project hay không
 * - ADMIN/SUPER_ADMIN luôn bypass — được truy cập mọi project
 * - Các role khác phải là thành viên của project (có ProjectMember record)
 * - Tùy chọn requireRoles ràng buộc thêm vai trò trong project (vd chỉ OWNER)
 * - Gắn req.projectMembership để handler dùng thêm
 *
 * Hàm:
 * - requireProjectMember({ requireRoles }): Middleware factory — kiểm tra membership, optional role restriction
 */
// src/modules/projects/project-access.middleware.js
// Middleware kiểm tra user có quyền truy cập project hay không.
//
// Quy tắc:
//   - SUPER_ADMIN, ADMIN: luôn truy cập được mọi project
//   - Các role khác (MANAGER/CASHIER/WAREHOUSE): phải là thành viên của project
//     (có record ProjectMember) — bất kể role MEMBER/OWNER/VIEWER
//
// Tùy chọn `requireRoles`: ràng buộc thêm vai trò trong project
//   vd: requireProjectMember({ requireRoles: ['OWNER'] }) chỉ cho OWNER vào
//
// Cách dùng:
//   router.patch('/:id', authenticate, requireProjectMember(), handler)
//   router.delete('/:id/members/:userId', authenticate,
//     requireProjectMember({ requireRoles: ['OWNER'] }), handler)
const prisma = require("../../config/prisma");

const GLOBAL_BYPASS_ROLES = new Set(["SUPER_ADMIN", "ADMIN"]);

const requireProjectMember = ({ requireRoles = null } = {}) => {
  return async (req, res, next) => {
    try {
      const user = req.user;
      if (!user) {
        return next({ status: 401, message: "Chưa xác thực" });
      }

      // Bypass cho ADMIN/SUPER_ADMIN
      if (GLOBAL_BYPASS_ROLES.has(user.role)) {
        return next();
      }

      const projectId = req.params.id || req.params.projectId;
      if (!projectId) {
        return next({ status: 400, message: "Thiếu projectId trong URL" });
      }

      const membership = await prisma.projectMember.findUnique({
        where: { projectId_userId: { projectId, userId: user.id } },
        select: { role: true },
      });

      if (!membership) {
        return next({ status: 403, message: "Bạn không phải thành viên của dự án này" });
      }

      if (requireRoles && !requireRoles.includes(membership.role)) {
        return next({
          status: 403,
          message: `Cần vai trò ${requireRoles.join("/")} trong dự án để thực hiện thao tác này`,
        });
      }

      // Gắn membership vào req để route handler dùng thêm
      req.projectMembership = membership;
      next();
    } catch (err) {
      next(err);
    }
  };
};

module.exports = { requireProjectMember };
