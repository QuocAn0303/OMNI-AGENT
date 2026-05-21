import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Table, Button, Tag, Modal, Form, Input, Select, DatePicker, Steps,
  message, Space, Popconfirm, Alert,
} from 'antd';
import {
  PlusOutlined, MailOutlined, MessageOutlined,
  SendOutlined, DeleteOutlined, EyeOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import axios from '../api/axios';
import PageHeader from '../components/layout/PageHeader';
import EmptyState from '../components/shared/EmptyState';

const STATUS_META = {
  DRAFT: { label: 'Nháp', color: 'default' },
  SCHEDULED: { label: 'Đã đặt lịch', color: 'processing' },
  SENDING: { label: 'Đang gửi', color: 'warning' },
  SENT: { label: 'Đã gửi', color: 'success' },
  FAILED: { label: 'Thất bại', color: 'error' },
};

const CHANNEL_META = {
  EMAIL: { label: 'Email', icon: <MailOutlined /> },
  ZALO: { label: 'Zalo OA', icon: <MessageOutlined /> },
};

const DEFAULT_TEMPLATE = `Chào {{name}},

Cảm ơn anh/chị đã đồng hành cùng chúng tôi.
Hiện tại anh/chị đang ở hạng {{tier}} với {{points}} điểm thưởng.

Trân trọng.`;

export default function Campaigns() {
  const navigate = useNavigate();
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [segments, setSegments] = useState([]);

  const [modalOpen, setModalOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({
    name: '',
    channel: 'EMAIL',
    segmentId: undefined,
    subject: '',
    bodyTemplate: DEFAULT_TEMPLATE,
    scheduledAt: null,
    sendMode: 'now', // now | schedule
  });

  const loadAll = async () => {
    setLoading(true);
    try {
      const [resC, resS] = await Promise.all([
        axios.get('/crm/campaigns'),
        axios.get('/crm/segments'),
      ]);
      setList(resC.data?.data || []);
      setSegments(resS.data?.data || []);
    } catch {
      message.error('Không tải được dữ liệu');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadAll(); }, []);

  const openModal = () => {
    setStep(0);
    setForm({
      name: '',
      channel: 'EMAIL',
      segmentId: undefined,
      subject: '',
      bodyTemplate: DEFAULT_TEMPLATE,
      scheduledAt: null,
      sendMode: 'now',
    });
    setModalOpen(true);
  };

  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const segmentPicked = segments.find((s) => s.id === form.segmentId);

  const renderPreview = () => {
    const sample = { name: 'Nguyễn Văn A', tier: 'GOLD', points: 1200, totalSpent: 5000000 };
    return form.bodyTemplate.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => sample[k] ?? `{{${k}}}`);
  };

  const validateStep = () => {
    if (step === 0) {
      if (!form.name.trim()) return 'Nhập tên chiến dịch';
      if (!form.segmentId) return 'Chọn segment';
      if (!form.channel) return 'Chọn kênh';
    }
    if (step === 1) {
      if (form.channel === 'EMAIL' && !form.subject.trim()) return 'Nhập tiêu đề email';
      if (!form.bodyTemplate.trim()) return 'Nhập nội dung';
    }
    if (step === 2) {
      if (form.sendMode === 'schedule' && !form.scheduledAt) return 'Chọn thời điểm gửi';
    }
    return null;
  };

  const next = () => {
    const err = validateStep();
    if (err) { message.warning(err); return; }
    setStep((s) => Math.min(2, s + 1));
  };

  const submit = async () => {
    const err = validateStep();
    if (err) { message.warning(err); return; }

    const payload = {
      name: form.name.trim(),
      channel: form.channel,
      segmentId: form.segmentId,
      subject: form.channel === 'EMAIL' ? form.subject.trim() : undefined,
      bodyTemplate: form.bodyTemplate,
      scheduledAt: form.sendMode === 'schedule' && form.scheduledAt ? form.scheduledAt.toISOString() : null,
    };

    try {
      const res = await axios.post('/crm/campaigns', payload);
      const id = res.data?.data?.id;
      if (form.sendMode === 'now' && id) {
        message.loading('Đang gửi...', 0);
        try {
          const sendRes = await axios.post(`/crm/campaigns/${id}/send-now`);
          message.destroy();
          const s = sendRes.data?.data || {};
          message.success(`Đã gửi: ${s.sent || 0}/${s.total || 0}${s.failed ? `, lỗi ${s.failed}` : ''}`);
        } catch (sendErr) {
          message.destroy();
          message.error(sendErr.response?.data?.message || 'Gửi thất bại');
        }
      } else {
        message.success('Đã lưu chiến dịch');
      }
      setModalOpen(false);
      loadAll();
    } catch (e) {
      message.error(e.response?.data?.message || 'Lưu thất bại');
    }
  };

  const sendNow = (id) => {
    Modal.confirm({
      title: 'Gửi ngay?',
      content: 'Hệ thống sẽ gửi tới toàn bộ khách hàng trong segment.',
      okText: 'Gửi', cancelText: 'Hủy',
      onOk: async () => {
        try {
          const res = await axios.post(`/crm/campaigns/${id}/send-now`);
          const s = res.data?.data || {};
          message.success(`Đã gửi: ${s.sent || 0}/${s.total || 0}${s.failed ? `, lỗi ${s.failed}` : ''}`);
          loadAll();
        } catch (e) {
          message.error(e.response?.data?.message || 'Gửi thất bại');
        }
      },
    });
  };

  const remove = async (id) => {
    try {
      await axios.delete(`/crm/campaigns/${id}`);
      message.success('Đã xóa');
      loadAll();
    } catch (e) {
      message.error(e.response?.data?.message || 'Xóa thất bại');
    }
  };

  const columns = [
    { title: 'Tên chiến dịch', dataIndex: 'name' },
    {
      title: 'Kênh', dataIndex: 'channel', width: 110,
      render: (c) => <Tag>{CHANNEL_META[c]?.icon} {CHANNEL_META[c]?.label || c}</Tag>,
    },
    {
      title: 'Segment', dataIndex: ['segment', 'name'], width: 200,
      render: (n, row) => <span>{n} <Tag>{row.segment?.customerCount || 0} KH</Tag></span>,
    },
    {
      title: 'Trạng thái', dataIndex: 'status', width: 130,
      render: (s) => { const m = STATUS_META[s] || {}; return <Tag color={m.color}>{m.label || s}</Tag>; },
    },
    {
      title: 'Lịch gửi', dataIndex: 'scheduledAt', width: 160,
      render: (d) => d ? dayjs(d).format('DD/MM/YYYY HH:mm') : '—',
    },
    {
      title: 'Đã gửi', width: 110, align: 'right',
      render: (_, r) => {
        const s = r.stats || {};
        if (!s.total) return '—';
        return `${s.sent || 0}/${s.total} ${s.failed ? `(lỗi ${s.failed})` : ''}`;
      },
    },
    {
      title: '', width: 150, align: 'right', fixed: 'right',
      render: (_, row) => (
        <Space size={0}>
          <Button size="small" type="text" icon={<EyeOutlined />} onClick={() => navigate(`/crm/campaigns/${row.id}`)} />
          {['DRAFT', 'SCHEDULED'].includes(row.status) && (
            <Button size="small" type="text" icon={<SendOutlined />} title="Gửi ngay" onClick={() => sendNow(row.id)} />
          )}
          {row.status !== 'SENDING' && (
            <Popconfirm title="Xóa chiến dịch?" onConfirm={() => remove(row.id)} okText="Xóa" cancelText="Hủy">
              <Button size="small" type="text" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Chiến dịch CSKH"
        subtitle={`${list.length} chiến dịch`}
        actions={
          <Button type="primary" icon={<PlusOutlined />} onClick={openModal}>
            Tạo chiến dịch
          </Button>
        }
      />

      <div className="table-card">
        <Table
          columns={columns}
          dataSource={list}
          rowKey="id"
          loading={loading}
          scroll={{ x: 1100 }}
          locale={{
            emptyText: (
              <EmptyState
                title="Chưa có chiến dịch"
                action={<Button type="primary" icon={<PlusOutlined />} onClick={openModal}>Tạo chiến dịch đầu tiên</Button>}
              />
            ),
          }}
        />
      </div>

      <Modal
        title="Tạo chiến dịch CSKH"
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        width={720}
        footer={
          <Space>
            {step > 0 && <Button onClick={() => setStep((s) => s - 1)}>Quay lại</Button>}
            {step < 2 ? (
              <Button type="primary" onClick={next}>Tiếp tục</Button>
            ) : (
              <Button type="primary" onClick={submit}>
                {form.sendMode === 'now' ? 'Gửi ngay' : 'Đặt lịch'}
              </Button>
            )}
          </Space>
        }
      >
        <Steps
          current={step}
          size="small"
          style={{ marginBottom: 24 }}
          items={[
            { title: 'Đối tượng & kênh' },
            { title: 'Nội dung' },
            { title: 'Lịch gửi' },
          ]}
        />

        {step === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Input
              placeholder="Tên chiến dịch *"
              value={form.name}
              onChange={(e) => setField('name', e.target.value)}
            />
            <Select
              placeholder="Chọn segment *"
              value={form.segmentId}
              onChange={(v) => setField('segmentId', v)}
              options={segments.map((s) => ({
                value: s.id,
                label: `${s.name} (${s.customerCount} KH)`,
              }))}
            />
            <Select
              placeholder="Kênh gửi *"
              value={form.channel}
              onChange={(v) => setField('channel', v)}
              options={[
                { value: 'EMAIL', label: 'Email (SMTP)' },
                { value: 'ZALO', label: 'Zalo OA' },
              ]}
            />
            {form.channel === 'ZALO' && (
              <Alert
                type="info"
                showIcon
                message="Lưu ý Zalo OA"
                description="Hiện chưa lưu Zalo user_id của khách hàng. Sẽ thử dùng phone — chỉ hoạt động nếu phone trùng với Zalo user_id. Cần đăng ký template CSKH với Zalo."
              />
            )}
          </div>
        )}

        {step === 1 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {form.channel === 'EMAIL' && (
              <Input
                placeholder="Tiêu đề email *"
                value={form.subject}
                onChange={(e) => setField('subject', e.target.value)}
              />
            )}
            <Input.TextArea
              placeholder="Nội dung tin nhắn *"
              rows={8}
              value={form.bodyTemplate}
              onChange={(e) => setField('bodyTemplate', e.target.value)}
            />
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Biến: <code>{'{{name}}'}</code>, <code>{'{{tier}}'}</code>, <code>{'{{points}}'}</code>, <code>{'{{totalSpent}}'}</code>, <code>{'{{email}}'}</code>, <code>{'{{phone}}'}</code>
            </div>
            <div>
              <div style={{ fontWeight: 500, marginBottom: 4 }}>Xem trước (với KH mẫu):</div>
              <pre style={{ background: '#f8fafc', padding: 12, borderRadius: 6, whiteSpace: 'pre-wrap', fontSize: 13 }}>
                {renderPreview()}
              </pre>
            </div>
          </div>
        )}

        {step === 2 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {segmentPicked && (
              <Alert
                type="info"
                message={`Sẽ gửi tới ${segmentPicked.customerCount} khách hàng trong segment "${segmentPicked.name}"`}
              />
            )}
            <Select
              value={form.sendMode}
              onChange={(v) => setField('sendMode', v)}
              options={[
                { value: 'now', label: 'Gửi ngay' },
                { value: 'schedule', label: 'Hẹn giờ' },
              ]}
            />
            {form.sendMode === 'schedule' && (
              <DatePicker
                showTime
                style={{ width: '100%' }}
                format="DD/MM/YYYY HH:mm"
                value={form.scheduledAt}
                onChange={(d) => setField('scheduledAt', d)}
                disabledDate={(d) => d && d.isBefore(dayjs().startOf('minute'))}
              />
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
