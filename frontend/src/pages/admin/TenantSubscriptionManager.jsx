/**
 * Frontend: pages/admin/TenantSubscriptionManager.jsx — Quản lý thuê bao tenant
 *
 * Tổng quan:
 * - Danh sách subscription của tất cả tenant
 * - Đổi gói cho tenant qua modal chọn plan
 * - API: GET /subscriptions/tenant, GET /subscriptions/plans, POST /subscriptions/tenant/:id
 * - State: subs, plans, loading, modalOpen
 *
 * Components/Hooks/Exports:
 * - TenantSubscriptionManager: Component chính (xuất mặc định)
 */
import { useState, useEffect } from "react";
import { Table, Card, Button, Select, message, Typography, Tag, Space, Modal, DatePicker } from "antd";
import { TeamOutlined, SwapOutlined } from "@ant-design/icons";
import api from "../../api/axios";

const { Title } = Typography;
const { RangePicker } = DatePicker;

const statusColors = { ACTIVE: "green", EXPIRED: "red", CANCELLED: "orange", TRIAL: "blue" };

export default function TenantSubscriptionManager() {
  const [subs, setSubs] = useState([]);
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedTenant, setSelectedTenant] = useState(null);
  const [selectedPlan, setSelectedPlan] = useState(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [subsRes, plansRes] = await Promise.all([
        api.get("/subscriptions/tenant"),
        api.get("/subscriptions/plans"),
      ]);
      setSubs(subsRes.data.data);
      setPlans(plansRes.data.data);
    } catch { message.error("Failed to load"); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, []);

  const openAssign = (tenantId) => {
    setSelectedTenant(tenantId);
    setSelectedPlan(null);
    setModalOpen(true);
  };

  const handleAssign = async () => {
    if (!selectedPlan) { message.warning("Chọn gói"); return; }
    try {
      await api.post(`/subscriptions/tenant/${selectedTenant}`, { planId: selectedPlan });
      message.success("Gán gói thành công");
      setModalOpen(false);
      fetchData();
    } catch { message.error("Gán gói thất bại"); }
  };

  const columns = [
    { title: "Tenant", dataIndex: ["tenant", "name"], key: "name" },
    { title: "Slug", dataIndex: ["tenant", "slug"], key: "slug", responsive: ["md"] },
    { title: "Gói", dataIndex: ["plan", "name"], key: "plan", render: (v, r) => <Tag>{v || r.plan?.key}</Tag> },
    {
      title: "Trạng thái", dataIndex: "status", key: "status",
      render: (v) => <Tag color={statusColors[v]}>{v}</Tag>,
    },
    {
      title: "Ngày hết hạn", dataIndex: "endDate", key: "endDate",
      render: (d) => d ? new Date(d).toLocaleDateString("vi-VN") : "-",
    },
    {
      title: "HĐ", key: "invoices",
      render: (_, r) => r._count?.invoices || 0,
    },
    {
      title: "", key: "actions",
      render: (_, r) => (
        <Button icon={<SwapOutlined />} size="small" onClick={() => openAssign(r.tenantId)}>
          Đổi gói
        </Button>
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <Title level={3}><TeamOutlined /> Quản lý thuê bao</Title>
      <Card>
        <Table dataSource={subs} columns={columns} rowKey="id" loading={loading} scroll={{ x: 700 }} pagination={{ pageSize: 20 }} />
      </Card>

      <Modal title="Đổi gói cho tenant" open={modalOpen} onOk={handleAssign} onCancel={() => setModalOpen(false)} okText="Xác nhận">
        <p>Chọn gói mới:</p>
        <Select value={selectedPlan} onChange={setSelectedPlan} style={{ width: "100%" }} placeholder="Chọn gói...">
          {plans.map((p) => (
            <Select.Option key={p.id} value={p.id}>{p.name} - {p.price?.toLocaleString()} {p.currency}</Select.Option>
          ))}
        </Select>
      </Modal>
    </div>
  );
}
