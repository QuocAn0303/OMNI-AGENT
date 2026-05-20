import { useEffect, useMemo, useState, useCallback } from 'react';
import { Dropdown, Avatar, Badge, message } from 'antd';
import { BellOutlined, SettingOutlined, LogoutOutlined, UserOutlined, SearchOutlined, MenuOutlined, SunOutlined, MoonOutlined, GlobalOutlined, QuestionCircleOutlined } from '@ant-design/icons';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { io } from 'socket.io-client';
import useAuthStore from '../../stores/authStore';
import { getUnreadCount } from '../../api/notifications';

function getSocketOrigin() {
  // Dev: cùng origin với Vite; proxy websocket → backend (vite.config.js)
  if (import.meta.env.DEV) return window.location.origin;
  const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';
  return apiBase.replace(/\/api\/?$/, '');
}

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

export default function TopBar({ onMenuClick }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout, token, theme, setTheme } = useAuthStore();
  const { t, i18n } = useTranslation();
  const [unread, setUnread] = useState(0);

  const langMenu = {
    items: [
      { key: 'vi', label: 'Tiếng Việt' },
      { key: 'en', label: 'English' },
    ],
    onClick: ({ key }) => {
      i18n.changeLanguage(key);
      localStorage.setItem('i18n_lang', key);
    },
  };

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
    const socket = io(getSocketOrigin(), {
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

  const restartTours = () => {
    ['dashboard', 'pos', 'products', 'orders', 'inventory'].forEach((key) => {
      localStorage.removeItem(`tour_${key}_done`);
    });
    message.success(t('topbar.tourRestarted'));
  };

  const userMenu = {
    items: [
      {
        key: 'profile',
        icon: <UserOutlined />,
        label: t('topbar.profile'),
        onClick: () => navigate('/profile'),
      },
      {
        key: 'settings',
        icon: <SettingOutlined />,
        label: t('topbar.settings'),
        onClick: () => navigate('/settings'),
      },
      {
        key: 'tour',
        icon: <QuestionCircleOutlined />,
        label: t('topbar.restartTour'),
        onClick: restartTours,
      },
      { type: 'divider' },
      {
        key: 'logout',
        icon: <LogoutOutlined />,
        label: t('topbar.logout'),
        danger: true,
        onClick: logout,
      },
    ],
  };

  return (
    <header className="topbar">
      <div className="topbar__left">
        <button
          type="button"
          className="topbar__icon-btn topbar__hamburger"
          aria-label="Mở menu"
          onClick={onMenuClick}
        >
          <MenuOutlined style={{ fontSize: 16 }} />
        </button>
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
          aria-label="Chuyển giao diện"
          title={theme === 'dark' ? 'Chuyển sang sáng' : 'Chuyển sang tối'}
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        >
          {theme === 'dark'
            ? <SunOutlined style={{ fontSize: 16 }} />
            : <MoonOutlined style={{ fontSize: 16 }} />}
        </button>

        <Dropdown menu={langMenu} placement="bottomRight" trigger={['click']}>
          <button type="button" className="topbar__icon-btn" aria-label="Ngôn ngữ" title="Ngôn ngữ">
            <GlobalOutlined style={{ fontSize: 16 }} />
          </button>
        </Dropdown>

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
