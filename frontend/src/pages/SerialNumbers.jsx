import { useState, useEffect } from "react";
import {
  Table, Button, Space, Tag, Modal, Form, Input, Select,
  message, Card, Row, Col, Statistic,
} from "antd";
import { PlusOutlined, SearchOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import api from "../api/axios";
import PageHeader from "../components/layout/PageHeader";

const statusColors = {
  IN_STOCK: "green", SOLD: "blue", RETURNED: "orange", DAMAGED: "red",
};
const statusLabels = {
  IN_STOCK: "Trong kho", SOLD: "Đã bán", RETURNED: "Trả lại", DAMAGED: "Hỏng",
};

export default function SerialNumbers() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ search: "", status: "", productId: "" });
  const [registerOpen, setRegisterOpen] = useState(false);
  const [registerForm] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const [products, setProducts] = useState([]);
  const [warehouses, setWarehouses] = useState([]);

  const loadData = async (p = page) => {
    setLoading(true);
    try {
      const params = { page: p, limit: 20 };
      if (filters.search) params.search = filters.search;
      if (filters.status) params.status = filters.status;
      if (filters.productId) params.productId = filters.productId;
      const { data: res } = await api.get("/serial-numbers", { params });
      setData(res?.data?.serialNumbers || []);
      setTotal(res?.data?.total || 0);
    } catch { message.error("Không tải được dữ liệu"); setData([]); }
    finally { setLoading(false); }
  };

  useEffect(() => { loadData(); }, [page, filters]);

  useEffect(() => {
    Promise.all([
      api.get("/products", { params: { limit: 200 } }),
      api.get("/warehouses"),
    ]).then(([p, w]) => {
      setProducts(p?.data?.data || []);
      setWarehouses(w?.data?.data || []);
    }).catch(() => {});
  }, []);

  const handleRegister = async () => {
    try {
      const values = await registerForm.validateFields();
      const serialCodes = values.serialCodes
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      if (serialCodes.length === 0) {
        message.warning("Nhập ít nhất 1 serial number");
        return;
      }
      setSubmitting(true);
      await api.post("/serial-numbers/register", {
        serialCodes,
        productId: values.productId,
        warehouseId: values.warehouseId,
        note: values.note,
      });
      message.success("Đăng ký serial number thành công");
      setRegisterOpen(false);
      registerForm.resetFields();
      loadData(1);
    } catch (err) {
      if (err?.errorFields) return;
      message.error(err?.response?.data?.message || "Lỗi đăng ký");
    } finally { setSubmitting(false); }
  };

  const columns = [
    { title: "Serial", dataIndex: "serialCode", width: 160 },
    { title: "Sản phẩm", dataIndex: ["product", "name"], width: 200 },
    { title: "SKU", dataIndex: ["product", "sku"], width: 120 },
    { title: "Kho", dataIndex: ["warehouse", "name"], width: 140 },
    { title: "Trạng thái", dataIndex: "status", width: 120,
      render: (v) => <Tag color={statusColors[v]}>{statusLabels[v] || v}</Tag>,
    },
    { title: "Đơn hàng", dataIndex: ["order", "code"], width: 160,
      render: (v) => v || "—",
    },
    { title: "Ngày tạo", dataIndex: "createdAt", width: 140,
      render: (v) => dayjs(v).format("DD/MM/YYYY"),
    },
    { title: "Ghi chú", dataIndex: "note", render: (v) => v || "—" },
  ];

  return (
    <>
      <PageHeader
        title="Serial Number"
        subtitle="Quản lý serial number theo dõi từng đơn vị sản phẩm"
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setRegisterOpen(true)}>
            Đăng ký serial
          </Button>
        }
      />

      <Card style={{ marginBottom: 16 }}>
        <Space wrap>
          <Input.Search
            placeholder="Tìm serial..."
            allowClear
            style={{ width: 250 }}
            onSearch={(v) => { setFilters((f) => ({ ...f, search: v })); setPage(1); }}
          />
          <Select
            placeholder="Trạng thái"
            allowClear
            style={{ width: 150 }}
            onChange={(v) => { setFilters((f) => ({ ...f, status: v })); setPage(1); }}
          >
            <Select.Option value="IN_STOCK">Trong kho</Select.Option>
            <Select.Option value="SOLD">Đã bán</Select.Option>
            <Select.Option value="RETURNED">Trả lại</Select.Option>
            <Select.Option value="DAMAGED">Hỏng</Select.Option>
          </Select>
          <Select
            placeholder="Sản phẩm"
            allowClear
            showSearch
            optionFilterProp="label"
            style={{ width: 250 }}
            onChange={(v) => { setFilters((f) => ({ ...f, productId: v })); setPage(1); }}
            options={products.map((p) => ({ value: p.id, label: `${p.name} (${p.sku})` }))}
          />
        </Space>
      </Card>

      <Card>
        <Table
          dataSource={data}
          columns={columns}
          rowKey="id"
          loading={loading}
          pagination={{
            current: page,
            total,
            pageSize: 20,
            onChange: (p) => setPage(p),
          }}
          locale={{ emptyText: "Chưa có serial number nào" }}
        />
      </Card>

      <Modal
        title="Đăng ký Serial Number"
        open={registerOpen}
        onCancel={() => { setRegisterOpen(false); registerForm.resetFields(); }}
        onOk={handleRegister}
        confirmLoading={submitting}
        width={600}
      >
        <Form form={registerForm} layout="vertical">
          <Form.Item name="productId" label="Sản phẩm" rules={[{ required: true }]}>
            <Select
              showSearch
              optionFilterProp="label"
              placeholder="Chọn sản phẩm"
              options={products.map((p) => ({ value: p.id, label: `${p.name} (${p.sku})` }))}
            />
          </Form.Item>
          <Form.Item name="warehouseId" label="Kho" rules={[{ required: true }]}>
            <Select
              placeholder="Chọn kho"
              options={warehouses.map((w) => ({ value: w.id, label: w.name }))}
            />
          </Form.Item>
          <Form.Item
            name="serialCodes"
            label="Danh sách Serial"
            rules={[{ required: true, message: "Nhập ít nhất 1 serial" }]}
            extra="Mỗi serial trên một dòng"
          >
            <Input.TextArea rows={6} placeholder={"SN001\nSN002\nSN003"} />
          </Form.Item>
          <Form.Item name="note" label="Ghi chú">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
