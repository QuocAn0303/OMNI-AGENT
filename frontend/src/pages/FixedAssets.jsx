/**
 * Frontend: pages/FixedAssets.jsx — Tài sản cố định (TSCĐ)
 * 
 * Tổng quan:
 * - Quản lý TSCĐ: danh sách (getAssets), thêm mới (createAsset), thanh lý (disposeAsset), xem chi tiết + lịch khấu hao (getAsset)
 * - Quản lý loại tài sản (getCategories, createCategory)
 * - Chạy khấu hao theo tháng (runDepreciation), cập nhật giá trị còn lại
 * - Hiển thị summary: tổng tài sản, đang hoạt động, nguyên giá, giá trị còn lại
 * - Modal: tạo tài sản (form nhập nguyên giá, thời hạn KH, ngày mua), thanh lý, thêm loại
 * - State: assets/categories/loading/statusFilter — các modal state riêng
 * - Bọc trong PlanGate
 * 
 * Components/Hooks/Exports:
 * - FixedAssets (default): Page chính — stats + table + các modal CRUD
 */
import { useState, useEffect } from "react";
import {
  Table, Button, Space, Tag, Select, Modal, Form, Input, InputNumber,
  DatePicker, message, Tabs, Statistic, Row, Col, Card, Popconfirm, Descriptions,
} from "antd";
import { PlusOutlined, DeleteOutlined, PlayCircleOutlined, EyeOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import PageHeader from "../components/layout/PageHeader";
import PlanGate from "../components/PlanGate";
import {
  getAssets, getAsset, createAsset, disposeAsset,
  getCategories, createCategory, runDepreciation,
} from "../api/fixedAssets";

const fmtVND = (v) => Number(v || 0).toLocaleString("vi-VN") + "đ";
const STATUS_COLOR = { ACTIVE: "success", DISPOSED: "default", DEPRECIATING: "processing" };

export default function FixedAssets() {
  const [assets, setAssets]         = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading]       = useState(false);
  const [statusFilter, setStatusFilter] = useState(undefined);

  // Detail / schedule modal
  const [detailAsset, setDetailAsset] = useState(null);
  const [detailOpen, setDetailOpen]   = useState(false);

  // Create asset modal
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm] = Form.useForm();
  const [creating, setCreating] = useState(false);

  // Dispose modal
  const [disposeOpen, setDisposeOpen]   = useState(false);
  const [disposeTarget, setDisposeTarget] = useState(null);
  const [disposeForm] = Form.useForm();
  const [disposing, setDisposing] = useState(false);

  // Category modal
  const [catOpen, setCatOpen]   = useState(false);
  const [catForm] = Form.useForm();
  const [catSaving, setCatSaving] = useState(false);

  // Depreciation run
  const [deprRunning, setDeprRunning] = useState(false);

  useEffect(() => {
    loadAll();
  }, [statusFilter]);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [a, c] = await Promise.all([
        getAssets(statusFilter ? { status: statusFilter } : {}),
        getCategories(),
      ]);
      setAssets(Array.isArray(a) ? a : a.assets || []);
      setCategories(Array.isArray(c) ? c : c.categories || []);
    } catch { message.error("Không tải được dữ liệu"); }
    finally { setLoading(false); }
  };

  const openDetail = async (id) => {
    try {
      const a = await getAsset(id);
      setDetailAsset(a);
      setDetailOpen(true);
    } catch { message.error("Không tải được chi tiết"); }
  };

  const handleCreate = async () => {
    const vals = await createForm.validateFields();
    setCreating(true);
    try {
      await createAsset({
        ...vals,
        purchaseDate: vals.purchaseDate.toISOString(),
        startDate: vals.startDate.toISOString(),
      });
      message.success("Đã thêm tài sản");
      setCreateOpen(false);
      createForm.resetFields();
      await loadAll();
    } catch (e) { message.error(e?.response?.data?.message || "Lỗi tạo tài sản"); }
    finally { setCreating(false); }
  };

  const handleDispose = async () => {
    if (!disposeTarget) return;
    const vals = await disposeForm.validateFields();
    setDisposing(true);
    try {
      await disposeAsset(disposeTarget.id, {
        ...vals,
        disposeDate: vals.disposeDate.toISOString(),
      });
      message.success("Đã thanh lý tài sản");
      setDisposeOpen(false);
      disposeForm.resetFields();
      await loadAll();
    } catch (e) { message.error(e?.response?.data?.message || "Lỗi thanh lý"); }
    finally { setDisposing(false); }
  };

  const handleCreateCategory = async () => {
    const vals = await catForm.validateFields();
    setCatSaving(true);
    try {
      await createCategory(vals);
      message.success("Đã thêm loại tài sản");
      setCatOpen(false);
      catForm.resetFields();
      setCategories(await getCategories().then((r) => Array.isArray(r) ? r : r.categories || []));
    } catch (e) { message.error(e?.response?.data?.message || "Lỗi"); }
    finally { setCatSaving(false); }
  };

  const handleRunDepreciation = async () => {
    const now = new Date();
    setDeprRunning(true);
    try {
      const r = await runDepreciation({ year: now.getFullYear(), month: now.getMonth() + 1 });
      message.success(`Khấu hao ${r.period}: ${r.processed} tài sản`);
      await loadAll();
    } catch (e) { message.error(e?.response?.data?.message || "Lỗi chạy khấu hao"); }
    finally { setDeprRunning(false); }
  };

  const totalCost      = assets.reduce((s, a) => s + Number(a.purchaseCost || 0), 0);
  const totalBookValue = assets.reduce((s, a) => s + Number(a.currentValue || 0), 0);
  const activeCount    = assets.filter((a) => a.status === "ACTIVE" || a.status === "DEPRECIATING").length;

  const assetCols = [
    { title: "Mã TS", dataIndex: "code", width: 110 },
    { title: "Tên tài sản", dataIndex: "name", ellipsis: true },
    { title: "Loại", key: "cat", render: (_, r) => r.category?.name || "—" },
    { title: "Nguyên giá", dataIndex: "purchaseCost", align: "right", render: fmtVND },
    { title: "Giá trị còn lại", dataIndex: "currentValue", align: "right", render: fmtVND },
    {
      title: "Trạng thái", dataIndex: "status", width: 120,
      render: (v) => <Tag color={STATUS_COLOR[v] || "default"}>{v}</Tag>,
    },
    { title: "Hết khấu hao", dataIndex: "endDate", width: 120, render: (v) => v ? dayjs(v).format("MM/YYYY") : "—" },
    {
      title: "", key: "act", width: 100,
      render: (_, r) => (
        <Space size={4}>
          <Button size="small" icon={<EyeOutlined />} onClick={() => openDetail(r.id)} />
          {r.status !== "DISPOSED" && (
            <Button
              size="small" danger icon={<DeleteOutlined />}
              onClick={() => { setDisposeTarget(r); setDisposeOpen(true); }}
            />
          )}
        </Space>
      ),
    },
  ];

  const scheduleCols = [
    { title: "Kỳ", dataIndex: "period", width: 80 },
    { title: "Khấu hao kỳ này", dataIndex: "amount", align: "right", render: fmtVND },
    { title: "Lũy kế", dataIndex: "accumulated", align: "right", render: fmtVND },
    { title: "Giá trị còn lại", dataIndex: "remaining", align: "right", render: fmtVND },
    {
      title: "Bút toán", dataIndex: "journalPosted", width: 90,
      render: (v) => v ? <Tag color="success">Đã ghi</Tag> : <Tag>Chưa</Tag>,
    },
  ];

  const catOpts = categories.map((c) => ({ value: c.id, label: c.name }));

  return (
    <PlanGate moduleKey="fixed-assets" moduleName="Tài sản cố định">
    <div>
      <PageHeader title="Tài sản cố định" subtitle="Quản lý TSCD và khấu hao theo đường thẳng" />

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}><Card size="small"><Statistic title="Tổng tài sản" value={assets.length} /></Card></Col>
        <Col span={6}><Card size="small"><Statistic title="Đang hoạt động" value={activeCount} valueStyle={{ color: "#059669" }} /></Card></Col>
        <Col span={6}><Card size="small"><Statistic title="Nguyên giá" value={fmtVND(totalCost)} /></Card></Col>
        <Col span={6}><Card size="small"><Statistic title="Giá trị còn lại" value={fmtVND(totalBookValue)} /></Card></Col>
      </Row>

      <Space style={{ marginBottom: 16 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>Thêm tài sản</Button>
        <Button icon={<PlusOutlined />} onClick={() => setCatOpen(true)}>Loại TS</Button>
        <Popconfirm
          title={`Chạy khấu hao tháng ${new Date().getMonth() + 1}/${new Date().getFullYear()}?`}
          onConfirm={handleRunDepreciation}
        >
          <Button icon={<PlayCircleOutlined />} loading={deprRunning}>Chạy khấu hao</Button>
        </Popconfirm>
        <Select allowClear placeholder="Trạng thái" value={statusFilter} onChange={setStatusFilter} style={{ width: 140 }}
          options={[
            { value: "ACTIVE", label: "Chưa khấu hao" },
            { value: "DEPRECIATING", label: "Đang khấu hao" },
            { value: "DISPOSED", label: "Đã thanh lý" },
          ]}
        />
      </Space>

      <Table
        rowKey="id" columns={assetCols} dataSource={assets} loading={loading}
        size="small" scroll={{ x: 900 }}
        pagination={{ pageSize: 20, showSizeChanger: false }}
      />

      {/* Detail / Schedule modal */}
      <Modal
        title={detailAsset ? `Chi tiết: ${detailAsset.name}` : ""}
        open={detailOpen} onCancel={() => setDetailOpen(false)} footer={null} width={800}
      >
        {detailAsset && (
          <Tabs items={[
            {
              key: "info", label: "Thông tin",
              children: (
                <Descriptions column={2} size="small" bordered>
                  <Descriptions.Item label="Mã TS">{detailAsset.code}</Descriptions.Item>
                  <Descriptions.Item label="Loại">{detailAsset.category?.name}</Descriptions.Item>
                  <Descriptions.Item label="Nguyên giá">{fmtVND(detailAsset.purchaseCost)}</Descriptions.Item>
                  <Descriptions.Item label="Giá trị còn lại">{fmtVND(detailAsset.currentValue)}</Descriptions.Item>
                  <Descriptions.Item label="Ngày mua">{dayjs(detailAsset.purchaseDate).format("DD/MM/YYYY")}</Descriptions.Item>
                  <Descriptions.Item label="Bắt đầu KH">{dayjs(detailAsset.startDate).format("DD/MM/YYYY")}</Descriptions.Item>
                  <Descriptions.Item label="Thời hạn KH">{detailAsset.usefulLife} tháng</Descriptions.Item>
                  <Descriptions.Item label="Trạng thái"><Tag color={STATUS_COLOR[detailAsset.status]}>{detailAsset.status}</Tag></Descriptions.Item>
                </Descriptions>
              ),
            },
            {
              key: "schedule", label: "Lịch khấu hao",
              children: (
                <Table
                  rowKey="period" columns={scheduleCols}
                  dataSource={detailAsset.schedule || []}
                  size="small" pagination={false} scroll={{ y: 360 }}
                />
              ),
            },
          ]} />
        )}
      </Modal>

      {/* Create asset modal */}
      <Modal title="Thêm tài sản cố định" open={createOpen}
        onCancel={() => setCreateOpen(false)} onOk={handleCreate}
        confirmLoading={creating} okText="Thêm" width={560}
      >
        <Form form={createForm} layout="vertical" requiredMark={false}>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="code" label="Mã tài sản" rules={[{ required: true, message: "Nhập mã" }]}>
                <Input placeholder="TSCD-001" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="categoryId" label="Loại tài sản" rules={[{ required: true }]}>
                <Select options={catOpts} placeholder="Chọn loại" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="name" label="Tên tài sản" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="purchaseCost" label="Nguyên giá (VNĐ)" rules={[{ required: true }]}>
                <InputNumber style={{ width: "100%" }} min={0} step={1000000} formatter={(v) => Number(v).toLocaleString()} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="usefulLife" label="Thời hạn KH (tháng)" rules={[{ required: true }]}>
                <InputNumber style={{ width: "100%" }} min={1} max={600} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="purchaseDate" label="Ngày mua" rules={[{ required: true }]}>
                <DatePicker style={{ width: "100%" }} format="DD/MM/YYYY" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="startDate" label="Bắt đầu khấu hao" rules={[{ required: true }]}>
                <DatePicker style={{ width: "100%" }} format="DD/MM/YYYY" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="description" label="Ghi chú">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>

      {/* Dispose modal */}
      <Modal title={`Thanh lý: ${disposeTarget?.name}`} open={disposeOpen}
        onCancel={() => setDisposeOpen(false)} onOk={handleDispose}
        confirmLoading={disposing} okText="Thanh lý" okButtonProps={{ danger: true }}
      >
        <Form form={disposeForm} layout="vertical" requiredMark={false}>
          <Form.Item name="disposeDate" label="Ngày thanh lý" rules={[{ required: true }]}
            initialValue={dayjs()}
          >
            <DatePicker style={{ width: "100%" }} format="DD/MM/YYYY" />
          </Form.Item>
          <Form.Item name="salePrice" label="Giá bán thu về (VNĐ)">
            <InputNumber style={{ width: "100%" }} min={0} step={1000000} formatter={(v) => Number(v || 0).toLocaleString()} />
          </Form.Item>
          <Form.Item name="reason" label="Lý do">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>

      {/* Category modal */}
      <Modal title="Thêm loại tài sản" open={catOpen}
        onCancel={() => setCatOpen(false)} onOk={handleCreateCategory}
        confirmLoading={catSaving} okText="Thêm"
      >
        <Form form={catForm} layout="vertical" requiredMark={false}>
          <Form.Item name="name" label="Tên loại" rules={[{ required: true }]}>
            <Input placeholder="Máy móc thiết bị" />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="defaultUsefulLife" label="Thời hạn mặc định (tháng)">
                <InputNumber style={{ width: "100%" }} min={1} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="depreciationAccount" label="TK Khấu hao">
                <Input placeholder="214" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="expenseAccount" label="TK Chi phí KH">
                <Input placeholder="6274" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="assetAccount" label="TK Nguyên giá">
                <Input placeholder="211" />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>
    </div>
    </PlanGate>
  );
}
