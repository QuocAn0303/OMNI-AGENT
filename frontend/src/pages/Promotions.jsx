/**
 * Page: Promotions — Quản lý khuyến mãi
 *
 * Tổng quan:
 * - Danh sách khuyến mãi dạng table (phân trang, lọc theo trạng thái/loại)
 * - Tạo/sửa khuyến mãi qua Form Modal (7 loại: PERCENTAGE, FIXED_AMOUNT, BUY_X_GET_Y, CATEGORY_DISCOUNT, PRODUCT_DISCOUNT, FREE_SHIPPING, HAPPY_HOUR)
 * - Kích hoạt / tạm dừng nhanh, xóa có xác nhận
 * - Báo cáo hiệu quả khuyến mãi
 * - Gọi API: GET/POST/PATCH/DELETE /promotions, GET /promotions/report, POST /promotions/:id/activate, POST /promotions/:id/pause
 *
 * Exports:
 * - Promotions: React functional component (default export)
 */
import { useEffect, useState, useCallback } from 'react';
import { Table, Button, Space, Tag, Popconfirm, Modal, Form, Input, InputNumber, Select, DatePicker, Tabs } from 'antd';
import {
  PlusOutlined, PlayCircleOutlined, PauseCircleOutlined,
  DeleteOutlined, EditOutlined, BarChartOutlined, SearchOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import axios from '../api/axios';
import PageHeader from '../components/layout/PageHeader';
import EmptyState from '../components/shared/EmptyState';
import useToast from '../components/shared/useToast';
import PermissionGate from '../components/shared/PermissionGate';

const TYPE_OPTIONS = [
  { value: 'PERCENTAGE', label: 'Giảm theo %' },
  { value: 'FIXED_AMOUNT', label: 'Giảm cố định (VNĐ)' },
  { value: 'BUY_X_GET_Y', label: 'Mua X tặng Y' },
  { value: 'CATEGORY_DISCOUNT', label: 'Giảm theo danh mục' },
  { value: 'PRODUCT_DISCOUNT', label: 'Giảm theo sản phẩm' },
  { value: 'FREE_SHIPPING', label: 'Miễn phí vận chuyển' },
  { value: 'HAPPY_HOUR', label: 'Happy Hour' },
];

const STATUS_OPTIONS = [
  { value: 'DRAFT', label: 'Nháp' },
  { value: 'ACTIVE', label: 'Đang chạy' },
  { value: 'PAUSED', label: 'Tạm dừng' },
  { value: 'EXPIRED', label: 'Hết hạn' },
];

const STATUS_COLOR = {
  DRAFT: 'default',
  ACTIVE: 'green',
  PAUSED: 'orange',
  EXPIRED: 'red',
};

export default function Promotions() {
  const { t } = useTranslation();
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState([]);
  const [categories, setCategories] = useState([]);
  const [products, setProducts] = useState([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState(null);
  const [typeFilter, setTypeFilter] = useState(null);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('list');
  const [report, setReport] = useState([]);
  const [reportLoading, setReportLoading] = useState(false);
  const [form] = Form.useForm();
  const scheduleType = Form.useWatch('scheduleType', form);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get('/promotions', {
        params: {
          page,
          limit: 20,
          status: statusFilter || undefined,
          type: typeFilter || undefined,
          search: search || undefined,
        },
      });
      setData(res.data?.data || []);
      setTotal(res.data?.pagination?.total || 0);
    } catch {
      toast.error(t('promotions.loadError'));
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, typeFilter, search, toast, t]);

  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => { setPage(1); }, [statusFilter, typeFilter, search]);

  const loadOptions = async () => {
    try {
      const [catRes, prodRes] = await Promise.all([
        axios.get('/categories'),
        axios.get('/products', { params: { limit: 200 } }),
      ]);
      setCategories(Array.isArray(catRes.data) ? catRes.data : (catRes.data?.data || []));
      setProducts(Array.isArray(prodRes.data) ? prodRes.data : (prodRes.data?.data || []));
    } catch { /* options optional */ }
  };

  const loadReport = async () => {
    setReportLoading(true);
    try {
      const res = await axios.get('/promotions/report');
      setReport(res.data?.data || []);
    } catch {
      toast.error(t('promotions.reportError'));
    } finally {
      setReportLoading(false);
    }
  };

  useEffect(() => {
    loadOptions();
    if (activeTab === 'report') loadReport();
  }, [activeTab]);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ scope: 'AUTO', status: 'DRAFT', type: 'PERCENTAGE' });
    setModalOpen(true);
  };

  const openEdit = (row) => {
    setEditing(row);
    form.setFieldsValue({
      ...row,
      startDate: row.startDate ? undefined : undefined,
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      const payload = {
        ...values,
        startDate: values.startDate ? values.startDate.toISOString() : undefined,
        endDate: values.endDate ? values.endDate.toISOString() : undefined,
      };
      if (payload.type !== 'HAPPY_HOUR') {
        delete payload.scheduleType;
        delete payload.cronExpression;
        delete payload.daysOfWeek;
        delete payload.startTime;
        delete payload.endTime;
      }
      if (editing) {
        await axios.patch(`/promotions/${editing.id}`, payload);
        toast.success(t('promotions.updateSuccess'));
      } else {
        await axios.post('/promotions', payload);
        toast.success(t('promotions.createSuccess'));
      }
      setModalOpen(false);
      loadData();
    } catch (e) {
      if (e?.errorFields) return;
      toast.error(t('promotions.saveError'));
    } finally {
      setSaving(false);
    }
  };

  const handleStatus = async (row, status) => {
    try {
      await axios.post(`/promotions/${row.id}/${status === 'ACTIVE' ? 'activate' : 'pause'}`);
      toast.success(status === 'ACTIVE' ? t('promotions.activated') : t('promotions.paused'));
      loadData();
    } catch {
      toast.error(t('promotions.saveError'));
    }
  };

  const handleDelete = async (row) => {
    try {
      await axios.delete(`/promotions/${row.id}`);
      toast.success(t('promotions.deleteSuccess'));
      loadData();
    } catch {
      toast.error(t('promotions.deleteError'));
    }
  };

  const columns = [
    {
      title: t('promotions.name'),
      dataIndex: 'name',
      width: 260,
      render: (name, row) => (
        <div>
          <div style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{name}</div>
          {row.code && (
            <Tag style={{ fontFamily: 'var(--font-mono)' }}>{row.code}</Tag>
          )}
        </div>
      ),
    },
    {
      title: t('promotions.type'),
      dataIndex: 'type',
      width: 180,
      render: (type) => {
        const opt = TYPE_OPTIONS.find((o) => o.value === type);
        return opt ? opt.label : type;
      },
    },
    {
      title: t('promotions.value'),
      dataIndex: 'value',
      width: 140,
      align: 'right',
      render: (v, row) => {
        if (row.type === 'PERCENTAGE') return `${v}%`;
        if (row.type === 'BUY_X_GET_Y') return `Mua ${row.buyQuantity} tặng ${row.getQuantity}`;
        if (row.type === 'FREE_SHIPPING') return '—';
        return v?.toLocaleString('vi-VN') + 'đ';
      },
    },
    {
      title: t('promotions.scope'),
      dataIndex: 'scope',
      width: 110,
      render: (v) => (v === 'VOUCHER_CODE' ? 'Voucher' : 'Tự động'),
    },
    {
      title: t('promotions.status'),
      dataIndex: 'status',
      width: 120,
      render: (s) => <Tag color={STATUS_COLOR[s] || 'default'}>{STATUS_OPTIONS.find((o) => o.value === s)?.label || s}</Tag>,
    },
    {
      title: t('promotions.period'),
      width: 210,
      render: (_, row) => {
        const fmt = (d) => (d ? new Date(d).toLocaleDateString('vi-VN') : '—');
        return `${fmt(row.startDate)} → ${fmt(row.endDate)}`;
      },
    },
    {
      title: t('promotions.usage'),
      dataIndex: 'usageCount',
      width: 90,
      align: 'right',
      render: (v, row) => (
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>
          {v ?? 0}{row.usageLimit ? ` / ${row.usageLimit}` : ''}
        </span>
      ),
    },
    {
      title: '',
      width: 130,
      align: 'right',
      fixed: 'right',
      render: (_, row) => (
        <Space size={4}>
          {row.status === 'ACTIVE' ? (
            <Button
              type="text" size="small"
              icon={<PauseCircleOutlined />}
              title={t('promotions.pause')}
              onClick={() => handleStatus(row, 'PAUSED')}
            />
          ) : row.status !== 'EXPIRED' ? (
            <Button
              type="text" size="small"
              icon={<PlayCircleOutlined />}
              title={t('promotions.activate')}
              onClick={() => handleStatus(row, 'ACTIVE')}
            />
          ) : null}
          <Button type="text" size="small" icon={<EditOutlined />} onClick={() => openEdit(row)} />
          <Popconfirm
            title={t('common.confirmDelete')}
            description={t('promotions.deleteWarning')}
            okText={t('common.delete')}
            cancelText={t('common.cancel')}
            okButtonProps={{ danger: true }}
            onConfirm={() => handleDelete(row)}
          >
            <Button type="text" size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const reportColumns = [
    { title: t('promotions.name'), dataIndex: ['promotion', 'name'], width: 240 },
    { title: t('promotions.type'), dataIndex: ['promotion', 'type'], width: 180, render: (v) => TYPE_OPTIONS.find((o) => o.value === v)?.label || v },
    { title: t('promotions.usage'), dataIndex: 'usageCount', width: 120, align: 'right', render: (v) => v ?? 0 },
    {
      title: t('promotions.totalDiscount'),
      dataIndex: 'totalDiscount',
      width: 160,
      align: 'right',
      render: (v) => v?.toLocaleString('vi-VN') + 'đ',
    },
  ];

  const reportType = Form.useWatch('type', form);

  return (
    <>
      <PageHeader
        title={t('promotions.title')}
        subtitle={t('promotions.count', { count: total })}
        actions={
          <PermissionGate permission="products.edit">
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              {t('promotions.addNew')}
            </Button>
          </PermissionGate>
        }
      />

      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          {
            key: 'list',
            label: t('promotions.tabList'),
            children: (
              <>
                <div className="filters-bar">
                  <Input
                    className="filters-bar__search"
                    placeholder={t('promotions.searchPlaceholder')}
                    prefix={<SearchOutlined style={{ color: 'var(--text-muted)' }} />}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    allowClear
                  />
                  <Select
                    placeholder={t('promotions.status')}
                    style={{ width: 150 }}
                    value={statusFilter}
                    onChange={setStatusFilter}
                    allowClear
                    options={STATUS_OPTIONS}
                  />
                  <Select
                    placeholder={t('promotions.type')}
                    style={{ width: 200 }}
                    value={typeFilter}
                    onChange={setTypeFilter}
                    allowClear
                    options={TYPE_OPTIONS}
                  />
                </div>
                <div className="table-card">
                  <Table
                    columns={columns}
                    dataSource={data}
                    rowKey="id"
                    loading={loading}
                    scroll={{ x: 1200 }}
                    pagination={{
                      current: page,
                      pageSize: 20,
                      total,
                      showSizeChanger: false,
                      onChange: (p) => setPage(p),
                      showTotal: (totalCount) => t('promotions.count', { count: totalCount }),
                    }}
                    locale={{
                      emptyText: (
                        <EmptyState
                          title={t('promotions.empty')}
                          description={t('promotions.emptyDesc')}
                          action={
                            <PermissionGate permission="products.edit">
                              <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
                                {t('promotions.addFirst')}
                              </Button>
                            </PermissionGate>
                          }
                        />
                      ),
                    }}
                  />
                </div>
              </>
            ),
          },
          {
            key: 'report',
            label: (
              <span><BarChartOutlined /> {t('promotions.report')}</span>
            ),
            children: (
              <div className="table-card">
                <Table
                  columns={reportColumns}
                  dataSource={report}
                  rowKey={(r) => r.promotion?.id || r.promotion?.code}
                  loading={reportLoading}
                  pagination={false}
                  locale={{ emptyText: <EmptyState title={t('promotions.reportEmpty')} description={t('promotions.reportEmptyDesc')} /> }}
                />
              </div>
            ),
          },
        ]}
      />

      <Modal
        title={editing ? t('promotions.editTitle') : t('promotions.createTitle')}
        open={modalOpen}
        onOk={handleSave}
        onCancel={() => setModalOpen(false)}
        confirmLoading={saving}
        width={640}
        destroyOnClose
      >
        <Form form={form} layout="vertical" initialValues={{ scope: 'AUTO', status: 'DRAFT', type: 'PERCENTAGE' }}>
          <Form.Item name="name" label={t('promotions.name')} rules={[{ required: true, message: t('promotions.nameRequired') }]}>
            <Input />
          </Form.Item>
          <Form.Item name="description" label={t('promotions.description')}>
            <Input.TextArea rows={2} />
          </Form.Item>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Form.Item name="type" label={t('promotions.type')} rules={[{ required: true }]}>
              <Select options={TYPE_OPTIONS} />
            </Form.Item>
            <Form.Item name="scope" label={t('promotions.scope')}>
              <Select
                options={[
                  { value: 'AUTO', label: 'Tự động áp dụng' },
                  { value: 'VOUCHER_CODE', label: 'Mã voucher' },
                ]}
              />
            </Form.Item>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {reportType === 'VOUCHER_CODE' && (
              <Form.Item name="code" label={t('promotions.code')} rules={[{ required: true, message: t('promotions.codeRequired') }]}>
                <Input style={{ textTransform: 'uppercase' }} />
              </Form.Item>
            )}
            {reportType === 'PERCENTAGE' && (
              <Form.Item name="value" label={t('promotions.valuePercent')} rules={[{ required: true, message: t('promotions.valueRequired') }]}>
                <InputNumber min={1} max={100} style={{ width: '100%' }} suffix="%" />
              </Form.Item>
            )}
            {reportType === 'FIXED_AMOUNT' && (
              <Form.Item name="value" label={t('promotions.valueFixed')} rules={[{ required: true, message: t('promotions.valueRequired') }]}>
                <InputNumber min={1000} style={{ width: '100%' }} />
              </Form.Item>
            )}
            {reportType === 'BUY_X_GET_Y' && (
              <>
                <Form.Item name="buyQuantity" label={t('promotions.buyQty')} rules={[{ required: true }]}>
                  <InputNumber min={1} style={{ width: '100%' }} />
                </Form.Item>
                <Form.Item name="getQuantity" label={t('promotions.getQty')} rules={[{ required: true }]}>
                  <InputNumber min={1} style={{ width: '100%' }} />
                </Form.Item>
              </>
            )}
            {reportType === 'CATEGORY_DISCOUNT' && (
              <>
                <Form.Item name="categoryId" label={t('promotions.category')} rules={[{ required: true }]}>
                  <Select options={categories.map((c) => ({ value: c.id, label: c.name }))} />
                </Form.Item>
                <Form.Item name="value" label={t('promotions.valuePercent')} rules={[{ required: true }]}>
                  <InputNumber min={1} max={100} style={{ width: '100%' }} suffix="%" />
                </Form.Item>
              </>
            )}
            {reportType === 'PRODUCT_DISCOUNT' && (
              <>
                <Form.Item name="productId" label={t('promotions.product')} rules={[{ required: true }]}>
                  <Select showSearch optionFilterProp="label" options={products.map((p) => ({ value: p.id, label: p.name }))} />
                </Form.Item>
                <Form.Item name="value" label={t('promotions.valuePercent')} rules={[{ required: true }]}>
                  <InputNumber min={1} max={100} style={{ width: '100%' }} suffix="%" />
                </Form.Item>
              </>
            )}
            {reportType === 'HAPPY_HOUR' && (
              <>
                <Form.Item name="value" label={t('promotions.valuePercent')} rules={[{ required: true, message: t('promotions.valueRequired') }]}>
                  <InputNumber min={1} max={100} style={{ width: '100%' }} suffix="%" />
                </Form.Item>
                <Form.Item name="scheduleType" label={t('promotions.scheduleType')} initialValue="CRON">
                  <Select
                    options={[
                      { value: 'ALWAYS', label: 'Luôn luôn' },
                      { value: 'CRON', label: 'Theo lịch' },
                    ]}
                  />
                </Form.Item>
                {scheduleType === 'CRON' && (
                  <>
                    <Form.Item name="daysOfWeek" label={t('promotions.daysOfWeek')}>
                      <Select
                        mode="tags"
                        tokenSeparators={[',']}
                        placeholder="VD: Mon,Tue,Wed"
                      />
                    </Form.Item>
                    <Form.Item name="startTime" label={t('promotions.startTime')}>
                      <Input placeholder="HH:mm" />
                    </Form.Item>
                    <Form.Item name="endTime" label={t('promotions.endTime')}>
                      <Input placeholder="HH:mm" />
                    </Form.Item>
                  </>
                )}
              </>
            )}
            {reportType === 'FREE_SHIPPING' && (
              <Form.Item name="value" label={t('promotions.maxDiscount')}>
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Form.Item name="startDate" label={t('promotions.startDate')} rules={[{ required: true }]}>
              <DatePicker showTime style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="endDate" label={t('promotions.endDate')} rules={[{ required: true }]}>
              <DatePicker showTime style={{ width: '100%' }} />
            </Form.Item>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Form.Item name="minOrderValue" label={t('promotions.minOrder')}>
              <InputNumber min={0} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="maxDiscount" label={t('promotions.maxDiscount')}>
              <InputNumber min={0} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="usageLimit" label={t('promotions.usageLimit')}>
              <InputNumber min={1} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="perUserLimit" label={t('promotions.perUserLimit')}>
              <InputNumber min={1} style={{ width: '100%' }} />
            </Form.Item>
          </div>
          <Form.Item name="status" label={t('promotions.status')}>
            <Select options={STATUS_OPTIONS} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
