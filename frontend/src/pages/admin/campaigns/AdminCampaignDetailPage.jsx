/**
 * Frontend: pages/admin/campaigns/AdminCampaignDetailPage.jsx — Chi tiết chiến dịch CRM
 *
 * Tổng quan:
 * - Xem thông tin chi tiết một chiến dịch: kênh, gói target, nội dung, lịch gửi
 * - API: GET /admin/campaigns/:id
 * - State: campaign, loading
 *
 * Components/Hooks/Exports:
 * - AdminCampaignDetailPage: Component chính (xuất mặc định)
 */
import { useState, useEffect } from "react";
import { Card, Descriptions, Tag, Typography, Button, Spin, message } from "antd";
import { FundOutlined, ArrowLeftOutlined } from "@ant-design/icons";
import { useParams, useNavigate } from "react-router-dom";
import api from "../../../api/axios";

const { Title, Text } = Typography;

const statusColors = { DRAFT: "default", SENDING: "processing", DONE: "green" };
const channelColors = { EMAIL: "blue", SMS: "orange" };

export default function AdminCampaignDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [campaign, setCampaign] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get(`/admin/campaigns/${id}`)
      .then((res) => setCampaign(res.data.data))
      .catch(() => message.error("Không thể tải chi tiết chiến dịch"))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <Spin style={{ display: "block", margin: "48px auto" }} />;
  if (!campaign) return <Text>Không tìm thấy chiến dịch</Text>;

  return (
    <div className="super-admin-page">
      <div className="page-header">
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate("/admin/campaigns")} style={{ marginRight: 12 }}>
          Quay lại
        </Button>
        <Title level={3}><FundOutlined /> {campaign.name}</Title>
      </div>
      <Card>
        <Descriptions column={2} bordered>
          <Descriptions.Item label="Tên chiến dịch">{campaign.name}</Descriptions.Item>
          <Descriptions.Item label="Kênh"><Tag color={channelColors[campaign.channel]}>{campaign.channel}</Tag></Descriptions.Item>
          <Descriptions.Item label="Gói target">{campaign.targetPlans?.map((p) => <Tag key={p}>{p}</Tag>)}</Descriptions.Item>
          <Descriptions.Item label="Trạng thái"><Tag color={statusColors[campaign.status]}>{campaign.status}</Tag></Descriptions.Item>
          <Descriptions.Item label="Đã gửi">{campaign.sentCount}</Descriptions.Item>
          <Descriptions.Item label="Lên lịch">{campaign.scheduledAt ? new Date(campaign.scheduledAt).toLocaleString("vi-VN") : "Không"}</Descriptions.Item>
          <Descriptions.Item label="Tiêu đề" span={2}>{campaign.subject}</Descriptions.Item>
          <Descriptions.Item label="Nội dung" span={2}>
            <div style={{ whiteSpace: "pre-wrap", background: "#f8fafc", padding: 16, borderRadius: 8 }}>{campaign.content}</div>
          </Descriptions.Item>
        </Descriptions>
      </Card>
    </div>
  );
}