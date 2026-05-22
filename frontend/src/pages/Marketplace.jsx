// frontend/src/pages/Marketplace.jsx
import { useState, useEffect } from "react";
import {
  Table, Button, Space, Tag, Modal, Form, Input, Select, Switch,
  message, Card, Row, Col, Statistic, Tabs, Badge,
} from "antd";
import { PlusOutlined, SyncOutlined, UploadOutlined, DownloadOutlined, SettingOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import PageHeader from "../components/layout/PageHeader";
import { getShops, createShop, toggleShop, getListings, getSyncLogs, pushInventory, pullOrders } from "../api/marketplace";

dayjs.extend(relativeTime);

const PLATFORM_COLOR = { SHOPEE: "orange", LAZADA: "blue", TIKTOK: "purple" };
const STATUS_COLOR = { SUCCESS: "success", ERROR: "error", PARTIAL: "warning" };

export default function Marketplace() {
  const [shops, setShops]       = useState([]);
  const [loading, setLoading]   = useState(false);
  const [activeShop, setActiveShop] = useState(null);
  const [listings, setListings] = useState([]);
  const [syncLogs, setSyncLogs] = useState([]);
  const [tabKey, setTabKey]     = useState("listings");

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm] = Form.useForm();
  const [creating, setCreating] = useState(false);

  const [pushing, setPushing]   = useState(false);
  const [pulling, setPulling]   = useState(false);

  useEffect(() => { loadShops(); }, []);

  const loadShops = async () => {
    setLoading(true);
    try { setShops(await getShops()); }
    catch { message.error("Không tải được danh sách shop"); }
    finally { setLoading(false); }
  };

  const selectShop = async (shop) => {
    setActiveShop(shop);
    const [l, s] = await Promise.all([getListings(shop.id), getSyncLogs(shop.id)]);
    setListings(Array.isArray(l) ? l : []);
    setSyncLogs(Array.isArray(s) ? s : []);
  };

  const handleCreate = async () => {
    const vals = await createForm.validateFields();
    setCreating(true);
    try {
      await createShop(vals);
      message.success("Đã thêm shop");
      setCreateOpen(false);
      createForm.resetFields();
      await loadShops();
    } catch (e) { message.error(e?.response?.data?.message || "Lỗi"); }
    finally { setCreating(false); }
  };

  const handleToggle = async (shop, checked) => {
    try {
      await toggleShop(shop.id, checked);
      await loadShops();
    } catch { message.error("Lỗi"); }
  };

  const handlePush = async () => {
    if (!activeShop) return;
    setPushing(true);
    try {
      const r = await pushInventory(activeShop.id);
      message.success(`Đã push tồn kho: ${r.pushed} sản phẩm${r.errors ? `, ${r.errors} lỗi` : ""}`);
      setSyncLogs(await getSyncLogs(activeShop.id));
    } catch (e) { message.error("Lỗi push"); }
    finally { setPushing(false); }
  };

  const handlePull = async () => {
    if (!activeShop) return;
    setPulling(true);
    try {
      const r = await pullOrders(activeShop.id);
      message.success(`Đã pull ${r.pulled} đơn hàng`);
      setSyncLogs(await getSyncLogs(activeShop.id));
    } catch (e) { message.error("Lỗi pull"); }
    finally { setPulling(false); }
  };

  const shopCols = [
    {
      title: "Shop", key: "shop",
      render: (_, r) => (
        <Space>
          <Tag color={PLATFORM_COLOR[r.platform]}>{r.platform}</Tag>
          <span>{r.shopName || r.shopId || "—"}</span>
        </Space>
      ),
    },
    {
      title: "Trạng thái", dataIndex: "isActive", width: 100,
      render: (v, r) => <Switch size="small" checked={v} onChange={(c) => handleToggle(r, c)} />,
    },
    {
      title: "Đồng bộ gần nhất", dataIndex: "lastSyncAt", width: 150,
      render: (v) => v ? dayjs(v).fromNow() : "Chưa sync",
    },
    {
      title: "", key: "sel", width: 80,
      render: (_, r) => (
        <Button size="small" type={activeShop?.id === r.id ? "primary" : "default"} onClick={() => selectShop(r)}>
          Chọn
        </Button>
      ),
    },
  ];

  const listingCols = [
    { title: "Sản phẩm", key: "product", render: (_, r) => r.product ? `${r.product.name} (${r.product.sku})` : "—" },
    { title: "External ID", dataIndex: "externalId", ellipsis: true },
    { title: "Trạng thái", dataIndex: "status", render: (v) => <Tag color={v === "ACTIVE" ? "success" : "default"}>{v}</Tag> },
    { title: "Push lần cuối", dataIndex: "lastPushedAt", render: (v) => v ? dayjs(v).fromNow() : "Chưa" },
    { title: "Lỗi", dataIndex: "syncErrors", ellipsis: true, render: (v) => v ? <span style={{ color: "#dc2626" }}>{v}</span> : "—" },
  ];

  const logCols = [
    { title: "Thời gian", dataIndex: "startedAt", render: (v) => dayjs(v).format("DD/MM HH:mm"), width: 120 },
    { title: "Chiều", dataIndex: "direction", width: 70 },
    { title: "Loại", dataIndex: "entity", width: 80 },
    { title: "Kết quả", dataIndex: "status", width: 90, render: (v) => <Tag color={STATUS_COLOR[v]}>{v}</Tag> },
    { title: "Số lượng", dataIndex: "count", width: 80 },
  ];

  return (
    <div>
      <PageHeader title="Tích hợp sàn TMĐT" subtitle="Shopee · Lazada · TikTok — sync tồn kho và đơn hàng" />

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}><Card size="small"><Statistic title="Tổng shop" value={shops.length} /></Card></Col>
        <Col span={6}><Card size="small"><Statistic title="Đang hoạt động" value={shops.filter((s) => s.isActive).length} valueStyle={{ color: "#059669" }} /></Card></Col>
      </Row>

      <Row gutter={16}>
        <Col xs={24} md={8}>
          <Card
            title="Danh sách shop"
            extra={<Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>Thêm shop</Button>}
            size="small" bodyStyle={{ padding: 0 }}
          >
            <Table rowKey="id" columns={shopCols} dataSource={shops} loading={loading} size="small" pagination={false} />
          </Card>
        </Col>
        <Col xs={24} md={16}>
          {activeShop ? (
            <Card
              title={<Space><Tag color={PLATFORM_COLOR[activeShop.platform]}>{activeShop.platform}</Tag>{activeShop.shopName}</Space>}
              extra={
                <Space>
                  <Button size="small" icon={<UploadOutlined />} loading={pushing} onClick={handlePush}>Push tồn kho</Button>
                  <Button size="small" icon={<DownloadOutlined />} loading={pulling} onClick={handlePull}>Pull đơn hàng</Button>
                </Space>
              }
              size="small"
            >
              <Tabs activeKey={tabKey} onChange={setTabKey} items={[
                {
                  key: "listings", label: `Sản phẩm (${listings.length})`,
                  children: <Table rowKey="id" columns={listingCols} dataSource={listings} size="small" pagination={{ pageSize: 10 }} />,
                },
                {
                  key: "logs", label: "Lịch sử sync",
                  children: <Table rowKey="id" columns={logCols} dataSource={syncLogs} size="small" pagination={{ pageSize: 10 }} />,
                },
              ]} />
            </Card>
          ) : (
            <Card><p style={{ textAlign: "center", color: "#94a3b8" }}>Chọn shop để xem chi tiết</p></Card>
          )}
        </Col>
      </Row>

      <Modal title="Thêm shop mới" open={createOpen} onCancel={() => setCreateOpen(false)}
        onOk={handleCreate} confirmLoading={creating} okText="Thêm">
        <Form form={createForm} layout="vertical" requiredMark={false}>
          <Form.Item name="platform" label="Nền tảng" rules={[{ required: true }]}>
            <Select options={[
              { value: "SHOPEE", label: "Shopee" },
              { value: "LAZADA", label: "Lazada" },
              { value: "TIKTOK", label: "TikTok Shop" },
            ]} />
          </Form.Item>
          <Form.Item name="shopName" label="Tên shop">
            <Input placeholder="Aduu Store" />
          </Form.Item>
          <Form.Item name="shopId" label="Shop ID (từ nền tảng)">
            <Input placeholder="123456789" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
