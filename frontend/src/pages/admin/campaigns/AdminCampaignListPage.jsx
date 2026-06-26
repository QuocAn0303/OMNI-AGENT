/**
 * Frontend: pages/admin/campaigns/AdminCampaignListPage.jsx — Danh sách chiến dịch CRM
 *
 * Tổng quan:
 * - Bảng danh sách chiến dịch marketing (email/SMS) với trạng thái
 * - Xóa, gửi chiến dịch (nếu DRAFT), điều hướng tạo/sửa
 * - API: GET /admin/campaigns, DELETE /admin/campaigns/:id, POST .../send
 * - State: campaigns, loading
 *
 * Components/Hooks/Exports:
 * - AdminCampaignListPage: Component chính (xuất mặc định)
 */
import { useState, useEffect } from "react";
import { Table, Card, Button, Tag, Typography, Space, Popconfirm, message } from "antd";
import { PlusOutlined, EditOutlined, DeleteOutlined, PlayCircleOutlined, FundOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import api from "../../../api/axios";

const { Title } = Typography;

const statusColors = { DRAFT: "default", SENDING: "processing", DONE: "green" };
const channelColors = { EMAIL: "blue", SMS: "orange" };

export default function AdminCampaignListPage() {
  const navigate = useNavigate();
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(false);

  const fetch = async () => {
    setLoading(true);
    try {
      const res = await api.get("/admin/campaigns");
      setCampaigns(res.data.data);
    } catch { message.error("Không thể tải chiến dịch"); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetch(); }, []);

  const handleDelete = async (id) => {
    try {
      await api.delete(`/admin/campaigns/${id}`);
      message.success("Đã xóa chiến dịch");
      fetch();
    } catch { message.error("Xóa thất bại"); }
  };

  const handleSend = async (id) => {
    try {
      await api.post(`/admin/campaigns/${id}/send`);
      message.success("Chiến dịch đang được gửi");
      fetch();
    } catch (err) { message.error(err.response?.data?.message || "Gửi thất bại"); }
  };

  const columns = [
    { title: "Tên chiến dịch", dataIndex: "name", key: "name" },
    { title: "Kênh", dataIndex: "channel", key: "channel", render: (v) => <Tag color={channelColors[v]}>{v}</Tag> },
    { title: "Gói target", dataIndex: "targetPlans", key: "targetPlans", render: (arr) => arr?.map((p) => <Tag key={p}>{p}</Tag>) },
    { title: "Trạng thái", dataIndex: "status", key: "status", render: (v) => <Tag color={statusColors[v]}>{v}</Tag> },
    { title: "Đã gửi", dataIndex: "sentCount", key: "sentCount" },
    { title: "Ngày tạo", dataIndex: "createdAt", key: "createdAt", render: (d) => d ? new Date(d).toLocaleDateString("vi-VN") : "-" },
    {
      title: "", key: "actions",
      render: (_, r) => (
        <Space>
          <Button icon={<EditOutlined />} size="small" onClick={() => navigate(`/admin/campaigns/${r.id}/edit`)} />
          {r.status === "DRAFT" && (
            <Popconfirm title="Gửi chiến dịch này?" onConfirm={() => handleSend(r.id)}>
              <Button icon={<PlayCircleOutlined />} size="small" type="primary">Gửi</Button>
            </Popconfirm>
          )}
          <Popconfirm title="Xóa chiến dịch?" onConfirm={() => handleDelete(r.id)}>
            <Button icon={<DeleteOutlined />} size="small" danger />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div className="super-admin-page">
      <div className="page-header">
        <Title level={3}><FundOutlined /> Chiến dịch CRM</Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate("/admin/campaigns/new")}>
          Tạo chiến dịch
        </Button>
      </div>
      <Card>
        <Table dataSource={campaigns} columns={columns} rowKey="id" loading={loading} pagination={{ pageSize: 20 }} />
      </Card>
    </div>
  );
}