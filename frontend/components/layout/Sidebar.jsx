import { useMemo } from 'react';
import { Menu } from 'antd';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  DashboardOutlined,
  LineChartOutlined,
  ShoppingCartOutlined,
  FileTextOutlined,
  ShoppingOutlined,
  DatabaseOutlined,
  TeamOutlined,
  UserOutlined,
  SolutionOutlined,
  FileExcelOutlined,
  AuditOutlined,
  LeftOutlined,
  RightOutlined,
  LogoutOutlined,
} from '@ant-design/icons';
import { useAuthStore } from '../../stores/authStore';

/**
 * Sidebar — Menu điều hướng trái, phân nhóm theo chức năng
 *
 * Phân quyền: lọc menu theo role từ authStore
 *   - ADMIN: xem tất cả
 *   - MANAGER: không thấy Users, Audit
 *   - STAFF: chỉ thấy POS, Orders, Products, Customers
 */

// ----- Menu definition -----
const MENU_GROUPS = [
  {
    key: 'overview',
    label: 'TỔNG QUAN',
    roles: ['ADMIN', 'MANAGER', 'STAFF'],
    items: [
      { key: '/dashboard', icon: <DashboardOutlined />, label: 'Dashboard' },
      { key: '/analytics', icon: <LineChartOutlined />, label: 'Analytics', roles: ['ADMIN', 'MANAGER'] },
    ],
  },
  {
    key: 'sales',
    label: 'BÁN HÀNG',
    roles: ['ADMIN', 'MANAGER', 'STAFF'],
    items: [
      { key: '/pos',    icon: <ShoppingCartOutlined />, label: 'POS' },
      { key: '/orders', icon: <FileTextOutlined />,    label: 'Đơn hàng' },
    ],
  },
  {
    key: 'inventory',
    label: 'KHO & SẢN PHẨM',
    roles: ['ADMIN', 'MANAGER', 'STAFF'],
    items: [
      { key: '/products',  icon: <ShoppingOutlined />, label: 'Sản phẩm' },
      { key: '/inventory', icon: <DatabaseOutlined />, label: 'Kho hàng', roles: ['ADMIN', 'MANAGER'] },
    ],
  },
  {
    key: 'crm',
    label: 'QUAN HỆ',
    roles: ['ADMIN', 'MANAGER', 'STAFF'],
    items: [
      { key: '/customers', icon: <TeamOutlined />, label: 'Khách hàng' },
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
    key: 'system',
    label: 'HỆ THỐNG',
    roles: ['ADMIN'],
    items: [
      { key: '/users',   icon: <UserOutlined />,       label: 'Tài khoản' },
      { key: '/reports', icon: <FileExcelOutlined />,  label: 'Báo cáo' },
      { key: '/audit',   icon: <AuditOutlined />,      label: 'Audit Log' },
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

export default function Sidebar({ collapsed, onToggleCollapse }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();

  const userRole = user?.role || 'STAFF';
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
    <aside className={`sidebar ${collapsed ? 'sidebar--collapsed' : ''}`}>
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
  );
}
