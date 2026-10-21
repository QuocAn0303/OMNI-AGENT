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
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Card, Descriptions, Divider, Input, InputNumber, Modal, Space, Statistic, Tag, Typography, message } from 'antd';
import {
  CheckOutlined,
  CloseOutlined,
  ClockCircleOutlined,
  ExclamationCircleOutlined,
  ReloadOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { decideGate, retryGateExecution } from '../../api/agentGates';
import { explainProposal } from '../../api/replenishmentRules';

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
/**
 * Khối "AI diễn giải & soạn tin NCC" + trạng thái hàng rào số.
 *
 * Đây là nơi duy nhất trên giao diện cho thấy ranh giới vai trò LLM:
 * AI được VIẾT LỜI, không được ĐỔI SỐ. Trạng thái hàng rào hiện ngay dưới
 * văn bản, kèm số gốc và số bị bắt khi chế độ biểu diễn chạy.
 *
 * KHÔNG dùng icon cho hai nhãn hàng rào: chữ thuần để trích chép lên slide
 * không bị vỡ khi sao chép.
 */
function AiExplainBlock({ block, onExplain, onTamper, busy, quantity, quantityValid, draftError }) {
  const { t } = useTranslation();
  if (!block) {
    return (
      <Space wrap style={{ marginTop: 12 }}>
        <Button onClick={onExplain} loading={busy}>
          AI Giải thích và Soạn tin NCC
        </Button>
        <Button onClick={onTamper} loading={busy}>
          Test Chốt chặn AI sửa số
        </Button>
        <Text type="secondary" style={{ fontSize: 12 }}>
          AI chỉ diễn giải con số của công thức, không được tự tính hoặc sửa số.
        </Text>
      </Space>
    );
  }

  const g = block.guardrail || {};
  const tampered = block.simulateTamper === true;
  const draftReady = quantityValid && block.selectedQuantity === quantity;

  return (
    <div style={{ marginTop: 12, padding: 12, border: '1px solid #f0f0f0', borderRadius: 8 }}>
      <Space direction="vertical" size={8} style={{ width: '100%' }}>
        <Space wrap>
          <Text strong>Giải thích đề xuất</Text>
          <Tag color={block.explanationSource === 'llm' ? 'blue' : 'default'}>
            nguồn: {block.explanationSource === 'llm' ? 'LLM' : 'mẫu (LLM không khả dụng)'}
          </Tag>
          <Text type="secondary" style={{ fontSize: 12 }}>
            chế độ LLM: {block.llmMode}
          </Text>
        </Space>
        <Paragraph style={{ marginBottom: 0 }}>{block.explanation}</Paragraph>

        <Divider style={{ margin: '4px 0' }} />

        <Space wrap>
          <Text strong>Tin nhắn đặt hàng gửi nhà cung cấp</Text>
          <Tag color="default">chỉ soạn — chưa gửi</Tag>
        </Space>
        {draftReady ? (
          <Paragraph
            copyable={{ text: block.vendorMessage, tooltips: ['Sao chép tin nhắn', 'Đã sao chép'] }}
            style={{ marginBottom: 0, whiteSpace: 'pre-wrap' }}
          >
            {block.vendorMessage}
          </Paragraph>
        ) : (
          <Text type={draftError ? 'danger' : 'secondary'}>
            {draftError || t(quantityValid ? 'purchaseDecision.updating' : 'purchaseDecision.enterToDraft')}
          </Text>
        )}
        {draftReady && (
          <Text type="secondary">{t('purchaseDecision.draftQuantity', { quantity })}</Text>
        )}

        <Divider style={{ margin: '4px 0' }} />

        <Space direction="vertical" size={4} style={{ width: '100%' }}>
          <Text strong>Hàng rào số — assertNumbersUnchanged</Text>
          {tampered ? (
            <Tag color="error">
              ĐÃ CHẶN AI SỬA SỐ: phát hiện LLM đổi số lượng ({g.originalNumber} thành{' '}
              {g.tamperedNumber}) — đã bác bỏ và khôi phục số chuẩn từ công thức
            </Tag>
          ) : (
            <Tag color="success">
              assertNumbersUnchanged: ĐÃ KIỂM CHỨNG — AI giữ nguyên số liệu công thức
            </Tag>
          )}
          <Text type="secondary" style={{ fontSize: 12 }}>
            Số do công thức tính, đã kiểm:{' '}
            {(g.checkedNumbers || [])
              .map((n) => `${n.truong}=${n.giaTri}`)
              .join(' · ') || 'không có'}
          </Text>
          {(g.inventedNumbers || []).length > 0 && (
            <Text type="danger" style={{ fontSize: 12 }}>
              Số bị loại khỏi văn bản: {(g.inventedNumbers || []).join(', ')}
            </Text>
          )}
          {block.tamperedSample && (
            <Paragraph
              style={{
                marginBottom: 0,
                fontSize: 12,
                padding: 8,
                background: '#fffbe6',
                border: '1px dashed #ffd591',
                borderRadius: 4,
                whiteSpace: 'pre-wrap',
              }}
            >
              <Text type="secondary" style={{ fontSize: 12 }}>
                Văn bản bị bác (mô phỏng):{' '}
              </Text>
              {block.tamperedSample}
            </Paragraph>
          )}
          <Space wrap>
            <Button size="small" onClick={onExplain} disabled={busy}>
              Chạy lại chế độ thường
            </Button>
            <Button size="small" onClick={onTamper} disabled={busy}>
              Chạy lại test chốt chặn
            </Button>
          </Space>
        </Space>
      </Space>
    </div>
  );
}

/**
 * Thẻ duyệt đề xuất PO của agent.
 *
 * Ngoài việc duyệt/từ chối (vốn đã có), thẻ nay có thêm khối AI diễn giải +
 * soạn tin NCC + trạng thái hàng rào `assertNumbersUnchanged` — xem
 * `AiExplainBlock` ở trên.
 */
export default function SmartApprovalCard({ gate, onDone }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiBlock, setAiBlock] = useState(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectNote, setRejectNote] = useState('');
  const [ackDrift, setAckDrift] = useState(false);
  const [result, setResult] = useState(null);
  const [block, setBlock] = useState(null);
  const [quantity, setQuantity] = useState(null);
  const [draftError, setDraftError] = useState(null);

  const payload = gate?.actionPayload || {};
  const item = Array.isArray(payload.items) ? payload.items[0] : null;
  const rationale = payload.rationale || {};
  const age = useMemo(() => ageOf(gate?.createdAt), [gate?.createdAt]);
  const quantityValid = Number.isInteger(quantity) && quantity > 0 && quantity <= 2147483647;
  const aiOpened = !!aiBlock;
  const draftStale = !!aiBlock && aiBlock.selectedQuantity !== quantity;

  // Hide the previous draft immediately while refreshing. Ignore late responses
  // so changing the quantity quickly cannot restore an obsolete message.
  useEffect(() => {
    if (!aiOpened || !quantityValid || !draftStale || aiBusy) return;
    let active = true;
    const timer = setTimeout(async () => {
      try {
        const next = await explainProposal(gate.id, { quantity, mode: 'template' });
        if (active) {
          setAiBlock((previous) => ({
            ...previous,
            selectedQuantity: next.selectedQuantity,
            selectedTotal: next.selectedTotal,
            vendorMessage: next.vendorMessage,
            vendorMessageSource: next.vendorMessageSource,
          }));
          setDraftError(null);
        }
      } catch (error) {
        if (active) setDraftError(error.response?.data?.message || error.message);
      }
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [gate.id, quantity, quantityValid, draftStale, aiBusy, aiOpened]);

  if (!item) return null;

  const decided = gate?.status && gate.status !== 'PENDING';
  const missingCost = payload.missingCost === true;
  const stuck = gate?.status === 'APPROVED' && !gate?.resultRef;

  const submit = async (decision, note) => {
    if (decision === 'APPROVED' && !quantityValid) {
      message.warning(t('purchaseDecision.invalid'));
      return;
    }
    setBusy(true);
    setBlock(null);
    try {
      const res = await decideGate(gate.id, {
        decision,
        note,
        // `acknowledgeDrift` CHỈ có tác dụng ở nhánh DRIFT_BLOCK. Gửi luôn
        // `false` mặc định để không vô tình bỏ qua một lần chặn nào khác.
        acknowledgeDrift: decision === 'APPROVED' ? ackDrift : false,
        ...(decision === 'APPROVED' ? { quantity } : {}),
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

  /**
   * Gọi AI diễn giải + soạn tin NCC.
   *
   * `simulateTamper=true` là chế độ biểu diễn: backend cố tình đổi số lượng rồi
   * đưa qua hàng rào thật để chứng minh nó bắt được. Không gọi mạng.
   */
  const runAi = async (simulateTamper) => {
    setAiBusy(true);
    try {
      const res = await explainProposal(gate.id, { simulateTamper, ...(quantityValid ? { quantity } : {}) });
      setAiBlock(res);
      setDraftError(null);
      message.success(
        simulateTamper
          ? 'Đã chạy test hàng rào: xem trạng thái bên dưới.'
          : 'Đã sinh lời giải thích và tin nhắn NCC.',
      );
    } catch (e) {
      setAiBlock(null);
      message.error(e.response?.data?.message || e.message || 'Lỗi');
    } finally {
      setAiBusy(false);
    }
  };

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
        <Text type="secondary">{t('purchaseDecision.suggested')} </Text>
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

      <Space direction="vertical" size={4} style={{ display: 'flex', margin: '12px 0' }}>
        <label htmlFor={`purchase-quantity-${gate.id}`}>
          <Text strong>{t('purchaseDecision.label')}</Text>
        </label>
        <InputNumber
          id={`purchase-quantity-${gate.id}`}
          min={1}
          max={2147483647}
          step={1}
          value={quantity}
          onChange={(value) => { setQuantity(value); setDraftError(null); setAckDrift(false); }}
          placeholder={t('purchaseDecision.placeholder')}
          disabled={busy || aiBusy || decided}
          status={quantity !== null && !quantityValid ? 'error' : undefined}
          style={{ width: '100%', maxWidth: 360 }}
        />
        <Text type="secondary">{t('purchaseDecision.help')}</Text>
        {quantityValid && (
          <Text strong>{t('purchaseDecision.total', { total: money(quantity * Number(item.unitCost)) })}</Text>
        )}
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
          description={t('purchaseDecision.driftHelp')}
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

      <AiExplainBlock
        block={aiBlock}
        busy={aiBusy}
        onExplain={() => runAi(false)}
        onTamper={() => runAi(true)}
        quantity={quantity}
        quantityValid={quantityValid}
        draftError={draftError}
      />

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
              disabled={decided || aiBusy || !quantityValid || block?.drift === 'NO_LONGER_NEEDED'}
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

