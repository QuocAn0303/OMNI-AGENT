/**
 * Frontend: pages/Workflows.jsx — Workflow Engine (tự động hóa phê duyệt)
 * 
 * Tổng quan:
 * - Danh sách workflow (getWorkflows), tạo mới (createWorkflow), bật/tắt (updateWorkflow)
 * - Trigger: EXPENSE_ABOVE, PO_ABOVE, LEAVE_REQUEST, CUSTOM với ngưỡng kích hoạt
 * - Mỗi workflow có các bước phê duyệt (steps), gán người duyệt
 * - Expand row để xem chi tiết các bước
 * - State: workflows/loading/trigger — form modal riêng
 * - Bọc trong PlanGate
 * 
 * Components/Hooks/Exports:
 * - Workflows (default): Page chính — table + expand + modal tạo workflow
 */
import { useState, useEffect } from "react";
import {
  Table, Button, Space, Tag, Modal, Form, Input, Select, Switch,
  message, Card, Collapse, InputNumber,
} from "antd";
import { PlusOutlined, ThunderboltOutlined } from "@ant-design/icons";
import PageHeader from "../components/layout/PageHeader";
import PlanGate from "../components/PlanGate";
import { getWorkflows, createWorkflow, updateWorkflow } from "../api/workflow";

const TRIGGER_LABELS = {
  EXPENSE_ABOVE: "Chi phí vượt ngưỡng",
  PO_ABOVE: "Đơn mua vượt ngưỡng",
  LEAVE_REQUEST: "Xin nghỉ phép",
  CUSTOM: "Tùy chỉnh",
};
const TRIGGER_COLOR = { EXPENSE_ABOVE: "orange", PO_ABOVE: "blue", LEAVE_REQUEST: "purple", CUSTOM: "default" };

export default function Workflows() {
  const [workflows, setWorkflows] = useState([]);
  const [loading, setLoading]     = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm] = Form.useForm();
  const [creating, setCreating]   = useState(false);
  const [trigger, setTrigger]     = useState("EXPENSE_ABOVE");

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    try { setWorkflows(await getWorkflows()); }
    catch { message.error("Không tải được workflow"); }
    finally { setLoading(false); }
  };

  const handleCreate = async () => {
    const vals = await createForm.validateFields();
    setCreating(true);
    try {
      await createWorkflow({
        ...vals,
        config: { threshold: vals.threshold },
        steps: vals.steps || [],
      });
      message.success("Đã tạo workflow");
      setCreateOpen(false);
      createForm.resetFields();
      await load();
    } catch (e) { message.error(e?.response?.data?.message || "Lỗi"); }
    finally { setCreating(false); }
  };

  const handleToggle = async (id, isActive) => {
    try { await updateWorkflow(id, { isActive }); await load(); }
    catch { message.error("Lỗi"); }
  };

  const cols = [
    {
      title: "Tên workflow", key: "name",
      render: (_, r) => (
        <Space direction="vertical" size={2}>
          <span><ThunderboltOutlined style={{ color: "#714b67" }} /> <strong>{r.name}</strong></span>
          <span style={{ fontSize: 12, color: "#64748b" }}>{r.steps?.length || 0} bước</span>
        </Space>
      ),
    },
    {
      title: "Trigger", dataIndex: "trigger", width: 180,
      render: (v) => <Tag color={TRIGGER_COLOR[v]}>{TRIGGER_LABELS[v] || v}</Tag>,
    },
    {
      title: "Ngưỡng", key: "threshold",
      render: (_, r) => r.config?.threshold ? Number(r.config.threshold).toLocaleString("vi-VN") + "đ" : "—",
    },
    {
      title: "Trạng thái", dataIndex: "isActive", width: 110,
      render: (v, r) => <Switch size="small" checked={v} onChange={(c) => handleToggle(r.id, c)} />,
    },
    { title: "Người tạo", key: "by", render: (_, r) => r.createdBy?.fullName || "—" },
  ];

  return (
    <PlanGate moduleKey="workflows" moduleName="Workflow / Phê duyệt">
    <div>
      <PageHeader title="Workflow Engine" subtitle="Tự động hóa quy trình phê duyệt và thông báo" />

      <Space style={{ marginBottom: 16 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>Tạo workflow</Button>
      </Space>

      <Table rowKey="id" columns={cols} dataSource={workflows} loading={loading}
        size="small" pagination={false}
        expandable={{
          expandedRowRender: (r) => (
            <div style={{ padding: "8px 16px" }}>
              <strong>Các bước:</strong>
              <div style={{ marginTop: 8 }}>
                {(r.steps || []).map((s) => (
                  <Tag key={s.id} style={{ marginBottom: 4 }}>
                    {s.sequence}. {s.type} — {JSON.stringify(s.config)}
                  </Tag>
                ))}
              </div>
            </div>
          ),
        }}
      />

      <Modal title="Tạo workflow mới" open={createOpen} onCancel={() => setCreateOpen(false)}
        onOk={handleCreate} confirmLoading={creating} okText="Tạo" width={560}>
        <Form form={createForm} layout="vertical" requiredMark={false}>
          <Form.Item name="name" label="Tên workflow" rules={[{ required: true }]}>
            <Input placeholder="Duyệt chi phí > 10M" />
          </Form.Item>
          <Form.Item name="trigger" label="Trigger" rules={[{ required: true }]} initialValue="EXPENSE_ABOVE">
            <Select options={Object.entries(TRIGGER_LABELS).map(([k, v]) => ({ value: k, label: v }))}
              onChange={setTrigger} />
          </Form.Item>
          {(trigger === "EXPENSE_ABOVE" || trigger === "PO_ABOVE") && (
            <Form.Item name="threshold" label="Ngưỡng kích hoạt (VNĐ)" rules={[{ required: true }]}>
              <InputNumber style={{ width: "100%" }} min={0} step={1000000}
                formatter={(v) => Number(v || 0).toLocaleString()} placeholder="10000000" />
            </Form.Item>
          )}
          <Card size="small" title="Bước phê duyệt (tùy chọn)">
            <p style={{ color: "#94a3b8", fontSize: 12 }}>
              Nhập User ID của người cần phê duyệt. Hệ thống sẽ gửi thông báo và chờ quyết định.
            </p>
            <Form.Item name={["steps", 0, "approverId"]} label="ID người duyệt">
              <Input placeholder="UUID người dùng" />
            </Form.Item>
          </Card>
        </Form>
      </Modal>
    </div>
    </PlanGate>
  );
}
