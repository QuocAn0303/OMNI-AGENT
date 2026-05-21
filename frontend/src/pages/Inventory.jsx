import { useEffect, useState } from 'react';
import useDebounce from '../hooks/useDebounce';
import { Tabs, Table, Button, Input, Select, message, Modal, Form, InputNumber, Alert } from 'antd';
import {
  PlusOutlined, MinusOutlined, SearchOutlined, ImportOutlined, ExportOutlined,
} from '@ant-design/icons';
import { Joyride } from 'react-joyride';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import axios from '../api/axios';
import PageHeader from '../components/layout/PageHeader';
import StatusTag from '../components/shared/StatusTag';
import MoneyDisplay from '../components/shared/MoneyDisplay';
import EmptyState from '../components/shared/EmptyState';
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

  return (
    <>
      <Joyride
        steps={getInventoryTour(t)}
        run={tour.run}
        continuous
        showSkipButton
        showProgress
        callback={({ status }) => {
          if (status === 'finished' || status === 'skipped') tour.markDone();
        }}
        styles={{ options: { primaryColor: '#0f766e', zIndex: 2000 } }}
      />
      <PageHeader
        title="Kho hàng"
        subtitle="Quản lý tồn kho, nhập xuất, lịch sử giao dịch"
      />

      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          { key: 'stock',   label: 'Tồn kho',     children: <StockTab /> },
          { key: 'import',  label: 'Nhập kho',    children: <ImportTab /> },
          { key: 'export',  label: 'Xuất kho',    children: <ExportTab /> },
          { key: 'history', label: 'Lịch sử',     children: <HistoryTab /> },
        ]}
      />
    </>
  );
}

// ===== TAB 1: Stock =====
function StockTab() {
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
          placeholder="Tìm sản phẩm theo tên hoặc SKU..."
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
          locale={{ emptyText: <EmptyState title="Chưa có sản phẩm" /> }}
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
    axios.get('/products').then((res) => setProducts(Array.isArray(res.data) ? res.data : (res.data?.data || [])));
  }, []);

  const handleSubmit = async (values) => {
    setSubmitting(true);
    try {
      const { notes, unitCost, productId, quantity } = values;
      const body = { productId, quantity, note: notes || undefined };
      if (isImport && unitCost != null) body.unitCost = unitCost;
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

// ===== TAB 4: History =====
function HistoryTab() {
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
          locale={{ emptyText: <EmptyState title="Chưa có giao dịch" /> }}
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
