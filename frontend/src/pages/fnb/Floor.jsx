/**
 * Frontend: src/pages/fnb/Floor.jsx — Sơ đồ bàn F&B (table management)
 *
 * Tổng quan:
 * - Canvas kéo-thả: bàn được định vị tuyệt đối theo posX/posY, kéo thả bằng pointer
 *   events (hỗ trợ touch mobile), lưu vị trí qua PATCH /tables/positions
 * - Hình dạng bàn: SQUARE (vuông) / ROUND (tròn) / RECTANGLE (chữ nhật)
 * - Click bàn (không kéo) → menu hành động theo trạng thái
 * - CRUD khu vực (Area) + bàn (DinerTable)
 * - Trạng thái: AVAILABLE (xanh) / OCCUPIED (đỏ) / RESERVED (vàng) / DIRTY (xám) / DISABLED
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Card, Button, Tag, Modal, InputNumber, Input, Space, message, Empty, Spin, Segmented, Select, Popconfirm, Form, Dropdown, Tooltip } from 'antd';
import { PlusOutlined, ReloadOutlined, EnvironmentOutlined, EditOutlined, DeleteOutlined, ZoomInOutlined, ZoomOutOutlined, FullscreenOutlined, ShoppingOutlined, ClearOutlined, CloseOutlined, UserAddOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import api from '../../api/axios';

const STATUS_CONFIG = {
  AVAILABLE: { color: '#10b981', bg: '#ecfdf5', label: 'Trống' },
  OCCUPIED: { color: '#ef4444', bg: '#fef2f2', label: 'Có khách' },
  RESERVED: { color: '#f59e0b', bg: '#fffbeb', label: 'Đặt trước' },
  DIRTY: { color: '#6b7280', bg: '#f3f4f6', label: 'Cần dọn' },
  DISABLED: { color: '#9ca3af', bg: '#f9fafb', label: 'Tắt' },
};

// Kích thước mặc định theo hình dạng
const DEFAULT_DIM = { SQUARE: { w: 100, h: 100 }, ROUND: { w: 110, h: 110 }, RECTANGLE: { w: 160, h: 90 } };
const DRAG_THRESHOLD = 5;

export default function Floor() {
  const [areas, setAreas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeAreaId, setActiveAreaId] = useState(null);
  // Bản sao cục bộ bàn của khu đang xem — cập nhật mượt khi kéo
  const [tables, setTables] = useState([]);
  const [scale, setScale] = useState(1);
  const [sessionModal, setSessionModal] = useState({ open: false, tableId: null, guests: 2 });
  const [areaModal, setAreaModal] = useState({ open: false, editing: null });
  const [tableModal, setTableModal] = useState({ open: false, editing: null });
  const [menuTable, setMenuTable] = useState(null);
  const [saving, setSaving] = useState(false);
  const [areaForm] = Form.useForm();
  const [tableForm] = Form.useForm();
  const canvasRef = useRef(null);
  const dragRef = useRef({ id: null, startX: 0, startY: 0, origX: 0, origY: 0, moved: false, pointerId: null });
  const justDraggedRef = useRef(false);
  const savingPosRef = useRef(false);
  const navigate = useNavigate();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/tables/areas');
      const data = res.data?.data || [];
      setAreas(data);
      if (data.length > 0) {
        setActiveAreaId((prev) => (prev && data.some((a) => a.id === prev) ? prev : data[0].id));
      } else {
        setActiveAreaId(null);
      }
    } catch {
      message.error('Không tải được sơ đồ bàn');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const activeArea = areas.find((a) => a.id === activeAreaId);

  // Đồng bộ bàn của khu vực đang xem
  useEffect(() => {
    const area = areas.find((a) => a.id === activeAreaId);
    setTables(area?.tables?.filter((t) => t.isActive) || []);
  }, [activeAreaId, areas]);

  // Canvas extent (để fit)
  const extent = useMemo(() => {
    if (tables.length === 0) return { maxX: 800, maxY: 500 };
    return {
      maxX: tables.reduce((m, t) => Math.max(m, t.posX + (t.width || DEFAULT_DIM[t.shape]?.w || 100)), 0),
      maxY: tables.reduce((m, t) => Math.max(m, t.posY + (t.height || DEFAULT_DIM[t.shape]?.h || 100)), 0),
    };
  }, [tables]);

  // ============ DRAG & DROP ============

  const onPointerDown = (e, table) => {
    e.preventDefault();
    dragRef.current = {
      id: table.id,
      startX: e.clientX,
      startY: e.clientY,
      origX: table.posX,
      origY: table.posY,
      moved: false,
      pointerId: e.pointerId,
    };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e) => {
    const d = dragRef.current;
    if (!d.id) return;
    const dx = (e.clientX - d.startX) / scale;
    const dy = (e.clientY - d.startY) / scale;
    if (!d.moved && Math.abs(e.clientX - d.startX) + Math.abs(e.clientY - d.startY) > DRAG_THRESHOLD) {
      d.moved = true;
    }
    if (d.moved) {
      setTables((prev) => prev.map((t) => (t.id === d.id ? { ...t, posX: Math.max(0, Math.round(d.origX + dx)), posY: Math.max(0, Math.round(d.origY + dy)) } : t)));
    }
  };

  const onPointerUp = () => {
    const d = dragRef.current;
    if (!d.id) return;
    if (d.moved) {
      savePositions();
      // Click event sẽ fire sau pointerup — chặn mở menu hành động khi vừa kéo
      justDraggedRef.current = true;
      setTimeout(() => { justDraggedRef.current = false; }, 0);
    }
    dragRef.current = { id: null, startX: 0, startY: 0, origX: 0, origY: 0, moved: false, pointerId: null };
  };

  const savePositions = async () => {
    if (savingPosRef.current) return;
    savingPosRef.current = true;
    try {
      const positions = tables.map((t) => {
        const dim = DEFAULT_DIM[t.shape] || DEFAULT_DIM.SQUARE;
        return { id: t.id, posX: t.posX, posY: t.posY, width: t.width || dim.w, height: t.height || dim.h };
      });
      await api.patch('/tables/positions', { positions });
    } catch {
      message.error('Không lưu được vị trí bàn');
    } finally {
      savingPosRef.current = false;
    }
  };

  // ============ AREA CRUD ============
  const openCreateArea = () => {
    areaForm.resetFields();
    setAreaModal({ open: true, editing: null });
  };

  const openEditArea = (area) => {
    areaForm.setFieldsValue({ name: area.name, sortOrder: area.sortOrder || 0 });
    setAreaModal({ open: true, editing: area });
  };

  const handleSaveArea = async () => {
    try {
      const values = await areaForm.validateFields();
      setSaving(true);
      if (areaModal.editing) {
        await api.patch(`/tables/areas/${areaModal.editing.id}`, values);
      } else {
        await api.post('/tables/areas', values);
      }
      message.success(areaModal.editing ? 'Đã cập nhật khu vực' : 'Đã tạo khu vực');
      setAreaModal({ open: false, editing: null });
      load();
    } catch (e) {
      if (e?.errorFields) return;
      message.error(e.response?.data?.message || 'Lỗi lưu khu vực');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteArea = async (area) => {
    try {
      await api.delete(`/tables/areas/${area.id}`);
      message.success('Đã xóa khu vực');
      load();
    } catch (e) {
      message.error(e.response?.data?.message || 'Không xóa được khu vực (có thể còn bàn)');
    }
  };

  // ============ TABLE CRUD ============

  // Tìm vị trí trống để đặt bàn mới (tránh chồng lên bàn hiện có)
  const autoPos = useCallback(() => {
    for (let y = 20; y < 2000; y += 140) {
      for (let x = 20; x < 2000; x += 140) {
        if (!tables.some((t) => Math.abs(t.posX - x) < 120 && Math.abs(t.posY - y) < 120)) {
          return { posX: x, posY: y };
        }
      }
    }
    return { posX: 20, posY: 20 };
  }, [tables]);

  const openCreateTable = () => {
    tableForm.resetFields();
    tableForm.setFieldsValue({ areaId: activeAreaId, capacity: 4, shape: 'SQUARE' });
    setTableModal({ open: true, editing: null });
  };

  const openEditTable = (table) => {
    tableForm.setFieldsValue({
      code: table.code,
      areaId: table.areaId,
      capacity: table.capacity,
      shape: table.shape || 'SQUARE',
    });
    setTableModal({ open: true, editing: table });
  };

  const handleSaveTable = async () => {
    try {
      const values = await tableForm.validateFields();
      setSaving(true);
      if (tableModal.editing) {
        await api.patch(`/tables/${tableModal.editing.id}`, values);
      } else {
        await api.post('/tables', { ...values, ...autoPos() });
      }
      message.success(tableModal.editing ? 'Đã cập nhật bàn' : 'Đã tạo bàn');
      setTableModal({ open: false, editing: null });
      load();
    } catch (e) {
      if (e?.errorFields) return;
      message.error(e.response?.data?.message || 'Lỗi lưu bàn');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteTable = async (table) => {
    Modal.confirm({
      title: `Xóa bàn ${table.code}?`,
      content: 'Thao tác không thể hoàn tác.',
      okText: 'Xóa',
      cancelText: 'Hủy',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await api.delete(`/tables/${table.id}`);
          message.success('Đã xóa bàn');
          load();
        } catch (e) {
          message.error(e.response?.data?.message || 'Không xóa được bàn');
        }
      },
    });
  };

  // ============ TABLE ACTIONS ============

  const handleOpenTable = async () => {
    try {
      await api.post(`/tables/${sessionModal.tableId}/open`, { guestCount: sessionModal.guests });
      message.success('Đã mở bàn');
      setSessionModal({ open: false, tableId: null, guests: 2 });
      load();
    } catch (err) {
      message.error(err.response?.data?.message || 'Không mở được bàn');
    }
  };

  const handleCloseTable = async (tableId) => {
    try {
      await api.post(`/tables/${tableId}/close`);
      message.success('Đã đóng bàn — cần dọn');
      load();
    } catch (err) {
      message.error(err.response?.data?.message || 'Lỗi');
    }
  };

  const handleClearTable = async (tableId) => {
    try {
      await api.post(`/tables/${tableId}/clear`);
      message.success('Đã dọn xong');
      load();
    } catch {
      message.error('Lỗi');
    }
  };

  const handleNewOrder = (tableId) => {
    navigate(`/pos?table=${tableId}`);
  };

  const buildMenuItems = (table) => {
    const items = [];
    if (table.status === 'AVAILABLE') {
      items.push({ key: 'open', icon: <UserAddOutlined />, label: 'Mở bàn', onClick: () => setSessionModal({ open: true, tableId: table.id, guests: 2 }) });
    }
    if (table.status === 'OCCUPIED') {
      items.push({ key: 'order', icon: <ShoppingOutlined />, label: 'Thêm món', onClick: () => handleNewOrder(table.id) });
      items.push({ key: 'close', icon: <CloseOutlined />, label: 'Thanh toán & đóng bàn', onClick: () => handleCloseTable(table.id) });
    }
    if (table.status === 'DIRTY') {
      items.push({ key: 'clear', icon: <ClearOutlined />, label: 'Dọn bàn', onClick: () => handleClearTable(table.id) });
    }
    items.push({ key: 'edit', icon: <EditOutlined />, label: 'Sửa bàn', onClick: () => openEditTable(table) });
    if (table.status !== 'OCCUPIED') {
      items.push({ key: 'delete', icon: <DeleteOutlined />, label: 'Xóa bàn', danger: true, onClick: () => handleDeleteTable(table) });
    }
    return items;
  };

  const fitCanvas = () => {
    const el = canvasRef.current;
    if (!el || tables.length === 0) return;
    const pad = 40;
    const availW = el.clientWidth - pad * 2;
    const availH = el.clientHeight - pad * 2;
    const s = Math.min(availW / Math.max(extent.maxX, 1), availH / Math.max(extent.maxY, 1), 1.25);
    setScale(Math.max(0.35, Math.min(s, 1.5)));
  };

  if (loading) return <Spin style={{ display: 'flex', justifyContent: 'center', marginTop: 100 }} />;

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ margin: 0 }}>
          <EnvironmentOutlined style={{ marginRight: 8, color: 'var(--primary)' }} />
          Sơ đồ bàn
        </h2>
        <Space wrap>
          <Segmented
            options={areas.map((a) => ({ label: a.name, value: a.id }))}
            value={activeAreaId}
            onChange={setActiveAreaId}
          />
          <Button icon={<PlusOutlined />} onClick={openCreateArea}>Khu vực</Button>
          <Button type="primary" icon={<PlusOutlined />} disabled={!activeAreaId} onClick={openCreateTable}>Thêm bàn</Button>
          <Button icon={<ReloadOutlined />} onClick={load} />
        </Space>
      </div>

      {areas.length === 0 ? (
        <Card>
          <Empty description="Chưa có khu vực nào. Tạo khu vực đầu tiên để bắt đầu sắp xếp bàn.">
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreateArea}>Tạo khu vực</Button>
          </Empty>
        </Card>
      ) : (
        <>
          <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <Space>
              <b>{activeArea?.name}</b>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {tables.length} bàn · kéo thả để sắp xếp
              </span>
            </Space>
            <Space wrap>
              <Space size={4} style={{ fontSize: 12 }}>
                {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
                  <Tooltip key={key} title={cfg.label}>
                    <span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 3, background: cfg.color, cursor: 'default' }} />
                  </Tooltip>
                ))}
              </Space>
              <Space size={4}>
                <Button type="text" size="small" icon={<EditOutlined />} onClick={() => activeArea && openEditArea(activeArea)} />
                <Popconfirm
                  title="Xóa khu vực?"
                  okText="Xóa"
                  cancelText="Hủy"
                  okButtonProps={{ danger: true }}
                  onConfirm={() => activeArea && handleDeleteArea(activeArea)}
                >
                  <Button type="text" size="small" danger icon={<DeleteOutlined />} />
                </Popconfirm>
              </Space>
              <Space size={4}>
                <Button size="small" icon={<ZoomOutOutlined />} onClick={() => setScale((s) => Math.max(0.35, +(s - 0.15).toFixed(2)))} />
                <Button size="small" icon={<ZoomInOutlined />} onClick={() => setScale((s) => Math.min(1.5, +(s + 0.15).toFixed(2)))} />
                <Button size="small" icon={<FullscreenOutlined />} onClick={fitCanvas} />
                <span style={{ fontSize: 12, color: 'var(--text-muted)', minWidth: 38 }}>{Math.round(scale * 100)}%</span>
              </Space>
            </Space>
          </div>

          {activeArea && (
            <div
              ref={canvasRef}
              style={{
                position: 'relative',
                height: 'calc(100vh - 260px)',
                minHeight: 420,
                overflow: 'auto',
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: 12,
                touchAction: 'none',
                userSelect: 'none',
                backgroundImage: 'radial-gradient(circle, #d1d5db 1px, transparent 1px)',
                backgroundSize: '24px 24px',
              }}
            >
              <div
                style={{
                  position: 'relative',
                  width: Math.max(extent.maxX + 60, 600),
                  height: Math.max(extent.maxY + 60, 500),
                  transform: `scale(${scale})`,
                  transformOrigin: 'top left',
                }}
              >
                {tables.map((table) => {
                  const cfg = STATUS_CONFIG[table.status] || STATUS_CONFIG.AVAILABLE;
                  const dim = DEFAULT_DIM[table.shape] || DEFAULT_DIM.SQUARE;
                  const w = table.width || dim.w;
                  const h = table.height || dim.h;
                  const isRound = table.shape === 'ROUND';
                  const isActiveDrag = dragRef.current.id === table.id;
                  const menu = buildMenuItems(table);
                  return (
                    <Dropdown
                      key={table.id}
                      menu={{ items: menu }}
                      trigger={['contextMenu']}
                      open={menuTable?.id === table.id}
                      onOpenChange={(open) => {
                        if (open) setMenuTable({ id: table.id });
                        else setMenuTable((m) => (m?.id === table.id ? null : m));
                      }}
                    >
                      <div
                        onPointerDown={(e) => onPointerDown(e, table)}
                        onPointerMove={onPointerMove}
                        onPointerUp={onPointerUp}
                        onPointerCancel={onPointerUp}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (justDraggedRef.current) return;
                          setMenuTable({ id: table.id });
                        }}
                        onPointerEnter={() => { if (dragRef.current.id) document.body.style.cursor = 'grabbing'; }}
                        onPointerLeave={() => { if (!dragRef.current.id) document.body.style.cursor = 'default'; }}
                        style={{
                          position: 'absolute',
                          left: table.posX,
                          top: table.posY,
                          width: w,
                          height: h,
                          borderRadius: isRound ? '50%' : 12,
                          border: `3px solid ${cfg.color}`,
                          background: cfg.bg,
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: 'grab',
                          boxShadow: isActiveDrag ? '0 8px 20px rgba(0,0,0,.18)' : '0 2px 6px rgba(0,0,0,.08)',
                          transition: isActiveDrag ? 'none' : 'box-shadow .15s',
                          zIndex: isActiveDrag ? 10 : 1,
                          touchAction: 'none',
                        }}
                      >
                        <div style={{ fontWeight: 700, fontSize: 15, color: cfg.color, lineHeight: 1.1 }}>
                          {table.code}
                        </div>
                        <div style={{ fontSize: 10, color: '#6b7280', lineHeight: 1.2 }}>
                          {table.capacity} chỗ
                        </div>
                        {table.status !== 'AVAILABLE' && (
                          <div
                            style={{
                              position: 'absolute',
                              top: isRound ? '12%' : 6,
                              right: isRound ? '12%' : 6,
                              width: 10,
                              height: 10,
                              borderRadius: '50%',
                              background: cfg.color,
                              border: '2px solid #fff',
                            }}
                          />
                        )}
                      </div>
                    </Dropdown>
                  );
                })}

                {tables.length === 0 && (
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Empty description="Chưa có bàn nào — bấm 'Thêm bàn' để bắt đầu" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* Mở bàn */}
      <Modal
        title="Mở bàn"
        open={sessionModal.open}
        onOk={handleOpenTable}
        onCancel={() => setSessionModal({ open: false, tableId: null, guests: 2 })}
        okText="Mở bàn"
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <label>Số khách</label>
          <InputNumber
            min={1}
            max={50}
            value={sessionModal.guests}
            onChange={(v) => setSessionModal({ ...sessionModal, guests: v })}
            style={{ width: '100%' }}
          />
        </Space>
      </Modal>

      {/* CRUD Area */}
      <Modal
        title={areaModal.editing ? 'Sửa khu vực' : 'Tạo khu vực'}
        open={areaModal.open}
        onOk={handleSaveArea}
        onCancel={() => setAreaModal({ open: false, editing: null })}
        confirmLoading={saving}
        okText="Lưu"
        cancelText="Hủy"
        destroyOnClose
      >
        <Form form={areaForm} layout="vertical">
          <Form.Item name="name" label="Tên khu vực" rules={[{ required: true, message: 'Nhập tên khu vực' }]}>
            <Input placeholder="VD: Tầng 1, Sân vườn..." />
          </Form.Item>
          <Form.Item name="sortOrder" label="Thứ tự">
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>

      {/* CRUD Table */}
      <Modal
        title={tableModal.editing ? 'Sửa bàn' : 'Thêm bàn'}
        open={tableModal.open}
        onOk={handleSaveTable}
        onCancel={() => setTableModal({ open: false, editing: null })}
        confirmLoading={saving}
        okText="Lưu"
        cancelText="Hủy"
        destroyOnClose
      >
        <Form form={tableForm} layout="vertical">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Form.Item name="code" label="Tên bàn" rules={[{ required: true, message: 'Nhập tên bàn' }]}>
              <Input placeholder="VD: B1, B2..." />
            </Form.Item>
            <Form.Item name="areaId" label="Khu vực" rules={[{ required: true, message: 'Chọn khu vực' }]}>
              <Select options={areas.map((a) => ({ value: a.id, label: a.name }))} />
            </Form.Item>
            <Form.Item name="capacity" label="Số chỗ">
              <InputNumber min={1} max={50} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="shape" label="Hình dạng">
              <Select
                options={[
                  { value: 'SQUARE', label: 'Vuông' },
                  { value: 'ROUND', label: 'Tròn' },
                  { value: 'RECTANGLE', label: 'Chữ nhật' },
                ]}
              />
            </Form.Item>
          </div>
        </Form>
      </Modal>
    </div>
  );
}
