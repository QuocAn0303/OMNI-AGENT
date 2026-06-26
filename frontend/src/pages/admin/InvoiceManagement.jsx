/**
 * Frontend: pages/admin/InvoiceManagement.jsx — Quản lý hóa đơn
 *
 * Tổng quan:
 * - Danh sách hóa đơn subscription với lọc theo trạng thái
 * - Cập nhật thủ công trạng thái hóa đơn (PAID, CANCELLED)
 * - API: GET /subscriptions/admin/invoices, PUT /subscriptions/admin/invoices/:id
 * - State: invoices, loading, statusFilter
 *
 * Components/Hooks/Exports:
 * - InvoiceManagement: Component chính (xuất mặc định)
 */
import { useState, useEffect } from "react";
import { Table, Card, Button, Select, message, Typography, Tag, Space, Modal } from "antd";
import { FileTextOutlined, CheckOutlined, CloseOutlined } from "@ant-design/icons";
import api from "../../api/axios";

const { Title } = Typography;

const statusColors = { PENDING: "orange", PAID: "green", OVERDUE: "red", CANCELLED: "default", REFUNDED: "purple" };

export default function InvoiceManagement() {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState(null);

  const fetchInvoices = async () => {
    setLoading(true);
    try {
      const params = statusFilter ? `?status=${statusFilter}` : "";
      const res = await api.get(`/subscriptions/admin/invoices${params}`);
      setInvoices(res.data.data);
    } catch { message.error("Failed to load invoices"); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchInvoices(); }, [statusFilter]);

  const handleStatus = async (id, status) => {
    try {
      await api.put(`/subscriptions/admin/invoices/${id}`, { status });
      message.success(`Invoice ${status}`);
      fetchInvoices();
    } catch { message.error("Update failed"); }
  };

  const columns = [
    { title: "Mã HĐ", dataIndex: "invoiceCode", key: "code" },
    { title: "Tenant", dataIndex: ["tenant", "name"], key: "tenant", responsive: ["md"] },
    {
      title: "Gói", key: "plan",
      render: (_, r) => r.subscription?.plan?.name || "-",
      responsive: ["lg"],
    },
    {
      title: "Số tiền", dataIndex: "amount", key: "amount",
      render: (v, r) => `${v?.toLocaleString()} ${r.currency}`,
    },
    {
      title: "Trạng thái", dataIndex: "status", key: "status",
      render: (v) => <Tag color={statusColors[v]}>{v}</Tag>,
    },
    {
      title: "Hạn thanh toán", dataIndex: "dueDate", key: "dueDate",
      render: (d) => d ? new Date(d).toLocaleDateString("vi-VN") : "-",
    },
    {
      title: "Ngày thanh toán", dataIndex: "paidAt", key: "paidAt",
      render: (d) => d ? new Date(d).toLocaleDateString("vi-VN") : "-",
    },
    {
      title: "", key: "actions",
      render: (_, r) => (
        <Space>
          {r.status === "PENDING" && (
            <>
              <Button icon={<CheckOutlined />} size="small" type="primary" onClick={() => handleStatus(r.id, "PAID")}>
                Paid
              </Button>
              <Button icon={<CloseOutlined />} size="small" danger onClick={() => handleStatus(r.id, "CANCELLED")}>
                Cancel
              </Button>
            </>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <Title level={3}><FileTextOutlined /> Quản lý hóa đơn</Title>
      <Space style={{ marginBottom: 16 }}>
        <span>Lọc:</span>
        <Select value={statusFilter} onChange={setStatusFilter} allowClear placeholder="Tất cả" style={{ width: 140 }}>
          <Select.Option value={null}>Tất cả</Select.Option>
          <Select.Option value="PENDING">PENDING</Select.Option>
          <Select.Option value="PAID">PAID</Select.Option>
          <Select.Option value="OVERDUE">OVERDUE</Select.Option>
          <Select.Option value="CANCELLED">CANCELLED</Select.Option>
        </Select>
      </Space>
      <Card>
        <Table dataSource={invoices} columns={columns} rowKey="id" loading={loading} scroll={{ x: 800 }} pagination={{ pageSize: 20 }} />
      </Card>
    </div>
  );
}
