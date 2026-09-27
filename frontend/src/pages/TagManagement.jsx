/**
 * Frontend: pages/TagManagement.jsx — Quản lý Tag (thẻ khách hàng)
 * 
 * Tổng quan:
 * - Danh sách tag (GET /crm/tags) dạng Table, mỗi tag có tên, nhóm phân loại, màu sắc
 * - CRUD: tạo (POST), sửa (PUT), xóa (DELETE) tag qua modal
 * - Nhóm phân loại: GENERAL, SOURCE, BEHAVIOR, PREFERENCE
 * - Chọn màu bằng ColorPicker, chuyển về hex string khi lưu
 * - State: tags/loading/editingTag — form modal riêng
 * 
 * Components/Hooks/Exports:
 * - TagManagement (default): Page chính — Card + Table + modal CRUD
 */
import { useState, useEffect } from "react";
import {
  Table,
  Button,
  Space,
  Modal,
  Form,
  Input,
  ColorPicker,
  Select,
  message,
  Popconfirm,
  Tag,
  Card,
} from "antd";
import { PlusOutlined, EditOutlined, DeleteOutlined } from "@ant-design/icons";
import axios from "../api/axios";
import PageHeader from "../components/layout/PageHeader";


const TAG_CATEGORIES = [
  { value: "GENERAL", label: "Chung" },
  { value: "SOURCE", label: "Nguồn gốc" },
  { value: "BEHAVIOR", label: "Hành vi" },
  { value: "PREFERENCE", label: "Sở thích" },
];

export default function TagManagement() {
  const [tags, setTags] = useState([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTag, setEditingTag] = useState(null);
  const [form] = Form.useForm();

  const fetchTags = async () => {
    setLoading(true);
    try {
      const res = await axios.get("/crm/tags");
      setTags(res.data.data);
    } catch {
      message.error("Lỗi khi tải danh sách tag");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTags();
  }, []);

  const openModal = (tag = null) => {
    setEditingTag(tag);
    if (tag) {
      form.setFieldsValue({ ...tag, color: tag.color || "#0f766e" });
    } else {
      form.resetFields();
      form.setFieldsValue({ color: "#0f766e", category: "GENERAL" });
    }
    setModalOpen(true);
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      // Chuyển ColorPicker object thành hex string
      const payload = {
        ...values,
        color:
          typeof values.color === "string"
            ? values.color
            : values.color.toHexString(),
      };

      if (editingTag) {
        await axios.put(`/crm/tags/${editingTag.id}`, payload);
        message.success("Cập nhật tag thành công");
      } else {
        await axios.post("/crm/tags", payload);
        message.success("Tạo tag mới thành công");
      }
      setModalOpen(false);
      fetchTags();
    } catch {
      message.error("Có lỗi xảy ra!");
    }
  };

  const handleDelete = async (id) => {
    try {
      await axios.delete(`/crm/tags/${id}`);
      message.success("Đã xóa tag");
      fetchTags();
    } catch {
      message.error("Không thể xóa tag");
    }
  };

  const columns = [
    {
      title: "Tên Tag",
      dataIndex: "name",
      key: "name",
      render: (text, record) => <Tag color={record.color}>{text}</Tag>,
    },
    {
      title: "Nhóm phân loại",
      dataIndex: "category",
      key: "category",
      render: (cat) =>
        TAG_CATEGORIES.find((c) => c.value === cat)?.label || cat,
    },
    {
      title: "Thao tác",
      key: "action",
      align: "right",
      render: (_, record) => (
        <Space size="middle">
          <Button
            type="text"
            icon={<EditOutlined />}
            onClick={() => openModal(record)}
          />
          <Popconfirm
            title="Bạn có chắc muốn xóa tag này?"
            onConfirm={() => handleDelete(record.id)}
            okText="Xóa"
            cancelText="Hủy"
          >
            <Button type="text" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <>
      <PageHeader title="Quản lý Tag (Thẻ Khách Hàng)" />

      {/* Bọc Table trong Card và đưa nút bấm vào extra của Card */}
      <Card
        extra={
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => openModal()}
          >
            Thêm Tag Mới
          </Button>
        }
      >
        <Table
          columns={columns}
          dataSource={tags}
          rowKey="id"
          loading={loading}
        />
      </Card>

      <Modal
        title={editingTag ? "Sửa Tag" : "Thêm Tag Mới"}
        open={modalOpen}
        onOk={handleSave}
        onCancel={() => setModalOpen(false)}
        okText="Lưu"
        cancelText="Hủy"
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="name"
            label="Tên Tag"
            rules={[{ required: true, message: "Vui lòng nhập tên tag!" }]}
          >
            <Input placeholder="VD: Khách VIP, Yêu thích nến thơm..." />
          </Form.Item>
          <Form.Item name="category" label="Nhóm phân loại">
            <Select options={TAG_CATEGORIES} />
          </Form.Item>
          <Form.Item name="color" label="Màu sắc">
            <ColorPicker showText />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
