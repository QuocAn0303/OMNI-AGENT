/**
 * Page: StampCards — Thẻ tích điểm F&B
 *
 * Tổng quan:
 * - Quản lý template thẻ tích điểm (mua X tích điểm, đủ thì đổi quà)
 * - Xem tiến độ thẻ của khách hàng
 * - Gọi API: GET/POST /stamp-card/templates, GET /stamp-card/customers/:customerId, POST /stamp-card/:id/redeem
 *
 * Exports:
 * - StampCards: React functional component (default export)
 */
import { useEffect, useState, useCallback } from 'react';
import { Table, Button, Space, Tag, Modal, Form, Input, InputNumber, Select, Progress, Popconfirm } from 'antd';
import { PlusOutlined, EditOutlined, SearchOutlined, GiftOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import axios from '../api/axios';
import PageHeader from '../components/layout/PageHeader';
import EmptyState from '../components/shared/EmptyState';
import useToast from '../components/shared/useToast';
import PermissionGate from '../components/shared/PermissionGate';

export default function StampCards() {
  const { t } = useTranslation();
  const toast = useToast();
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [products, setProducts] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [search, setSearch] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [cards, setCards] = useState([]);
  const [cardsLoading, setCardsLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  const loadTemplates = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get('/stamp-card/templates');
      setTemplates(Array.isArray(res.data) ? res.data : (res.data?.data || []));
    } catch {
      toast.error(t('stampCards.loadError'));
    } finally {
      setLoading(false);
    }
  }, [toast, t]);

  useEffect(() => { loadTemplates(); }, [loadTemplates]);

  const loadOptions = async () => {
    try {
      const [prodRes, custRes] = await Promise.all([
        axios.get('/products', { params: { limit: 200 } }),
        axios.get('/customers', { params: { limit: 200 } }),
      ]);
      setProducts(Array.isArray(prodRes.data) ? prodRes.data : (prodRes.data?.data || []));
      setCustomers(Array.isArray(custRes.data) ? custRes.data : (custRes.data?.data || []));
    } catch { /* optional */ }
  };

  useEffect(() => { loadOptions(); }, []);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ totalStamps: 10, isActive: true });
    setModalOpen(true);
  };

  const openEdit = (row) => {
    setEditing(row);
    form.setFieldsValue({ name: row.name, totalStamps: row.totalStamps, rewardProductId: row.rewardProductId, isActive: row.isActive });
    setModalOpen(true);
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      if (editing) {
        await axios.patch(`/stamp-card/templates/${editing.id}`, values);
      } else {
        await axios.post('/stamp-card/templates', values);
      }
      toast.success(t('stampCards.saveSuccess'));
      setModalOpen(false);
      loadTemplates();
    } catch (e) {
      if (e?.errorFields) return;
      toast.error(t('stampCards.saveError'));
    } finally {
      setSaving(false);
    }
  };

  const loadCustomerCards = async (customerId) => {
    setCardsLoading(true);
    setCards([]);
    try {
      const res = await axios.get(`/stamp-card/customers/${customerId}`);
      setCards(Array.isArray(res.data) ? res.data : (res.data?.data || []));
    } catch {
      toast.error(t('stampCards.cardsError'));
    } finally {
      setCardsLoading(false);
    }
  };

  const handleRedeem = async (card) => {
    try {
      await axios.post(`/stamp-card/${card.id}/redeem`);
      toast.success(t('stampCards.redeemSuccess'));
      if (selectedCustomer) loadCustomerCards(selectedCustomer);
    } catch {
      toast.error(t('stampCards.redeemError'));
    }
  };

  const templateColumns = [
    {
      title: t('stampCards.name'),
      dataIndex: 'name',
      width: 220,
      render: (v) => <b>{v}</b>,
    },
    {
      title: t('stampCards.totalStamps'),
      dataIndex: 'totalStamps',
      width: 120,
      align: 'right',
      render: (v) => v,
    },
    {
      title: t('stampCards.reward'),
      dataIndex: 'rewardProductId',
      width: 180,
      render: (v) => products.find((p) => p.id === v)?.name || '—',
    },
    {
      title: t('stampCards.cardsCount'),
      dataIndex: ['_count', 'stampCards'],
      width: 120,
      align: 'right',
      render: (v) => v ?? 0,
    },
    {
      title: t('common.status'),
      dataIndex: 'isActive',
      width: 110,
      render: (v) => (v ? <Tag color="green">Hoạt động</Tag> : <Tag>Ngừng</Tag>),
    },
    {
      title: '',
      width: 60,
      align: 'right',
      render: (_, row) => (
        <Button type="text" size="small" icon={<EditOutlined />} onClick={() => openEdit(row)} />
      ),
    },
  ];

  const cardColumns = [
    {
      title: t('stampCards.template'),
      dataIndex: ['template', 'name'],
      width: 180,
      render: (v) => v || '—',
    },
    {
      title: t('stampCards.progress'),
      width: 260,
      render: (_, row) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Progress
            percent={Math.round((row.stamps / row.totalStamps) * 100)}
            size="small"
            style={{ flex: 1, margin: 0 }}
          />
          <span style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{row.stamps}/{row.totalStamps}</span>
        </div>
      ),
    },
    {
      title: t('stampCards.reward'),
      dataIndex: 'rewardProductId',
      width: 160,
      render: (v) => products.find((p) => p.id === v)?.name || '—',
    },
    {
      title: t('stampCards.redeemedAt'),
      dataIndex: 'redeemedAt',
      width: 140,
      render: (v) => (v ? new Date(v).toLocaleDateString('vi-VN') : '—'),
    },
    {
      title: '',
      width: 110,
      align: 'right',
      render: (_, row) =>
        !row.redeemedAt && row.stamps >= row.totalStamps ? (
          <Popconfirm
            title={t('stampCards.redeemConfirm')}
            okText={t('common.confirm')}
            cancelText={t('common.cancel')}
            onConfirm={() => handleRedeem(row)}
          >
            <Button type="primary" size="small" icon={<GiftOutlined />}>
              {t('stampCards.redeem')}
            </Button>
          </Popconfirm>
        ) : row.redeemedAt ? (
          <Tag color="green">{t('stampCards.redeemed')}</Tag>
        ) : null,
    },
  ];

  const filteredCustomers = search
    ? customers.filter((c) => c.name?.toLowerCase().includes(search.toLowerCase()) || c.phone?.includes(search))
    : customers;

  return (
    <>
      <PageHeader
        title={t('stampCards.title')}
        subtitle={t('stampCards.subtitle')}
        actions={
          <PermissionGate permission="products.edit">
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              {t('stampCards.addTemplate')}
            </Button>
          </PermissionGate>
        }
      />

      <div className="table-card" style={{ marginBottom: 16 }}>
        <Table
          columns={templateColumns}
          dataSource={templates}
          rowKey="id"
          loading={loading}
          pagination={false}
          locale={{ emptyText: <EmptyState title={t('stampCards.empty')} description={t('stampCards.emptyDesc')} /> }}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '360px 1fr', gap: 16 }}>
        <div>
          <Input
            placeholder={t('stampCards.searchCustomer')}
            prefix={<SearchOutlined style={{ color: 'var(--text-muted)' }} />}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            allowClear
            style={{ marginBottom: 8 }}
          />
          <div className="table-card" style={{ maxHeight: 420, overflow: 'auto' }}>
            {filteredCustomers.map((c) => (
              <div
                key={c.id}
                onClick={() => { setSelectedCustomer(c.id); loadCustomerCards(c.id); }}
                style={{
                  padding: '10px 12px',
                  cursor: 'pointer',
                  borderBottom: '1px solid var(--border-color, #eee)',
                  background: selectedCustomer === c.id ? 'var(--bg-tertiary)' : 'transparent',
                }}
              >
                <div style={{ fontWeight: 500 }}>{c.name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{c.phone || ''}</div>
              </div>
            ))}
            {!filteredCustomers.length && (
              <div style={{ padding: 16, color: 'var(--text-muted)', textAlign: 'center' }}>
                {t('stampCards.noCustomers')}
              </div>
            )}
          </div>
        </div>
        <div className="table-card">
          <Table
            columns={cardColumns}
            dataSource={cards}
            rowKey="id"
            loading={cardsLoading}
            pagination={false}
            locale={{ emptyText: <EmptyState title={t('stampCards.pickCustomer')} description={t('stampCards.pickCustomerDesc')} /> }}
          />
        </div>
      </div>

      <Modal
        title={editing ? t('stampCards.editTemplate') : t('stampCards.addTemplate')}
        open={modalOpen}
        onOk={handleSave}
        onCancel={() => setModalOpen(false)}
        confirmLoading={saving}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label={t('stampCards.name')} rules={[{ required: true, message: t('stampCards.nameRequired') }]}>
            <Input />
          </Form.Item>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Form.Item name="totalStamps" label={t('stampCards.totalStamps')} rules={[{ required: true }]}>
              <InputNumber min={1} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="rewardProductId" label={t('stampCards.reward')}>
              <Select
                showSearch
                optionFilterProp="label"
                allowClear
                placeholder={t('stampCards.rewardPlaceholder')}
                options={products.map((p) => ({ value: p.id, label: p.name }))}
              />
            </Form.Item>
          </div>
          <Form.Item name="isActive" label={t('common.status')} valuePropName="checked">
            <Select
              options={[
                { value: true, label: t('common.active') },
                { value: false, label: t('common.inactive') },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
