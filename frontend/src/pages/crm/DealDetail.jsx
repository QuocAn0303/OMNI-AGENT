/**
 * Frontend: src/pages/crm/DealDetail.jsx — Chi tiết Deal
 *
 * Tổng quan:
 * - Header + thanh thao tác: đổi giai đoạn (StageSelect), sửa deal, tạo đơn hàng, xoá.
 * - Tabs: Sản phẩm (DealItemsEditor, `PUT /crm/deals/:id/items`) · Dòng thời gian ·
 *   Liên quan (lead / tổ chức / liên hệ / khách hàng / đơn hàng).
 * - Nút "Tạo đơn hàng" chỉ bật khi `kind = WON` và deal còn dòng sản phẩm có
 *   `productId` — đúng 2 điều kiện backend kiểm tra (400 nếu thiếu).
 * - Sau khi tạo đơn: deal bị khoá (409 cho mọi thao tác đổi giai đoạn/sửa sản phẩm/xoá)
 *   nên UI chuyển sang chế độ chỉ đọc.
 * - Chuyển sang giai đoạn LOST qua Select sẽ hỏi lý do thua (backend bắt buộc 400).
 *
 * Exports: DealDetail (default)
 */
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Card, Tabs, Button, Space, Tag, Modal, Form, Input, InputNumber, Select, DatePicker,
  message, Spin, Alert, Descriptions, Popconfirm, Tooltip, Divider,
} from "antd";
import {
  ArrowLeftOutlined, EditOutlined, DeleteOutlined, ShoppingCartOutlined, ThunderboltOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import PageHeader from "../../components/layout/PageHeader";
import MoneyDisplay from "../../components/shared/MoneyDisplay";
import ErrorState from "../../components/shared/ErrorState";
import StageTag from "../../components/crm/StageTag";
import StageSelect from "../../components/crm/StageSelect";
import DealItemsEditor from "../../components/crm/DealItemsEditor";
import Timeline from "../../components/crm/Timeline";
import ConvertOrderModal from "../../components/crm/ConvertOrderModal";
import { DEAL_KIND_META, shortMoney } from "../../components/crm/constants";
import useAuthStore from "../../stores/authStore";
import {
  getDeal, updateDeal, deleteDeal, changeDealStage, saveDealItems,
  listDealTimeline, addDealTimeline, listOrganizations, getLeadFields,
} from "../../api/crm";

export default function DealDetail() {
  const { t } = useTranslation();
  const { id } = useParams();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const isManager = ["SUPER_ADMIN", "SUPER_OMEGA_ULTRA_ADMIN", "ADMIN", "MANAGER"].includes(user?.role);

  const [deal, setDeal] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [timeline, setTimeline] = useState([]);
  const [timelineLoading, setTimelineLoading] = useState(true);
  const [orgs, setOrgs] = useState([]);
  const [owners, setOwners] = useState([]);

  const [editOpen, setEditOpen] = useState(false);
  const [editForm] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [lostOpen, setLostOpen] = useState(false);
  const [lostTarget, setLostTarget] = useState(null);
  const [lostForm] = Form.useForm();
  const [orderOpen, setOrderOpen] = useState(false);

  const loadDeal = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setDeal(await getDeal(id));
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [id]);

  const loadTimeline = useCallback(async () => {
    setTimelineLoading(true);
    try {
      const res = await listDealTimeline(id, { page: 1, limit: 100 });
      setTimeline(res.data || []);
    } catch {
      setTimeline([]);
    } finally {
      setTimelineLoading(false);
    }
  }, [id]);

  useEffect(() => { loadDeal(); }, [loadDeal]);
  useEffect(() => { loadTimeline(); }, [loadTimeline]);
  useEffect(() => {
    listOrganizations({ page: 1, limit: 200 }).then((r) => setOrgs(r.data || [])).catch(() => {});
    getLeadFields().then((res) => setOwners(res?.owners || [])).catch(() => {});
  }, []);

  if (loading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "80px 0" }}>
        <Spin size="large" />
      </div>
    );
  }

  if (error) {
    const status = error?.response?.status;
    const msg =
      status === 403
        ? t("crmPipeline.dealDetail.noAccess")
        : error?.response?.data?.message || t("crmPipeline.dealDetail.notFound");
    return (
      <>
        <PageHeader
          title={
            <Button icon={<ArrowLeftOutlined />} onClick={() => navigate("/crm/deals")}>
              {t("crmPipeline.dealDetail.backToList")}
            </Button>
          }
        />
        <ErrorState message={msg} onRetry={status === 403 ? undefined : loadDeal} />
      </>
    );
  }

  if (!deal) return null;

  const locked = !!deal.orderId;
  const kindMeta = DEAL_KIND_META[deal.kind] || DEAL_KIND_META.ONGOING;
  const sellable = (deal.items || []).filter((i) => i.productId);
  const weighted = (Number(deal.value || 0) * Number(deal.probability || 0)) / 100;

  /** Đổi giai đoạn — nếu backend trả 400 về lý do thua thì mở modal hỏi */
  const onChangeStage = async (stageId) => {
    if (!stageId) {
      message.info(t("crmPipeline.dealDetail.stageChangeHint"));
      return;
    }
    if (deal.stageId === stageId) return;
    try {
      await changeDealStage(deal.id, { stageId });
      message.success(t("crmPipeline.dealDetail.stageSuccess"));
      loadDeal();
      loadTimeline();
    } catch (err) {
      const msg = err?.response?.data?.message || "";
      if (err?.response?.status === 400 && /lý do thua/i.test(msg)) {
        setLostTarget(stageId);
        setLostOpen(true);
        return;
      }
      message.error(msg || t("crmPipeline.common.saveFailed"));
    }
  };

  const confirmLost = async () => {
    try {
      const values = await lostForm.validateFields();
      setSaving(true);
      await changeDealStage(deal.id, { stageId: lostTarget, lostReason: values.lostReason });
      message.success(t("crmPipeline.dealsBoard.lostOk"));
      setLostOpen(false);
      lostForm.resetFields();
      loadDeal();
      loadTimeline();
    } catch (e) {
      if (e?.errorFields) return;
      message.error(e?.response?.data?.message || t("crmPipeline.common.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const openEdit = () => {
    editForm.setFieldsValue({
      dealName: deal.dealName,
      organizationId: deal.organizationId || undefined,
      value: deal.value != null ? Number(deal.value) : 0,
      expectedCloseDate: deal.expectedCloseDate ? dayjs(deal.expectedCloseDate) : null,
      nextStep: deal.nextStep,
      dealOwnerId: deal.dealOwnerId || undefined,
    });
    setEditOpen(true);
  };

  const saveEdit = async () => {
    try {
      const values = await editForm.validateFields();
      setSaving(true);
      await updateDeal(deal.id, {
        dealName: values.dealName?.trim(),
        organizationId: values.organizationId || null,
        value: values.value || 0,
        expectedCloseDate: values.expectedCloseDate
          ? values.expectedCloseDate.format("YYYY-MM-DD")
          : null,
        nextStep: values.nextStep || null,
        dealOwnerId: values.dealOwnerId || null,
      });
      message.success(t("crmPipeline.dealDetail.updateSuccess"));
      setEditOpen(false);
      loadDeal();
    } catch (err) {
      if (err?.errorFields) return;
      message.error(err?.response?.data?.message || t("crmPipeline.common.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const onRemove = async () => {
    try {
      await deleteDeal(deal.id);
      message.success(t("crmPipeline.dealDetail.deleteSuccess"));
      navigate("/crm/deals");
    } catch (err) {
      message.error(err?.response?.data?.message || t("crmPipeline.common.saveFailed"));
    }
  };

  const infoItem = (label, value) => (
    <div>
      <div className="crm-detail__info-label">{label}</div>
      <div className="crm-detail__info-value">{value || "—"}</div>
    </div>
  );

  const nextStepTip =
    deal.kind === "ONGOING"
      ? t("crmPipeline.dealDetail.tipOngoing")
      : deal.kind === "WON" && !deal.orderId
        ? t("crmPipeline.dealDetail.tipWon")
        : t("crmPipeline.dealDetail.tipClosed");

  return (
    <>
      <PageHeader
        title={
          <Space>
            <Button icon={<ArrowLeftOutlined />} type="text" onClick={() => navigate("/crm/deals")} />
            {deal.dealName}
          </Space>
        }
        subtitle={
          <Space size={16} wrap>
            <span><MoneyDisplay value={deal.value ?? 0} /></span>
            {deal.expectedCloseDate && (
              <span>
                {t("crmPipeline.fields.expectedCloseDate")}:{" "}
                {dayjs(deal.expectedCloseDate).format("DD/MM/YYYY")}
              </span>
            )}
            {deal.nextStep && (
              <span>
                {t("crmPipeline.fields.nextStep")}: {deal.nextStep}
              </span>
            )}
          </Space>
        }
        actions={
          <Space>
            <Tag color={kindMeta.color}>{t(kindMeta.labelKey)}</Tag>
            {deal.order ? (
              <Button icon={<ShoppingCartOutlined />} onClick={() => navigate(`/orders/${deal.orderId}`)}>
                {t("crmPipeline.dealDetail.convertOrder")} {deal.order.orderCode}
              </Button>
            ) : (
              <Tooltip
                title={
                  deal.kind !== "WON"
                    ? t("crmPipeline.dealDetail.convertTipNotWon")
                    : sellable.length === 0
                      ? t("crmPipeline.dealDetail.convertTipNoProduct")
                      : t("crmPipeline.dealDetail.convertTipOk")
                }
              >
                <Button
                  type="primary"
                  icon={<ThunderboltOutlined />}
                  disabled={deal.kind !== "WON" || sellable.length === 0}
                  onClick={() => setOrderOpen(true)}
                >
                  {t("crmPipeline.dealDetail.convertOrder")}
                </Button>
              </Tooltip>
            )}
            <Button icon={<EditOutlined />} onClick={openEdit} disabled={locked}>
              {t("crmPipeline.dealDetail.edit")}
            </Button>
            {!locked && (
              <Popconfirm
                title={t("crmPipeline.dealDetail.deleteConfirm")}
                onConfirm={onRemove}
                okText={t("common.delete")}
                cancelText={t("common.cancel")}
              >
                <Button danger icon={<DeleteOutlined />} />
              </Popconfirm>
            )}
          </Space>
        }
      />

      {locked && (
        <Alert
          type="success"
          showIcon
          style={{ marginBottom: 16 }}
          message={t("crmPipeline.dealDetail.lockedTitle", { code: deal.order?.orderCode || "" })}
          description={t("crmPipeline.dealDetail.lockedDesc")}
        />
      )}

      <div className="crm-detail__bar">
        <div>
          <div className="crm-detail__info-label">{t("crmPipeline.fields.stage")}</div>
          <StageTag stage={deal.stage} />
        </div>
        <div className="crm-detail__stage-select">
          <div className="crm-detail__info-label">{t("crmPipeline.leadDetail.changeStage")}</div>
          <StageSelect
            value={deal.stageId}
            entityType="DEAL"
            onChange={onChangeStage}
            disabled={locked}
            width="100%"
          />
        </div>
        <div>
          <div className="crm-detail__info-label">{t("crmPipeline.fields.probability")}</div>
          <div className="crm-detail__info-value">
            {deal.probability}%{" "}
            <span style={{ color: "var(--text-muted)", fontSize: 12 }}>
              ≈ {shortMoney(weighted)}
            </span>
          </div>
        </div>
        <div>
          <div className="crm-detail__info-label">{t("crmPipeline.fields.owner")}</div>
          <div className="crm-detail__info-value">{deal.dealOwner?.fullName || "—"}</div>
        </div>
      </div>

      <div className="crm-detail__info">
        {infoItem(t("crmPipeline.fields.organization"), deal.organization?.name)}
        {infoItem(t("crmPipeline.fields.contact"), deal.contact?.fullName)}
        {infoItem(
          t("crmPipeline.fields.leadName"),
          deal.lead ? (
            <Button
              type="link"
              size="small"
              style={{ padding: 0 }}
              onClick={() => navigate(`/crm/leads/${deal.lead.id}`)}
            >
              {deal.lead.leadName}
            </Button>
          ) : null,
        )}
        {infoItem(
          t("crmPipeline.fields.customer"),
          deal.customer ? (
            <Button
              type="link"
              size="small"
              style={{ padding: 0 }}
              onClick={() => navigate(`/customers/${deal.customerId}`)}
            >
              {deal.customer.name}
            </Button>
          ) : null,
        )}
        {infoItem(t("crmPipeline.fields.createdAt"), dayjs(deal.createdAt).format("DD/MM/YYYY HH:mm"))}
        {infoItem(
          t("crmPipeline.fields.closedAt"),
          deal.closedAt ? dayjs(deal.closedAt).format("DD/MM/YYYY HH:mm") : null,
        )}
        {deal.lostReason && infoItem(t("crmPipeline.fields.lostReason"), deal.lostReason)}
      </div>

      <Tabs
        defaultActiveKey="items"
        items={[
          {
            key: "items",
            label: t("crmPipeline.dealDetail.tabItems", { count: deal.items?.length || 0 }),
            children: (
              <Card
                title={t("crmPipeline.dealDetail.itemsTitle")}
                extra={
                  locked ? (
                    <Tag color="default">{t("crmPipeline.dealDetail.itemsLocked")}</Tag>
                  ) : sellable.length === 0 ? (
                    <Tag color="warning">{t("crmPipeline.dealDetail.itemsNoProduct")}</Tag>
                  ) : null
                }
              >
                <DealItemsEditor
                  items={deal.items || []}
                  currency={deal.currency || "VND"}
                  disabled={locked}
                  onSave={async (items) => {
                    setDeal(await saveDealItems(deal.id, items));
                  }}
                />
              </Card>
            ),
          },
          {
            key: "timeline",
            label: t("crmPipeline.dealDetail.tabTimeline", { count: timeline.length }),
            children: (
              <Card>
                <Timeline
                  entries={timeline}
                  loading={timelineLoading}
                  onAdd={async (values) => {
                    await addDealTimeline(deal.id, values);
                    loadTimeline();
                  }}
                  emptyText={t("crmPipeline.timeline.emptyDeal")}
                />
              </Card>
            ),
          },
          {
            key: "related",
            label: t("crmPipeline.dealDetail.tabRelated"),
            children: (
              <Card>
                <Descriptions bordered size="small" column={1}>
                  <Descriptions.Item label={t("crmPipeline.fields.organization")}>
                    {deal.organization?.name || "—"}
                  </Descriptions.Item>
                  <Descriptions.Item label={t("crmPipeline.fields.contact")}>
                    {deal.contact
                      ? `${deal.contact.fullName}${deal.contact.phone ? ` · ${deal.contact.phone}` : ""}`
                      : "—"}
                  </Descriptions.Item>
                  <Descriptions.Item label={t("crmPipeline.fields.leadName")}>
                    {deal.lead ? `${deal.lead.leadName} (${deal.lead.status})` : "—"}
                  </Descriptions.Item>
                  <Descriptions.Item label={t("crmPipeline.fields.customer")}>
                    {deal.customer?.name || t("crmPipeline.dealDetail.relatedCustomerNone")}
                  </Descriptions.Item>
                  <Descriptions.Item label={t("crmPipeline.deals.order")}>
                    {deal.order ? (
                      <Space>
                        <Button
                          type="link"
                          size="small"
                          style={{ padding: 0 }}
                          onClick={() => navigate(`/orders/${deal.orderId}`)}
                        >
                          {deal.order.orderCode}
                        </Button>
                        <MoneyDisplay value={deal.order.total} />
                      </Space>
                    ) : (
                      t("crmPipeline.dealDetail.relatedOrderNone")
                    )}
                  </Descriptions.Item>
                </Descriptions>
                <Divider style={{ margin: "12px 0" }} />
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  {t("crmPipeline.dealDetail.tipLabel")} {nextStepTip}
                </div>
              </Card>
            ),
          },
        ]}
      />

      {/* Modal sửa deal */}
      <Modal
        title={t("crmPipeline.deals.edit")}
        open={editOpen}
        onCancel={() => setEditOpen(false)}
        onOk={saveEdit}
        confirmLoading={saving}
        okText={t("common.save")}
        cancelText={t("common.cancel")}
        width={560}
        destroyOnHidden
      >
        <Form form={editForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            label={t("crmPipeline.fields.dealName")}
            name="dealName"
            rules={[{ required: true, message: t("crmPipeline.deals.nameRequired") }, { max: 200 }]}
          >
            <Input />
          </Form.Item>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Form.Item label={t("crmPipeline.fields.organization")} name="organizationId">
              <Select
                allowClear
                showSearch
                optionFilterProp="label"
                options={orgs.map((o) => ({ value: o.id, label: o.name }))}
              />
            </Form.Item>
            <Form.Item label={t("crmPipeline.fields.value")} name="value">
              <InputNumber
                min={0}
                step={1000000}
                style={{ width: "100%" }}
                formatter={(v) => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ".")}
                parser={(v) => v?.replace(/\./g, "")}
              />
            </Form.Item>
            <Form.Item label={t("crmPipeline.fields.expectedCloseDate")} name="expectedCloseDate">
              <DatePicker style={{ width: "100%" }} format="DD/MM/YYYY" />
            </Form.Item>
            {isManager && (
              <Form.Item label={t("crmPipeline.fields.owner")} name="dealOwnerId">
                <Select
                  allowClear
                  options={owners.map((o) => ({ value: o.id, label: `${o.fullName} (${o.role})` }))}
                />
              </Form.Item>
            )}
          </div>
          <Form.Item label={t("crmPipeline.fields.nextStep")} name="nextStep">
            <Input maxLength={500} />
          </Form.Item>
        </Form>
      </Modal>

      {/* Modal lý do thua */}
      <Modal
        title={t("crmPipeline.dealsBoard.lostTitle")}
        open={lostOpen}
        onCancel={() => { setLostOpen(false); lostForm.resetFields(); }}
        onOk={confirmLost}
        confirmLoading={saving}
        okText={t("crmPipeline.dealsBoard.lostOk")}
        cancelText={t("common.cancel")}
        width={520}
      >
        <Form form={lostForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            label={t("crmPipeline.dealsBoard.lostLabel", { name: deal.dealName })}
            name="lostReason"
            rules={[{ required: true, message: t("crmPipeline.dealsBoard.lostRequired") }, { max: 500 }]}
          >
            <Input.TextArea rows={3} maxLength={500} showCount placeholder={t("crmPipeline.deals.lostReasonPlaceholder")} />
          </Form.Item>
        </Form>
      </Modal>

      {/* Modal tạo đơn hàng */}
      <ConvertOrderModal
        open={orderOpen}
        deal={deal}
        onCancel={() => setOrderOpen(false)}
        onSuccess={() => {
          setOrderOpen(false);
          loadDeal();
          loadTimeline();
        }}
      />
    </>
  );
}
