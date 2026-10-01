/**
 * Frontend: src/pages/crm/Organizations.jsx — Danh sách tổ chức (công ty) CRM
 *
 * Tổng quan:
 * - Bảng tổ chức phân trang (GET /crm/organizations) + tìm kiếm + hiện tổ chức đã ẩn.
 * - Cột liên kết cho biết số liên hệ / deal / lead đang gắn (backend trả `_count`).
 * - Bấm tên tổ chức → modal chi tiết kèm danh sách liên hệ + deal.
 * - Quyền: xem cho ADMIN/MANAGER/CASHIER; sửa/xoá chỉ ADMIN/MANAGER
 *   (backend chặt bằng `authorize`) → FE ẩn nút khi role không đủ.
 * - Xoá là **soft delete** (`isActive=false`); backend chặn (409) nếu còn liên kết.
 *
 * Exports: Organizations (default)
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Table, Button, Tag, Modal, Form, Input, InputNumber, Space, Popconfirm, Tooltip,
  message, Card, Descriptions, Switch, Tabs, Empty,
} from "antd";
import {
  PlusOutlined, EditOutlined, DeleteOutlined, SearchOutlined, ReloadOutlined,
  GlobalOutlined, PhoneOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import PageHeader from "../../components/layout/PageHeader";
import EmptyState from "../../components/shared/EmptyState";
import MoneyDisplay from "../../components/shared/MoneyDisplay";
import useDebounce from "../../hooks/useDebounce";
import useAuthStore from "../../stores/authStore";
import {
  listOrganizations, getOrganization, createOrganization, updateOrganization, deleteOrganization,
} from "../../api/crm";
import { DEAL_KIND_META } from "../../components/crm/constants";

export default function Organizations() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const canEdit = ["SUPER_ADMIN", "SUPER_OMEGA_ULTRA_ADMIN", "ADMIN", "MANAGER"].includes(user?.role);

  const [data, setData] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [includeInactive, setIncludeInactive] = useState(false);
  const debouncedSearch = useDebounce(search, 300);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await listOrganizations({
        page,
        limit: 20,
        ...(debouncedSearch ? { search: debouncedSearch } : {}),
        ...(includeInactive ? { includeInactive: 1 } : {}),
      });
      setData(res.data || []);
      setTotal(res.pagination?.total || 0);
    } catch (err) {
      message.error(err?.response?.data?.message || t("crmPipeline.common.loadFailed"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [page, debouncedSearch, includeInactive]);
  useEffect(() => { setPage(1); }, [debouncedSearch, includeInactive]);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ isActive: true });
    setModalOpen(true);
  };

  const openEdit = (row) => {
    setEditing(row);
    form.setFieldsValue({
      name: row.name,
      website: row.website,
      industry: row.industry,
      annualRevenue: row.annualRevenue != null ? Number(row.annualRevenue) : null,
      taxCode: row.taxCode,
      phone: row.phone,
      address: row.address,
      notes: row.notes,
      isActive: row.isActive,
    });
    setModalOpen(true);
  };

  const save = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      if (editing) {
        await updateOrganization(editing.id, values);
        message.success(t("crmPipeline.organizations.updateSuccess"));
      } else {
        await createOrganization(values);
        message.success(t("crmPipeline.organizations.createSuccess"));
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
      await deleteOrganization(id);
      message.success(t("crmPipeline.organizations.hideSuccess"));
      load();
    } catch (err) {
      message.error(err?.response?.data?.message || t("crmPipeline.common.saveFailed"));
    }
  };

  const openDetail = async (id) => {
    setDetailLoading(true);
    try {
      setDetail(await getOrganization(id));
    } catch (err) {
      message.error(err?.response?.data?.message || t("crmPipeline.common.loadFailed"));
    } finally {
      setDetailLoading(false);
    }
  };

  const columns = useMemo(() => [
    {
      title: t("crmPipeline.fields.organization"),
      dataIndex: "name",
      render: (name, row) => (
        <div>
          <Button
            type="link"
            size="small"
            style={{ padding: 0, fontWeight: 500 }}
            onClick={() => openDetail(row.id)}
          >
            {name}
          </Button>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
            {[row.industry, row.taxCode].filter(Boolean).join(" · ") || "—"}
          </div>
        </div>
      ),
    },
    {
      title: t("crmPipeline.fields.phone"),
      width: 140,
      render: (_, row) => (
        <Space size={4}>
          <PhoneOutlined /> {row.phone || <span style={{ color: "var(--text-muted)" }}>—</span>}
        </Space>
      ),
    },
    {
      title: t("crmPipeline.organizations.website"),
      dataIndex: "website",
      width: 160,
      render: (v) =>
        v ? (
          <a href={v.startsWith("http") ? v : `https://${v}`} target="_blank" rel="noreferrer">
            <GlobalOutlined /> {v.replace(/^https?:\/\//, "")}
          </a>
        ) : (
          <span style={{ color: "var(--text-muted)" }}>—</span>
        ),
    },
    {
      title: t("crmPipeline.organizations.revenue"),
      dataIndex: "annualRevenue",
      width: 140,
      align: "right",
      render: (v) =>
        v != null ? <MoneyDisplay value={v} short /> : <span style={{ color: "var(--text-muted)" }}>—</span>,
    },
    {
      title: t("crmPipeline.organizations.links"),
      width: 180,
      render: (_, row) => (
        <Space size={4} wrap>
          <Tag>{t("crmPipeline.organizations.cntContact", { n: row._count?.contacts ?? 0 })}</Tag>
          <Tag color="blue">{t("crmPipeline.organizations.cntDeal", { n: row._count?.deals ?? 0 })}</Tag>
          <Tag color="purple">{t("crmPipeline.organizations.cntLead", { n: row._count?.leads ?? 0 })}</Tag>
        </Space>
      ),
    },
    {
      title: t("crmPipeline.organizations.status"),
      dataIndex: "isActive",
      width: 110,
      render: (v) =>
        v ? (
          <Tag color="success">{t("crmPipeline.organizations.active")}</Tag>
        ) : (
          <Tag color="default">{t("crmPipeline.organizations.hidden")}</Tag>
        ),
    },
    {
      title: "",
      width: 90,
      align: "right",
      fixed: "right",
      render: (_, row) =>
        canEdit ? (
          <Space size={0}>
            <Tooltip title={t("crmPipeline.organizations.edit")}>
              <Button size="small" type="text" icon={<EditOutlined />} onClick={() => openEdit(row)} />
            </Tooltip>
            {row.isActive && (
              <Popconfirm
                title={t("crmPipeline.organizations.hideConfirm")}
                description={t("crmPipeline.organizations.hideConfirmDesc")}
                onConfirm={() => remove(row.id)}
                okText={t("crmPipeline.organizations.ok")}
                cancelText={t("common.cancel")}
              >
                <Button size="small" type="text" danger icon={<DeleteOutlined />} />
              </Popconfirm>
            )}
          </Space>
        ) : null,
    },
  ], [canEdit]);

  return (
    <>
      <PageHeader
        title={t("crmPipeline.organizations.title")}
        subtitle={t("crmPipeline.organizations.count", { count: total })}
        actions={
          <Space>
            <Tooltip title={t("crmPipeline.common.reload")}>
              <Button icon={<ReloadOutlined />} onClick={load} />
            </Tooltip>
            {canEdit && (
              <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
                {t("crmPipeline.organizations.create")}
              </Button>
            )}
          </Space>
        }
      />

      <div className="filters-bar">
        <Input
          className="filters-bar__search"
          prefix={<SearchOutlined />}
          placeholder={t("crmPipeline.common.searchOrg")}
          allowClear
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Space size={6}>
          <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
            {t("crmPipeline.organizations.showInactive")}
          </span>
          <Switch checked={includeInactive} onChange={setIncludeInactive} />
        </Space>
      </div>

      <div className="table-card">
        <Table
          columns={columns}
          dataSource={data}
          rowKey="id"
          loading={loading}
          scroll={{ x: 1150 }}
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
                title={t("crmPipeline.organizations.empty")}
                description={t("crmPipeline.organizations.emptyDesc")}
                action={
                  canEdit ? (
                    <Button type="primary" onClick={openCreate}>
                      {t("crmPipeline.organizations.createFirst")}
                    </Button>
                  ) : null
                }
              />
            ),
          }}
        />
      </div>

      {/* Modal tạo / sửa */}
      <Modal
        title={editing ? t("crmPipeline.organizations.edit") : t("crmPipeline.organizations.create")}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={save}
        confirmLoading={saving}
        okText={t("common.save")}
        cancelText={t("common.cancel")}
        width={600}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            label={t("crmPipeline.fields.organization")}
            name="name"
            rules={[{ required: true, message: t("crmPipeline.organizations.nameRequired") }, { max: 200 }]}
            extra={t("crmPipeline.organizations.nameExtra")}
          >
            <Input placeholder={t("crmPipeline.organizations.namePlaceholder")} />
          </Form.Item>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Form.Item label={t("crmPipeline.fields.industry")} name="industry">
              <Input placeholder={t("crmPipeline.organizations.industryPlaceholder")} />
            </Form.Item>
            <Form.Item label={t("crmPipeline.fields.taxCode")} name="taxCode" rules={[{ max: 50 }]}>
              <Input placeholder="0312345678" />
            </Form.Item>
            <Form.Item label={t("crmPipeline.fields.website")} name="website" rules={[{ max: 300 }]}>
              <Input placeholder="aduu.vn" />
            </Form.Item>
            <Form.Item
              label={t("crmPipeline.fields.phone")}
              name="phone"
              rules={[{ min: 8, message: t("crmPipeline.organizations.phoneMin") }, { max: 20 }]}
            >
              <Input placeholder={t("crmPipeline.organizations.phonePlaceholder")} />
            </Form.Item>
            <Form.Item label={t("crmPipeline.fields.annualRevenue")} name="annualRevenue">
              <InputNumber
                min={0}
                style={{ width: "100%" }}
                formatter={(v) => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ".")}
                parser={(v) => v?.replace(/\./g, "")}
                placeholder="0"
              />
            </Form.Item>
            {editing && (
              <Form.Item label={t("crmPipeline.organizations.status")} name="isActive" valuePropName="checked">
                <Switch checkedChildren={t("crmPipeline.organizations.active")} unCheckedChildren={t("crmPipeline.organizations.hidden")} />
              </Form.Item>
            )}
          </div>
          <Form.Item label={t("crmPipeline.fields.address")} name="address" rules={[{ max: 500 }]}>
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item label={t("crmPipeline.fields.notes")} name="notes" rules={[{ max: 5000 }]}>
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>

      {/* Modal chi tiết + liên hệ/deal */}
      <Modal
        title={detail?.name || t("crmPipeline.organizations.detail")}
        open={!!detail || detailLoading}
        onCancel={() => setDetail(null)}
        footer={null}
        width={760}
      >
        {detail && (
          <Tabs
            defaultActiveKey="info"
            items={[
              {
                key: "info",
                label: t("crmPipeline.organizations.tabInfo"),
                children: (
                  <>
                    <Descriptions bordered size="small" column={2}>
                      <Descriptions.Item label={t("crmPipeline.fields.industry")}>
                        {detail.industry || "—"}
                      </Descriptions.Item>
                      <Descriptions.Item label={t("crmPipeline.fields.taxCode")}>
                        {detail.taxCode || "—"}
                      </Descriptions.Item>
                      <Descriptions.Item label={t("crmPipeline.fields.website")}>
                        {detail.website || "—"}
                      </Descriptions.Item>
                      <Descriptions.Item label={t("crmPipeline.fields.phone")}>
                        {detail.phone || "—"}
                      </Descriptions.Item>
                      <Descriptions.Item label={t("crmPipeline.fields.annualRevenue")} span={2}>
                        <MoneyDisplay value={detail.annualRevenue ?? 0} />
                      </Descriptions.Item>
                      <Descriptions.Item label={t("crmPipeline.fields.address")} span={2}>
                        {detail.address || "—"}
                      </Descriptions.Item>
                      <Descriptions.Item label={t("crmPipeline.organizations.created")} span={2}>
                        {dayjs(detail.createdAt).format("DD/MM/YYYY HH:mm")}
                      </Descriptions.Item>
                    </Descriptions>
                    {detail.notes && (
                      <Card size="small" style={{ marginTop: 12 }} title={t("crmPipeline.organizations.note")}>
                        <div style={{ whiteSpace: "pre-wrap" }}>{detail.notes}</div>
                      </Card>
                    )}
                  </>
                ),
              },
              {
                key: "contacts",
                label: t("crmPipeline.organizations.tabContacts", { count: detail.contacts?.length || 0 }),
                children: !detail.contacts?.length ? (
                  <Empty description={t("crmPipeline.organizations.noContacts")} />
                ) : (
                  <Table
                    size="small"
                    rowKey="id"
                    pagination={false}
                    dataSource={detail.contacts}
                    columns={[
                      { title: t("crmPipeline.fields.fullName"), dataIndex: "fullName" },
                      { title: t("crmPipeline.fields.jobTitle"), dataIndex: "jobTitle" },
                      { title: t("crmPipeline.fields.phone"), dataIndex: "phone" },
                      { title: t("crmPipeline.fields.email"), dataIndex: "email" },
                      {
                        title: "",
                        width: 100,
                        render: (_, c) =>
                          c.isPrimary ? (
                            <Tag color="gold">{t("crmPipeline.organizations.primary")}</Tag>
                          ) : !c.isActive ? (
                            <Tag>{t("crmPipeline.organizations.hidden")}</Tag>
                          ) : null,
                      },
                    ]}
                  />
                ),
              },
              {
                key: "deals",
                label: t("crmPipeline.organizations.tabDeals", { count: detail.deals?.length || 0 }),
                children: !detail.deals?.length ? (
                  <Empty description={t("crmPipeline.organizations.noDeals")} />
                ) : (
                  <Table
                    size="small"
                    rowKey="id"
                    pagination={false}
                    dataSource={detail.deals}
                    columns={[
                      { title: t("crmPipeline.deals.deal"), dataIndex: "dealName" },
                      {
                        title: t("crmPipeline.fields.value"),
                        dataIndex: "value",
                        align: "right",
                        render: (v) => <MoneyDisplay value={v} short />,
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
                        title: t("crmPipeline.fields.expectedCloseDate"),
                        dataIndex: "expectedCloseDate",
                        width: 130,
                        render: (d) => (d ? dayjs(d).format("DD/MM/YYYY") : "—"),
                      },
                    ]}
                  />
                ),
              },
            ]}
          />
        )}
      </Modal>
    </>
  );
}
