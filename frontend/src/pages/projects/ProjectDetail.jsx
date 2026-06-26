/**
 * Frontend: pages/projects/ProjectDetail.jsx — Chi tiết dự án
 *
 * Tổng quan:
 * - Hiển thị chi tiết dự án với 4 tab: Tổng quan, Công việc, Tài chính, Thành viên
 * - CRUD công việc (task) với lọc trạng thái/ưu tiên, quick-update trạng thái
 * - Quản lý thành viên dự án (thêm/xoá/đổi vai trò)
 * - Tab Tài chính: ngân sách vs thực chi, cảnh báo vượt ngân sách, danh sách chi phí
 * - API: GET /projects/:id, GET /projects/:id/stats, GET /projects/:id/tasks, POST/PATCH/DELETE tasks, members
 *
 * Components/Hooks/Exports:
 * - ProjectDetail: Component chính (xuất mặc định)
 * - PROJECT_STATUS, TASK_STATUS, TASK_PRIORITY, MEMBER_ROLES: Enum constants
 */
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Tabs, Button, Tag, Modal, Form, Input, Select, DatePicker, message,
  Progress, Row, Col, Card, Table, Descriptions, Spin, Alert,
} from 'antd';
import {
  ArrowLeftOutlined, PlusOutlined, EditOutlined, DeleteOutlined,
  UserAddOutlined, CheckSquareOutlined, DollarOutlined, WarningOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import axios from '../../api/axios';
import PageHeader from '../../components/layout/PageHeader';
import PlanGate from '../../components/PlanGate';
import StatusTag from '../../components/shared/StatusTag';
import MoneyDisplay from '../../components/shared/MoneyDisplay';
import EmptyState from '../../components/shared/EmptyState';
import useAuthStore from '../../stores/authStore';

const PROJECT_STATUS = [
  { value: 'DRAFT', label: 'Nháp' },
  { value: 'ACTIVE', label: 'Đang chạy' },
  { value: 'ON_HOLD', label: 'Tạm dừng' },
  { value: 'COMPLETED', label: 'Hoàn thành' },
  { value: 'ARCHIVED', label: 'Lưu trữ' },
];

const TASK_STATUS = [
  { value: 'TODO', label: 'Cần làm', color: 'default' },
  { value: 'IN_PROGRESS', label: 'Đang làm', color: 'processing' },
  { value: 'REVIEW', label: 'Đang review', color: 'warning' },
  { value: 'DONE', label: 'Hoàn thành', color: 'success' },
  { value: 'CANCELLED', label: 'Đã hủy', color: 'default' },
];

const TASK_PRIORITY = [
  { value: 'LOW', label: 'Thấp', color: 'default' },
  { value: 'MEDIUM', label: 'Trung bình', color: 'blue' },
  { value: 'HIGH', label: 'Cao', color: 'orange' },
  { value: 'URGENT', label: 'Khẩn cấp', color: 'red' },
];

const MEMBER_ROLES = [
  { value: 'OWNER', label: 'Owner' },
  { value: 'MEMBER', label: 'Thành viên' },
  { value: 'VIEWER', label: 'Người xem' },
];

const projectStatusLabel = (s) => PROJECT_STATUS.find((x) => x.value === s)?.label || s;
const projectStatusVariant = (s) => {
  switch (s) {
    case 'ACTIVE': return 'primary';
    case 'COMPLETED': return 'success';
    case 'ON_HOLD': return 'warning';
    case 'ARCHIVED': return 'neutral';
    default: return 'info';
  }
};

const taskStatusMeta = (s) => TASK_STATUS.find((x) => x.value === s) || { label: s, color: 'default' };
const taskPriorityMeta = (s) => TASK_PRIORITY.find((x) => x.value === s) || { label: s, color: 'default' };

export default function ProjectDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const canEdit = ['ADMIN', 'MANAGER'].includes(user?.role);

  const [project, setProject] = useState(null);
  const [stats, setStats] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [members, setMembers] = useState([]);
  const [users, setUsers] = useState([]);
  const [financial, setFinancial] = useState(null);
  const [financialLoading, setFinancialLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');

  // Project edit modal
  const [editProjectOpen, setEditProjectOpen] = useState(false);
  const [projectForm] = Form.useForm();
  const [savingProject, setSavingProject] = useState(false);

  // Task modal
  const [taskModalOpen, setTaskModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const [taskForm] = Form.useForm();
  const [savingTask, setSavingTask] = useState(false);

  // Task filters
  const [taskStatusFilter, setTaskStatusFilter] = useState();
  const [taskPriorityFilter, setTaskPriorityFilter] = useState();

  // Member modal
  const [memberModalOpen, setMemberModalOpen] = useState(false);
  const [memberForm] = Form.useForm();
  const [savingMember, setSavingMember] = useState(false);

  const loadProject = async () => {
    try {
      const res = await axios.get(`/projects/${id}`);
      setProject(res.data?.data);
      setMembers(res.data?.data?.members || []);
    } catch (err) {
      if (err?.response?.status === 404) {
        message.error('Dự án không tồn tại');
        navigate('/projects');
      } else {
        message.error('Không tải được dự án');
      }
    }
  };

  const loadStats = async () => {
    try {
      const res = await axios.get(`/projects/${id}/stats`);
      setStats(res.data?.data);
    } catch {
      // ignore
    }
  };

  const loadTasks = async () => {
    try {
      const params = { limit: 200 };
      if (taskStatusFilter) params.status = taskStatusFilter;
      if (taskPriorityFilter) params.priority = taskPriorityFilter;
      const res = await axios.get(`/projects/${id}/tasks`, { params });
      setTasks(res.data?.data || []);
    } catch {
      message.error('Không tải được công việc');
    }
  };

  const loadUsers = async () => {
    try {
      const res = await axios.get('/projects/assignable-users');
      setUsers(res.data?.data || []);
    } catch {
      // ignore
    }
  };

  const loadFinancial = async () => {
    setFinancialLoading(true);
    try {
      const res = await axios.get(`/projects/${id}/financial`, { params: { limit: 50 } });
      setFinancial(res.data?.data);
    } catch (err) {
      message.error(err?.response?.data?.message || 'Không tải được dữ liệu tài chính');
    } finally {
      setFinancialLoading(false);
    }
  };

  useEffect(() => {
    (async () => {
      setLoading(true);
      await Promise.all([loadProject(), loadStats(), loadTasks(), loadUsers()]);
      setLoading(false);
    })();
  }, [id]);

  useEffect(() => {
    if (!loading) loadTasks();
  }, [taskStatusFilter, taskPriorityFilter]);

  useEffect(() => {
    if (activeTab === 'financial' && !financial) {
      loadFinancial();
    }
  }, [activeTab]);

  // ===== Project actions =====
  const openEditProject = () => {
    projectForm.setFieldsValue({
      name: project.name,
      description: project.description,
      status: project.status,
      startDate: project.startDate ? dayjs(project.startDate) : null,
      endDate: project.endDate ? dayjs(project.endDate) : null,
      budget: project.budget != null ? Number(project.budget) : null,
    });
    setEditProjectOpen(true);
  };

  const handleSaveProject = async () => {
    try {
      const values = await projectForm.validateFields();
      setSavingProject(true);
      const payload = {
        name: values.name,
        description: values.description || null,
        status: values.status,
        startDate: values.startDate ? values.startDate.toISOString() : null,
        endDate: values.endDate ? values.endDate.toISOString() : null,
        budget: values.budget != null ? Number(values.budget) : null,
      };
      await axios.patch(`/projects/${id}`, payload);
      message.success('Đã cập nhật dự án');
      setEditProjectOpen(false);
      await Promise.all([loadProject(), loadStats()]);
    } catch (err) {
      if (err?.errorFields) return;
      message.error(err?.response?.data?.message || 'Lưu thất bại');
    } finally {
      setSavingProject(false);
    }
  };

  // ===== Task actions =====
  const openTaskModal = (task = null) => {
    setEditingTask(task);
    if (task) {
      taskForm.setFieldsValue({
        title: task.title,
        description: task.description,
        status: task.status,
        priority: task.priority,
        dueDate: task.dueDate ? dayjs(task.dueDate) : null,
        assigneeId: task.assignee?.id || null,
      });
    } else {
      taskForm.resetFields();
      taskForm.setFieldsValue({ status: 'TODO', priority: 'MEDIUM' });
    }
    setTaskModalOpen(true);
  };

  const handleSaveTask = async () => {
    try {
      const values = await taskForm.validateFields();
      setSavingTask(true);
      const payload = {
        title: values.title,
        description: values.description || null,
        status: values.status,
        priority: values.priority,
        dueDate: values.dueDate ? values.dueDate.toISOString() : null,
        assigneeId: values.assigneeId || null,
      };
      if (editingTask) {
        await axios.patch(`/projects/${id}/tasks/${editingTask.id}`, payload);
        message.success('Đã cập nhật công việc');
      } else {
        await axios.post(`/projects/${id}/tasks`, payload);
        message.success('Đã tạo công việc');
      }
      setTaskModalOpen(false);
      await Promise.all([loadTasks(), loadStats()]);
    } catch (err) {
      if (err?.errorFields) return;
      message.error(err?.response?.data?.message || 'Lưu thất bại');
    } finally {
      setSavingTask(false);
    }
  };

  const handleDeleteTask = (taskId) => {
    Modal.confirm({
      title: 'Xóa công việc?',
      okText: 'Xóa', okButtonProps: { danger: true }, cancelText: 'Hủy',
      onOk: async () => {
        try {
          await axios.delete(`/projects/${id}/tasks/${taskId}`);
          message.success('Đã xóa');
          await Promise.all([loadTasks(), loadStats()]);
        } catch (err) {
          message.error(err?.response?.data?.message || 'Xóa thất bại');
        }
      },
    });
  };

  const handleQuickTaskStatus = async (taskId, status) => {
    try {
      await axios.patch(`/projects/${id}/tasks/${taskId}`, { status });
      await Promise.all([loadTasks(), loadStats()]);
    } catch (err) {
      message.error(err?.response?.data?.message || 'Cập nhật thất bại');
    }
  };

  // ===== Member actions =====
  const openMemberModal = () => {
    memberForm.resetFields();
    memberForm.setFieldsValue({ role: 'MEMBER' });
    setMemberModalOpen(true);
  };

  const handleAddMember = async () => {
    try {
      const values = await memberForm.validateFields();
      setSavingMember(true);
      await axios.post(`/projects/${id}/members`, values);
      message.success('Đã thêm thành viên');
      setMemberModalOpen(false);
      await loadProject();
    } catch (err) {
      if (err?.errorFields) return;
      message.error(err?.response?.data?.message || 'Thêm thất bại');
    } finally {
      setSavingMember(false);
    }
  };

  const handleUpdateMemberRole = async (userId, role) => {
    try {
      await axios.patch(`/projects/${id}/members/${userId}`, { role });
      await loadProject();
    } catch (err) {
      message.error(err?.response?.data?.message || 'Cập nhật thất bại');
    }
  };

  const handleRemoveMember = (userId) => {
    Modal.confirm({
      title: 'Xóa thành viên?',
      okText: 'Xóa', okButtonProps: { danger: true }, cancelText: 'Hủy',
      onOk: async () => {
        try {
          await axios.delete(`/projects/${id}/members/${userId}`);
          message.success('Đã xóa thành viên');
          await loadProject();
        } catch (err) {
          message.error(err?.response?.data?.message || 'Xóa thất bại');
        }
      },
    });
  };

  // ===== Render helpers =====
  const memberUserIds = new Set(members.map((m) => m.user?.id));
  const availableUsers = users.filter((u) => !memberUserIds.has(u.id));

  if (loading || !project) {
    return (
      <div style={{ padding: 48, textAlign: 'center' }}>
        <Spin size="large" />
      </div>
    );
  }

  // ===== Tab: Overview =====
  const renderOverview = () => (
    <Row gutter={[16, 16]}>
      <Col xs={24} md={16}>
        <Card title="Thông tin dự án">
          <Descriptions column={1} size="small">
            <Descriptions.Item label="Mã dự án">
              <span style={{ fontFamily: 'var(--font-mono)' }}>{project.code}</span>
            </Descriptions.Item>
            <Descriptions.Item label="Tên">{project.name}</Descriptions.Item>
            <Descriptions.Item label="Mô tả">
              {project.description || <span style={{ color: 'var(--text-muted)' }}>—</span>}
            </Descriptions.Item>
            <Descriptions.Item label="Trạng thái">
              <StatusTag
                status={project.status}
                label={projectStatusLabel(project.status)}
                variant={projectStatusVariant(project.status)}
              />
            </Descriptions.Item>
            <Descriptions.Item label="Ngày bắt đầu">
              {project.startDate ? dayjs(project.startDate).format('DD/MM/YYYY') : '—'}
            </Descriptions.Item>
            <Descriptions.Item label="Ngày kết thúc">
              {project.endDate ? dayjs(project.endDate).format('DD/MM/YYYY') : '—'}
            </Descriptions.Item>
            <Descriptions.Item label="Ngân sách">
              {project.budget != null
                ? <MoneyDisplay value={Number(project.budget)} />
                : '—'}
            </Descriptions.Item>
            <Descriptions.Item label="Người tạo">
              {project.createdBy?.fullName || '—'}
            </Descriptions.Item>
            <Descriptions.Item label="Tạo lúc">
              {dayjs(project.createdAt).format('DD/MM/YYYY HH:mm')}
            </Descriptions.Item>
          </Descriptions>
        </Card>
      </Col>
      <Col xs={24} md={8}>
        <Card title="Tiến độ">
          <div style={{ textAlign: 'center', marginBottom: 16 }}>
            <Progress
              type="circle"
              percent={stats?.progress || 0}
              strokeColor="#0f766e"
            />
          </div>
          <Row gutter={[8, 8]}>
            <Col span={12}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Tổng task</div>
              <div style={{ fontSize: 20, fontWeight: 600 }}>{stats?.totalTasks || 0}</div>
            </Col>
            <Col span={12}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Hoàn thành</div>
              <div style={{ fontSize: 20, fontWeight: 600, color: 'var(--success)' }}>
                {stats?.doneTasks || 0}
              </div>
            </Col>
            <Col span={12}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Đang làm</div>
              <div style={{ fontSize: 20, fontWeight: 600, color: 'var(--info)' }}>
                {stats?.inProgressTasks || 0}
              </div>
            </Col>
            <Col span={12}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Quá hạn</div>
              <div style={{ fontSize: 20, fontWeight: 600, color: 'var(--danger)' }}>
                {stats?.overdueTasks || 0}
              </div>
            </Col>
          </Row>
        </Card>
      </Col>
    </Row>
  );

  // ===== Tab: Tasks =====
  const taskColumns = [
    {
      title: 'Tiêu đề',
      dataIndex: 'title',
      render: (title, row) => (
        <div>
          <div style={{ fontWeight: 500 }}>{title}</div>
          {row.description && (
            <div style={{
              fontSize: 12, color: 'var(--text-muted)',
              maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
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
      width: 150,
      render: (status, row) => canEdit ? (
        <Select
          size="small"
          value={status}
          style={{ width: 130 }}
          options={TASK_STATUS.map((s) => ({ value: s.value, label: s.label }))}
          onChange={(v) => handleQuickTaskStatus(row.id, v)}
        />
      ) : (
        <Tag color={taskStatusMeta(status).color}>{taskStatusMeta(status).label}</Tag>
      ),
    },
    {
      title: 'Ưu tiên',
      dataIndex: 'priority',
      width: 110,
      render: (p) => <Tag color={taskPriorityMeta(p).color}>{taskPriorityMeta(p).label}</Tag>,
    },
    {
      title: 'Phụ trách',
      dataIndex: 'assignee',
      width: 160,
      render: (a) => a?.fullName || <span style={{ color: 'var(--text-muted)' }}>Chưa gán</span>,
    },
    {
      title: 'Hạn',
      dataIndex: 'dueDate',
      width: 120,
      render: (d, row) => {
        if (!d) return <span style={{ color: 'var(--text-muted)' }}>—</span>;
        const overdue = dayjs(d).isBefore(dayjs(), 'day') && !['DONE', 'CANCELLED'].includes(row.status);
        return (
          <span style={{ color: overdue ? 'var(--danger)' : 'inherit' }}>
            {dayjs(d).format('DD/MM/YYYY')}
          </span>
        );
      },
    },
    {
      title: '',
      width: 100,
      align: 'right',
      render: (_, row) => canEdit ? (
        <>
          <Button type="text" size="small" icon={<EditOutlined />} onClick={() => openTaskModal(row)} />
          <Button type="text" size="small" danger icon={<DeleteOutlined />} onClick={() => handleDeleteTask(row.id)} />
        </>
      ) : null,
    },
  ];

  const renderTasks = () => (
    <>
      <div className="filters-bar">
        <Select
          placeholder="Trạng thái"
          allowClear
          style={{ minWidth: 160 }}
          value={taskStatusFilter}
          onChange={setTaskStatusFilter}
          options={TASK_STATUS.map((s) => ({ value: s.value, label: s.label }))}
        />
        <Select
          placeholder="Ưu tiên"
          allowClear
          style={{ minWidth: 140 }}
          value={taskPriorityFilter}
          onChange={setTaskPriorityFilter}
          options={TASK_PRIORITY.map((p) => ({ value: p.value, label: p.label }))}
        />
        {canEdit && (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => openTaskModal()} style={{ marginLeft: 'auto' }}>
            Thêm công việc
          </Button>
        )}
      </div>

      <div className="table-card">
        <Table
          columns={taskColumns}
          dataSource={tasks}
          rowKey="id"
          pagination={{ pageSize: 20, showSizeChanger: false }}
          scroll={{ x: 900 }}
          locale={{
            emptyText: (
              <EmptyState
                title="Chưa có công việc"
                description="Tạo công việc đầu tiên cho dự án này"
                action={canEdit ? (
                  <Button type="primary" icon={<PlusOutlined />} onClick={() => openTaskModal()}>
                    Thêm công việc
                  </Button>
                ) : null}
              />
            ),
          }}
        />
      </div>
    </>
  );

  // ===== Tab: Members =====
  const memberColumns = [
    {
      title: 'Họ tên',
      dataIndex: ['user', 'fullName'],
      render: (name, row) => (
        <div>
          <div style={{ fontWeight: 500 }}>{name}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{row.user?.email}</div>
        </div>
      ),
    },
    {
      title: 'Vai trò hệ thống',
      dataIndex: ['user', 'role'],
      width: 160,
      render: (r) => <Tag>{r}</Tag>,
    },
    {
      title: 'Vai trò trong dự án',
      dataIndex: 'role',
      width: 180,
      render: (role, row) => canEdit ? (
        <Select
          size="small"
          value={role}
          style={{ width: 150 }}
          options={MEMBER_ROLES}
          onChange={(v) => handleUpdateMemberRole(row.user.id, v)}
        />
      ) : <Tag>{MEMBER_ROLES.find((x) => x.value === role)?.label || role}</Tag>,
    },
    {
      title: 'Tham gia',
      dataIndex: 'createdAt',
      width: 140,
      render: (d) => dayjs(d).format('DD/MM/YYYY'),
    },
    {
      title: '',
      width: 80,
      align: 'right',
      render: (_, row) => canEdit ? (
        <Button
          type="text" size="small" danger
          icon={<DeleteOutlined />}
          onClick={() => handleRemoveMember(row.user.id)}
        />
      ) : null,
    },
  ];

  const renderMembers = () => (
    <>
      {canEdit && (
        <div className="filters-bar">
          <Button
            type="primary"
            icon={<UserAddOutlined />}
            onClick={openMemberModal}
            style={{ marginLeft: 'auto' }}
            disabled={availableUsers.length === 0}
          >
            Thêm thành viên
          </Button>
        </div>
      )}
      <div className="table-card">
        <Table
          columns={memberColumns}
          dataSource={members}
          rowKey="id"
          pagination={false}
          locale={{
            emptyText: <EmptyState title="Chưa có thành viên" />,
          }}
        />
      </div>
    </>
  );

  // ===== Tab: Financial (Budget vs Actual) =====
  const expenseColumns = [
    { title: 'Mã', dataIndex: 'expenseCode', width: 140,
      render: (c) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{c}</span> },
    { title: 'Ngày', dataIndex: 'date', width: 100,
      render: (d) => dayjs(d).format('DD/MM/YYYY') },
    { title: 'Mô tả', dataIndex: 'description',
      render: (t, row) => (
        <div>
          <div>{t}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{row.category?.name}</div>
        </div>
      ) },
    { title: 'Số tiền', dataIndex: 'totalAmount', width: 140, align: 'right',
      render: (v) => <MoneyDisplay value={Number(v)} /> },
    { title: 'Trạng thái', dataIndex: 'status', width: 130,
      render: (s) => {
        const map = {
          DRAFT: { color: 'default', label: 'Nháp' },
          PENDING_APPROVAL: { color: 'processing', label: 'Chờ duyệt' },
          APPROVED: { color: 'blue', label: 'Đã duyệt' },
          PAID: { color: 'success', label: 'Đã thanh toán' },
          CANCELLED: { color: 'default', label: 'Đã hủy' },
        };
        const m = map[s] || { color: 'default', label: s };
        return <Tag color={m.color}>{m.label}</Tag>;
      } },
  ];

  const renderFinancial = () => {
    if (financialLoading) {
      return <div style={{ padding: 48, textAlign: 'center' }}><Spin size="large" /></div>;
    }
    if (!financial) return null;
    const s = financial.summary;
    const progressStatus = s.isOverBudget ? 'exception' : s.utilization >= 90 ? 'normal' : 'active';

    return (
      <>
        {s.isOverBudget && (
          <Alert
            type="error"
            showIcon
            icon={<WarningOutlined />}
            message="Dự án đã vượt ngân sách"
            description={
              <span>
                Đã chi <b><MoneyDisplay value={s.actualCost} /></b>, vượt <b><MoneyDisplay value={Math.abs(s.variance)} /></b> so với ngân sách{' '}
                <b><MoneyDisplay value={s.budget} /></b>.
              </span>
            }
            style={{ marginBottom: 16 }}
          />
        )}

        <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
          <Col xs={24} md={6}>
            <Card>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Ngân sách</div>
              <div style={{ fontSize: 22, fontWeight: 600 }}>
                <MoneyDisplay value={s.budget} />
              </div>
            </Card>
          </Col>
          <Col xs={24} md={6}>
            <Card>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Thực chi</div>
              <div style={{
                fontSize: 22, fontWeight: 600,
                color: s.isOverBudget ? 'var(--danger)' : 'var(--text-primary)',
              }}>
                <MoneyDisplay value={s.actualCost} />
              </div>
            </Card>
          </Col>
          <Col xs={24} md={6}>
            <Card>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Đã thanh toán</div>
              <div style={{ fontSize: 22, fontWeight: 600, color: 'var(--success)' }}>
                <MoneyDisplay value={s.paidCost} />
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                Chưa chi: <MoneyDisplay value={s.pendingCost} />
              </div>
            </Card>
          </Col>
          <Col xs={24} md={6}>
            <Card>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {s.variance >= 0 ? 'Còn lại' : 'Vượt'}
              </div>
              <div style={{
                fontSize: 22, fontWeight: 600,
                color: s.variance >= 0 ? 'var(--success)' : 'var(--danger)',
              }}>
                <MoneyDisplay value={Math.abs(s.variance)} />
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                {s.utilization}% đã dùng
              </div>
            </Card>
          </Col>
        </Row>

        {s.budget > 0 && (
          <Card style={{ marginBottom: 16 }}>
            <Progress
              percent={Math.min(s.utilization, 100)}
              status={progressStatus}
              format={() => `${s.utilization}%`}
              strokeColor={s.isOverBudget ? '#dc2626' : undefined}
            />
          </Card>
        )}

        <Card title={`Chi phí (${s.expenseCount})`}>
          <Table
            columns={expenseColumns}
            dataSource={financial.expenses}
            rowKey="id"
            pagination={false}
            size="small"
            locale={{
              emptyText: (
                <EmptyState
                  title="Chưa có chi phí nào"
                  description="Tạo chi phí và gắn projectId từ trang Chi phí để theo dõi ở đây"
                />
              ),
            }}
          />
        </Card>
      </>
    );
  };

  return (
    <PlanGate moduleKey="projects" moduleName="Chi tiết dự án">
    <>
      <PageHeader
        title={project.name}
        subtitle={`Mã dự án: ${project.code}`}
        actions={
          <>
            <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/projects')}>
              Quay lại
            </Button>
            {canEdit && (
              <Button type="primary" icon={<EditOutlined />} onClick={openEditProject}>
                Sửa dự án
              </Button>
            )}
          </>
        }
      />

      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          { key: 'overview', label: 'Tổng quan', children: renderOverview() },
          {
            key: 'tasks',
            label: (
              <span>
                <CheckSquareOutlined /> Công việc ({stats?.totalTasks || 0})
              </span>
            ),
            children: renderTasks(),
          },
          {
            key: 'financial',
            label: (
              <span>
                <DollarOutlined /> Tài chính
              </span>
            ),
            children: renderFinancial(),
          },
          {
            key: 'members',
            label: `Thành viên (${members.length})`,
            children: renderMembers(),
          },
        ]}
      />

      {/* Project edit modal */}
      <Modal
        title="Sửa dự án"
        open={editProjectOpen}
        onCancel={() => setEditProjectOpen(false)}
        onOk={handleSaveProject}
        okText="Lưu"
        cancelText="Hủy"
        confirmLoading={savingProject}
        width={560}
      >
        <Form form={projectForm} layout="vertical" size="large" style={{ marginTop: 16 }}>
          <Form.Item label="Tên dự án" name="name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item label="Mô tả" name="description">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item label="Trạng thái" name="status" rules={[{ required: true }]}>
                <Select options={PROJECT_STATUS} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="Ngân sách (VND)" name="budget">
                <Input type="number" min={0} />
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

      {/* Task modal */}
      <Modal
        title={editingTask ? 'Sửa công việc' : 'Thêm công việc'}
        open={taskModalOpen}
        onCancel={() => setTaskModalOpen(false)}
        onOk={handleSaveTask}
        okText="Lưu"
        cancelText="Hủy"
        confirmLoading={savingTask}
        width={560}
      >
        <Form form={taskForm} layout="vertical" size="large" style={{ marginTop: 16 }}>
          <Form.Item label="Tiêu đề" name="title" rules={[{ required: true }]}>
            <Input placeholder="VD: Thiết kế giao diện trang chủ" />
          </Form.Item>
          <Form.Item label="Mô tả" name="description">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item label="Trạng thái" name="status" rules={[{ required: true }]}>
                <Select options={TASK_STATUS.map((s) => ({ value: s.value, label: s.label }))} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="Ưu tiên" name="priority" rules={[{ required: true }]}>
                <Select options={TASK_PRIORITY.map((p) => ({ value: p.value, label: p.label }))} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item label="Hạn" name="dueDate">
                <DatePicker style={{ width: '100%' }} format="DD/MM/YYYY" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="Phụ trách" name="assigneeId">
                <Select
                  allowClear
                  placeholder="Chọn người phụ trách"
                  options={users.map((u) => ({ value: u.id, label: u.fullName }))}
                />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>

      {/* Member modal */}
      <Modal
        title="Thêm thành viên"
        open={memberModalOpen}
        onCancel={() => setMemberModalOpen(false)}
        onOk={handleAddMember}
        okText="Thêm"
        cancelText="Hủy"
        confirmLoading={savingMember}
        width={480}
      >
        <Form form={memberForm} layout="vertical" size="large" style={{ marginTop: 16 }}>
          <Form.Item label="Người dùng" name="userId" rules={[{ required: true }]}>
            <Select
              showSearch
              optionFilterProp="label"
              placeholder="Chọn người dùng"
              options={availableUsers.map((u) => ({
                value: u.id,
                label: `${u.fullName} (${u.email})`,
              }))}
            />
          </Form.Item>
          <Form.Item label="Vai trò" name="role" rules={[{ required: true }]}>
            <Select options={MEMBER_ROLES} />
          </Form.Item>
        </Form>
      </Modal>
    </>
    </PlanGate>
  );
}
