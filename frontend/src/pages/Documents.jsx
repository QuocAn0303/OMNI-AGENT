import { useEffect, useState, useCallback } from "react";
import {
  Table, Button, Modal, Form, Input, Upload, Select, Tag, Space,
  message, Card, Switch, Popconfirm, Typography,
} from "antd";
import { UploadOutlined, PlusOutlined, SearchOutlined, DeleteOutlined, EyeOutlined, FileTextOutlined } from "@ant-design/icons";
import PageHeader from "../components/layout/PageHeader";
import {
  getDocuments, createDocument, deleteDocument,
  getDepartments,
} from "../api/documents";

const { Text } = Typography;

export default function Documents() {
  const [docs, setDocs] = useState([]);
  const [pagination, setPagination] = useState({ total: 0, page: 1, limit: 20, totalPages: 0 });
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [departments, setDepartments] = useState([]);
  const [search, setSearch] = useState("");
  const [uploading, setUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [previewTitle, setPreviewTitle] = useState("");
  const [form] = Form.useForm();

  const load = useCallback(async (page = 1) => {
    setLoading(true);
    try {
      const params = { page, limit: 20 };
      if (search) params.search = search;
      const res = await getDocuments(params);
      setDocs(res.data);
      setPagination(res.pagination);
    } catch {
      message.error("Không thể tải danh sách tài liệu");
    } finally {
      setLoading(false);
    }
  }, [search]);

  const loadDepartments = useCallback(async () => {
    try {
      const depts = await getDepartments();
      setDepartments(depts);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadDepartments(); }, [loadDepartments]);

  const handleUpload = async () => {
    try {
      const values = await form.validateFields();
      const file = form.getFieldValue("file");
      if (!file || !file.length) {
        message.error("Vui lòng chọn file");
        return;
      }

      setUploading(true);
      const formData = new FormData();
      formData.append("file", file[0].originFileObj);
      formData.append("title", values.title);
      formData.append("description", values.description || "");
      formData.append("sendToAll", values.sendToAll || false);
      if (values.departmentIds && values.departmentIds.length) {
        values.departmentIds.forEach((id) => formData.append("departmentIds", id));
      }

      await createDocument(formData);
      message.success("Tải lên thành công");
      setModalOpen(false);
      form.resetFields();
      load();
    } catch (err) {
      message.error(err?.response?.data?.message || "Tải lên thất bại");
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      await deleteDocument(id);
      message.success("Đã xóa tài liệu");
      load();
    } catch {
      message.error("Xóa thất bại");
    }
  };

  const handlePreview = (record) => {
    setPreviewTitle(record.title);
    setPreviewUrl(`/api/documents/${record.id}/file`);
  };

  const columns = [
    {
      title: "Tên tài liệu",
      dataIndex: "title",
      key: "title",
      render: (text, record) => (
        <Space>
          <FileTextOutlined />
          <a onClick={() => handlePreview(record)}>{text}</a>
        </Space>
      ),
    },
    {
      title: "File",
      dataIndex: "fileName",
      key: "fileName",
      width: 200,
    },
    {
      title: "Phạm vi",
      dataIndex: "sendToAll",
      key: "scope",
      width: 120,
      render: (sendToAll, record) => {
        if (sendToAll) return <Tag color="blue">Tất cả NV</Tag>;
        return record.departments?.map((d) => (
          <Tag key={d.department.id} color="green">{d.department.name}</Tag>
        )) || <Tag>Tự do</Tag>;
      },
    },
    {
      title: "Người gửi",
      dataIndex: ["author", "fullName"],
      key: "author",
      width: 150,
    },
    {
      title: "Ngày gửi",
      dataIndex: "createdAt",
      key: "createdAt",
      width: 160,
      render: (v) => new Date(v).toLocaleDateString("vi-VN"),
    },
    {
      title: "",
      key: "actions",
      width: 80,
      render: (_, record) => (
        <Popconfirm title="Xóa tài liệu này?" onConfirm={() => handleDelete(record.id)} okText="Xóa" cancelText="Hủy">
          <Button type="text" danger icon={<DeleteOutlined />} />
        </Popconfirm>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Tài liệu nội bộ"
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>
            Tải lên tài liệu
          </Button>
        }
      />
      <Card>
        <Space style={{ marginBottom: 16 }}>
          <Input
            placeholder="Tìm kiếm theo tên tài liệu..."
            prefix={<SearchOutlined />}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onPressEnter={() => load()}
            style={{ width: 300 }}
            allowClear
            onClear={() => { setSearch(""); load(); }}
          />
        </Space>

        <Table
          dataSource={docs}
          columns={columns}
          rowKey="id"
          loading={loading}
          pagination={{
            current: pagination.page,
            pageSize: pagination.limit,
            total: pagination.total,
            onChange: (p) => load(p),
            showSizeChanger: false,
          }}
          locale={{ emptyText: "Chưa có tài liệu nào" }}
        />
      </Card>

      <Modal
        title="Tải lên tài liệu mới"
        open={modalOpen}
        onOk={handleUpload}
        onCancel={() => { setModalOpen(false); form.resetFields(); }}
        confirmLoading={uploading}
        okText="Tải lên"
        cancelText="Hủy"
        width={520}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="title" label="Tên tài liệu" rules={[{ required: true, message: "Nhập tên tài liệu" }]}>
            <Input placeholder="Nhập tên tài liệu" />
          </Form.Item>
          <Form.Item name="description" label="Mô tả (không bắt buộc)">
            <Input.TextArea rows={2} placeholder="Mô tả ngắn về tài liệu" />
          </Form.Item>
          <Form.Item name="file" label="File" rules={[{ required: true, message: "Chọn file PDF hoặc Word" }]}>
            <Upload
              beforeUpload={() => false}
              maxCount={1}
              accept=".pdf,.doc,.docx"
            >
              <Button icon={<UploadOutlined />}>Chọn file (PDF, Word)</Button>
            </Upload>
          </Form.Item>
          <Form.Item name="sendToAll" label="Gửi cho tất cả nhân viên" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item
            noStyle
            shouldUpdate={(prev, curr) => prev.sendToAll !== curr.sendToAll}
          >
            {({ getFieldValue }) =>
              !getFieldValue("sendToAll") ? (
                <Form.Item name="departmentIds" label="Chọn phòng ban">
                  <Select
                    mode="multiple"
                    placeholder="Chọn phòng ban"
                    options={departments.map((d) => ({ label: d.name, value: d.id }))}
                    allowClear
                  />
                </Form.Item>
              ) : null
            }
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={previewTitle}
        open={!!previewUrl}
        onCancel={() => { setPreviewUrl(null); setPreviewTitle(""); }}
        footer={null}
        width="80%"
        style={{ top: 20 }}
      >
        {previewUrl && (
          <iframe
            src={previewUrl}
            style={{ width: "100%", height: "70vh", border: "none" }}
            title={previewTitle}
          />
        )}
      </Modal>
    </div>
  );
}
