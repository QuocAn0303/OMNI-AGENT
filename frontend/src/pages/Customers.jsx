import { useEffect, useState } from 'react';
import useDebounce from '../hooks/useDebounce';
import { Table, Input, Button, Avatar, message, Modal, Form } from 'antd';
import {
  SearchOutlined, PlusOutlined, EditOutlined, DeleteOutlined,
  PhoneOutlined, MailOutlined, EnvironmentOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import axios from '../api/axios';
import PageHeader from '../components/layout/PageHeader';
import MoneyDisplay from '../components/shared/MoneyDisplay';
import EmptyState from '../components/shared/EmptyState';

/**
 * Customers — Quản lý khách hàng
 * Endpoints: GET/POST/PUT/DELETE /customers
 */
export default function Customers() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form] = Form.useForm();
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  const load = async () => {
    setLoading(true);
    try {
      const res = await axios.get('/customers', { params: { page, limit: 20, ...(debouncedSearch && { search: debouncedSearch }) } });
      setData(res.data?.data || []);
      setTotal(res.data?.pagination?.total || 0);
    } catch {
      message.error('Không tải được khách hàng');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [page, debouncedSearch]);
  useEffect(() => { setPage(1); }, [debouncedSearch]);

  const openModal = (customer = null) => {
    setEditing(customer);
    form.setFieldsValue(customer || { name: '', phone: '', email: '', address: '' });
    setModalOpen(true);
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      if (editing) {
        await axios.put(`/customers/${editing.id}`, values);
        message.success('Đã cập nhật khách hàng');
      } else {
        await axios.post('/customers', values);
        message.success('Đã thêm khách hàng');
      }
      setModalOpen(false);
      load();
    } catch (err) {
      if (err.errorFields) return; // validation error
      message.error('Lưu thất bại');
    }
  };

  const handleDelete = (id) => {
    Modal.confirm({
      title: 'Xóa khách hàng?',
      content: 'Lịch sử đơn hàng sẽ vẫn được giữ.',
      okText: 'Xóa', okButtonProps: { danger: true }, cancelText: 'Hủy',
      onOk: async () => {
        try {
          await axios.delete(`/customers/${id}`);
          message.success('Đã xóa');
          load();
        } catch {
          message.error('Xóa thất bại');
        }
      },
    });
  };

  // Avatar background palette
  const avatarColors = ['#0f766e', '#0891b2', '#7c3aed', '#db2777', '#d97706'];
  const getColor = (id) => {
    if (!id || typeof id !== 'string') return avatarColors[0];
    let hash = 0;
    for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
    return avatarColors[Math.abs(hash) % avatarColors.length];
  };

  const columns = [
    {
      title: 'Khách hàng',
      dataIndex: 'name',
      render: (name, row) => (
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <Avatar
            style={{
              background: getColor(row.id || 0),
              fontWeight: 600,
              fontSize: 13,
              flexShrink: 0,
            }}
            size={36}
          >
            {(name || 'K').slice(0, 2).toUpperCase()}
          </Avatar>
          <div>
            <div style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{name}</div>
            {row.email && (
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{row.email}</div>
            )}
          </div>
        </div>
      ),
    },
    {
      title: 'Liên hệ',
      width: 160,
      render: (_, row) => (
        <div>
          {row.phone && (
            <div style={{ fontSize: 13, fontFamily: 'var(--font-mono)' }}>
              {row.phone}
            </div>
          )}
          {row.address && (
            <div style={{
              fontSize: 12,
              color: 'var(--text-muted)',
              maxWidth: 180,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {row.address}
            </div>
          )}
        </div>
      ),
    },
    {
      title: 'Số đơn',
      dataIndex: 'orderCount',
      width: 90,
      align: 'right',
      sorter: (a, b) => (a.orderCount || 0) - (b.orderCount || 0),
      render: (n) => (
        <span style={{ fontWeight: 500 }}>{n || 0}</span>
      ),
    },
    {
      title: 'Tổng chi tiêu',
      dataIndex: 'totalSpent',
      width: 140,
      align: 'right',
      sorter: (a, b) => (a.totalSpent || 0) - (b.totalSpent || 0),
      render: (v) => (
        <span style={{ fontWeight: 500, color: 'var(--primary)' }}>
          <MoneyDisplay value={v || 0} />
        </span>
      ),
    },
    {
      title: 'Lần mua cuối',
      dataIndex: 'lastOrderAt',
      width: 130,
      render: (d) => d ? (
        <div>
          <div style={{ fontSize: 13 }}>{dayjs(d).format('DD/MM/YYYY')}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {dayjs(d).fromNow ? dayjs(d).fromNow() : ''}
          </div>
        </div>
      ) : <span style={{ color: 'var(--text-muted)' }}>—</span>,
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
            type="text" size="small" danger
            icon={<DeleteOutlined />}
            onClick={() => handleDelete(row.id)}
          />
        </>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Khách hàng"
        subtitle={`${total} khách hàng`}
        actions={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => openModal()}>
            Thêm khách hàng
          </Button>
        }
      />

      <div className="filters-bar">
        <Input
          className="filters-bar__search"
          placeholder="Tìm theo tên, SĐT, email..."
          prefix={<SearchOutlined style={{ color: 'var(--text-muted)' }} />}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          allowClear
        />
      </div>

      <div className="table-card">
        <Table
          columns={columns}
          dataSource={data}
          rowKey="id"
          loading={loading}
          scroll={{ x: 900 }}
          pagination={{ current: page, pageSize: 20, total, showSizeChanger: false, onChange: (p) => setPage(p) }}
          locale={{
            emptyText: (
              <EmptyState
                title="Chưa có khách hàng"
                action={
                  <Button type="primary" icon={<PlusOutlined />} onClick={() => openModal()}>
                    Thêm khách hàng đầu tiên
                  </Button>
                }
              />
            ),
          }}
        />
      </div>

      <Modal
        title={editing ? 'Sửa khách hàng' : 'Thêm khách hàng'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleSave}
        okText="Lưu"
        cancelText="Hủy"
        width={480}
      >
        <Form form={form} layout="vertical" size="large" style={{ marginTop: 16 }}>
          <Form.Item
            label="Tên khách hàng"
            name="name"
            rules={[{ required: true, message: 'Vui lòng nhập tên' }]}
          >
            <Input placeholder="Nguyễn Văn A" />
          </Form.Item>
          <Form.Item label="Số điện thoại" name="phone">
            <Input
              prefix={<PhoneOutlined style={{ color: 'var(--text-muted)' }} />}
              placeholder="0901234567"
            />
          </Form.Item>
          <Form.Item label="Email" name="email" rules={[{ type: 'email', message: 'Email không hợp lệ' }]}>
            <Input
              prefix={<MailOutlined style={{ color: 'var(--text-muted)' }} />}
              placeholder="example@email.com"
            />
          </Form.Item>
          <Form.Item label="Địa chỉ" name="address">
            <Input.TextArea
              rows={2}
              placeholder="Địa chỉ giao hàng..."
            />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
