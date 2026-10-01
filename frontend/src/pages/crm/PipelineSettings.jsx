/**
 * Frontend: src/pages/crm/PipelineSettings.jsx — Cấu hình giai đoạn pipeline
 *
 * Tổng quan:
 * - Quản lý `CrmPipelineStage` (bảng cấu hình, admin tự CRUD — tương đương
 *   doctype "CRM Deal Status" của Frappe CRM). KHÔNG phải enum cứng trong schema.
 * - 2 nhóm: LEAD (kanban lead) và DEAL (kanban deal), dùng `Select` để chuyển.
 * - Kéo-thả thứ tự bằng `@hello-pangea/dnd` → `POST /crm/stages/reorder` với
 *   danh sách `{ id, sortOrder }` (chỉ gửi entityType đang xem).
 * - Sửa nhanh tại chỗ: đổi nhãn, màu, xác suất, bật/tắt `isActive` (nút "Lưu").
 * - Lưu ý backend: đổi `kind`/`probability` của stage sẽ **đồng bộ ngược** cho
 *   toàn bộ deal đang ở stage đó (`CrmDeal.kind`/`probability` là bản denormalize).
 * - Xoá bị chặn (409) nếu còn lead/deal ở giai đoạn → UI khuyến nghị tắt `isActive`.
 * - Lần gọi `GET /crm/stages` đầu tiên của tenant sẽ lazy-seed 9 stage mặc định.
 *
 * Exports: PipelineSettings (default)
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import {
  Button, Card, Input, InputNumber, Select, Switch, Tag, Space, Modal, Form, ColorPicker,
  message, Popconfirm, Tooltip, Alert, Spin, Empty,
} from "antd";
import {
  PlusOutlined, DeleteOutlined, HolderOutlined, SaveOutlined, ReloadOutlined, EditOutlined,
  CheckCircleOutlined, CloseCircleOutlined, ClockCircleOutlined,
} from "@ant-design/icons";
import PageHeader from "../../components/layout/PageHeader";
import { listStages, createStage, updateStage, deleteStage, reorderStages } from "../../api/crm";
import { dealKindLabel } from "../../components/crm/constants";

const KIND_ICON = {
  ONGOING: <ClockCircleOutlined />,
  WON: <CheckCircleOutlined />,
  LOST: <CloseCircleOutlined />,
};

const toHex = (c) => (typeof c === "string" ? c : c?.toHexString?.() || "#0f766e");

export default function PipelineSettings() {
  const { t } = useTranslation();
  const [entityType, setEntityType] = useState("DEAL");
  const [stages, setStages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingOrder, setSavingOrder] = useState(false);
  const [savingId, setSavingId] = useState(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listStages(entityType, true);
      setStages(res?.stages || []);
    } catch (err) {
      message.error(err?.response?.data?.message || t("crmPipeline.common.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [entityType, t]);

  useEffect(() => { load(); }, [load]);

  const kindOptions = [
    { value: "ONGOING", label: t("crmPipeline.settings.kindOngoing") },
    { value: "WON", label: t("crmPipeline.settings.kindWon") },
    { value: "LOST", label: t("crmPipeline.settings.kindLost") },
  ];

  const persistStage = async (stage, patch) => {
    setSavingId(stage.id);
    try {
      await updateStage(stage.id, patch);
      await load();
    } catch (err) {
      message.error(err?.response?.data?.message || t("crmPipeline.common.saveFailed"));
    } finally {
      setSavingId(null);
    }
  };

  const onDragEnd = async (result) => {
    if (!result.destination) return;
    if (result.destination.index === result.source.index) return;
    const next = [...stages];
    const [moved] = next.splice(result.source.index, 1);
    next.splice(result.destination.index, 0, moved);
    setStages(next);

    setSavingOrder(true);
    try {
      await reorderStages(next.map((s, i) => ({ id: s.id, sortOrder: i })));
      message.success(t("crmPipeline.settings.orderSuccess"));
    } catch (err) {
      message.error(err?.response?.data?.message || t("crmPipeline.common.saveFailed"));
    } finally {
      setSavingOrder(false);
      load();
    }
  };

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ entityType, kind: "ONGOING", color: "#0f766e", probability: 10, isActive: true });
    setModalOpen(true);
  };

  const openEdit = (stage) => {
    setEditing(stage);
    form.setFieldsValue({
      entityType: stage.entityType,
      label: stage.label,
      kind: stage.kind,
      color: stage.color,
      probability: stage.probability,
      isActive: stage.isActive,
    });
    setModalOpen(true);
  };

  const save = async () => {
    try {
      const values = await form.validateFields();
      const payload = {
        label: values.label?.trim(),
        kind: values.kind,
        color: toHex(values.color),
        probability: values.probability ?? 0,
        isActive: values.isActive !== false,
      };
      setSaving(true);
      if (editing) {
        await updateStage(editing.id, payload);
        message.success(t("crmPipeline.settings.updateSuccess"));
      } else {
        await createStage({ ...payload, entityType: values.entityType });
        message.success(t("crmPipeline.settings.createSuccess"));
      }
      setModalOpen(false);
      load();
    } catch (err) {
      if (err?.errorFields) return;
      message.error(err?.response?.data?.message || t("crmPipeline.common.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (stage) => {
    try {
      await deleteStage(stage.id);
      message.success(t("crmPipeline.settings.deleteSuccess"));
      load();
    } catch (err) {
      message.error(err?.response?.data?.message || t("crmPipeline.common.saveFailed"));
    }
  };

  const renderStage = (stage, index) => (
    <Draggable key={stage.id} draggableId={stage.id} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          // style + onTransitionEnd do thư viện dnd cấp: thiếu style thì thẻ
          // không di chuyển khi kéo (xem KanbanBoard.jsx để giải thích đầy đủ)
          style={{
            marginBottom: 8,
            borderLeftColor: stage.color,
            opacity: snapshot.isDragging ? 0.6 : 1,
            ...provided.draggableProps.style,
          }}
          onTransitionEnd={provided.draggableProps.onTransitionEnd}
          className="kanban-card"
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              {...provided.dragHandleProps}
              style={{ cursor: "grab", touchAction: "none", display: "inline-flex" }}
            >
              <HolderOutlined style={{ color: "var(--text-muted)" }} />
            </span>
            <span className="crm-stage__dot" style={{ background: stage.color, width: 10, height: 10 }} />
            <Input
              size="small"
              value={stage.label}
              onChange={(e) =>
                setStages((prev) =>
                  prev.map((s) => (s.id === stage.id ? { ...s, label: e.target.value } : s)),
                )
              }
              style={{ flex: 1 }}
              disabled={savingId === stage.id}
            />
            <Tag color={stage.kind === "WON" ? "success" : stage.kind === "LOST" ? "error" : "default"} icon={KIND_ICON[stage.kind]}>
              {dealKindLabel(t, stage.kind)}
            </Tag>
            <Tooltip title={t("crmPipeline.settings.edit")}>
              <Button size="small" type="text" icon={<EditOutlined />} onClick={() => openEdit(stage)} />
            </Tooltip>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
            <ColorPicker
              size="small"
              value={stage.color}
              onChange={(c) =>
                setStages((prev) =>
                  prev.map((s) => (s.id === stage.id ? { ...s, color: toHex(c) } : s)),
                )
              }
            />
            <InputNumber
              size="small"
              min={0}
              max={100}
              value={stage.probability}
              onChange={(v) =>
                setStages((prev) =>
                  prev.map((s) => (s.id === stage.id ? { ...s, probability: v ?? 0 } : s)),
                )
              }
              addonAfter="%"
              style={{ width: 110 }}
            />
            <Space size={6}>
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                {t("crmPipeline.settings.show")}
              </span>
              <Switch size="small" checked={stage.isActive} onChange={(v) => persistStage(stage, { isActive: v })} />
            </Space>
            <span style={{ flex: 1 }} />
            <Button
              size="small"
              icon={<SaveOutlined />}
              loading={savingId === stage.id}
              onClick={() =>
                persistStage(stage, {
                  label: stage.label.trim(),
                  color: stage.color,
                  probability: stage.probability,
                })
              }
            >
              {t("crmPipeline.items.save")}
            </Button>
            <Popconfirm
              title={t("crmPipeline.settings.deleteConfirm")}
              description={t("crmPipeline.settings.deleteConfirmDesc")}
              onConfirm={() => remove(stage)}
              okText={t("crmPipeline.settings.okDelete")}
              cancelText={t("common.cancel")}
            >
              <Button size="small" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          </div>
        </div>
      )}
    </Draggable>
  );

  return (
    <>
      <PageHeader
        title={t("crmPipeline.settings.title")}
        subtitle={t("crmPipeline.settings.subtitle")}
        actions={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>
              {t("crmPipeline.settings.reload")}
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              {t("crmPipeline.settings.add")}
            </Button>
          </Space>
        }
      />

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message={t("crmPipeline.settings.alertTitle")}
        description={t("crmPipeline.settings.alertDesc")}
      />

      <div className="filters-bar">
        <Select
          value={entityType}
          onChange={setEntityType}
          style={{ width: 240 }}
          options={[
            { value: "DEAL", label: t("crmPipeline.settings.boardDeal") },
            { value: "LEAD", label: t("crmPipeline.settings.boardLead") },
          ]}
        />
        <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
          {t("crmPipeline.settings.count", { count: stages.length })}
          {savingOrder ? ` · ${t("crmPipeline.settings.savingOrder")}` : ""}
        </span>
      </div>

      <Card
        title={
          entityType === "DEAL"
            ? t("crmPipeline.settings.stageTitleDeal")
            : t("crmPipeline.settings.stageTitleLead")
        }
      >
        {loading ? (
          <div style={{ display: "flex", justifyContent: "center", padding: "40px 0" }}>
            <Spin />
          </div>
        ) : !stages.length ? (
          <Empty description={t("crmPipeline.settings.empty")} />
        ) : (
          <DragDropContext onDragEnd={onDragEnd}>
            <Droppable droppableId="crm-stages">
              {(provided) => (
                <div ref={provided.innerRef} {...provided.droppableProps}>
                  {stages.map(renderStage)}
                  {provided.placeholder}
                </div>
              )}
            </Droppable>
          </DragDropContext>
        )}
      </Card>

      <Modal
        title={
          editing
            ? t("crmPipeline.settings.editTitle", { label: editing.label })
            : t("crmPipeline.settings.add")
        }
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={save}
        confirmLoading={saving}
        okText={t("common.save")}
        cancelText={t("common.cancel")}
        width={520}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            label={t("crmPipeline.settings.label")}
            name="label"
            rules={[{ required: true, message: t("crmPipeline.settings.labelRequired") }, { max: 100 }]}
            extra={t("crmPipeline.settings.labelExtra")}
          >
            <Input placeholder={t("crmPipeline.settings.labelPlaceholder")} />
          </Form.Item>
          <Form.Item
            label={t("crmPipeline.settings.entityType")}
            name="entityType"
            rules={[{ required: true }]}
            extra={editing ? t("crmPipeline.settings.entityTypeLocked") : undefined}
          >
            <Select
              disabled={!!editing}
              options={[
                { value: "LEAD", label: t("crmPipeline.settings.boardLead") },
                { value: "DEAL", label: t("crmPipeline.settings.boardDeal") },
              ]}
            />
          </Form.Item>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Form.Item label={t("crmPipeline.settings.kind")} name="kind" rules={[{ required: true }]}>
              <Select options={kindOptions} />
            </Form.Item>
            <Form.Item label={t("crmPipeline.settings.color")} name="color">
              <ColorPicker showText format="hex" />
            </Form.Item>
            <Form.Item
              label={t("crmPipeline.settings.prob")}
              name="probability"
              rules={[{ required: true }]}
              extra={t("crmPipeline.settings.probExtra")}
            >
              <InputNumber min={0} max={100} addonAfter="%" style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item label={t("crmPipeline.settings.inUse")} name="isActive" valuePropName="checked">
              <Switch checkedChildren="Có" unCheckedChildren="Ẩn" />
            </Form.Item>
          </div>
          <Alert
            type="warning"
            showIcon
            message={t("crmPipeline.settings.lostAlertTitle")}
            description={t("crmPipeline.settings.lostAlertDesc")}
          />
        </Form>
      </Modal>
    </>
  );
}
