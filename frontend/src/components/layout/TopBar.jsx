import { useEffect, useMemo, useState, useCallback } from 'react';
import { Dropdown, Avatar, Badge } from 'antd';
import { BellOutlined, SettingOutlined, LogoutOutlined, UserOutlined, SearchOutlined } from '@ant-design/icons';
import { useLocation, useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import useAuthStore from '../../stores/authStore';
import { getUnreadCount } from '../../api/notifications';

const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';
const socketOrigin = apiBase.replace(/\/api\/?$/, '');

// Map pathname → breadcrumb text
const ROUTE_LABELS = {
  '/dashboard': 'Dashboard',
  '/analytics': 'Analytics',
  '/pos': 'POS — Bán hàng',
  '/orders': 'Đơn hàng',
  '/products': 'Sản phẩm',
  '/products/create': 'Sản phẩm / Thêm mới',
  '/inventory': 'Kho hàng',
  '/customers': 'Khách hàng',
  '/hr': 'Nhân sự & Lương',
  '/users': 'Quản lý tài khoản',
  '/reports': 'Báo cáo',
  '/audit': 'Audit Log',
  '/purchase-orders': 'Mua hàng',
  '/debts': 'Công nợ',
};

export default function TopBar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout, token } = useAuthStore();
  const [unread, setUnread] = useState(0);

  const refreshUnread = useCallback(() => {
    getUnreadCount()
      .then((r) => setUnread(Number(r?.count ?? 0)))
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshUnread();
    const interval = setInterval(refreshUnread, 30000);
    return () => clearInterval(interval);
  }, [refreshUnread]);

  useEffect(() => {
    if (!token) return undefined;
    const socket = io(socketOrigin, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 2000,
    });
    socket.on('notification', refreshUnread);
    return () => {
      socket.off('notification', refreshUnread);
      socket.disconnect();
    };
  }, [token, refreshUnread]);

  const currentLabel = useMemo(() => {
    if (ROUTE_LABELS[location.pathname]) return ROUTE_LABELS[location.pathname];
    const match = Object.keys(ROUTE_LABELS)
      .filter((k) => location.pathname.startsWith(k))
      .sort((a, b) => b.length - a.length)[0];
    return match ? ROUTE_LABELS[match] : 'Trang';
  }, [location.pathname]);

  const userMenu = {
    items: [
      {
        key: 'profile',
        icon: <UserOutlined />,
        label: 'Hồ sơ',
        onClick: () => navigate('/profile'),
      },
      {
        key: 'settings',
        icon: <SettingOutlined />,
        label: 'Cài đặt',
        onClick: () => navigate('/settings'),
      },
      { type: 'divider' },
      {
        key: 'logout',
        icon: <LogoutOutlined />,
        label: 'Đăng xuất',
        danger: true,
        onClick: logout,
      },
    ],
  };

  return (
    <header className="topbar">
      <div className="topbar__left">
        <div className="topbar__breadcrumb">
          <span className="topbar__breadcrumb-current">{currentLabel}</span>
        </div>
      </div>

      <div className="topbar__right">
        <button
          type="button"
          className="topbar__icon-btn"
          aria-label="Tìm kiếm"
          title="Tìm kiếm (Ctrl + K)"
        >
          <SearchOutlined style={{ fontSize: 16 }} />
        </button>

        <button
          type="button"
          className="topbar__icon-btn"
          aria-label="Thông báo"
          title="Thông báo"
          onClick={() => navigate('/notifications')}
        >
          <Badge count={unread} size="small" offset={[-2, 2]}>
            <BellOutlined style={{ fontSize: 16 }} />
          </Badge>
        </button>

        <Dropdown menu={userMenu} placement="bottomRight" trigger={['click']}>
          <button
            type="button"
            className="topbar__icon-btn"
            style={{ width: 'auto', padding: '0 8px', gap: 8, display: 'flex', alignItems: 'center' }}
            aria-label="Tài khoản"
          >
            <Avatar
              size={28}
              style={{
                background: 'var(--primary)',
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              {(user?.fullName || user?.username || 'U')[0].toUpperCase()}
            </Avatar>
          </button>
        </Dropdown>
      </div>
    </header>
  );
}
