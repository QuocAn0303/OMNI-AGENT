/**
 * Frontend: src/pages/crm/Leads.jsx — Danh sách Lead (CRM Sales Pipeline)
 *
 * Tổng quan:
 * - Bảng lead phân trang (GET /crm/leads) với bộ lọc: trạng thái, giai đoạn,
 *   người phụ trách, nguồn, tìm kiếm, chỉ "quá hạn" (chưa liên hệ > 7 ngày).
 * - Metadata form/lọc lấy từ GET /crm/leads/fields (statuses, stages, sources, owners)
 *   → không hardcode enum ở FE.
 * - Phân quyền (xem `src/modules/crm/scope.js`): CASHIER chỉ thấy lead của mình
 *   và backend **từ chối** mọi filter `leadOwnerId` của người khác → FE chỉ hiện
 *   ô chọn người phụ trách cho MANAGER/ADMIN.
 * - Modal tạo/sửa + modal nhập hàng loạt (POST /crm/leads/import, backend tự bỏ qua
 *   lead trùng SĐT/email, trả về `skipped[]` để hiển thị).
 * - Xoá bị chặn (409) nếu lead đã chuyển thành Deal → UI ẩn nút xoá cho lead đã convert.
 * - Toàn bộ nhãn lấy từ `crmPipeline.leads.*` (vi.json + en.json đồng bộ).
 *
 * State: filters, data, total, page, loading, modal (tạo/sửa), import modal
 * Exports: Leads (default)
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Table, Button, Tag, Modal, Form, Input, InputNumber, Select, Space, Popconfirm, Tooltip,
  message, Segmented, Card, Alert,
} from "antd";
import {
  PlusOutlined, EditOutlined, DeleteOutlined, SearchOutlined,
  UploadOutlined, ReloadOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import PageHeader from "../../components/layout/PageHeader";
import EmptyState from "../../components/shared/EmptyState";
import MoneyDisplay from "../../components/shared/MoneyDisplay";
import StageTag from "../../components/crm/StageTag";
import useDebounce from "../../hooks/useDebounce";
import useAuthStore from "../../stores/authStore";
import {
  listLeads, createLead, updateLead, deleteLead, getLeadFields, importLeads,
} from "../../api/crm";
import { LEAD_STATUS_META, leadStatusOptions, UNASSIGNED_COLOR } from "../../components/crm/constants";

const OVERDUE_DAYS = 7;

export default function Leads() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const isManager = ["SUPER_ADMIN", "SUPER_OMEGA_ULTRA_ADMIN", "ADMIN", "MANAGER"].includes(user?.role);

  const [data, setData] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [fields, setFields] = useState({ statuses: [], stages: [], sources: [], owners: [] });

  const [scope, setScope] = useState("all"); // all | mine | overdue
  const [status, setStatus] = useState();
  const [stageId, setStageId] = useState();
  const [ownerId, setOwnerId] = useState();
  const [source, setSource] = useState();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importResult, setImportResult] = useState(null);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    getLeadFields()
      .then((res) =>
        setFields({
          statuses: res?.statuses || [],
          stages: res?.stages || [],
          sources: res?.sources || [],
          owners: res?.owners || [],
        }),
      )
      .catch(() => {});
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const params = { page, limit: 20 };
      if (status) params.status = status;
      if (stageId) params.stageId = stageId;
      if (source) params.source = source;
      if (scope === "mine") params.leadOwnerId = user?.id;
      if (scope === "overdue") params.overdue = 1;
      if (debouncedSearch) params.search = debouncedSearch;
      // Chỉ role quản lý mới được lọc theo owner khác (backend tự bỏ qua nếu không)
      if (isManager && ownerId) params.leadOwnerId = ownerId;

      const res = await listLeads(params);
      setData(res.data || []);
      setTotal(res.pagination?.total || 0);
    } catch (err) {
      message.error(err?.response?.data?.message || t("crmPipeline.common.loadFailed"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [page, scope, status, stageId, ownerId, source, debouncedSearch]);
  useEffect(() => { setPage(1); }, [scope, status, stageId, ownerId, source, debouncedSearch]);

  const overdueDays = fields.overdueDays || OVERDUE_DAYS;

  /** Option stage kèm màu để Select render dot */
  const stageOptions = useMemo(
    () =>
      fields.stages.map((s) => ({
        value: s.id,
        label: s.label,
        dot: s.color || UNASSIGNED_COLOR,
      })),
    [fields.stages],
  );

  const dotOption = (opt) => (
    <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span className="crm-stage__dot" style={{ background: opt.data?.dot || UNASSIGNED_COLOR }} />
      {opt.label}
    </span>
  );

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ status: "NEW", leadOwnerId: isManager ? undefined : user?.id });
    setModalOpen(true);
  };

  const openEdit = (row) => {
    setEditing(row);
    form.setFieldsValue({
      leadName: row.leadName,
      email: row.email,
      mobileNo: row.mobileNo,
      jobTitle: row.jobTitle,
      source: row.source,
      status: row.status,
      stageId: row.stageId || undefined,
      leadOwnerId: row.leadOwnerId || undefined,
      organizationId: row.organizationId || undefined,
      expectedValue: row.expectedValue != null ? Number(row.expectedValue) : null,
      notes: row.notes,
    });
    setModalOpen(true);
  };

  const save = async () => {
    try {
      const values = await form.validateFields();
      const payload = {
        leadName: values.leadName?.trim(),
        email: values.email || null,
        mobileNo: values.mobileNo || null,
        jobTitle: values.jobTitle || null,
        source: values.source || null,
        status: values.status,
        stageId: values.stageId || null,
        leadOwnerId: values.leadOwnerId || null,
        expectedValue: values.expectedValue || 0,
        notes: values.notes || null,
      };
      setSaving(true);
      if (editing) {
        await updateLead(editing.id, payload);
        message.success(t("crmPipeline.leads.updateSuccess"));
      } else {
        await createLead(payload);
        message.success(t("crmPipeline.leads.createSuccess"));
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
      await deleteLead(id);
      message.success(t("crmPipeline.leads.deleteSuccess"));
      load();
    } catch (err) {
      message.error(err?.response?.data?.message || t("crmPipeline.common.saveFailed"));
    }
  };

  const isOverdue = (row) =>
    row.status !== "CONVERTED" &&
    row.status !== "DEAD" &&
    row.lastContactedAt &&
    dayjs(row.lastContactedAt).isBefore(dayjs().subtract(overdueDays, "day"));

  const columns = useMemo(() => [
    {
      title: t("crmPipeline.leads.lead"),
      dataIndex: "leadName",
      render: (name, row) => (
        <div>
          <Button
            type="link"
            size="small"
            style={{ padding: 0, fontWeight: 500 }}
            onClick={() => navigate(`/crm/leads/${row.id}`)}
          >
            {name}
          </Button>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
            {[row.mobileNo, row.email].filter(Boolean).join(" · ") || "—"}
          </div>
        </div>
      ),
    },
    {
      title: t("crmPipeline.fields.status"),
      dataIndex: "status",
      width: 130,
      render: (v) => <Tag color={LEAD_STATUS_META[v]?.color}>{t(LEAD_STATUS_META[v]?.labelKey || "")}</Tag>,
    },
    {
      title: t("crmPipeline.fields.stage"),
      dataIndex: "stageId",
      width: 160,
      render: (_, row) => <StageTag stage={row.stage} status={row.status} />,
    },
    {
      title: t("crmPipeline.fields.source"),
      dataIndex: "source",
      width: 110,
      render: (v) => v || <span style={{ color: "var(--text-muted)" }}>—</span>,
    },
    {
      title: t("crmPipeline.leads.expected"),
      dataIndex: "expectedValue",
      width: 120,
      align: "right",
      render: (v) => <MoneyDisplay value={v ?? 0} short />,
    },
    {
      title: t("crmPipeline.fields.owner"),
      width: 140,
      render: (_, row) => row.leadOwner?.fullName || <span style={{ color: "var(--text-muted)" }}>—</span>,
    },
    {
      title: t("crmPipeline.fields.lastContacted"),
      dataIndex: "lastContactedAt",
      width: 150,
      render: (d, row) => {
        if (!d) {
          return (
            <span style={{ color: "var(--text-muted)" }}>{t("crmPipeline.leads.lastContactedNone")}</span>
          );
        }
        const overdue = isOverdue(row);
        return (
          <span style={{ color: overdue ? "var(--danger)" : undefined, fontWeight: overdue ? 600 : undefined }}>
            {dayjs(d).format("DD/MM/YYYY")}
            {overdue && " ⚠"}
          </span>
        );
      },
    },
    {
      title: "",
      width: 90,
      align: "right",
      fixed: "right",
      render: (_, row) => (
        <Space size={0}>
          <Tooltip title={t("crmPipeline.leads.edit")}>
            <Button size="small" type="text" icon={<EditOutlined />} onClick={() => openEdit(row)} />
          </Tooltip>
          {row.status !== "CONVERTED" && !row.deals?.length ? (
            <Popconfirm
              title={t("crmPipeline.leads.deleteConfirm")}
              description={t("crmPipeline.leads.deleteConfirmDesc")}
              onConfirm={() => remove(row.id)}
              okText={t("common.delete")}
              cancelText={t("common.cancel")}
            >
              <Button size="small" type="text" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          ) : (
            <Tooltip title={t("crmPipeline.leads.deleteDisabled")}>
              <Button size="small" type="text" danger icon={<DeleteOutlined />} disabled />
            </Tooltip>
          )}
        </Space>
      ),
    },
  ], [navigate, overdueDays]);

  // ----- Import hàng loạt: mỗi dòng "Tên | SĐT | Email | Nguồn | Chức danh" -----
  const parseImportText = (text) =>
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [leadName, mobileNo, email, src, jobTitle] = line.split("|").map((s) => (s || "").trim());
        return { leadName, mobileNo, email, source: src || "IMPORT", jobTitle: jobTitle || null };
      })
      .filter((r) => r.leadName);

  const doImport = async () => {
    const leads = parseImportText(importText);
    if (!leads.length) {
      message.warning(t("crmPipeline.leads.importNoValid"));
      return;
    }
    setImporting(true);
    try {
      const res = await importLeads(leads);
      setImportResult(res);
      message.success(t("crmPipeline.leads.importCreated", { created: res.createdCount, total: res.total }));
      load();
    } catch (err) {
      message.error(err?.response?.data?.message || t("crmPipeline.common.saveFailed"));
    } finally {
      setImporting(false);
    }
  };

  return (
    <>
      <PageHeader
        title={t("crmPipeline.leads.title")}
        subtitle={
          isManager
            ? t("crmPipeline.leads.countAll", { count: total })
            : t("crmPipeline.leads.countMine", { count: total })
        }
        actions={
          <Space>
            <Tooltip title={t("crmPipeline.common.reload")}>
              <Button icon={<ReloadOutlined />} onClick={load} />
            </Tooltip>
            <Button
              icon={<UploadOutlined />}
              onClick={() => { setImportResult(null); setImportOpen(true); }}
            >
              {t("crmPipeline.leads.import")}
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              {t("crmPipeline.leads.create")}
            </Button>
          </Space>
        }
      />

      <div className="filters-bar">
        <Segmented
          value={scope}
          onChange={setScope}
          options={
            isManager
              ? [
                  { value: "all", label: t("crmPipeline.common.all") },
                  { value: "mine", label: t("crmPipeline.common.mine") },
                  { value: "overdue", label: t("crmPipeline.common.overdueDays", { days: overdueDays }) },
                ]
              : [
                  { value: "all", label: t("crmPipeline.common.mine") },
                  { value: "overdue", label: t("crmPipeline.common.overdue") },
                ]
          }
        />
        <Input
          className="filters-bar__search"
          prefix={<SearchOutlined />}
          placeholder={t("crmPipeline.common.searchLead")}
          allowClear
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select
          allowClear
          placeholder={t("crmPipeline.fields.status")}
          style={{ width: 150 }}
          value={status}
          onChange={setStatus}
          options={leadStatusOptions(t)}
        />
        <Select
          allowClear
          placeholder={t("crmPipeline.fields.stage")}
          style={{ width: 170 }}
          value={stageId}
          onChange={setStageId}
          options={stageOptions.map(({ value, label }) => ({ value, label }))}
          optionRender={dotOption}
        />
        {isManager && (
          <Select
            allowClear
            placeholder={t("crmPipeline.fields.owner")}
            style={{ width: 180 }}
            value={ownerId}
            onChange={setOwnerId}
            options={fields.owners.map((o) => ({ value: o.id, label: `${o.fullName} (${o.role})` }))}
          />
        )}
        <Select
          allowClear
          placeholder={t("crmPipeline.fields.source")}
          style={{ width: 150 }}
          value={source}
          onChange={setSource}
          options={fields.sources.map((s) => ({ value: s, label: s }))}
        />
      </div>

      <div className="table-card">
        <Table
          columns={columns}
          dataSource={data}
          rowKey="id"
          loading={loading}
          scroll={{ x: 1200 }}
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
                title={t("crmPipeline.leads.empty")}
                description={t("crmPipeline.leads.emptyDesc")}
                actionText={t("crmPipeline.leads.createFirst")}
                onAction={openCreate}
              />
            ),
          }}
        />
      </div>

      {/* Modal tạo / sửa */}
      <Modal
        title={editing ? t("crmPipeline.leads.edit") : t("crmPipeline.leads.create")}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={save}
        confirmLoading={saving}
        okText={t("common.save")}
        cancelText={t("common.cancel")}
        width={620}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            label={t("crmPipeline.fields.leadName")}
            name="leadName"
            rules={[{ required: true, message: t("crmPipeline.leads.nameRequired") }, { max: 200 }]}
          >
            <Input placeholder={t("crmPipeline.leads.namePlaceholder")} />
          </Form.Item>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Form.Item
              label={t("crmPipeline.fields.phone")}
              name="mobileNo"
              rules={[{ min: 8, message: t("crmPipeline.leads.phoneMin") }]}
            >
              <Input placeholder={t("crmPipeline.leads.phonePlaceholder")} />
            </Form.Item>
            <Form.Item
              label={t("crmPipeline.fields.email")}
              name="email"
              rules={[{ type: "email", message: t("crmPipeline.leads.emailInvalid") }]}
            >
              <Input placeholder={t("crmPipeline.leads.emailPlaceholder")} />
            </Form.Item>
            <Form.Item label={t("crmPipeline.fields.jobTitle")} name="jobTitle">
              <Input placeholder={t("crmPipeline.leads.jobPlaceholder")} />
            </Form.Item>
            <Form.Item label={t("crmPipeline.fields.source")} name="source">
              <Select
                allowClear
                showSearch
                placeholder={t("crmPipeline.leads.sourcePlaceholder")}
                options={fields.sources.map((s) => ({ value: s, label: s }))}
                mode="tags"
                maxCount={1}
                onChange={(v) => form.setFieldsValue({ source: v?.[0] || null })}
              />
            </Form.Item>
            <Form.Item label={t("crmPipeline.fields.status")} name="status">
              <Select options={leadStatusOptions(t)} />
            </Form.Item>
            <Form.Item label={t("crmPipeline.fields.stage")} name="stageId">
              <Select
                allowClear
                placeholder={t("crmPipeline.common.notAssigned")}
                options={stageOptions}
                optionRender={dotOption}
              />
            </Form.Item>
            {isManager && (
              <Form.Item label={t("crmPipeline.fields.owner")} name="leadOwnerId">
                <Select
                  allowClear
                  placeholder={t("crmPipeline.common.notOwner")}
                  options={fields.owners.map((o) => ({ value: o.id, label: `${o.fullName} (${o.role})` }))}
                />
              </Form.Item>
            )}
            <Form.Item label={t("crmPipeline.fields.expectedValue")} name="expectedValue">
              <InputNumber
                min={0}
                step={1000000}
                style={{ width: "100%" }}
                formatter={(v) => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ".")}
                parser={(v) => v?.replace(/\./g, "")}
                placeholder="0"
              />
            </Form.Item>
          </div>
          <Form.Item label={t("crmPipeline.fields.notes")} name="notes">
            <Input.TextArea rows={3} maxLength={5000} />
          </Form.Item>
        </Form>
      </Modal>

      {/* Modal nhập hàng loạt */}
      <Modal
        title={t("crmPipeline.leads.importTitle")}
        open={importOpen}
        onCancel={() => setImportOpen(false)}
        onOk={doImport}
        confirmLoading={importing}
        okText={t("common.import")}
        cancelText={t("common.cancel")}
        width={680}
        destroyOnHidden
      >
        <Alert
          type="info"
          showIcon
          style={{ margin: "16px 0" }}
          message={t("crmPipeline.leads.importHintTitle")}
          description={t("crmPipeline.leads.importHintDesc")}
        />
        <Input.TextArea
          rows={10}
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
          placeholder={t("crmPipeline.leads.importPlaceholder")}
        />
        {importResult && (
          <Card size="small" style={{ marginTop: 16 }} title={t("crmPipeline.leads.importResultTitle")}>
            <div>
              {t("crmPipeline.leads.importCreated", { created: importResult.createdCount, total: importResult.total })}
            </div>
            {importResult.skipped?.length > 0 && (
              <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-muted)" }}>
                <div>{t("crmPipeline.leads.importSkipped", { count: importResult.skipped.length })}</div>
                <ul style={{ margin: "4px 0 0 16px" }}>
                  {importResult.skipped.slice(0, 8).map((s, i) => (
                    <li key={i}>
                      {t("crmPipeline.leads.importSkippedRow", { row: s.index + 1, reason: s.reason })}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card>
        )}
      </Modal>
    </>
  );
}
