import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Tabs, Card, Avatar, Tag, Button, Input, Select, Modal,
  Form, message, Timeline, Spin, Table, Empty, Popconfirm, Space,
  DatePicker,
} from 'antd';
import {
  ArrowLeftOutlined, PhoneOutlined, MailOutlined, EnvironmentOutlined,
  PlusOutlined, EditOutlined, DeleteOutlined, MessageOutlined,
  TagOutlined, CheckSquareOutlined, CheckCircleOutlined, ClockCircleOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import axios from '../api/axios';
import PageHeader from '../components/layout/PageHeader';
import MoneyDisplay from '../components/shared/MoneyDisplay';
import useAuthStore from '../stores/authStore';

const NOTE_TYPES = [
  { value: 'NOTE', label: 'Ghi chú', color: 'default' },
  { value: 'CALL', label: 'Gọi điện', color: 'blue' },
  { value: 'EMAIL', label: 'Email', color: 'green' },
  { value: 'MEETING', label: 'Gặp mặt', color: 'purple' },
  { value: 'ZALO', label: 'Zalo', color: 'cyan' },
];

const TIER_COLOR = {
  BRONZE: '#a16207',
  SILVER: '#64748b',
  GOLD: '#ca8a04',
  PLATINUM: '#0f766e',
};

const TASK_STATUS = [
  { value: 'PENDING', label: 'Chờ xử lý', color: 'default' },
  { value: 'IN_PROGRESS', label: 'Đang làm', color: 'processing' },
  { value: 'DONE', label: 'Hoàn thành', color: 'success' },
  { value: 'CANCELLED', label: 'Đã hủy', color: 'default' },
];
const TASK_PRIORITY = [
  { value: 'LOW', label: 'Thấp', color: 'default' },
  { value: 'NORMAL', label: 'Bình thường', color: 'blue' },
  { value: 'HIGH', label: 'Cao', color: 'red' },
];
const taskStatusMeta = (v) => TASK_STATUS.find((s) => s.value === v) || TASK_STATUS[0];
const taskPriorityMeta = (v) => TASK_PRIORITY.find((p) => p.value === v) || TASK_PRIORITY[1];

const AVATAR_COLORS = ['#0f766e', '#0891b2', '#7c3aed', '#db2777', '#d97706'];
const getColor = (id) => {
  if (!id || typeof id !== 'string') return AVATAR_COLORS[0];
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
};

export default function CustomerDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const currentUser = useAuthStore((s) => s.user);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [allTags, setAllTags] = useState([]);

  const [noteModalOpen, setNoteModalOpen] = useState(false);
  const [editingNote, setEditingNote] = useState(null);
  const [noteForm] = Form.useForm();

  const [tagModalOpen, setTagModalOpen] = useState(false);

  const [tasks, setTasks] = useState([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [users, setUsers] = useState([]);
  const [taskModalOpen, setTaskModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const [taskForm] = Form.useForm();

  const loadTasks = async () => {
    setTasksLoading(true);
    try {
      const res = await axios.get('/crm/tasks', { params: { customerId: id, limit: 50 } });
      setTasks(res.data?.data || []);
    } catch {
      /* ignore */
    } finally {
      setTasksLoading(false);
    }
  };

  const load = async () => {
    setLoading(true);
    try {
      const [resFull, resTags, resUsers] = await Promise.all([
        axios.get(`/customers/${id}/full`),
        axios.get('/crm/tags'),
        axios.get('/crm/tasks/assignable-users'),
      ]);
      setData(resFull.data?.data || null);
      setAllTags(resTags.data?.data || []);
      setUsers(resUsers.data?.data || []);
      await loadTasks();
    } catch (err) {
      message.error('Không tải được thông tin khách hàng');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [id]);

  const openNoteModal = (note = null) => {
    setEditingNote(note);
    noteForm.setFieldsValue(note || { type: 'NOTE', content: '' });
    setNoteModalOpen(true);
  };

  const saveNote = async () => {
    try {
      const values = await noteForm.validateFields();
      if (editingNote) {
        await axios.put(`/crm/notes/${editingNote.id}`, values);
        message.success('Đã cập nhật ghi chú');
      } else {
        await axios.post(`/crm/notes/customer/${id}`, values);
        message.success('Đã thêm ghi chú');
      }
      setNoteModalOpen(false);
      load();
    } catch (err) {
      if (err.errorFields) return;
      message.error('Lưu ghi chú thất bại');
    }
  };

  const deleteNote = async (noteId) => {
    try {
      await axios.delete(`/crm/notes/${noteId}`);
      message.success('Đã xóa ghi chú');
      load();
    } catch {
      message.error('Xóa thất bại');
    }
  };

  const assignTag = async (tagId) => {
    try {
      await axios.post(`/crm/tags/customer/${id}/assign/${tagId}`);
      load();
    } catch {
      message.error('Gắn tag thất bại');
    }
  };

  const unassignTag = async (tagId) => {
    try {
      await axios.delete(`/crm/tags/customer/${id}/unassign/${tagId}`);
      load();
    } catch {
      message.error('Gỡ tag thất bại');
    }
  };

  const openTaskModal = (task = null) => {
    setEditingTask(task);
    if (task) {
      taskForm.setFieldsValue({
        title: task.title,
        description: task.description,
        status: task.status,
        priority: task.priority,
        dueAt: task.dueAt ? dayjs(task.dueAt) : null,
        assignedToId: task.assignedTo?.id,
      });
    } else {
      taskForm.setFieldsValue({
        priority: 'NORMAL',
        status: 'PENDING',
        assignedToId: currentUser?.id,
      });
    }
    setTaskModalOpen(true);
  };

  const saveTask = async () => {
    try {
      const values = await taskForm.validateFields();
      const payload = {
        ...values,
        customerId: id,
        dueAt: values.dueAt ? values.dueAt.toISOString() : null,
      };
      if (editingTask) {
        await axios.patch(`/crm/tasks/${editingTask.id}`, payload);
        message.success('Đã cập nhật');
      } else {
        await axios.post('/crm/tasks', payload);
        message.success('Đã tạo nhiệm vụ');
      }
      setTaskModalOpen(false);
      loadTasks();
    } catch (err) {
      if (err.errorFields) return;
      message.error(err.response?.data?.message || 'Lưu thất bại');
    }
  };

  const completeTask = async (taskId) => {
    try {
      await axios.patch(`/crm/tasks/${taskId}`, { status: 'DONE' });
      message.success('Đã hoàn thành');
      loadTasks();
    } catch {
      message.error('Cập nhật thất bại');
    }
  };

  const deleteTask = async (taskId) => {
    try {
      await axios.delete(`/crm/tasks/${taskId}`);
      message.success('Đã xóa');
      loadTasks();
    } catch (err) {
      message.error(err.response?.data?.message || 'Xóa thất bại');
    }
  };

  if (loading) {
    return <div style={{ padding: 48, textAlign: 'center' }}><Spin size="large" /></div>;
  }
  if (!data) {
    return <Empty description="Không tìm thấy khách hàng" />;
  }

  const { customer, recentOrders, debts, loyaltyTxs, notes, tags, rfm } = data;
  const assignedTagIds = new Set(tags.map((t) => t.id));
  const availableTags = allTags.filter((t) => !assignedTagIds.has(t.id));

  const orderColumns = [
    { title: 'Mã đơn', dataIndex: 'orderCode', width: 140 },
    {
      title: 'Trạng thái',
      dataIndex: 'status',
      width: 120,
      render: (s) => <Tag>{s}</Tag>,
    },
    {
      title: 'Thanh toán',
      dataIndex: 'paymentStatus',
      width: 120,
      render: (s) => <Tag color={s === 'PAID' ? 'green' : s === 'UNPAID' ? 'red' : 'orange'}>{s}</Tag>,
    },
    {
      title: 'Tổng tiền',
      dataIndex: 'total',
      align: 'right',
      render: (v) => <MoneyDisplay value={v} />,
    },
    {
      title: 'Ngày',
      dataIndex: 'createdAt',
      width: 140,
      render: (d) => dayjs(d).format('DD/MM/YYYY HH:mm'),
    },
  ];

  const debtColumns = [
    {
      title: 'Số tiền',
      dataIndex: 'amount',
      render: (v) => <MoneyDisplay value={v} />,
    },
    {
      title: 'Đã trả',
      dataIndex: 'paidAmount',
      render: (v) => <MoneyDisplay value={v} />,
    },
    {
      title: 'Còn lại',
      render: (_, row) => (
        <MoneyDisplay value={Number(row.amount) - Number(row.paidAmount)} />
      ),
    },
    {
      title: 'Trạng thái',
      dataIndex: 'status',
      render: (s) => <Tag color={s === 'PAID' ? 'green' : 'orange'}>{s}</Tag>,
    },
    {
      title: 'Hạn',
      dataIndex: 'dueDate',
      render: (d) => d ? dayjs(d).format('DD/MM/YYYY') : '—',
    },
  ];

  const taskColumns = [
    {
      title: 'Tiêu đề',
      dataIndex: 'title',
      render: (t, row) => (
        <div>
          <div style={{ fontWeight: 500 }}>{t}</div>
          {row.description && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{row.description}</div>
          )}
        </div>
      ),
    },
    {
      title: 'Trạng thái', dataIndex: 'status', width: 130,
      render: (v) => { const m = taskStatusMeta(v); return <Tag color={m.color}>{m.label}</Tag>; },
    },
    {
      title: 'Ưu tiên', dataIndex: 'priority', width: 110,
      render: (v) => { const m = taskPriorityMeta(v); return <Tag color={m.color}>{m.label}</Tag>; },
    },
    {
      title: 'Giao cho', width: 140,
      render: (_, row) => row.assignedTo?.fullName || '—',
    },
    {
      title: 'Hạn', dataIndex: 'dueAt', width: 140,
      render: (d, row) => {
        if (!d) return <span style={{ color: 'var(--text-muted)' }}>—</span>;
        const overdue = dayjs(d).isBefore(dayjs()) && !['DONE', 'CANCELLED'].includes(row.status);
        return (
          <span style={{ color: overdue ? 'var(--error, #dc2626)' : undefined, fontWeight: overdue ? 600 : undefined }}>
            <ClockCircleOutlined /> {dayjs(d).format('DD/MM HH:mm')}
          </span>
        );
      },
    },
    {
      title: '', width: 130, align: 'right',
      render: (_, row) => (
        <Space size={0}>
          {row.status !== 'DONE' && (
            <Button size="small" type="text" icon={<CheckCircleOutlined />} onClick={() => completeTask(row.id)} />
          )}
          <Button size="small" type="text" icon={<EditOutlined />} onClick={() => openTaskModal(row)} />
          <Popconfirm title="Xóa?" onConfirm={() => deleteTask(row.id)} okText="Xóa" cancelText="Hủy">
            <Button size="small" type="text" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const loyaltyColumns = [
    {
      title: 'Loại',
      dataIndex: 'type',
      width: 110,
      render: (t) => <Tag>{t}</Tag>,
    },
    {
      title: 'Điểm',
      dataIndex: 'points',
      align: 'right',
      render: (p) => (
        <span style={{ color: p > 0 ? 'var(--success, #059669)' : 'var(--error, #dc2626)', fontWeight: 500 }}>
          {p > 0 ? '+' : ''}{p}
        </span>
      ),
    },
    { title: 'Ghi chú', dataIndex: 'note' },
    {
      title: 'Ngày',
      dataIndex: 'createdAt',
      width: 160,
      render: (d) => dayjs(d).format('DD/MM/YYYY HH:mm'),
    },
  ];

  return (
    <>
      <PageHeader
        title={
          <Space>
            <Button icon={<ArrowLeftOutlined />} type="text" onClick={() => navigate('/customers')} />
            {customer.name}
          </Space>
        }
        subtitle={
          <Space size={16}>
            {customer.phone && <span><PhoneOutlined /> {customer.phone}</span>}
            {customer.email && <span><MailOutlined /> {customer.email}</span>}
            {customer.address && <span><EnvironmentOutlined /> {customer.address}</span>}
          </Space>
        }
      />

      {/* RFM + tier header */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 16 }}>
        <Card size="small">
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Hạng</div>
          <div style={{ fontSize: 20, fontWeight: 600, color: TIER_COLOR[customer.tier] }}>
            {customer.tier}
          </div>
        </Card>
        <Card size="small">
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Tổng chi tiêu</div>
          <div style={{ fontSize: 20, fontWeight: 600, color: 'var(--primary)' }}>
            <MoneyDisplay value={rfm.monetary} />
          </div>
        </Card>
        <Card size="small">
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Số đơn (đã chốt)</div>
          <div style={{ fontSize: 20, fontWeight: 600 }}>{rfm.frequency}</div>
        </Card>
        <Card size="small">
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Lần mua cuối</div>
          <div style={{ fontSize: 20, fontWeight: 600 }}>
            {rfm.recencyDays !== null ? `${rfm.recencyDays} ngày trước` : '—'}
          </div>
        </Card>
        <Card size="small">
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Điểm thưởng</div>
          <div style={{ fontSize: 20, fontWeight: 600 }}>{customer.loyaltyPoints}</div>
        </Card>
        <Card size="small">
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Công nợ</div>
          <div style={{ fontSize: 20, fontWeight: 600, color: Number(customer.totalDebt) > 0 ? 'var(--error, #dc2626)' : undefined }}>
            <MoneyDisplay value={customer.totalDebt} />
          </div>
        </Card>
      </div>

      {/* Tags hiển thị */}
      <div style={{ marginBottom: 16, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <TagOutlined style={{ color: 'var(--text-muted)' }} />
        {tags.length === 0 && <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Chưa có tag</span>}
        {tags.map((t) => (
          <Tag key={t.id} color={t.color} closable onClose={(e) => { e.preventDefault(); unassignTag(t.id); }}>
            {t.name}
          </Tag>
        ))}
        <Button size="small" icon={<PlusOutlined />} onClick={() => setTagModalOpen(true)}>
          Gắn tag
        </Button>
      </div>

      <Tabs
        defaultActiveKey="interactions"
        items={[
          {
            key: 'interactions',
            label: <span><MessageOutlined /> Tương tác</span>,
            children: (
              <Card
                title={`Ghi chú & tương tác (${notes.length})`}
                extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => openNoteModal()}>Thêm ghi chú</Button>}
              >
                {notes.length === 0 ? (
                  <Empty description="Chưa có ghi chú" />
                ) : (
                  <Timeline
                    items={notes.map((n) => {
                      const typeMeta = NOTE_TYPES.find((t) => t.value === n.type) || NOTE_TYPES[0];
                      return {
                        color: typeMeta.color === 'default' ? 'gray' : typeMeta.color,
                        children: (
                          <div>
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                              <Tag color={typeMeta.color}>{typeMeta.label}</Tag>
                              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                                {n.createdBy?.fullName || '—'} · {dayjs(n.createdAt).format('DD/MM/YYYY HH:mm')}
                              </span>
                              <Button size="small" type="text" icon={<EditOutlined />} onClick={() => openNoteModal(n)} />
                              <Popconfirm title="Xóa ghi chú?" onConfirm={() => deleteNote(n.id)} okText="Xóa" cancelText="Hủy">
                                <Button size="small" type="text" danger icon={<DeleteOutlined />} />
                              </Popconfirm>
                            </div>
                            <div style={{ whiteSpace: 'pre-wrap' }}>{n.content}</div>
                          </div>
                        ),
                      };
                    })}
                  />
                )}
              </Card>
            ),
          },
          {
            key: 'tasks',
            label: <span><CheckSquareOutlined /> Nhiệm vụ ({tasks.length})</span>,
            children: (
              <Card
                title={`Nhiệm vụ CSKH (${tasks.length})`}
                extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => openTaskModal()}>Tạo nhiệm vụ</Button>}
              >
                <Table
                  columns={taskColumns}
                  dataSource={tasks}
                  rowKey="id"
                  loading={tasksLoading}
                  pagination={false}
                  size="small"
                  locale={{ emptyText: 'Chưa có nhiệm vụ' }}
                />
              </Card>
            ),
          },
          {
            key: 'orders',
            label: `Đơn hàng (${recentOrders.length})`,
            children: (
              <Card>
                <Table
                  columns={orderColumns}
                  dataSource={recentOrders}
                  rowKey="id"
                  pagination={false}
                  size="small"
                  locale={{ emptyText: 'Chưa có đơn hàng' }}
                />
              </Card>
            ),
          },
          {
            key: 'debts',
            label: `Công nợ (${debts.length})`,
            children: (
              <Card>
                <Table
                  columns={debtColumns}
                  dataSource={debts}
                  rowKey="id"
                  pagination={false}
                  size="small"
                  locale={{ emptyText: 'Không có công nợ' }}
                />
              </Card>
            ),
          },
          {
            key: 'loyalty',
            label: `Loyalty (${loyaltyTxs.length})`,
            children: (
              <Card>
                <Table
                  columns={loyaltyColumns}
                  dataSource={loyaltyTxs}
                  rowKey="id"
                  pagination={false}
                  size="small"
                  locale={{ emptyText: 'Chưa có giao dịch điểm' }}
                />
              </Card>
            ),
          },
        ]}
      />

      <Modal
        title={editingNote ? 'Sửa ghi chú' : 'Thêm ghi chú'}
        open={noteModalOpen}
        onCancel={() => setNoteModalOpen(false)}
        onOk={saveNote}
        okText="Lưu"
        cancelText="Hủy"
        width={520}
      >
        <Form form={noteForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item label="Loại" name="type" rules={[{ required: true }]}>
            <Select options={NOTE_TYPES.map((t) => ({ value: t.value, label: t.label }))} />
          </Form.Item>
          <Form.Item
            label="Nội dung"
            name="content"
            rules={[{ required: true, message: 'Nhập nội dung' }]}
          >
            <Input.TextArea rows={5} placeholder="Nội dung tương tác / ghi chú..." />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={editingTask ? 'Sửa nhiệm vụ' : 'Tạo nhiệm vụ CSKH'}
        open={taskModalOpen}
        onCancel={() => setTaskModalOpen(false)}
        onOk={saveTask}
        okText="Lưu"
        cancelText="Hủy"
        width={560}
      >
        <Form form={taskForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item label="Tiêu đề" name="title" rules={[{ required: true, message: 'Nhập tiêu đề' }]}>
            <Input placeholder="VD: Gọi xác nhận đơn hàng" />
          </Form.Item>
          <Form.Item label="Mô tả" name="description">
            <Input.TextArea rows={3} placeholder="Chi tiết..." />
          </Form.Item>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Form.Item label="Giao cho" name="assignedToId" rules={[{ required: true }]}>
              <Select
                options={users.map((u) => ({ value: u.id, label: `${u.fullName} (${u.role})` }))}
                placeholder="Chọn người"
              />
            </Form.Item>
            <Form.Item label="Hạn" name="dueAt">
              <DatePicker showTime style={{ width: '100%' }} format="DD/MM/YYYY HH:mm" />
            </Form.Item>
            <Form.Item label="Ưu tiên" name="priority">
              <Select options={TASK_PRIORITY.map((p) => ({ value: p.value, label: p.label }))} />
            </Form.Item>
            {editingTask && (
              <Form.Item label="Trạng thái" name="status">
                <Select options={TASK_STATUS.map((s) => ({ value: s.value, label: s.label }))} />
              </Form.Item>
            )}
          </div>
        </Form>
      </Modal>

      <Modal
        title="Gắn tag cho khách hàng"
        open={tagModalOpen}
        onCancel={() => setTagModalOpen(false)}
        footer={null}
      >
        {availableTags.length === 0 ? (
          <Empty description="Không còn tag để gắn (tạo tag mới ở trang quản lý)" />
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {availableTags.map((t) => (
              <Tag
                key={t.id}
                color={t.color}
                style={{ cursor: 'pointer', padding: '4px 10px' }}
                onClick={() => { assignTag(t.id); setTagModalOpen(false); }}
              >
                {t.name}
              </Tag>
            ))}
          </div>
        )}
      </Modal>
    </>
  );
}
