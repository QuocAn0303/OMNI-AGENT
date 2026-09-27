import { useState } from 'react';
import { Typography, Space, Card, Row, Col, message } from 'antd';
import {
  ShopOutlined,
  CoffeeOutlined,
  SkinOutlined,
  MobileOutlined,
  BookOutlined,
  HomeOutlined,
  ShoppingCartOutlined,
  MedicineBoxOutlined,
  GiftOutlined,
  ToolOutlined,
  RestOutlined,
  FireOutlined,
  SoundOutlined,
} from '@ant-design/icons';
import api from '../../api/axios';
import { useAuthStore } from '../../stores/authStore';

const { Text } = Typography;

const BUSINESS_TYPES = [
  { key: 'quan_ao', label: 'Quần áo / Thời trang', icon: <SkinOutlined />, color: '#ec4899', desc: 'Shop quần áo, giày dép, phụ kiện thời trang', preview: '27 sản phẩm, 9 danh mục, size/màu variants' },
  { key: 'tap_hoa', label: 'Tạp hóa / Siêu thị mini', icon: <ShoppingCartOutlined />, color: '#f97316', desc: 'Cửa hàng tạp hóa, thực phẩm, đồ uống', preview: '46 sản phẩm, 9 danh mục, track by lot' },
  { key: 'cafe', label: 'Quán Cafe / Đồ uống', icon: <CoffeeOutlined />, color: '#8b5cf6', desc: 'Quán cafe, trà sữa, nước ép, sinh tố', preview: '44 sản phẩm, 8 danh mục, topping & combo' },
  { key: 'nha_hang', label: 'Quán ăn / Nhà hàng', icon: <RestOutlined />, color: '#ef4444', desc: 'Quán ăn, nhà hàng, phở, cơm — order tại bàn', preview: '37 sản phẩm, 6 danh mục, KDS station' },
  { key: 'do_an_nhanh', label: 'Đồ ăn nhanh / Fast-food', icon: <FireOutlined />, color: '#f59e0b', desc: 'Burger, gà rán, pizza — order tại quầy, takeaway', preview: '35 sản phẩm, 8 danh mục, combo' },
  { key: 'bar_pub', label: 'Bar / Pub / Quán nước', icon: <SoundOutlined />, color: '#6366f1', desc: 'Bar, pub, quán nước, cocktail, bia', preview: '41 sản phẩm, 7 danh mục, happy hour' },
  { key: 'dien_thoai', label: 'Điện thoại / Điện tử', icon: <MobileOutlined />, color: '#3b82f6', desc: 'Điện thoại, laptop, phụ kiện điện tử', preview: '45 sản phẩm, 8 danh mục, serial/IMEI tracking' },
  { key: 'my_pham', label: 'Mỹ phẩm / Spa', icon: <MedicineBoxOutlined />, color: '#10b981', desc: 'Mỹ phẩm, chăm sóc da, nước hoa', preview: '50 sản phẩm, 8 danh mục, batch & expiry tracking' },
  { key: 'noi_that', label: 'Nội thất / Đồ gia dụng', icon: <HomeOutlined />, color: '#6366f1', desc: 'Bàn ghế, tủ kệ, đồ trang trí nhà cửa', preview: '43 sản phẩm, 8 danh mục, installment' },
  { key: 'van_phong_pham', label: 'Văn phòng phẩm / Sách', icon: <BookOutlined />, color: '#14b8a6', desc: 'Sách, bút, giấy, dụng cụ học tập', preview: '48 sản phẩm, 8 danh mục, wholesale' },
  { key: 'thuc_pham', label: 'Thực phẩm sạch', icon: <ShopOutlined />, color: '#84cc16', desc: 'Rau củ quả, thịt cá, thực phẩm hữu cơ', preview: '41 sản phẩm, 8 danh mục, track by lot & expiry' },
  { key: 'qua_tang', label: 'Quà tặng / Lưu niệm', icon: <GiftOutlined />, color: '#f43f5e', desc: 'Quà tặng, đồ handmade, hoa, thiệp', preview: '24 sản phẩm, 6 danh mục, gift wrapping' },
  { key: 'dich_vu', label: 'Dịch vụ / Khác', icon: <ToolOutlined />, color: '#64748b', desc: 'Sửa chữa, in ấn, giặt ủi, dịch vụ khác', preview: '37 sản phẩm, 3 danh mục, appointment booking' },
];

export default function BusinessTypeStep({ onChange }) {
  const [selected, setSelected] = useState(null);
  const [saving, setSaving] = useState(false);
  const setBusinessTemplate = useAuthStore((s) => s.setBusinessTemplate);

  const handleSelect = async (key) => {
    setSaving(true);
    try {
      await api.put('/settings/business-template', { template: key });
      setSelected(key);
      setBusinessTemplate(key); // cập nhật store để Sidebar re-render ngay
      onChange?.(key);
    } catch {
      message.error('Không thể lưu lựa chọn, vui lòng thử lại');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      <div style={{ textAlign: 'center' }}>
        <Text strong style={{ fontSize: 16 }}>Bạn đang kinh doanh lĩnh vực gì?</Text>
        <br />
        <Text type="secondary">
          Chọn loại hình bên dưới — chúng tôi sẽ tự động tạo sản phẩm mẫu, danh mục và thiết lập phù hợp cho bạn.
        </Text>
      </div>

      <Row gutter={[12, 12]}>
        {BUSINESS_TYPES.map((bt) => {
          const isSelected = selected === bt.key;
          return (
            <Col key={bt.key} xs={12} sm={8} md={6}>
              <Card
                size="small"
                hoverable
                loading={saving && isSelected}
                style={{
                  cursor: 'pointer',
                  borderColor: isSelected ? bt.color : undefined,
                  background: isSelected ? `${bt.color}10` : undefined,
                  borderWidth: isSelected ? 2 : 1,
                  height: '100%',
                }}
                onClick={() => handleSelect(bt.key)}
              >
                <Space direction="vertical" align="center" style={{ width: '100%', textAlign: 'center' }}>
                  <span style={{ fontSize: 28, color: isSelected ? bt.color : 'var(--text-muted)' }}>
                    {bt.icon}
                  </span>
                  <Text strong style={{ fontSize: 13, color: isSelected ? bt.color : undefined }}>
                    {bt.label}
                  </Text>
                  <Text type="secondary" style={{ fontSize: 10 }}>
                    {bt.preview}
                  </Text>
                </Space>
              </Card>
            </Col>
          );
        })}
      </Row>

      {selected && (
        <div style={{ textAlign: 'center' }}>
          <Text type="success" strong>
            Đã chọn "{BUSINESS_TYPES.find((b) => b.key === selected)?.label}".
            Nhấn <Text code>Tiếp theo</Text> để thiết lập thông tin công ty.
          </Text>
        </div>
      )}
    </Space>
  );
}
