/**
 * Frontend: src/pages/crm/LeadDetail.jsx — Chi tiết Lead
 *
 * Tổng quan:
 * - Header: tên, SĐT, email, chức danh, nguồn + nút quay lại.
 * - Thanh thao tác: đổi giai đoạn (StageSelect), gán người phụ trách, nút "Chuyển
 *   thành Deal". Nút convert bị ẩn khi `status = CONVERTED` (backend trả 409 nếu gọi lại).
 * - Tabs: Thông tin (ghi chú nội bộ) · Deal (deal đã sinh) · Dòng thời gian
 *   (unified timeline: ghi chú + sự kiện hệ thống).
 * - Dữ liệu: GET /crm/leads/:id, GET/POST /crm/leads/:id/timeline.
 * - 403 (CASHIER mở lead của người khác) → ErrorState kèm nút quay lại.
 *
 * Exports: LeadDetail (default)
 */
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Card, Tabs, Button, Space, Tag, Descriptions, message, Spin, Alert, Select, Popconfirm,
} from "antd";
import {
  ArrowLeftOutlined, SwapOutlined, DeleteOutlined, PhoneOutlined, MailOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import PageHeader from "../../components/layout/PageHeader";
import MoneyDisplay from "../../components/shared/MoneyDisplay";
import ErrorState from "../../components/shared/ErrorState";
import EmptyState from "../../components/shared/EmptyState";
import StageTag from "../../components/crm/StageTag";
import StageSelect from "../../components/crm/StageSelect";
import Timeline from "../../components/crm/Timeline";
import ConvertLeadModal from "../../components/crm/ConvertLeadModal";
import { LEAD_STATUS_META, DEAL_KIND_META } from "../../components/crm/constants";
import useAuthStore from "../../stores/authStore";
import {
  getLead, updateLead, changeLeadStage, deleteLead, listLeadTimeline, addLeadTimeline, getLeadFields,
} from "../../api/crm";

const OVERDUE_DAYS = 7;

export default function LeadDetail() {
  const { t } = useTranslation();
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const user = useAuthStore((s) => s.user);
  const isManager = ["SUPER_ADMIN", "SUPER_OMEGA_ULTRA_ADMIN", "ADMIN", "MANAGER"].includes(user?.role);

  const [lead, setLead] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [owners, setOwners] = useState([]);
  const [timeline, setTimeline] = useState([]);
  const [timelineLoading, setTimelineLoading] = useState(true);
  const [convertOpen, setConvertOpen] = useState(false);
  const [tab, setTab] = useState(searchParams.get("tab") || "info");

  const loadLead = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setLead(await getLead(id));
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [id]);

  const loadTimeline = useCallback(async () => {
    setTimelineLoading(true);
    try {
      const res = await listLeadTimeline(id, { page: 1, limit: 100 });
      setTimeline(res.data || []);
    } catch {
      setTimeline([]);
    } finally {
      setTimelineLoading(false);
    }
  }, [id]);

  useEffect(() => { loadLead(); }, [loadLead]);
  useEffect(() => { loadTimeline(); }, [loadTimeline]);
  useEffect(() => {
    getLeadFields()
      .then((res) => setOwners(res?.owners || []))
      .catch(() => {});
  }, []);

  // Deep-link từ notification webhook: /crm/leads/:id?phone=... (hợp đồng cũ)
  useEffect(() => {
    if (searchParams.get("phone") || searchParams.get("email")) {
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

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
        ? t("crmPipeline.leadDetail.noAccess")
        : error?.response?.data?.message || t("crmPipeline.leadDetail.notFound");
    return (
      <>
        <PageHeader
          title={
            <Button icon={<ArrowLeftOutlined />} onClick={() => navigate("/crm/leads")}>
              {t("crmPipeline.leadDetail.backToList")}
            </Button>
          }
        />
        <ErrorState message={msg} onRetry={status === 403 ? undefined : loadLead} />
      </>
    );
  }

  if (!lead) return null;

  const isConverted = lead.status === "CONVERTED";
  const overdue =
    !isConverted &&
    lead.status !== "DEAD" &&
    lead.lastContactedAt &&
    dayjs(lead.lastContactedAt).isBefore(dayjs().subtract(OVERDUE_DAYS, "day"));

  const onChangeStage = async (stageId) => {
    try {
      await changeLeadStage(lead.id, { stageId });
      message.success(t("crmPipeline.leads.changeStageSuccess"));
      loadLead();
      loadTimeline();
    } catch (err) {
      message.error(err?.response?.data?.message || t("crmPipeline.common.saveFailed"));
    }
  };

  const onChangeOwner = async (leadOwnerId) => {
    try {
      await updateLead(lead.id, { leadOwnerId: leadOwnerId || null });
      message.success(t("crmPipeline.leadDetail.ownerSuccess"));
      loadLead();
      loadTimeline();
    } catch (err) {
      message.error(err?.response?.data?.message || t("crmPipeline.common.saveFailed"));
    }
  };

  const onRemove = async () => {
    try {
      await deleteLead(lead.id);
      message.success(t("crmPipeline.leads.deleteSuccess"));
      navigate("/crm/leads");
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

  const deals = lead.deals || [];

  return (
    <>
      <PageHeader
        title={
          <Space>
            <Button icon={<ArrowLeftOutlined />} type="text" onClick={() => navigate("/crm/leads")} />
            {lead.leadName}
          </Space>
        }
        subtitle={
          <Space size={16} wrap>
            {lead.mobileNo && <span><PhoneOutlined /> {lead.mobileNo}</span>}
            {lead.email && <span><MailOutlined /> {lead.email}</span>}
            {lead.jobTitle && <span>{lead.jobTitle}</span>}
            {lead.source && (
              <span>
                {t("crmPipeline.fields.source")}: {lead.source}
              </span>
            )}
          </Space>
        }
        actions={
          <Space>
            <Tag color={LEAD_STATUS_META[lead.status]?.color}>
              {t(LEAD_STATUS_META[lead.status]?.labelKey || "")}
            </Tag>
            {!isConverted && (
              <Button type="primary" icon={<SwapOutlined />} onClick={() => setConvertOpen(true)}>
                {t("crmPipeline.leadDetail.convert")}
              </Button>
            )}
            {!isConverted && deals.length === 0 && (
              <Popconfirm
                title={t("crmPipeline.leads.deleteConfirm")}
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

      {overdue && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message={t("crmPipeline.leadDetail.overdueTitle", { days: OVERDUE_DAYS })}
          description={t("crmPipeline.leadDetail.overdueDesc")}
        />
      )}

      <div className="crm-detail__bar">
        <div>
          <div className="crm-detail__info-label">{t("crmPipeline.fields.stage")}</div>
          <StageTag stage={lead.stage} status={lead.status} />
        </div>
        <div className="crm-detail__stage-select">
          <div className="crm-detail__info-label">{t("crmPipeline.leadDetail.changeStage")}</div>
          <StageSelect
            value={lead.stageId}
            entityType="LEAD"
            onChange={onChangeStage}
            disabled={isConverted}
            width="100%"
          />
        </div>
        {isManager && (
          <div>
            <div className="crm-detail__info-label">{t("crmPipeline.fields.owner")}</div>
            <Select
              value={lead.leadOwnerId || undefined}
              onChange={onChangeOwner}
              allowClear
              placeholder={t("crmPipeline.common.notOwner")}
              style={{ width: 190 }}
              options={owners.map((o) => ({ value: o.id, label: `${o.fullName} (${o.role})` }))}
            />
          </div>
        )}
        <div>
          <div className="crm-detail__info-label">{t("crmPipeline.fields.expectedValue")}</div>
          <div className="crm-detail__info-value">
            <MoneyDisplay value={lead.expectedValue ?? 0} />
          </div>
        </div>
      </div>

      <div className="crm-detail__info">
        {infoItem(t("crmPipeline.fields.organization"), lead.organization?.name)}
        {infoItem(t("crmPipeline.fields.contact"), lead.contact?.fullName)}
        {infoItem(t("crmPipeline.fields.createdAt"), dayjs(lead.createdAt).format("DD/MM/YYYY HH:mm"))}
        {infoItem(
          t("crmPipeline.fields.lastContacted"),
          lead.lastContactedAt ? dayjs(lead.lastContactedAt).format("DD/MM/YYYY HH:mm") : null,
        )}
        {infoItem(
          t("crmPipeline.fields.convertedAt"),
          lead.convertedAt ? dayjs(lead.convertedAt).format("DD/MM/YYYY HH:mm") : null,
        )}
        {infoItem(
          t("crmPipeline.leadDetail.dealsLabel"),
          lead.convertedDealId ? (
            <Button
              type="link"
              size="small"
              style={{ padding: 0 }}
              onClick={() => navigate(`/crm/deals/${lead.convertedDealId}`)}
            >
              {t("crmPipeline.leadDetail.openDeal")}
            </Button>
          ) : null,
        )}
      </div>

      <Tabs
        activeKey={tab}
        onChange={(k) => {
          setTab(k);
          setSearchParams(k === "info" ? {} : { tab: k }, { replace: true });
        }}
        items={[
          {
            key: "info",
            label: t("crmPipeline.leadDetail.tabInfo"),
            children: (
              <Card title={t("crmPipeline.leadDetail.internalNote")}>
                {lead.notes ? (
                  <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{lead.notes}</div>
                ) : (
                  <EmptyState
                    title={t("crmPipeline.leadDetail.noNote")}
                    description={t("crmPipeline.leadDetail.noNoteDesc")}
                  />
                )}
              </Card>
            ),
          },
          {
            key: "deals",
            label: t("crmPipeline.leadDetail.tabDeals", { count: deals.length }),
            children: (
              <Card>
                {deals.length === 0 ? (
                  <EmptyState
                    title={t("crmPipeline.leadDetail.noDeals")}
                    description={
                      isConverted
                        ? t("crmPipeline.leadDetail.noDealsConverted")
                        : t("crmPipeline.leadDetail.noDealsDesc")
                    }
                  />
                ) : (
                  <Descriptions bordered column={1} size="small">
                    {deals.map((d) => (
                      <Descriptions.Item
                        key={d.id}
                        label={
                          <Space>
                            <Button
                              type="link"
                              size="small"
                              style={{ padding: 0 }}
                              onClick={() => navigate(`/crm/deals/${d.id}`)}
                            >
                              {d.dealName}
                            </Button>
                            <Tag style={{ marginInlineEnd: 0 }} color={DEAL_KIND_META[d.kind]?.color}>
                              {t(DEAL_KIND_META[d.kind]?.labelKey || "")}
                            </Tag>
                          </Space>
                        }
                      >
                        <MoneyDisplay value={d.value} />
                        <span style={{ color: "var(--text-muted)", marginLeft: 8, fontSize: 12 }}>
                          {dayjs(d.createdAt).format("DD/MM/YYYY")}
                        </span>
                      </Descriptions.Item>
                    ))}
                  </Descriptions>
                )}
              </Card>
            ),
          },
          {
            key: "timeline",
            label: t("crmPipeline.leadDetail.tabTimeline", { count: timeline.length }),
            children: (
              <Card>
                <Timeline
                  entries={timeline}
                  loading={timelineLoading}
                  onAdd={async (values) => {
                    await addLeadTimeline(lead.id, values);
                    loadTimeline();
                  }}
                  emptyText={t("crmPipeline.timeline.emptyLead")}
                />
              </Card>
            ),
          },
        ]}
      />

      <ConvertLeadModal
        open={convertOpen}
        lead={lead}
        onCancel={() => setConvertOpen(false)}
        onSuccess={(res) => {
          setConvertOpen(false);
          loadLead();
          loadTimeline();
          if (res?.deal?.id) navigate(`/crm/deals/${res.deal.id}`);
        }}
      />
    </>
  );
}
