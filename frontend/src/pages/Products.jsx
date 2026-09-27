/**
 * Page: Products — Danh sách sản phẩm
 *
 * Tổng quan:
 * - Hiển thị danh sách sản phẩm dạng table với ảnh, SKU, giá bán, tồn kho, trạng thái
 * - Bộ lọc: tìm kiếm theo tên/SKU, lọc theo danh mục, lọc theo tình trạng tồn kho
 * - Chức năng: xem, sửa (điều hướng), xóa (Popconfirm), xuất Excel
 * - Gọi API: GET /products, GET /categories, DELETE /products/:id
 * - Tích hợp Joyride tour và i18n
 * - Sử dụng StatusTag, MoneyDisplay, EmptyState, PageHeader
 *
 * Exports:
 * - Products: React functional component (default export)
 */
import { useEffect, useState, useRef } from 'react';
import useDebounce from '../hooks/useDebounce';
import { Table, Input, Select, Button, Image, Popconfirm, Space } from 'antd';
import {
  PlusOutlined, SearchOutlined, EditOutlined, DeleteOutlined,
  ExportOutlined, FilterOutlined,
} from '@ant-design/icons';
import { Joyride } from 'react-joyride';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import axios from '../api/axios';
import PageHeader from '../components/layout/PageHeader';
import StatusTag from '../components/shared/StatusTag';
import MoneyDisplay from '../components/shared/MoneyDisplay';
import EmptyState from '../components/shared/EmptyState';
import useToast from '../components/shared/useToast';
import useTour from '../hooks/useTour';
import PermissionGate from '../components/shared/PermissionGate';

/**
 * Products — Danh sách sản phẩm
 * Endpoints: GET /products, GET /categories, DELETE /products/:id
 */
export default function Products() {
  const { t } = useTranslation();
  useTour('products');
  const navigate = useNavigate();
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState([]);
  const [categories, setCategories] = useState([]);

  // Filter state
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const [categoryFilter, setCategoryFilter] = useState(null);
  const [stockFilter, setStockFilter] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const cacheRef = useRef({});

  const loadData = async () => {
    const cacheKey = `/products?page=${page}&search=${debouncedSearch}&category=${categoryFilter}`;
    const cached = cacheRef.current[cacheKey];
    if (cached && Date.now() - cached.ts < 15000) {
      setData(cached.data);
      setTotal(cached.total);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [productsRes, categoriesRes] = await Promise.all([
        axios.get('/products', { params: { page, limit: 20, search: debouncedSearch, ...(categoryFilter && { categoryId: categoryFilter }) } }),
        axios.get('/categories'),
      ]);
      const pData = productsRes.data?.data || [];
      const mapped = pData.map(p => ({ ...p, categoryName: p.category?.name, quantity: p.inventory?.quantity ?? 0, minStock: p.inventory?.minStock ?? 0 }));
      setData(mapped);
      setTotal(productsRes.data?.pagination?.total || 0);
      setCategories(Array.isArray(categoriesRes.data) ? categoriesRes.data : (categoriesRes.data?.data || []));
      cacheRef.current[cacheKey] = { ts: Date.now(), data: mapped, total: productsRes.data?.pagination?.total || 0 };
    } catch {
      toast.error(t('products.loadError'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, [page, debouncedSearch, categoryFilter]);
  useEffect(() => { setPage(1); }, [debouncedSearch, categoryFilter]);

  const handleDelete = async (id) => {
    try {
      await axios.delete(`/products/${id}`);
      cacheRef.current = {};
      toast.success(t('products.deleteSuccess'));
      loadData();
    } catch {
      toast.error(t('products.deleteError'));
    }
  };

  const handleExportExcel = async () => {
    setExporting(true);
    try {
      const res = await axios.get('/products/export-excel', { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'san-pham.xlsx');
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      toast.success(t('products.exportSuccess'));
    } catch {
      toast.error(t('products.exportError'));
    } finally {
      setExporting(false);
    }
  };

  const displayData = stockFilter ? data.filter(p => {
    if (stockFilter === 'IN_STOCK' && p.quantity <= 0) return false;
    if (stockFilter === 'LOW_STOCK' && (p.quantity > p.minStock || p.quantity <= 0)) return false;
    if (stockFilter === 'OUT_STOCK' && p.quantity > 0) return false;
    return true;
  }) : data;

  const columns = [
    {
      title: t('products.title'),
      dataIndex: 'name',
      width: 320,
      render: (name, row) => (
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <div style={{
            width: 44, height: 44,
            borderRadius: 'var(--radius-md)',
            background: 'var(--bg-tertiary)',
            display: 'grid', placeItems: 'center',
            overflow: 'hidden', flexShrink: 0,
          }}>
            {row.imageUrl ? (
              <Image
                src={row.imageUrl}
                width={44} height={44}
                style={{ objectFit: 'cover' }}
                preview={false}
              />
            ) : (
              <span style={{ fontSize: 18, color: 'var(--text-muted)' }}>📦</span>
            )}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{name}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
              {row.sku}
            </div>
          </div>
        </div>
      ),
    },
    {
      title: t('products.category'),
      dataIndex: 'categoryName',
      width: 140,
      render: (v) => v || <span style={{ color: 'var(--text-muted)' }}>—</span>,
    },
    {
      title: t('products.price'),
      dataIndex: 'price',
      width: 140,
      align: 'right',
      sorter: (a, b) => a.price - b.price,
      render: (v) => <MoneyDisplay value={v} />,
    },
    {
      title: t('products.stock'),
      dataIndex: 'quantity',
      width: 110,
      align: 'right',
      sorter: (a, b) => a.quantity - b.quantity,
      render: (q, row) => (
        <span style={{
          fontVariantNumeric: 'tabular-nums',
          fontWeight: 500,
          color: q === 0 ? 'var(--danger)'
              : q <= row.minStock ? 'var(--warning-dark)'
              : 'var(--text-primary)',
        }}>
          {q.toLocaleString('vi-VN')}
        </span>
      ),
    },
    {
      title: t('common.status'),
      dataIndex: 'quantity',
      width: 130,
      render: (q, row) => (
        <StatusTag status={
          q === 0 ? 'OUT_STOCK' :
          q <= row.minStock ? 'LOW_STOCK' : 'IN_STOCK'
        } />
      ),
    },
    {
      title: '',
      width: 100,
      align: 'right',
      fixed: 'right',
      render: (_, row) => (
        <Space size={4}>
          <PermissionGate permission="products.edit">
            <Button
              type="text"
              size="small"
              icon={<EditOutlined />}
              onClick={() => navigate(`/products/${row.id}/edit`)}
            />
          </PermissionGate>
          <PermissionGate permission="products.delete">
            <Popconfirm
              title={t('products.deleteConfirm')}
              description={t('products.deleteWarning')}
              okText={t('common.delete')}
              cancelText={t('common.cancel')}
              okButtonProps={{ danger: true }}
              onConfirm={() => handleDelete(row.id)}
            >
              <Button type="text" size="small" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          </PermissionGate>
        </Space>
      ),
    },
  ];

  return (

    <>
      <PageHeader
        title={t('products.title')}
        subtitle={t('products.count', { count: total })}
        actions={
          <>
            <PermissionGate permission="reports.export">
              <Button icon={<ExportOutlined />} loading={exporting} onClick={handleExportExcel}>{t('products.exportBtn')}</Button>
            </PermissionGate>
            <PermissionGate permission="products.create">
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => navigate('/products/create')}
              >
                {t('products.addNew')}
              </Button>
            </PermissionGate>
          </>
        }
      />

      {/* Filters */}
      <div className="filters-bar">
        <Input
          className="filters-bar__search"
          placeholder={t('products.searchPlaceholder')}
          prefix={<SearchOutlined style={{ color: 'var(--text-muted)' }} />}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          allowClear
        />
        <Select
          placeholder={t('products.categoryPlaceholder')}
          style={{ width: 180 }}
          value={categoryFilter}
          onChange={setCategoryFilter}
          allowClear
          suffixIcon={<FilterOutlined />}
          options={categories.map((c) => ({ value: c.id, label: c.name }))}
        />
        <Select
          placeholder={t('products.stockPlaceholder')}
          style={{ width: 160 }}
          value={stockFilter}
          onChange={setStockFilter}
          allowClear
          options={[
            { value: 'IN_STOCK',  label: t('products.inStock') },
            { value: 'LOW_STOCK', label: t('products.lowStock') },
            { value: 'OUT_STOCK', label: t('products.outOfStock') },
          ]}
        />
      </div>

      {/* Table */}
      <div className="table-card">
        <Table
          columns={columns}
          dataSource={displayData}
          rowKey="id"
          loading={loading}
          scroll={{ x: 900 }}
          pagination={{
            current: page,
            pageSize: 20,
            total,
            showSizeChanger: false,
            onChange: (p) => setPage(p),
            showTotal: (totalCount) => t('products.count', { count: totalCount }),
          }}
          locale={{
            emptyText: (
              <EmptyState
                title={t('products.empty')}
                description={t('products.emptyDesc')}
                action={
                  <PermissionGate permission="products.create">
                    <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/products/create')}>
                      {t('products.addFirst')}
                    </Button>
                  </PermissionGate>
                }
              />
            ),
          }}
        />
      </div>
    </>
  );
}
