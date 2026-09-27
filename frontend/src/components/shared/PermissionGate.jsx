import { useAuthStore } from "../../stores/authStore";

const ROLE_PERMISSIONS = {
  SUPER_OMEGA_ULTRA_ADMIN: "*",
  SUPER_ADMIN: "*",
  ADMIN: [
    "products.view", "products.create", "products.edit", "products.delete", "products.editPrice", "products.editCost",
    "orders.view", "orders.create", "orders.edit", "orders.cancel", "orders.export",
    "customers.view", "customers.create", "customers.edit", "customers.delete",
    "inventory.view", "inventory.import", "inventory.export", "inventory.adjust",
    "hr.view", "hr.create", "hr.edit", "hr.delete", "hr.payroll",
    "accounting.view", "accounting.journal", "accounting.expenses", "accounting.reports",
    "settings.view", "settings.edit",
    "reports.view", "reports.export",
  ],
  MANAGER: [
    "products.view", "products.create", "products.edit", "products.editPrice",
    "orders.view", "orders.create", "orders.edit",
    "customers.view", "customers.create", "customers.edit",
    "inventory.view", "inventory.import", "inventory.export",
    "hr.view",
    "accounting.view", "accounting.expenses", "accounting.reports",
    "settings.view",
    "reports.view", "reports.export",
  ],
  ACCOUNTANT: [
    "accounting.view", "accounting.journal", "accounting.expenses", "accounting.reports",
    "reports.view", "reports.export",
  ],
  CASHIER: [
    "products.view",
    "orders.view", "orders.create",
    "customers.view", "customers.create",
    "inventory.view",
  ],
  WAREHOUSE: [
    "inventory.view", "inventory.import", "inventory.export",
  ],
};

const hasPermission = (role, permission) => {
  if (!role) return false;
  const perms = ROLE_PERMISSIONS[role];
  if (!perms) return false;
  if (perms === "*") return true;
  return perms.includes(permission);
};

const PermissionGate = ({ permission, children, fallback = null }) => {
  const role = useAuthStore((s) => s.user?.role);
  if (hasPermission(role, permission)) return children;
  return fallback;
};

export default PermissionGate;
