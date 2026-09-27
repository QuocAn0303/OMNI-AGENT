/**
 * Frontend: src/layouts/SuperAdminSidebar.jsx — SuperAdminSidebar
 * 
 * Tổng quan:
 * - Sidebar dành cho Super Admin (quản trị hệ thống).
 * - Menu chia theo nhóm: Platform, Billing, CRM, System.
 * - Hỗ trợ thu gọn (collapsed), hiển thị avatar user và nút logout.
 * 
 * Props:
 * - collapsed: boolean — trạng thái thu gọn
 * - onToggleCollapse: function — callback bật/tắt thu gọn
 * 
 * Hàm/Exports:
 * - SuperAdminSidebar: Sidebar quản trị hệ thống
 */
import { useMemo } from "react";
import { Menu } from "antd";
import { useLocation, useNavigate } from "react-router-dom";
import {
  DashboardOutlined, ShopOutlined, CrownOutlined, TeamOutlined,
  FileTextOutlined, FundOutlined,
  ArrowUpOutlined, LeftOutlined, RightOutlined, LogoutOutlined,
  AuditOutlined, CloudUploadOutlined,
} from "@ant-design/icons";
import useAuthStore from "../stores/authStore";

const NAV_GROUPS = [
  {
    key: "platform", label: "PLATFORM",
    items: [
      { key: "/admin", icon: <DashboardOutlined />, label: "Dashboard tổng quan" },
      { key: "/admin/tenants", icon: <ShopOutlined />, label: "Tenants" },
    ],
  },
  {
    key: "billing", label: "BILLING",
    items: [
      { key: "/admin/plans", icon: <CrownOutlined />, label: "Gói dịch vụ" },
      { key: "/admin/subscriptions", icon: <TeamOutlined />, label: "Subscriptions" },
      { key: "/admin/invoices", icon: <FileTextOutlined />, label: "Hóa đơn" },
    ],
  },
  {
    key: "crm", label: "CRM",
    items: [
      { key: "/admin/campaigns", icon: <FundOutlined />, label: "Chiến dịch" },
    ],
  },
  {
    key: "system", label: "SYSTEM",
    items: [
      { key: "/admin/upgrade-requests", icon: <ArrowUpOutlined />, label: "Yêu cầu nâng gói" },
      { key: "/admin/backups", icon: <CloudUploadOutlined />, label: "Backup & Restore" },
      { key: "/admin/audit", icon: <AuditOutlined />, label: "Audit Log (toàn bộ hệ thống)" },
    ],
  },
];

export default function SuperAdminSidebar({ collapsed, onToggleCollapse }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();

  const selectedKey = location.pathname;

  const menuItems = useMemo(() =>
    NAV_GROUPS.map((g) => ({
      type: "group",
      key: g.key,
      label: g.label,
      children: g.items.map(({ key, icon, label }) => ({ key, icon, label })),
    })),
  []);

  return (
    <aside className="super-sidebar" style={{
      width: collapsed ? 80 : 260,
      background: "#0F172A",
      color: "#fff",
      display: "flex",
      flexDirection: "column",
      height: "100vh",
      position: "sticky",
      top: 0,
      transition: "width 0.2s",
      overflow: "hidden",
    }}>
      <div style={{ padding: "20px 16px", display: "flex", alignItems: "center", gap: 10, borderBottom: "1px solid #1e293b" }}>
        <div style={{ width: 32, height: 32, background: "#0d9488", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 16, color: "#fff" }}>A</div>
        {!collapsed && (
          <div style={{ fontWeight: 600, fontSize: 16, display: "flex", alignItems: "center", gap: 6 }}>
            Aduu ERP
            <span style={{ fontSize: 10, background: "#dc2626", color: "#fff", borderRadius: 4, padding: "1px 6px", fontWeight: 600, lineHeight: "18px" }}>SA</span>
          </div>
        )}
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: "8px 0" }}>
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

      <div style={{ borderTop: "1px solid #1e293b", padding: 12 }}>
        <button
          type="button"
          onClick={onToggleCollapse}
          style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer", width: "100%", padding: "8px 0", display: "flex", justifyContent: "center" }}
        >
          {collapsed ? <RightOutlined /> : <LeftOutlined />}
        </button>
        <div
          onClick={logout}
          style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", cursor: "pointer", color: "#94a3b8", fontSize: 13 }}
        >
          <div style={{ width: 28, height: 28, borderRadius: "50%", background: "#334155", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: "#fff" }}>
            {(user?.fullName || "A")[0]}
          </div>
          {!collapsed && <span style={{ flex: 1 }}>{user?.fullName || "Admin"}</span>}
          {!collapsed && <LogoutOutlined style={{ fontSize: 12 }} />}
        </div>
      </div>
    </aside>
  );
}