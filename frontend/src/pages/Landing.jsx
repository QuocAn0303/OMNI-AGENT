import { useNavigate } from "react-router-dom";
import { Button, Row, Col, Card, Space, Typography, Tag } from "antd";
import {
  ShoppingCartOutlined, DatabaseOutlined, TeamOutlined, AccountBookOutlined,
  ThunderboltOutlined, SafetyCertificateOutlined, MobileOutlined,
  CloudSyncOutlined, BulbOutlined, CheckCircleOutlined,
} from "@ant-design/icons";
import useAuthStore from "../stores/authStore";

const { Title, Text, Paragraph } = Typography;

const features = [
  { icon: <ShoppingCartOutlined />, title: "Bán hàng nhanh", desc: "POS quét mã vạch, tính tiền trong 3 giây. Hỗ trợ tiền mặt, chuyển khoản, thẻ." },
  { icon: <DatabaseOutlined />, title: "Quản lý kho", desc: "Tự động trừ tồn khi bán, cảnh báo sắp hết, gợi ý nhập hàng từ NCC quen." },
  { icon: <TeamOutlined />, title: "Khách hàng 360°", desc: "Nhớ mặt khách quen, tích điểm, tự động nhắc nợ, gửi tin khuyến mãi." },
  { icon: <AccountBookOutlined />, title: "Sổ sách tự động", desc: "Không cần biết kế toán — hệ thống tự ghi sổ, tính lãi lỗ, báo cáo thuế." },
  { icon: <MobileOutlined />, title: "Dùng trên điện thoại", desc: "Mở app trên điện thoại là bán được ngay. Không cần máy tính, không cần cài đặt." },
  { icon: <CloudSyncOutlined />, title: "Đồng bộ sàn TMĐT", desc: "Kết nối Shopee, TikTok Shop — đơn hàng từ sàn tự động vào hệ thống." },
];

const steps = [
  { title: "Đăng ký", desc: "Tạo tài khoản miễn phí trong 30 giây." },
  { title: "Thêm sản phẩm", desc: "Nhập tên và giá — hoặc chọn mẫu có sẵn theo ngành." },
  { title: "Bán hàng", desc: "Mở POS, quét mã vạch, tính tiền — đơn giản như dùng máy tính tay." },
];

export default function Landing() {
  const navigate = useNavigate();
  const isAuth = useAuthStore((s) => s.isAuthenticated);

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(180deg, #f0fdf9 0%, #f8fafc 100%)" }}>
      {/* Hero */}
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "60px 24px 40px", textAlign: "center" }}>
        <Space direction="vertical" size="large" style={{ width: "100%" }}>
          <Tag color="teal" style={{ fontSize: 13, padding: "4px 16px", borderRadius: 20 }}>
            Dành cho shop mới mở tại Việt Nam
          </Tag>
          <Title className="landing-hero-title" style={{ fontSize: 40, fontWeight: 800, marginBottom: 0, lineHeight: 1.3 }}>
            Quản lý shop <span style={{ color: "var(--primary)" }}>dễ như chơi</span>
            <br />dù bạn chưa từng học kế toán
          </Title>
          <Paragraph style={{ fontSize: 17, color: "var(--text-secondary)", maxWidth: 640, margin: "0 auto" }}>
            Aduu ERP giúp bạn bán hàng, quản lý kho, theo dõi khách — tất cả trong 1 ứng dụng.
            Tự động tính lời lỗ, không cần sổ sách giấy tờ.
          </Paragraph>
          <Space size="middle" wrap>
            <Button type="primary" size="large" onClick={() => navigate(isAuth ? "/dashboard" : "/register")} style={{ height: 48, paddingInline: 32, fontSize: 16, fontWeight: 600 }}>
              {isAuth ? "Vào trang quản lý" : "Dùng thử miễn phí"}
            </Button>
            <Button size="large" onClick={() => navigate("/login")} style={{ height: 48, paddingInline: 32, fontSize: 16 }}>
              Đăng nhập
            </Button>
          </Space>
        </Space>
      </div>

      {/* Features grid */}
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "0 24px 60px" }}>
        <Row gutter={[20, 20]}>
          {features.map((f, i) => (
            <Col key={i} xs={24} sm={12} md={8}>
              <Card hoverable style={{ height: "100%", borderRadius: 14 }}>
                <Space direction="vertical" size="small">
                  <span style={{ fontSize: 28, color: "var(--primary)" }}>{f.icon}</span>
                  <Text strong style={{ fontSize: 16 }}>{f.title}</Text>
                  <Text type="secondary" style={{ fontSize: 14, lineHeight: 1.6 }}>{f.desc}</Text>
                </Space>
              </Card>
            </Col>
          ))}
        </Row>
      </div>

      {/* How it works */}
      <div style={{ background: "#fff", padding: "60px 24px" }}>
        <div style={{ maxWidth: 800, margin: "0 auto", textAlign: "center" }}>
          <Title level={2} style={{ marginBottom: 40 }}>
            3 bước để bắt đầu
          </Title>
          <Row gutter={[32, 24]} justify="center">
            {steps.map((s, i) => (
              <Col key={i} xs={24} sm={8}>
                <Space direction="vertical" size="small" align="center">
                  <div style={{
                    width: 56, height: 56, borderRadius: 28,
                    background: "var(--primary)", color: "#fff",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 22, fontWeight: 700,
                  }}>
                    {i + 1}
                  </div>
                  <Text strong style={{ fontSize: 16 }}>{s.title}</Text>
                  <Text type="secondary">{s.desc}</Text>
                </Space>
              </Col>
            ))}
          </Row>
        </div>
      </div>

      {/* Pricing preview */}
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "60px 24px", textAlign: "center" }}>
        <Title level={2} style={{ marginBottom: 8 }}>Bắt đầu miễn phí, nâng cấp khi cần</Title>
        <Text type="secondary" style={{ fontSize: 15 }}>Không ràng buộc, hủy bất kỳ lúc nào.</Text>
        <Row gutter={[20, 20]} style={{ marginTop: 32 }} justify="center">
          {[
            { name: "Gói Miễn phí", price: "0₫/tháng", desc: "Đầy đủ tính năng cơ bản cho 1 shop", features: ["Quản lý sản phẩm", "Bán hàng POS", "Quản lý khách hàng", "Báo cáo cơ bản"], color: "#64748b" },
            { name: "Gói Chuyên nghiệp", price: "Từ 199K/tháng", desc: "Đầy đủ kế toán + nhân sự + sàn TMĐT", features: ["Kế toán tự động", "Quản lý nhân sự + lương", "Kết nối Shopee/TikTok", "Báo cáo thuế HTKK", "Đối soát ngân hàng"], color: "var(--primary)", highlight: true },
          ].map((plan, i) => (
            <Col key={i} xs={24} sm={12} md={8}>
              <Card
                style={{
                  height: "100%", borderRadius: 14,
                  borderColor: plan.highlight ? "var(--primary)" : undefined,
                  borderWidth: plan.highlight ? 2 : 1,
                }}
                title={<Text strong style={{ fontSize: 16 }}>{plan.name}</Text>}
                extra={plan.highlight ? <Tag color="teal">Phổ biến</Tag> : null}
              >
                <Space direction="vertical" size="middle" style={{ width: "100%" }}>
                  <Title level={3} style={{ color: plan.color, margin: 0 }}>{plan.price}</Title>
                  <Text type="secondary">{plan.desc}</Text>
                  <div>
                    {plan.features.map((f, j) => (
                      <div key={j} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                        <CheckCircleOutlined style={{ color: "var(--success)" }} />
                        <Text style={{ fontSize: 14 }}>{f}</Text>
                      </div>
                    ))}
                  </div>
                  <Button
                    type={plan.highlight ? "primary" : "default"}
                    block
                    onClick={() => navigate("/pricing")}
                  >
                    Xem chi tiết
                  </Button>
                </Space>
              </Card>
            </Col>
          ))}
        </Row>
      </div>

      {/* Footer */}
      <div style={{ textAlign: "center", padding: "32px 24px", borderTop: "1px solid var(--border-light)" }}>
        <Text type="secondary" style={{ fontSize: 13 }}>
          Aduu ERP — Hệ thống quản lý bán hàng cho doanh nghiệp Việt
        </Text>
      </div>
    </div>
  );
}
