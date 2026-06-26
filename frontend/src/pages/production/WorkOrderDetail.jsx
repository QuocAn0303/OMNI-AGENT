/**
 * Frontend: pages/production/WorkOrderDetail.jsx — Chi tiết lệnh sản xuất
 *
 * Tổng quan:
 * - Xem thông tin chi tiết Work Order, danh sách nguyên liệu + tồn kho
 * - Quy trình trạng thái: DRAFT → IN_PROGRESS → COMPLETED (hoặc CANCELLED)
 * - Khi hoàn thành: tự động trừ/tồn nguyên liệu, cộng thành phẩm, tạo giao dịch tồn kho
 * - API: GET /production/work-orders/:id, POST .../start, .../complete, .../cancel, DELETE
 * - Hiển thị giá vốn dự kiến/thực tế, tổng quan nguyên liệu
 *
 * Components/Hooks/Exports:
 * - WorkOrderDetail: Component chính (xuất mặc định)
 * - WO_STATUS + statusMeta helper
 */
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Card, Descriptions, Table, Button, Modal, Spin, message, Row, Col, Tag, Space,
  Input, Form, Select, Divider,
} from 'antd';
import {
  ArrowLeftOutlined, PlayCircleOutlined, CheckCircleOutlined, StopOutlined,
  DeleteOutlined, WarningOutlined, ExperimentOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import axios from '../../api/axios';
import PageHeader from '../../components/layout/PageHeader';
import PlanGate from '../../components/PlanGate';
import StatusTag from '../../components/shared/StatusTag';
import EmptyState from '../../components/shared/EmptyState';
import MoneyDisplay from '../../components/shared/MoneyDisplay';
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

  // Quality Check
  const [qcList, setQcList] = useState([]);
  const [qcLoading, setQcLoading] = useState(false);
  const [qcModalOpen, setQcModalOpen] = useState(false);
  const [qcSubmitOpen, setQcSubmitOpen] = useState(false);
  const [qcForm] = Form.useForm();
  const [qcSubmitForm] = Form.useForm();
  const [savingQc, setSavingQc] = useState(false);
  const [selectedQc, setSelectedQc] = useState(null);

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

  const loadQc = async () => {
    try {
      setQcLoading(true);
      const res = await axios.get(`/production/quality/${id}`);
      setQcList(res.data?.data || []);
    } catch { setQcList([]); }
    finally { setQcLoading(false); }
  };

  useEffect(() => {
    setLoading(true);
    load();
  }, [id]);

  useEffect(() => {
    if (id) loadQc();
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

  // ===== Quality Check handlers =====
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
      await axios.post(`/production/quality/${id}`, payload);
      message.success('Đã tạo phiếu kiểm tra');
      setQcModalOpen(false);
      qcForm.resetFields();
      await loadQc();
    } catch (err) {
      if (err?.errorFields) return;
      message.error(err?.response?.data?.message || 'Tạo thất bại');
    } finally { setSavingQc(false); }
  };

  const handleSubmitQc = async () => {
    try {
      const values = await qcSubmitForm.validateFields();
      setSavingQc(true);
      await axios.patch(`/production/quality/${selectedQc.id}/submit`, values);
      message.success('Đã cập nhật kết quả kiểm tra');
      setQcSubmitOpen(false);
      setSelectedQc(null);
      await loadQc();
    } catch (err) {
      if (err?.errorFields) return;
      message.error(err?.response?.data?.message || 'Cập nhật thất bại');
    } finally { setSavingQc(false); }
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
    {
      title: 'Giá vốn / ĐV',
      dataIndex: ['component', 'costPrice'],
      width: 130,
      align: 'right',
      render: (v) => v ? <MoneyDisplay value={Number(v)} /> : <span style={{ color: 'var(--text-muted)' }}>—</span>,
    },
    {
      title: 'Thành tiền',
      dataIndex: 'lineCost',
      width: 140,
      align: 'right',
      render: (v) => v > 0
        ? <span style={{ fontWeight: 500 }}><MoneyDisplay value={Number(v)} /></span>
        : <span style={{ color: 'var(--text-muted)' }}>—</span>,
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
    <PlanGate moduleKey="production" moduleName="Chi tiết lệnh sản xuất">
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
            {(() => {
              const estTotal = (wo.items || []).reduce((s, it) => s + Number(it.lineCost || 0), 0);
              const actualTotal = Number(wo.totalCost || 0);
              const shown = actualTotal > 0 ? actualTotal : estTotal;
              if (shown <= 0) return null;
              return (
                <div style={{ marginBottom: 8, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {wo.status === 'COMPLETED' ? 'Tổng giá vốn' : 'Dự kiến giá vốn'}
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--primary)' }}>
                    <MoneyDisplay value={shown} />
                  </div>
                  {wo.status === 'COMPLETED' && wo.quantity > 0 && (
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      Đơn vị: <MoneyDisplay value={shown / wo.quantity} /> / {wo.product?.unit || 'đv'}
                    </div>
                  )}
                </div>
              );
            })()}
            {wo.status === 'COMPLETED' && wo.journalEntryId && (
              <div style={{ marginTop: 8, fontSize: 12 }}>
                ✓ Đã ghi bút toán kế toán (ID: <span style={{ fontFamily: 'var(--font-mono)' }}>{wo.journalEntryId.slice(0, 8)}</span>)
              </div>
            )}
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

      {/* Quality Check */}
      <Card
        title={<Space><ExperimentOutlined /> Kiểm tra chất lượng</Space>}
        style={{ marginTop: 16 }}
        extra={canEdit && ['IN_PROGRESS', 'COMPLETED'].includes(wo.status) && (
          <Button type="primary" size="small" onClick={() => { qcForm.resetFields(); qcForm.setFieldsValue({ items: [{ name: '', result: '', notes: '' }] }); setQcModalOpen(true); }}>
            Tạo phiếu kiểm tra
          </Button>
        )}
      >
        {qcLoading ? <Spin /> : qcList.length === 0 ? (
          <EmptyState title="Chưa kiểm tra chất lượng" />
        ) : (
          qcList.map((qc) => (
            <div key={qc.id} style={{ marginBottom: 24, padding: 16, border: '1px solid var(--border)', borderRadius: 8 }}>
              <Descriptions column={2} size="small">
                <Descriptions.Item label="Trạng thái">
                  <Tag color={qc.status === 'PASSED' ? 'green' : qc.status === 'FAILED' ? 'red' : qc.status === 'PARTIAL' ? 'orange' : 'default'}>
                    {qc.status === 'PASSED' ? 'Đạt' : qc.status === 'FAILED' ? 'Không đạt' : qc.status === 'PARTIAL' ? 'Một phần' : 'Chờ kiểm tra'}
                  </Tag>
                </Descriptions.Item>
                <Descriptions.Item label="Người kiểm">
                  {qc.checkedBy?.fullName || '—'}
                </Descriptions.Item>
                <Descriptions.Item label="Thời điểm">{qc.checkedAt ? dayjs(qc.checkedAt).format('DD/MM/YYYY HH:mm') : '—'}</Descriptions.Item>
                <Descriptions.Item label="Ghi chú">{qc.notes || '—'}</Descriptions.Item>
              </Descriptions>
              {qc.items?.length > 0 && (
                <Table
                  columns={[
                    { title: 'Hạng mục', dataIndex: 'name' },
                    {
                      title: 'Kết quả', dataIndex: 'result',
                      render: (r) => {
                        if (!r) return <Tag>Chưa kiểm tra</Tag>;
                        return <Tag color={r === 'PASS' ? 'green' : 'red'}>{r === 'PASS' ? 'Đạt' : 'Không đạt'}</Tag>;
                      },
                    },
                    { title: 'Ghi chú', dataIndex: 'notes' },
                  ]}
                  dataSource={qc.items || []}
                  rowKey="id"
                  pagination={false}
                  size="small"
                />
              )}
              {canEdit && qc.status === 'PENDING' && (
                <Button type="primary" style={{ marginTop: 12 }} onClick={() => {
                  setSelectedQc(qc);
                  qcSubmitForm.resetFields();
                  qcSubmitForm.setFieldsValue({
                    status: 'PASSED',
                    items: (qc.items || []).map((it) => ({ id: it.id, result: it.result || 'PASS', notes: it.notes })),
                  });
                  setQcSubmitOpen(true);
                }}>
                  Cập nhật kết quả
                </Button>
              )}
            </div>
          ))
        )}
      </Card>

      {/* QC Create Modal */}
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

      {/* QC Submit Modal */}
      <Modal
        title="Cập nhật kết quả kiểm tra"
        open={qcSubmitOpen}
        onCancel={() => setQcSubmitOpen(false)}
        onOk={handleSubmitQc}
        okText="Lưu kết quả"
        cancelText="Hủy"
        confirmLoading={savingQc}
        width={600}
      >
        <Form form={qcSubmitForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="status" label="Kết quả tổng thể" rules={[{ required: true }]}>
            <Select options={[
              { value: 'PASSED', label: 'Đạt' },
              { value: 'FAILED', label: 'Không đạt' },
              { value: 'PARTIAL', label: 'Một phần' },
            ]} />
          </Form.Item>
          <Form.Item name="notes" label="Ghi chú">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Divider>Kết quả từng hạng mục</Divider>
          <Form.List name="items">
            {(fields) => fields.map((f) => (
              <Space key={f.key} style={{ width: '100%', marginBottom: 8 }} align="start">
                <Form.Item name={[f.name, 'id']} noStyle>
                  <Input disabled style={{ width: 0, padding: 0, border: 'none' }} />
                </Form.Item>
                <Form.Item name={[f.name, 'result']} rules={[{ required: true }]} noStyle>
                  <Select style={{ width: 200 }}
                    options={[
                      { value: 'PASS', label: 'Đạt' },
                      { value: 'FAIL', label: 'Không đạt' },
                    ]}
                  />
                </Form.Item>
                <Form.Item name={[f.name, 'notes']} noStyle>
                  <Input placeholder="Ghi chú" style={{ width: 300 }} />
                </Form.Item>
              </Space>
            ))}
          </Form.List>
        </Form>
      </Modal>
    </>
    </PlanGate>
  );
}
