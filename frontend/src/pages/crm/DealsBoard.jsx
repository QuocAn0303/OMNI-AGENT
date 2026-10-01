/**
 * Frontend: src/pages/crm/DealsBoard.jsx — Kanban deal (kéo-thả đổi giai đoạn)
 *
 * Tổng quan:
 * - Dữ liệu: `GET /crm/deals/board?includeClosed=1` → `{ columns[], summary }`
 *   (cột cuối có thể là cột tổng hợp "Chưa phân giai đoạn" với `stage.id = null`).
 * - Kéo thẻ sang cột khác → `PATCH /crm/deals/:id/stage` với `{ stageId, lostReason? }`.
 *   Backend trả 400 nếu chuyển sang giai đoạn `kind=LOST` mà chưa có lý do thua
 *   → modal hỏi lý do rồi gọi lại.
 * - Optimistic update: thẻ nhảy sang cột đích ngay; lỗi thì refetch để rollback.
 * - Cột WON/LOST bị khoá kéo (chỉ đổi được từ trang chi tiết deal) và cột
 *   "Chưa phân giai đoạn" cũng khoá — tránh vô tình gỡ giai đoạn.
 * - Tổng quan trên đầu: số deal, tổng giá trị pipeline, giá trị có trọng số
 *   (Σ value × probability/100).
 *
 * Exports: DealsBoard (default)
 */
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button, Switch, Space, Modal, Form, Input, message, Spin, Tooltip, Alert } from "antd";
import {
  AppstoreOutlined, UnorderedListOutlined, ReloadOutlined, TeamOutlined,
  RiseOutlined, BarChartOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import PageHeader from "../../components/layout/PageHeader";
import StatCard from "../../components/shared/StatCard";
import MoneyDisplay from "../../components/shared/MoneyDisplay";
import KanbanBoard from "../../components/crm/KanbanBoard";
import { getDealBoard, changeDealStage } from "../../api/crm";
import { DEAL_KIND_META, shortMoney, UNASSIGNED_KEY, colKey } from "../../components/crm/constants";

export default function DealsBoard() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [board, setBoard] = useState({ columns: [], summary: {} });
  const [loading, setLoading] = useState(true);
  const [includeClosed, setIncludeClosed] = useState(false);
  const [pending, setPending] = useState({ card: null, destId: null });
  const [lostOpen, setLostOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lostForm] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setBoard(await getDealBoard(includeClosed));
    } catch (err) {
      message.error(err?.response?.data?.message || t("crmPipeline.common.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [includeClosed, t]);

  useEffect(() => { load(); }, [load]);

  const moveCard = useCallback(
    async (cardId, destStageId, destIndex) => {
      const card = board.columns.flatMap((c) => c.items || []).find((d) => d.id === cardId);
      if (!card) return;
      const destKey = colKey(destStageId);

      // Optimistic: chuyển thẻ sang cột đích ngay
      setBoard((prev) => ({
        ...prev,
        columns: prev.columns.map((c) => {
          const items = (c.items || []).filter((d) => d.id !== cardId);
          if (colKey(c.id) !== destKey) return { ...c, items };
          const next = [...items];
          next.splice(Math.min(destIndex, next.length), 0, { ...card, stageId: destStageId });
          return { ...c, items: next };
        }),
      }));

      try {
        await changeDealStage(cardId, { stageId: destStageId });
        message.success(t("crmPipeline.dealsBoard.stageSuccess", { name: card.dealName }));
        load();
      } catch (err) {
        const status = err?.response?.status;
        const msg = err?.response?.data?.message || "";
        // Backend bắt buộc lý do thua → hỏi rồi gọi lại
        if (status === 400 && /lý do thua/i.test(msg)) {
          setPending({ card, destId: destStageId });
          setLostOpen(true);
          return;
        }
        message.error(msg || t("crmPipeline.common.saveFailed"));
        load();
      }
    },
    [board.columns, load, t],
  );

  const onDragEnd = async (result) => {
    const { source, destination, draggableId } = result;
    // Thả ra ngoài vùng board → huỷ
    if (!destination) return;
    if (source.droppableId === destination.droppableId && source.index === destination.index) return;

    const destStageId = destination.droppableId === UNASSIGNED_KEY ? null : destination.droppableId;
    const destCol = board.columns.find((c) => colKey(c.id) === destination.droppableId);

    // Cột "Chưa phân giai đoạn": gỡ stage phải làm từ trang chi tiết
    if (destination.droppableId === UNASSIGNED_KEY) {
      message.info(t("crmPipeline.dealsBoard.unassignedHint"));
      load();
      return;
    }
    // Cột WON/LOST: deal đã đóng — không cho kéo qua lại từ kanban
    if (destCol?.kind && destCol.kind !== "ONGOING") {
      message.warning(t("crmPipeline.dealsBoard.closedLocked"));
      load();
      return;
    }

    await moveCard(draggableId, destStageId, destination.index);
  };

  const confirmLost = async () => {
    try {
      const values = await lostForm.validateFields();
      setSaving(true);
      await changeDealStage(pending.card.id, {
        stageId: pending.destId,
        lostReason: values.lostReason,
      });
      message.success(t("crmPipeline.dealsBoard.lostOk"));
      setLostOpen(false);
      lostForm.resetFields();
      load();
    } catch (err) {
      if (err?.errorFields) return;
      message.error(err?.response?.data?.message || t("crmPipeline.common.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const renderCard = (deal) => {
    const overdue =
      deal.kind === "ONGOING" &&
      deal.expectedCloseDate &&
      dayjs(deal.expectedCloseDate).isBefore(dayjs());
    return (
      <>
        <div className="kanban-card__title">{deal.dealName}</div>
        <div className="kanban-card__value">
          <MoneyDisplay value={deal.value ?? 0} short />
        </div>
        {(deal.organization?.name || deal.contact?.fullName) && (
          <div className="kanban-card__meta">
            <span>{deal.organization?.name || deal.contact?.fullName}</span>
          </div>
        )}
        <div className="kanban-card__foot">
          {deal.kind !== "ONGOING" && (
            <span style={{ fontSize: 11, fontWeight: 600, color: DEAL_KIND_META[deal.kind]?.color }}>
              {t(DEAL_KIND_META[deal.kind]?.labelKey || "")}
            </span>
          )}
          {deal.kind === "ONGOING" && deal.probability > 0 && (
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{deal.probability}%</span>
          )}
          {overdue && (
            <Tooltip title={t("crmPipeline.dealsBoard.overdueTip", { date: dayjs(deal.expectedCloseDate).format("DD/MM/YYYY") })}>
              <span style={{ fontSize: 11, color: "var(--danger)", fontWeight: 600 }}>
                {t("crmPipeline.dealsBoard.overdue")}
              </span>
            </Tooltip>
          )}
          {deal.dealOwner?.fullName && (
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
              <TeamOutlined /> {deal.dealOwner.fullName}
            </span>
          )}
        </div>
      </>
    );
  };

  const summary = board.summary || {};

  return (
    <>
      <PageHeader
        title={t("crmPipeline.dealsBoard.title")}
        subtitle={
          includeClosed
            ? t("crmPipeline.dealsBoard.subWithClosed")
            : t("crmPipeline.dealsBoard.subOpenOnly")
        }
        actions={
          <Space>
            <Space size={6}>
              <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
                {t("crmPipeline.dealsBoard.showClosed")}
              </span>
              <Switch checked={includeClosed} onChange={setIncludeClosed} />
            </Space>
            <Tooltip title={t("crmPipeline.common.reload")}>
              <Button icon={<ReloadOutlined />} onClick={load} />
            </Tooltip>
            <Button icon={<UnorderedListOutlined />} onClick={() => navigate("/crm/deals")}>
              {t("crmPipeline.dealsBoard.tableView")}
            </Button>
          </Space>
        }
      />

      <div className="stat-grid">
        <StatCard
          title={t("crmPipeline.dealsBoard.kpiDeals")}
          value={summary.totalDeals ?? 0}
          icon={<AppstoreOutlined />}
        />
        <StatCard
          title={t("crmPipeline.dealsBoard.kpiPipeline")}
          value={<MoneyDisplay value={summary.totalValue ?? 0} />}
          icon={<RiseOutlined />}
          variant="info"
        />
        <StatCard
          title={t("crmPipeline.dealsBoard.kpiWeighted")}
          value={<MoneyDisplay value={summary.weightedValue ?? 0} />}
          icon={<BarChartOutlined />}
          variant="success"
        />
      </div>

      {loading && !board.columns.length ? (
        <div style={{ display: "flex", justifyContent: "center", padding: "60px 0" }}>
          <Spin size="large" />
        </div>
      ) : (
        <KanbanBoard
          columns={board.columns}
          loading={loading}
          onDragEnd={onDragEnd}
          renderCard={renderCard}
          onCardClick={(deal) => navigate(`/crm/deals/${deal.id}`)}
        />
      )}

      <Modal
        title={t("crmPipeline.dealsBoard.lostTitle")}
        open={lostOpen}
        onCancel={() => { setLostOpen(false); lostForm.resetFields(); load(); }}
        onOk={confirmLost}
        confirmLoading={saving}
        okText={t("crmPipeline.dealsBoard.lostOk")}
        cancelText={t("common.cancel")}
        width={520}
      >
        <Form form={lostForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            label={t("crmPipeline.dealsBoard.lostLabel", { name: pending.card?.dealName || "" })}
            name="lostReason"
            rules={[{ required: true, message: t("crmPipeline.dealsBoard.lostRequired") }, { max: 500 }]}
          >
            <Input.TextArea
              rows={3}
              placeholder={t("crmPipeline.dealsBoard.lostPlaceholder")}
              maxLength={500}
              showCount
            />
          </Form.Item>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
            {t("crmPipeline.dealsBoard.lostDesc")}
          </div>
        </Form>
      </Modal>

      <div style={{ marginTop: 12, fontSize: 12, color: "var(--text-muted)" }}>
        {t("crmPipeline.dealsBoard.columnTotals", {
          totals: board.columns.map((c) => `${c.label} ${shortMoney(c.totalValue)}`).join(" · "),
        })}
      </div>

      {/* CRM audit M3/L4: backend cắt ngang ở `take` ⇒ KPI chỉ tính trên phần đã
          tải. Không cảnh báo thì người dùng tưởng đã xem hết pipeline. */}
      {board.truncated && (
        <Alert
          type="warning"
          showIcon
          style={{ marginTop: 12 }}
          message={t("crmPipeline.dealsBoard.truncatedHint", {
            max: board.limits?.maxDeals ?? 500,
          })}
        />
      )}
    </>
  );
}
