/**
 * Frontend: pages/admin/SuperAdminDashboard.jsx — Dashboard Super Admin
 *
 * Tổng quan:
 * - Tổng quan hệ thống: thống kê tenant (total, active, free, pro, enterprise)
 * - Ba tab: Tổng quan (danh sách tenant + đổi gói + switch active), Yêu cầu nâng gói (duyệt/từ chối), Hỗ trợ
 * - Chức năng Support Session: login với tư cách admin của tenant
 * - API: GET /admin/tenants, /admin/stats, /admin/upgrade-requests; POST .../support-session
 * - State phức tạp: tenants, upgradeRequests, plans, stats, supportReason, supportTenantId
 *
 * Components/Hooks/Exports:
 * - SuperAdminDashboard: Component chính (xuất mặc định)
 */
import { useState, useEffect } from "react";
import {
  Table, Card, Row, Col, Tag, Button, Switch,
  Select, message, Statistic, Typography, Modal, Space,
  Tabs, Popconfirm, Alert
} from "antd";
import {
  ShopOutlined, UserOutlined, TeamOutlined, CrownOutlined,
  KeyOutlined, AppstoreOutlined, CheckOutlined, CloseOutlined,
  ArrowUpOutlined, FileTextOutlined, UsergroupAddOutlined,
  ScheduleOutlined, SafetyOutlined, AlertOutlined
} from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import api from "../../api/axios";
import { useAuthStore } from "../../stores/authStore";

const { Title } = Typography;

export default function SuperAdminDashboard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { loginAsTenant, token } = useAuthStore();
  const [activeKey, setActiveKey] = useState("overview"); // Default tab
  
  // State for different sections
  const [tenants, setTenants] = useState([]);
  const [upgradeRequests, setUpgradeRequests] = useState([]);
  const [plans, setPlans] = useState([]);
  const [stats, setStats] = useState({
    total: 0, active: 0, free: 0, pro: 0, enterprise: 0,
  });
  const [loading, setLoading] = useState(false);
  const [supportReason, setSupportReason] = useState("");
  const [supportTenantId, setSupportTenantId] = useState(null);

  const fetchOverviewData = async () => {
    setLoading(true);
    try {
      const [tenantsRes, statsRes, plansRes] = await Promise.all([
        api.get("/admin/tenants"),
        api.get("/admin/stats"),
        api.get("/subscriptions/plans").catch(() => ({ data: { data: [] } })),
      ]);
      setTenants(tenantsRes.data.data);
      setStats(statsRes.data.data);
      setPlans(plansRes.data.data || []);
    } catch {
      message.error("Failed to load overview data");
    } finally {
      setLoading(false);
    }
  };

  const fetchUpgradeRequests = async () => {
    setLoading(true);
    try {
      const res = await api.get("/admin/upgrade-requests");
      setUpgradeRequests(res.data.data);
    } catch {
      message.error("Failed to load upgrade requests");
    } finally {
      setLoading(false);
    }
  };

  const fetchAllData = async () => {
    await Promise.all([
      fetchOverviewData(),
      fetchUpgradeRequests()
    ]);
  };

  useEffect(() => {
    fetchAllData();
  }, []);

  const handleToggleActive = async (id, isActive) => {
    try {
      await api.put(`/admin/tenants/${id}`, { isActive: !isActive });
      message.success(isActive ? "Tenant deactivated" : "Tenant activated");
      fetchOverviewData();
    } catch {
      message.error("Update failed");
    }
  };

  const handleChangePlan = async (tenantId, planId) => {
    try {
      await api.post(`/subscriptions/tenant/${tenantId}`, { planId });
      message.success("Plan updated");
      fetchOverviewData();
    } catch {
      message.error("Update failed");
    }
  };

  const openSupportModal = (tenantId) => {
    setSupportTenantId(tenantId);
    setSupportReason("");
  };

  const handleSupportAccess = async () => {
    if (!supportTenantId || !supportReason) {
      message.warning("Vui lòng nhập lý do hỗ trợ");
      return;
    }
    try {
      const res = await api.post("/admin/support-session", {
        tenantId: supportTenantId,
        reason: supportReason,
      });
      const { supportToken } = res.data.data;
      loginAsTenant({ role: "ADMIN", tenantId: supportTenantId }, supportToken, token);
      message.success("Đã kích hoạt chế độ hỗ trợ!");
      setSupportTenantId(null);
      window.location.href = "/dashboard";
    } catch {
      message.error("Không thể khởi tạo phiên hỗ trợ");
    }
  };

  const handleApproveUpgrade = async (id) => {
    try {
      await api.post(`/admin/upgrade-requests/${id}/approve`);
      message.success("Đã duyệt yêu cầu nâng gói");
      fetchUpgradeRequests();
    } catch (err) {
      message.error(err.response?.data?.message || "Duyệt thất bại");
    }
  };

  const handleRejectUpgrade = async (id) => {
    try {
      await api.post(`/admin/upgrade-requests/${id}/reject`);
      message.success("Đã từ chối yêu cầu");
      fetchUpgradeRequests();
    } catch {
      message.error("Từ chối thất bại");
    }
  };

  // Overview Tab Content
  const overviewColumns = [
    { title: t("admin.name", "Tên"), dataIndex: "name", key: "name" },
    { title: "Slug", dataIndex: "slug", key: "slug", responsive: ["md"] },
    {
      title: t("admin.plan", "Gói"),
      key: "plan",
      render: (_, record) => {
        if (!record.subscription) {
          return <Tag color="red">Hết hạn</Tag>;
        }
        return (
          <Select
            value={record.subscription.planId}
            size="small"
            style={{ width: 140 }}
            onChange={(v) => handleChangePlan(record.id, v)}
          >
            {plans.map((p) => (
              <Select.Option key={p.id} value={p.id}>
                {p.name}
              </Select.Option>
            ))}
          </Select>
        );
      },
    },
    {
      title: t("admin.users", "Users"),
      dataIndex: "_count",
      key: "users",
      render: (c) => c?.users || 0,
    },
    {
      title: "Trạng thái",
      dataIndex: "subscription",
      key: "subStatus",
      render: (sub) => {
        if (!sub) return <Tag>No sub</Tag>;
        const colors = { ACTIVE: "green", EXPIRED: "red", CANCELLED: "orange", TRIAL: "blue" };
        return <Tag color={colors[sub.status]}>{sub.status}</Tag>;
      },
    },
    {
      title: t("admin.status", "Active"),
      dataIndex: "isActive",
      key: "isActive",
      render: (active, record) => (
        <Switch
          checked={active}
          onChange={() => handleToggleActive(record.id, active)}
          size="small"
        />
      ),
    },
    {
      title: t("admin.created", "Ngày tạo"),
      dataIndex: "createdAt",
      key: "createdAt",
      responsive: ["lg"],
      render: (d) => new Date(d).toLocaleDateString("vi-VN"),
    },
    {
      title: "Hành động",
      key: "actions",
      render: (_, record) => (
        <Button
          type="primary"
          icon={<KeyOutlined />}
          onClick={() => openSupportModal(record.id)}
          size="small"
        >
          Hỗ trợ
        </Button>
      ),
    },
  ];

  // Upgrade Requests Tab Content
  const upgradeColumns = [
    { title: "Mã yêu cầu", dataIndex: "invoiceCode", key: "code" },
    { title: "Tenant", dataIndex: ["tenant", "name"], key: "tenant" },
    {
      title: "Số tiền", dataIndex: "amount", key: "amount",
      render: (v, r) => `${v?.toLocaleString()} ${r.currency}`,
    },
    {
      title: "Trạng thái", dataIndex: "status", key: "status",
      render: (v) => {
        const colors = { PENDING: "orange", PAID: "green", CANCELLED: "red" };
        return <Tag color={colors[v]}>{v}</Tag>;
      },
    },
    {
      title: "Ngày yêu cầu", dataIndex: "createdAt", key: "createdAt",
      render: (d) => d ? new Date(d).toLocaleDateString("vi-VN") : "-",
    },
    {
      title: "", key: "actions",
      render: (_, r) => r.status === "PENDING" ? (
        <Space>
          <Popconfirm title="Duyệt yêu cầu này?" onConfirm={() => handleApproveUpgrade(r.id)}>
            <Button icon={<CheckOutlined />} size="small" type="primary">Duyệt</Button>
          </Popconfirm>
          <Popconfirm title="Từ chối yêu cầu?" onConfirm={() => handleRejectUpgrade(r.id)}>
            <Button icon={<CloseOutlined />} size="small" danger>Từ chối</Button>
          </Popconfirm>
        </Space>
      ) : null,
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <Title level={3}>
        <CrownOutlined /> {t("admin.title", "Super Admin Dashboard")}
      </Title>

      <Space style={{ marginBottom: 16 }}>
        <Button 
          type="primary" 
          icon={<AppstoreOutlined />} 
          onClick={() => navigate("/admin/plans")}
        >
          Quản lý gói
        </Button>
        <Button 
          icon={<TeamOutlined />} 
          onClick={() => navigate("/admin/subscriptions")}
        >
          Quản lý thuê bao
        </Button>
      </Space>

      <Tabs
        activeKey={activeKey}
        onChange={(key) => setActiveKey(key)}
        tabBarExtraContent={<Button 
          type="primary" 
          icon={<UsergroupAddOutlined />}
          onClick={() => navigate("/admin/tenants")}
        >
          Quản lý Tenant
        </Button>}
      >
        <Tabs.TabPane tab="Tổng quan" key="overview">
          <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
            <Col xs={12} sm={6}>
              <Card>
                <Statistic title="Tổng tenant" value={stats.total} prefix={<ShopOutlined />} />
              </Card>
            </Col>
            <Col xs={12} sm={6}>
              <Card>
                <Statistic title="Đang hoạt động" value={stats.active} prefix={<TeamOutlined />} valueStyle={{ color: "#059669" }} />
              </Card>
            </Col>
            <Col xs={12} sm={6}>
              <Card>
                <Statistic title="FREE" value={stats.free} prefix={<UserOutlined />} valueStyle={{ color: "#6b7280" }} />
              </Card>
            </Col>
            <Col xs={12} sm={6}>
              <Card>
                <Statistic title="PRO" value={stats.pro} prefix={<UserOutlined />} valueStyle={{ color: "#2563eb" }} />
              </Card>
            </Col>
            <Col xs={12} sm={6}>
              <Card>
                <Statistic title="ENTERPRISE" value={stats.enterprise} prefix={<CrownOutlined />} valueStyle={{ color: "#7c3aed" }} />
              </Card>
            </Col>
          </Row>

          <Card>
            <Table
              dataSource={tenants}
              columns={overviewColumns}
              rowKey="id"
              loading={loading}
              scroll={{ x: 800 }}
              pagination={{ pageSize: 20 }}
            />
          </Card>
        </Tabs.TabPane>

        <Tabs.TabPane tab="Yêu cầu nâng gói" key="upgrade-requests">
          {upgradeRequests.length === 0 && !loading && (
            <Alert 
              type="info" 
              message="Không có yêu cầu nâng gói nào đang chờ duyệt"
              showIcon
            />
          )}
          <Card>
            <Table
              dataSource={upgradeRequests}
              columns={upgradeColumns}
              rowKey="id"
              loading={loading}
              pagination={{ pageSize: 20 }}
            />
          </Card>
        </Tabs.TabPane>

        <Tabs.TabPane tab="Hỗ trợ" key="support">
          <Card>
            <Modal
              title="Hỗ trợ tenant"
              open={!!supportTenantId}
              onOk={handleSupportAccess}
              onCancel={() => setSupportTenantId(null)}
              okText="Kích hoạt phiên hỗ trợ"
            >
              <p>Nhập lý do hỗ trợ:</p>
              <input
                style={{ width: "100%", padding: "8px 12px", border: "1px solid #d9d9d9", borderRadius: 6 }}
                placeholder="VD: Kiểm tra lỗi báo cáo..."
                value={supportReason}
                onChange={(e) => setSupportReason(e.target.value)}
              />
            </Modal>
          </Card>
        </Tabs.TabPane>
      </Tabs>

      <Modal
        title="Hỗ trợ tenant"
        open={!!supportTenantId}
        onOk={handleSupportAccess}
        onCancel={() => setSupportTenantId(null)}
        okText="Kích hoạt phiên hỗ trợ"
      >
        <p>Nhập lý do hỗ trợ:</p>
        <input
          style={{ width: "100%", padding: "8px 12px", border: "1px solid #d9d9d9", borderRadius: 6 }}
          placeholder="VD: Kiểm tra lỗi báo cáo..."
          value={supportReason}
          onChange={(e) => setSupportReason(e.target.value)}
        />
      </Modal>
    </div>
  );
}