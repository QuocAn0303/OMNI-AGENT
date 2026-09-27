/**
 * Frontend: pages/production/Production.jsx — Quản lý sản xuất
 *
 * Tổng quan:
 * - Hai tab chính: Định mức nguyên liệu (BOM) và Lệnh sản xuất (Work Order)
 * - CRUD BOM với danh sách nguyên liệu động (Form.List), kích hoạt/vô hiệu hóa/xóa
 * - Tạo Work Order từ BOM đang ACTIVE, chọn kho và số lượng
 * - Click WO → /production/work-orders/:id
 * - API: GET /production/overview, /production/boms, /production/work-orders, POST/PATCH/DELETE tương ứng
 *
 * Components/Hooks/Exports:
 * - Production: Component chính (xuất mặc định)
 * - BOM_STATUS, WO_STATUS + meta helpers
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Tabs, Table, Input, Button, Modal, Form, Select, DatePicker, InputNumber,
  message, Row, Col, Space, Tag, Tooltip,
} from 'antd';
import {
  SearchOutlined, PlusOutlined, EditOutlined, DeleteOutlined,
  ExperimentOutlined, RocketOutlined, CheckCircleOutlined, FileTextOutlined,
  PlayCircleOutlined, StopOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import axios from '../../api/axios';
import PageHeader from '../../components/layout/PageHeader';
import PlanGate from '../../components/PlanGate';
import StatCard from '../../components/shared/StatCard';
import EmptyState from '../../components/shared/EmptyState';
import StatusTag from '../../components/shared/StatusTag';
import useDebounce from '../../hooks/useDebounce';
import useAuthStore from '../../stores/authStore';

const BOM_STATUS = [
  { value: 'DRAFT', label: 'Nháp', variant: 'info' },
  { value: 'ACTIVE', label: 'Hoạt động', variant: 'success' },
  { value: 'INACTIVE', label: 'Vô hiệu', variant: 'neutral' },
];

const WO_STATUS = [
  { value: 'DRAFT', label: 'Nháp', variant: 'info' },
  { value: 'IN_PROGRESS', label: 'Đang sản xuất', variant: 'primary' },
  { value: 'COMPLETED', label: 'Hoàn thành', variant: 'success' },
  { value: 'CANCELLED', label: 'Đã hủy', variant: 'danger' },
];

const bomStatusMeta = (s) => BOM_STATUS.find((x) => x.value === s) || { label: s, variant: 'neutral' };
const woStatusMeta = (s) => WO_STATUS.find((x) => x.value === s) || { label: s, variant: 'neutral' };

export default function Production() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const canEdit = ['ADMIN', 'MANAGER', 'WAREHOUSE'].includes(user?.role);
  const canManage = ['ADMIN', 'MANAGER'].includes(user?.role);

  const [activeTab, setActiveTab] = useState('boms');
  const [stats, setStats] = useState({ totalWorkOrders: 0, inProgress: 0, completedThisMonth: 0, activeBoms: 0 });

  // ===== Shared (products, warehouses) =====
  const [products, setProducts] = useState([]);
  const [warehouses, setWarehouses] = useState([]);

  // ===== BOM state =====
  const [boms, setBoms] = useState([]);
  const [bomLoading, setBomLoading] = useState(false);
  const [bomSearch, setBomSearch] = useState('');
  const debouncedBomSearch = useDebounce(bomSearch, 300);
  const [bomStatusFilter, setBomStatusFilter] = useState();
  const [bomPage, setBomPage] = useState(1);
  const [bomTotal, setBomTotal] = useState(0);

  const [bomModalOpen, setBomModalOpen] = useState(false);
  const [editingBom, setEditingBom] = useState(null);
  const [bomForm] = Form.useForm();
  const [savingBom, setSavingBom] = useState(false);

  // ===== Work Order state =====
  const [workOrders, setWorkOrders] = useState([]);
  const [woLoading, setWoLoading] = useState(false);
  const [woSearch, setWoSearch] = useState('');
  const debouncedWoSearch = useDebounce(woSearch, 300);
  const [woStatusFilter, setWoStatusFilter] = useState();
  const [woPage, setWoPage] = useState(1);
  const [woTotal, setWoTotal] = useState(0);

  const [woModalOpen, setWoModalOpen] = useState(false);
  const [woForm] = Form.useForm();
  const [savingWo, setSavingWo] = useState(false);
  const [activeBoms, setActiveBoms] = useState([]);

  // ===== Quality Check state =====
  const [qcList, setQcList] = useState([]);
  const [qcLoading, setQcLoading] = useState(false);
  const [qcModalOpen, setQcModalOpen] = useState(false);
  const [qcForm] = Form.useForm();
  const [savingQc, setSavingQc] = useState(false);

  // ===== Loaders =====
  const loadStats = async () => {
    try {
      const res = await axios.get('/production/overview');
      setStats(res.data?.data || stats);
    } catch {
      // ignore
    }
  };

  const loadBoms = async () => {
    setBomLoading(true);
    try {
      const params = { page: bomPage, limit: 20 };
      if (debouncedBomSearch) params.search = debouncedBomSearch;
      if (bomStatusFilter) params.status = bomStatusFilter;
      const res = await axios.get('/production/boms', { params });
      setBoms(res.data?.data || []);
      setBomTotal(res.data?.pagination?.total || 0);
    } catch {
      message.error('Không tải được danh sách BOM');
    } finally {
      setBomLoading(false);
    }
  };

  const loadWorkOrders = async () => {
    setWoLoading(true);
    try {
      const params = { page: woPage, limit: 20 };
      if (debouncedWoSearch) params.search = debouncedWoSearch;
      if (woStatusFilter) params.status = woStatusFilter;
      const res = await axios.get('/production/work-orders', { params });
      setWorkOrders(res.data?.data || []);
      setWoTotal(res.data?.pagination?.total || 0);
    } catch {
      message.error('Không tải được lệnh sản xuất');
    } finally {
      setWoLoading(false);
    }
  };

  const loadProducts = async () => {
    try {
      const res = await axios.get('/products', { params: { limit: 500 } });
      setProducts(res.data?.data || []);
    } catch {
      // ignore
    }
  };

  const loadWarehouses = async () => {
    try {
      const res = await axios.get('/warehouses');
      setWarehouses(res.data?.data || []);
    } catch {
      // ignore
    }
  };

  const loadQcList = async () => {
    setQcLoading(true);
    try {
      const res = await axios.get('/production/quality', { params: { limit: 200 } });
      setQcList(res.data?.data?.checks || []);
    } catch { /* ignore */ }
    finally { setQcLoading(false); }
  };

  const loadActiveBoms = async () => {
    try {
      const res = await axios.get('/production/boms', { params: { status: 'ACTIVE', limit: 200 } });
      setActiveBoms(res.data?.data || []);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    loadStats();
    loadProducts();
    loadWarehouses();
  }, []);

  const handleCreateQc = async () => {
    try {
      const values = await qcForm.validateFields();
      setSavingQc(true);
      const payload = {
        items: (values.items || []).map((it) => ({
          name: it.name,
          result: it.result || null,
          notes: it.notes || null,
        })),
        notes: values.notes || null,
      };
      await axios.post(`/production/quality/${values.workOrderId}`, payload);
      message.success('Đã tạo phiếu kiểm tra');
      setQcModalOpen(false);
      qcForm.resetFields();
      await loadQcList();
    } catch (err) {
      if (err?.errorFields) return;
      message.error(err?.response?.data?.message || 'Tạo thất bại');
    } finally { setSavingQc(false); }
  };

  useEffect(() => { loadBoms(); }, [bomPage, debouncedBomSearch, bomStatusFilter]);
  useEffect(() => { setBomPage(1); }, [debouncedBomSearch, bomStatusFilter]);

  useEffect(() => { loadWorkOrders(); }, [woPage, debouncedWoSearch, woStatusFilter]);
  useEffect(() => { setWoPage(1); }, [debouncedWoSearch, woStatusFilter]);
  useEffect(() => { if (activeTab === 'quality') loadQcList(); }, [activeTab]);

  // ===== BOM actions =====
  const openBomModal = async (bom = null) => {
    setEditingBom(bom);
    if (bom) {
      // Need full detail for items
      try {
        const res = await axios.get(`/production/boms/${bom.id}`);
        const full = res.data?.data;
        bomForm.setFieldsValue({
          productId: full.product.id,
          version: full.version,
          notes: full.notes,
          items: (full.items || []).map((it) => ({
            componentId: it.component.id,
            quantity: it.quantity,
            notes: it.notes,
          })),
        });
      } catch {
        message.error('Không tải được chi tiết BOM');
        return;
      }
    } else {
      bomForm.resetFields();
      bomForm.setFieldsValue({ version: 'v1', items: [{ componentId: undefined, quantity: 1 }] });
    }
    setBomModalOpen(true);
  };

  const handleSaveBom = async () => {
    try {
      const values = await bomForm.validateFields();
      setSavingBom(true);
      const payload = {
        productId: values.productId,
        version: values.version,
        notes: values.notes || null,
        items: (values.items || []).map((it) => ({
          componentId: it.componentId,
          quantity: Number(it.quantity),
          notes: it.notes || null,
        })),
      };
      if (editingBom) {
        const { productId: _unused, ...patch } = payload;
        await axios.patch(`/production/boms/${editingBom.id}`, patch);
        message.success('Đã cập nhật BOM');
      } else {
        await axios.post('/production/boms', payload);
        message.success('Đã tạo BOM');
      }
      setBomModalOpen(false);
      loadBoms();
      loadStats();
    } catch (err) {
      if (err?.errorFields) return;
      message.error(err?.response?.data?.message || 'Lưu thất bại');
    } finally {
      setSavingBom(false);
    }
  };

  const handleChangeBomStatus = async (id, action) => {
    try {
      await axios.post(`/production/boms/${id}/${action}`);
      message.success(action === 'activate' ? 'Đã kích hoạt' : 'Đã vô hiệu hóa');
      loadBoms();
      loadStats();
    } catch (err) {
      message.error(err?.response?.data?.message || 'Thao tác thất bại');
    }
  };

  const handleDeleteBom = (id) => {
    Modal.confirm({
      title: 'Xóa BOM?',
      okText: 'Xóa', okButtonProps: { danger: true }, cancelText: 'Hủy',
      onOk: async () => {
        try {
          await axios.delete(`/production/boms/${id}`);
          message.success('Đã xóa');
          loadBoms();
        } catch (err) {
          message.error(err?.response?.data?.message || 'Xóa thất bại');
        }
      },
    });
  };

  // ===== Work Order actions =====
  const openWoModal = async () => {
    woForm.resetFields();
    await loadActiveBoms();
    const defaultWh = warehouses.find((w) => w.isDefault) || warehouses[0];
    woForm.setFieldsValue({ quantity: 1, warehouseId: defaultWh?.id });
    setWoModalOpen(true);
  };

  const handleSaveWo = async () => {
    try {
      const values = await woForm.validateFields();
      setSavingWo(true);
      const payload = {
        bomId: values.bomId,
        quantity: Number(values.quantity),
        warehouseId: values.warehouseId,
        plannedStartDate: values.plannedStartDate ? values.plannedStartDate.toISOString() : null,
        plannedEndDate: values.plannedEndDate ? values.plannedEndDate.toISOString() : null,
        notes: values.notes || null,
      };
      await axios.post('/production/work-orders', payload);
      message.success('Đã tạo lệnh sản xuất');
      setWoModalOpen(false);
      loadWorkOrders();
      loadStats();
    } catch (err) {
      if (err?.errorFields) return;
      message.error(err?.response?.data?.message || 'Lưu thất bại');
    } finally {
      setSavingWo(false);
    }
  };

  // ===== Columns =====
  const bomColumns = [
    {
      title: 'Mã BOM',
      dataIndex: 'code',
      width: 160,
      render: (code) => (
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{code}</span>
      ),
    },
    {
      title: 'Sản phẩm',
      dataIndex: ['product', 'name'],
      render: (name, row) => (
        <div>
          <div style={{ fontWeight: 500 }}>{name}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            SKU: {row.product?.sku}
          </div>
        </div>
      ),
    },
    {
      title: 'Phiên bản',
      dataIndex: 'version',
      width: 110,
      render: (v) => <Tag>{v}</Tag>,
    },
    {
      title: 'Trạng thái',
      dataIndex: 'status',
      width: 130,
      render: (s) => {
        const m = bomStatusMeta(s);
        return <StatusTag status={s} label={m.label} variant={m.variant} />;
      },
    },
    {
      title: 'NL',
      width: 70,
      align: 'right',
      render: (_, row) => <span style={{ fontWeight: 500 }}>{row._count?.items || 0}</span>,
    },
    {
      title: 'WO',
      width: 70,
      align: 'right',
      render: (_, row) => <span>{row._count?.workOrders || 0}</span>,
    },
    {
      title: '',
      width: 220,
      align: 'right',
      fixed: 'right',
      render: (_, row) => (
        <Space size={4}>
          {canManage && row.status === 'DRAFT' && (
            <Tooltip title="Kích hoạt">
              <Button size="small" icon={<PlayCircleOutlined />} onClick={() => handleChangeBomStatus(row.id, 'activate')} />
            </Tooltip>
          )}
          {canManage && row.status === 'ACTIVE' && (
            <Tooltip title="Vô hiệu hóa">
              <Button size="small" icon={<StopOutlined />} onClick={() => handleChangeBomStatus(row.id, 'deactivate')} />
            </Tooltip>
          )}
          {canEdit && row.status === 'DRAFT' && (
            <Button type="text" size="small" icon={<EditOutlined />} onClick={() => openBomModal(row)} />
          )}
          {canManage && row._count?.workOrders === 0 && (
            <Button type="text" size="small" danger icon={<DeleteOutlined />} onClick={() => handleDeleteBom(row.id)} />
          )}
        </Space>
      ),
    },
  ];

  const woColumns = [
    {
      title: 'Mã WO',
      dataIndex: 'code',
      width: 160,
      render: (code) => (
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{code}</span>
      ),
    },
    {
      title: 'Sản phẩm',
      dataIndex: ['product', 'name'],
      render: (name, row) => (
        <div>
          <div style={{ fontWeight: 500 }}>{name}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            BOM: {row.bom?.code} ({row.bom?.version})
          </div>
        </div>
      ),
    },
    {
      title: 'Số lượng',
      dataIndex: 'quantity',
      width: 100,
      align: 'right',
      render: (q, row) => (
        <div>
          <div style={{ fontWeight: 500 }}>{q} {row.product?.unit || ''}</div>
          {row.status === 'COMPLETED' && (
            <div style={{ fontSize: 11, color: 'var(--success)' }}>SX: {row.producedQty}</div>
          )}
        </div>
      ),
    },
    {
      title: 'Trạng thái',
      dataIndex: 'status',
      width: 150,
      render: (s) => {
        const m = woStatusMeta(s);
        return <StatusTag status={s} label={m.label} variant={m.variant} />;
      },
    },
    {
      title: 'Kho',
      dataIndex: ['warehouse', 'name'],
      width: 140,
    },
    {
      title: 'Kế hoạch',
      width: 180,
      render: (_, row) => (
        <div style={{ fontSize: 12 }}>
          <div>{row.plannedStartDate ? dayjs(row.plannedStartDate).format('DD/MM/YYYY') : '—'}</div>
          <div style={{ color: 'var(--text-muted)' }}>
            đến {row.plannedEndDate ? dayjs(row.plannedEndDate).format('DD/MM/YYYY') : '—'}
          </div>
        </div>
      ),
    },
  ];

  return (
    <PlanGate moduleKey="production" moduleName="Quản lý sản xuất">
    <>
      <PageHeader
        title="Quản lý sản xuất"
        subtitle="BOM & Lệnh sản xuất"
      />

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={12} md={6}>
          <StatCard title="Tổng WO" value={stats.totalWorkOrders} icon={<FileTextOutlined />} variant="primary" />
        </Col>
        <Col xs={12} md={6}>
          <StatCard title="Đang sản xuất" value={stats.inProgress} icon={<RocketOutlined />} variant="info" />
        </Col>
        <Col xs={12} md={6}>
          <StatCard title="Hoàn thành/tháng" value={stats.completedThisMonth} icon={<CheckCircleOutlined />} variant="success" />
        </Col>
        <Col xs={12} md={6}>
          <StatCard title="BOM hoạt động" value={stats.activeBoms} icon={<ExperimentOutlined />} variant="warning" />
        </Col>
      </Row>

      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          {
            key: 'boms',
            label: `Định mức nguyên liệu (BOM)`,
            children: (
              <>
                <div className="filters-bar">
                  <Input
                    className="filters-bar__search"
                    placeholder="Tìm theo mã BOM hoặc tên sản phẩm..."
                    prefix={<SearchOutlined style={{ color: 'var(--text-muted)' }} />}
                    value={bomSearch}
                    onChange={(e) => setBomSearch(e.target.value)}
                    allowClear
                  />
                  <Select
                    placeholder="Trạng thái"
                    allowClear
                    style={{ minWidth: 150 }}
                    value={bomStatusFilter}
                    onChange={setBomStatusFilter}
                    options={BOM_STATUS.map((s) => ({ value: s.value, label: s.label }))}
                  />
                  {canEdit && (
                    <Button type="primary" icon={<PlusOutlined />} onClick={() => openBomModal()} style={{ marginLeft: 'auto' }}>
                      Tạo BOM
                    </Button>
                  )}
                </div>

                <div className="table-card">
                  <Table
                    columns={bomColumns}
                    dataSource={boms}
                    rowKey="id"
                    loading={bomLoading}
                    scroll={{ x: 1000 }}
                    pagination={{
                      current: bomPage, pageSize: 20, total: bomTotal, showSizeChanger: false,
                      onChange: (p) => setBomPage(p),
                    }}
                    locale={{
                      emptyText: (
                        <EmptyState
                          title="Chưa có BOM"
                          action={canEdit ? (
                            <Button type="primary" icon={<PlusOutlined />} onClick={() => openBomModal()}>
                              Tạo BOM đầu tiên
                            </Button>
                          ) : null}
                        />
                      ),
                    }}
                  />
                </div>
              </>
            ),
          },
          {
            key: 'quality',
            label: `Kiểm tra chất lượng`,
            children: (
              <>
                <div className="filters-bar">
                  <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                    Danh sách phiếu kiểm tra chất lượng theo lệnh sản xuất
                  </span>
                  {canEdit && (
                    <Button type="primary" icon={<PlusOutlined />} onClick={async () => { qcForm.resetFields(); qcForm.setFieldsValue({ items: [{ name: '', result: '', notes: '' }] }); setQcModalOpen(true); const r = await axios.get('/production/work-orders', { params: { limit: 200 } }).catch(() => null); if (r) setWorkOrders(r.data?.data || []); }} style={{ marginLeft: 'auto' }}>
                      Tạo phiếu kiểm tra
                    </Button>
                  )}
                </div>
                <div className="table-card">
                  <Table
                    columns={[
                      {
                        title: 'Mã WO', dataIndex: ['workOrder', 'code'], width: 160,
                        render: (code) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{code}</span>,
                      },
                      {
                        title: 'Sản phẩm', dataIndex: ['workOrder', 'product', 'name'],
                        render: (name, row) => (
                          <div>
                            <div style={{ fontWeight: 500 }}>{name}</div>
                            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{row.workOrder?.product?.sku}</div>
                          </div>
                        ),
                      },
                      {
                        title: 'Trạng thái QC', dataIndex: 'status', width: 150,
                        render: (s) => {
                          const m = { PASSED: ['success', 'Đạt'], FAILED: ['error', 'Không đạt'], PARTIAL: ['warning', 'Một phần'], PENDING: ['default', 'Chờ KQ'] };
                          const [color, label] = m[s] || ['default', s];
                          return <Tag color={color}>{label}</Tag>;
                        },
                      },
                      {
                        title: 'Người kiểm', dataIndex: ['checkedBy', 'fullName'], width: 150,
                        render: (v) => v || '—',
                      },
                      {
                        title: 'Hạng mục', dataIndex: ['items', 'length'], width: 100, align: 'right',
                      },
                      {
                        title: 'Ngày tạo', dataIndex: 'createdAt', width: 160,
                        render: (d) => d ? dayjs(d).format('DD/MM/YYYY HH:mm') : '—',
                      },
                      {
                        title: '', width: 100,
                        render: (_, row) => (
                          <Button size="small" onClick={() => navigate(`/production/work-orders/${row.workOrder?.id}`)}>
                            Xem WO
                          </Button>
                        ),
                      },
                    ]}
                    dataSource={qcList}
                    rowKey="id"
                    loading={qcLoading}
                    pagination={{ pageSize: 20 }}
                    locale={{ emptyText: <EmptyState title="Chưa có phiếu kiểm tra" /> }}
                  />
                </div>
              </>
            ),
          },
          {
            key: 'work-orders',
            label: `Lệnh sản xuất`,
            children: (
              <>
                <div className="filters-bar">
                  <Input
                    className="filters-bar__search"
                    placeholder="Tìm theo mã WO hoặc tên sản phẩm..."
                    prefix={<SearchOutlined style={{ color: 'var(--text-muted)' }} />}
                    value={woSearch}
                    onChange={(e) => setWoSearch(e.target.value)}
                    allowClear
                  />
                  <Select
                    placeholder="Trạng thái"
                    allowClear
                    style={{ minWidth: 150 }}
                    value={woStatusFilter}
                    onChange={setWoStatusFilter}
                    options={WO_STATUS.map((s) => ({ value: s.value, label: s.label }))}
                  />
                  {canEdit && (
                    <Button type="primary" icon={<PlusOutlined />} onClick={openWoModal} style={{ marginLeft: 'auto' }}>
                      Tạo lệnh sản xuất
                    </Button>
                  )}
                </div>

                <div className="table-card">
                  <Table
                    columns={woColumns}
                    dataSource={workOrders}
                    rowKey="id"
                    loading={woLoading}
                    scroll={{ x: 1100 }}
                    onRow={(row) => ({
                      onClick: () => navigate(`/production/work-orders/${row.id}`),
                      style: { cursor: 'pointer' },
                    })}
                    pagination={{
                      current: woPage, pageSize: 20, total: woTotal, showSizeChanger: false,
                      onChange: (p) => setWoPage(p),
                    }}
                    locale={{
                      emptyText: (
                        <EmptyState
                          title="Chưa có lệnh sản xuất"
                          action={canEdit ? (
                            <Button type="primary" icon={<PlusOutlined />} onClick={openWoModal}>
                              Tạo WO đầu tiên
                            </Button>
                          ) : null}
                        />
                      ),
                    }}
                  />
                </div>
              </>
            ),
          },
        ]}
      />

      {/* BOM Modal */}
      <Modal
        title={editingBom ? 'Sửa BOM' : 'Tạo BOM mới'}
        open={bomModalOpen}
        onCancel={() => setBomModalOpen(false)}
        onOk={handleSaveBom}
        okText="Lưu"
        cancelText="Hủy"
        confirmLoading={savingBom}
        width={720}
      >
        <Form form={bomForm} layout="vertical" style={{ marginTop: 16 }}>
          <Row gutter={12}>
            <Col span={16}>
              <Form.Item
                label="Sản phẩm thành phẩm"
                name="productId"
                rules={[{ required: true, message: 'Chọn sản phẩm' }]}
              >
                <Select
                  showSearch
                  optionFilterProp="label"
                  placeholder="Chọn sản phẩm"
                  disabled={!!editingBom}
                  options={products.map((p) => ({
                    value: p.id,
                    label: `${p.sku} - ${p.name}`,
                  }))}
                />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item label="Phiên bản" name="version" rules={[{ required: true }]}>
                <Input placeholder="v1" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item label="Ghi chú" name="notes">
            <Input.TextArea rows={2} />
          </Form.Item>

          <div style={{ marginTop: 8, marginBottom: 8, fontWeight: 600 }}>
            Nguyên liệu / Thành phần
          </div>
          <Form.List name="items">
            {(fields, { add, remove }) => (
              <>
                {fields.map((field) => (
                  <Row gutter={8} key={field.key} style={{ marginBottom: 8 }}>
                    <Col span={14}>
                      <Form.Item
                        name={[field.name, 'componentId']}
                        rules={[{ required: true, message: 'Chọn NL' }]}
                        noStyle
                      >
                        <Select
                          showSearch
                          optionFilterProp="label"
                          placeholder="Chọn nguyên liệu"
                          options={products.map((p) => ({
                            value: p.id,
                            label: `${p.sku} - ${p.name}`,
                          }))}
                        />
                      </Form.Item>
                    </Col>
                    <Col span={6}>
                      <Form.Item
                        name={[field.name, 'quantity']}
                        rules={[{ required: true, message: 'SL' }]}
                        noStyle
                      >
                        <InputNumber
                          style={{ width: '100%' }}
                          min={1}
                          placeholder="Số lượng"
                        />
                      </Form.Item>
                    </Col>
                    <Col span={4}>
                      <Button danger icon={<DeleteOutlined />} onClick={() => remove(field.name)} disabled={fields.length <= 1}>
                        Xóa
                      </Button>
                    </Col>
                  </Row>
                ))}
                <Button type="dashed" icon={<PlusOutlined />} onClick={() => add({ quantity: 1 })} block>
                  Thêm nguyên liệu
                </Button>
              </>
            )}
          </Form.List>
        </Form>
      </Modal>

      {/* Work Order Modal */}
      <Modal
        title="Tạo lệnh sản xuất mới"
        open={woModalOpen}
        onCancel={() => setWoModalOpen(false)}
        onOk={handleSaveWo}
        okText="Tạo"
        cancelText="Hủy"
        confirmLoading={savingWo}
        width={560}
      >
        <Form form={woForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            label="BOM (chỉ hiển thị BOM đang ACTIVE)"
            name="bomId"
            rules={[{ required: true }]}
          >
            <Select
              showSearch
              optionFilterProp="label"
              placeholder="Chọn BOM"
              options={activeBoms.map((b) => ({
                value: b.id,
                label: `${b.code} (${b.version}) - ${b.product.name}`,
              }))}
            />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item label="Số lượng sản xuất" name="quantity" rules={[{ required: true }]}>
                <InputNumber style={{ width: '100%' }} min={1} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="Kho" name="warehouseId" rules={[{ required: true }]}>
                <Select
                  options={warehouses.map((w) => ({
                    value: w.id,
                    label: `${w.code} - ${w.name}`,
                  }))}
                />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item label="Ngày bắt đầu" name="plannedStartDate">
                <DatePicker style={{ width: '100%' }} format="DD/MM/YYYY" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="Ngày kết thúc" name="plannedEndDate">
                <DatePicker style={{ width: '100%' }} format="DD/MM/YYYY" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item label="Ghi chú" name="notes">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>

      {/* QC Creation Modal */}
      <Modal
        title="Tạo phiếu kiểm tra chất lượng"
        open={qcModalOpen}
        onCancel={() => setQcModalOpen(false)}
        onOk={handleCreateQc}
        okText="Tạo"
        cancelText="Hủy"
        confirmLoading={savingQc}
        width={600}
      >
        <Form form={qcForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="workOrderId" label="Lệnh sản xuất" rules={[{ required: true, message: 'Chọn WO' }]}>
            <Select
              showSearch
              optionFilterProp="label"
              placeholder="Chọn lệnh sản xuất"
              options={workOrders
                .filter((wo) => ['IN_PROGRESS', 'COMPLETED'].includes(wo.status))
                .map((wo) => ({
                  value: wo.id,
                  label: `${wo.code} - ${wo.product?.name}`,
                }))}
            />
          </Form.Item>
          <Form.List name="items" initialValue={[{ name: '', result: '', notes: '' }]}>
            {(fields, { add, remove }) => (
              <>
                {fields.map((f) => (
                  <Space key={f.key} style={{ width: '100%', marginBottom: 8 }} align="start">
                    <Form.Item name={[f.name, 'name']} rules={[{ required: true, message: 'Nhập tên' }]} noStyle>
                      <Input placeholder="Tên hạng mục" style={{ width: 200 }} />
                    </Form.Item>
                    <Form.Item name={[f.name, 'result']} noStyle>
                      <Select placeholder="KQ dự kiến" allowClear style={{ width: 140 }}
                        options={[
                          { value: 'PASS', label: 'Đạt' },
                          { value: 'FAIL', label: 'Không đạt' },
                        ]}
                      />
                    </Form.Item>
                    <Form.Item name={[f.name, 'notes']} noStyle>
                      <Input placeholder="Ghi chú" style={{ width: 140 }} />
                    </Form.Item>
                    {fields.length > 1 && (
                      <Button danger size="small" onClick={() => remove(f.name)}>Xóa</Button>
                    )}
                  </Space>
                ))}
                <Button type="dashed" icon={<ExperimentOutlined />} onClick={() => add({ name: '', result: '', notes: '' })} block>
                  Thêm hạng mục
                </Button>
              </>
            )}
          </Form.List>
          <Form.Item name="notes" label="Ghi chú chung" style={{ marginTop: 12 }}>
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </>
    </PlanGate>
  );
}
