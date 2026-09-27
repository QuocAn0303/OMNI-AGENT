import { useState } from 'react';
import { Steps, Button, Typography, Space, Card, message, Progress } from 'antd';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '../api/axios';
import BusinessTypeStep from './onboarding/BusinessTypeStep';
import CompanyInfoStep from './onboarding/CompanyInfoStep';
import WarehouseStep from './onboarding/WarehouseStep';
import CategoryStep from './onboarding/CategoryStep';
import StaffStep from './onboarding/StaffStep';
import PaymentStep from './onboarding/PaymentStep';

const { Title, Text } = Typography;

const STEP_KEYS = [
  { titleKey: 'onboarding.steps.businessType', descKey: 'onboarding.steps.businessTypeDesc', component: null },
  { titleKey: 'onboarding.steps.companyInfo', descKey: 'onboarding.steps.companyInfoDesc', component: CompanyInfoStep },
  { titleKey: 'onboarding.steps.warehouse', descKey: 'onboarding.steps.warehouseDesc', component: WarehouseStep },
  { titleKey: 'onboarding.steps.category', descKey: 'onboarding.steps.categoryDesc', component: CategoryStep },
  { titleKey: 'onboarding.steps.staff', descKey: 'onboarding.steps.staffDesc', component: StaffStep },
  { titleKey: 'onboarding.steps.payment', descKey: 'onboarding.steps.paymentDesc', component: PaymentStep },
];

export default function Onboarding() {
  const [current, setCurrent] = useState(0);
  const [saving, setSaving] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [seedingComplete, setSeedingComplete] = useState(false);
  const [seedResult, setSeedResult] = useState(null);
  const [businessTemplate, setBusinessTemplate] = useState(null);
  const navigate = useNavigate();
  const { t } = useTranslation();

  const isBusinessStep = current === 0;
  const isLastStep = current === STEP_KEYS.length - 1;

  const StepComponent = isBusinessStep ? null : STEP_KEYS[current].component;

  const saveStep = async (stepIndex, done = false) => {
    try {
      await api.put('/settings/onboarding', { step: stepIndex + 1, done });
    } catch {
      // non-blocking
    }
  };

  const handleSeedTemplate = async () => {
    if (!businessTemplate) return;
    setSeeding(true);
    try {
      const res = await api.post('/settings/seed-template', { template: businessTemplate });
      setSeedResult(res.data.data);
      setSeedingComplete(true);
      message.success(res.data.data.message);
    } catch (err) {
      if (err.response?.status !== 400) {
        message.error('Không thể tạo dữ liệu mẫu, vui lòng thử lại');
      }
    } finally {
      setSeeding(false);
    }
  };

  const handleNext = async () => {
    setSaving(true);
    await saveStep(current);
    setSaving(false);
    setCurrent((c) => c + 1);
  };

  const handleFinish = async () => {
    setSaving(true);
    await saveStep(STEP_KEYS.length - 1, true);
    setSaving(false);
    if (businessTemplate && !seedingComplete) {
      await handleSeedTemplate();
    }
    message.success(t('onboarding.finishMessage'));
    navigate('/dashboard');
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <Card style={{ width: '100%', maxWidth: 800 }} styles={{ body: { padding: 32 } }}>
        <Space direction="vertical" style={{ width: '100%' }} size="large">
          <div style={{ textAlign: 'center' }}>
            <Title level={3} style={{ margin: 0 }}>{t('onboarding.title')}</Title>
            <Text type="secondary">{t('onboarding.subtitle')}</Text>
          </div>

          {/* Progress bar for visual feedback */}
          <Progress
            percent={Math.round(((current + 1) / STEP_KEYS.length) * 100)}
            showInfo={false}
            strokeColor="var(--primary)"
            trailColor="var(--border-light)"
            size="small"
          />

          {!seedingComplete && !seeding ? (
            <>
              <Steps
                current={current}
                items={STEP_KEYS.map((s) => ({ title: t(s.titleKey), description: t(s.descKey) }))}
                size="small"
                style={{ overflowX: 'auto' }}
              />

              <div style={{ minHeight: 300 }}>
                {isBusinessStep ? (
                  <BusinessTypeStep onChange={setBusinessTemplate} />
                ) : (
                  <StepComponent />
                )}
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <Button disabled={current === 0} onClick={() => setCurrent((c) => c - 1)}>
                  {t('common.back')}
                </Button>
                <Space>
                  <Button type="link" onClick={() => navigate('/dashboard')}>
                    {t('onboarding.skip')}
                  </Button>
                  {isLastStep ? (
                    <Button
                      type="primary"
                      loading={saving}
                      onClick={handleFinish}
                    >
                      {t('common.finish')}
                    </Button>
                  ) : (
                    <Button
                      type="primary"
                      loading={saving}
                      onClick={handleNext}
                      disabled={isBusinessStep && !businessTemplate}
                    >
                      {t('common.next')}
                    </Button>
                  )}
                </Space>
              </div>
            </>
          ) : seeding ? (
            <div style={{ textAlign: 'center', padding: 40 }}>
              <Space direction="vertical" size="large">
                <Text strong style={{ fontSize: 16 }}>Đang tạo dữ liệu mẫu cho shop...</Text>
                <Progress percent={50} status="active" />
                <Text type="secondary">Chúng tôi đang thiết lập sản phẩm, danh mục và khách hàng mẫu.</Text>
              </Space>
            </div>
          ) : seedingComplete ? (
            <div style={{ textAlign: 'center', padding: 40 }}>
              <Space direction="vertical" size="large">
                <Title level={4} type="success" style={{ margin: 0 }}>
                  Thiết lập hoàn tất!
                </Title>
                {seedResult && (
                  <Text type="secondary">
                    Đã tạo {seedResult.created?.products || 0} sản phẩm, {seedResult.created?.categories || 0} danh mục,
                    {seedResult.created?.customers || 0} khách hàng, {seedResult.created?.warehouse || 0} kho hàng.
                  </Text>
                )}
                <Button type="primary" size="large" onClick={() => navigate('/dashboard')}>
                  Bắt đầu sử dụng
                </Button>
              </Space>
            </div>
          ) : null}
        </Space>
      </Card>
    </div>
  );
}
