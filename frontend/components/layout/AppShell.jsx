import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import TopBar from './TopBar';

/**
 * AppShell — Layout chính của app
 * Thay thế MainLayout.jsx cũ.
 *
 * Cấu trúc:
 *   ┌─────────┬─────────────────────────────┐
 *   │         │  TopBar                     │
 *   │ Sidebar ├─────────────────────────────┤
 *   │         │  <Outlet />                 │
 *   └─────────┴─────────────────────────────┘
 */
export default function AppShell() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="app-shell">
      <Sidebar
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed((v) => !v)}
      />

      <main className="app-shell__main">
        <TopBar />
        <div className="page-content">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
