import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Card, Descriptions, Table, Button, Modal, Spin, message, Row, Col, Tag, Space,
} from 'antd';
import {
  ArrowLeftOutlined, PlayCircleOutlined, CheckCircleOutlined, StopOutlined,
  DeleteOutlined, WarningOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import axios from '../../api/axios';
import PageHeader from '../../components/layout/PageHeader';
import StatusTag from '../../components/shared/StatusTag';
import EmptyState from '../../components/shared/EmptyState';
import useAuthStore from '../../stores/authStore';

const WO_STATUS = [
  { value: 'DRAFT', label: 'Nháp', variant: 'info' },
  { value: 'IN_PROGRESS', label: 'Đang sản xuất', variant: 'primary' },
  { value: 'COMPLETED', label: 'Hoàn thành', variant: 'success' },
  { value: 'CANCELLED', label: 'Đã hủy', variant: 'danger' },
];
const statusMeta = (s) => WO_STATUS.find((x) => x.value === s) || { label: s, variant: 'neutral' };

export default function WorkOrderDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const canEdit = ['ADMIN', 'MANAGER', 'WAREHOUSE'].includes(user?.role);
  const canCancel = ['ADMIN', 'MANAGER'].includes(user?.role);

  const [wo, setWo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);

  const load = async () => {
    try {
      const res = await axios.get(`/production/work-orders/${id}`);
      setWo(res.data?.data);
    } catch (err) {
      if (err?.response?.status === 404) {
        message.error('Lệnh sản xuất không tồn tại');
        navigate('/production');
      } else {
        message.error('Không tải được dữ liệu');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    load();
  }, [id]);

  const doAction = async (path, successMsg) => {
    try {
      setActing(true);
      await axios.post(`/production/work-orders/${id}/${path}`);
      message.success(successMsg);
      await load();
    } catch (err) {
      message.error(err?.response?.data?.message || 'Thao tác thất bại');
    } finally {
      setActing(false);
    }
  };

  const handleStart = () => {
    Modal.confirm({
      title: 'Bắt đầu sản xuất?',
      content: 'Hệ thống sẽ kiểm tra tồn kho nguyên liệu trước khi chuyển trạng thái sang ĐANG SẢN XUẤT.',
      okText: 'Bắt đầu', cancelText: 'Hủy',
      onOk: () => doAction('start', 'Đã bắt đầu sản xuất'),
    });
  };

  const handleComplete = () => {
    Modal.confirm({
      title: 'Hoàn thành lệnh sản xuất?',
      content: (
        <div>
          <p>Hệ thống sẽ tự động:</p>
          <ul>
            <li><b>Trừ kho</b> nguyên liệu theo định mức</li>
            <li><b>Cộng kho</b> thành phẩm</li>
            <li>Tạo các giao dịch tồn kho (InventoryTransaction)</li>
          </ul>
          <p style={{ color: 'var(--danger)' }}>Hành động này không thể hoàn tác.</p>
        </div>
      ),
      okText: 'Hoàn thành', okType: 'primary', cancelText: 'Hủy',
      onOk: () => doAction('complete', 'Đã hoàn thành lệnh sản xuất'),
    });
  };

  const handleCancel = () => {
    Modal.confirm({
      title: 'Hủy lệnh sản xuất?',
      content: 'WO sẽ chuyển sang trạng thái HỦY và không thể tiếp tục.',
      okText: 'Hủy WO', okButtonProps: { danger: true }, cancelText: 'Quay lại',
      onOk: () => doAction('cancel', 'Đã hủy lệnh sản xuất'),
    });
  };

  const handleDelete = () => {
    Modal.confirm({
      title: 'Xóa lệnh sản xuất?',
      okText: 'Xóa', okButtonProps: { danger: true }, cancelText: 'Quay lại',
      onOk: async () => {
        try {
          await axios.delete(`/production/work-orders/${id}`);
          message.success('Đã xóa');
          navigate('/production');
        } catch (err) {
          message.error(err?.response?.data?.message || 'Xóa thất bại');
        }
      },
    });
  };

  if (loading || !wo) {
    return (
      <div style={{ padding: 48, textAlign: 'center' }}>
        <Spin size="large" />
      </div>
    );
  }

  const m = statusMeta(wo.status);

  const itemColumns = [
    {
      title: 'Nguyên liệu',
      dataIndex: ['component', 'name'],
      render: (name, row) => (
        <div>
          <div style={{ fontWeight: 500 }}>{name}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            SKU: {row.component?.sku}
          </div>
        </div>
      ),
    },
    {
      title: 'Cần',
      dataIndex: 'requiredQty',
      width: 100,
      align: 'right',
      render: (q, row) => `${q} ${row.component?.unit || ''}`,
    },
    {
      title: 'Tồn kho',
      dataIndex: 'availableQty',
      width: 110,
      align: 'right',
      render: (q, row) => {
        const enough = q >= row.requiredQty;
        return (
          <span style={{ color: enough ? 'var(--success)' : 'var(--danger)', fontWeight: 500 }}>
            {q} {row.component?.unit || ''}
            {!enough && <WarningOutlined style={{ marginLeft: 4 }} />}
          </span>
        );
      },
    },
    {
      title: 'Đã tiêu thụ',
      dataIndex: 'consumedQty',
      width: 110,
      align: 'right',
      render: (q, row) => (
        <span style={{ color: 'var(--text-muted)' }}>
          {q} {row.component?.unit || ''}
        </span>
      ),
    },
  ];

  const renderActions = () => {
    const actions = [];
    actions.push(
      <Button key="back" icon={<ArrowLeftOutlined />} onClick={() => navigate('/production')}>
        Quay lại
      </Button>
    );
    if (canEdit && wo.status === 'DRAFT') {
      actions.push(
        <Button key="start" type="primary" icon={<PlayCircleOutlined />} loading={acting} onClick={handleStart}>
          Bắt đầu
        </Button>
      );
    }
    if (canEdit && wo.status === 'IN_PROGRESS') {
      actions.push(
        <Button key="complete" type="primary" icon={<CheckCircleOutlined />} loading={acting} onClick={handleComplete}>
          Hoàn thành
        </Button>
      );
    }
    if (canCancel && ['DRAFT', 'IN_PROGRESS'].includes(wo.status)) {
      actions.push(
        <Button key="cancel" danger icon={<StopOutlined />} loading={acting} onClick={handleCancel}>
          Hủy WO
        </Button>
      );
    }
    if (canCancel && wo.status === 'DRAFT') {
      actions.push(
        <Button key="delete" danger type="text" icon={<DeleteOutlined />} onClick={handleDelete}>
          Xóa
        </Button>
      );
    }
    return <Space wrap>{actions}</Space>;
  };

  return (
    <>
      <PageHeader
        title={`Lệnh sản xuất ${wo.code}`}
        subtitle={
          <Space>
            <StatusTag status={wo.status} label={m.label} variant={m.variant} />
            <span>•</span>
            <span>Tạo lúc {dayjs(wo.createdAt).format('DD/MM/YYYY HH:mm')}</span>
          </Space>
        }
        actions={renderActions()}
      />

      <Row gutter={[16, 16]}>
        <Col xs={24} md={16}>
          <Card title="Thông tin lệnh sản xuất">
            <Descriptions column={2} size="small">
              <Descriptions.Item label="Mã WO" span={1}>
                <span style={{ fontFamily: 'var(--font-mono)' }}>{wo.code}</span>
              </Descriptions.Item>
              <Descriptions.Item label="Trạng thái" span={1}>
                <StatusTag status={wo.status} label={m.label} variant={m.variant} />
              </Descriptions.Item>
              <Descriptions.Item label="Sản phẩm" span={2}>
                <b>{wo.product?.name}</b>
                <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>
                  (SKU: {wo.product?.sku})
                </span>
              </Descriptions.Item>
              <Descriptions.Item label="Số lượng kế hoạch">
                {wo.quantity} {wo.product?.unit}
              </Descriptions.Item>
              <Descriptions.Item label="Đã sản xuất">
                <span style={{ color: wo.producedQty > 0 ? 'var(--success)' : 'var(--text-muted)' }}>
                  {wo.producedQty} {wo.product?.unit}
                </span>
              </Descriptions.Item>
              <Descriptions.Item label="BOM">
                <Tag>{wo.bom?.code} ({wo.bom?.version})</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Kho">
                {wo.warehouse?.code} - {wo.warehouse?.name}
              </Descriptions.Item>
              <Descriptions.Item label="Ngày bắt đầu (kế hoạch)">
                {wo.plannedStartDate ? dayjs(wo.plannedStartDate).format('DD/MM/YYYY') : '—'}
              </Descriptions.Item>
              <Descriptions.Item label="Ngày kết thúc (kế hoạch)">
                {wo.plannedEndDate ? dayjs(wo.plannedEndDate).format('DD/MM/YYYY') : '—'}
              </Descriptions.Item>
              <Descriptions.Item label="Bắt đầu thực tế">
                {wo.actualStartDate ? dayjs(wo.actualStartDate).format('DD/MM/YYYY HH:mm') : '—'}
              </Descriptions.Item>
              <Descriptions.Item label="Kết thúc thực tế">
                {wo.actualEndDate ? dayjs(wo.actualEndDate).format('DD/MM/YYYY HH:mm') : '—'}
              </Descriptions.Item>
              <Descriptions.Item label="Người tạo" span={2}>
                {wo.createdBy?.fullName}
              </Descriptions.Item>
              {wo.notes && (
                <Descriptions.Item label="Ghi chú" span={2}>
                  {wo.notes}
                </Descriptions.Item>
              )}
            </Descriptions>
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card title="Tổng quan nguyên liệu">
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Tổng số loại</div>
              <div style={{ fontSize: 24, fontWeight: 600 }}>{wo.items?.length || 0}</div>
            </div>
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Đủ tồn kho</div>
              <div style={{ fontSize: 18, fontWeight: 500, color: 'var(--success)' }}>
                {wo.items?.filter((it) => it.availableQty >= it.requiredQty).length || 0} / {wo.items?.length || 0}
              </div>
            </div>
            {wo.items?.some((it) => it.availableQty < it.requiredQty) && wo.status === 'DRAFT' && (
              <div style={{
                marginTop: 12, padding: 12, borderRadius: 8,
                background: 'var(--warning-bg, #fef3c7)',
                color: 'var(--warning-text, #92400e)',
                fontSize: 13,
              }}>
                <WarningOutlined /> Có nguyên liệu chưa đủ tồn kho. Vui lòng nhập kho trước khi bắt đầu sản xuất.
              </div>
            )}
          </Card>
        </Col>
      </Row>

      <Card title="Danh sách nguyên liệu" style={{ marginTop: 16 }}>
        <Table
          columns={itemColumns}
          dataSource={wo.items || []}
          rowKey="id"
          pagination={false}
          locale={{ emptyText: <EmptyState title="Không có nguyên liệu" /> }}
        />
      </Card>
    </>
  );
}
