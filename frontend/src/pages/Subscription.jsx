/**
 * Frontend: pages/Subscription.jsx — Quản lý gói dịch vụ
 * 
 * Tổng quan:
 * - Trang quản lý thuê bao: xem gói hiện tại, hạn mức, nâng cấp, lịch sử hóa đơn
 * - API: GET /subscriptions/my, GET /subscriptions/plans, GET .../invoices, POST .../upgrade-request, POST .../invoices/:id/pay
 * - State: sub, plans, invoices, upgradeModal
 * - Logic: 3 tabs (gói hiện tại, nâng cấp, hóa đơn). Nâng cấp redirect đến checkout URL
 * 
 * Components/Hooks/Exports:
 * - Subscription (default export): Giao diện quản lý gói với tabs + usage progress
 */
import { useState, useEffect } from "react";
import { Card, Row, Col, Tag, Typography, Table, Button, message, Statistic, Descriptions, Tabs, Progress, Modal, List } from "antd";
import { CrownOutlined, CheckCircleOutlined, CloseCircleOutlined, FileTextOutlined, CheckOutlined, ArrowUpOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import api from "../api/axios";

const { Title, Text } = Typography;

const statusColors = { ACTIVE: "green", EXPIRED: "red", CANCELLED: "orange", TRIAL: "blue" };
const invoiceStatusColors = { PENDING: "orange", PAID: "green", OVERDUE: "red", CANCELLED: "default", REFUNDED: "purple" };
const planColors = { free: "#94a3b8", pro: "#0d9488", business: "#6366f1", enterprise: "#f59e0b" };

export default function Subscription() {
  const navigate = useNavigate();
  const [sub, setSub] = useState(null);
  const [plans, setPlans] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [upgradeModal, setUpgradeModal] = useState(null);
  const [upgrading, setUpgrading] = useState(false);

  useEffect(() => {
    const fetch = async () => {
      try {
        const [subRes, planRes, invRes] = await Promise.all([
          api.get("/subscriptions/my"),
          api.get("/subscriptions/plans"),
          api.get("/subscriptions/my/invoices"),
        ]);
        setSub(subRes.data.data);
        setPlans(planRes.data.data);
        setInvoices(invRes.data.data);
      } catch { message.error("Không thể tải thông tin thuê bao"); }
      finally { setLoading(false); }
    };
    fetch();
  }, []);

  const handleUpgrade = async () => {
    if (!upgradeModal) return;
    setUpgrading(true);
    try {
      const { data } = await api.post("/subscriptions/my/upgrade-request", { planId: upgradeModal.id });
      const checkoutUrl = data?.data?.checkoutUrl;
      if (checkoutUrl) {
        window.location.href = checkoutUrl;
      } else {
        message.error("Không nhận được link thanh toán");
        setUpgradeModal(null);
      }
    } catch (err) {
      message.error(err.response?.data?.message || "Yêu cầu nâng gói thất bại");
      setUpgradeModal(null);
    } finally {
      setUpgrading(false);
    }
  };

  const features = sub?.plan?.features || {};

  const invoiceColumns = [
    { title: "Mã HĐ", dataIndex: "invoiceCode", key: "code" },
    { title: "Số tiền", dataIndex: "amount", key: "amount", render: (v, r) => `${v?.toLocaleString()} ${r.currency}` },
    { title: "Trạng thái", dataIndex: "status", key: "status", render: (v) => <Tag color={invoiceStatusColors[v]}>{v}</Tag> },
    { title: "Hạn TT", dataIndex: "dueDate", key: "dueDate", render: (d) => d ? new Date(d).toLocaleDateString("vi-VN") : "-" },
    { title: "Ngày TT", dataIndex: "paidAt", key: "paidAt", render: (d) => d ? new Date(d).toLocaleDateString("vi-VN") : "-" },
    {
      title: "", key: "actions",
      render: (_, r) => r.status === "PENDING" ? (
        <Button size="small" type="primary" onClick={async () => {
          try {
            await api.post(`/subscriptions/my/invoices/${r.id}/pay`);
            message.success("Đã thanh toán");
            window.location.reload();
          } catch { message.error("Lỗi"); }
        }}>Thanh toán</Button>
      ) : null,
    },
  ];

  const currentPlanCard = (
    <Row gutter={[16, 16]}>
      <Col xs={24} lg={12}>
        <Card>
          <Statistic title="Gói hiện tại" value={sub?.plan?.name || "-"}
            prefix={<CrownOutlined />}
            valueStyle={{ color: "#0d9488", fontSize: 24 }}
          />
          <div style={{ marginTop: 12 }}>
            <Tag color={statusColors[sub?.status]}>{sub?.status}</Tag>
            {sub?.plan?.price > 0 && (
              <Text strong style={{ marginLeft: 8 }}>
                {sub.plan.price?.toLocaleString()} {sub.plan.currency}/{sub.plan.durationDays} ngày
              </Text>
            )}
            {sub?.plan?.price === 0 && sub?.plan?.key === "free" && (
              <Text type="secondary" style={{ marginLeft: 8 }}>Miễn phí</Text>
            )}
          </div>
          <Descriptions column={1} size="small" style={{ marginTop: 16 }}>
            <Descriptions.Item label="Ngày bắt đầu">{sub?.startDate ? new Date(sub.startDate).toLocaleDateString("vi-VN") : "-"}</Descriptions.Item>
            <Descriptions.Item label="Ngày hết hạn">{sub?.endDate ? new Date(sub.endDate).toLocaleDateString("vi-VN") : "-"}</Descriptions.Item>
            <Descriptions.Item label="Tự động gia hạn">{sub?.autoRenew ? <CheckCircleOutlined style={{ color: "green" }} /> : <CloseCircleOutlined style={{ color: "red" }} />}</Descriptions.Item>
          </Descriptions>
        </Card>
      </Col>
      <Col xs={24} lg={12}>
        <Card title="Hạn mức sử dụng">
          {features.maxUsers && (
            <div style={{ marginBottom: 16 }}>
              <Text type="secondary">Nhân viên</Text>
              <Progress percent={Math.min(100, Math.round(((features.maxUsers - 1) / features.maxUsers) * 100))} size="small" format={() => `${features.maxUsers - 1}/${features.maxUsers}`} />
            </div>
          )}
          {features.maxWarehouses && (
            <div style={{ marginBottom: 16 }}>
              <Text type="secondary">Kho hàng</Text>
              <Progress percent={50} size="small" format={() => `1/${features.maxWarehouses}`} />
            </div>
          )}
          {features.maxProducts && (
            <div style={{ marginBottom: 16 }}>
              <Text type="secondary">Sản phẩm</Text>
              <Progress percent={30} size="small" format={() => `15/${features.maxProducts}`} />
            </div>
          )}
        </Card>
      </Col>
    </Row>
  );

  const pricingTable = (
    <Row gutter={[16, 16]}>
      {plans.map((p) => {
        const isCurrent = sub?.plan?.id === p.id;
        const features = p.features || {};
        const fModules = features.allowedModules || [];
        const moduleCount = fModules.length;

        return (
          <Col xs={24} sm={12} lg={6} key={p.id}>
            <Card
              hoverable
              style={{
                border: isCurrent ? `2px solid ${planColors[p.key] || "#0d9488"}` : undefined,
                height: "100%",
                position: "relative",
              }}
            >
              {isCurrent && (
                <Tag color="green" style={{ position: "absolute", top: 12, right: 12 }}>Đang dùng</Tag>
              )}
              <Title level={4} style={{ color: planColors[p.key] || "#0d9488" }}>{p.name}</Title>
              <div style={{ margin: "16px 0" }}>
                {p.price > 0 ? (
                  <>
                    <Text style={{ fontSize: 28, fontWeight: 700 }}>{p.price.toLocaleString()}</Text>
                    <Text type="secondary"> đ / tháng</Text>
                  </>
                ) : p.key === "enterprise" ? (
                  <Text style={{ fontSize: 20, fontWeight: 600 }}>Liên hệ</Text>
                ) : (
                  <Text style={{ fontSize: 28, fontWeight: 700 }}>Miễn phí</Text>
                )}
              </div>
              <List
                size="small"
                dataSource={[
                  `Tối đa ${features.maxUsers === "unlimited" ? "không giới hạn" : features.maxUsers + " người dùng"}`,
                  `Tối đa ${features.maxWarehouses === "unlimited" ? "không giới hạn" : features.maxWarehouses + " kho"}`,
                  `Tối đa ${features.maxProducts === "unlimited" ? "không giới hạn" : features.maxProducts + " sản phẩm"}`,
                  `${moduleCount} modules`,
                ]}
                renderItem={(item) => (
                  <List.Item style={{ padding: "4px 0" }}>
                    <CheckOutlined style={{ color: "green", marginRight: 8 }} /> {item}
                  </List.Item>
                )}
              />
              <Button
                type={isCurrent ? "default" : "primary"}
                block
                style={{ marginTop: 16 }}
                disabled={isCurrent}
                onClick={() => setUpgradeModal(p)}
              >
                {isCurrent ? "Đang sử dụng" : "Chọn gói"}
              </Button>
            </Card>
          </Col>
        );
      })}
    </Row>
  );

  const invoiceHistory = (
    <Card title={<span><FileTextOutlined /> Lịch sử hóa đơn</span>}>
      <Table dataSource={invoices} columns={invoiceColumns} rowKey="id" loading={loading} pagination={{ pageSize: 10 }} />
    </Card>
  );

  const tabItems = [
    { key: "current", label: <span><CrownOutlined /> Gói hiện tại</span>, children: currentPlanCard },
    { key: "upgrade", label: <span><ArrowUpOutlined /> Nâng cấp</span>, children: pricingTable },
    { key: "invoices", label: <span><FileTextOutlined /> Lịch sử hóa đơn</span>, children: invoiceHistory },
  ];

  if (!sub) {
    return (
      <div style={{ padding: 24, textAlign: "center" }}>
        <Title level={4}>Bạn chưa có gói dịch vụ nào</Title>
        <Button type="primary" onClick={() => navigate("/pricing")}>Xem các gói</Button>
      </div>
    );
  }

  return (
    <div style={{ padding: 24 }}>
      <Title level={3}><CrownOutlined /> Gói dịch vụ</Title>

      <Tabs defaultActiveKey="current" items={tabItems} />

      <Modal
        title="Xác nhận nâng gói"
        open={!!upgradeModal}
        onCancel={() => setUpgradeModal(null)}
        onOk={handleUpgrade}
        confirmLoading={upgrading}
        okText="Xác nhận nâng gói"
      >
        {upgradeModal && (
          <div>
            <Text>Bạn có chắc muốn nâng cấp lên gói <strong>{upgradeModal.name}</strong>?</Text>
            <Descriptions column={1} size="small" style={{ marginTop: 16 }}>
              <Descriptions.Item label="Gói hiện tại">{sub?.plan?.name || "-"}</Descriptions.Item>
              <Descriptions.Item label="Gói mới">{upgradeModal.name}</Descriptions.Item>
              {upgradeModal.price > 0 && (
                <Descriptions.Item label="Giá">{upgradeModal.price.toLocaleString()} {upgradeModal.currency}/tháng</Descriptions.Item>
              )}
            </Descriptions>
          </div>
        )}
      </Modal>
    </div>
  );
}