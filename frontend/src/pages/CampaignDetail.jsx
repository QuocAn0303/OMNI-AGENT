import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Card, Tag, Button, Table, Space, Spin, Empty, Segmented, message,
} from 'antd';
import { ArrowLeftOutlined, SendOutlined, ReloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import axios from '../api/axios';
import PageHeader from '../components/layout/PageHeader';

const STATUS_META = {
  DRAFT: { label: 'Nháp', color: 'default' },
  SCHEDULED: { label: 'Đã đặt lịch', color: 'processing' },
  SENDING: { label: 'Đang gửi', color: 'warning' },
  SENT: { label: 'Đã gửi', color: 'success' },
  FAILED: { label: 'Thất bại', color: 'error' },
};

const RECIPIENT_META = {
  PENDING: { label: 'Chờ', color: 'default' },
  SENT: { label: 'Đã gửi', color: 'success' },
  FAILED: { label: 'Lỗi', color: 'error' },
  BOUNCED: { label: 'Bị từ chối', color: 'warning' },
};

export default function CampaignDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [campaign, setCampaign] = useState(null);
  const [recipients, setRecipients] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filterStatus, setFilterStatus] = useState();
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  const loadCampaign = async () => {
    try {
      const res = await axios.get(`/crm/campaigns/${id}`);
      setCampaign(res.data?.data || null);
    } catch {
      message.error('Không tải được chiến dịch');
    }
  };

  const loadRecipients = async () => {
    try {
      const params = { page, limit: 50 };
      if (filterStatus) params.status = filterStatus;
      const res = await axios.get(`/crm/campaigns/${id}/recipients`, { params });
      setRecipients(res.data?.data || []);
      setTotal(res.data?.pagination?.total || 0);
    } catch {
      /* ignore */
    }
  };

  const loadAll = async () => {
    setLoading(true);
    await Promise.all([loadCampaign(), loadRecipients()]);
    setLoading(false);
  };

  useEffect(() => { loadAll(); /* eslint-disable-next-line */ }, [id]);
  useEffect(() => { loadRecipients(); /* eslint-disable-next-line */ }, [page, filterStatus]);

  const sendNow = async () => {
    setSending(true);
    try {
      const res = await axios.post(`/crm/campaigns/${id}/send-now`);
      const s = res.data?.data || {};
      message.success(`Đã gửi: ${s.sent || 0}/${s.total || 0}${s.failed ? `, lỗi ${s.failed}` : ''}`);
      loadAll();
    } catch (e) {
      message.error(e.response?.data?.message || 'Gửi thất bại');
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return <div style={{ padding: 48, textAlign: 'center' }}><Spin size="large" /></div>;
  }
  if (!campaign) {
    return <Empty description="Không tìm thấy chiến dịch" />;
  }

  const stats = campaign.stats || {};
  const statusM = STATUS_META[campaign.status] || {};

  const columns = [
    { title: 'Khách hàng', dataIndex: ['customer', 'name'] },
    { title: 'Email', dataIndex: ['customer', 'email'], width: 220 },
    { title: 'Phone', dataIndex: ['customer', 'phone'], width: 140 },
    {
      title: 'Trạng thái', dataIndex: 'status', width: 110,
      render: (s) => { const m = RECIPIENT_META[s] || {}; return <Tag color={m.color}>{m.label || s}</Tag>; },
    },
    {
      title: 'Lúc', dataIndex: 'sentAt', width: 160,
      render: (d) => d ? dayjs(d).format('DD/MM HH:mm:ss') : '—',
    },
    { title: 'Lỗi', dataIndex: 'error', ellipsis: true },
  ];

  return (
    <>
      <PageHeader
        title={
          <Space>
            <Button icon={<ArrowLeftOutlined />} type="text" onClick={() => navigate('/crm/campaigns')} />
            {campaign.name}
          </Space>
        }
        subtitle={
          <Space>
            <Tag color={statusM.color}>{statusM.label || campaign.status}</Tag>
            <span>Kênh: {campaign.channel}</span>
            <span>Segment: {campaign.segment?.name}</span>
            {campaign.scheduledAt && <span>Lịch: {dayjs(campaign.scheduledAt).format('DD/MM/YYYY HH:mm')}</span>}
            {campaign.sentAt && <span>Gửi xong: {dayjs(campaign.sentAt).format('DD/MM/YYYY HH:mm')}</span>}
          </Space>
        }
        actions={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={loadAll}>Làm mới</Button>
            {['DRAFT', 'SCHEDULED', 'FAILED'].includes(campaign.status) && (
              <Button type="primary" icon={<SendOutlined />} loading={sending} onClick={sendNow}>
                Gửi ngay
              </Button>
            )}
          </Space>
        }
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 16 }}>
        <Card size="small">
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Tổng người nhận</div>
          <div style={{ fontSize: 22, fontWeight: 600 }}>{stats.total || total || 0}</div>
        </Card>
        <Card size="small">
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Đã gửi</div>
          <div style={{ fontSize: 22, fontWeight: 600, color: 'var(--success, #059669)' }}>{stats.sent || 0}</div>
        </Card>
        <Card size="small">
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Thất bại</div>
          <div style={{ fontSize: 22, fontWeight: 600, color: 'var(--error, #dc2626)' }}>{stats.failed || 0}</div>
        </Card>
      </div>

      <Card title="Nội dung gửi" style={{ marginBottom: 16 }}>
        {campaign.subject && (
          <div style={{ marginBottom: 8 }}><strong>Tiêu đề:</strong> {campaign.subject}</div>
        )}
        <pre style={{ background: '#f8fafc', padding: 12, borderRadius: 6, whiteSpace: 'pre-wrap', fontSize: 13 }}>
          {campaign.bodyTemplate}
        </pre>
      </Card>

      <Card title="Người nhận">
        <Segmented
          style={{ marginBottom: 12 }}
          value={filterStatus || 'ALL'}
          onChange={(v) => { setFilterStatus(v === 'ALL' ? undefined : v); setPage(1); }}
          options={[
            { value: 'ALL', label: 'Tất cả' },
            { value: 'PENDING', label: 'Chờ' },
            { value: 'SENT', label: 'Đã gửi' },
            { value: 'FAILED', label: 'Lỗi' },
          ]}
        />
        <Table
          columns={columns}
          dataSource={recipients}
          rowKey="id"
          size="small"
          pagination={{ current: page, pageSize: 50, total, showSizeChanger: false, onChange: (p) => setPage(p) }}
        />
      </Card>
    </>
  );
}
