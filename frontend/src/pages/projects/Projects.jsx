/**
 * Frontend: pages/projects/Projects.jsx — Danh sách dự án
 *
 * Tổng quan:
 * - Bảng danh sách dự án với phân trang, tìm kiếm (debounce), lọc trạng thái
 * - CRUD dự án qua modal; thống kê tổng quan (tổng, đang chạy, hoàn thành, quá hạn)
 * - API: GET /projects (phân trang), GET /projects/overview, POST /projects, PATCH /projects/:id, DELETE /projects/:id
 * - Điều hướng click hàng → /projects/:id
 *
 * Components/Hooks/Exports:
 * - Projects: Component chính (xuất mặc định)
 * - STATUS_OPTIONS: Danh sách trạng thái + nhãn
 * - PlanGate: Kiểm tra quyền truy cập module
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Table, Input, Button, Modal, Form, Select, DatePicker, InputNumber, message, Row, Col,
} from 'antd';
import {
  SearchOutlined, PlusOutlined, EditOutlined, DeleteOutlined,
  ProjectOutlined, CheckCircleOutlined, ClockCircleOutlined, WarningOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import axios from '../../api/axios';
import PageHeader from '../../components/layout/PageHeader';
import PlanGate from '../../components/PlanGate';
import StatCard from '../../components/shared/StatCard';
import EmptyState from '../../components/shared/EmptyState';
import StatusTag from '../../components/shared/StatusTag';
import MoneyDisplay from '../../components/shared/MoneyDisplay';
import useDebounce from '../../hooks/useDebounce';
import useAuthStore from '../../stores/authStore';

const STATUS_OPTIONS = [
  { value: 'DRAFT', label: 'Nháp' },
  { value: 'ACTIVE', label: 'Đang chạy' },
  { value: 'ON_HOLD', label: 'Tạm dừng' },
  { value: 'COMPLETED', label: 'Hoàn thành' },
  { value: 'ARCHIVED', label: 'Lưu trữ' },
];

const statusLabel = (s) => STATUS_OPTIONS.find((x) => x.value === s)?.label || s;
const statusVariant = (s) => {
  switch (s) {
    case 'ACTIVE': return 'primary';
    case 'COMPLETED': return 'success';
    case 'ON_HOLD': return 'warning';
    case 'ARCHIVED': return 'neutral';
    default: return 'info';
  }
};

export default function Projects() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const canEdit = ['ADMIN', 'MANAGER'].includes(user?.role);
  const canDelete = user?.role === 'ADMIN';

  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const [statusFilter, setStatusFilter] = useState();
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  const [stats, setStats] = useState({ total: 0, active: 0, completed: 0, overdue: 0 });

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  const load = async () => {
    setLoading(true);
    try {
      const params = { page, limit: 20 };
      if (debouncedSearch) params.search = debouncedSearch;
      if (statusFilter) params.status = statusFilter;
      const res = await axios.get('/projects', { params });
      setData(res.data?.data || []);
      setTotal(res.data?.pagination?.total || 0);
    } catch {
      message.error('Không tải được danh sách dự án');
    } finally {
      setLoading(false);
    }
  };

  const loadStats = async () => {
    try {
      const res = await axios.get('/projects/overview');
      setStats(res.data?.data || { total: 0, active: 0, completed: 0, overdue: 0 });
    } catch {
      // ignore
    }
  };

  useEffect(() => { load(); }, [page, debouncedSearch, statusFilter]);
  useEffect(() => { setPage(1); }, [debouncedSearch, statusFilter]);
  useEffect(() => { loadStats(); }, []);

  const openModal = (project = null) => {
    setEditing(project);
    if (project) {
      form.setFieldsValue({
        name: project.name,
        description: project.description,
        status: project.status,
        startDate: project.startDate ? dayjs(project.startDate) : null,
        endDate: project.endDate ? dayjs(project.endDate) : null,
        budget: project.budget != null ? Number(project.budget) : null,
      });
    } else {
      form.resetFields();
      form.setFieldsValue({ status: 'DRAFT' });
    }
    setModalOpen(true);
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      const payload = {
        name: values.name,
        description: values.description || null,
        status: values.status,
        startDate: values.startDate ? values.startDate.toISOString() : null,
        endDate: values.endDate ? values.endDate.toISOString() : null,
        budget: values.budget != null ? Number(values.budget) : null,
      };

      if (editing) {
        await axios.patch(`/projects/${editing.id}`, payload);
        message.success('Đã cập nhật dự án');
      } else {
        await axios.post('/projects', payload);
        message.success('Đã tạo dự án');
      }
      setModalOpen(false);
      load();
      loadStats();
    } catch (err) {
      if (err?.errorFields) return;
      message.error(err?.response?.data?.message || 'Lưu thất bại');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (id) => {
    Modal.confirm({
      title: 'Xóa dự án?',
      content: 'Tất cả công việc và thành viên thuộc dự án sẽ bị xóa theo.',
      okText: 'Xóa', okButtonProps: { danger: true }, cancelText: 'Hủy',
      onOk: async () => {
        try {
          await axios.delete(`/projects/${id}`);
          message.success('Đã xóa');
          load();
          loadStats();
        } catch (err) {
          message.error(err?.response?.data?.message || 'Xóa thất bại');
        }
      },
    });
  };

  const columns = [
    {
      title: 'Mã',
      dataIndex: 'code',
      width: 140,
      render: (code) => (
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-muted)' }}>
          {code}
        </span>
      ),
    },
    {
      title: 'Tên dự án',
      dataIndex: 'name',
      render: (name, row) => (
        <div>
          <div style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{name}</div>
          {row.description && (
            <div style={{
              fontSize: 12, color: 'var(--text-muted)',
              maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {row.description}
            </div>
          )}
        </div>
      ),
    },
    {
      title: 'Trạng thái',
      dataIndex: 'status',
      width: 140,
      render: (s) => <StatusTag status={s} label={statusLabel(s)} variant={statusVariant(s)} />,
    },
    {
      title: 'Thời gian',
      width: 200,
      render: (_, row) => (
        <div style={{ fontSize: 13 }}>
          <div>{row.startDate ? dayjs(row.startDate).format('DD/MM/YYYY') : '—'}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            đến {row.endDate ? dayjs(row.endDate).format('DD/MM/YYYY') : '—'}
          </div>
        </div>
      ),
    },
    {
      title: 'Ngân sách',
      dataIndex: 'budget',
      width: 140,
      align: 'right',
      render: (b) => b != null
        ? <MoneyDisplay value={Number(b)} />
        : <span style={{ color: 'var(--text-muted)' }}>—</span>,
    },
    {
      title: 'Công việc',
      width: 100,
      align: 'right',
      render: (_, row) => (
        <span style={{ fontWeight: 500 }}>{row._count?.tasks || 0}</span>
      ),
    },
    {
      title: 'Thành viên',
      width: 100,
      align: 'right',
      render: (_, row) => (
        <span style={{ fontWeight: 500 }}>{row._count?.members || 0}</span>
      ),
    },
    {
      title: '',
      width: 100,
      align: 'right',
      fixed: 'right',
      render: (_, row) => (
        <>
          {canEdit && (
            <Button
              type="text" size="small"
              icon={<EditOutlined />}
              onClick={(e) => { e.stopPropagation(); openModal(row); }}
            />
          )}
          {canDelete && (
            <Button
              type="text" size="small" danger
              icon={<DeleteOutlined />}
              onClick={(e) => { e.stopPropagation(); handleDelete(row.id); }}
            />
          )}
        </>
      ),
    },
  ];

  return (
    <PlanGate moduleKey="projects" moduleName="Dự án">
    <>
      <PageHeader
        title="Dự án"
        subtitle={`${total} dự án`}
        actions={canEdit ? (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => openModal()}>
            Tạo dự án
          </Button>
        ) : null}
      />

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={12} md={6}>
          <StatCard title="Tổng dự án" value={stats.total} icon={<ProjectOutlined />} variant="primary" />
        </Col>
        <Col xs={12} md={6}>
          <StatCard title="Đang chạy" value={stats.active} icon={<ClockCircleOutlined />} variant="info" />
        </Col>
        <Col xs={12} md={6}>
          <StatCard title="Hoàn thành" value={stats.completed} icon={<CheckCircleOutlined />} variant="success" />
        </Col>
        <Col xs={12} md={6}>
          <StatCard title="Quá hạn" value={stats.overdue} icon={<WarningOutlined />} variant="danger" />
        </Col>
      </Row>

      <div className="filters-bar">
        <Input
          className="filters-bar__search"
          placeholder="Tìm theo tên hoặc mã dự án..."
          prefix={<SearchOutlined style={{ color: 'var(--text-muted)' }} />}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          allowClear
        />
        <Select
          placeholder="Trạng thái"
          allowClear
          style={{ minWidth: 160 }}
          value={statusFilter}
          onChange={setStatusFilter}
          options={STATUS_OPTIONS}
        />
      </div>

      <div className="table-card">
        <Table
          columns={columns}
          dataSource={data}
          rowKey="id"
          loading={loading}
          scroll={{ x: 1100 }}
          onRow={(row) => ({
            onClick: () => navigate(`/projects/${row.id}`),
            style: { cursor: 'pointer' },
          })}
          pagination={{
            current: page, pageSize: 20, total, showSizeChanger: false,
            onChange: (p) => setPage(p),
          }}
          locale={{
            emptyText: (
              <EmptyState
                title="Chưa có dự án nào"
                action={canEdit ? (
                  <Button type="primary" icon={<PlusOutlined />} onClick={() => openModal()}>
                    Tạo dự án đầu tiên
                  </Button>
                ) : null}
              />
            ),
          }}
        />
      </div>

      <Modal
        title={editing ? 'Sửa dự án' : 'Tạo dự án mới'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleSave}
        okText="Lưu"
        cancelText="Hủy"
        confirmLoading={saving}
        width={560}
      >
        <Form form={form} layout="vertical" size="large" style={{ marginTop: 16 }}>
          <Form.Item
            label="Tên dự án"
            name="name"
            rules={[{ required: true, message: 'Vui lòng nhập tên dự án' }]}
          >
            <Input placeholder="VD: Triển khai hệ thống bán lẻ" />
          </Form.Item>
          <Form.Item label="Mô tả" name="description">
            <Input.TextArea rows={3} placeholder="Mô tả ngắn gọn về dự án..." />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item label="Trạng thái" name="status" rules={[{ required: true }]}>
                <Select options={STATUS_OPTIONS} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="Ngân sách (VND)" name="budget">
                <InputNumber
                  style={{ width: '100%' }}
                  min={0}
                  step={1000000}
                  formatter={(v) => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                  parser={(v) => v?.replace(/,/g, '')}
                />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item label="Ngày bắt đầu" name="startDate">
                <DatePicker style={{ width: '100%' }} format="DD/MM/YYYY" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="Ngày kết thúc" name="endDate">
                <DatePicker style={{ width: '100%' }} format="DD/MM/YYYY" />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>
    </>
    </PlanGate>
  );
}
