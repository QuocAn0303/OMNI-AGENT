/**
 * Frontend: src/pages/crm/Deals.jsx — Danh sách Deal (dạng bảng)
 *
 * Tổng quan:
 * - Bảng deal phân trang (GET /crm/deals) với bộ lọc: trạng thái pipeline
 *   (kind ONGOING/WON/LOST), giai đoạn, tổ chức, người phụ trách, tìm kiếm.
 * - Cột giá trị dùng `MoneyDisplay`; kèm giá trị có trọng số
 *   (value × probability/100) cho deal đang chạy.
 * - Phân quyền: CASHIER chỉ thấy deal của mình; chỉ MANAGER/ADMIN mới lọc được
 *   theo người phụ trách khác (backend bỏ qua filter này với role khác).
 * - Nút chuyển sang Kanban: `/crm/deals/board`.
 * - Xoá bị chặn (409) khi deal đã sinh đơn hàng (`orderId`).
 *
 * Exports: Deals (default)
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Table, Button, Tag, Modal, Form, Input, InputNumber, Select, DatePicker, Space,
  Popconfirm, Tooltip, message, Segmented, Card,
} from "antd";
import {
  PlusOutlined, EditOutlined, DeleteOutlined, SearchOutlined, AppstoreOutlined, ReloadOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import PageHeader from "../../components/layout/PageHeader";
import EmptyState from "../../components/shared/EmptyState";
import MoneyDisplay from "../../components/shared/MoneyDisplay";
import StageTag from "../../components/crm/StageTag";
import useStages from "../../hooks/useCrmStages";
import useDebounce from "../../hooks/useDebounce";
import useAuthStore from "../../stores/authStore";
import {
  listDeals, createDeal, updateDeal, deleteDeal, listOrganizations, listLeads, getLeadFields,
} from "../../api/crm";
import { DEAL_KIND_META, shortMoney } from "../../components/crm/constants";

export default function Deals() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const isManager = ["SUPER_ADMIN", "SUPER_OMEGA_ULTRA_ADMIN", "ADMIN", "MANAGER"].includes(user?.role);

  const [data, setData] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  const [kind, setKind] = useState("ONGOING");
  const [stageId, setStageId] = useState();
  const [orgId, setOrgId] = useState();
  const [ownerId, setOwnerId] = useState();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);

  const [orgs, setOrgs] = useState([]);
  const [leads, setLeads] = useState([]);
  const [owners, setOwners] = useState([]);
  const { stages } = useStages("DEAL", true);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  useEffect(() => {
    listOrganizations({ page: 1, limit: 200 }).then((r) => setOrgs(r.data || [])).catch(() => {});
    listLeads({ page: 1, limit: 200, status: "QUALIFIED" })
      .then((r) => setLeads(r.data || []))
      .catch(() => {});
    getLeadFields().then((res) => setOwners(res?.owners || [])).catch(() => {});
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const params = { page, limit: 20 };
      if (kind) params.kind = kind;
      if (stageId) params.stageId = stageId;
      if (orgId) params.organizationId = orgId;
      if (isManager && ownerId) params.dealOwnerId = ownerId;
      if (debouncedSearch) params.search = debouncedSearch;
      const res = await listDeals(params);
      setData(res.data || []);
      setTotal(res.pagination?.total || 0);
    } catch (err) {
      message.error(err?.response?.data?.message || t("crmPipeline.common.loadFailed"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [page, kind, stageId, orgId, ownerId, debouncedSearch]);
  useEffect(() => { setPage(1); }, [kind, stageId, orgId, ownerId, debouncedSearch]);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({
      stageId: stages.find((s) => s.kind === "ONGOING" && s.isActive !== false)?.id,
      currency: "VND",
      dealOwnerId: isManager ? undefined : user?.id,
    });
    setModalOpen(true);
  };

  const openEdit = (row) => {
    setEditing(row);
    form.setFieldsValue({
      dealName: row.dealName,
      organizationId: row.organizationId || undefined,
      leadId: row.leadId || undefined,
      stageId: row.stageId || undefined,
      value: row.value != null ? Number(row.value) : 0,
      currency: row.currency || "VND",
      expectedCloseDate: row.expectedCloseDate ? dayjs(row.expectedCloseDate) : null,
      nextStep: row.nextStep,
      dealOwnerId: row.dealOwnerId || undefined,
      lostReason: row.lostReason,
    });
    setModalOpen(true);
  };

  const save = async () => {
    try {
      const values = await form.validateFields();
      const payload = {
        dealName: values.dealName?.trim(),
        organizationId: values.organizationId || null,
        leadId: values.leadId || null,
        stageId: values.stageId || null,
        value: values.value || 0,
        currency: values.currency || "VND",
        expectedCloseDate: values.expectedCloseDate
          ? values.expectedCloseDate.format("YYYY-MM-DD")
          : null,
        nextStep: values.nextStep || null,
        dealOwnerId: values.dealOwnerId || null,
        ...(values.lostReason ? { lostReason: values.lostReason } : {}),
      };
      setSaving(true);
      if (editing) {
        await updateDeal(editing.id, payload);
        message.success(t("crmPipeline.deals.updateSuccess"));
      } else {
        await createDeal(payload);
        message.success(t("crmPipeline.deals.createSuccess"));
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

  const remove = async (id) => {
    try {
      await deleteDeal(id);
      message.success(t("crmPipeline.deals.deleteSuccess"));
      load();
    } catch (err) {
      message.error(err?.response?.data?.message || t("crmPipeline.common.saveFailed"));
    }
  };

  const weighted = (row) => (Number(row.value || 0) * Number(row.probability || 0)) / 100;

  const columns = useMemo(() => [
    {
      title: t("crmPipeline.deals.deal"),
      dataIndex: "dealName",
      render: (name, row) => (
        <div>
          <Button
            type="link"
            size="small"
            style={{ padding: 0, fontWeight: 500 }}
            onClick={() => navigate(`/crm/deals/${row.id}`)}
          >
            {name}
          </Button>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
            {[row.organization?.name, row.contact?.fullName].filter(Boolean).join(" · ") || "—"}
          </div>
        </div>
      ),
    },
    {
      title: t("crmPipeline.fields.status"),
      dataIndex: "kind",
      width: 110,
      render: (v) => (
        <Tag color={DEAL_KIND_META[v]?.color}>{t(DEAL_KIND_META[v]?.labelKey || "")}</Tag>
      ),
    },
    {
      title: t("crmPipeline.fields.stage"),
      dataIndex: "stageId",
      width: 150,
      render: (_, row) => <StageTag stage={row.stage} />,
    },
    {
      title: t("crmPipeline.fields.value"),
      dataIndex: "value",
      width: 130,
      align: "right",
      render: (v, row) => (
        <div>
          <div style={{ fontWeight: 600 }}><MoneyDisplay value={v ?? 0} short /></div>
          {row.kind === "ONGOING" && row.probability > 0 && (
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
              {t("crmPipeline.deals.weighted", { prob: row.probability, value: shortMoney(weighted(row)) })}
            </div>
          )}
        </div>
      ),
    },
    {
      title: t("crmPipeline.fields.expectedCloseDate"),
      dataIndex: "expectedCloseDate",
      width: 140,
      render: (d) =>
        d ? (
          <span style={{ color: dayjs(d).isBefore(dayjs()) ? "var(--danger)" : undefined }}>
            {dayjs(d).format("DD/MM/YYYY")}
          </span>
        ) : (
          <span style={{ color: "var(--text-muted)" }}>—</span>
        ),
    },
    {
      title: t("crmPipeline.fields.owner"),
      width: 140,
      render: (_, row) => row.dealOwner?.fullName || <span style={{ color: "var(--text-muted)" }}>—</span>,
    },
    {
      title: t("crmPipeline.deals.order"),
      width: 130,
      render: (_, row) =>
        row.order ? (
          <Button
            type="link"
            size="small"
            style={{ padding: 0 }}
            onClick={() => navigate(`/orders/${row.orderId}`)}
          >
            {row.order.orderCode}
          </Button>
        ) : (
          <span style={{ color: "var(--text-muted)" }}>—</span>
        ),
    },
    {
      title: "",
      width: 90,
      align: "right",
      fixed: "right",
      render: (_, row) => (
        <Space size={0}>
          <Tooltip title={t("crmPipeline.deals.edit")}>
            <Button size="small" type="text" icon={<EditOutlined />} onClick={() => openEdit(row)} />
          </Tooltip>
          {row.orderId ? (
            <Tooltip title={t("crmPipeline.deals.deleteDisabled")}>
              <Button size="small" type="text" danger icon={<DeleteOutlined />} disabled />
            </Tooltip>
          ) : (
            <Popconfirm
              title={t("crmPipeline.deals.deleteConfirm")}
              onConfirm={() => remove(row.id)}
              okText={t("common.delete")}
              cancelText={t("common.cancel")}
            >
              <Button size="small" type="text" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ], [navigate]);

  return (
    <>
      <PageHeader
        title={t("crmPipeline.deals.title")}
        subtitle={
          isManager
            ? t("crmPipeline.deals.countAll", { count: total })
            : t("crmPipeline.deals.countMine", { count: total })
        }
        actions={
          <Space>
            <Tooltip title={t("crmPipeline.common.reload")}>
              <Button icon={<ReloadOutlined />} onClick={load} />
            </Tooltip>
            <Button icon={<AppstoreOutlined />} onClick={() => navigate("/crm/deals/board")}>
              {t("crmPipeline.deals.board")}
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              {t("crmPipeline.deals.create")}
            </Button>
          </Space>
        }
      />

      <div className="filters-bar">
        <Segmented
          value={kind}
          onChange={setKind}
          options={[
            { value: "ONGOING", label: t("crmPipeline.kind.ONGOING") },
            { value: "WON", label: t("crmPipeline.kind.WON") },
            { value: "LOST", label: t("crmPipeline.kind.LOST") },
            { value: "", label: t("crmPipeline.common.all") },
          ]}
        />
        <Input
          className="filters-bar__search"
          prefix={<SearchOutlined />}
          placeholder={t("crmPipeline.common.searchDeal")}
          allowClear
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select
          allowClear
          placeholder={t("crmPipeline.fields.stage")}
          style={{ width: 170 }}
          value={stageId}
          onChange={setStageId}
          options={stages.map((s) => ({ value: s.id, label: s.label }))}
        />
        <Select
          allowClear
          placeholder={t("crmPipeline.fields.organization")}
          style={{ width: 190 }}
          value={orgId}
          onChange={setOrgId}
          showSearch
          optionFilterProp="label"
          options={orgs.map((o) => ({ value: o.id, label: o.name }))}
        />
        {isManager && (
          <Select
            allowClear
            placeholder={t("crmPipeline.fields.owner")}
            style={{ width: 190 }}
            value={ownerId}
            onChange={setOwnerId}
            options={owners.map((o) => ({ value: o.id, label: `${o.fullName} (${o.role})` }))}
          />
        )}
      </div>

      <div className="table-card">
        <Table
          columns={columns}
          dataSource={data}
          rowKey="id"
          loading={loading}
          scroll={{ x: 1250 }}
          pagination={{
            current: page,
            pageSize: 20,
            total,
            showSizeChanger: false,
            onChange: (p) => setPage(p),
          }}
          locale={{
            emptyText: (
              <EmptyState
                title={t("crmPipeline.deals.empty")}
                description={t("crmPipeline.deals.emptyDesc")}
                actionText={t("crmPipeline.deals.createFirst")}
                onAction={openCreate}
              />
            ),
          }}
        />
      </div>

      <Modal
        title={editing ? t("crmPipeline.deals.edit") : t("crmPipeline.deals.create")}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={save}
        confirmLoading={saving}
        okText={t("common.save")}
        cancelText={t("common.cancel")}
        width={640}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            label={t("crmPipeline.fields.dealName")}
            name="dealName"
            rules={[{ required: true, message: t("crmPipeline.deals.nameRequired") }, { max: 200 }]}
          >
            <Input placeholder={t("crmPipeline.deals.namePlaceholder")} />
          </Form.Item>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Form.Item label={t("crmPipeline.fields.organization")} name="organizationId">
              <Select
                allowClear
                showSearch
                optionFilterProp="label"
                placeholder={t("crmPipeline.deals.orgPlaceholder")}
                options={orgs.map((o) => ({ value: o.id, label: o.name }))}
              />
            </Form.Item>
            <Form.Item
              label={t("crmPipeline.fields.leadName")}
              name="leadId"
              extra={t("crmPipeline.deals.leadExtra")}
            >
              <Select
                allowClear
                showSearch
                optionFilterProp="label"
                placeholder={t("crmPipeline.deals.leadPlaceholder")}
                options={leads.map((l) => ({ value: l.id, label: l.leadName }))}
              />
            </Form.Item>
            <Form.Item label={t("crmPipeline.fields.stage")} name="stageId">
              <Select
                allowClear
                placeholder={t("crmPipeline.common.notAssigned")}
                options={stages
                  .filter((s) => s.isActive !== false)
                  .map((s) => ({
                    value: s.id,
                    label: t("crmPipeline.deals.stageWithProb", { label: s.label, prob: s.probability }),
                  }))}
              />
            </Form.Item>
            <Form.Item label={t("crmPipeline.fields.expectedCloseDate")} name="expectedCloseDate">
              <DatePicker style={{ width: "100%" }} format="DD/MM/YYYY" />
            </Form.Item>
            <Form.Item label={t("crmPipeline.fields.value")} name="value">
              <InputNumber
                min={0}
                step={1000000}
                style={{ width: "100%" }}
                formatter={(v) => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ".")}
                parser={(v) => v?.replace(/\./g, "")}
                placeholder="0"
              />
            </Form.Item>
            <Form.Item label={t("crmPipeline.fields.currency")} name="currency">
              <Select options={[{ value: "VND", label: "VND" }, { value: "USD", label: "USD" }]} />
            </Form.Item>
            {isManager && (
              <Form.Item label={t("crmPipeline.fields.owner")} name="dealOwnerId">
                <Select
                  allowClear
                  placeholder={t("crmPipeline.common.notOwner")}
                  options={owners.map((o) => ({ value: o.id, label: `${o.fullName} (${o.role})` }))}
                />
              </Form.Item>
            )}
            {editing && editing.kind === "LOST" && (
              <Form.Item label={t("crmPipeline.fields.lostReason")} name="lostReason">
                <Input placeholder={t("crmPipeline.deals.lostReasonPlaceholder")} maxLength={500} />
              </Form.Item>
            )}
          </div>
          <Form.Item label={t("crmPipeline.fields.nextStep")} name="nextStep">
            <Input placeholder={t("crmPipeline.deals.nextStepPlaceholder")} maxLength={500} />
          </Form.Item>
          {editing && (
            <Card size="small" type="inner" style={{ marginTop: 4 }}>
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                <div style={{ fontWeight: 600, marginBottom: 2 }}>
                  {t("crmPipeline.deals.itemsHintTitle")}
                </div>
                {t("crmPipeline.deals.itemsHintDesc")}
              </div>
            </Card>
          )}
        </Form>
      </Modal>
    </>
  );
}
