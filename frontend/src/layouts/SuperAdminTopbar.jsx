/**
 * Frontend: src/layouts/SuperAdminTopbar.jsx — SuperAdminTopbar
 * 
 * Tổng quan:
 * - Topbar cho khu vực Super Admin với thanh tìm kiếm tenant và biểu tượng thông báo.
 * - Gọi onSearch callback khi người dùng nhập từ khoá.
 * 
 * Props:
 * - onSearch: function(value) — callback khi tìm kiếm tenant
 * 
 * Hàm/Exports:
 * - SuperAdminTopbar: Thanh công cụ trên cùng cho Super Admin
 */
import { Input, Tag } from "antd";
import { SearchOutlined, BellOutlined } from "@ant-design/icons";

export default function SuperAdminTopbar({ onSearch }) {
  return (
    <header style={{
      height: 56,
      background: "#fff",
      borderBottom: "1px solid #e2e8f0",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "0 24px",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <Tag color="red" style={{ margin: 0, fontWeight: 600, fontSize: 11, lineHeight: "20px" }}>
          Khu vực quản trị hệ thống
        </Tag>
        <Input
          prefix={<SearchOutlined style={{ color: "#94a3b8" }} />}
          placeholder="Tìm kiếm tenant..."
          onChange={(e) => onSearch?.(e.target.value)}
          style={{ width: 320, borderRadius: 8, borderColor: "#e2e8f0" }}
          size="middle"
        />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <BellOutlined style={{ fontSize: 18, color: "#64748b", cursor: "pointer" }} />
      </div>
    </header>
  );
}