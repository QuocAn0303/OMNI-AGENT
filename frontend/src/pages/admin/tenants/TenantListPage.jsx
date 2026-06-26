/**
 * Frontend: pages/admin/tenants/TenantListPage.jsx — Danh sách Tenant
 *
 * Tổng quan:
 * - Bảng quản lý tenant: đổi gói, bật/tắt active, support session
 * - Hỗ trợ: loginAsTenant với support token
 * - API: GET /admin/tenants, GET /subscriptions/plans, PUT /admin/tenants/:id, POST /subscriptions/tenant/:id
 * - State: tenants, plans, loading, supportTenantId, supportReason
 *
 * Components/Hooks/Exports:
 * - TenantListPage: Component chính (xuất mặc định)
 */
import { useState, useEffect } from "react";
import { Table, Card, Tag, Button, Switch, Select, Typography, message, Modal, Input } from "antd";
import { ShopOutlined, KeyOutlined, EyeOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import api from "../../../api/axios";
import { useAuthStore } from "../../../stores/authStore";

const { Title } = Typography;

export default function TenantListPage() {
  const navigate = useNavigate();
  const { loginAsTenant, token } = useAuthStore();
  const [tenants, setTenants] = useState([]);
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(false);
  const [supportTenantId, setSupportTenantId] = useState(null);
  const [supportReason, setSupportReason] = useState("");

  const fetch = async () => {
    setLoading(true);
    try {
      const [tenantsRes, plansRes] = await Promise.all([
        api.get("/admin/tenants"),
        api.get("/subscriptions/plans").catch(() => ({ data: { data: [] } })),
      ]);
      setTenants(tenantsRes.data.data);
      setPlans(plansRes.data.data || []);
    } catch { message.error("Không thể tải danh sách"); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetch(); }, []);

  const handleChangePlan = async (tenantId, planId) => {
    try {
      await api.post(`/subscriptions/tenant/${tenantId}`, { planId });
      message.success("Đã đổi gói");
      fetch();
    } catch { message.error("Đổi gói thất bại"); }
  };

  const handleToggleActive = async (id, isActive) => {
    try {
      await api.put(`/admin/tenants/${id}`, { isActive: !isActive });
      message.success(isActive ? "Đã vô hiệu hóa" : "Đã kích hoạt");
      fetch();
    } catch { message.error("Thất bại"); }
  };

  const handleSupportAccess = async () => {
    if (!supportTenantId || !supportReason) { message.warning("Nhập lý do"); return; }
    try {
      const res = await api.post("/admin/support-session", { tenantId: supportTenantId, reason: supportReason });
      loginAsTenant({ role: "ADMIN", tenantId: supportTenantId }, res.data.data.supportToken, token);
      message.success("Đã kích hoạt chế độ hỗ trợ!");
      setSupportTenantId(null);
      window.location.href = "/dashboard";
    } catch { message.error("Không thể khởi tạo phiên hỗ trợ"); }
  };

  const columns = [
    { title: "Tên", dataIndex: "name", key: "name" },
    { title: "Slug", dataIndex: "slug", key: "slug", responsive: ["md"] },
    {
      title: "Gói", key: "plan",
      render: (_, r) => (
        <Select value={r.subscription?.planId} size="small" style={{ width: 140 }} onChange={(v) => handleChangePlan(r.id, v)}>
          {plans.map((p) => <Select.Option key={p.id} value={p.id}>{p.name}</Select.Option>)}
        </Select>
      ),
    },
    {
      title: "Users", dataIndex: ["_count", "users"], key: "users",
    },
    {
      title: "Trạng thái", key: "subStatus",
      render: (_, r) => {
        const s = r.subscription?.status;
        const colors = { ACTIVE: "green", TRIAL: "blue", EXPIRED: "red", CANCELLED: "orange" };
        return s ? <Tag color={colors[s]}>{s}</Tag> : <Tag>No sub</Tag>;
      },
    },
    {
      title: "Active", dataIndex: "isActive", key: "isActive",
      render: (active, r) => <Switch checked={active} onChange={() => handleToggleActive(r.id, active)} size="small" />,
    },
    {
      title: "Ngày tạo", dataIndex: "createdAt", key: "createdAt", responsive: ["lg"],
      render: (d) => new Date(d).toLocaleDateString("vi-VN"),
    },
    {
      title: "", key: "actions",
      render: (_, r) => (
        <span>
          <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => navigate(`/admin/tenants/${r.id}`)} />
          <Button type="link" size="small" icon={<KeyOutlined />} onClick={() => { setSupportTenantId(r.id); setSupportReason(""); }} />
        </span>
      ),
    },
  ];

  return (
    <div>
      <Title level={3}><ShopOutlined /> Tenants</Title>
      <Card>
        <Table dataSource={tenants} columns={columns} rowKey="id" loading={loading} pagination={{ pageSize: 20 }} scroll={{ x: 900 }} />
      </Card>

      <Modal title="Hỗ trợ tenant" open={!!supportTenantId} onOk={handleSupportAccess} onCancel={() => setSupportTenantId(null)} okText="Kích hoạt">
        <p>Lý do hỗ trợ:</p>
        <Input value={supportReason} onChange={(e) => setSupportReason(e.target.value)} placeholder="VD: Kiểm tra lỗi..." />
      </Modal>
    </div>
  );
}