/**
 * Page: Inventory — Quản lý kho hàng
 *
 * Tổng quan:
 * - 4 tabs: Tồn kho hiện tại / Nhập kho / Xuất kho / Lịch sử giao dịch
 * - Tab Stock: hiển thị tồn kho từng sản phẩm, cảnh báo hết hàng/sắp hết
 * - Tab Import/Export: form nhập/xuất kho với chọn sản phẩm, số lượng, đơn giá
 * - Tab History: lịch sử giao dịch (IMPORT/EXPORT/ADJUSTMENT/RETURN...)
 * - Gọi API: GET /inventory, GET /inventory/transactions, POST /inventory/import|export
 * - Tích hợp Joyride tour và i18n
 *
 * Exports:
 * - Inventory: React functional component (default export)
 */
import { useEffect, useState } from 'react';
import useDebounce from '../hooks/useDebounce';
import { Tabs, Table, Button, Input, Select, message, Modal, Form, InputNumber, Alert, DatePicker } from 'antd';
import {
  PlusOutlined, MinusOutlined, SearchOutlined, ImportOutlined, ExportOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import axios from '../api/axios';
import PageHeader from '../components/layout/PageHeader';
import StatusTag from '../components/shared/StatusTag';
import MoneyDisplay from '../components/shared/MoneyDisplay';
import EmptyState from '../components/shared/EmptyState';
import PermissionGate from '../components/shared/PermissionGate';
import useAuthStore from '../stores/authStore';
import { Joyride } from 'react-joyride';
import { useTranslation } from 'react-i18next';
import useTour from '../hooks/useTour';
import { getInventoryTour } from '../config/tourSteps';

/**
 * Inventory — Quản lý kho
 * 4 tabs: Tồn kho hiện tại / Nhập kho / Xuất kho / Lịch sử giao dịch
 *
 * Endpoints:
 *   GET  /inventory               — current stock
 *   GET  /inventory/transactions  — history
 *   POST /inventory/import        — nhập kho
 *   POST /inventory/export        — xuất kho (giảm tồn, ghi EXPORT)
 */
export default function Inventory() {
  const { t } = useTranslation();
  const tour = useTour('inventory');

  const [activeTab, setActiveTab] = useState('stock');

  const role = useAuthStore((s) => s.user?.role);

  const ROLE_TAB_PERMS = {
    SUPER_OMEGA_ULTRA_ADMIN: ['inventory.view', 'inventory.import', 'inventory.export', 'inventory.adjust'],
    SUPER_ADMIN: ['inventory.view', 'inventory.import', 'inventory.export', 'inventory.adjust'],
    ADMIN: ['inventory.view', 'inventory.import', 'inventory.export', 'inventory.adjust'],
    MANAGER: ['inventory.view', 'inventory.import', 'inventory.export'],
    CASHIER: ['inventory.view'],
    WAREHOUSE: ['inventory.view', 'inventory.import', 'inventory.export'],
    ACCOUNTANT: [],
  };
  const userTabPerms = ROLE_TAB_PERMS[role] || [];

  const tabItems = [
    { key: 'stock',     label: t('inventory.stock'),     children: <StockTab />, permission: 'inventory.view' },
    { key: 'import',    label: t('inventory.importTab'),    children: <ImportTab />, permission: 'inventory.import' },
    { key: 'export',    label: t('inventory.exportTab'),    children: <ExportTab />, permission: 'inventory.export' },
    { key: 'adjust',    label: t('inventory.adjust'),    children: <AdjustTab />, permission: 'inventory.adjust' },
    { key: 'history',   label: t('inventory.historyTab'),   children: <HistoryTab />, permission: 'inventory.view' },
  ].filter(tab => userTabPerms.includes(tab.permission));

  return (
    <>
      <Joyride
        steps={getInventoryTour(t)}
        run={tour.run}
        continuous
        showSkipButton
        showProgress
        locale={{
          back: t('tour.joyride.back'),
          close: t('tour.joyride.close'),
          last: t('tour.joyride.last'),
          next: t('tour.joyride.next'),
          skip: t('tour.joyride.skip'),
        }}
        styles={{
          options: { zIndex: 10000, primaryColor: '#0d9488' },
        }}
        callback={(data) => {
          if (data.status === 'finished' || data.status === 'skipped') {
            tour.markDone();
          }
        }}
      />

      <PageHeader
        title={t('inventory.pageTitle')}
        subtitle={t('inventory.pageSubtitle')}
      />

      <Tabs
        activeKey={activeTab}
        onChange={(key) => setActiveTab(key)}
        items={tabItems}
      />
    </>
  );
}

// ===== TAB 1: Stock =====
function StockTab() {
  const { t } = useTranslation();
  const [data, setData] = useState([]);
  const [alerts, setAlerts] = useState({ critical: [], warning: [] });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  const load = async () => {
    setLoading(true);
    try {
      const res = await axios.get('/products', { params: { page, limit: 20, search: debouncedSearch || '' } });
      const pData = res.data?.data || [];
      setTotal(res.data?.pagination?.total || 0);
      setData(pData.map(p => ({
        ...p,
        categoryName: p.category?.name,
        quantity: p.inventory?.quantity ?? 0,
        reserved: p.inventory?.reserved ?? 0,
        available: (p.inventory?.quantity ?? 0) - (p.inventory?.reserved ?? 0),
        minStock: p.inventory?.minStock ?? 0,
        cost: p.costPrice ?? 0,
      })));
    } catch {
      message.error('Không tải được tồn kho');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [page, debouncedSearch]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch]);

  useEffect(() => {
    axios.get('/inventory/alerts').then((alertRes) => {
      setAlerts(alertRes.data?.data || { critical: [], warning: [] });
    });
  }, []);

  return (
    <>
      <div className="filters-bar" style={{ marginTop: 8 }}>
        <Input
          className="filters-bar__search"
          placeholder={t('inventory.stock') + '...'}
          prefix={<SearchOutlined style={{ color: 'var(--text-muted)' }} />}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          allowClear
        />
      </div>

      {(alerts.critical.length > 0 || alerts.warning.length > 0) && (
        <div style={{ display: 'grid', gap: 8, marginBottom: 12 }}>
          {alerts.critical.length > 0 && (
            <Alert type="error" showIcon message={`${alerts.critical.length} sản phẩm đã hết hàng hoặc hết khả dụng`} />
          )}
          {alerts.warning.length > 0 && (
            <Alert type="warning" showIcon message={`${alerts.warning.length} sản phẩm sắp hết hàng`} />
          )}
        </div>
      )}

      <div className="table-card">
        <Table
          loading={loading}
          dataSource={data}
          rowKey="id"
          scroll={{ x: 1000 }}
          pagination={{ current: page, pageSize: 20, total, showSizeChanger: false, onChange: (p) => setPage(p) }}
          locale={{ emptyText: <EmptyState title={t('inventory.noProducts')} /> }}
          columns={[
            {
              title: 'Sản phẩm',
              dataIndex: 'name',
              render: (name, row) => (
                <div>
                  <div style={{ fontWeight: 500 }}>{name}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                    {row.sku}
                  </div>
                </div>
              ),
            },
            { title: 'Danh mục', dataIndex: 'categoryName', width: 140 },
            {
              title: 'Tồn kho',
              dataIndex: 'quantity',
              align: 'right',
              width: 110,
              sorter: (a, b) => a.quantity - b.quantity,
              render: (q, row) => (
                <span style={{
                  fontWeight: 500,
                  color: q === 0 ? 'var(--danger)' : q <= row.minStock ? 'var(--warning-dark)' : 'var(--text-primary)',
                }}>
                  {q.toLocaleString('vi-VN')}
                </span>
              ),
            },
            { title: 'Tối thiểu', dataIndex: 'minStock', align: 'right', width: 100 },
            { title: 'Đã giữ', dataIndex: 'reserved', align: 'right', width: 100 },
            {
              title: 'Có thể bán',
              dataIndex: 'available',
              align: 'right',
              width: 110,
              sorter: (a, b) => a.available - b.available,
            },
            {
              title: 'Giá trị tồn',
              align: 'right',
              width: 140,
              render: (_, row) => <MoneyDisplay value={row.quantity * row.cost} />,
            },
            {
              title: 'Trạng thái',
              dataIndex: 'quantity',
              width: 130,
              render: (q, row) => (
                <StatusTag status={q === 0 ? 'OUT_STOCK' : q <= row.minStock ? 'LOW_STOCK' : 'IN_STOCK'} />
              ),
            },
          ]}
        />
      </div>
    </>
  );
}

// ===== TAB 2: Import =====
function ImportTab() {
  return <TransactionForm type="import" />;
}

// ===== TAB 3: Export =====
function ExportTab() {
  return <TransactionForm type="export" />;
}

// Generic form cho cả nhập và xuất
function TransactionForm({ type }) {
  const [form] = Form.useForm();
  const [products, setProducts] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const isImport = type === 'import';

  useEffect(() => {
    axios.get('/products').then((res) => {
      const list = Array.isArray(res.data) ? res.data : (res.data?.data || []);
      setProducts(list.map((p) => ({ ...p, quantity: p.inventory?.quantity ?? 0 })));
    });
  }, []);

  const handleSubmit = async (values) => {
    setSubmitting(true);
    try {
      const { notes, unitCost, productId, quantity, lotCode, expDate } = values;
      const body = { productId, quantity, note: notes || undefined };
      if (isImport && unitCost != null) body.unitCost = unitCost;
      if (isImport && lotCode) body.lotCode = lotCode;
      if (isImport && expDate) body.expDate = expDate.toISOString();
      await axios.post(`/inventory/${type}`, body);
      message.success(isImport ? 'Đã nhập kho' : 'Đã xuất kho');
      form.resetFields();
    } catch (err) {
      message.error(err?.response?.data?.message || 'Thao tác thất bại');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{
      maxWidth: 560,
      background: 'var(--bg-secondary)',
      border: '1px solid var(--border-light)',
      borderRadius: 'var(--radius-lg)',
      padding: 24,
      marginTop: 8,
    }}>
      <Form form={form} layout="vertical" onFinish={handleSubmit} size="large">
        <Form.Item
          label="Sản phẩm"
          name="productId"
          rules={[{ required: true, message: 'Chọn sản phẩm' }]}
        >
          <Select
            showSearch
            placeholder="Tìm và chọn sản phẩm..."
            filterOption={(input, option) =>
              (option?.label || '').toLowerCase().includes(input.toLowerCase())
            }
            options={products.map((p) => ({
              value: p.id,
              label: `${p.sku} — ${p.name} (Tồn: ${p.quantity})`,
            }))}
          />
        </Form.Item>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <Form.Item
            label="Số lượng"
            name="quantity"
            rules={[{ required: true, message: 'Nhập số lượng' }]}
          >
            <InputNumber min={1} style={{ width: '100%' }} />
          </Form.Item>
          {isImport && (
            <Form.Item
              label="Đơn giá nhập"
              name="unitCost"
              rules={[{ required: true, message: 'Nhập đơn giá' }]}
            >
              <InputNumber
                min={0}
                step={1000}
                style={{ width: '100%' }}
                formatter={(v) => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                parser={(v) => v.replace(/,/g, '')}
                addonAfter="₫"
              />
            </Form.Item>
          )}
        </div>

        {isImport && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <Form.Item label="Mã lô" name="lotCode">
                <Input placeholder="LOT-2024-001" />
              </Form.Item>
              <Form.Item label="Hạn sử dụng" name="expDate">
                <DatePicker style={{ width: '100%' }} format="DD/MM/YYYY" />
              </Form.Item>
            </div>
          </>
        )}
        <Form.Item label="Ghi chú" name="notes">
          <Input.TextArea
            rows={3}
            placeholder={isImport ? 'Nhà cung cấp, lý do nhập...' : 'Lý do xuất kho (hỏng, mất, biếu tặng...)'}
          />
        </Form.Item>

        <Button
          type="primary"
          htmlType="submit"
          loading={submitting}
          icon={isImport ? <ImportOutlined /> : <ExportOutlined />}
          size="large"
          style={{ marginTop: 8 }}
        >
          {isImport ? 'Xác nhận nhập kho' : 'Xác nhận xuất kho'}
        </Button>
      </Form>
    </div>
  );
}

// ===== TAB 4: Adjust =====
function AdjustTab() {
  const [form] = Form.useForm();
  const [products, setProducts] = useState([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    axios.get('/products').then((res) => setProducts(Array.isArray(res.data) ? res.data : (res.data?.data || [])));
  }, []);

  const handleSubmit = async (values) => {
    setSubmitting(true);
    try {
      const body = { productId: values.productId, actualQuantity: values.actualQuantity, note: values.note || undefined };
      await axios.post('/inventory/adjust', body);
      message.success('Đã điều chỉnh tồn kho');
      form.resetFields();
    } catch (err) {
      message.error(err?.response?.data?.message || 'Điều chỉnh thất bại');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ maxWidth: 560, background: 'var(--bg-secondary)', border: '1px solid var(--border-light)', borderRadius: 'var(--radius-lg)', padding: 24, marginTop: 8 }}>
      <p style={{ color: 'var(--text-muted)', marginBottom: 16 }}>Nhập số lượng thực tế kiểm đếm được. Hệ thống tự tính chênh lệch và ghi nhận.</p>
      <Form form={form} layout="vertical" onFinish={handleSubmit} size="large">
        <Form.Item label="Sản phẩm" name="productId" rules={[{ required: true, message: 'Chọn sản phẩm' }]}>
          <Select
            showSearch placeholder="Tìm và chọn sản phẩm..."
            filterOption={(input, option) => (option?.label || '').toLowerCase().includes(input.toLowerCase())}
            options={products.map((p) => ({ value: p.id, label: `${p.sku} — ${p.name}` }))}
          />
        </Form.Item>
        <Form.Item label="Số lượng thực tế" name="actualQuantity" rules={[{ required: true, message: 'Nhập số lượng' }]}>
          <InputNumber min={0} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item label="Ghi chú" name="note">
          <Input.TextArea rows={3} placeholder="Lý do chênh lệch..." />
        </Form.Item>
        <Button type="primary" htmlType="submit" loading={submitting} size="large" style={{ marginTop: 8 }}>
          Xác nhận kiểm kho
        </Button>
      </Form>
    </div>
  );
}

// ===== TAB 5: History =====
function HistoryTab() {
  const { t } = useTranslation();
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await axios.get('/inventory/transactions');
        const payload = res.data?.data;
        const list = Array.isArray(payload)
          ? payload
          : (payload?.transactions ?? []);
        setData(
          list.map((t) => ({
            ...t,
            productName: t.productName ?? t.inventory?.product?.name ?? '—',
            productSku: t.productSku ?? t.inventory?.product?.sku ?? '',
            notes: t.notes ?? t.note ?? '',
            createdByName: t.createdByName ?? t.createdBy?.fullName ?? '—',
          })),
        );
      } catch {
        message.error('Không tải được lịch sử');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filtered = typeFilter ? data.filter((t) => t.type === typeFilter) : data;

  return (
    <>
      <div className="filters-bar" style={{ marginTop: 8 }}>
        <Select
          placeholder="Loại giao dịch"
          style={{ width: 180 }}
          value={typeFilter}
          onChange={setTypeFilter}
          allowClear
          options={[
            { value: 'IMPORT', label: 'Nhập kho' },
            { value: 'EXPORT', label: 'Xuất kho' },
            { value: 'ADJUSTMENT', label: 'Kiểm kho' },
            { value: 'RETURN', label: 'Trả hàng' },
            { value: 'RESERVATION', label: 'Giữ hàng' },
            { value: 'RESERVATION_RELEASE', label: 'Bỏ giữ' },
          ]}
        />
      </div>

      <div className="table-card">
        <Table
          loading={loading}
          dataSource={filtered}
          rowKey="id"
          scroll={{ x: 1100 }}
          pagination={{ pageSize: 20 }}
          locale={{ emptyText: <EmptyState title={t('inventory.noTransactions')} /> }}
          columns={[
            {
              title: 'Thời gian',
              dataIndex: 'createdAt',
              width: 140,
              defaultSortOrder: 'descend',
              sorter: (a, b) => dayjs(a.createdAt).unix() - dayjs(b.createdAt).unix(),
              render: (d) => (
                <div>
                  <div style={{ fontSize: 13 }}>{dayjs(d).format('DD/MM/YYYY')}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{dayjs(d).format('HH:mm')}</div>
                </div>
              ),
            },
            {
              title: 'Loại',
              dataIndex: 'type',
              width: 110,
              render: (t) => {
                const map = {
                  IMPORT: { variant: 'success', label: 'Nhập' },
                  EXPORT: { variant: 'warning', label: 'Xuất' },
                  ADJUSTMENT: { variant: 'neutral', label: 'Kiểm kho' },
                  RETURN: { variant: 'info', label: 'Trả' },
                  RESERVATION: { variant: 'neutral', label: 'Giữ' },
                  RESERVATION_RELEASE: { variant: 'neutral', label: 'Bỏ giữ' },
                };
                const cfg = map[t] || { variant: 'neutral', label: t };
                return <StatusTag variant={cfg.variant} label={cfg.label} status={t} />;
              },
            },
            {
              title: 'Sản phẩm',
              dataIndex: 'productName',
              render: (name, row) => (
                <div>
                  <div style={{ fontWeight: 500 }}>{name}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                    {row.productSku}
                  </div>
                </div>
              ),
            },
            {
              title: 'Số lượng',
              dataIndex: 'quantity',
              width: 110,
              align: 'right',
              render: (q, row) => {
                const isImport = row.type === 'IMPORT';
                const isAdjust = row.type === 'ADJUSTMENT';
                const color = isImport || (isAdjust && q > 0)
                  ? 'var(--success-dark)'
                  : 'var(--danger-dark)';
                const text = isAdjust
                  ? `${q > 0 ? '+' : ''}${q}`
                  : `${isImport ? '+' : '−'}${Math.abs(q)}`;
                return (
                  <span style={{ fontWeight: 500, color }}>{text}</span>
                );
              },
            },
            {
              title: 'Giá trị',
              dataIndex: 'totalValue',
              width: 130,
              align: 'right',
              render: (v) => v ? <MoneyDisplay value={v} /> : '—',
            },
            { title: 'Ghi chú', dataIndex: 'notes', ellipsis: true },
            { title: 'Người tạo', dataIndex: 'createdByName', width: 120 },
          ]}
        />
      </div>
    </>
  );
}
