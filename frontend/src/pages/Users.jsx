import { useEffect, useState } from 'react';
import useDebounce from '../hooks/useDebounce';
import { Table, Input, Select, Button, Avatar, message, Modal, Form, Switch } from 'antd';
import {
  SearchOutlined, PlusOutlined, EditOutlined, LockOutlined,
  UserOutlined, MailOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import axios from '../api/axios';
import PageHeader from '../components/layout/PageHeader';
import StatusTag from '../components/shared/StatusTag';
import EmptyState from '../components/shared/EmptyState';

const ROLE_LABELS = {
  ADMIN:     { label: 'Admin',     color: '#7c3aed' },
  MANAGER:   { label: 'Manager',   color: '#0284c7' },
  CASHIER:   { label: 'Thu ngân',  color: '#0f766e' },
  WAREHOUSE: { label: 'Kho',       color: '#ca8a04' },
};

/**
 * Users — Quản lý tài khoản (chỉ Admin)
 * Endpoints: GET/POST/PUT /users, PUT /users/:id/status
 */
export default function Users() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const [roleFilter, setRoleFilter] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form] = Form.useForm();
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  const load = async () => {
    setLoading(true);
    try {
      const res = await axios.get('/users', { params: { page, limit: 20, ...(debouncedSearch && { search: debouncedSearch }) } });
      setData(res.data?.data || []);
      setTotal(res.data?.pagination?.total || 0);
    } catch {
      message.error('Không tải được tài khoản');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [page, debouncedSearch]);
  useEffect(() => { setPage(1); }, [debouncedSearch]);

  const displayData = roleFilter ? data.filter(u => u.role === roleFilter) : data;

  const openModal = (user = null) => {
    setEditing(user);
    form.resetFields();
    form.setFieldsValue(user
      ? { ...user, password: undefined }
      : { role: 'CASHIER', isActive: true }
    );
    setModalOpen(true);
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      if (editing) {
        // Không gửi password nếu để trống
        if (!values.password) delete values.password;
        await axios.put(`/users/${editing.id}`, values);
        message.success('Đã cập nhật');
      } else {
        await axios.post('/users', values);
        message.success('Đã tạo tài khoản');
      }
      setModalOpen(false);
      load();
    } catch (err) {
      if (err.errorFields) return;
      message.error(err?.response?.data?.message || 'Lưu thất bại');
    }
  };

  const handleToggleStatus = async (user) => {
    try {
      await axios.put(`/users/${user.id}`, { isActive: !user.isActive });
      message.success(user.isActive ? 'Đã khóa tài khoản' : 'Đã mở khóa');
      load();
    } catch {
      message.error('Thao tác thất bại');
    }
  };

  const columns = [
    {
      title: 'Người dùng',
      dataIndex: 'fullName',
      render: (name, row) => (
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <Avatar
            size={36}
            style={{
              background: ROLE_LABELS[row.role]?.color || 'var(--text-muted)',
              fontWeight: 600,
              fontSize: 13,
            }}
          >
            {(name || 'U').slice(0, 2).toUpperCase()}
          </Avatar>
          <div>
            <div style={{ fontWeight: 500, color: 'var(--text-primary)' }}>
              {name}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
              {row.email}
            </div>
          </div>
        </div>
      ),
    },
    {
      title: 'Email',
      dataIndex: 'email',
      width: 220,
      render: (v) => v || <span style={{ color: 'var(--text-muted)' }}>—</span>,
    },
    {
      title: 'Vai trò',
      dataIndex: 'role',
      width: 110,
      filters: Object.entries(ROLE_LABELS).map(([k, v]) => ({ text: v.label, value: k })),
      onFilter: (val, row) => row.role === val,
      render: (role) => {
        const cfg = ROLE_LABELS[role] || { label: role, color: '#94a3b8' };
        return (
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '2px 10px',
            borderRadius: 'var(--radius-full)',
            background: cfg.color + '15',
            color: cfg.color,
            fontSize: 12,
            fontWeight: 500,
          }}>
            <span style={{
              width: 6, height: 6,
              borderRadius: '50%',
              background: cfg.color,
            }} />
            {cfg.label}
          </span>
        );
      },
    },
    {
      title: 'Trạng thái',
      dataIndex: 'isActive',
      width: 130,
      render: (active) => <StatusTag status={active ? 'ACTIVE' : 'LOCKED'} />,
    },
    {
      title: 'Đăng nhập cuối',
      dataIndex: 'lastLoginAt',
      width: 140,
      render: (d) => d ? dayjs(d).format('DD/MM/YYYY HH:mm') : <span style={{ color: 'var(--text-muted)' }}>Chưa từng</span>,
    },
    {
      title: '',
      width: 100,
      align: 'right',
      fixed: 'right',
      render: (_, row) => (
        <>
          <Button
            type="text" size="small"
            icon={<EditOutlined />}
            onClick={() => openModal(row)}
          />
          <Button
            type="text" size="small"
            danger={row.isActive}
            icon={<LockOutlined />}
            onClick={() => handleToggleStatus(row)}
            title={row.isActive ? 'Khóa' : 'Mở khóa'}
          />
        </>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Quản lý tài khoản"
        subtitle={`${total} tài khoản`}
        actions={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => openModal()}>
            Thêm tài khoản
          </Button>
        }
      />

      <div className="filters-bar">
        <Input
          className="filters-bar__search"
          placeholder="Tìm theo tên, email..."
          prefix={<SearchOutlined style={{ color: 'var(--text-muted)' }} />}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          allowClear
        />
        <Select
          placeholder="Vai trò"
          style={{ width: 160 }}
          value={roleFilter}
          onChange={setRoleFilter}
          allowClear
          options={Object.entries(ROLE_LABELS).map(([k, v]) => ({ value: k, label: v.label }))}
        />
      </div>

      <div className="table-card">
        <Table
          columns={columns}
          dataSource={displayData}
          rowKey="id"
          loading={loading}
          scroll={{ x: 900 }}
          pagination={{ current: page, pageSize: 20, total, showSizeChanger: false, onChange: (p) => setPage(p) }}
          locale={{ emptyText: <EmptyState title="Chưa có tài khoản" /> }}
        />
      </div>

      <Modal
        title={editing ? 'Sửa tài khoản' : 'Thêm tài khoản mới'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleSave}
        okText="Lưu"
        cancelText="Hủy"
        width={480}
      >
        <Form form={form} layout="vertical" size="large" style={{ marginTop: 16 }}>
          <Form.Item
            label="Họ và tên"
            name="fullName"
            rules={[{ required: true, message: 'Vui lòng nhập họ tên' }]}
          >
            <Input prefix={<UserOutlined style={{ color: 'var(--text-muted)' }} />} placeholder="Nguyễn Văn A" />
          </Form.Item>

          <Form.Item
            label="Email"
            name="email"
            rules={[
              { required: !editing, message: 'Vui lòng nhập email' },
              { type: 'email', message: 'Email không hợp lệ' },
            ]}
          >
            <Input prefix={<MailOutlined style={{ color: 'var(--text-muted)' }} />} placeholder="email@..." />
          </Form.Item>

          <Form.Item
            label={editing ? 'Mật khẩu mới (để trống nếu không đổi)' : 'Mật khẩu'}
            name="password"
            rules={editing ? [] : [{ required: true, min: 6, message: 'Mật khẩu tối thiểu 6 ký tự' }]}
          >
            <Input.Password placeholder="••••••••" />
          </Form.Item>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Form.Item label="Vai trò" name="role" rules={[{ required: true }]}>
              <Select options={Object.entries(ROLE_LABELS).map(([k, v]) => ({ value: k, label: v.label }))} />
            </Form.Item>
            <Form.Item label="Hoạt động" name="isActive" valuePropName="checked">
              <Switch />
            </Form.Item>
          </div>
        </Form>
      </Modal>
    </>
  );
}
