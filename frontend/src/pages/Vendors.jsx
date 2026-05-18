// frontend/src/pages/Vendors.jsx
import { useEffect, useState } from "react";
import { Table, Button, Modal, Form, Input, InputNumber, Space, message, Tag, Popconfirm } from "antd";
import { PlusOutlined, EditOutlined, DeleteOutlined } from "@ant-design/icons";
import PageHeader from "../components/layout/PageHeader";
import { getVendors, createVendor, updateVendor, deleteVendor } from "../api/accounting";

const fmtVND = (v) => Number(v || 0).toLocaleString("vi-VN") + "đ";

export default function Vendors() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState({ vendors: [], pagination: { total: 0 } });
  const [filters, setFilters] = useState({ page: 1, limit: 20, search: "" });
  const [editing, setEditing] = useState(null);
  const [form] = Form.useForm();

  const load = async () => {
    setLoading(true);
    try { setData(await getVendors(filters)); }
    catch (e) { message.error(e.response?.data?.message || "Không tải được"); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [filters]);

  const submit = async () => {
    try {
      const v = await form.validateFields();
      if (editing?.id) await updateVendor(editing.id, v);
      else await createVendor(v);
      message.success("Đã lưu");
      setEditing(null);
      form.resetFields();
      load();
    } catch (e) {
      if (e.errorFields) return;
      message.error(e.response?.data?.message || "Lỗi");
    }
  };

  const handleDelete = async (id) => {
    try { await deleteVendor(id); message.success("Đã vô hiệu hóa"); load(); }
    catch (e) { message.error(e.response?.data?.message || "Lỗi"); }
  };

  const columns = [
    { title: "Mã", dataIndex: "code", width: 120 },
    { title: "Tên NCC", dataIndex: "name" },
    { title: "MST", dataIndex: "taxCode", width: 140 },
    { title: "SĐT", dataIndex: "phone", width: 120 },
    { title: "Hạn thanh toán", dataIndex: "paymentTerms", width: 130, render: (v) => `${v} ngày` },
    {
      title: "Đang nợ NCC", dataIndex: "totalDebt", width: 150, align: "right",
      render: (v) => <Tag color={Number(v) > 0 ? "orange" : "default"}>{fmtVND(v)}</Tag>,
    },
    {
      title: "", key: "actions", width: 140, fixed: "right",
      render: (_, r) => (
        <Space>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => { setEditing(r); form.setFieldsValue(r); }}>Sửa</Button>
          <Popconfirm title="Vô hiệu hóa NCC?" onConfirm={() => handleDelete(r.id)}>
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>Xóa</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Nhà cung cấp"
        subtitle="Quản lý NCC, công nợ phải trả và hạn thanh toán"
        extra={
          <Space>
            <Input.Search placeholder="Tìm theo tên/SĐT/MST" allowClear onSearch={(s) => setFilters({ ...filters, search: s, page: 1 })} style={{ width: 280 }} />
            <Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditing({}); form.resetFields(); }}>Thêm NCC</Button>
          </Space>
        }
      />

      <Table
        loading={loading}
        rowKey="id"
        dataSource={data.vendors}
        columns={columns}
        scroll={{ x: 1100 }}
        pagination={{
          current: filters.page,
          pageSize: filters.limit,
          total: data.pagination.total,
          onChange: (page, limit) => setFilters({ ...filters, page, limit }),
        }}
      />

      <Modal
        title={editing?.id ? "Sửa NCC" : "Thêm NCC"}
        open={!!editing}
        onOk={submit}
        onCancel={() => { setEditing(null); form.resetFields(); }}
        width={600}
        okText="Lưu"
        cancelText="Hủy"
      >
        <Form form={form} layout="vertical" initialValues={{ paymentTerms: 30 }}>
          <Form.Item label="Tên NCC" name="name" rules={[{ required: true, min: 2 }]}><Input /></Form.Item>
          <Form.Item label="MST" name="taxCode"><Input /></Form.Item>
          <Form.Item label="SĐT" name="phone"><Input /></Form.Item>
          <Form.Item label="Email" name="email"><Input /></Form.Item>
          <Form.Item label="Địa chỉ" name="address"><Input /></Form.Item>
          <Form.Item label="Người liên hệ" name="contactPerson"><Input /></Form.Item>
          <Form.Item label="Hạn thanh toán (ngày)" name="paymentTerms"><InputNumber min={0} max={365} style={{ width: "100%" }} /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
