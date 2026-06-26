/**
 * Frontend: pages/LotTracking.jsx — Theo dõi lô / hạn dùng
 * 
 * Tổng quan:
 * - Trang quản lý lô hàng với cảnh báo hạn sử dụng, FEFO, truy xuất nguồn gốc
 * - API: getLots, getExpiringLots, getLot, receiveLot
 * - State: lots, expiring (sắp hết hạn 30 ngày), detail modal, receive modal
 * - Logic: 2 tabs (tất cả lô / sắp hết hạn), nhập lô mới, xem lịch sử giao dịch theo lô
 * 
 * Components/Hooks/Exports:
 * - LotTracking (default export): Bảng lô + alert cảnh báo + modal nhập/xem chi tiết
 */
// frontend/src/pages/LotTracking.jsx
import { useState, useEffect } from "react";
import {
  Table, Button, Space, Tag, Modal, Form, Input, InputNumber,
  DatePicker, message, Card, Statistic, Row, Col, Alert, Tabs,
} from "antd";
import { PlusOutlined, WarningOutlined, EyeOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import PageHeader from "../components/layout/PageHeader";
import PlanGate from "../components/PlanGate";
import { getLots, getExpiringLots, getLot, receiveLot } from "../api/lots";

const fmtDate = (v) => v ? dayjs(v).format("DD/MM/YYYY") : "—";

export default function LotTracking() {
  const [lots, setLots]         = useState([]);
  const [expiring, setExpiring] = useState([]);
  const [loading, setLoading]   = useState(false);
  const [activeTab, setActiveTab] = useState("all");

  // Detail modal
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLot, setDetailLot]   = useState(null);

  // Receive modal
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [receiveForm] = Form.useForm();
  const [receiving, setReceiving] = useState(false);

  useEffect(() => { loadAll(); }, []);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [l, e] = await Promise.all([getLots({ hasStock: true }), getExpiringLots(30)]);
      setLots(Array.isArray(l) ? l : []);
      setExpiring(Array.isArray(e) ? e : []);
    } catch { message.error("Không tải được dữ liệu lô hàng"); }
    finally { setLoading(false); }
  };

  const openDetail = async (id) => {
    try {
      const lot = await getLot(id);
      setDetailLot(lot);
      setDetailOpen(true);
    } catch { message.error("Không tải được chi tiết lô"); }
  };

  const handleReceive = async () => {
    const vals = await receiveForm.validateFields();
    setReceiving(true);
    try {
      await receiveLot({
        ...vals,
        mfgDate: vals.mfgDate?.toISOString(),
        expDate: vals.expDate?.toISOString(),
      });
      message.success("Đã nhập lô hàng");
      setReceiveOpen(false);
      receiveForm.resetFields();
      await loadAll();
    } catch (e) { message.error(e?.response?.data?.message || "Lỗi nhập lô"); }
    finally { setReceiving(false); }
  };

  const daysUntilExpiry = (expDate) => {
    if (!expDate) return null;
    return dayjs(expDate).diff(dayjs(), "day");
  };

  const expiryTag = (expDate) => {
    const d = daysUntilExpiry(expDate);
    if (d === null) return <Tag>N/A</Tag>;
    if (d < 0) return <Tag color="error">Hết hạn {Math.abs(d)}N</Tag>;
    if (d <= 7) return <Tag color="error">{d} ngày</Tag>;
    if (d <= 30) return <Tag color="warning">{d} ngày</Tag>;
    return <Tag color="success">{d} ngày</Tag>;
  };

  const cols = [
    { title: "Mã lô", dataIndex: "lotCode", width: 130 },
    { title: "Sản phẩm", key: "product", render: (_, r) => r.product?.name || "—", ellipsis: true },
    { title: "SKU", key: "sku", render: (_, r) => r.product?.sku || "—", width: 100 },
    { title: "Kho", key: "wh", render: (_, r) => r.warehouse?.name || "—", width: 120 },
    { title: "Tồn kho", dataIndex: "quantity", align: "right", width: 90 },
    { title: "NSX", dataIndex: "mfgDate", width: 100, render: fmtDate },
    { title: "HSD", dataIndex: "expDate", width: 100, render: fmtDate },
    { title: "Còn lại", key: "exp", width: 100, render: (_, r) => expiryTag(r.expDate) },
    {
      title: "", key: "act", width: 60,
      render: (_, r) => <Button size="small" icon={<EyeOutlined />} onClick={() => openDetail(r.id)} />,
    },
  ];

  const txCols = [
    { title: "Ngày", dataIndex: "createdAt", render: (v) => dayjs(v).format("DD/MM/YYYY HH:mm"), width: 140 },
    { title: "Loại", dataIndex: "type", width: 60, render: (v) => <Tag color={v === "IN" ? "success" : "warning"}>{v}</Tag> },
    { title: "Số lượng", dataIndex: "quantity", align: "right", width: 90 },
  ];

  return (
    <PlanGate moduleKey="production" moduleName="Lô / Hạn dùng">
    <div>
      <PageHeader title="Theo dõi Lô / Hạn dùng" subtitle="FEFO · Truy xuất nguồn gốc lô hàng" />

      {expiring.length > 0 && (
        <Alert
          type="warning" showIcon
          icon={<WarningOutlined />}
          message={`${expiring.length} lô hàng sắp hết hạn trong 30 ngày`}
          style={{ marginBottom: 16 }}
        />
      )}

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}><Card size="small"><Statistic title="Tổng lô" value={lots.length} /></Card></Col>
        <Col span={6}><Card size="small"><Statistic title="Sắp hết hạn (30N)" value={expiring.length} valueStyle={{ color: "#d97706" }} /></Card></Col>
      </Row>

      <Space style={{ marginBottom: 16 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setReceiveOpen(true)}>Nhập lô hàng</Button>
      </Space>

      <Tabs activeKey={activeTab} onChange={setActiveTab} items={[
        {
          key: "all", label: "Tất cả lô",
          children: (
            <Table rowKey="id" columns={cols} dataSource={lots} loading={loading}
              size="small" scroll={{ x: 900 }} pagination={{ pageSize: 20 }} />
          ),
        },
        {
          key: "expiring", label: <span><WarningOutlined style={{ color: "#d97706" }} /> Sắp hết hạn ({expiring.length})</span>,
          children: (
            <Table rowKey="id" columns={cols} dataSource={expiring} loading={loading}
              size="small" scroll={{ x: 900 }} pagination={{ pageSize: 20 }} />
          ),
        },
      ]} />

      {/* Detail modal */}
      <Modal title={detailLot ? `Lô: ${detailLot.lotCode}` : ""} open={detailOpen}
        onCancel={() => setDetailOpen(false)} footer={null} width={700}>
        {detailLot && (
          <>
            <Row gutter={16} style={{ marginBottom: 16 }}>
              <Col span={8}><Statistic title="Tồn kho" value={detailLot.quantity} /></Col>
              <Col span={8}><Statistic title="Nhập ban đầu" value={detailLot.originalQty} /></Col>
              <Col span={8}><Statistic title="Hết hạn" value={detailLot.expDate ? dayjs(detailLot.expDate).format("DD/MM/YYYY") : "N/A"} /></Col>
            </Row>
            <Table rowKey="id" columns={txCols} dataSource={detailLot.transactions || []}
              size="small" pagination={false} scroll={{ y: 300 }} />
          </>
        )}
      </Modal>

      {/* Receive modal */}
      <Modal title="Nhập lô hàng" open={receiveOpen} onCancel={() => setReceiveOpen(false)}
        onOk={handleReceive} confirmLoading={receiving} okText="Nhập lô">
        <Form form={receiveForm} layout="vertical" requiredMark={false}>
          <Form.Item name="lotCode" label="Mã lô" rules={[{ required: true }]}>
            <Input placeholder="LOT-2024-001" />
          </Form.Item>
          <Form.Item name="productId" label="ID sản phẩm" rules={[{ required: true }]}>
            <Input placeholder="UUID sản phẩm" />
          </Form.Item>
          <Form.Item name="warehouseId" label="ID kho" rules={[{ required: true }]}>
            <Input placeholder="UUID kho" />
          </Form.Item>
          <Form.Item name="quantity" label="Số lượng" rules={[{ required: true }]}>
            <InputNumber style={{ width: "100%" }} min={1} />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="mfgDate" label="Ngày sản xuất">
                <DatePicker style={{ width: "100%" }} format="DD/MM/YYYY" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="expDate" label="Hạn sử dụng">
                <DatePicker style={{ width: "100%" }} format="DD/MM/YYYY" />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>
    </div>
    </PlanGate>
  );
}
