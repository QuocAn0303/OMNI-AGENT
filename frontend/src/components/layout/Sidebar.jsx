import { useMemo } from 'react';
import { Menu } from 'antd';
import { useLocation, useNavigate } from 'react-router-dom';
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
  NotificationOutlined,
  ProjectOutlined,
} from '@ant-design/icons';
import useAuthStore from '../../stores/authStore';

/**
 * Sidebar — Menu điều hướng trái, phân nhóm theo chức năng
 *
 * Phân quyền: lọc menu theo role từ authStore
 *   - ADMIN:            toàn bộ menu
 *   - MANAGER:          ẩn Users, Reports, Audit
 *   - CASHIER/WAREHOUSE: chỉ Dashboard, POS, Orders, Products, Customers
 */

const ALL_ROLES = ['ADMIN', 'MANAGER', 'CASHIER', 'WAREHOUSE'];

// ----- Menu definition -----
const MENU_GROUPS = [
  {
    key: 'overview',
    label: 'TỔNG QUAN',
    roles: ALL_ROLES,
    items: [
      { key: '/dashboard', icon: <DashboardOutlined />, label: 'Dashboard' },
      { key: '/analytics', icon: <LineChartOutlined />,  label: 'Analytics', roles: ['ADMIN', 'MANAGER'] },
    ],
  },
  {
    key: 'sales',
    label: 'BÁN HÀNG',
    roles: ALL_ROLES,
    items: [
      { key: '/pos',    icon: <ShoppingCartOutlined />, label: 'POS' },
      { key: '/orders', icon: <FileTextOutlined />,     label: 'Đơn hàng' },
      { key: '/returns', icon: <UndoOutlined />, label: 'Trả hàng', roles: ['ADMIN', 'MANAGER'] },
    ],
  },
  {
    key: 'inventory',
    label: 'KHO & SẢN PHẨM',
    roles: ALL_ROLES,
    items: [
      { key: '/products',  icon: <ShoppingOutlined />, label: 'Sản phẩm' },
      { key: '/inventory', icon: <DatabaseOutlined />, label: 'Kho hàng', roles: ['ADMIN', 'MANAGER'] },
      { key: '/cycle-count', icon: <ReconciliationOutlined />, label: 'Kiểm kê', roles: ['ADMIN', 'MANAGER', 'WAREHOUSE'] },
    ],
  },
  {
    key: 'crm',
    label: 'QUAN HỆ',
    roles: ALL_ROLES,
    items: [
      { key: '/customers', icon: <TeamOutlined />, label: 'Khách hàng' },
      { key: '/crm/tasks', icon: <CheckSquareOutlined />, label: 'Nhiệm vụ CSKH' },
      { key: '/crm/segments', icon: <ClusterOutlined />, label: 'Phân khúc KH', roles: ['ADMIN', 'MANAGER'] },
      { key: '/crm/campaigns', icon: <NotificationOutlined />, label: 'Chiến dịch', roles: ['ADMIN', 'MANAGER'] },
    ],
  },
  {
    key: 'hr',
    label: 'NHÂN SỰ',
    roles: ['ADMIN', 'MANAGER'],
    items: [
      { key: '/hr', icon: <SolutionOutlined />, label: 'HR & Lương' },
    ],
  },
  {
    key: 'projects',
    label: 'DỰ ÁN',
    roles: ['ADMIN', 'MANAGER'],
    items: [
      { key: '/projects', icon: <ProjectOutlined />, label: 'Dự án' },
    ],
  },
  {
    key: 'accounting',
    label: 'KẾ TOÁN & TÀI CHÍNH',
    roles: ['ADMIN', 'MANAGER'],
    items: [
      { key: '/finance', icon: <FundOutlined />, label: 'Sức khỏe TC' },
      { key: '/debts', icon: <SwapOutlined />, label: 'Công nợ', roles: ['ADMIN', 'MANAGER', 'CASHIER'] },
      { key: '/expenses', icon: <WalletOutlined />, label: 'Chi phí' },
      { key: '/vendors', icon: <BankOutlined />, label: 'Nhà cung cấp' },
      { key: '/purchase-orders', icon: <ContainerOutlined />, label: 'Mua hàng' },
      { key: '/financial-reports', icon: <PieChartOutlined />, label: 'BC tài chính' },
      { key: '/journal', icon: <AccountBookOutlined />, label: 'Sổ kế toán', roles: ['ADMIN'] },
    ],
  },
  {
    key: 'system',
    label: 'HỆ THỐNG',
    roles: ['ADMIN', 'MANAGER'],
    items: [
      { key: '/users',   icon: <UserOutlined />,      label: 'Tài khoản',  roles: ['ADMIN'] },
      { key: '/reports', icon: <FileExcelOutlined />, label: 'Báo cáo',    roles: ['ADMIN'] },
      { key: '/audit',   icon: <AuditOutlined />,     label: 'Audit Log',  roles: ['ADMIN'] },
      { key: '/import',  icon: <UploadOutlined />,    label: 'Import dữ liệu', roles: ['ADMIN', 'MANAGER'] },
    ],
  },
];

function buildMenuItems(userRole) {
  const items = [];
  for (const group of MENU_GROUPS) {
    // Lọc group theo role
    if (group.roles && !group.roles.includes(userRole)) continue;

    // Lọc items trong group theo role
    const visibleItems = group.items.filter(
      (it) => !it.roles || it.roles.includes(userRole)
    );
    if (visibleItems.length === 0) continue;

    items.push({
      type: 'group',
      key: group.key,
      label: group.label,
      children: visibleItems.map(({ key, icon, label }) => ({ key, icon, label })),
    });
  }
  return items;
}

export default function Sidebar({ collapsed, onToggleCollapse, mobileOpen, onMobileClose }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();

  const userRole = user?.role || 'CASHIER';
  const menuItems = useMemo(() => buildMenuItems(userRole), [userRole]);

  // Xác định key active dựa trên pathname
  const selectedKey = useMemo(() => {
    // Match path bắt đầu bằng key (vd: /products/create → /products)
    const allKeys = MENU_GROUPS.flatMap((g) => g.items.map((i) => i.key));
    const matched = allKeys.find(
      (k) => location.pathname === k || location.pathname.startsWith(k + '/')
    );
    return matched || location.pathname;
  }, [location.pathname]);

  const userInitials = (user?.fullName || user?.username || 'U')
    .split(' ')
    .slice(-2)
    .map((s) => s[0]?.toUpperCase())
    .join('');

  return (
    <>
      {mobileOpen && (
        <div
          className="sidebar-backdrop"
          onClick={onMobileClose}
          aria-hidden="true"
        />
      )}
      <aside className={`sidebar ${collapsed ? 'sidebar--collapsed' : ''} ${mobileOpen ? 'sidebar--mobile-open' : ''}`}>
      {/* Toggle button */}
      <button
        type="button"
        className="sidebar__collapse-btn"
        onClick={onToggleCollapse}
        aria-label={collapsed ? 'Mở rộng sidebar' : 'Thu gọn sidebar'}
      >
        {collapsed ? <RightOutlined style={{ fontSize: 10 }} /> : <LeftOutlined style={{ fontSize: 10 }} />}
      </button>

      {/* Logo */}
      <div className="sidebar__logo">
        <div className="sidebar__logo-mark">E</div>
        <div className="sidebar__logo-text">ERP System</div>
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
          style={{ background: 'transparent', borderRight: 0 }}
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
          onKeyDown={(e) => e.key === 'Enter' && logout()}
        >
          <div className="sidebar__user-avatar">{userInitials}</div>
          <div className="sidebar__user-info">
            <div className="sidebar__user-name">{user?.fullName || user?.username}</div>
            <div className="sidebar__user-role">{user?.role}</div>
          </div>
          {!collapsed && (
            <LogoutOutlined style={{ color: 'var(--text-inverse-muted)', fontSize: 14 }} />
          )}
        </div>
      </div>
      </aside>
    </>
  );
}
