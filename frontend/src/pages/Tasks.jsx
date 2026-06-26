/**
 * Frontend: pages/Tasks.jsx — Nhiệm vụ CSKH
 * 
 * Tổng quan:
 * - Danh sách nhiệm vụ (GET /crm/tasks) với filter: scope (all/mine/overdue), trạng thái, ưu tiên
 * - CRUD qua modal: tạo (POST), sửa (PATCH), xóa (DELETE) — có phân quyền (CASHIER chỉ xem nhiệm vụ của mình)
 * - Tìm kiếm khách hàng (GET /customers) với debounce 250ms
 * - Gán nhiệm vụ cho user (GET /crm/tasks/assignable-users), set hạn, ưu tiên
 * - Quick action: đánh dấu hoàn thành (setStatusQuick)
 * - Hiển thị cảnh báo quá hạn (màu đỏ) nếu dueAt < now và chưa DONE/CANCELLED
 * - State: data/total/page/loading/scope/status/priority/users/customerOptions — form modal riêng
 * 
 * Components/Hooks/Exports:
 * - Tasks (default): Page chính — filter bar + table + modal CRUD
 */
import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Table, Button, Tag, Modal, Form, Input, Select, DatePicker,
  message, Space, Popconfirm, Tooltip, Segmented,
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, CheckCircleOutlined,
  ClockCircleOutlined, UserOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import axios from '../api/axios';
import PageHeader from '../components/layout/PageHeader';
import EmptyState from '../components/shared/EmptyState';
import useAuthStore from '../stores/authStore';


const STATUS_OPTIONS = [
  { value: 'PENDING', label: 'Chờ xử lý', color: 'default' },
  { value: 'IN_PROGRESS', label: 'Đang làm', color: 'processing' },
  { value: 'DONE', label: 'Hoàn thành', color: 'success' },
  { value: 'CANCELLED', label: 'Đã hủy', color: 'default' },
];

const PRIORITY_OPTIONS = [
  { value: 'LOW', label: 'Thấp', color: 'default' },
  { value: 'NORMAL', label: 'Bình thường', color: 'blue' },
  { value: 'HIGH', label: 'Cao', color: 'red' },
];

const statusMeta = (v) => STATUS_OPTIONS.find((s) => s.value === v) || STATUS_OPTIONS[0];
const priorityMeta = (v) => PRIORITY_OPTIONS.find((p) => p.value === v) || PRIORITY_OPTIONS[1];

export default function Tasks() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const isCashier = user?.role === 'CASHIER';
  const canManage = ['SUPER_ADMIN', 'ADMIN', 'MANAGER'].includes(user?.role);

  const [data, setData] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  // CASHIER mặc định chỉ xem nhiệm vụ của mình
  const [scope, setScope] = useState(isCashier ? 'mine' : 'all'); // all | mine | overdue
  const [status, setStatus] = useState();
  const [priority, setPriority] = useState();

  const [users, setUsers] = useState([]);
  const [customerSearch, setCustomerSearch] = useState('');
  const [customerOptions, setCustomerOptions] = useState([]);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form] = Form.useForm();

  const loadUsers = async () => {
    try {
      const res = await axios.get('/crm/tasks/assignable-users');
      setUsers(res.data?.data || []);
    } catch {
      /* ignore */
    }
  };

  const load = async () => {
    setLoading(true);
    try {
      const params = { page, limit: 20 };
      if (status) params.status = status;
      if (priority) params.priority = priority;
      if (scope === 'overdue') params.overdue = 1;
      if (scope === 'mine') params.assignedTo = user?.id;

      const res = await axios.get('/crm/tasks', { params });
      setData(res.data?.data || []);
      setTotal(res.data?.pagination?.total || 0);
    } catch {
      message.error('Không tải được nhiệm vụ');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadUsers(); }, []);
  useEffect(() => { load(); }, [page, scope, status, priority]);
  useEffect(() => { setPage(1); }, [scope, status, priority]);

  // Customer search cho modal
  useEffect(() => {
    let active = true;
    const t = setTimeout(async () => {
      try {
        const res = await axios.get('/customers', {
          params: { page: 1, limit: 20, ...(customerSearch && { search: customerSearch }) },
        });
        if (active) setCustomerOptions(res.data?.data || []);
      } catch {
        /* ignore */
      }
    }, 250);
    return () => { active = false; clearTimeout(t); };
  }, [customerSearch]);

  const openModal = (task = null) => {
    setEditing(task);
    if (task) {
      form.setFieldsValue({
        customerId: task.customerId,
        title: task.title,
        description: task.description,
        status: task.status,
        priority: task.priority,
        dueAt: task.dueAt ? dayjs(task.dueAt) : null,
        assignedToId: task.assignedTo?.id,
      });
      setCustomerOptions((prev) =>
        prev.some((c) => c.id === task.customerId)
          ? prev
          : [{ id: task.customerId, name: task.customer?.name || '?' }, ...prev]
      );
    } else {
      form.setFieldsValue({
        priority: 'NORMAL',
        status: 'PENDING',
        assignedToId: user?.id,
      });
    }
    setModalOpen(true);
  };

  const save = async () => {
    try {
      const values = await form.validateFields();
      const payload = {
        ...values,
        dueAt: values.dueAt ? values.dueAt.toISOString() : null,
      };
      if (editing) {
        await axios.patch(`/crm/tasks/${editing.id}`, payload);
        message.success('Đã cập nhật');
      } else {
        await axios.post('/crm/tasks', payload);
        message.success('Đã tạo nhiệm vụ');
      }
      setModalOpen(false);
      load();
    } catch (err) {
      if (err.errorFields) return;
      message.error(err.response?.data?.message || 'Lưu thất bại');
    }
  };

  const setStatusQuick = async (task, newStatus) => {
    try {
      await axios.patch(`/crm/tasks/${task.id}`, { status: newStatus });
      message.success('Đã cập nhật');
      load();
    } catch {
      message.error('Cập nhật thất bại');
    }
  };

  const remove = async (id) => {
    try {
      await axios.delete(`/crm/tasks/${id}`);
      message.success('Đã xóa');
      load();
    } catch (err) {
      message.error(err.response?.data?.message || 'Xóa thất bại');
    }
  };

  const columns = useMemo(() => [
    {
      title: 'Tiêu đề',
      dataIndex: 'title',
      render: (t, row) => (
        <div>
          <div style={{ fontWeight: 500 }}>{t}</div>
          {row.description && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 320 }}>
              {row.description}
            </div>
          )}
        </div>
      ),
    },
    {
      title: 'Khách hàng',
      dataIndex: ['customer', 'name'],
      width: 180,
      render: (name, row) => (
        <Button type="link" size="small" style={{ padding: 0 }} onClick={() => navigate(`/customers/${row.customerId}`)}>
          {name}
        </Button>
      ),
    },
    {
      title: 'Trạng thái',
      dataIndex: 'status',
      width: 130,
      render: (v) => {
        const m = statusMeta(v);
        return <Tag color={m.color}>{m.label}</Tag>;
      },
    },
    {
      title: 'Ưu tiên',
      dataIndex: 'priority',
      width: 110,
      render: (v) => {
        const m = priorityMeta(v);
        return <Tag color={m.color}>{m.label}</Tag>;
      },
    },
    {
      title: 'Giao cho',
      width: 150,
      render: (_, row) => (
        <Space size={4}><UserOutlined /> {row.assignedTo?.fullName || '—'}</Space>
      ),
    },
    {
      title: 'Hạn',
      dataIndex: 'dueAt',
      width: 150,
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
      title: '',
      width: 130,
      align: 'right',
      fixed: 'right',
      render: (_, row) => (
        <Space size={0}>
          {canManage && row.status !== 'DONE' && (
            <Tooltip title="Hoàn thành">
              <Button size="small" type="text" icon={<CheckCircleOutlined />} onClick={() => setStatusQuick(row, 'DONE')} />
            </Tooltip>
          )}
          {canManage && (
            <>
              <Button size="small" type="text" icon={<EditOutlined />} onClick={() => openModal(row)} />
              <Popconfirm title="Xóa nhiệm vụ?" onConfirm={() => remove(row.id)} okText="Xóa" cancelText="Hủy">
                <Button size="small" type="text" danger icon={<DeleteOutlined />} />
              </Popconfirm>
            </>
          )}
        </Space>
      ),
    },
  ], [users, canManage]);

  return (
    <>
      <PageHeader
        title="Nhiệm vụ CSKH"
        subtitle={`${total} nhiệm vụ`}
        actions={
          canManage && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => openModal()}>
              Tạo nhiệm vụ
            </Button>
          )
        }
      />

      <div className="filters-bar" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <Segmented
          value={scope}
          onChange={setScope}
          options={
            isCashier
              ? [
                  { value: 'mine', label: 'Của tôi' },
                  { value: 'overdue', label: 'Quá hạn' },
                ]
              : [
                  { value: 'all', label: 'Tất cả' },
                  { value: 'mine', label: 'Của tôi' },
                  { value: 'overdue', label: 'Quá hạn' },
                ]
          }
        />
        <Select
          allowClear placeholder="Trạng thái" style={{ width: 160 }}
          value={status} onChange={setStatus}
          options={STATUS_OPTIONS.map((s) => ({ value: s.value, label: s.label }))}
        />
        <Select
          allowClear placeholder="Ưu tiên" style={{ width: 140 }}
          value={priority} onChange={setPriority}
          options={PRIORITY_OPTIONS.map((p) => ({ value: p.value, label: p.label }))}
        />
      </div>

      <div className="table-card">
        <Table
          columns={columns}
          dataSource={data}
          rowKey="id"
          loading={loading}
          scroll={{ x: 1100 }}
          pagination={{ current: page, pageSize: 20, total, showSizeChanger: false, onChange: (p) => setPage(p) }}
          locale={{
            emptyText: (
              <EmptyState
                title="Chưa có nhiệm vụ"
                description={isCashier ? 'Hiện chưa có nhiệm vụ nào được giao cho bạn.' : undefined}
                action={
                  canManage ? (
                    <Button type="primary" icon={<PlusOutlined />} onClick={() => openModal()}>
                      Tạo nhiệm vụ đầu tiên
                    </Button>
                  ) : null
                }
              />
            ),
          }}
        />
      </div>

      <Modal
        title={editing ? 'Sửa nhiệm vụ' : 'Tạo nhiệm vụ CSKH'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={save}
        okText="Lưu"
        cancelText="Hủy"
        width={560}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item label="Khách hàng" name="customerId" rules={[{ required: true, message: 'Chọn khách hàng' }]}>
            <Select
              showSearch
              filterOption={false}
              onSearch={setCustomerSearch}
              placeholder="Tìm khách hàng theo tên/SĐT..."
              options={customerOptions.map((c) => ({
                value: c.id,
                label: `${c.name}${c.phone ? ` (${c.phone})` : ''}`,
              }))}
            />
          </Form.Item>
          <Form.Item label="Tiêu đề" name="title" rules={[{ required: true, message: 'Nhập tiêu đề' }]}>
            <Input placeholder="VD: Gọi xác nhận đơn hàng" />
          </Form.Item>
          <Form.Item label="Mô tả" name="description">
            <Input.TextArea rows={3} placeholder="Chi tiết công việc..." />
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
              <Select options={PRIORITY_OPTIONS.map((p) => ({ value: p.value, label: p.label }))} />
            </Form.Item>
            {editing && (
              <Form.Item label="Trạng thái" name="status">
                <Select options={STATUS_OPTIONS.map((s) => ({ value: s.value, label: s.label }))} />
              </Form.Item>
            )}
          </div>
        </Form>
      </Modal>
    </>
  );
}
