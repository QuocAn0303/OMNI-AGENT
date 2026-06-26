/**
 * Frontend: pages/onboarding/WarehouseStep.jsx — Bước 2: Kho hàng
 *
 * Tổng quan:
 * - Thêm kho hàng (tên, mã, địa chỉ)
 * - Hiển thị danh sách kho đã tạo
 * - API: GET /warehouses, POST /warehouses
 * - State: warehouses, adding, form
 *
 * Components/Hooks/Exports:
 * - WarehouseStep: Component chính (xuất mặc định)
 */
import { useEffect, useState } from 'react';
import { Form, Input, Button, List, Typography, Space, message } from 'antd';
import { PlusOutlined, CheckCircleOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import api from '../../api/axios';

const { Text } = Typography;

export default function WarehouseStep() {
  const [form] = Form.useForm();
  const [warehouses, setWarehouses] = useState([]);
  const [adding, setAdding] = useState(false);
  const { t } = useTranslation();

  useEffect(() => {
    api.get('/warehouses').then((res) => {
      setWarehouses(res.data.data || res.data || []);
    }).catch(() => {});
  }, []);

  const handleAdd = async (values) => {
    setAdding(true);
    try {
      const res = await api.post('/warehouses', values);
      setWarehouses((prev) => [...prev, res.data.data || res.data]);
      form.resetFields();
      message.success(t('onboarding.warehouse.added'));
    } catch (err) {
      message.error(err.response?.data?.message || t('onboarding.warehouse.error'));
    } finally {
      setAdding(false);
    }
  };

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      <Text type="secondary">{t('onboarding.warehouse.hint')}</Text>

      {warehouses.length > 0 && (
        <List
          size="small"
          dataSource={warehouses}
          renderItem={(w) => (
            <List.Item>
              <Space>
                <CheckCircleOutlined style={{ color: 'var(--success)' }} />
                <Text strong>{w.name}</Text>
                {w.address && <Text type="secondary">— {w.address}</Text>}
              </Space>
            </List.Item>
          )}
        />
      )}

      <Form form={form} layout="inline" onFinish={handleAdd}>
        <Form.Item name="name" rules={[{ required: true, message: t('onboarding.warehouse.nameRequired') }]}>
          <Input placeholder={t('onboarding.warehouse.namePlaceholder')} style={{ width: 200 }} />
        </Form.Item>
        <Form.Item name="code" rules={[{ required: true, message: t('onboarding.warehouse.codeRequired') }]}>
          <Input placeholder={t('onboarding.warehouse.codePlaceholder')} style={{ width: 140 }} />
        </Form.Item>
        <Form.Item name="address">
          <Input placeholder={t('onboarding.warehouse.addressPlaceholder')} style={{ width: 200 }} />
        </Form.Item>
        <Button type="primary" htmlType="submit" loading={adding} icon={<PlusOutlined />}>
          {t('onboarding.warehouse.add')}
        </Button>
      </Form>
    </Space>
  );
}
