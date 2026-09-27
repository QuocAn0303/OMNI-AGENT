/**
 * Frontend: src/pages/fnb/Kds.jsx — Kitchen Display System (màn hình bếp)
 *
 * Tổng quan:
 * - Full-screen dark, hiển thị ticket theo station + trạng thái
 * - Bump: NEW → COOKING → READY → SERVED (bấm card)
 * - Auto-refresh 5s + recall món quá giờ
 * - Món quá 15' chưa ready → viền đỏ
 */
import { useState, useEffect, useCallback } from 'react';
import { Card, Row, Col, Button, Tag, Space, Select, Empty, Spin, message, Modal, Input, InputNumber, Form, Popconfirm } from 'antd';
import { FireOutlined, ReloadOutlined, ClockCircleOutlined, PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import api from '../../api/axios';

const STATUS_FLOW = { NEW: 'COOKING', COOKING: 'READY', READY: 'SERVED' };
const STATUS_COLOR = {
  NEW: { border: '#3b82f6', bg: '#1e3a8a', label: 'Mới' },
  COOKING: { border: '#f59e0b', bg: '#78350f', label: 'Đang nấu' },
  READY: { border: '#10b981', bg: '#064e3b', label: 'Sẵn sàng' },
  RECALLED: { border: '#ef4444', bg: '#7f1d1d', label: 'Gọi lại' },
};

const STALE_MINUTES = 15;

export default function Kds() {
  const [stations, setStations] = useState([]);
  const [activeStation, setActiveStation] = useState(null);
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [stationModal, setStationModal] = useState({ open: false, editing: null });
  const [saving, setSaving] = useState(false);
  const [stationForm] = Form.useForm();

  const loadStations = useCallback(async () => {
    try {
      const res = await api.get('/kds/stations');
      const data = res.data?.data || [];
      setStations(data);
      if (data.length > 0 && !activeStation) setActiveStation('all');
    } catch {
      /* silent */
    }
  }, [activeStation]);

  const loadTickets = useCallback(async () => {
    if (!activeStation) { setLoading(false); return; }
    try {
      const url = activeStation === 'all' ? '/kds/tickets' : `/kds/stations/${activeStation}/tickets`;
      const res = await api.get(url);
      setTickets(res.data?.data || []);
    } catch {
      /* silent */
    } finally {
      setLoading(false);
    }
  }, [activeStation]);

  useEffect(() => { loadStations(); }, [loadStations]);
  useEffect(() => { loadTickets(); }, [loadTickets]);

  // Auto-refresh 5s
  useEffect(() => {
    const t = setInterval(loadTickets, 5000);
    return () => clearInterval(t);
  }, [loadTickets]);

  const handleBump = async (ticketId, currentStatus) => {
    const next = STATUS_FLOW[currentStatus];
    if (!next) return;
    try {
      await api.post(`/kds/tickets/${ticketId}/bump`);
      loadTickets();
    } catch (err) {
      message.error(err.response?.data?.message || 'Lỗi bump');
    }
  };

  const handleRecall = async (ticketId) => {
    try {
      await api.post(`/kds/tickets/${ticketId}/recall`);
      loadTickets();
    } catch {
      message.error('Lỗi recall');
    }
  };

  // ============ STATION CRUD ============
  const openCreateStation = () => {
    stationForm.resetFields();
    stationForm.setFieldsValue({ sortOrder: 0, isActive: true });
    setStationModal({ open: true, editing: null });
  };

  const openEditStation = (station) => {
    stationForm.setFieldsValue({
      name: station.name,
      sortOrder: station.sortOrder || 0,
      isActive: station.isActive !== false,
    });
    setStationModal({ open: true, editing: station });
  };

  const handleSaveStation = async () => {
    try {
      const values = await stationForm.validateFields();
      setSaving(true);
      if (stationModal.editing) {
        await api.patch(`/kds/stations/${stationModal.editing.id}`, values);
      } else {
        await api.post('/kds/stations', values);
      }
      message.success(stationModal.editing ? 'Đã cập nhật station' : 'Đã tạo station');
      setStationModal({ open: false, editing: null });
      loadStations();
    } catch (e) {
      if (e?.errorFields) return;
      message.error(e.response?.data?.message || 'Lỗi lưu station');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteStation = async (station) => {
    try {
      await api.delete(`/kds/stations/${station.id}`);
      message.success('Đã xóa station');
      if (activeStation === station.id) setActiveStation('all');
      loadStations();
    } catch (e) {
      message.error(e.response?.data?.message || 'Không xóa được station');
    }
  };

  const isStale = (ticket) => {
    if (!ticket.firedAt) return false;
    const mins = (Date.now() - new Date(ticket.firedAt).getTime()) / 60000;
    return mins > STALE_MINUTES && ticket.status !== 'READY';
  };

  const fmtTime = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  };

  // Dark full-screen container
  const darkBg = { background: '#0f172a', minHeight: '100vh', padding: 16, color: '#e2e8f0' };

  return (
    <div style={darkBg}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ color: '#fbbf24', margin: 0 }}>
          <FireOutlined style={{ marginRight: 8 }} />
          Màn hình bếp (KDS)
        </h2>
        <Space>
          <Select
            value={activeStation}
            onChange={setActiveStation}
            style={{ width: 200 }}
            options={[{ label: 'Tất cả station', value: 'all' }, ...stations.map((s) => ({ label: s.name, value: s.id }))]}
          />
          <Button icon={<PlusOutlined />} onClick={openCreateStation} ghost>
            Station
          </Button>
          <Button icon={<ReloadOutlined />} onClick={loadTickets} ghost />
        </Space>
      </div>

      {loading ? (
        <Spin style={{ display: 'flex', justifyContent: 'center', marginTop: 100 }} />
      ) : tickets.length === 0 ? (
        <Empty description={<span style={{ color: '#94a3b8' }}>Không có món nào đang chờ</span>} />
      ) : (
        <Row gutter={[12, 12]}>
          {tickets.map((t) => {
            const cfg = STATUS_COLOR[t.status] || STATUS_COLOR.NEW;
            const stale = isStale(t);
            const item = t.orderItem;
            return (
              <Col key={t.id} xs={12} sm={8} md={6} lg={4}>
                <Card
                  size="small"
                  style={{
                    borderColor: stale ? '#ef4444' : cfg.border,
                    background: cfg.bg,
                    color: '#fff',
                    borderWidth: 2,
                  }}
                  bodyStyle={{ padding: 10 }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Tag color={cfg.border} style={{ margin: 0 }}>{cfg.label}</Tag>
                    <span style={{ fontSize: 11, color: '#cbd5e1' }}>
                      <ClockCircleOutlined /> {fmtTime(t.firedAt)}
                    </span>
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 700, marginTop: 8 }}>
                    {item?.product?.name || '—'}
                  </div>
                  {item?.modifiers?.length > 0 && (
                    <div style={{ fontSize: 12, color: '#fde68a', marginTop: 4 }}>
                      {item.modifiers.map((m) => `+${m.modifierOption?.name || ''}`).join(', ')}
                    </div>
                  )}
                  <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>SL: {item?.quantity}</div>
                  <Space style={{ marginTop: 8, width: '100%' }} direction="vertical" size={4}>
                    {STATUS_FLOW[t.status] && (
                      <Button
                        type="primary"
                        block
                        onClick={() => handleBump(t.id, t.status)}
                        style={{ background: cfg.border, borderColor: cfg.border }}
                      >
                        {t.status === 'NEW' ? 'Bắt đầu nấu' : t.status === 'COOKING' ? 'Xong → Sẵn sàng' : 'Đã phục vụ'}
                      </Button>
                    )}
                    {t.status === 'READY' && (
                      <Button block size="small" onClick={() => handleRecall(t.id)} ghost danger>
                        Gọi lại
                      </Button>
                    )}
                  </Space>
                </Card>
              </Col>
            );
          })}
        </Row>
      )}

      {/* CRUD Station */}
      <Modal
        title={stationModal.editing ? 'Sửa station' : 'Tạo station'}
        open={stationModal.open}
        onOk={handleSaveStation}
        onCancel={() => setStationModal({ open: false, editing: null })}
        confirmLoading={saving}
        okText="Lưu"
        cancelText="Hủy"
        destroyOnClose
      >
        <Form form={stationForm} layout="vertical">
          <Form.Item name="name" label="Tên station" rules={[{ required: true, message: 'Nhập tên station' }]}>
            <Input placeholder="VD: Bếp chính, Bar..." />
          </Form.Item>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Form.Item name="sortOrder" label="Thứ tự">
              <InputNumber min={0} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="isActive" label="Trạng thái" valuePropName="checked">
              <Select
                options={[
                  { value: true, label: 'Hoạt động' },
                  { value: false, label: 'Ngừng' },
                ]}
              />
            </Form.Item>
          </div>
        </Form>
      </Modal>

      {/* Station list drawer */}
      {stations.length > 0 && (
        <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {stations.map((s) => (
            <Tag
              key={s.id}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              closable={false}
            >
              {s.name}
              <Button
                type="text" size="small" icon={<EditOutlined />}
                onClick={() => openEditStation(s)}
                style={{ padding: 0, height: 16, fontSize: 11 }}
              />
              <Popconfirm
                title="Xóa station?"
                okText="Xóa"
                cancelText="Hủy"
                okButtonProps={{ danger: true }}
                onConfirm={() => handleDeleteStation(s)}
              >
                <Button
                  type="text" size="small" danger icon={<DeleteOutlined />}
                  style={{ padding: 0, height: 16, fontSize: 11 }}
                />
              </Popconfirm>
            </Tag>
          ))}
        </div>
      )}
    </div>
  );
}
