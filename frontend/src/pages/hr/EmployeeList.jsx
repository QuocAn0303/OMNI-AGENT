/**
 * Frontend: pages/hr/EmployeeList.jsx — Danh sách nhân viên
 *
 * Tổng quan:
 * - Bảng quản lý nhân viên với CRUD, tìm kiếm theo tên/SĐT/email
 * - API: GET /hr/employees, POST /hr/employees, PUT /hr/employees/:id, DELETE /hr/employees/:id
 * - State chính: data, search, editing, modalOpen; filter client-side qua useMemo
 *
 * Components/Hooks/Exports:
 * - EmployeeList: Component chính (xuất mặc định)
 */
import { useEffect, useState, useMemo } from 'react';
import {
  Table, Input, Button, Avatar, message, Modal, Form, InputNumber, Select, DatePicker,
} from 'antd';
import {
  SearchOutlined, PlusOutlined, EditOutlined, DeleteOutlined,
  PhoneOutlined, MailOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import axios from '../../api/axios';
import StatusTag from '../../components/shared/StatusTag';
import MoneyDisplay from '../../components/shared/MoneyDisplay';
import EmptyState from '../../components/shared/EmptyState';


const POSITION_COLORS = {
  MANAGER:  '#7c3aed',
  CASHIER:  '#0f766e',
  SALES:    '#0284c7',
  WAREHOUSE:'#d97706',
  OTHER:    '#94a3b8',
};

const POSITION_LABELS = {
  MANAGER:   'Quản lý',
  CASHIER:   'Thu ngân',
  SALES:     'Bán hàng',
  WAREHOUSE: 'Kho',
  OTHER:     'Khác',
};

export default function EmployeeList() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm();

  const load = async () => {
    setLoading(true);
    try {
      const res = await axios.get('/hr/employees');
      setData(Array.isArray(res.data) ? res.data : (res.data?.data || []));
    } catch {
      message.error('Không tải được danh sách nhân viên');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() =>
    data.filter((e) =>
      !search ||
      `${e.fullName} ${e.phone || ''} ${e.email || ''}`.toLowerCase().includes(search.toLowerCase())
    ), [data, search]);

  const openModal = (employee = null) => {
    setEditing(employee);
    form.setFieldsValue(employee
      ? {
          ...employee,
          hireDate: employee.hireDate ? dayjs(employee.hireDate) : null,
        }
      : { position: 'SALES', baseSalary: 0, isActive: true }
    );
    setModalOpen(true);
  };

  const handleSave = async () => {
    setSubmitting(true);
    try {
      const values = await form.validateFields();
      // Convert null → undefined để Zod/backend không reject các field bỏ trống
      const clean = Object.fromEntries(
        Object.entries(values).map(([k, v]) => [k, v === null ? undefined : v])
      );
      const payload = {
        ...clean,
        hireDate: values.hireDate ? values.hireDate.format('YYYY-MM-DD') : null,
      };
      if (editing) {
        await axios.put(`/hr/employees/${editing.id}`, payload);
        message.success('Đã cập nhật');
      } else {
        await axios.post('/hr/employees', payload);
        message.success('Đã thêm nhân viên');
      }
      setModalOpen(false);
      load();
    } catch (err) {
      if (err.errorFields) return;
      message.error('Lưu thất bại');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = (id) => {
    Modal.confirm({
      title: 'Xóa nhân viên?',
      okText: 'Xóa', cancelText: 'Hủy', okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await axios.delete(`/hr/employees/${id}`);
          message.success('Đã xóa');
          load();
        } catch {
          message.error('Xóa thất bại');
        }
      },
    });
  };

  const columns = [
    {
      title: 'Nhân viên',
      dataIndex: 'fullName',
      render: (name, row) => (
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <Avatar size={36} style={{
            background: POSITION_COLORS[row.position] || POSITION_COLORS.OTHER,
            fontWeight: 600,
            fontSize: 13,
          }}>
            {(name || 'N').slice(0, 2).toUpperCase()}
          </Avatar>
          <div>
            <div style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{name}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
              {row.employeeCode || '—'}
            </div>
          </div>
        </div>
      ),
    },
    {
      title: 'Vị trí',
      dataIndex: 'position',
      width: 130,
      render: (p) => {
        const color = POSITION_COLORS[p] || POSITION_COLORS.OTHER;
        return (
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '2px 10px',
            borderRadius: 'var(--radius-full)',
            background: color + '15',
            color,
            fontSize: 12,
            fontWeight: 500,
          }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: color }} />
            {POSITION_LABELS[p] || p}
          </span>
        );
      },
    },
    {
      title: 'Liên hệ',
      width: 180,
      render: (_, row) => (
        <div>
          {row.phone && <div style={{ fontSize: 13, fontFamily: 'var(--font-mono)' }}>{row.phone}</div>}
          {row.email && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{row.email}</div>}
        </div>
      ),
    },
    {
      title: 'Lương cơ bản',
      dataIndex: 'baseSalary',
      width: 130,
      align: 'right',
      sorter: (a, b) => a.baseSalary - b.baseSalary,
      render: (v) => <MoneyDisplay value={v} />,
    },
    {
      title: 'Ngày vào',
      dataIndex: 'hireDate',
      width: 110,
      render: (d) => d ? dayjs(d).format('DD/MM/YYYY') : '—',
    },
    {
      title: 'Trạng thái',
      dataIndex: 'isActive',
      width: 130,
      render: (active) => <StatusTag status={active ? 'ACTIVE' : 'INACTIVE'} />,
    },
    {
      title: '',
      width: 100,
      align: 'right',
      fixed: 'right',
      render: (_, row) => (
        <>
          <Button type="text" size="small" icon={<EditOutlined />} onClick={() => openModal(row)} />
          <Button type="text" size="small" danger icon={<DeleteOutlined />} onClick={() => handleDelete(row.id)} />
        </>
      ),
    },
  ];

  return (
    <>
      <div className="filters-bar" style={{ marginTop: 8 }}>
        <Input
          className="filters-bar__search"
          placeholder="Tìm theo tên, SĐT, email..."
          prefix={<SearchOutlined style={{ color: 'var(--text-muted)' }} />}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          allowClear
        />
        <Button type="primary" icon={<PlusOutlined />} onClick={() => openModal()} style={{ marginLeft: 'auto' }}>
          Thêm nhân viên
        </Button>
      </div>

      <div className="table-card">
        <Table
          columns={columns}
          dataSource={filtered}
          rowKey="id"
          loading={loading}
          scroll={{ x: 900 }}
          pagination={{ pageSize: 20 }}
          locale={{ emptyText: <EmptyState title="Chưa có nhân viên" /> }}
        />
      </div>

      <Modal
        title={editing ? 'Sửa thông tin nhân viên' : 'Thêm nhân viên mới'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleSave}
        okText="Lưu"
        cancelText="Hủy"
        width={560}
        okButtonProps={{ loading: submitting }}
      >
        <Form form={form} layout="vertical" size="large" style={{ marginTop: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Form.Item label="Mã nhân viên" name="employeeCode">
              <Input placeholder="NV001" style={{ fontFamily: 'var(--font-mono)' }} />
            </Form.Item>
            <Form.Item label="Họ tên" name="fullName" rules={[{ required: true, message: 'Nhập tên' }]}>
              <Input placeholder="Nguyễn Văn A" />
            </Form.Item>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Form.Item label="SĐT" name="phone" rules={[{ pattern: /^(0[3|5|7|8|9])+([0-9]{8})$/, message: 'Số điện thoại không hợp lệ' }]}>
              <Input prefix={<PhoneOutlined style={{ color: 'var(--text-muted)' }} />} placeholder="0901234567" />
            </Form.Item>
            <Form.Item label="Email" name="email" rules={[{ type: 'email', message: 'Email không hợp lệ' }]}>
              <Input prefix={<MailOutlined style={{ color: 'var(--text-muted)' }} />} placeholder="email@..." />
            </Form.Item>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
            <Form.Item label="Vị trí" name="position" rules={[{ required: true }]}>
              <Select options={Object.entries(POSITION_LABELS).map(([k, v]) => ({ value: k, label: v }))} />
            </Form.Item>
            <Form.Item label="Lương cơ bản" name="baseSalary">
              <InputNumber
                style={{ width: '100%' }}
                min={0}
                step={100000}
                formatter={(v) => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                parser={(v) => v.replace(/,/g, '')}
                addonAfter="₫"
              />
            </Form.Item>
            <Form.Item label="Ngày vào làm" name="hireDate">
              <DatePicker style={{ width: '100%' }} format="DD/MM/YYYY" />
            </Form.Item>
          </div>

          <Form.Item label="Địa chỉ" name="address">
            <Input.TextArea rows={2} placeholder="Địa chỉ liên hệ..." />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
