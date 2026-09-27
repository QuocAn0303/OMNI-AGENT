/**
 * Frontend: pages/Pricing.jsx — Bảng giá / chọn gói
 * 
 * Tổng quan:
 * - Trang hiển thị các gói dịch vụ (Free, Pro, Enterprise) cho phép đăng ký hoặc nâng cấp
 * - API: GET /subscriptions/plans (nếu đã auth), fallback data mẫu nếu chưa auth
 * - State: plans, loading
 * - Logic: Nếu chưa đăng nhập → redirect /register, nếu đã đăng nhập → redirect /subscription
 * 
 * Components/Hooks/Exports:
 * - Pricing (default export): Grid hiển thị các gói + button hành động
 */
import { useState, useEffect } from "react";
import { Card, Button, Tag, Row, Col, Typography, Skeleton } from "antd";
import { CheckOutlined, CrownOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import api from "../api/axios";
import useAuthStore from "../stores/authStore";

const { Title, Text } = Typography;

export default function Pricing() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { isAuthenticated } = useAuthStore();
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (isAuthenticated) {
      api.get("/subscriptions/plans").then((res) => {
        setPlans(res.data.data);
      }).catch(() => {}).finally(() => setLoading(false));
    } else {
      const t = setTimeout(() => {
        setLoading(false);
        setPlans([
        { id: "free", key: "free", name: "FREE", price: 0, currency: "USD", durationDays: 99999,
          features: { warehouses: "1", products: "100", users: "2", basicReports: true } },
        { id: "pro", key: "pro", name: "PRO", price: 29, currency: "USD", durationDays: 30, popular: true,
          features: { warehouses: "3", products: "unlimited", users: "10", advancedReports: true, importExport: true } },
        { id: "enterprise", key: "enterprise", name: "ENTERPRISE", price: 99, currency: "USD", durationDays: 30,
          features: { warehouses: "unlimited", products: "unlimited", users: "unlimited", allFeatures: true, apiAccess: true, prioritySupport: true } },
      ]);
      }, 0);
      return () => clearTimeout(t);
    }
  }, [isAuthenticated]);

  const handleSelect = (planKey) => {
    if (!isAuthenticated) {
      navigate(`/register?plan=${planKey}`);
    } else {
      navigate("/subscription");
    }
  };

  if (loading) return <Skeleton active style={{ padding: 48 }} />;

  const colorMap = { free: "#64748b", pro: "#0f766e", enterprise: "#7c3aed" };

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "48px 24px" }}>
      <div style={{ textAlign: "center", marginBottom: 48 }}>
        <Title level={2}>{t("pricing.title", "Chọn gói phù hợp")}</Title>
        <Text type="secondary">{t("pricing.subtitle", "Bắt đầu miễn phí, nâng cấp khi cần")}</Text>
      </div>

      <Row gutter={[24, 24]} justify="center">
        {plans.map((plan) => {
          const color = colorMap[plan.key] || "#0d9488";
          const popular = plan.key === "pro";

          return (
            <Col xs={24} sm={12} lg={8} key={plan.id}>
              <Card
                hoverable
                style={{
                  borderColor: popular ? color : undefined,
                  borderWidth: popular ? 2 : 1,
                  height: "100%",
                }}
              >
                <div style={{ textAlign: "center", marginBottom: 24 }}>
                  {popular && (
                    <Tag color={color} icon={<CrownOutlined />} style={{ marginBottom: 8 }}>
                      {t("pricing.popular", "Phổ biến")}
                    </Tag>
                  )}
                  <Title level={4} style={{ margin: 0 }}>{plan.name}</Title>
                  <div style={{ margin: "16px 0" }}>
                    <span style={{ fontSize: 36, fontWeight: 700, color }}>
                      {plan.price === 0 ? t("pricing.free", "Miễn phí") : `${plan.price?.toLocaleString()} ${plan.currency}`}
                    </span>
                    {plan.price > 0 && (
                      <Text type="secondary">/{t("pricing.month", "tháng")}</Text>
                    )}
                  </div>
                </div>

                <div style={{ marginBottom: 24 }}>
                  {Object.entries(plan.features || {}).map(([key, value]) => (
                    <div key={key} style={{ padding: "6px 0", display: "flex", alignItems: "center", gap: 8 }}>
                      <CheckOutlined style={{ color, fontSize: 14 }} />
                      <Text>
                        {t(`pricing.features.${key}`, key)}
                        {typeof value === "string" && value !== "unlimited" && `: ${value}`}
                        {value === "unlimited" && `: ${t("pricing.unlimited", "Không giới hạn")}`}
                        {value === true && ""}
                      </Text>
                    </div>
                  ))}
                </div>

                <Button
                  type={popular ? "primary" : "default"}
                  block
                  size="large"
                  style={popular ? { background: color, borderColor: color } : {}}
                  onClick={() => handleSelect(plan.key)}
                >
                  {plan.price === 0
                    ? t("pricing.startFree", "Bắt đầu miễn phí")
                    : isAuthenticated ? t("pricing.upgrade", "Nâng cấp") : t("pricing.select", "Chọn gói")}
                </Button>
              </Card>
            </Col>
          );
        })}
      </Row>
    </div>
  );
}
