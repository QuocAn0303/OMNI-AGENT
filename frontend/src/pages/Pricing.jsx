import { Card, Button, Tag, Row, Col, Typography } from 'antd'
import { CheckOutlined, CrownOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'

const { Title, Text } = Typography

const plans = [
  {
    key: 'free',
    price: 0,
    color: '#64748b',
    features: [
      { key: 'warehouses', value: '1' },
      { key: 'products', value: '100' },
      { key: 'users', value: '2' },
      { key: 'basicReports', value: true },
    ],
  },
  {
    key: 'pro',
    price: 29,
    color: '#0f766e',
    popular: true,
    features: [
      { key: 'warehouses', value: '3' },
      { key: 'products', value: 'unlimited' },
      { key: 'users', value: '10' },
      { key: 'advancedReports', value: true },
      { key: 'importExport', value: true },
      { key: 'multiLang', value: true },
    ],
  },
  {
    key: 'enterprise',
    price: 99,
    color: '#7c3aed',
    features: [
      { key: 'warehouses', value: 'unlimited' },
      { key: 'products', value: 'unlimited' },
      { key: 'users', value: 'unlimited' },
      { key: 'allFeatures', value: true },
      { key: 'apiAccess', value: true },
      { key: 'prioritySupport', value: true },
    ],
  },
]

export default function Pricing() {
  const { t } = useTranslation()

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '48px 24px' }}>
      <div style={{ textAlign: 'center', marginBottom: 48 }}>
        <Title level={2}>{t('pricing.title', 'Chọn gói phù hợp')}</Title>
        <Text type="secondary">{t('pricing.subtitle', 'Bắt đầu miễn phí, nâng cấp khi cần')}</Text>
      </div>

      <Row gutter={[24, 24]} justify="center">
        {plans.map((plan) => (
          <Col xs={24} sm={12} lg={8} key={plan.key}>
            <Card
              hoverable
              style={{
                borderColor: plan.popular ? plan.color : undefined,
                borderWidth: plan.popular ? 2 : 1,
                height: '100%',
              }}
            >
              <div style={{ textAlign: 'center', marginBottom: 24 }}>
                {plan.popular && (
                  <Tag color={plan.color} icon={<CrownOutlined />} style={{ marginBottom: 8 }}>
                    {t('pricing.popular', 'Phổ biến')}
                  </Tag>
                )}
                <Title level={4} style={{ margin: 0 }}>
                  {t(`pricing.plans.${plan.key}`, plan.key.toUpperCase())}
                </Title>
                <div style={{ margin: '16px 0' }}>
                  <span style={{ fontSize: 36, fontWeight: 700, color: plan.color }}>
                    {plan.price === 0 ? t('pricing.free', 'Miễn phí') : `$${plan.price}`}
                  </span>
                  {plan.price > 0 && (
                    <Text type="secondary">/{t('pricing.month', 'tháng')}</Text>
                  )}
                </div>
              </div>

              <div style={{ marginBottom: 24 }}>
                {plan.features.map((f) => (
                  <div key={f.key} style={{ padding: '6px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <CheckOutlined style={{ color: plan.color, fontSize: 14 }} />
                    <Text>
                      {t(`pricing.features.${f.key}`, f.key)}
                      {typeof f.value === 'string' && f.value !== 'unlimited' && `: ${f.value}`}
                      {f.value === 'unlimited' && `: ${t('pricing.unlimited', 'Không giới hạn')}`}
                    </Text>
                  </div>
                ))}
              </div>

              <Button
                type={plan.popular ? 'primary' : 'default'}
                block
                size="large"
                style={plan.popular ? { background: plan.color, borderColor: plan.color } : {}}
              >
                {plan.price === 0
                  ? t('pricing.startFree', 'Bắt đầu miễn phí')
                  : t('pricing.upgrade', 'Nâng cấp')}
              </Button>
            </Card>
          </Col>
        ))}
      </Row>
    </div>
  )
}
