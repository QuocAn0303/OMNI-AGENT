/**
 * Page: LoyaltyRules — Cấu hình điểm thưởng & hạng thành viên
 *
 * Tổng quan:
 * - Hiển thị cấu hình chương trình: điểm/1.000đ, quy đổi, hạng (BRONZE→PLATINUM)
 * - Xem tổng quan loyalty của khách + lịch sử giao dịch điểm
 * - Điều chỉnh điểm thủ công (ADMIN)
 * - Gọi API: GET /loyalty/config, GET /customers/:id/loyalty, POST /loyalty/adjust
 *
 * Exports:
 * - LoyaltyRules: React functional component (default export)
 */
import { useEffect, useState, useCallback } from 'react';
import { Table, Button, Space, Tag, Card, Descriptions, InputNumber, Modal, Form, Input, Select, Timeline, Empty } from 'antd';
import { SearchOutlined, SwapOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import axios from '../api/axios';
import PageHeader from '../components/layout/PageHeader';
import EmptyState from '../components/shared/EmptyState';
import useToast from '../components/shared/useToast';
import PermissionGate from '../components/shared/PermissionGate';
import MoneyDisplay from '../components/shared/MoneyDisplay';

const TIER_COLOR = {
  BRONZE: 'orange',
  SILVER: 'default',
  GOLD: 'gold',
  PLATINUM: 'geekblue',
};

export default function LoyaltyRules() {
  const { t } = useTranslation();
  const toast = useToast();
  const [config, setConfig] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [search, setSearch] = useState('');
  const [summary, setSummary] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  const loadConfig = useCallback(async () => {
    try {
      const res = await axios.get('/loyalty/config');
      setConfig(res.data?.data || null);
    } catch { /* optional */ }
  }, []);

  const loadCustomers = async () => {
    try {
      const res = await axios.get('/customers', { params: { limit: 200 } });
      const list = Array.isArray(res.data) ? res.data : (res.data?.data || []);
      setCustomers(list.filter((c) => c.isActive !== false));
    } catch { /* optional */ }
  };

  useEffect(() => {
    loadConfig();
    loadCustomers();
  }, [loadConfig]);

  const loadSummary = async (customerId) => {
    setSummaryLoading(true);
    setSummary(null);
    try {
      const res = await axios.get(`/customers/${customerId}/loyalty`);
      setSummary(res.data?.data || null);
    } catch {
      toast.error(t('loyalty.summaryError'));
    } finally {
      setSummaryLoading(false);
    }
  };

  const openAdjust = () => {
    form.resetFields();
    setAdjustOpen(true);
  };

  const handleAdjust = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      await axios.post('/loyalty/adjust', values);
      toast.success(t('loyalty.adjustSuccess'));
      setAdjustOpen(false);
      if (values.customerId) loadSummary(values.customerId);
    } catch (e) {
      if (e?.errorFields) return;
      toast.error(t('loyalty.adjustError'));
    } finally {
      setSaving(false);
    }
  };

  const filteredCustomers = search
    ? customers.filter((c) => c.name?.toLowerCase().includes(search.toLowerCase()) || c.phone?.includes(search))
    : customers;

  const historyColumns = [
    {
      title: t('loyalty.date'),
      dataIndex: 'createdAt',
      width: 170,
      render: (v) => new Date(v).toLocaleString('vi-VN'),
    },
    {
      title: t('loyalty.points'),
      dataIndex: 'points',
      width: 110,
      align: 'right',
      render: (v) => (
        <span style={{ fontWeight: 600, color: v > 0 ? 'var(--success)' : 'var(--danger)' }}>
          {v > 0 ? `+${v}` : v}
        </span>
      ),
    },
    { title: t('loyalty.type'), dataIndex: 'type', width: 120, render: (v) => <Tag>{v}</Tag> },
    { title: t('loyalty.note'), dataIndex: 'note' },
  ];

  return (
    <>
      <PageHeader title={t('loyalty.title')} subtitle={t('loyalty.subtitle')} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16, marginBottom: 16 }}>
        <Card size="small" title={t('loyalty.earning')}>
          <Descriptions column={1} size="small">
            <Descriptions.Item label={t('loyalty.pointsPer1000')}>
              <b>{config?.pointsPer1000 ?? '—'}</b> {t('loyalty.points')}
            </Descriptions.Item>
          </Descriptions>
        </Card>
        <Card size="small" title={t('loyalty.redeeming')}>
          <Descriptions column={1} size="small">
            <Descriptions.Item label={t('loyalty.redeemRate')}>
              <b>{config?.redeemPoints ?? '—'}</b> {t('loyalty.points')} = <b>{config?.redeemValue?.toLocaleString('vi-VN')}</b>đ
            </Descriptions.Item>
          </Descriptions>
        </Card>
        <Card size="small" title={t('loyalty.tiers')}>
          <Space direction="vertical" size={4} style={{ width: '100%' }}>
            {config?.tiers && Object.entries(config.tiers).map(([key, tier]) => (
              <div key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Tag color={TIER_COLOR[key]}>{tier.label}</Tag>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {key === 'BRONZE' ? '0đ' : `${tier.threshold?.toLocaleString('vi-VN')}đ`} · {tier.discountPercent}%
                </span>
              </div>
            ))}
          </Space>
        </Card>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '380px 1fr', gap: 16 }}>
        <Card
          size="small"
          title={t('loyalty.customers')}
          extra={
            <PermissionGate permission="customers.edit">
              <Button size="small" type="primary" icon={<SwapOutlined />} onClick={openAdjust}>
                {t('loyalty.adjust')}
              </Button>
            </PermissionGate>
          }
        >
          <Input
            placeholder={t('loyalty.searchCustomer')}
            prefix={<SearchOutlined style={{ color: 'var(--text-muted)' }} />}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            allowClear
            style={{ marginBottom: 8 }}
          />
          <div style={{ maxHeight: 420, overflow: 'auto' }}>
            {filteredCustomers.map((c) => (
              <div
                key={c.id}
                onClick={() => loadSummary(c.id)}
                style={{
                  padding: '8px 10px',
                  borderRadius: 'var(--radius-md)',
                  cursor: 'pointer',
                  marginBottom: 4,
                  background: summary?.id === c.id ? 'var(--bg-tertiary)' : 'transparent',
                }}
              >
                <div style={{ fontWeight: 500 }}>{c.name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {c.phone || ''} · <Tag color={TIER_COLOR[c.tier]}>{c.tier}</Tag> · {c.loyaltyPoints ?? 0} {t('loyalty.points')}
                </div>
              </div>
            ))}
            {!filteredCustomers.length && (
              <Empty description={t('loyalty.noCustomers')} image={Empty.PRESENTED_IMAGE_SIMPLE} />
            )}
          </div>
        </Card>

        <Card size="small" title={summary ? summary.name : t('loyalty.customerSummary')} loading={summaryLoading}>
          {summary ? (
            <>
              <div style={{ display: 'flex', gap: 24, marginBottom: 16, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('loyalty.tier')}</div>
                  <Tag color={TIER_COLOR[summary.tier]}>{summary.tier}</Tag>
                </div>
                <div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('loyalty.points')}</div>
                  <b style={{ fontSize: 20 }}>{summary.loyaltyPoints ?? 0}</b>
                </div>
                <div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('loyalty.totalSpent')}</div>
                  <MoneyDisplay value={summary.totalSpent ?? 0} />
                </div>
                <div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('loyalty.tierDiscount')}</div>
                  <b>{summary.tierDiscountPercent ?? 0}%</b>
                </div>
              </div>
              <Table
                columns={historyColumns}
                dataSource={summary.history || []}
                rowKey={(r) => r.id}
                size="small"
                pagination={false}
                locale={{ emptyText: <Empty description={t('loyalty.noHistory')} image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
              />
            </>
          ) : (
            <EmptyState title={t('loyalty.pickCustomer')} description={t('loyalty.pickCustomerDesc')} />
          )}
        </Card>
      </div>

      <Modal
        title={t('loyalty.adjust')}
        open={adjustOpen}
        onOk={handleAdjust}
        onCancel={() => setAdjustOpen(false)}
        confirmLoading={saving}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item name="customerId" label={t('loyalty.customer')} rules={[{ required: true, message: t('loyalty.customerRequired') }]}>
            <Select
              showSearch
              optionFilterProp="label"
              options={customers.map((c) => ({ value: c.id, label: `${c.name} (${c.phone || ''})` }))}
            />
          </Form.Item>
          <Form.Item name="points" label={t('loyalty.pointsToAdjust')} rules={[{ required: true, message: t('loyalty.pointsRequired') }]}>
            <InputNumber style={{ width: '100%' }} placeholder={t('loyalty.pointsHint')} />
          </Form.Item>
          <Form.Item name="note" label={t('loyalty.note')}>
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
