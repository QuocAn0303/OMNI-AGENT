/**
 * Frontend: pages/admin/AdminUpgradeRequestsPage.jsx — Yêu cầu nâng gói
 *
 * Tổng quan:
 * - Hiển thị danh sách yêu cầu nâng gói từ tenant
 * - Duyệt (approve) hoặc từ chối (reject) yêu cầu
 * - API: GET /admin/upgrade-requests, POST .../approve, POST .../reject
 * - State: requests, loading
 *
 * Components/Hooks/Exports:
 * - AdminUpgradeRequestsPage: Component chính (xuất mặc định)
 */
import { useState, useEffect } from "react";
import { Table, Card, Tag, Button, Typography, message, Space, Popconfirm } from "antd";
import { ArrowUpOutlined, CheckOutlined, CloseOutlined } from "@ant-design/icons";
import api from "../../api/axios";

const { Title } = Typography;

export default function AdminUpgradeRequestsPage() {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(false);

  const fetch = async () => {
    setLoading(true);
    try {
      const res = await api.get("/admin/upgrade-requests");
      setRequests(res.data.data);
    } catch { message.error("Không thể tải yêu cầu"); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetch(); }, []);

  const handleApprove = async (id) => {
    try {
      await api.post(`/admin/upgrade-requests/${id}/approve`);
      message.success("Đã duyệt yêu cầu nâng gói");
      fetch();
    } catch (err) { message.error(err.response?.data?.message || "Duyệt thất bại"); }
  };

  const handleReject = async (id) => {
    try {
      await api.post(`/admin/upgrade-requests/${id}/reject`);
      message.success("Đã từ chối yêu cầu");
      fetch();
    } catch { message.error("Từ chối thất bại"); }
  };

  const columns = [
    { title: "Mã yêu cầu", dataIndex: "invoiceCode", key: "code" },
    { title: "Tenant", dataIndex: ["tenant", "name"], key: "tenant" },
    {
      title: "Số tiền", dataIndex: "amount", key: "amount",
      render: (v, r) => `${v?.toLocaleString()} ${r.currency}`,
    },
    {
      title: "Trạng thái", dataIndex: "status", key: "status",
      render: (v) => {
        const colors = { PENDING: "orange", PAID: "green", CANCELLED: "red" };
        return <Tag color={colors[v]}>{v}</Tag>;
      },
    },
    {
      title: "Ngày yêu cầu", dataIndex: "createdAt", key: "createdAt",
      render: (d) => d ? new Date(d).toLocaleDateString("vi-VN") : "-",
    },
    {
      title: "", key: "actions",
      render: (_, r) => r.status === "PENDING" ? (
        <Space>
          <Popconfirm title="Duyệt yêu cầu này?" onConfirm={() => handleApprove(r.id)}>
            <Button icon={<CheckOutlined />} size="small" type="primary">Duyệt</Button>
          </Popconfirm>
          <Popconfirm title="Từ chối yêu cầu?" onConfirm={() => handleReject(r.id)}>
            <Button icon={<CloseOutlined />} size="small" danger>Từ chối</Button>
          </Popconfirm>
        </Space>
      ) : null,
    },
  ];

  return (
    <div>
      <Title level={3}><ArrowUpOutlined /> Yêu cầu nâng gói</Title>
      <Card>
        <Table dataSource={requests} columns={columns} rowKey="id" loading={loading} pagination={{ pageSize: 20 }} />
      </Card>
    </div>
  );
}