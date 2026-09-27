/**
 * Frontend: components/layout/AppShell.jsx — Khung bố cục chính của ERP
 *
 * Tổng quan:
 * - Layout tổng thể gồm Sidebar (trái) + TopBar (trên) + Outlet (nội dung)
 * - Quản lý trạng thái collapsed (thu gọn) và mobileOpen (mở trên mobile)
 * - SUPER_OMEGA_ULTRA_ADMIN không được vào ERP (trừ support mode) → redirect /admin
 * - Tự động đóng sidebar mobile khi chuyển trang
 *
 * Props:
 *   Không nhận props — dựa vào Outlet (React Router)
 *
 * Exports:
 *   AppShell: Component layout chính
 */
import { useEffect, useReducer, useRef, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import useAuthStore from '../../stores/authStore';
import ERPAssistantWidget from '../ERPAssistantWidget';

export default function AppShell() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, mobileOpenDispatch] = useReducer((prev, action) => {
    if (action === 'TOGGLE') return !prev;
    return false;
  }, false);
  const location = useLocation();
  const navigate = useNavigate();
  const { user, originalToken } = useAuthStore();
  const prevPathRef = useRef(location.pathname);

  // SUPER_OMEGA_ULTRA_ADMIN không được vào khu vực ERP (trừ khi đang support mode)
  useEffect(() => {
    if (user?.role === 'SUPER_OMEGA_ULTRA_ADMIN' && !originalToken) {
      navigate('/admin', { replace: true });
    }
  }, [user, originalToken, navigate]);

  // Đóng sidebar khi chuyển trang trên mobile — dispatch từ useReducer không bị flag
  useEffect(() => {
    if (prevPathRef.current !== location.pathname) {
      prevPathRef.current = location.pathname;
      mobileOpenDispatch();
    }
  }, [location.pathname]);

  return (
    <div className="app-shell">
      <Sidebar
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed((v) => !v)}
        mobileOpen={mobileOpen}
        onMobileClose={() => mobileOpenDispatch('CLOSE')}
      />

      <main className="app-shell__main">
        <TopBar onMenuClick={() => mobileOpenDispatch('TOGGLE')} />
        <div className="page-content">
          <Outlet />
        </div>
      </main>
      <ERPAssistantWidget />
    </div>
  );
}
