/**
 * Page: Invoices — Quản lý hóa đơn
 *
 * Tổng quan:
 * - Danh sách hóa đơn: mã, đơn hàng, khách hàng, tổng tiền, trạng thái
 * - Tải PDF, gửi email hóa đơn
 * - Gọi API: GET /invoices, GET /invoices/:id/download, POST /invoices/:id/send-email
 *
 * Exports:
 * - Invoices: React functional component (default export)
 */
import { useEffect, useState, useCallback } from 'react';
import { Table, Button, Space, Tag, Input, Select } from 'antd';
import { SearchOutlined, DownloadOutlined, MailOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import axios from '../api/axios';
import PageHeader from '../components/layout/PageHeader';
import EmptyState from '../components/shared/EmptyState';
import useToast from '../components/shared/useToast';
import PermissionGate from '../components/shared/PermissionGate';
import MoneyDisplay from '../components/shared/MoneyDisplay';

const STATUS_OPTIONS = ['PENDING', 'PAID', 'OVERDUE', 'CANCELLED', 'REFUNDED'];
const STATUS_COLOR = {
  PENDING: 'orange',
  PAID: 'green',
  OVERDUE: 'red',
  CANCELLED: 'default',
  REFUNDED: 'purple',
};

export default function Invoices() {
  const { t } = useTranslation();
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState(null);
  const [downloadingId, setDownloadingId] = useState(null);
  const [emailingId, setEmailingId] = useState(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get('/invoices', {
        params: { page, limit: 20, search: search || undefined, status: statusFilter || undefined },
      });
      setData(res.data?.data || []);
      setTotal(res.data?.pagination?.total || 0);
    } catch {
      toast.error(t('invoices.loadError'));
    } finally {
      setLoading(false);
    }
  }, [page, search, statusFilter, toast, t]);

  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => { setPage(1); }, [search, statusFilter]);

  const handleDownload = async (row) => {
    setDownloadingId(row.id);
    try {
      const res = await axios.get(`/invoices/${row.id}/download`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `${row.invoiceCode}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      toast.success(t('invoices.downloadSuccess'));
    } catch {
      toast.error(t('invoices.downloadError'));
    } finally {
      setDownloadingId(null);
    }
  };

  const handleSendEmail = async (row) => {
    setEmailingId(row.id);
    try {
      await axios.post(`/invoices/${row.id}/send-email`);
      toast.success(t('invoices.emailSuccess'));
      loadData();
    } catch {
      toast.error(t('invoices.emailError'));
    } finally {
      setEmailingId(null);
    }
  };

  const columns = [
    {
      title: t('invoices.code'),
      dataIndex: 'invoiceCode',
      width: 170,
      render: (v) => <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 500 }}>{v}</span>,
    },
    {
      title: t('invoices.order'),
      dataIndex: ['order', 'orderCode'],
      width: 160,
      render: (v) => v ? <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>{v}</span> : '—',
    },
    {
      title: t('invoices.customer'),
      width: 200,
      render: (_, row) => {
        const c = row.order?.customer;
        return c ? (
          <div>
            <div>{c.name || '—'}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{c.email || c.phone || ''}</div>
          </div>
        ) : '—';
      },
    },
    {
      title: t('invoices.total'),
      dataIndex: ['order', 'total'],
      width: 140,
      align: 'right',
      render: (v) => <MoneyDisplay value={v ?? 0} />,
    },
    {
      title: t('invoices.status'),
      dataIndex: 'status',
      width: 120,
      render: (v) => <Tag color={STATUS_COLOR[v] || 'default'}>{v || '—'}</Tag>,
    },
    {
      title: t('invoices.emailSent'),
      dataIndex: 'emailSentAt',
      width: 160,
      render: (v) => (
        v ? (
          <span style={{ fontSize: 13, color: 'var(--success)' }}>
            {new Date(v).toLocaleString('vi-VN')}
          </span>
        ) : (
          <span style={{ color: 'var(--text-muted)' }}>{t('invoices.notSent')}</span>
        )
      ),
    },
    {
      title: t('invoices.createdAt'),
      dataIndex: 'createdAt',
      width: 160,
      render: (v) => new Date(v).toLocaleDateString('vi-VN'),
    },
    {
      title: '',
      width: 100,
      align: 'right',
      fixed: 'right',
      render: (_, row) => (
        <Space size={4}>
          <Button
            type="text" size="small" icon={<DownloadOutlined />}
            loading={downloadingId === row.id}
            onClick={() => handleDownload(row)}
          />
          <PermissionGate permission="orders.edit">
            <Button
              type="text" size="small" icon={<MailOutlined />}
              loading={emailingId === row.id}
              disabled={!row.order?.customer?.email}
              title={t('invoices.sendEmail')}
              onClick={() => handleSendEmail(row)}
            />
          </PermissionGate>
        </Space>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title={t('invoices.title')}
        subtitle={t('invoices.count', { count: total })}
      />

      <div className="filters-bar">
        <Input
          className="filters-bar__search"
          placeholder={t('invoices.searchPlaceholder')}
          prefix={<SearchOutlined style={{ color: 'var(--text-muted)' }} />}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          allowClear
        />
        <Select
          placeholder={t('invoices.status')}
          style={{ width: 160 }}
          value={statusFilter}
          onChange={setStatusFilter}
          allowClear
          options={STATUS_OPTIONS.map((s) => ({ value: s, label: s }))}
        />
      </div>

      <div className="table-card">
        <Table
          columns={columns}
          dataSource={data}
          rowKey="id"
          loading={loading}
          scroll={{ x: 1100 }}
          pagination={{
            current: page,
            pageSize: 20,
            total,
            showSizeChanger: false,
            onChange: (p) => setPage(p),
            showTotal: (totalCount) => t('invoices.count', { count: totalCount }),
          }}
          locale={{ emptyText: <EmptyState title={t('invoices.empty')} description={t('invoices.emptyDesc')} /> }}
        />
      </div>
    </>
  );
}
