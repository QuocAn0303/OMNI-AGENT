/**
 * Component: layout/Sidebar — Menu điều hướng trái toàn hệ thống
 *
 * Tổng quan:
 * - Component chính để hiển thị sidebar menu dạng dọc, phân nhóm theo chức năng
 * - Props: collapsed (bool), onToggleCollapse (func), mobileOpen (bool), onMobileClose (func)
 * - Logic chính: lấy user role từ authStore, lọc menu hiển thị theo role
 *   ADMIN/MANAGER/CASHIER/WAREHOUSE/SUPER_ADMIN/SUPER_OMEGA_ULTRA_ADMIN
 * - Hỗ trợ chế độ SUPER_OMEGA_ULTRA_ADMIN với menu nền tảng riêng
 * - Hiển thị avatar user & nút logout ở footer
 *
 * Exports:
 * - Sidebar: React functional component (default export)
 */
import { useMemo } from "react";
import { Menu } from "antd";
import aduduLogo from "../../assets/Adudu.png";
import { useLocation, useNavigate } from "react-router-dom";
import {
  DashboardOutlined,
  LineChartOutlined,
  ShoppingCartOutlined,
  FileTextOutlined,
  UndoOutlined,
  ShoppingOutlined,
  DatabaseOutlined,
  ReconciliationOutlined,
  TeamOutlined,
  UserOutlined,
  ShopOutlined,
  SolutionOutlined,
  FileExcelOutlined,
  AuditOutlined,
  LeftOutlined,
  RightOutlined,
  LogoutOutlined,
  BankOutlined,
  WalletOutlined,
  AccountBookOutlined,
  ContainerOutlined,
  PieChartOutlined,
  FundOutlined,
  SwapOutlined,
  UploadOutlined,
  CheckSquareOutlined,
  ClusterOutlined,
  ApiOutlined,
  NotificationOutlined,
  ProjectOutlined,
  ExperimentOutlined,
  TagOutlined,
  CrownOutlined,
  ArrowUpOutlined,
  BarcodeOutlined,
} from "@ant-design/icons";
import useAuthStore from "../../stores/authStore";

/**
 * Sidebar — Menu điều hướng trái, phân nhóm theo chức năng
 *
 * Phân quyền: lọc menu theo role từ authStore
 *   - ADMIN:            toàn bộ menu
 *   - MANAGER:          ẩn Users, Reports, Audit
 *   - CASHIER/WAREHOUSE: chỉ Dashboard, POS, Orders, Products, Customers
 */
//chỉnh cho super_admin có quyền như admin nhưng có thêm quyền quản lý user và xem audit log, báo cáo
const ALL_ROLES = [
  "ADMIN",
  "MANAGER",
  "CASHIER",
  "WAREHOUSE",
  "SUPER_ADMIN",
  "SUPER_OMEGA_ULTRA_ADMIN",
];

// ----- Menu dành riêng cho SUPER_OMEGA_ULTRA_ADMIN (khu vực quản trị hệ thống) -----
const SUPER_ADMIN_MENU_GROUPS = [
  {
    key: "platform",
    label: "NỀN TẢNG",
    roles: ["SUPER_OMEGA_ULTRA_ADMIN"],
    items: [
      {
        key: "/admin",
        icon: <DashboardOutlined />,
        label: "Dashboard tổng quan",
      },
      {
        key: "/admin/tenants",
        icon: <ShopOutlined />,
        label: "Quản lý Tenants",
      },
    ],
  },
  {
    key: "billing",
    label: "BILLING",
    roles: ["SUPER_OMEGA_ULTRA_ADMIN"],
    items: [
      { key: "/admin/plans", icon: <CrownOutlined />, label: "Gói dịch vụ" },
      {
        key: "/admin/subscriptions",
        icon: <TeamOutlined />,
        label: "Subscriptions",
      },
      {
        key: "/admin/invoices",
        icon: <FileTextOutlined />,
        label: "Hóa đơn hệ thống",
      },
    ],
  },
  {
    key: "admin-system",
    label: "HỆ THỐNG",
    roles: ["SUPER_OMEGA_ULTRA_ADMIN"],
    items: [
      {
        key: "/admin/upgrade-requests",
        icon: <ArrowUpOutlined />,
        label: "Yêu cầu nâng gói",
      },
      {
        key: "/admin/campaigns",
        icon: <FundOutlined />,
        label: "Chiến dịch Upsell",
      },
    ],
  },
];

// ----- Menu definition -----
const MENU_GROUPS = [
  {
    key: "overview",
    label: "TỔNG QUAN",
    roles: ALL_ROLES,
    items: [
      { key: "/dashboard", icon: <DashboardOutlined />, label: "Dashboard" },
      {
        key: "/analytics",
        icon: <LineChartOutlined />,
        label: "Analytics",
        roles: ["ADMIN", "MANAGER"],
      },
    ],
  },
  {
    key: "ai",
    label: "AI AGENT",
    roles: ALL_ROLES,
    items: [
      {
        key: "/agent-analytics",
        icon: <FundOutlined />,
        label: "AI Analytics",
        roles: ["ADMIN", "MANAGER"],
      },
    ],
  },
  {
    key: "sales",
    label: "BÁN HÀNG",
    roles: ALL_ROLES,
    items: [
      { key: "/pos", icon: <ShoppingCartOutlined />, label: "POS" },
      { key: "/orders", icon: <FileTextOutlined />, label: "Đơn hàng" },
      {
        key: "/returns",
        icon: <UndoOutlined />,
        label: "Trả hàng",
        roles: ["ADMIN", "MANAGER"],
      },
    ],
  },
  {
    key: "inventory",
    label: "KHO & SẢN PHẨM",
    roles: ALL_ROLES,
    items: [
      { key: "/products", icon: <ShoppingOutlined />, label: "Sản phẩm" },
      {
        key: "/inventory",
        icon: <DatabaseOutlined />,
        label: "Kho hàng",
        roles: ["ADMIN", "MANAGER"],
      },
      {
        key: "/cycle-count",
        icon: <ReconciliationOutlined />,
        label: "Kiểm kê",
        roles: ["ADMIN", "MANAGER", "WAREHOUSE"],
      },
      {
        key: "/serial-numbers",
        icon: <BarcodeOutlined />,
        label: "Serial Number",
        roles: ["ADMIN", "MANAGER", "WAREHOUSE"],
      },
    ],
  },
  {
    key: "crm",
    label: "QUAN HỆ",
    roles: ALL_ROLES,
    items: [
      { key: "/customers", icon: <TeamOutlined />, label: "Khách hàng" },
      {
        key: "/crm/tasks",
        icon: <CheckSquareOutlined />,
        label: "Nhiệm vụ CSKH",
      },
      {
        key: "/crm/segments",
        icon: <ClusterOutlined />,
        label: "Phân khúc KH",
        roles: ["ADMIN", "MANAGER"],
      },
      {
        key: "/crm/campaigns",
        icon: <NotificationOutlined />,
        label: "Chiến dịch",
        roles: ["ADMIN", "MANAGER"],
      },
      {
        key: "/store-credits",
        icon: <WalletOutlined />,
        label: "Store Credit",
        roles: ["ADMIN", "MANAGER"],
      },
      {
        key: "/tags",
        icon: <TagOutlined />,
        label: "Quản lý Tag",
        roles: ["ADMIN", "MANAGER"],
      },
    ],
  },
  {
    key: "hr",
    label: "NHÂN SỰ",
    roles: ["ADMIN", "MANAGER"],
    items: [{ key: "/hr", icon: <SolutionOutlined />, label: "HR & Lương" }],
  },
  {
    key: "projects",
    label: "DỰ ÁN",
    roles: ["ADMIN", "MANAGER"],
    items: [{ key: "/projects", icon: <ProjectOutlined />, label: "Dự án" }],
  },
  {
    key: "production",
    label: "SẢN XUẤT",
    roles: ["ADMIN", "MANAGER", "WAREHOUSE"],
    items: [
      { key: "/production", icon: <ExperimentOutlined />, label: "Sản xuất" },
      {
        key: "/lot-tracking",
        icon: <DatabaseOutlined />,
        label: "Lô / Hạn dùng",
        roles: ["ADMIN", "MANAGER", "WAREHOUSE"],
      },
    ],
  },
  {
    key: "accounting",
    label: "KẾ TOÁN & TÀI CHÍNH",
    roles: ["ADMIN", "MANAGER"],
    items: [
      { key: "/finance", icon: <FundOutlined />, label: "Sức khỏe TC" },
      { key: "/accounting-reports", icon: <FileTextOutlined />, label: "Sổ sách kế toán" },
      {
        key: "/debts",
        icon: <SwapOutlined />,
        label: "Công nợ",
        roles: ["ADMIN", "MANAGER", "CASHIER"],
      },
      { key: "/expenses", icon: <WalletOutlined />, label: "Chi phí" },
      { key: "/vendors", icon: <BankOutlined />, label: "Nhà cung cấp" },
      {
        key: "/purchase-orders",
        icon: <ContainerOutlined />,
        label: "Mua hàng",
      },
      {
        key: "/financial-reports",
        icon: <PieChartOutlined />,
        label: "BC tài chính",
      },
      {
        key: "/tax-reports",
        icon: <FileExcelOutlined />,
        label: "Báo cáo thuế",
      },
      {
        key: "/einvoice",
        icon: <FileTextOutlined />,
        label: "Hóa đơn điện tử",
      },
      {
        key: "/bank-reco",
        icon: <ReconciliationOutlined />,
        label: "Đối soát NH",
      },
      {
        key: "/fixed-assets",
        icon: <BankOutlined />,
        label: "Tài sản cố định",
      },
      { key: "/currency", icon: <SwapOutlined />, label: "Tỷ giá ngoại tệ" },
      {
        key: "/marketplace",
        icon: <ShoppingCartOutlined />,
        label: "Sàn TMĐT",
      },
      {
        key: "/report-builder",
        icon: <PieChartOutlined />,
        label: "Report Builder",
      },
      { key: "/workflows", icon: <FundOutlined />, label: "Workflow" },
      {
        key: "/journal",
        icon: <AccountBookOutlined />,
        label: "Sổ kế toán",
        roles: ["ADMIN"],
      },
    ],
  },
  {
    key: "system",
    label: "HỆ THỐNG",
    roles: ["ADMIN", "MANAGER", "SUPER_ADMIN", "SUPER_OMEGA_ULTRA_ADMIN"],
    items: [
      {
        key: "/users",
        icon: <UserOutlined />,
        label: "Tài khoản",
        roles: ["ADMIN", "SUPER_ADMIN", "SUPER_OMEGA_ULTRA_ADMIN"],
      },
      {
        key: "/reports",
        icon: <FileExcelOutlined />,
        label: "Báo cáo",
        roles: ["ADMIN"],
      },
      {
        key: "/audit",
        icon: <AuditOutlined />,
        label: "Audit Log",
        roles: ["ADMIN"],
      },
      {
        key: "/import",
        icon: <UploadOutlined />,
        label: "Import dữ liệu",
        roles: ["ADMIN", "MANAGER"],
      },
      {
        key: "/integrations",
        icon: <ApiOutlined />,
        label: "Tích hợp & API keys",
        roles: ["ADMIN"],
      },
      // Admin routes moved to SuperAdminLayout (dark sidebar) — not shown here
    ],
  },
  {
    key: "account",
    label: "TÀI KHOẢN",
    roles: ALL_ROLES,
    items: [
      {
        key: "/subscription",
        icon: <CrownOutlined />,
        label: "Gói dịch vụ",
      },
      {
        key: "/profile",
        icon: <UserOutlined />,
        label: "Hồ sơ",
      },
    ],
  },
];

function buildMenuItems(userRole, menuGroups) {
  const items = [];
  for (const group of menuGroups) {
    if (group.roles && !group.roles.includes(userRole)) continue;

    const visibleItems = group.items.filter(
      (it) => !it.roles || it.roles.includes(userRole),
    );
    if (visibleItems.length === 0) continue;

    // SUPER_OMEGA_ULTRA_ADMIN: đổi nhãn CRM thành Marketing Hệ Thống
    let groupLabel = group.label;
    if (userRole === "SUPER_OMEGA_ULTRA_ADMIN" && group.key === "crm") {
      groupLabel = "MARKETING HỆ THỐNG";
    }

    items.push({
      type: "group",
      key: group.key,
      label: groupLabel,
      children: visibleItems.map(({ key, icon, label }) => {
        // Đổi "Chiến dịch" → "Chiến dịch Upsell" cho SUPER_OMEGA_ULTRA_ADMIN
        if (
          userRole === "SUPER_OMEGA_ULTRA_ADMIN" &&
          (key === "/crm/campaigns" || label === "Chiến dịch")
        ) {
          return { key, icon, label: "Chiến dịch Upsell" };
        }
        return { key, icon, label };
      }),
    });
  }
  return items;
}

export default function Sidebar({
  collapsed,
  onToggleCollapse,
  mobileOpen,
  onMobileClose,
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout, originalToken } = useAuthStore();

  const userRole = user?.role || "CASHIER";

  // SUPER_OMEGA_ULTRA_ADMIN: chỉ show menu admin, trừ khi đang support mode (impersonate)
  const isSuperAdmin = userRole === "SUPER_OMEGA_ULTRA_ADMIN";
  const isSupportMode = !!originalToken;

  const activeMenuGroups =
    isSuperAdmin && !isSupportMode ? SUPER_ADMIN_MENU_GROUPS : MENU_GROUPS;

  const menuItems = useMemo(
    () => buildMenuItems(userRole, activeMenuGroups),
    [userRole, activeMenuGroups],
  );

  // Xác định key active dựa trên pathname
  const selectedKey = useMemo(() => {
    const allKeys = (
      isSuperAdmin && !isSupportMode ? SUPER_ADMIN_MENU_GROUPS : MENU_GROUPS
    ).flatMap((g) => g.items.map((i) => i.key));
    const matched = allKeys.find(
      (k) => location.pathname === k || location.pathname.startsWith(k + "/"),
    );
    return matched || location.pathname;
  }, [location.pathname, isSuperAdmin, isSupportMode]);

  const userInitials = (user?.fullName || user?.username || "U")
    .split(" ")
    .slice(-2)
    .map((s) => s[0]?.toUpperCase())
    .join("");

  return (
    <>
      {mobileOpen && (
        <div
          className="sidebar-backdrop"
          onClick={onMobileClose}
          aria-hidden="true"
        />
      )}
      <aside
        className={`sidebar ${collapsed ? "sidebar--collapsed" : ""} ${mobileOpen ? "sidebar--mobile-open" : ""}`}
      >
        {/* Toggle button */}
        <button
          type="button"
          className="sidebar__collapse-btn"
          onClick={onToggleCollapse}
          aria-label={collapsed ? "Mở rộng sidebar" : "Thu gọn sidebar"}
        >
          {collapsed ? (
            <RightOutlined style={{ fontSize: 10 }} />
          ) : (
            <LeftOutlined style={{ fontSize: 10 }} />
          )}
        </button>

        {/* Logo */}
        <div className="sidebar__logo">
          <img
            src={aduduLogo}
            alt="Aduu ERP Logo"
            style={{
              height: 32,
              width: 32,
              objectFit: "contain",
              borderRadius: 6, // Bo góc nhẹ cho logo thêm mềm mại
              marginRight: 10,
            }}
          />
          <div
            className="sidebar__logo-text"
            style={{ display: "flex", alignItems: "center", gap: 6 }}
          >
            Aduu ERP
            {isSuperAdmin && !isSupportMode && (
              <span className="sidebar__admin-badge">SA</span>
            )}
          </div>
        </div>

        {/* Menu */}
        <div className="sidebar__menu">
          <Menu
            mode="inline"
            theme="dark"
            selectedKeys={[selectedKey]}
            items={menuItems}
            onClick={({ key }) => navigate(key)}
            inlineCollapsed={collapsed}
            style={{ background: "transparent", borderRight: 0 }}
          />
        </div>

        {/* User footer */}
        <div className="sidebar__footer">
          <div
            className="sidebar__user"
            onClick={logout}
            title="Đăng xuất"
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === "Enter" && logout()}
          >
            <div className="sidebar__user-avatar">{userInitials}</div>
            <div className="sidebar__user-info">
              <div className="sidebar__user-name">
                {user?.fullName || user?.username}
              </div>
              <div className="sidebar__user-role">{user?.role}</div>
            </div>
            {!collapsed && (
              <LogoutOutlined
                style={{ color: "var(--text-inverse-muted)", fontSize: 14 }}
              />
            )}
          </div>
        </div>
      </aside>
    </>
  );
}
