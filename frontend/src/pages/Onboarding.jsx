import { useState } from 'react';
import { Steps, Button, Typography, Space, Card, message } from 'antd';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '../api/axios';
import CompanyInfoStep from './onboarding/CompanyInfoStep';
import WarehouseStep from './onboarding/WarehouseStep';
import CategoryStep from './onboarding/CategoryStep';
import StaffStep from './onboarding/StaffStep';
import PaymentStep from './onboarding/PaymentStep';

const { Title, Text } = Typography;

const STEP_KEYS = [
  { titleKey: 'onboarding.steps.companyInfo', descKey: 'onboarding.steps.companyInfoDesc', component: CompanyInfoStep },
  { titleKey: 'onboarding.steps.warehouse', descKey: 'onboarding.steps.warehouseDesc', component: WarehouseStep },
  { titleKey: 'onboarding.steps.category', descKey: 'onboarding.steps.categoryDesc', component: CategoryStep },
  { titleKey: 'onboarding.steps.staff', descKey: 'onboarding.steps.staffDesc', component: StaffStep },
  { titleKey: 'onboarding.steps.payment', descKey: 'onboarding.steps.paymentDesc', component: PaymentStep },
];

export default function Onboarding() {
  const [current, setCurrent] = useState(0);
  const [saving, setSaving] = useState(false);
  const navigate = useNavigate();
  const { t } = useTranslation();

  const StepComponent = STEP_KEYS[current].component;

  const saveStep = async (stepIndex, done = false) => {
    try {
      await api.put('/settings/onboarding', { step: stepIndex + 1, done });
    } catch {
      // non-blocking
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
    message.success(t('onboarding.finishMessage'));
    navigate('/dashboard');
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <Card style={{ width: '100%', maxWidth: 720 }} styles={{ body: { padding: 32 } }}>
        <Space direction="vertical" style={{ width: '100%' }} size="large">
          <div style={{ textAlign: 'center' }}>
            <Title level={3} style={{ margin: 0 }}>{t('onboarding.title')}</Title>
            <Text type="secondary">{t('onboarding.subtitle')}</Text>
          </div>

          <Steps
            current={current}
            items={STEP_KEYS.map((s) => ({ title: t(s.titleKey), description: t(s.descKey) }))}
            size="small"
          />

          <div style={{ minHeight: 300 }}>
            <StepComponent />
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <Button disabled={current === 0} onClick={() => setCurrent((c) => c - 1)}>
              {t('common.back')}
            </Button>
            <Space>
              <Button type="link" onClick={() => navigate('/dashboard')}>
                {t('onboarding.skip')}
              </Button>
              {current < STEP_KEYS.length - 1 ? (
                <Button type="primary" loading={saving} onClick={handleNext}>
                  {t('common.next')}
                </Button>
              ) : (
                <Button type="primary" loading={saving} onClick={handleFinish}>
                  {t('common.finish')}
                </Button>
              )}
            </Space>
          </div>
        </Space>
      </Card>
    </div>
  );
}
