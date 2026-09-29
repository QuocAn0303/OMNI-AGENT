/**
 * Frontend: components/agent-ui/CRMActionCard.jsx — Thẻ xử lý CRM
 *
 * Tổng quan:
 * - Hiển thị thông tin khách hàng cần chăm sóc (sentiment, mô tả)
 * - Cho phép nhập mô tả và tạo task qua AI agent (/agent/chat)
 * - Hiển thị trạng thái sentiment với màu sắc tương ứng
 *
 * Props:
 *   customerId:   string — ID khách hàng
 *   customerName: string — Tên khách hàng
 *   sentiment:    'positive' | 'negative' | 'neutral' — Cảm xúc khách hàng
 *   description:  string — Mô tả task mặc định
 *   priority:     string — Mức ưu tiên (default 'high')
 *
 * Exports:
 *   CRMActionCard: Component chính
 */
import { useState } from 'react';
import { Card, Button, Space, Typography, Tag, message, Input } from 'antd';
import { AlertOutlined, CustomerServiceOutlined } from '@ant-design/icons';
import api from '../../api/axios';

const { Text, Paragraph } = Typography;

export default function CRMActionCard({ customerName, sentiment, description, priority = 'high' }) {
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [customDesc, setCustomDesc] = useState(description || `Gọi điện xin lỗi khách hàng ${customerName}`);

  const handleCreateTask = async () => {
    setLoading(true);
    try {
      // POST /api/agent/chat nhận { messages: [{ role, content }] } — không phải { message, history }
      await api.post('/agent/chat', {
        messages: [{ role: 'user', content: `Tạo task ưu tiên ${priority} cho khách ${customerName}: ${customDesc}` }],
      });
      message.success('✅ Đã tạo task thành công!');
      setDone(true);
    } catch (e) {
      message.error('Lỗi: ' + (e.response?.data?.message || e.message));
    } finally {
      setLoading(false);
    }
  };

  if (done) {
    return (
      <Card size="small" style={{ margin: '8px 0', background: '#f0fff4' }}>
        <Text type="success">✅ Đã tạo task và giao cho Sale</Text>
      </Card>
    );
  }

  const sentimentColor = sentiment === 'negative' ? '#ff4d4f' : sentiment === 'positive' ? '#52c41a' : '#faad14';
  const sentimentLabel = sentiment === 'negative' ? 'Không hài lòng' : sentiment === 'positive' ? 'Hài lòng' : 'Trung tính';

  return (
    <Card
      size="small"
      title={<Space><AlertOutlined style={{ color: sentimentColor }} />Cần xử lý CRM</Space>}
      style={{ margin: '8px 0', borderLeft: `3px solid ${sentimentColor}` }}
    >
      {sentiment && (
        <div style={{ marginBottom: 8 }}>
          <Tag color={sentimentColor}>{sentimentLabel}</Tag>
        </div>
      )}
      <Paragraph style={{ marginBottom: 8 }}>
        <CustomerServiceOutlined style={{ marginRight: 4 }} />
        {customerName
          ? `Khách hàng ${customerName} ${sentiment === 'negative' ? 'có vẻ không hài lòng' : 'cần được chăm sóc'}.`
          : 'Có khách hàng cần được chăm sóc.'}
      </Paragraph>
      <div style={{ marginBottom: 8 }}>
        <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>Mô tả task:</Text>
        <Input
          size="small"
          value={customDesc}
          onChange={(e) => setCustomDesc(e.target.value)}
        />
      </div>
      <Button
        type="primary"
        icon={<CustomerServiceOutlined />}
        loading={loading}
        onClick={handleCreateTask}
        style={{ background: sentimentColor, borderColor: sentimentColor }}
      >
        Tạo Task & Giao cho Sale
      </Button>
    </Card>
  );
}
