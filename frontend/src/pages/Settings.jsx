import { useState, useEffect } from 'react';
import {
  Card, Form, Input, Button, message, Row, Col, Typography, Space, Divider,
  Switch, Modal, Spin, Tag,
} from 'antd';
import {
  ShopOutlined, CoffeeOutlined, SkinOutlined, MobileOutlined,
  BookOutlined, HomeOutlined, ShoppingCartOutlined, MedicineBoxOutlined,
  GiftOutlined, ToolOutlined, RestOutlined, FireOutlined, SoundOutlined,
  BankOutlined, PhoneOutlined, MailOutlined, EnvironmentOutlined,
  FileTextOutlined, WarningOutlined, ReloadOutlined,
} from '@ant-design/icons';
import api from '../api/axios';
import useAuthStore from '../stores/authStore';
import PageHeader from '../components/layout/PageHeader';

const { Text } = Typography;

const BUSINESS_TYPES = [
  { key: 'quan_ao', label: 'Quần áo / Thời trang', icon: <SkinOutlined />, color: '#ec4899', desc: 'Shop quần áo, giày dép, phụ kiện thời trang' },
  { key: 'tap_hoa', label: 'Tạp hóa / Siêu thị mini', icon: <ShoppingCartOutlined />, color: '#f97316', desc: 'Cửa hàng tạp hóa, thực phẩm, đồ uống' },
  { key: 'cafe', label: 'Quán Cafe / Đồ uống', icon: <CoffeeOutlined />, color: '#8b5cf6', desc: 'Quán cafe, trà sữa, nước ép, sinh tố' },
  { key: 'nha_hang', label: 'Quán ăn / Nhà hàng', icon: <RestOutlined />, color: '#ef4444', desc: 'Quán ăn, nhà hàng, phở, cơm' },
  { key: 'do_an_nhanh', label: 'Đồ ăn nhanh / Fast-food', icon: <FireOutlined />, color: '#f59e0b', desc: 'Burger, gà rán, pizza — takeaway' },
  { key: 'bar_pub', label: 'Bar / Pub / Quán nước', icon: <SoundOutlined />, color: '#6366f1', desc: 'Bar, pub, cocktail, bia' },
  { key: 'dien_thoai', label: 'Điện thoại / Điện tử', icon: <MobileOutlined />, color: '#3b82f6', desc: 'Điện thoại, laptop, phụ kiện' },
  { key: 'my_pham', label: 'Mỹ phẩm / Spa', icon: <MedicineBoxOutlined />, color: '#10b981', desc: 'Mỹ phẩm, chăm sóc da, nước hoa' },
  { key: 'noi_that', label: 'Nội thất / Đồ gia dụng', icon: <HomeOutlined />, color: '#6366f1', desc: 'Bàn ghế, tủ kệ, đồ trang trí' },
  { key: 'van_phong_pham', label: 'Văn phòng phẩm / Sách', icon: <BookOutlined />, color: '#14b8a6', desc: 'Sách, bút, giấy, dụng cụ học tập' },
  { key: 'thuc_pham', label: 'Thực phẩm sạch', icon: <ShopOutlined />, color: '#84cc16', desc: 'Rau củ quả, thịt cá, thực phẩm hữu cơ' },
  { key: 'qua_tang', label: 'Quà tặng / Lưu niệm', icon: <GiftOutlined />, color: '#f43f5e', desc: 'Quà tặng, đồ handmade, hoa, thiệp' },
  { key: 'dich_vu', label: 'Dịch vụ / Khác', icon: <ToolOutlined />, color: '#64748b', desc: 'Sửa chữa, in ấn, giặt ủi' },
];

const FNB_TEMPLATES = ['cafe', 'nha_hang', 'do_an_nhanh', 'bar_pub'];

export default function Settings() {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [changeModalOpen, setChangeModalOpen] = useState(false);
  const [pendingTemplate, setPendingTemplate] = useState(null);
  const { user, setBusinessTemplate, setBeginnerMode, setAccountingMode, businessTemplate, beginnerMode, accountingMode } = useAuthStore();
  const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN' || user?.role === 'SUPER_OMEGA_ULTRA_ADMIN';

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    setLoading(true);
    try {
      const res = await api.get('/settings');
      const data = res.data?.data;
      form.setFieldsValue({
        name: data.name,
        address: data.address,
        phone: data.phone,
        email: data.email,
        taxCode: data.taxCode,
      });
    } catch {
      message.error('Không thể tải cài đặt');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveCompanyInfo = async (values) => {
    setSaving(true);
    try {
      await api.put('/settings', values);
      message.success('Đã lưu thông tin công ty');
    } catch (err) {
      message.error(err.response?.data?.message || 'Lỗi khi lưu thông tin');
    } finally {
      setSaving(false);
    }
  };

  const handleTemplateClick = (key) => {
    if (key === businessTemplate) return;
    setPendingTemplate(key);
    setChangeModalOpen(true);
  };

  const confirmChangeTemplate = async () => {
    const key = pendingTemplate;
    if (!key) return;
    setSavingTemplate(true);
    setChangeModalOpen(false);
    try {
      await api.put('/settings/business-template', { template: key });
      setBusinessTemplate(key);
      const isFnB = FNB_TEMPLATES.includes(key);
      const wasFnB = FNB_TEMPLATES.includes(businessTemplate);
      message.success({
        content: isFnB
          ? 'Đã chuyển sang chế độ F&B. Sidebar sẽ hiện menu quản lý bàn, KDS, đơn đa kênh...'
          : 'Đã cập nhật loại hình kinh doanh',
        duration: 4,
      });
      if (isFnB !== wasFnB) {
        setTimeout(() => window.location.reload(), 1500);
      }
    } catch (err) {
      message.error(err.response?.data?.message || 'Lỗi khi đổi loại hình kinh doanh');
    } finally {
      setSavingTemplate(false);
      setPendingTemplate(null);
    }
  };

  const handleBeginnerToggle = async (checked) => {
    try {
      await api.put('/settings/beginner-mode', { enabled: checked });
      setBeginnerMode(checked);
    } catch {
      message.error('Không thể cập nhật chế độ');
    }
  };

  const handleAccountingModeToggle = async (checked) => {
    const mode = checked ? 'SIMPLIFIED_HKD' : 'FULL_VAS';
    try {
      await api.put('/settings/accounting-mode', { mode });
      setAccountingMode(mode);
      message.success(
        checked
          ? 'Đã chuyển sang Kế toán đơn giản (Thu/Chi). Sidebar chỉ hiện Công nợ, Chi phí, Nhà cung cấp, Mua hàng.'
          : 'Đã chuyển sang Kế toán đầy đủ (FULL_VAS)',
      );
      setTimeout(() => window.location.reload(), 1200);
    } catch (err) {
      message.error(err.response?.data?.message || 'Không thể cập nhật chế độ kế toán');
    }
  };

  const handleSeedData = async () => {
    if (!businessTemplate) {
      message.warning('Chưa chọn loại hình kinh doanh');
      return;
    }
    try {
      const res = await api.post('/settings/seed-template', { template: businessTemplate });
      const { created } = res.data?.data || {};
      message.success(`Đã tạo: ${created?.categories} danh mục, ${created?.products} sản phẩm, ${created?.customers} khách hàng`);
    } catch (err) {
      if (err.response?.status === 400) {
        message.info('Dữ liệu mẫu đã được tạo trước đó');
      } else {
        message.error('Lỗi khi tạo dữ liệu mẫu');
      }
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}>
        <Spin size="large" />
      </div>
    );
  }

  const currentTemplate = BUSINESS_TYPES.find((bt) => bt.key === businessTemplate);
  const isFnB = FNB_TEMPLATES.includes(businessTemplate);

  return (
    <div className="settings-page">
      {!isAdmin && (
        <div style={{ marginBottom: 16, padding: '8px 16px', background: '#f0f5ff', borderRadius: 8, border: '1px solid #d6e4ff' }}>
          <Text type="secondary" style={{ fontSize: 13 }}>
            Bạn đang xem thông tin công ty. Chỉ <Text strong>ADMIN</Text> mới có thể thay đổi các thiết lập này.
          </Text>
        </div>
      )}

      <PageHeader
        title="Cài đặt chung"
        subtitle="Quản lý thông tin công ty, loại hình kinh doanh và tùy chỉnh hệ thống"
        actions={
          <Button icon={<ReloadOutlined />} onClick={loadSettings}>
            Làm mới
          </Button>
        }
      />

      <Row gutter={[24, 24]}>
        <Col xs={24} lg={14}>
          <Card title="Thông tin công ty" bordered={false} className="shadow-sm">
            <Form
              form={form}
              layout="vertical"
              onFinish={handleSaveCompanyInfo}
              requiredMark="optional"
            >
              <Row gutter={16}>
                <Col xs={24} sm={12}>
                  <Form.Item
                    label="Tên công ty"
                    name="name"
                    rules={[{ required: true, message: 'Vui lòng nhập tên công ty' }]}
                  >
                    <Input prefix={<BankOutlined />} placeholder="Công ty TNHH..." disabled={!isAdmin} />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={12}>
                  <Form.Item label="Mã số thuế" name="taxCode">
                    <Input prefix={<FileTextOutlined />} placeholder="MST (để trống nếu chưa có)" disabled={!isAdmin} />
                  </Form.Item>
                </Col>
              </Row>

              <Form.Item label="Địa chỉ" name="address">
                <Input prefix={<EnvironmentOutlined />} placeholder="Số nhà, đường, phường/xã, quận/huyện, tỉnh/thành" disabled={!isAdmin} />
              </Form.Item>

              <Row gutter={16}>
                <Col xs={24} sm={12}>
                  <Form.Item label="Số điện thoại" name="phone">
                    <Input prefix={<PhoneOutlined />} placeholder="090xxxxxxx" disabled={!isAdmin} />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={12}>
                  <Form.Item label="Email" name="email">
                    <Input prefix={<MailOutlined />} placeholder="contact@company.com" disabled={!isAdmin} />
                  </Form.Item>
                </Col>
              </Row>

              <Divider />

              <Form.Item>
                <Button type="primary" htmlType="submit" loading={saving} disabled={!isAdmin}>
                  Lưu thông tin
                </Button>
              </Form.Item>
            </Form>
          </Card>
        </Col>

        <Col xs={24} lg={10}>
          <Space direction="vertical" style={{ width: '100%' }} size="large">
            <Card
              title="Tùy chỉnh"
              bordered={false}
              className="shadow-sm"
            >
              <Space direction="vertical" style={{ width: '100%' }} size="middle">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <Text strong>Chế độ Đơn giản</Text>
                    <br />
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      Chỉ hiện các menu chính: Bán hàng, Đơn hàng, Sản phẩm, Tồn kho, Khách hàng
                    </Text>
                  </div>
                  <Switch
                    checked={beginnerMode}
                    onChange={handleBeginnerToggle}
                    disabled={!isAdmin}
                  />
                </div>

                <Divider style={{ margin: 0 }} />

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <Text strong>Kế toán đơn giản (HKD)</Text>
                    <br />
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      Thu/Chi đơn giản: chỉ theo dõi Công nợ, Chi phí, Nhà cung cấp — ẩn sổ sách kế toán double-entry
                    </Text>
                  </div>
                  <Switch
                    checked={accountingMode === 'SIMPLIFIED_HKD'}
                    onChange={handleAccountingModeToggle}
                    disabled={!isAdmin}
                  />
                </div>
              </Space>
            </Card>

            <Card
              title="Thông tin gói dịch vụ"
              bordered={false}
              className="shadow-sm"
              extra={
                <Button type="link" onClick={() => window.location.href = '/subscription'}>
                  Chi tiết
                </Button>
              }
            >
              <Text type="secondary">Xem thông tin gói, hạn mức và lịch sử hóa đơn</Text>
            </Card>
          </Space>
        </Col>
      </Row>

      <Divider />

      <Card
        title={
          <Space>
            <span>Loại hình kinh doanh</span>
            {currentTemplate && (
              <Tag color={currentTemplate.color} style={{ marginLeft: 8 }}>
                {currentTemplate.label}
              </Tag>
            )}
            {isFnB && (
              <Tag color="purple">F&B</Tag>
            )}
          </Space>
        }
        bordered={false}
        className="shadow-sm"
        extra={
          <Button size="small" onClick={handleSeedData} loading={savingTemplate} disabled={!isAdmin}>
            Tạo dữ liệu mẫu
          </Button>
        }
      >
        <div style={{ marginBottom: 16 }}>
          <Text type="secondary">
            {currentTemplate
              ? `Bạn đang ở chế độ "${currentTemplate.label}". Click vào loại hình khác để chuyển đổi.`
              : 'Chọn loại hình kinh doanh để hệ thống tự động cấu hình menu, tính năng và dữ liệu mẫu phù hợp.'}
          </Text>
        </div>

        <Row gutter={[12, 12]}>
          {BUSINESS_TYPES.map((bt) => {
            const isSelected = bt.key === businessTemplate;
            return (
              <Col key={bt.key} xs={12} sm={8} md={6} lg={4}>
                <Card
                  size="small"
                  hoverable={isAdmin}
                  loading={savingTemplate && pendingTemplate === bt.key}
                  style={{
                    cursor: isAdmin ? 'pointer' : 'default',
                    borderColor: isSelected ? bt.color : undefined,
                    background: isSelected ? `${bt.color}10` : undefined,
                    borderWidth: isSelected ? 2 : 1,
                    height: '100%',
                    transition: 'all 0.2s',
                    opacity: !isAdmin || (savingTemplate && pendingTemplate !== bt.key) ? 0.5 : 1,
                  }}
                  onClick={() => isAdmin && handleTemplateClick(bt.key)}
                >
                  <Space direction="vertical" align="center" style={{ width: '100%', textAlign: 'center' }}>
                    <span style={{ fontSize: 24, color: isSelected ? bt.color : 'var(--text-muted)' }}>
                      {bt.icon}
                    </span>
                    <Text strong style={{ fontSize: 12, color: isSelected ? bt.color : undefined }}>
                      {bt.label}
                    </Text>
                    <Text type="secondary" style={{ fontSize: 10 }}>
                      {bt.desc}
                    </Text>
                  </Space>
                </Card>
              </Col>
            );
          })}
        </Row>
      </Card>

      <Modal
        title={
          <Space>
            <WarningOutlined style={{ color: '#faad14' }} />
            Đổi loại hình kinh doanh
          </Space>
        }
        open={changeModalOpen}
        onOk={confirmChangeTemplate}
        onCancel={() => { setChangeModalOpen(false); setPendingTemplate(null); }}
        okText="Xác nhận đổi"
        cancelText="Hủy"
        okButtonProps={{ danger: true }}
      >
        <div style={{ padding: '8px 0' }}>
          <Text>
            Bạn có chắc muốn chuyển từ{' '}
            <Text strong>{currentTemplate?.label || '(chưa chọn)'}</Text> sang{' '}
            <Text strong>{BUSINESS_TYPES.find((bt) => bt.key === pendingTemplate)?.label}</Text>?
          </Text>
          <div style={{ marginTop: 12, padding: 12, background: '#fff7e6', borderRadius: 8 }}>
            <Text type="warning" style={{ fontSize: 13 }}>
              Việc đổi loại hình sẽ ảnh hưởng đến menu chức năng hiển thị trên sidebar.
              {FNB_TEMPLATES.includes(pendingTemplate) && ' Các tính năng F&B (sơ đồ bàn, KDS, QR ordering...) sẽ được bật.'}
              {!FNB_TEMPLATES.includes(pendingTemplate) && ' Các tính năng F&B sẽ được ẩn đi.'}
              <br />Dữ liệu hiện có không bị mất.
            </Text>
          </div>
        </div>
      </Modal>
    </div>
  );
}
