/**
 * Frontend: src/pages/QrOrderingSetup.jsx — QR đặt món (menu QR cho từng bàn)
 *
 * Tổng quan:
 * - Danh sách bàn theo khu vực, mỗi bàn có qrToken riêng (sinh khi tạo bàn)
 * - Xem trước menu public: GET /api/qr/menu/:qrToken
 * - Tạo QR code: QRCodeSVG + download PNG + copy link
 * - In QR theo khu vực (đã chọn) hoặc toàn sàn
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Table, Button, Tag, Space, Modal, Select, Card, Descriptions, Empty, Spin, message, Alert, Typography, Tooltip } from 'antd';
import { QrcodeOutlined, DownloadOutlined, LinkOutlined, EyeOutlined, ShopOutlined } from '@ant-design/icons';
import { QRCodeSVG } from 'qrcode.react';
import api from '../api/axios';

const { Text, Paragraph } = Typography;

const fmtMoney = (v) => (v == null ? '—' : Number(v).toLocaleString('vi-VN'));

export default function QrOrderingSetup() {
  const [areas, setAreas] = useState([]);
  const [tables, setTables] = useState([]);
  const [selectedArea, setSelectedArea] = useState('all');
  const [loading, setLoading] = useState(true);
  const [qrModal, setQrModal] = useState({ open: false, table: null });
  const [menuModal, setMenuModal] = useState({ open: false, table: null, menu: null, loadingMenu: false });
  const qrRef = useRef(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [areaRes, tableRes] = await Promise.all([
        api.get('/tables/areas'),
        api.get('/tables'),
      ]);
      setAreas(areaRes.data?.data || []);
      setTables(tableRes.data?.data || []);
    } catch (e) {
      message.error(e.response?.data?.message || 'Không tải được dữ liệu bàn');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const filtered = useMemo(
    () => (selectedArea === 'all' ? tables : tables.filter((tb) => tb.areaId === selectedArea)),
    [tables, selectedArea]
  );

  const menuUrl = (table) =>
    table?.qrToken ? `${window.location.origin}/qr/${table.qrToken}` : null;

  const openQr = (table) => {
    if (!table.qrToken) {
      message.warning('Bàn này chưa có mã QR (qrToken)');
      return;
    }
    setQrModal({ open: true, table });
  };

  const downloadPng = () => {
    const svg = qrRef.current?.querySelector('svg');
    if (!svg) return;
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 640;
    const img = new Image();
    const xml = new XMLSerializer().serializeToString(svg);
    img.onload = () => {
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 20, 20, 600, 600);
      const a = document.createElement('a');
      a.download = `qr-${qrModal.table?.code || 'table'}.png`;
      a.href = canvas.toDataURL('image/png');
      a.click();
    };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
  };

  const copyLink = async () => {
    const url = menuUrl(qrModal.table);
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      message.success('Đã copy link menu');
    } catch {
      message.error('Không copy được');
    }
  };

  const openMenuPreview = async (table) => {
    if (!table.qrToken) {
      message.warning('Bàn này chưa có mã QR (qrToken)');
      return;
    }
    setMenuModal({ open: true, table, menu: null, loadingMenu: true });
    try {
      const res = await api.get(`/qr/menu/${table.qrToken}`);
      setMenuModal((m) => ({ ...m, menu: res.data?.data || {} }));
    } catch (e) {
      message.error(e.response?.data?.message || 'Không tải được menu');
      setMenuModal({ open: false, table: null, menu: null, loadingMenu: false });
    } finally {
      setMenuModal((m) => ({ ...m, loadingMenu: false }));
    }
  };

  const downloadAreaQrs = () => {
    const list = filtered.filter((tb) => tb.qrToken);
    if (list.length === 0) {
      message.warning('Không có bàn nào có qrToken');
      return;
    }
    list.forEach((tb, i) => {
      setTimeout(() => {
        const a = document.createElement('a');
        a.download = `qr-${tb.code || tb.id.slice(0, 6)}.png`;
        a.href = `https://api.qrserver.com/v1/create-qr-code/?size=640x640&data=${encodeURIComponent(menuUrl(tb))}`;
        a.click();
      }, i * 400);
    });
    message.success(`Đang tải ${list.length} mã QR`);
  };

  const columns = [
    {
      title: 'Bàn',
      dataIndex: 'code',
      width: 100,
      render: (code, row) => (
        <Space direction="vertical" size={0}>
          <Text strong>{code}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>{row.area?.name || ''}</Text>
        </Space>
      ),
    },
    {
      title: 'Sức chứa',
      dataIndex: 'capacity',
      width: 90,
      render: (v) => `${v} người`,
    },
    {
      title: 'Trạng thái',
      dataIndex: 'status',
      width: 130,
      render: (s) => {
        const map = {
          AVAILABLE: { color: 'green', label: 'Trống' },
          OCCUPIED: { color: 'red', label: 'Có khách' },
          DIRTY: { color: 'orange', label: 'Đang dọn' },
        };
        const cfg = map[s] || { color: 'default', label: s };
        return <Tag color={cfg.color}>{cfg.label}</Tag>;
      },
    },
    {
      title: 'QR',
      dataIndex: 'qrToken',
      width: 220,
      render: (token, row) =>
        token ? (
          <Space size={4}>
            <Tooltip title="Xem QR code">
              <Button size="small" icon={<QrcodeOutlined />} onClick={() => openQr(row)} />
            </Tooltip>
            <Tooltip title="Xem trước menu">
              <Button size="small" icon={<EyeOutlined />} onClick={() => openMenuPreview(row)} />
            </Tooltip>
            <Tooltip title="Copy link menu">
              <Button size="small" icon={<LinkOutlined />} onClick={async () => {
                try {
                  await navigator.clipboard.writeText(menuUrl(row));
                  message.success('Đã copy link');
                } catch { /* clipboard denied */ }
              }} />
            </Tooltip>
          </Space>
        ) : (
          <Tag>Chưa có</Tag>
        ),
    },
  ];

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: '0 auto' }}>
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Space style={{ justifyContent: 'space-between', width: '100%', flexWrap: 'wrap' }}>
          <Space size={12}>
            <ShopOutlined style={{ fontSize: 24, color: 'var(--color-primary, #0d9488)' }} />
            <div>
              <Typography.Title level={4} style={{ margin: 0 }}>QR Đặt món</Typography.Title>
              <Text type="secondary">Khách quét mã QR trên bàn để tự xem menu và gọi món</Text>
            </div>
          </Space>
          <Space>
            <Select
              value={selectedArea}
              onChange={setSelectedArea}
              style={{ width: 200 }}
              options={[
                { label: 'Tất cả khu vực', value: 'all' },
                ...areas.map((a) => ({ label: a.name, value: a.id })),
              ]}
            />
            <Button icon={<DownloadOutlined />} onClick={downloadAreaQrs} disabled={filtered.length === 0}>
              Tải QR đang lọc
            </Button>
          </Space>
        </Space>

        <Alert
          type="info"
          showIcon
          message="Cách hoạt động"
          description="Mỗi bàn đều có mã QR riêng khi tạo bàn (trong sơ đồ bàn). In mã QR và dán lên bàn — khách quét bằng camera điện thoại sẽ mở menu của quán và đặt món trực tiếp, bếp nhận món qua KDS."
        />

        {loading ? (
          <Spin style={{ display: 'flex', justifyContent: 'center', marginTop: 60 }} />
        ) : filtered.length === 0 ? (
          <Empty description="Chưa có bàn nào — hãy tạo bàn trong Sơ đồ bàn trước" />
        ) : (
          <Card size="small" style={{ width: '100%' }}>
            <Table
              rowKey="id"
              size="small"
              columns={columns}
              dataSource={filtered}
              pagination={{ pageSize: 12, showSizeChanger: false }}
            />
          </Card>
        )}

        {filtered.some((tb) => !tb.qrToken) && (
          <Alert
            type="warning"
            showIcon
            message="Một số bàn chưa có mã QR"
            description="Bàn được tạo trước khi hệ thống QR ra mắt có thể thiếu qrToken — hãy tạo lại bàn đó trong Sơ đồ bàn."
          />
        )}
      </Space>

      {/* QR modal */}
      <Modal
        title={qrModal.table ? `QR — bàn ${qrModal.table.code}` : 'QR'}
        open={qrModal.open}
        footer={[
          <Button key="copy" icon={<LinkOutlined />} onClick={copyLink}>Copy link</Button>,
          <Button key="download" type="primary" icon={<DownloadOutlined />} onClick={downloadPng}>Tải PNG</Button>,
        ]}
        onCancel={() => setQrModal({ open: false, table: null })}
        destroyOnClose
      >
        {qrModal.table?.qrToken && (
          <div style={{ textAlign: 'center' }}>
            <div ref={qrRef} style={{ display: 'inline-block', padding: 16, background: '#fff', borderRadius: 8 }}>
              <QRCodeSVG value={menuUrl(qrModal.table)} size={220} includeMargin />
            </div>
            <Paragraph style={{ marginTop: 12 }} copyable={{ text: menuUrl(qrModal.table) }}>
              <Text type="secondary" style={{ fontSize: 12 }}>{menuUrl(qrModal.table)}</Text>
            </Paragraph>
            <Text type="secondary" style={{ fontSize: 12 }}>
              In mã này (khoảng 8×8 cm) và dán ở góc bàn dễ thấy
            </Text>
          </div>
        )}
      </Modal>

      {/* Menu preview modal */}
      <Modal
        title={menuModal.table ? `Menu bàn ${menuModal.table.code} (bản xem trước)` : 'Menu'}
        open={menuModal.open}
        footer={null}
        onCancel={() => setMenuModal({ open: false, table: null, menu: null })}
        width={560}
        destroyOnClose
      >
        {menuModal.loadingMenu ? (
          <Spin style={{ display: 'flex', justifyContent: 'center', margin: 40 }} />
        ) : Object.keys(menuModal.menu?.menu || {}).length ? (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            {Object.entries(menuModal.menu.menu).map(([catName, products]) => (
              <div key={catName}>
                <Text strong style={{ display: 'block', marginBottom: 8 }}>{catName}</Text>
                <Space direction="vertical" size={6} style={{ width: '100%' }}>
                  {products.map((p) => (
                    <Card key={p.id} size="small" bodyStyle={{ padding: '8px 12px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                        <Space direction="vertical" size={0}>
                          <Text>{p.name}</Text>
                          {p.description && (
                            <Text type="secondary" style={{ fontSize: 12 }}>{p.description}</Text>
                          )}
                        </Space>
                        <Text strong style={{ whiteSpace: 'nowrap' }}>{fmtMoney(p.price)}đ</Text>
                      </div>
                    </Card>
                  ))}
                </Space>
              </div>
            ))}
          </Space>
        ) : (
          <Empty description="Menu rỗng — chưa có món ăn nào để khách đặt" />
        )}
      </Modal>
    </div>
  );
}
