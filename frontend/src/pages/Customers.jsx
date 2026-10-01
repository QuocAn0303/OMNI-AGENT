/**
 * Page: Customers — Quản lý danh sách khách hàng
 *
 * Tổng quan:
 * - Hiển thị danh sách khách hàng dạng table với avatar, thông tin liên hệ, tags
 * - Gọi API: GET/POST/PUT/DELETE /customers
 * - Chức năng: thêm, sửa, xóa khách hàng qua Modal form
 * - Bộ lọc: tìm kiếm theo tên, SĐT, email (debounce 300ms); lọc theo phân khúc qua ?segment=<id>
 * - Click vào hàng để xem chi tiết khách hàng
 * - Sử dụng EmptyState khi chưa có khách hàng
 *
 * Exports:
 * - Customers: React functional component (default export)
 */
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import useDebounce from '../hooks/useDebounce';
import { Table, Input, Button, Avatar, Modal, Form, Tag } from 'antd';
import {
  SearchOutlined, PlusOutlined, EditOutlined, DeleteOutlined,
  PhoneOutlined, MailOutlined, EnvironmentOutlined, CommentOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import axios from '../api/axios';
import PageHeader from '../components/layout/PageHeader';
import MoneyDisplay from '../components/shared/MoneyDisplay';
import EmptyState from '../components/shared/EmptyState';
import useToast from '../components/shared/useToast';
import useConfirm from '../components/shared/useConfirm';

/**
 * Customers — Quản lý khách hàng
 * Endpoints: GET/POST/PUT/DELETE /customers
 */
export default function Customers() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const [searchParams, setSearchParams] = useSearchParams();
  const segmentId = searchParams.get('segment') || '';
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
      const res = await axios.get('/customers', {
        params: {
          page,
          limit: 20,
          ...(debouncedSearch && { search: debouncedSearch }),
          ...(segmentId && { segmentId }),
        },
      });
      setData(res.data?.data || []);
      setTotal(res.data?.pagination?.total || 0);
    } catch {
      toast.error(t('customers.loadError'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [page, debouncedSearch, segmentId]);
  useEffect(() => { setPage(1); }, [debouncedSearch, segmentId]);

  const clearSegmentFilter = () => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('segment');
      return next;
    });
  };

  const openModal = (customer = null) => {
    setEditing(customer);
    // CRM Phase 4 — mục 5: khai báo field ở đây, không chỉ ở <Form.Item>.
    // `form.setFieldsValue` chỉ set được key có sẵn trong Form, nên thiếu ở đây là
    // field bị rơi mất khi mở modal sửa.
    form.setFieldsValue(
      customer || { name: '', phone: '', email: '', address: '', zaloUserId: '' },
    );
    setModalOpen(true);
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      if (editing) {
        await axios.put(`/customers/${editing.id}`, values);
        toast.success(t('customers.updateSuccess'));
      } else {
        await axios.post('/customers', values);
        toast.success(t('customers.createSuccess'));
      }
      setModalOpen(false);
      load();
    } catch (err) {
      if (err.errorFields) return;
      toast.error(t('customers.saveError'));
    }
  };

  const handleDelete = (id) => {
    confirm.deleteConfirm({
      title: t('customers.deleteConfirmTitle'),
      content: t('customers.deleteConfirmContent'),
      onOk: async () => {
        try {
          await axios.delete(`/customers/${id}`);
          toast.success(t('customers.deleteSuccess'));
          load();
        } catch {
          toast.error(t('customers.deleteError'));
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
      title: t('customers.title'),
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
      title: t('customers.contact'),
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
      title: t('customers.orderCount'),
      dataIndex: 'orderCount',
      width: 90,
      align: 'right',
      sorter: (a, b) => (a.orderCount || 0) - (b.orderCount || 0),
      render: (n) => (
        <span style={{ fontWeight: 500 }}>{n || 0}</span>
      ),
    },
    {
      title: t('customers.totalSpent'),
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
      title: t('customers.tags'),
      dataIndex: 'tags',
      width: 180,
      render: (tags) =>
        (tags && tags.length > 0) ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {tags.slice(0, 3).map((t) => (
              <Tag key={t.id} color={t.color} style={{ marginRight: 0 }}>{t.name}</Tag>
            ))}
            {tags.length > 3 && <Tag>+{tags.length - 3}</Tag>}
          </div>
        ) : <span style={{ color: 'var(--text-muted)' }}>—</span>,
    },
    {
      title: t('customers.lastOrder'),
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
            onClick={(e) => { e.stopPropagation(); openModal(row); }}
          />
          <Button
            type="text" size="small" danger
            icon={<DeleteOutlined />}
            onClick={(e) => { e.stopPropagation(); handleDelete(row.id); }}
          />
        </>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title={t('customers.title')}
        subtitle={t('customers.count', { count: total })}
        actions={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => openModal()}>
            {t('customers.add')}
          </Button>
        }
      />

      <div className="filters-bar">
        <Input
          className="filters-bar__search"
          placeholder={t('customers.searchPlaceholder')}
          prefix={<SearchOutlined style={{ color: 'var(--text-muted)' }} />}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          allowClear
        />
        {segmentId && (
          <Tag
            color="blue"
            closable
            onClose={clearSegmentFilter}
            style={{ marginRight: 0, padding: '4px 10px' }}
          >
            {t('customers.filteredBySegment')}
          </Tag>
        )}
      </div>

      <div className="table-card">
        <Table
          columns={columns}
          dataSource={data}
          rowKey="id"
          loading={loading}
          scroll={{ x: 900 }}
          onRow={(row) => ({
            onClick: () => navigate(`/customers/${row.id}`),
            style: { cursor: 'pointer' },
          })}
          pagination={{ current: page, pageSize: 20, total, showSizeChanger: false, onChange: (p) => setPage(p) }}
          locale={{
            emptyText: (
              <EmptyState
                title={t('customers.empty')}
                actionText={t('customers.addFirst')}
                onAction={() => openModal()}
              />
            ),
          }}
        />
      </div>

      <Modal
        title={editing ? t('customers.edit') : t('customers.create')}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleSave}
        okText={t('common.save')}
        cancelText={t('common.cancel')}
        width={480}
      >
        <Form form={form} layout="vertical" size="large" style={{ marginTop: 16 }}>
          <Form.Item
            label={t('customers.name')}
            name="name"
            rules={[
              { required: true, message: t('customers.nameRequired') },
              { min: 2, message: 'Tên khách hàng phải có ít nhất 2 ký tự' },
            ]}
          >
            <Input placeholder={t('customers.namePlaceholder')} />
          </Form.Item>
          <Form.Item label={t('customers.phone')} name="phone">
            <Input
              prefix={<PhoneOutlined style={{ color: 'var(--text-muted)' }} />}
              placeholder={t('customers.phonePlaceholder')}
            />
          </Form.Item>
          <Form.Item label={t('customers.email')} name="email" rules={[
            { type: 'email', message: t('customers.emailInvalid') },
          ]} normalize={(value) => value || ''}>
            <Input
              prefix={<MailOutlined style={{ color: 'var(--text-muted)' }} />}
              placeholder={t('customers.emailPlaceholder')}
            />
          </Form.Item>
          <Form.Item label={t('customers.address')} name="address">
            <Input.TextArea
              rows={2}
              placeholder={t('customers.addressPlaceholder')}
            />
          </Form.Item>
          {/* CRM Phase 4 — mục 5. campaigns.service.js dùng zaloUserId || phone;
              nhập tay ở đây giúp tin Zalo tới đúng người thay vì gọi nhầm SĐT. */}
          <Form.Item
            label={t('customers.zaloUserId')}
            name="zaloUserId"
            extra={t('customers.zaloUserIdHelp')}
          >
            <Input prefix={<CommentOutlined style={{ color: 'var(--text-muted)' }} />} placeholder={t('customers.zaloUserIdPlaceholder')} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
