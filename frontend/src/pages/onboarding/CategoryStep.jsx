import { useEffect, useState } from 'react';
import { Form, Input, Button, List, Typography, Space, Tag, message } from 'antd';
import { PlusOutlined, CheckCircleOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import api from '../../api/axios';

const { Text } = Typography;

export default function CategoryStep() {
  const [form] = Form.useForm();
  const [categories, setCategories] = useState([]);
  const [adding, setAdding] = useState(false);
  const { t } = useTranslation();

  const defaultCategories = t('onboarding.category.defaults', { returnObjects: true });

  useEffect(() => {
    api.get('/categories').then((res) => {
      setCategories(res.data.data || res.data || []);
    }).catch(() => {});
  }, []);

  const addCategory = async (name) => {
    setAdding(true);
    try {
      const res = await api.post('/categories', { name });
      setCategories((prev) => [...prev, res.data.data || res.data]);
      form.resetFields();
    } catch (err) {
      message.error(err.response?.data?.message || t('onboarding.category.error'));
    } finally {
      setAdding(false);
    }
  };

  const existingNames = new Set(categories.map((c) => c.name));

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      <Text type="secondary">{t('onboarding.category.hint')}</Text>

      <div>
        <Text strong>{t('onboarding.category.quickAdd')}</Text>
        <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {defaultCategories.filter((n) => !existingNames.has(n)).map((n) => (
            <Tag
              key={n}
              style={{ cursor: 'pointer' }}
              onClick={() => addCategory(n)}
            >
              <PlusOutlined /> {n}
            </Tag>
          ))}
        </div>
      </div>

      {categories.length > 0 && (
        <List
          size="small"
          dataSource={categories}
          renderItem={(c) => (
            <List.Item>
              <Space>
                <CheckCircleOutlined style={{ color: 'var(--success)' }} />
                <Text>{c.name}</Text>
              </Space>
            </List.Item>
          )}
        />
      )}

      <Form form={form} layout="inline" onFinish={({ name }) => addCategory(name)}>
        <Form.Item name="name" rules={[{ required: true, min: 2 }]}>
          <Input placeholder={t('onboarding.category.namePlaceholder')} style={{ width: 240 }} />
        </Form.Item>
        <Button type="primary" htmlType="submit" loading={adding} icon={<PlusOutlined />}>
          {t('onboarding.category.add')}
        </Button>
      </Form>
    </Space>
  );
}
