/**
 * Frontend: pages/CycleCount.jsx — Kiểm kê hàng hóa
 * 
 * Tổng quan:
 * - Trang quản lý phiếu kiểm kê kho (cycle count) với chức năng tạo, nhập số liệu thực tế, áp dụng điều chỉnh
 * - API: GET /inventory/cycle-counts, POST /inventory/cycle-counts, PATCH .../complete, PATCH .../items
 * - State: rows (danh sách), selected (chi tiết), products
 * - Logic: Compare số lượng hệ thống vs thực tế, tính chênh lệch, áp dụng điều chỉnh tồn kho
 * 
 * Components/Hooks/Exports:
 * - CycleCount (default export): Danh sách + drawer chi tiết + modal tạo phiếu
 */
import { useEffect, useMemo, useState } from "react";
import { Button, Drawer, Form, InputNumber, Modal, Select, Space, Table, Tag, message } from "antd";
import PlanGate from "../components/PlanGate";
import api from "../api/axios";

const statusColor = {
  DRAFT: "default",
  IN_PROGRESS: "blue",
  COMPLETED: "green",
  CANCELLED: "red",
};

export default function CycleCount() {
  const [rows, setRows] = useState([]);
  const [products, setProducts] = useState([]);
  const [selected, setSelected] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [form] = Form.useForm();
  const [countForm] = Form.useForm();

  const loadData = async () => {
    const [ccRes, pRes] = await Promise.all([
      api.get("/inventory/cycle-counts"),
      api.get("/products?limit=100"),
    ]);
    setRows(ccRes.data?.data || []);
    setProducts(pRes.data?.data || []);
  };

  useEffect(() => {
    loadData().catch(() => message.error("Không tải được dữ liệu kiểm kê"));
  }, []);

  const productOptions = useMemo(() => products.map((p) => ({
    value: p.id,
    label: `${p.name} (${p.sku})`,
  })), [products]);

  const openDetail = async (row) => {
    try {
      const res = await api.get(`/inventory/cycle-counts/${row.id}`);
      setSelected(res.data?.data);
      countForm.setFieldsValue({
        items: (res.data?.data?.items || []).map((item) => ({
          id: item.id,
          actualQuantity: item.actualQuantity ?? item.systemQuantity,
          note: item.note,
        })),
      });
    } catch {
      message.error("Không tải được chi tiết kiểm kê");
    }
  };

  const createCycleCount = async () => {
    try {
      const values = await form.validateFields();
      await api.post("/inventory/cycle-counts", values);
      message.success("Đã tạo phiếu kiểm kê");
      setCreateOpen(false);
      form.resetFields();
      loadData();
    } catch (err) {
      if (!err.errorFields) message.error(err?.response?.data?.message || "Không tạo được phiếu kiểm kê");
    }
  };

  const saveCounts = async () => {
    try {
      const values = await countForm.validateFields();
      await api.patch(`/inventory/cycle-counts/${selected.id}/items`, values);
      message.success("Đã lưu số liệu");
      openDetail(selected);
      loadData();
    } catch (err) {
      if (!err.errorFields) message.error(err?.response?.data?.message || "Không lưu được số liệu");
    }
  };

  const complete = () => {
    Modal.confirm({
      title: "Áp dụng điều chỉnh tồn kho?",
      okText: "Áp dụng",
      cancelText: "Hủy",
      onOk: async () => {
        await api.patch(`/inventory/cycle-counts/${selected.id}/complete`);
        message.success("Đã hoàn thành kiểm kê");
        setSelected(null);
        loadData();
      },
    });
  };

  return (
    <PlanGate moduleKey="cycle-count" moduleName="Kiểm kê hàng hóa">
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Button type="primary" onClick={() => setCreateOpen(true)}>Tạo phiếu</Button>
      </Space>
      <Table
        rowKey="id"
        dataSource={rows}
        onRow={(record) => ({ onClick: () => openDetail(record) })}
        columns={[
          { title: "Mã", dataIndex: "code" },
          { title: "Trạng thái", dataIndex: "status", render: (value) => <Tag color={statusColor[value]}>{value}</Tag> },
          { title: "Người tạo", render: (_, row) => row.createdBy?.fullName || "-" },
          { title: "Số SP", render: (_, row) => row.items?.length || 0 },
          { title: "Ngày", dataIndex: "createdAt", render: (value) => new Date(value).toLocaleString("vi-VN") },
        ]}
      />

      <Modal title="Tạo phiếu kiểm kê" open={createOpen} onCancel={() => setCreateOpen(false)} onOk={createCycleCount}>
        <Form form={form} layout="vertical">
          <Form.Item name="productIds" label="Sản phẩm" rules={[{ required: true }]}>
            <Select mode="multiple" showSearch optionFilterProp="label" options={productOptions} />
          </Form.Item>
          <Form.Item name="note" label="Ghi chú">
            <Select options={[{ value: "Kiểm kê định kỳ", label: "Kiểm kê định kỳ" }, { value: "Kiểm kê đột xuất", label: "Kiểm kê đột xuất" }]} />
          </Form.Item>
        </Form>
      </Modal>

      <Drawer title={selected?.code} open={!!selected} width={760} onClose={() => setSelected(null)}>
        {selected && (
          <Form form={countForm}>
            <Form.List name="items">
              {(fields) => (
                <Table
                  rowKey="key"
                  pagination={false}
                  dataSource={fields}
                  columns={[
                    {
                      title: "Sản phẩm",
                      render: (_, field) => {
                        const item = selected.items[field.name];
                        return `${item.product?.name} (${item.product?.sku})`;
                      },
                    },
                    { title: "Hệ thống", render: (_, field) => selected.items[field.name].systemQuantity },
                    {
                      title: "Thực tế",
                      render: (_, field) => (
                        <>
                          <Form.Item name={[field.name, "id"]} hidden><input /></Form.Item>
                          <Form.Item name={[field.name, "actualQuantity"]} rules={[{ required: true }]} style={{ margin: 0 }}>
                            <InputNumber min={0} />
                          </Form.Item>
                        </>
                      ),
                    },
                    {
                      title: "Chênh lệch",
                      render: (_, field) => (
                        <Form.Item noStyle shouldUpdate>
                          {({ getFieldValue }) => {
                            const item = selected.items[field.name];
                            const actual = getFieldValue(["items", field.name, "actualQuantity"]) ?? item.actualQuantity ?? item.systemQuantity;
                            const variance = actual - item.systemQuantity;
                            return <Tag color={variance === 0 ? "green" : variance < 0 ? "red" : "orange"}>{variance}</Tag>;
                          }}
                        </Form.Item>
                      ),
                    },
                  ]}
                />
              )}
            </Form.List>
            {selected.status !== "COMPLETED" && selected.status !== "CANCELLED" && (
              <Space style={{ marginTop: 16 }}>
                <Button onClick={saveCounts}>Lưu số liệu</Button>
                <Button type="primary" onClick={complete}>Áp dụng điều chỉnh</Button>
              </Space>
            )}
          </Form>
        )}
      </Drawer>
    </div>
    </PlanGate>
  );
}
