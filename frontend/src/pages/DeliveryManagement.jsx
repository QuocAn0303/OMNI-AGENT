/**
 * Page: DeliveryManagement — Quản lý giao hàng
 *
 * Tổng quan:
 * - Danh sách đơn có giao hàng (lấy từ /orders với include delivery)
 * - Theo dõi vận đơn: track timeline (GET /delivery/:id/track)
 * - Cập nhật trạng thái + thêm sự kiện (PATCH /delivery/:id, POST /delivery/:id/events)
 * - Gọi API: GET /orders?status=..., GET /delivery/:id/track, PATCH /delivery/:id, POST /delivery/:id/events
 *
 * Exports:
 * - DeliveryManagement: React functional component (default export)
 */
import { useEffect, useState, useCallback } from 'react';
import { Table, Button, Space, Select, Modal, Form, Input, InputNumber, Tag, Timeline } from 'antd';
import { SearchOutlined, SyncOutlined, SendOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import axios from '../api/axios';
import PageHeader from '../components/layout/PageHeader';
import EmptyState from '../components/shared/EmptyState';
import useToast from '../components/shared/useToast';
import PermissionGate from '../components/shared/PermissionGate';
import MoneyDisplay from '../components/shared/MoneyDisplay';

const DELIVERY_STATUS = [
  'PENDING', 'PICKED_UP', 'IN_TRANSIT', 'DELIVERED', 'FAILED', 'RETURNED',
];

const STATUS_COLOR = {
  PENDING: 'orange',
  PICKED_UP: 'blue',
  IN_TRANSIT: 'cyan',
  DELIVERED: 'green',
  FAILED: 'red',
  RETURNED: 'magenta',
};

export default function DeliveryManagement() {
  const { t } = useTranslation();
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState([]);
  const [statusFilter, setStatusFilter] = useState(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detail, setDetail] = useState(null);
  const [track, setTrack] = useState(null);
  const [trackLoading, setTrackLoading] = useState(false);
  const [updateOpen, setUpdateOpen] = useState(false);
  const [updating, setUpdating] = useState(null);
  const [saving, setSaving] = useState(false);
  const [eventOpen, setEventOpen] = useState(false);
  const [eventSaving, setEventSaving] = useState(false);
  const [form] = Form.useForm();
  const [eventForm] = Form.useForm();

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get('/orders', {
        params: { page, limit: 20, status: statusFilter || undefined, search: search || undefined },
      });
      let list = res.data?.data || [];
      list = list.filter((o) => o.delivery);
      if (search) {
        const q = search.toLowerCase();
        list = list.filter((o) =>
          o.orderCode?.toLowerCase().includes(q) ||
          o.delivery?.trackingCode?.toLowerCase().includes(q) ||
          o.customer?.name?.toLowerCase().includes(q) ||
          o.customer?.phone?.includes(q),
        );
      }
      setData(list);
      setTotal(res.data?.pagination?.total || 0);
    } catch {
      toast.error(t('delivery.loadError'));
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, search, toast, t]);

  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => { setPage(1); }, [statusFilter]);

  const openDetail = async (order) => {
    setDetail(order);
    setDetailOpen(true);
    setTrackLoading(true);
    setTrack(null);
    try {
      const res = await axios.get(`/delivery/${order.delivery.id}/track`);
      setTrack(res.data?.data || null);
    } catch {
      toast.error(t('delivery.trackError'));
    } finally {
      setTrackLoading(false);
    }
  };

  const openUpdate = (order) => {
    setUpdating(order);
    form.resetFields();
    form.setFieldsValue({
      status: order.delivery?.status,
      trackingCode: order.delivery?.trackingCode,
      shippingFee: order.delivery?.shippingFee ?? 0,
    });
    setUpdateOpen(true);
  };

  const handleUpdate = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      await axios.patch(`/delivery/${updating.delivery.id}`, values);
      toast.success(t('delivery.updateSuccess'));
      setUpdateOpen(false);
      loadData();
    } catch (e) {
      if (e?.errorFields) return;
      toast.error(t('delivery.updateError'));
    } finally {
      setSaving(false);
    }
  };

  const openAddEvent = (order) => {
    setUpdating(order);
    eventForm.resetFields();
    eventForm.setFieldsValue({ status: order.delivery?.status });
    setEventOpen(true);
  };

  const handleAddEvent = async () => {
    try {
      const values = await eventForm.validateFields();
      setEventSaving(true);
      await axios.post(`/delivery/${updating.delivery.id}/events`, values);
      toast.success(t('delivery.eventSuccess'));
      setEventOpen(false);
      loadData();
    } catch (e) {
      if (e?.errorFields) return;
      toast.error(t('delivery.eventError'));
    } finally {
      setEventSaving(false);
    }
  };

  const columns = [
    {
      title: t('delivery.order'),
      dataIndex: 'orderCode',
      width: 170,
      render: (v, row) => (
        <div>
          <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 500 }}>{v}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{row.customer?.name || '—'}</div>
        </div>
      ),
    },
    {
      title: t('delivery.provider'),
      dataIndex: ['delivery', 'provider'],
      width: 120,
      render: (v) => v || '—',
    },
    {
      title: t('delivery.trackingCode'),
      dataIndex: ['delivery', 'trackingCode'],
      width: 150,
      render: (v) => v ? <span style={{ fontFamily: 'var(--font-mono)' }}>{v}</span> : '—',
    },
    {
      title: t('delivery.recipient'),
      width: 200,
      render: (_, row) => {
        const d = row.delivery;
        return d ? (
          <div>
            <div>{d.recipientName || '—'}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{d.recipientPhone}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {d.recipientAddress}
            </div>
          </div>
        ) : '—';
      },
    },
    {
      title: t('delivery.status'),
      dataIndex: ['delivery', 'status'],
      width: 120,
      render: (v) => <Tag color={STATUS_COLOR[v] || 'default'}>{v || '—'}</Tag>,
    },
    {
      title: t('delivery.shippingFee'),
      dataIndex: ['delivery', 'shippingFee'],
      width: 130,
      align: 'right',
      render: (v) => <MoneyDisplay value={v ?? 0} />,
    },
    {
      title: t('common.actions'),
      width: 160,
      align: 'right',
      fixed: 'right',
      render: (_, row) => (
        <Space size={4}>
          <PermissionGate permission="orders.edit">
            <Button type="text" size="small" icon={<SyncOutlined />} onClick={() => openUpdate(row)} />
          </PermissionGate>
          <PermissionGate permission="orders.edit">
            <Button type="text" size="small" icon={<SendOutlined />} onClick={() => openAddEvent(row)} />
          </PermissionGate>
          <Button type="link" size="small" onClick={() => openDetail(row)}>
            {t('delivery.track')}
          </Button>
        </Space>
      ),
    },
  ];

  const trackEvents = track?.events || [];

  return (
    <>
      <PageHeader
        title={t('delivery.title')}
        subtitle={t('delivery.count', { count: data.length })}
      />

      <div className="filters-bar">
        <Input
          className="filters-bar__search"
          placeholder={t('delivery.searchPlaceholder')}
          prefix={<SearchOutlined style={{ color: 'var(--text-muted)' }} />}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          allowClear
        />
        <Select
          placeholder={t('delivery.status')}
          style={{ width: 180 }}
          value={statusFilter}
          onChange={setStatusFilter}
          allowClear
          options={DELIVERY_STATUS.map((s) => ({ value: s, label: s }))}
        />
      </div>

      <div className="table-card">
        <Table
          columns={columns}
          dataSource={data}
          rowKey="id"
          loading={loading}
          scroll={{ x: 1100 }}
          pagination={{
            current: page,
            pageSize: 20,
            total,
            showSizeChanger: false,
            onChange: (p) => setPage(p),
            showTotal: (totalCount) => t('delivery.count', { count: totalCount }),
          }}
          locale={{ emptyText: <EmptyState title={t('delivery.empty')} description={t('delivery.emptyDesc')} /> }}
        />
      </div>

      <Modal
        title={t('delivery.trackTitle')}
        open={detailOpen}
        onCancel={() => setDetailOpen(false)}
        footer={null}
        width={560}
      >
        {detail && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontWeight: 500 }}>{detail.orderCode}</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              {t('delivery.provider')}: {detail.delivery?.provider || '—'} · {t('delivery.trackingCode')}: {detail.delivery?.trackingCode || '—'}
            </div>
            <Tag color={STATUS_COLOR[detail.delivery?.status] || 'default'} style={{ marginTop: 8 }}>
              {detail.delivery?.status}
            </Tag>
          </div>
        )}
        <Timeline
          loading={trackLoading}
          items={(trackEvents || []).map((ev) => ({
            color: ev.status === 'DELIVERED' ? 'green' : ev.status === 'FAILED' ? 'red' : 'blue',
            children: (
              <div>
                <div>
                  <Tag color={STATUS_COLOR[ev.status] || 'default'}>{ev.status}</Tag>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {new Date(ev.occurredAt).toLocaleString('vi-VN')}
                  </span>
                </div>
                {ev.note && <div style={{ fontSize: 13 }}>{ev.note}</div>}
                {ev.location && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{ev.location}</div>}
              </div>
            ),
          }))}
        />
      </Modal>

      <Modal
        title={t('delivery.updateTitle')}
        open={updateOpen}
        onOk={handleUpdate}
        onCancel={() => setUpdateOpen(false)}
        confirmLoading={saving}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item name="status" label={t('delivery.status')} rules={[{ required: true }]}>
            <Select options={DELIVERY_STATUS.map((s) => ({ value: s, label: s }))} />
          </Form.Item>
          <Form.Item name="trackingCode" label={t('delivery.trackingCode')}>
            <Input />
          </Form.Item>
          <Form.Item name="shippingFee" label={t('delivery.shippingFee')}>
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={t('delivery.eventTitle')}
        open={eventOpen}
        onOk={handleAddEvent}
        onCancel={() => setEventOpen(false)}
        confirmLoading={eventSaving}
        destroyOnClose
      >
        <Form form={eventForm} layout="vertical">
          <Form.Item name="status" label={t('delivery.status')} rules={[{ required: true }]}>
            <Select options={DELIVERY_STATUS.map((s) => ({ value: s, label: s }))} />
          </Form.Item>
          <Form.Item name="note" label={t('delivery.eventNote')}>
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name="location" label={t('delivery.eventLocation')}>
            <Input />
          </Form.Item>
          <Form.Item name="occurredAt" label={t('delivery.eventTime')}>
            <Input placeholder="ISO: 2026-08-01T10:00:00.000Z" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
