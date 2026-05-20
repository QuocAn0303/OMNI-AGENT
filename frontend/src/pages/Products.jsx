import { useEffect, useState } from 'react';
import useDebounce from '../hooks/useDebounce';
import { Table, Input, Select, Button, Image, Popconfirm, message, Space } from 'antd';
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
import useTour from '../hooks/useTour';
import { getProductsTour } from '../config/tourSteps';

/**
 * Products — Danh sách sản phẩm
 * Endpoints: GET /products, GET /categories, DELETE /products/:id
 */
export default function Products() {
  const { t } = useTranslation();
  const tour = useTour('products');
  const navigate = useNavigate();
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

  const loadData = async () => {
    setLoading(true);
    try {
      const [productsRes, categoriesRes] = await Promise.all([
        axios.get('/products', { params: { page, limit: 20, search: debouncedSearch, ...(categoryFilter && { categoryId: categoryFilter }) } }),
        axios.get('/categories'),
      ]);
      const pData = productsRes.data?.data || [];
      setData(pData.map(p => ({ ...p, categoryName: p.category?.name, quantity: p.inventory?.quantity ?? 0, minStock: p.inventory?.minStock ?? 0 })));
      setTotal(productsRes.data?.pagination?.total || 0);
      setCategories(Array.isArray(categoriesRes.data) ? categoriesRes.data : (categoriesRes.data?.data || []));
    } catch (err) {
      message.error('Không tải được danh sách sản phẩm');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, [page, debouncedSearch, categoryFilter]);
  useEffect(() => { setPage(1); }, [debouncedSearch, categoryFilter]);

  const handleDelete = async (id) => {
    try {
      await axios.delete(`/products/${id}`);
      message.success('Đã xóa sản phẩm');
      loadData();
    } catch (err) {
      message.error('Xóa thất bại');
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
      message.success('Đã xuất file Excel');
    } catch {
      message.error('Xuất Excel thất bại');
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
      title: 'Sản phẩm',
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
      title: 'Danh mục',
      dataIndex: 'categoryName',
      width: 140,
      render: (v) => v || <span style={{ color: 'var(--text-muted)' }}>—</span>,
    },
    {
      title: 'Giá bán',
      dataIndex: 'price',
      width: 140,
      align: 'right',
      sorter: (a, b) => a.price - b.price,
      render: (v) => <MoneyDisplay value={v} />,
    },
    {
      title: 'Tồn kho',
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
      title: 'Trạng thái',
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
          <Button
            type="text"
            size="small"
            icon={<EditOutlined />}
            onClick={() => navigate(`/products/${row.id}/edit`)}
          />
          <Popconfirm
            title="Xóa sản phẩm này?"
            description="Hành động không thể hoàn tác."
            okText="Xóa"
            cancelText="Hủy"
            okButtonProps={{ danger: true }}
            onConfirm={() => handleDelete(row.id)}
          >
            <Button type="text" size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <>
      <Joyride
        steps={getProductsTour(t)}
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
        title="Sản phẩm"
        subtitle={`${total} sản phẩm`}
        actions={
          <>
            <Button icon={<ExportOutlined />} loading={exporting} onClick={handleExportExcel}>Xuất Excel</Button>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => navigate('/products/create')}
            >
              Thêm sản phẩm
            </Button>
          </>
        }
      />

      {/* Filters */}
      <div className="filters-bar">
        <Input
          className="filters-bar__search"
          placeholder="Tìm theo tên hoặc SKU..."
          prefix={<SearchOutlined style={{ color: 'var(--text-muted)' }} />}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          allowClear
        />
        <Select
          placeholder="Danh mục"
          style={{ width: 180 }}
          value={categoryFilter}
          onChange={setCategoryFilter}
          allowClear
          suffixIcon={<FilterOutlined />}
          options={categories.map((c) => ({ value: c.id, label: c.name }))}
        />
        <Select
          placeholder="Tồn kho"
          style={{ width: 160 }}
          value={stockFilter}
          onChange={setStockFilter}
          allowClear
          options={[
            { value: 'IN_STOCK',  label: 'Còn hàng' },
            { value: 'LOW_STOCK', label: 'Sắp hết' },
            { value: 'OUT_STOCK', label: 'Hết hàng' },
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
            showTotal: (t) => `${t} sản phẩm`,
          }}
          locale={{
            emptyText: (
              <EmptyState
                title="Không tìm thấy sản phẩm"
                description="Thử bỏ bộ lọc hoặc thêm sản phẩm mới."
                action={
                  <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/products/create')}>
                    Thêm sản phẩm đầu tiên
                  </Button>
                }
              />
            ),
          }}
        />
      </div>
    </>
  );
}
