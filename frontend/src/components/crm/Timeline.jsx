/**
 * Frontend: src/components/crm/Timeline.jsx — Unified timeline của lead/deal
 *
 * Tổng quan:
 * - Hiển thị `CrmCommunication` đã gộp: ghi chú/cuộc gọi/email user nhập tay
 *   (type = NOTE/CALL/EMAIL/MEETING/ZALO/WHATSAPP) VÀ sự kiện hệ thống
 *   (type = SYSTEM: đổi giai đoạn, gán owner, convert lead, tạo đơn hàng).
 * - Icon + màu dot theo `COMM_TYPE_META`; entry SYSTEM hiển thị nền dashed
 *   để phân biệt sự kiện do hệ thống sinh (backend chặn xoá: 409).
 * - Nút "Ghi hoạt động" mở form nhập nhanh (loại + hướng + tiêu đề + nội dung;
 *   hiện ô thời lượng khi chọn loại CALL).
 *
 * Props:
 *   entries:      Array<CrmCommunication> — đã sort mới nhất trước
 *   loading:      boolean
 *   onAdd:        (values) => Promise<void> — undefined → ẩn nút ghi hoạt động
 *   emptyText:    string — nhãn khi rỗng (truyền t() từ page)
 *   canDelete:    (entry) => boolean
 *   onDelete:     (entry) => void
 *
 * Exports:
 *   Timeline (default)
 */
import { useState } from "react";
import { Button, Empty, Form, Input, Modal, Select, Space, Tag, Tooltip, message } from "antd";
import { useTranslation } from "react-i18next";
import { PlusOutlined, DeleteOutlined, ArrowDownOutlined, ArrowUpOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { COMM_TYPE_META, commTypeOptions } from "./constants";

const fmtDuration = (sec) => {
  if (!sec || sec <= 0) return null;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m} phút${s ? ` ${s} giây` : ""}` : `${s} giây`;
};

export default function Timeline({
  entries = [],
  loading = false,
  onAdd,
  emptyText,
  canDelete,
  onDelete,
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  const submit = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      await onAdd(values);
      form.resetFields();
      setOpen(false);
    } catch (err) {
      if (err?.errorFields) return;
      message.error(err?.response?.data?.message || t("crmPipeline.timeline.saveError"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      {onAdd && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
          <Button type="primary" size="small" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
            {t("crmPipeline.timeline.add")}
          </Button>
        </div>
      )}

      {loading && !entries.length ? (
        <div style={{ padding: "40px 0" }}>
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={t("crmPipeline.timeline.loading")}
          />
        </div>
      ) : !entries.length ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={emptyText || t("crmPipeline.timeline.empty")}
          style={{ padding: "32px 0" }}
        />
      ) : (
        <div className="crm-timeline">
          {entries.map((e) => {
            const meta = COMM_TYPE_META[e.type] || COMM_TYPE_META.NOTE;
            const isSystem = e.type === "SYSTEM";
            const duration = fmtDuration(e.durationSec);
            return (
              <div className="crm-timeline__item" key={e.id}>
                <div
                  className="crm-timeline__icon"
                  style={{ background: `${meta.color}1f`, color: meta.color }}
                >
                  {meta.icon}
                </div>
                <div className={`crm-timeline__body ${isSystem ? "crm-timeline__body--system" : ""}`}>
                  <div className="crm-timeline__head">
                    <span className="crm-timeline__author">
                      {e.createdBy?.fullName ||
                        (isSystem ? t("crmPipeline.timeline.system") : "—")}
                    </span>
                    <span className="crm-timeline__time">
                      {dayjs(e.createdAt).format("DD/MM/YYYY HH:mm")}
                    </span>
                    <Tag color="default" style={{ marginInlineEnd: 0, fontSize: 11, paddingInline: 6 }}>
                      {t(meta.labelKey)}
                    </Tag>
                    {e.direction && (
                      <Tag
                        color={e.direction === "INBOUND" ? "blue" : "purple"}
                        icon={
                          e.direction === "INBOUND" ? <ArrowDownOutlined /> : <ArrowUpOutlined />
                        }
                        style={{ marginInlineEnd: 0, fontSize: 11, paddingInline: 6 }}
                      >
                        {t(
                          e.direction === "INBOUND"
                            ? "crmPipeline.timeline.inbound"
                            : "crmPipeline.timeline.outbound",
                        )}
                      </Tag>
                    )}
                    {duration && <span className="crm-timeline__time">{duration}</span>}
                    <span style={{ marginLeft: "auto" }}>
                      {canDelete?.(e) && (
                        <Tooltip title={t("crmPipeline.timeline.deleteTip")}>
                          <Button
                            size="small"
                            type="text"
                            danger
                            icon={<DeleteOutlined />}
                            onClick={() => onDelete?.(e)}
                          />
                        </Tooltip>
                      )}
                    </span>
                  </div>
                  {e.subject && <div className="crm-timeline__subject">{e.subject}</div>}
                  <div className="crm-timeline__content">{e.content}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal
        title={t("crmPipeline.timeline.add")}
        open={open}
        onCancel={() => setOpen(false)}
        onOk={submit}
        confirmLoading={saving}
        okText={t("crmPipeline.items.save")}
        cancelText={t("common.cancel")}
        width={560}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Space.Compact style={{ width: "100%" }} block>
            <Form.Item
              name="type"
              label={t("crmPipeline.timeline.type")}
              initialValue="NOTE"
              rules={[{ required: true }]}
              style={{ flex: 1, marginBottom: 16 }}
            >
              <Select options={commTypeOptions(t)} />
            </Form.Item>
            <Form.Item
              name="direction"
              label={t("crmPipeline.timeline.direction")}
              style={{ width: 190, marginBottom: 16 }}
            >
              <Select
                allowClear
                placeholder="—"
                options={[
                  { value: "INBOUND", label: t("crmPipeline.comm.inbound") },
                  { value: "OUTBOUND", label: t("crmPipeline.comm.outbound") },
                ]}
              />
            </Form.Item>
          </Space.Compact>
          <Form.Item name="subject" label={t("crmPipeline.timeline.subject")}>
            <Input placeholder={t("crmPipeline.timeline.subjectPlaceholder")} maxLength={300} />
          </Form.Item>
          <Form.Item
            name="content"
            label={t("crmPipeline.timeline.content")}
            rules={[{ required: true, message: t("crmPipeline.timeline.contentRequired") }]}
          >
            <Input.TextArea
              rows={4}
              placeholder={t("crmPipeline.timeline.contentPlaceholder")}
              maxLength={10000}
            />
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(a, b) => a.type !== b.type}>
            {({ getFieldValue }) =>
              getFieldValue("type") === "CALL" ? (
                <Form.Item name="durationSec" label={t("crmPipeline.timeline.duration")}>
                  <Input type="number" min={0} placeholder={t("crmPipeline.timeline.durationPlaceholder")} />
                </Form.Item>
              ) : null
            }
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
