/**
 * Frontend: src/pages/fnb/OrderInbox.jsx — Hộp đơn đa kênh (GrabFood/ShopeeFood/BeFood/GoFood)
 *
 * Gộp đơn từ các aggregator → 1 queue. Staff duyệt (accept) → tạo Order + gửi bếp,
 * hoặc reject. Webhook URL hiển thị để đăng ký với từng aggregator.
 */
import { useState, useEffect, useCallback } from 'react';
import { Card, Table, Tag, Button, Space, Select, message, Spin, Empty, Alert, Typography, Tooltip } from 'antd';
import { InboxOutlined, ReloadOutlined, CheckOutlined, CloseOutlined, CopyOutlined } from '@ant-design/icons';
import api from '../../api/axios';

const { Text } = Typography;

const PROVIDERS = [
  { value: 'GRABFOOD', label: 'GrabFood' },
  { value: 'SHOPEEFOOD', label: 'ShopeeFood' },
  { value: 'BEFOOD', label: 'BeFood' },
  { value: 'GO_FOOD', label: 'GoFood' },
];
const PROVIDER_COLOR = { GRABFOOD: 'green', SHOPEEFOOD: 'orange', BEFOOD: 'blue', GO_FOOD: 'purple' };
const STATUS_META = {
  NEW: { color: 'processing', label: 'Mới' },
  ACCEPTED: { color: 'success', label: 'Đã nhận' },
  REJECTED: { color: 'error', label: 'Từ chối' },
  PREPARING: { color: 'warning', label: 'Đang chế biến' },
};

const webhookBase = () => {
  const base = api.defaults.baseURL || '/api';
  return `${window.location.origin}${base.replace(/\/$/, '')}/food-delivery/webhook`;
};

export default function OrderInbox() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({ provider: '', status: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filter.provider) params.append('provider', filter.provider);
      if (filter.status) params.append('status', filter.status);
      const res = await api.get(`/food-delivery?${params.toString()}`);
      setOrders(res.data?.data || []);
    } catch {
      message.error('Không tải được đơn');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const handleAccept = async (id) => {
    try {
      await api.post(`/food-delivery/${id}/accept`);
      message.success('Đã nhận đơn — gửi bếp');
      load();
    } catch (err) {
      message.error(err.response?.data?.message || 'Lỗi');
    }
  };

  const handleReject = async (id) => {
    try {
      await api.post(`/food-delivery/${id}/reject`);
      message.success('Đã từ chối đơn');
      load();
    } catch {
      message.error('Lỗi');
    }
  };

  const copyWebhook = async (url) => {
    try {
      await navigator.clipboard.writeText(url);
      message.success('Đã copy webhook URL');
    } catch {
      message.error('Không copy được');
    }
  };

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>
          <InboxOutlined style={{ marginRight: 8, color: 'var(--primary)' }} />
          Hộp đơn đa kênh
        </h2>
        <Space>
          <Select
            allowClear
            placeholder="Nhà cung cấp"
            style={{ width: 150 }}
            value={filter.provider || undefined}
            onChange={(v) => setFilter({ ...filter, provider: v || '' })}
            options={PROVIDERS}
          />
          <Select
            allowClear
            placeholder="Trạng thái"
            style={{ width: 130 }}
            value={filter.status || undefined}
            onChange={(v) => setFilter({ ...filter, status: v || '' })}
            options={Object.entries(STATUS_META).map(([value, m]) => ({ value, label: m.label }))}
          />
          <Button icon={<ReloadOutlined />} onClick={load} />
        </Space>
      </div>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="Đăng ký webhook để nhận đơn tự động"
        description={
          <Space direction="vertical" size={6}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              Dán các URL dưới đây vào phần "Webhook/API" trong cửa sổ quản lý của từng app giao đồ ăn để đơn tự động vào hộp này:
            </Text>
            {PROVIDERS.map((p) => {
              const url = `${webhookBase()}/${p.value}`;
              return (
                <Space key={p.value} size={6}>
                  <Tag color={PROVIDER_COLOR[p.value]} style={{ width: 110, textAlign: 'center', margin: 0 }}>{p.label}</Tag>
                  <Text code style={{ fontSize: 12 }}>{url}</Text>
                  <Tooltip title="Copy">
                    <Button size="small" icon={<CopyOutlined />} onClick={() => copyWebhook(url)} />
                  </Tooltip>
                </Space>
              );
            })}
          </Space>
        }
      />

      <Card>
        {loading ? (
          <Spin style={{ display: 'flex', justifyContent: 'center', padding: 40 }} />
        ) : orders.length === 0 ? (
          <Empty description="Không có đơn nào" />
        ) : (
          <Table
            rowKey="id"
            dataSource={orders}
            pagination={{ pageSize: 15 }}
            columns={[
              {
                title: 'Kênh',
                dataIndex: 'provider',
                render: (p) => {
                  const label = PROVIDERS.find((x) => x.value === p)?.label || p;
                  return <Tag color={PROVIDER_COLOR[p] || 'default'}>{label}</Tag>;
                },
              },
              { title: 'Mã đơn NCC', dataIndex: 'providerOrderId' },
              {
                title: 'Khách',
                render: (_, r) => (
                  <div>
                    <div>{r.customerName}</div>
                    <div style={{ fontSize: 11, color: '#6b7280' }}>{r.customerPhone}</div>
                  </div>
                ),
              },
              {
                title: 'Tổng',
                dataIndex: 'total',
                render: (v) => Number(v || 0).toLocaleString('vi-VN') + '₫',
              },
              {
                title: 'Trạng thái',
                dataIndex: 'status',
                render: (s) => {
                  const m = STATUS_META[s] || { color: 'default', label: s };
                  return <Tag color={m.color}>{m.label}</Tag>;
                },
              },
              {
                title: 'Hành động',
                render: (_, r) => r.status === 'NEW' ? (
                  <Space>
                    <Button size="small" type="primary" icon={<CheckOutlined />} onClick={() => handleAccept(r.id)}>Nhận</Button>
                    <Button size="small" danger icon={<CloseOutlined />} onClick={() => handleReject(r.id)}>Từ chối</Button>
                  </Space>
                ) : <span style={{ color: '#94a3b8' }}>—</span>,
              },
            ]}
          />
        )}
      </Card>
    </div>
  );
}
