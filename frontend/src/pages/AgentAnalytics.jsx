/**
 * Frontend: pages/AgentAnalytics.jsx — Thống kê AI Agent
 *
 * Tổng quan:
 * - Trang hiển thị hiệu suất AI Assistant: tổng yêu cầu, độ trễ trung bình,
 *   feedback hài lòng/không hài lòng, lịch sử phiên hội thoại gần đây.
 * - API calls:
 *   - GET /agent/analytics — thống kê tổng quan (totalSessions, avgLatency, feedback)
 *   - GET /agent/sessions — danh sách phiên hội thoại
 * - State / logic chính:
 *   - loading / error: Spin khi đang tải, Card thông báo khi lỗi
 *   - data: object { totalSessions, avgLatency, feedback[] }
 *   - sessions: mảng phiên hội thoại với các cột Thời gian, Câu hỏi, Intent, Trạng thái, Feedback
 *
 * Exports:
 * - AgentAnalytics (default): Component chính
 */
import { useState, useEffect } from 'react';
import { Card, Row, Col, Statistic, Table, Tag, Spin, Typography } from 'antd';
import { RobotOutlined, ClockCircleOutlined } from '@ant-design/icons';
import api from '../api/axios';

const { Title } = Typography;

export default function AgentAnalytics() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadAnalytics();
  }, []);

  const loadAnalytics = async () => {
    setLoading(true);
    try {
      const [analyticsRes, sessionsRes] = await Promise.all([
        api.get('/agent/analytics'),
        api.get('/agent/sessions'),
      ]);
      setData(analyticsRes.data.data);
      setSessions(sessionsRes.data.data || []);
      setError(null);
    } catch (e) {
      setError(e.response?.data?.message || e.message);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 400 }}>
        <Spin size="large" />
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 24 }}>
        <Card>
          <Title level={4}>AI Agent Analytics</Title>
          <p>Chưa có dữ liệu. Hãy bắt đầu sử dụng AI Assistant ở góc dưới bên phải.</p>
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>{error}</p>
        </Card>
      </div>
    );
  }

  const sessionColumns = [
    { title: 'Thời gian', dataIndex: 'createdAt', key: 'createdAt', render: (v) => new Date(v).toLocaleString('vi-VN') },
    { title: 'Câu hỏi', dataIndex: 'userMessage', key: 'userMessage', ellipsis: true },
    {
      title: 'Intent', dataIndex: 'intent', key: 'intent',
      render: (v) => v ? <Tag>{v}</Tag> : <Tag>N/A</Tag>,
    },
    {
      title: 'Trạng thái', dataIndex: 'status', key: 'status',
      render: (v) => {
        const colors = { COMPLETED: 'success', RUNNING: 'processing', FAILED: 'error', CANCELLED: 'default' };
        return <Tag color={colors[v] || 'default'}>{v}</Tag>;
      },
    },
    {
      title: 'Feedback', dataIndex: 'feedback', key: 'feedback',
      render: (fb) => {
        if (!fb || !fb.length) return <Tag>Chưa có</Tag>;
        const thumbsUp = fb.filter(f => f.rating).length;
        const thumbsDown = fb.filter(f => !f.rating).length;
        return <span>{'👍'.repeat(thumbsUp)}{'👎'.repeat(thumbsDown)}</span>;
      },
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <Title level={4} style={{ marginBottom: 24 }}>🤖 AI Agent Performance</Title>

      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={12} sm={6}>
          <Card>
            <Statistic
              title="Tổng yêu cầu (hôm nay)"
              value={data.totalSessions || 0}
              prefix={<RobotOutlined />}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card>
            <Statistic
              title="Độ trễ trung bình"
              value={data.avgLatency ? `${Math.round(data.avgLatency)}ms` : 'N/A'}
              prefix={<ClockCircleOutlined />}
              valueStyle={{ color: data.avgLatency > 1000 ? '#ff4d4f' : '#52c41a' }}
            />
          </Card>
        </Col>
      </Row>

      {/* Feedback stats */}
      {data.feedback && data.feedback.length > 0 && (
        <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
          <Col xs={12}>
            <Card size="small">
              <Statistic
                title="👍 Hài lòng"
                value={data.feedback.find(f => f.rating === true)?._count || 0}
                valueStyle={{ color: '#52c41a' }}
              />
            </Card>
          </Col>
          <Col xs={12}>
            <Card size="small">
              <Statistic
                title="👎 Chưa hài lòng"
                value={data.feedback.find(f => f.rating === false)?._count || 0}
                valueStyle={{ color: '#ff4d4f' }}
              />
            </Card>
          </Col>
        </Row>
      )}

      {/* Sessions table */}
      <Card title="Lịch sử yêu cầu gần đây">
        <Table
          dataSource={sessions}
          columns={sessionColumns}
          rowKey="id"
          pagination={{ pageSize: 10 }}
          size="small"
        />
      </Card>
    </div>
  );
}
