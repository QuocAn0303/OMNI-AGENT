/**
 * Frontend: pages/Users.jsx — Quản lý tài khoản người dùng
 * 
 * Tổng quan:
 * - Trang quản lý user với phân quyền, khóa/mở khóa tài khoản
 * - API: GET/POST/PUT /users
 * - State: data, search/role filter, modal editing
 * - Logic: Phân quyền SUPER_ADMIN/ADMIN có thể thấy tenant. Toggle isActive để khóa/mở
 * 
 * Components/Hooks/Exports:
 * - Users (default export): Bảng user + modal thêm/sửa + toggle trạng thái
 */
import { useEffect, useState } from 'react';
import useDebounce from '../hooks/useDebounce';
import { Table, Input, Select, Button, Avatar, message, Modal, Form, Switch, Tag } from 'antd';
import {
  SearchOutlined, PlusOutlined, EditOutlined, LockOutlined,
  UserOutlined, MailOutlined, CrownOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import axios from '../api/axios';
import { useAuthStore } from '../stores/authStore';
import PageHeader from '../components/layout/PageHeader';
import StatusTag from '../components/shared/StatusTag';
import EmptyState from '../components/shared/EmptyState';

const ROLE_LABELS = {
  SUPER_OMEGA_ULTRA_ADMIN: { label: 'Siêu Cấp Admin', color: '#dc2626' },
  SUPER_ADMIN:             { label: 'Super Admin',     color: '#7c3aed' },
  ADMIN:                   { label: 'Admin',           color: '#7c3aed' },
  MANAGER:                 { label: 'Manager',         color: '#0284c7' },
  ACCOUNTANT:              { label: 'Kế toán',         color: '#0891b2' },
  CASHIER:                 { label: 'Thu ngân',        color: '#0f766e' },
  WAREHOUSE:               { label: 'Kho',             color: '#ca8a04' },
};

export default function Users() {
  const user = useAuthStore((s) => s.user);
  const isSuper = user?.role === 'SUPER_OMEGA_ULTRA_ADMIN' || user?.role === 'SUPER_ADMIN';
  // Chỉ SUPER_OMEGA_ULTRA_ADMIN được gán vai trò SUPER; tenant (hoặc support session) chỉ gán được vai trò tenant
  const canAssignSuperRole = user?.role === 'SUPER_OMEGA_ULTRA_ADMIN';
  // Có quyền ghi khi: SUPER_OMEGA_ULTRA_ADMIN, hoặc có tenant context (ADMIN tenant / đang trong support session)
  const canWrite = user?.role === 'SUPER_OMEGA_ULTRA_ADMIN' || Boolean(user?.tenantId);
  const roleOptions = Object.entries(ROLE_LABELS)
    .filter(([k]) => (canAssignSuperRole || !k.startsWith('SUPER_')))
    .map(([k, v]) => ({ value: k, label: v.label }));
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
      const params = { page, limit: 20 };
      if (debouncedSearch) params.search = debouncedSearch;
      if (roleFilter) params.role = roleFilter;
      const res = await axios.get('/users', { params });
      setData(res.data?.data || []);
      setTotal(res.data?.pagination?.total || 0);
    } catch {
      message.error('Không tải được tài khoản');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [page, debouncedSearch, roleFilter]);
  useEffect(() => { setPage(1); }, [debouncedSearch, roleFilter]);

  const openModal = (userData = null) => {
    setEditing(userData);
    form.resetFields();
    if (userData) {
      form.setFieldsValue({ ...userData, password: undefined });
    } else {
      form.setFieldsValue({ role: canAssignSuperRole ? 'SUPER_ADMIN' : 'CASHIER', isActive: true });
    }
    setModalOpen(true);
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      if (editing) {
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

  const handleToggleStatus = async (u) => {
    try {
      await axios.put(`/users/${u.id}`, { isActive: !u.isActive });
      message.success(u.isActive ? 'Đã khóa tài khoản' : 'Đã mở khóa');
      load();
    } catch {
      message.error('Thao tác thất bại');
    }
  };

  const columns = [
    {
      title: 'Người dùng', dataIndex: 'fullName',
      render: (name, row) => (
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <Avatar size={36} style={{ background: ROLE_LABELS[row.role]?.color || '#94a3b8', fontWeight: 600, fontSize: 13 }}>
            {(name || 'U').slice(0, 2).toUpperCase()}
          </Avatar>
          <div>
            <div style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{name}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{row.email}</div>
          </div>
        </div>
      ),
    },
    {
      title: 'Vai trò', dataIndex: 'role', width: 150,
      filters: Object.entries(ROLE_LABELS).map(([k, v]) => ({ text: v.label, value: k })),
      onFilter: (val, row) => row.role === val,
      render: (role) => {
        const cfg = ROLE_LABELS[role] || { label: role, color: '#94a3b8' };
        return (
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '2px 10px', borderRadius: 'var(--radius-full)',
            background: cfg.color + '15', color: cfg.color, fontSize: 12, fontWeight: 500,
          }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: cfg.color }} />
            {cfg.label}
          </span>
        );
      },
    },
    ...(isSuper ? [{
      title: 'Tenant', dataIndex: ['tenant', 'name'], key: 'tenant', width: 160,
      render: (v, row) => v || (row.tenantId ? <Tag>{row.tenantId?.slice(0, 8)}</Tag> : <Tag color="blue">Hệ thống</Tag>),
    }] : []),
    {
      title: 'Trạng thái', dataIndex: 'isActive', width: 110,
      render: (active) => <StatusTag status={active ? 'ACTIVE' : 'LOCKED'} />,
    },
    {
      title: 'Ngày tạo', dataIndex: 'createdAt', width: 140,
      render: (d) => d ? dayjs(d).format('DD/MM/YYYY') : '-',
    },
    {
      title: '', width: 100, align: 'right', fixed: 'right',
      render: (_, row) => canWrite ? (
        <>
          <Button type="text" size="small" icon={<EditOutlined />} onClick={() => openModal(row)} />
          <Button type="text" size="small" danger={row.isActive} icon={<LockOutlined />}
            onClick={() => handleToggleStatus(row)} title={row.isActive ? 'Khóa' : 'Mở khóa'} />
        </>
      ) : null,
    },
  ];

  return (
    <>
      <PageHeader
        title="Quản lý tài khoản"
        subtitle={`${total} tài khoản`}
        actions={canWrite ? (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => openModal()}>
            Thêm tài khoản
          </Button>
        ) : null}
      />

      <div className="filters-bar">
        <Input className="filters-bar__search"
          placeholder="Tìm theo tên, email..."
          prefix={<SearchOutlined style={{ color: 'var(--text-muted)' }} />}
          value={search} onChange={(e) => setSearch(e.target.value)} allowClear
        />
        <Select placeholder="Vai trò" style={{ width: 180 }} value={roleFilter}
          onChange={setRoleFilter} allowClear
          options={roleOptions}
        />
      </div>

      <div className="table-card">
        <Table columns={columns} dataSource={data} rowKey="id" loading={loading}
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
        okText="Lưu" cancelText="Hủy"
        width={480}
      >
        <Form form={form} layout="vertical" size="large" style={{ marginTop: 16 }}>
          <Form.Item label="Họ và tên" name="fullName" rules={[{ required: true, message: 'Vui lòng nhập họ tên' }]}>
            <Input prefix={<UserOutlined style={{ color: 'var(--text-muted)' }} />} placeholder="Nguyễn Văn A" />
          </Form.Item>

          <Form.Item label="Email" name="email"
            rules={[{ required: !editing, message: 'Vui lòng nhập email' }, { type: 'email', message: 'Email không hợp lệ' }]}
          >
            <Input prefix={<MailOutlined style={{ color: 'var(--text-muted)' }} />} placeholder="email@..." />
          </Form.Item>

          <Form.Item label={editing ? 'Mật khẩu mới (để trống nếu không đổi)' : 'Mật khẩu'} name="password"
            rules={editing ? [] : [{ required: true, min: 6, message: 'Mật khẩu tối thiểu 6 ký tự' }]}
          >
            <Input.Password placeholder="••••••••" />
          </Form.Item>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Form.Item label="Vai trò" name="role" rules={[{ required: true }]}>
              <Select options={roleOptions} />
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
