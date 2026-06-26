/**
 * Frontend: pages/admin/PlansManagement.jsx — Quản lý gói dịch vụ
 *
 * Tổng quan:
 * - CRUD gói subscription (tên, key, giá, thời hạn, features)
 * - API: GET /subscriptions/plans, POST, PUT, DELETE
 * - State: plans, loading, modalOpen, editing, form
 *
 * Components/Hooks/Exports:
 * - PlansManagement: Component chính (xuất mặc định)
 */
import { useState, useEffect } from "react";
import { Table, Card, Button, Modal, Form, Input, InputNumber, Switch, message, Typography, Space, Tag, Popconfirm } from "antd";
import { PlusOutlined, EditOutlined, DeleteOutlined, CrownOutlined } from "@ant-design/icons";
import api from "../../api/axios";

const { Title } = Typography;

export default function PlansManagement() {
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form] = Form.useForm();

  const fetchPlans = async () => {
    setLoading(true);
    try {
      const res = await api.get("/subscriptions/plans");
      setPlans(res.data.data);
    } catch { message.error("Failed to load plans"); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchPlans(); }, []);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ currency: "VND", durationDays: 30, sortOrder: 0 });
    setModalOpen(true);
  };

  const openEdit = (plan) => {
    setEditing(plan);
    form.setFieldsValue(plan);
    setModalOpen(true);
  };

  const handleSave = async () => {
    const values = await form.validateFields();
    try {
      if (editing) {
        await api.put(`/subscriptions/plans/${editing.id}`, values);
        message.success("Cập nhật gói thành công");
      } else {
        await api.post("/subscriptions/plans", values);
        message.success("Tạo gói thành công");
      }
      setModalOpen(false);
      fetchPlans();
    } catch (err) { message.error("Lỗi lưu gói"); }
  };

  const handleDelete = async (id) => {
    try {
      await api.delete(`/subscriptions/plans/${id}`);
      message.success("Đã xóa gói");
      fetchPlans();
    } catch { message.error("Xóa thất bại"); }
  };

  const columns = [
    { title: "Tên gói", dataIndex: "name", key: "name" },
    { title: "Key", dataIndex: "key", key: "key" },
    { title: "Giá", dataIndex: "price", key: "price", render: (v, r) => `${v?.toLocaleString()} ${r.currency}` },
    { title: "Ngày", dataIndex: "durationDays", key: "durationDays", render: (v) => `${v} ngày` },
    { title: "Thứ tự", dataIndex: "sortOrder", key: "sortOrder" },
    { title: "Kích hoạt", dataIndex: "isActive", key: "isActive", render: (v) => <Tag color={v ? "green" : "red"}>{v ? "Có" : "Không"}</Tag> },
    {
      title: "", key: "actions",
      render: (_, r) => (
        <Space>
          <Button icon={<EditOutlined />} size="small" onClick={() => openEdit(r)} />
          <Popconfirm title="Xóa gói này?" onConfirm={() => handleDelete(r.id)}>
            <Button icon={<DeleteOutlined />} size="small" danger />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <Title level={3}><CrownOutlined /> Quản lý gói dịch vụ</Title>
      <Button type="primary" icon={<PlusOutlined />} onClick={openCreate} style={{ marginBottom: 16 }}>
        Thêm gói mới
      </Button>
      <Card>
        <Table dataSource={plans} columns={columns} rowKey="id" loading={loading} pagination={false} />
      </Card>

      <Modal
        title={editing ? "Sửa gói" : "Thêm gói mới"}
        open={modalOpen}
        onOk={handleSave}
        onCancel={() => setModalOpen(false)}
        okText="Lưu"
        width={600}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="Tên gói" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="key" label="Key" rules={[{ required: true }]}>
            <Input disabled={!!editing} placeholder="free, pro, enterprise..." />
          </Form.Item>
          <Form.Item name="description" label="Mô tả">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Space style={{ width: "100%" }} size="large">
            <Form.Item name="price" label="Giá" rules={[{ required: true }]}>
              <InputNumber min={0} style={{ width: 140 }} />
            </Form.Item>
            <Form.Item name="currency" label="Tiền tệ">
              <Input style={{ width: 100 }} />
            </Form.Item>
            <Form.Item name="durationDays" label="Số ngày">
              <InputNumber min={1} style={{ width: 100 }} />
            </Form.Item>
            <Form.Item name="sortOrder" label="Thứ tự">
              <InputNumber min={0} style={{ width: 80 }} />
            </Form.Item>
          </Space>
          <Form.Item name="features" label="Features (JSON)">
            <Input.TextArea rows={4} placeholder='{"maxUsers": 10, "maxWarehouses": 3}' />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
