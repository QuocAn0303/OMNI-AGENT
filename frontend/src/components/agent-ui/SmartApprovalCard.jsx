/**
 * Frontend: components/agent-ui/SmartApprovalCard.jsx — Thẻ duyệt đề xuất PO của agent
 *
 * ============================================================================
 * VÌ SAO TÁI DỰNG THẺ NÀY (T12)
 * ============================================================================
 * Thẻ cũ chỉ có "Duyệt ngay / Từ chối" và gửi `note: ''` cho cả hai nhánh. Với
 * đề xuất PO điều đó **hỏng theo ba cách**:
 *   1. Từ chối mà không có lý do ⇒ server trả 400 (đúng, nhưng thẻ báo lỗi kỹ
 *      thuật chứ không hỏi lý do); người sau không biết vì sao phải sửa.
 *   2. `acknowledgeDrift` KHÔNG bao giờ được gửi ⇒ khi dữ liệu đã đổi (DRIFT_BLOCK)
 *      người duyệt không có cách nào đi tiếp trừ khi gọi tay API.
 *   3. Không hiện `diff`, `missingCost`, tuổi đề xuất, mã PO sau khi duyệt ⇒
 *      người duyệt bấm "duyệt" mà không biết mình duyệt cái gì.
 *
 * Mọi trạng thái hiển thị đều lấy từ `gate.actionPayload` do backend sinh ra — thẻ
 * KHÔNG tự tính lại ROP/ATP/số lượng. Nếu thẻ tính khác backend thì người duyệt
 * nhìn thấy một con số rồi hệ thống lại dùng con số khác ⇒ tin không đáng tin.
 *
 * Hợp đồng API: xem `src/api/agentGates.js`.
 */
import { useMemo, useState } from 'react';
import { Alert, Button, Card, Descriptions, Input, Modal, Space, Statistic, Tag, Typography, message } from 'antd';
import {
  CheckOutlined,
  CloseOutlined,
  ClockCircleOutlined,
  ExclamationCircleOutlined,
  ReloadOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { decideGate, retryGateExecution } from '../../api/agentGates';

const { Paragraph, Text } = Typography;

const PO_PROPOSAL = 'PURCHASE_ORDER_PROPOSAL';

/** Tiền tệ của dataset demo là GBP; đơn vị hiển thị lấy từ server nếu có. */
const money = (v, currency = 'VND') => {
  const n = Number(v || 0);
  return `${n.toLocaleString('vi-VN', { maximumFractionDigits: 2 })} ${currency}`;
};

/** Tuổi đề xuất: "vừa xong" / "3 giờ" / "2 ngày" — quá 24h thì cảnh báo. */
const ageOf = (iso) => {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const min = Math.floor(ms / 60000);
  if (min < 1) return { text: 'vừa xong', minutes: 0, stale: false };
  if (min < 60) return { text: `${min} phút`, minutes: min, stale: false };
  const hours = Math.floor(min / 60);
  if (hours < 24) return { text: `${hours} giờ`, minutes: min, stale: hours >= 6 };
  return { text: `${Math.floor(hours / 24)} ngày`, minutes: min, stale: true };
};

/** Bảng diff lúc người duyệt nhìn thấy vs. tính lại lúc bấm duyệt. */
function DriftDiff({ diff }) {
  if (!diff) return null;
  const rows = [
    { key: 'orderQty', label: 'Số lượng', p: diff.orderQty?.proposed, c: diff.orderQty?.current, pct: diff.orderQty?.relDrift },
    { key: 'unitCost', label: 'Đơn giá', p: diff.unitCost?.proposed, c: diff.unitCost?.current, pct: diff.unitCost?.relDrift },
    { key: 'atp', label: 'ATP', p: diff.atp?.proposed, c: diff.atp?.current },
    { key: 'rop', label: 'ROP', p: diff.rop?.proposed, c: diff.rop?.current },
  ].filter((r) => r.p !== undefined || r.c !== undefined);
  if (!rows.length) return null;
  return (
    <Descriptions size="small" column={4} bordered style={{ marginTop: 8 }}>
      {rows.map((r) => (
        <Descriptions.Item key={r.key} label={r.label}>
          {r.p === null ? <Text type="secondary">chưa có</Text> : money(r.p)}
          {' → '}
          {r.c === null ? <Text type="secondary">chưa có</Text> : <Text strong>{money(r.c)}</Text>}
          {typeof r.pct === 'number' && r.pct > 0 && (
            <Text type="danger"> ({Math.round(r.pct * 100)}%)</Text>
          )}
        </Descriptions.Item>
      ))}
    </Descriptions>
  );
}

/**
 * @param {object}   props.gate    — bản ghi `AgentHumanGate` (PENDING hoặc APPROVED)
 * @param {Function} props.onDone  — callback sau khi quyết định xong (để list refresh)
 */
export default function SmartApprovalCard({ gate, onDone }) {
  const [busy, setBusy] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectNote, setRejectNote] = useState('');
  const [ackDrift, setAckDrift] = useState(false);
  const [result, setResult] = useState(null);
  const [block, setBlock] = useState(null);

  const payload = gate?.actionPayload || {};
  const item = Array.isArray(payload.items) ? payload.items[0] : null;
  const rationale = payload.rationale || {};
  const age = useMemo(() => ageOf(gate?.createdAt), [gate?.createdAt]);

  if (!item) return null;

  const decided = gate?.status && gate.status !== 'PENDING';
  const missingCost = payload.missingCost === true;
  const stuck = gate?.status === 'APPROVED' && !gate?.resultRef;

  const submit = async (decision, note) => {
    setBusy(true);
    setBlock(null);
    try {
      const res = await decideGate(gate.id, {
        decision,
        note,
        // `acknowledgeDrift` CHỈ có tác dụng ở nhánh DRIFT_BLOCK. Gửi luôn
        // `false` mặc định để không vô tình bỏ qua một lần chặn nào khác.
        acknowledgeDrift: decision === 'APPROVED' ? ackDrift : false,
      });
      setResult({ decision, po: res?.po || null });
      message.success(res?.message || (decision === 'APPROVED' ? 'Đã phê duyệt' : 'Đã từ chối'));
      onDone?.(gate.id);
    } catch (e) {
      const d = e.response?.data;
      // 409 mang `details` (code/drift/diff/missingCost) — không có nó thì không
      // hiện được bảng diff, chỉ còn một dòng lỗi kỹ thuật.
      if (e.response?.status === 409 && d?.details) {
        setBlock(d.details);
      }
      message.error(d?.message || e.message || 'Lỗi');
    } finally {
      setBusy(false);
    }
  };

  const retry = async () => {
    setBusy(true);
    try {
      const res = await retryGateExecution(gate.id, { acknowledgeDrift: ackDrift });
      setResult({ decision: 'APPROVED', po: res });
      message.success(res?.message || 'Đã tạo PO');
      onDone?.(gate.id);
    } catch (e) {
      message.error(e.response?.data?.message || e.message || 'Lỗi');
    } finally {
      setBusy(false);
    }
  };

  const confirmReject = () => {
    if (!rejectNote.trim()) {
      message.warning('Từ chối đề xuất cần nhập lý do — người sau cần biết phải sửa gì.');
      return;
    }
    setRejectOpen(false);
    submit('REJECTED', rejectNote.trim());
  };

  const title = payload.productName || item.sku || 'Đề xuất nhập hàng';

  return (
    <Card
      size="small"
      title={
        <Space wrap>
          <ExclamationCircleOutlined style={{ color: '#faad14' }} />
          <span>{title}</span>
          {age && (
            <Tag icon={<ClockCircleOutlined />} color={age.stale ? 'warning' : 'default'}>
              {age.text} trước
            </Tag>
          )}
          {missingCost && <Tag color="error">chưa có giá vốn</Tag>}
        </Space>
      }
      style={{ margin: '8px 0', borderLeft: `3px solid ${missingCost ? '#ff4d4f' : '#faad14'}` }}
    >
      <Paragraph style={{ marginBottom: 8 }}>
        <Text strong>{item.quantity}</Text> × <Text strong>{money(item.unitCost)}</Text>
        {' = '}
        <Text strong>{money(payload.totalEstimate)}</Text>
        {' từ '}
        {payload.vendorName || 'NCC'}
      </Paragraph>

      <Space size="small" wrap style={{ marginBottom: 8 }}>
        <Statistic title="ATP" value={rationale.atp ?? '—'} valueStyle={{ fontSize: 14 }} />
        <Statistic title="ROP" value={rationale.rop ?? '—'} valueStyle={{ fontSize: 14 }} />
        <Statistic
          title="Lead time"
          value={rationale.leadTimeDays ?? '—'}
          suffix={rationale.leadTimeEstimated ? 'ngày (ước lượng)' : 'ngày (đo được)'}
          valueStyle={{ fontSize: 14 }}
        />
        <Statistic
          title="Nhu cầu/ngày"
          value={rationale.demandPerDay ?? '—'}
          valueStyle={{ fontSize: 14 }}
        />
      </Space>

      {missingCost && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 8 }}
          message="SKU chưa có giá vốn dùng được"
          description="Hệ thống sẽ KHÔNG tạo PO (tổng tiền sẽ sai). Thêm giá vốn cho SKU rồi duyệt lại. Cờ này không thể bỏ qua bằng xác nhận."
        />
      )}

      {age?.stale && !decided && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 8 }}
          message={`Đề xuất đã ${age.text} tuổi`}
          description="Số liệu chắc chắn đã cũ. Hãy bấm Duyệt để hệ thống tính lại và báo độ lệch nếu có."
        />
      )}

      {block?.missingCost && !missingCost && (
        <Alert type="error" showIcon style={{ marginBottom: 8 }} message={block.code === 'MISSING_COST' ? 'SKU vừa mất giá vốn' : 'Bị chặn'}
          description="Dữ liệu đã đổi so với lúc đề xuất (xem bảng bên dưới). Thêm giá vốn cho SKU rồi thử lại." />
      )}

      {block && !block.missingCost && (
        <Alert
          type={block.drift === 'DRIFT_BLOCK' ? 'error' : 'warning'}
          showIcon
          style={{ marginBottom: 8 }}
          message={
            block.drift === 'DRIFT_BLOCK'
              ? 'Dữ liệu đã đổi quá ngưỡng — cần xác nhận có chủ đích'
              : block.drift === 'DRIFT_WARN'
                ? 'Dữ liệu đã đổi nhẹ'
                : 'Bị chặn'
          }
          description={
            block.drift === 'NO_LONGER_NEEDED'
              ? 'SKU không còn cần nhập. Chỉ có thể Từ chối — không có đường override.'
              : 'Số lúc đề xuất và số tính lại lúc duyệt không khớp.'
          }
        />
      )}

      <DriftDiff diff={block?.diff} />

      {block?.drift === 'DRIFT_BLOCK' && (
        <Alert
          type="info"
          showIcon
          style={{ marginTop: 8 }}
          message={
            <Space>
              <input
                type="checkbox"
                id={`ack-${gate.id}`}
                checked={ackDrift}
                onChange={(ev) => setAckDrift(ev.target.checked)}
              />
              <label htmlFor={`ack-${gate.id}`}>
                Tôi xem diff ở trên và vẫn mua đúng số lượng này
              </label>
            </Space>
          }
          description="Đây là xác nhận của người, không phải override của hệ thống. PO sẽ dùng đúng số lượng trong đề xuất đã bị lệch."
        />
      )}

      {stuck && (
        <Alert
          type="error"
          showIcon
          style={{ marginTop: 8 }}
          message="Đã duyệt nhưng PO chưa tạo được (trạng thái lơ lửng)"
          description="Hệ thống không tự retry: PO là hành động tài chính. Bấm nút dưới để thử lại — lần này sẽ kiểm tra lại dữ liệu từ đầu."
        />
      )}

      {result && (
        <Alert
          type={result.decision === 'APPROVED' ? 'success' : 'info'}
          showIcon
          style={{ marginTop: 8 }}
          message={
            result.decision === 'APPROVED'
              ? result.po?.poCode
                ? `Đã tạo PO ${result.po.poCode} (${money(result.po.total)})`
                : 'Đã phê duyệt'
              : 'Đã từ chối'
          }
        />
      )}

      <Space wrap style={{ marginTop: 12 }}>
        {stuck ? (
          <Button type="primary" icon={<ReloadOutlined />} loading={busy} onClick={retry}>
            Thử lại tạo PO
          </Button>
        ) : (
          <>
            <Button
              type="primary"
              icon={<CheckOutlined />}
              loading={busy}
              disabled={decided || block?.drift === 'NO_LONGER_NEEDED'}
              onClick={() => submit('APPROVED', 'Duyệt qua màn hình duyệt')}
            >
              Duyệt
            </Button>
            <Button
              danger
              icon={<CloseOutlined />}
              loading={busy}
              disabled={decided}
              onClick={() => setRejectOpen(true)}
            >
              Từ chối
            </Button>
          </>
        )}
      </Space>

      {gate?.status === 'REJECTED' && gate.decisionNote && (
        <Paragraph style={{ marginTop: 8 }}>
          <Text type="secondary">Lý do từ chối: </Text>
          {gate.decisionNote}
        </Paragraph>
      )}

      <Modal
        open={rejectOpen}
        title="Từ chối đề xuất"
        okText="Từ chối"
        okButtonProps={{ danger: true, disabled: !rejectNote.trim() }}
        cancelText="Huỷ"
        onOk={confirmReject}
        onCancel={() => setRejectOpen(false)}
      >
        <Paragraph>
          <WarningOutlined style={{ color: '#faad14' }} /> Lý do bắt buộc — người xử lý sau cần biết
          phải sửa gì.
        </Paragraph>
        <Input.TextArea
          rows={3}
          value={rejectNote}
          onChange={(e) => setRejectNote(e.target.value)}
          placeholder="Ví dụ: giá niêm yết đã tăng, đặt lại số lượng / NCC chưa phản hồi…"
        />
      </Modal>
    </Card>
  );
}

