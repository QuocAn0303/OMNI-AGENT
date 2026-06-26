/**
 * Frontend: src/layouts/SuperAdminLayout.jsx — SuperAdminLayout
 * 
 * Tổng quan:
 * - Layout tổng thể cho trang quản trị hệ thống (Super Admin).
 * - Kết hợp SuperAdminSidebar (trái) + SuperAdminTopbar (trên) + Outlet (nội dung).
 * - Quản lý state collapsed (sidebar) và search (từ khoá tìm tenant).
 * 
 * Props:
 * - Không nhận props — dùng Outlet context để truyền search xuống trang con
 * 
 * Hàm/Exports:
 * - SuperAdminLayout: Layout dành cho Super Admin
 */
import { useState } from "react";
import { Outlet } from "react-router-dom";
import SuperAdminSidebar from "./SuperAdminSidebar";
import SuperAdminTopbar from "./SuperAdminTopbar";

export default function SuperAdminLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const [search, setSearch] = useState("");

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "#f1f5f9" }}>
      <SuperAdminSidebar
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed((v) => !v)}
      />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <SuperAdminTopbar onSearch={setSearch} />
        <div style={{ flex: 1, overflow: "auto", padding: 24 }}>
          <Outlet context={{ search }} />
        </div>
      </div>
    </div>
  );
}