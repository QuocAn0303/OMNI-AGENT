/**
 * Frontend: pages/AgentApprovals.jsx — Màn hình duyệt đề xuất của agent
 *
 * Tối thiểu cho luồng demo (T12): danh sách đề xuất PENDING + các đề xuất đã
 * duyệt nhưng PO chưa tạo được (trạng thái lơ lửng). Mọi quyết định đi qua
 * human-gate ở backend — trang này KHÔNG có đường tắt, không có nút "duyệt hàng
 * loạt". Người duyệt tự nhập số lượng mua, độc lập với số gợi ý.
 *
 * Điểm cần biết: `/api/agent/human-gates` chỉ trả gate `PENDING`, nên phần
 * "trạng thái lơ lửng" không lấy được từ endpoint đó. Trang này vì vậy đánh dấu
 * rõ phần đó là **chưa có đường đọc** (xem `KNOWN_GAPS` bên dưới) thay vì giả vờ
 * nó có. Sửa ở gói sau cần một endpoint listing theo trạng thái.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Card, Col, Empty, Row, Skeleton, Tag, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { getPendingGates } from '../api/agentGates';
import SmartApprovalCard from '../components/agent-ui/SmartApprovalCard';

const { Text } = Typography;

const PO_PROPOSAL = 'PURCHASE_ORDER_PROPOSAL';

/** Khoảng trống đã biết, nói thẳng thay vì giấu. */
const KNOWN_GAPS = [
  'Chỉ thấy đề xuất đang chờ (PENDING). Đề xuất đã duyệt nhưng PO chưa tạo được (trạng thái lơ lửng) chưa có endpoint đọc — phải vào Prisma Studio.',
  'Số tiền hiển thị theo đơn vị tiền của dataset (GBP cho tenant mô phỏng); hệ thống không quy đổi.',
];

export default function AgentApprovals() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [gates, setGates] = useState([]);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await getPendingGates();
      setGates((Array.isArray(rows) ? rows : []).filter((g) => g.actionType === PO_PROPOSAL));
      setError(null);
    } catch (e) {
      setError(e.response?.data?.message || e.message || 'Không tải được danh sách');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div style={{ padding: 24 }}>
      <Card
        title="Đề xuất cần bạn duyệt"
        extra={
          <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>
            Làm mới
          </Button>
        }
      >
        <Row gutter={[16, 16]}>
          <Col xs={24} lg={16}>
            {loading && gates.length === 0 && <Skeleton active paragraph={{ rows: 4 }} />}
            {!loading && error && (
              <Alert type="error" showIcon message="Không tải được danh sách đề xuất" description={error} />
            )}
            {!loading && !error && gates.length === 0 && (
              <Empty description="Không có đề xuất nào đang chờ" />
            )}
            {gates.map((g) => (
              <SmartApprovalCard key={g.id} gate={g} onDone={load} />
            ))}
          </Col>
          <Col xs={24} lg={8}>
            <Card size="small" title="Giới hạn đã biết" type="info">
              {KNOWN_GAPS.map((t) => (
                <Text key={t} style={{ display: 'block', marginBottom: 8 }}>
                  • {t}
                </Text>
              ))}
            </Card>
            <Card size="small" title="Ai được quyết định" style={{ marginTop: 16 }}>
              <Text>
                Chỉ ADMIN/MANAGER. Mọi quyết định đều ghi lại ai quyết lúc nào, kèm lý do nếu từ
                chối. Hệ thống không tự tạo PO.
              </Text>
              <div style={{ marginTop: 8 }}>
                <Tag color="orange">Không duyệt hàng loạt</Tag>
                <Tag color="orange">{t('purchaseDecision.humanDecides')}</Tag>
              </div>
            </Card>
          </Col>
        </Row>
      </Card>
    </div>
  );
}
