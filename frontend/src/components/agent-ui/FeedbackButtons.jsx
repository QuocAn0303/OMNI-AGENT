/**
 * Frontend: components/agent-ui/FeedbackButtons.jsx — Nút đánh giá AI Agent
 *
 * Tổng quan:
 * - Hiển thị nút Like/Dislike để người dùng đánh giá phản hồi của AI
 * - Gọi API /agent/feedback với sessionId và rating (true/false)
 * - Nếu không có sessionId → return null (ẩn component)
 *
 * Props:
 *   sessionId: string — ID phiên chat AI (bắt buộc)
 *
 * Exports:
 *   FeedbackButtons: Component chính
 */
import { useState } from 'react';
import { Space, Button, message } from 'antd';
import { LikeOutlined, DislikeOutlined } from '@ant-design/icons';
import api from '../../api/axios';

export default function FeedbackButtons({ sessionId }) {
  const [submitted, setSubmitted] = useState(null);

  if (!sessionId) return null;

  const handleFeedback = async (rating) => {
    try {
      await api.post('/agent/feedback', { sessionId, rating });
      setSubmitted(rating);
      message.success('Cảm ơn bạn đã đánh giá!');
    } catch {
      // silent fail
    }
  };

  if (submitted !== null) {
    return (
      <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 11, marginTop: 4 }}>
        {submitted ? '👍 Cảm ơn!' : '👎 Chúng tôi sẽ cải thiện!'}
      </div>
    );
  }

  return (
    <div style={{ textAlign: 'center', marginTop: 4 }}>
      <Space size={4}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Hữu ích?</span>
        <Button
          type="text"
          size="small"
          icon={<LikeOutlined />}
          onClick={() => handleFeedback(true)}
          style={{ fontSize: 12 }}
        />
        <Button
          type="text"
          size="small"
          icon={<DislikeOutlined />}
          onClick={() => handleFeedback(false)}
          style={{ fontSize: 12 }}
        />
      </Space>
    </div>
  );
}
