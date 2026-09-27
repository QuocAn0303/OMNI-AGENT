/**
 * Frontend: src/pages/PortalSettings.jsx — Cổng khách hàng (Customer Portal)
 *
 * Tổng quan:
 * - Portal cho khách: đăng nhập SĐT + OTP → xem đơn hàng, công nợ, hóa đơn, tích điểm
 * - Page này kiểm tra "trạng thái sẵn sàng" của portal: SMS OTP, email hóa đơn, thông tin công ty
 * - Cấu hình chi tiết nằm ở trang Tích hợp (Integrations)
 */
import { useState, useEffect, useCallback } from 'react';
import { Card, Row, Col, Tag, Button, Space, Spin, Alert, Typography, message } from 'antd';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  TeamOutlined,
  BellOutlined,
  ShoppingOutlined,
  AccountBookOutlined,
  GiftOutlined,
  FileTextOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import api from '../api/axios';

const { Text, Title, Paragraph } = Typography;

export default function PortalSettings() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [integrations, setIntegrations] = useState(null);
  const [settings, setSettings] = useState(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [intRes, setRes] = await Promise.all([
        api.get('/integrations'),
        api.get('/settings'),
      ]);
      setIntegrations(intRes.data?.data || {});
      setSettings(setRes.data?.data || {});
    } catch (e) {
      message.error(e.response?.data?.message || 'Không tải được cấu hình');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const smsOk = integrations?.SMS?.SMS_PROVIDER?.isSet === true;
  const smsBrand = integrations?.SMS?.SMS_BRAND_NAME?.isSet === true;
  const emailOk = integrations?.EMAIL?.SMTP_HOST?.isSet === true;

  const requirement = [
    {
      key: 'sms',
      icon: <BellOutlined />,
      title: 'Gửi mã OTP (SMS)',
      ok: smsOk && smsBrand,
      hint: smsOk && smsBrand
        ? 'Khách nhận mã OTP qua SMS để đăng nhập portal'
        : 'Chưa cấu hình SMS — khách sẽ không đăng nhập được portal (chỉ xem được link mời khi OTP log ra console ở dev)',
    },
    {
      key: 'email',
      icon: <FileTextOutlined />,
      title: 'Email hóa đơn (SMTP)',
      ok: emailOk,
      hint: emailOk
        ? 'Khách nhận hóa đơn điện tử qua email'
        : 'Tùy chọn — chưa cấu hình SMTP, hóa đơn chỉ xem được trong portal',
    },
    {
      key: 'company',
      icon: <TeamOutlined />,
      title: 'Thông tin công ty',
      ok: !!(settings?.name && settings?.name !== 'Công ty của tôi'),
      hint: settings?.name
        ? `Đang hiển thị với tên "${settings.name}" — khách nhìn thấy tên này trong portal`
        : 'Đặt tên công ty để khách nhận diện thương hiệu trong portal',
    },
  ];

  const features = [
    { icon: <ShoppingOutlined />, title: 'Xem đơn hàng', desc: 'Khách theo dõi trạng thái đơn đã đặt' },
    { icon: <AccountBookOutlined />, title: 'Công nợ & hóa đơn', desc: 'Xem số dư, thanh toán nợ, tải hóa đơn' },
    { icon: <GiftOutlined />, title: 'Điểm thưởng', desc: 'Tích điểm, đổi quà, xem thẻ tích điểm' },
    { icon: <FileTextOutlined />, title: 'Đặt hàng lại', desc: 'Lặp lại đơn cũ chỉ với một chạm (B2B)' },
  ];

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: '0 auto' }}>
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Space style={{ justifyContent: 'space-between', width: '100%', flexWrap: 'wrap' }}>
          <Space size={12}>
            <TeamOutlined style={{ fontSize: 24, color: 'var(--color-primary, #0d9488)' }} />
            <div>
              <Title level={4} style={{ margin: 0 }}>Cổng khách hàng</Title>
              <Text type="secondary">Khách tự đăng nhập bằng số điện thoại, không cần tạo tài khoản</Text>
            </div>
          </Space>
          <Button icon={<SettingOutlined />} onClick={() => navigate('/integrations')}>
            Cấu hình tích hợp
          </Button>
        </Space>

        {loading ? (
          <Spin style={{ display: 'flex', justifyContent: 'center', marginTop: 60 }} />
        ) : (
          <>
            <Alert
              type={smsOk && smsBrand ? 'success' : 'warning'}
              showIcon
              message={smsOk && smsBrand ? 'Portal sẵn sàng hoạt động' : 'Cần cấu hình thêm trước khi kích hoạt'}
              description={
                smsOk && smsBrand
                  ? 'Khách có thể đăng nhập bằng SĐT + OTP và sử dụng đầy đủ tính năng trong portal.'
                  : 'Thiếu cấu hình SMS (nhà cung cấp + brand name) — đây là kênh gửi mã OTP bắt buộc để khách đăng nhập. Vào trang Tích hợp để cấu hình.'
              }
            />

            <Row gutter={[12, 12]}>
              {requirement.map((r) => (
                <Col xs={24} md={8} key={r.key}>
                  <Card size="small" bodyStyle={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <Space>
                      {r.ok
                        ? <CheckCircleOutlined style={{ color: '#16a34a', fontSize: 18 }} />
                        : <CloseCircleOutlined style={{ color: '#dc2626', fontSize: 18 }} />}
                      <Text strong>{r.title}</Text>
                    </Space>
                    <Text type="secondary" style={{ fontSize: 12 }}>{r.hint}</Text>
                    <div>
                      {r.ok
                        ? <Tag color="green">Đã cấu hình</Tag>
                        : <Tag color="red">Thiếu</Tag>}
                    </div>
                  </Card>
                </Col>
              ))}
            </Row>

            <Card size="small" title="Khách có thể làm gì trên portal">
              <Row gutter={[12, 12]}>
                {features.map((f) => (
                  <Col xs={12} md={6} key={f.title}>
                    <Space direction="vertical" size={4} style={{ width: '100%' }}>
                      <span style={{ fontSize: 20, color: 'var(--color-primary, #0d9488)' }}>{f.icon}</span>
                      <Text strong>{f.title}</Text>
                      <Text type="secondary" style={{ fontSize: 12 }}>{f.desc}</Text>
                    </Space>
                  </Col>
                ))}
              </Row>
            </Card>

            <Card size="small" title="Thông tin công ty hiển thị trên portal">
              <Paragraph style={{ marginBottom: 0 }}>
                {settings?.name ? (
                  <>
                    <Text>Tên: <Text strong>{settings.name}</Text></Text>
                    {settings?.phone && <div style={{ marginTop: 4 }}><Text type="secondary">SĐT: {settings.phone}</Text></div>}
                    {settings?.address && <div style={{ marginTop: 4 }}><Text type="secondary">Địa chỉ: {settings.address}</Text></div>}
                  </>
                ) : (
                  <Text type="secondary">Chưa có thông tin công ty — chỉnh sửa trong Cài đặt công ty</Text>
                )}
              </Paragraph>
            </Card>
          </>
        )}
      </Space>
    </div>
  );
}
