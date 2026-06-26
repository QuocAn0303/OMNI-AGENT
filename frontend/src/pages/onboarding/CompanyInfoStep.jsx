/**
 * Frontend: pages/onboarding/CompanyInfoStep.jsx — Bước 1: Thông tin công ty
 *
 * Tổng quan:
 * - Form nhập thông tin doanh nghiệp (tên, địa chỉ, SĐT, email, mã số thuế, ngành)
 * - Tự động lưu khi blur (onBlurSave)
 * - API: GET /settings (load), PUT /settings (save)
 * - State: form, saving
 *
 * Components/Hooks/Exports:
 * - CompanyInfoStep: Component chính (xuất mặc định)
 */
import { useEffect, useState } from 'react';
import { Form, Input, Select, Space, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import api from '../../api/axios';

const { Text } = Typography;

export default function CompanyInfoStep() {
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const { t } = useTranslation();

  const industries = t('onboarding.company.industries', { returnObjects: true });

  useEffect(() => {
    api.get('/settings').then((res) => {
      const d = res.data.data;
      form.setFieldsValue({ name: d.name, address: d.address, phone: d.phone, email: d.email, taxCode: d.taxCode, industry: d.industry });
    }).catch(() => {});
  }, [form]);

  const onBlurSave = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      await api.put('/settings', values);
    } catch {
      // validation error — skip
    } finally {
      setSaving(false);
    }
  };

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      <Text type="secondary">{t('onboarding.company.hint')}</Text>
      <Form form={form} layout="vertical" onBlur={onBlurSave}>
        <Form.Item label={t('onboarding.company.name')} name="name" rules={[{ required: true, min: 2 }]}>
          <Input placeholder={t('onboarding.company.namePlaceholder')} />
        </Form.Item>
        <Form.Item label={t('onboarding.company.address')} name="address">
          <Input placeholder={t('onboarding.company.addressPlaceholder')} />
        </Form.Item>
        <Form.Item label={t('onboarding.company.phone')} name="phone"
          rules={[{ pattern: /^(0[3|5|7|8|9])+([0-9]{8})$/, message: t('onboarding.company.phoneInvalid') }]}>
          <Input placeholder="0901234567" />
        </Form.Item>
        <Form.Item label={t('onboarding.company.email')} name="email" rules={[{ type: 'email', message: t('onboarding.company.emailInvalid') }]}>
          <Input placeholder="info@company.vn" />
        </Form.Item>
        <Form.Item label={t('onboarding.company.taxCode')} name="taxCode">
          <Input placeholder="0123456789" />
        </Form.Item>
        <Form.Item label={t('onboarding.company.industry')} name="industry">
          <Select placeholder={t('onboarding.company.industryPlaceholder')} options={industries.map((i) => ({ value: i, label: i }))} allowClear />
        </Form.Item>
      </Form>
      {saving && <Text type="secondary">{t('onboarding.company.saving')}</Text>}
    </Space>
  );
}
