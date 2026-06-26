/**
 * Frontend: pages/onboarding/PaymentStep.jsx — Bước 5: Phương thức thanh toán
 *
 * Tổng quan:
 * - Chọn phương thức thanh toán (cash, transfer, QR, card) — UI local state
 * - Nếu chọn chuyển khoản: nhập thông tin ngân hàng
 * - KHÔNG gọi API (lưu sau qua Onboarding wizard)
 * - State: selected (mảng), bankInfo
 *
 * Components/Hooks/Exports:
 * - PaymentStep: Component chính (xuất mặc định)
 */
import { useState } from 'react';
import { Typography, Space, Input, Form, Card, Row, Col } from 'antd';
import { BankOutlined, WalletOutlined, QrcodeOutlined, CreditCardOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';

const { Text } = Typography;

export default function PaymentStep() {
  const [selected, setSelected] = useState(['cash', 'transfer']);
  const [bankInfo, setBankInfo] = useState({ bankName: '', accountNumber: '', accountName: '' });
  const { t } = useTranslation();

  const methods = [
    { value: 'cash', label: t('onboarding.payment.cash'), icon: <WalletOutlined />, description: t('onboarding.payment.cashDesc') },
    { value: 'transfer', label: t('onboarding.payment.transfer'), icon: <BankOutlined />, description: t('onboarding.payment.transferDesc') },
    { value: 'qr', label: t('onboarding.payment.qr'), icon: <QrcodeOutlined />, description: t('onboarding.payment.qrDesc') },
    { value: 'card', label: t('onboarding.payment.card'), icon: <CreditCardOutlined />, description: t('onboarding.payment.cardDesc') },
  ];

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      <Text type="secondary">{t('onboarding.payment.hint')}</Text>

      <Row gutter={[12, 12]}>
        {methods.map((m) => (
          <Col key={m.value} xs={12} sm={6}>
            <Card
              size="small"
              hoverable
              style={{ cursor: 'pointer', borderColor: selected.includes(m.value) ? 'var(--primary)' : undefined, background: selected.includes(m.value) ? 'var(--primary-lighter)' : undefined }}
              onClick={() => setSelected((prev) => prev.includes(m.value) ? prev.filter((v) => v !== m.value) : [...prev, m.value])}
            >
              <Space direction="vertical" align="center" style={{ width: '100%', textAlign: 'center' }}>
                <span style={{ fontSize: 24, color: selected.includes(m.value) ? 'var(--primary)' : undefined }}>{m.icon}</span>
                <Text strong>{m.label}</Text>
                <Text type="secondary" style={{ fontSize: 12 }}>{m.description}</Text>
              </Space>
            </Card>
          </Col>
        ))}
      </Row>

      {selected.includes('transfer') && (
        <div>
          <Text strong>{t('onboarding.payment.bankInfo')}</Text>
          <Form layout="vertical" style={{ marginTop: 8 }}>
            <Form.Item label={t('onboarding.payment.bankName')}>
              <Input placeholder={t('onboarding.payment.bankNamePlaceholder')} value={bankInfo.bankName} onChange={(e) => setBankInfo((p) => ({ ...p, bankName: e.target.value }))} />
            </Form.Item>
            <Form.Item label={t('onboarding.payment.accountNumber')}>
              <Input placeholder={t('onboarding.payment.accountNumberPlaceholder')} value={bankInfo.accountNumber} onChange={(e) => setBankInfo((p) => ({ ...p, accountNumber: e.target.value }))} />
            </Form.Item>
            <Form.Item label={t('onboarding.payment.accountName')}>
              <Input placeholder={t('onboarding.payment.accountNamePlaceholder')} value={bankInfo.accountName} onChange={(e) => setBankInfo((p) => ({ ...p, accountName: e.target.value }))} />
            </Form.Item>
          </Form>
        </div>
      )}
    </Space>
  );
}
