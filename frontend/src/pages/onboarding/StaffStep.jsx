/**
 * Frontend: pages/onboarding/StaffStep.jsx — Bước 4: Nhân viên
 *
 * Tổng quan:
 * - Thêm nhân viên nhanh (họ tên, email, vai trò), mật khẩu mặc định "123456"
 * - Hiển thị danh sách nhân viên đã tạo
 * - API: POST /users
 * - State: created, adding, form
 *
 * Components/Hooks/Exports:
 * - StaffStep: Component chính (xuất mặc định)
 */
import { useState } from 'react';
import { Form, Input, Select, Button, List, Typography, Space, Tag, message } from 'antd';
import { UserAddOutlined, CheckCircleOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import api from '../../api/axios';

const { Text } = Typography;

const ROLE_COLORS = { MANAGER: 'blue', CASHIER: 'green', WAREHOUSE: 'orange' };

export default function StaffStep() {
  const [form] = Form.useForm();
  const [created, setCreated] = useState([]);
  const [adding, setAdding] = useState(false);
  const { t } = useTranslation();

  const roleLabels = t('onboarding.staff.roles', { returnObjects: true });

  const handleAdd = async (values) => {
    setAdding(true);
    try {
      const res = await api.post('/users', { ...values, password: '123456' });
      setCreated((prev) => [...prev, res.data.data || res.data]);
      form.resetFields();
      message.success(t('onboarding.staff.created', { name: values.fullName }));
    } catch (err) {
      message.error(err.response?.data?.message || t('onboarding.staff.error'));
    } finally {
      setAdding(false);
    }
  };

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      <Text type="secondary">
        {t('onboarding.staff.hint')} <Text code>{t('onboarding.staff.hintPassword')}</Text> {t('onboarding.staff.hintSuffix')}
      </Text>

      {created.length > 0 && (
        <List
          size="small"
          dataSource={created}
          renderItem={(u) => (
            <List.Item>
              <Space>
                <CheckCircleOutlined style={{ color: 'var(--success)' }} />
                <Text strong>{u.fullName}</Text>
                <Text type="secondary">{u.email}</Text>
                <Tag color={ROLE_COLORS[u.role]}>{roleLabels[u.role] || u.role}</Tag>
              </Space>
            </List.Item>
          )}
        />
      )}

      <Form form={form} layout="vertical" onFinish={handleAdd}>
        <Space wrap>
          <Form.Item label={t('onboarding.staff.fullName')} name="fullName" rules={[{ required: true }]} style={{ marginBottom: 0 }}>
            <Input placeholder="Nguyen Van A" style={{ width: 200 }} />
          </Form.Item>
          <Form.Item label={t('onboarding.staff.email')} name="email" rules={[{ required: true, type: 'email' }]} style={{ marginBottom: 0 }}>
            <Input placeholder="a@company.vn" style={{ width: 200 }} />
          </Form.Item>
          <Form.Item label={t('onboarding.staff.role')} name="role" initialValue="CASHIER" style={{ marginBottom: 0 }}>
            <Select style={{ width: 140 }}
              options={Object.entries(roleLabels).map(([v, l]) => ({ value: v, label: l }))}
            />
          </Form.Item>
          <Form.Item label=" " style={{ marginBottom: 0 }}>
            <Button type="primary" htmlType="submit" loading={adding} icon={<UserAddOutlined />}>
              {t('onboarding.staff.add')}
            </Button>
          </Form.Item>
        </Space>
      </Form>
    </Space>
  );
}
