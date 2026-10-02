/**
 * Frontend: components/agent-ui/SmartApprovalCard.jsx — Thẻ phê duyệt thông minh
 *
 * Tổng quan:
 * - Hiển thị yêu cầu phê duyệt khoản chi với thông tin ngân sách
 * - Hỗ trợ 2 cơ chế: human-gates (/api/agent/human-gates) hoặc workflow (/api/workflows)
 * - Cảnh báo khi vượt ngân sách hoặc khoản chi lớn (>50M)
 * - Gọi API để duyệt (APPROVED) hoặc từ chối (REJECTED)
 *
 * Props:
 *   actionSummary:   string — Mô tả khoản chi
 *   expenseId:       string — ID khoản chi (dùng cho workflow)
 *   vendorId:        string — ID nhà cung cấp
 *   amount:          number — Số tiền
 *   budgetRemaining: number — Ngân sách còn lại
 *   gateId:          string — ID human-gate (dùng cho agent)
 *
 * Exports:
 *   SmartApprovalCard: Component chính
 *   formatMoney:       Hàm định dạng tiền tệ VND
 */
import { useState } from 'react';
import { Card, Button, Space, Typography, Tag, message, Modal, Input } from 'antd';
import { CheckOutlined, CloseOutlined, InfoCircleOutlined } from '@ant-design/icons';
import api from '../../api/axios';

const { Text, Paragraph } = Typography;

export default function SmartApprovalCard({ actionSummary, expenseId, amount, budgetRemaining, gateId }) {
  const [loading, setLoading] = useState(false);
  const [decision, setDecision] = useState(null);

  const handleDecision = async (action) => {
    setLoading(true);
    try {
      // Backend dùng HAI hợp đồng khác nhau, dễ nhầm:
      //   POST /api/agent/human-gates/:id/decide  → body { decision, note }
      //       (agent.routes.js:605 đọc req.body.decision)
      //   POST /api/workflows/approvals/:id/decide → body { status, comment }
      //       (workflow.validation.decideSchema) — chú ý có đoạn "approvals/"
      // Component này trước đây gửi { action, note } tới cả hai, nên
      // `decision` luôn là undefined ⇒ server trả 400 ⇒ thẻ duyệt luôn hỏng.
      if (gateId) {
        await api.post(`/api/agent/human-gates/${gateId}/decide`, {
          decision: action,
          note: '',
        });
      } else {
        await api.post(`/api/workflows/approvals/${expenseId}/decide`, {
          status: action,
          comment: '',
        });
      }
      setDecision(action);
      message.success(action === 'APPROVED' ? 'Đã duyệt thành công!' : 'Đã từ chối.');
    } catch (e) {
      message.error('Lỗi: ' + (e.response?.data?.message || e.message));
    } finally {
      setLoading(false);
    }
  };

  if (decision) {
    return (
      <Card size="small" style={{ margin: '8px 0', background: decision === 'APPROVED' ? '#f0fff4' : '#fff5f5' }}>
        <Text type={decision === 'APPROVED' ? 'success' : 'danger'}>
          {decision === 'APPROVED' ? '✅ Đã duyệt' : '❌ Đã từ chối'}
        </Text>
      </Card>
    );
  }

  const isLargeAmount = amount > 50000000;

  return (
    <Card
      size="small"
      title={<Space><InfoCircleOutlined style={{ color: '#faad14' }} />Cần phê duyệt</Space>}
      style={{ margin: '8px 0', borderLeft: '3px solid #faad14' }}
    >
      <Paragraph>{actionSummary || `Khoản chi ${formatMoney(amount)} này cần được duyệt.`}</Paragraph>
      {budgetRemaining !== undefined && (
        <div style={{ marginBottom: 12 }}>
          <Text type="secondary">Ngân sách còn lại: </Text>
          <Text strong style={{ color: budgetRemaining >= amount ? '#52c41a' : '#ff4d4f' }}>
            {formatMoney(budgetRemaining)}
          </Text>
          {budgetRemaining < amount && (
            <div>
              <Tag color="error" style={{ marginTop: 4 }}>Vượt ngân sách!</Tag>
            </div>
          )}
        </div>
      )}
      {isLargeAmount && (
        <div style={{ marginBottom: 12 }}>
          <Tag color="warning" icon={<InfoCircleOutlined />}>Khoản chi lớn, cần xem xét kỹ</Tag>
        </div>
      )}
      <Space>
        <Button
          type="primary"
          icon={<CheckOutlined />}
          loading={loading}
          onClick={() => handleDecision('APPROVED')}
          style={{ background: '#52c41a', borderColor: '#52c41a' }}
        >
          Duyệt ngay
        </Button>
        <Button
          danger
          icon={<CloseOutlined />}
          loading={loading}
          onClick={() => handleDecision('REJECTED')}
        >
          Từ chối
        </Button>
      </Space>
    </Card>
  );
}

function formatMoney(amount) {
  if (!amount) return '0₫';
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(Number(amount));
}
