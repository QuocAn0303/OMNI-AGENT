/**
 * Frontend: src/pages/crm/Contacts.jsx — Danh sách liên hệ (CrmContact)
 *
 * Tổng quan:
 * - Bảng liên hệ phân trang (GET /crm/contacts) + lọc theo tổ chức + tìm kiếm.
 * - `isPrimary` = đầu mối chính của tổ chức (backend đảm bảo mỗi tổ chức tối đa
 *   1 primary qua transaction) → nút "Đặt làm chính".
 * - Số điện thoại KHÔNG unique (khác `Customer`): 1 số có thể làm liên hệ ở
 *   nhiều tổ chức (đại lý, nhà cung cấp) → modal form hiện cảnh báo.
 * - `customerId` là cầu nối sang `Customer` (khách hàng giao dịch) — hiển thị
 *   link tới trang khách hàng.
 * - Quyền: xem cho ADMIN/MANAGER/CASHIER; tạo/sửa/đặt chính/ẩn chỉ ADMIN/MANAGER.
 *
 * Exports: Contacts (default)
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Table, Button, Tag, Modal, Form, Input, Select, Space, Popconfirm, Tooltip,
  message, Switch, Alert,
} from "antd";
import {
  PlusOutlined, EditOutlined, DeleteOutlined, SearchOutlined, ReloadOutlined, StarOutlined,
} from "@ant-design/icons";
import PageHeader from "../../components/layout/PageHeader";
import EmptyState from "../../components/shared/EmptyState";
import useDebounce from "../../hooks/useDebounce";
import useAuthStore from "../../stores/authStore";
import {
  listContacts, createContact, updateContact, setPrimaryContact, deleteContact, listOrganizations,
} from "../../api/crm";

export default function Contacts() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const canEdit = ["SUPER_ADMIN", "SUPER_OMEGA_ULTRA_ADMIN", "ADMIN", "MANAGER"].includes(user?.role);

  const [data, setData] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [orgs, setOrgs] = useState([]);
  const [orgId, setOrgId] = useState();
  const [search, setSearch] = useState("");
  const [includeInactive, setIncludeInactive] = useState(false);
  const debouncedSearch = useDebounce(search, 300);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  useEffect(() => {
    listOrganizations({ page: 1, limit: 200 }).then((r) => setOrgs(r.data || [])).catch(() => {});
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const res = await listContacts({
        page,
        limit: 20,
        ...(orgId ? { organizationId: orgId } : {}),
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

  useEffect(() => { load(); }, [page, orgId, debouncedSearch, includeInactive]);
  useEffect(() => { setPage(1); }, [orgId, debouncedSearch, includeInactive]);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ organizationId: orgId, isActive: true, isPrimary: false });
    setModalOpen(true);
  };

  const openEdit = (row) => {
    setEditing(row);
    form.setFieldsValue({
      fullName: row.fullName,
      email: row.email,
      phone: row.phone,
      jobTitle: row.jobTitle,
      organizationId: row.organizationId || undefined,
      isPrimary: row.isPrimary,
      isActive: row.isActive,
      notes: row.notes,
    });
    setModalOpen(true);
  };

  const save = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      if (editing) {
        await updateContact(editing.id, values);
        message.success(t("crmPipeline.contacts.updateSuccess"));
      } else {
        await createContact(values);
        message.success(t("crmPipeline.contacts.createSuccess"));
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

  const setPrimary = async (id) => {
    try {
      await setPrimaryContact(id);
      message.success(t("crmPipeline.contacts.primarySuccess"));
      load();
    } catch (err) {
      message.error(err?.response?.data?.message || t("crmPipeline.common.saveFailed"));
    }
  };

  const remove = async (id) => {
    try {
      await deleteContact(id);
      message.success(t("crmPipeline.contacts.hideSuccess"));
      load();
    } catch (err) {
      message.error(err?.response?.data?.message || t("crmPipeline.common.saveFailed"));
    }
  };

  const columns = useMemo(() => [
    {
      title: t("crmPipeline.fields.fullName"),
      dataIndex: "fullName",
      render: (name, row) => (
        <div>
          <Space size={6}>
            <span style={{ fontWeight: 500 }}>{name}</span>
            {row.isPrimary && <Tag color="gold" icon={<StarOutlined />}>{t("crmPipeline.organizations.primary")}</Tag>}
            {!row.isActive && <Tag>{t("crmPipeline.organizations.hidden")}</Tag>}
          </Space>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
            {[row.jobTitle, row.organization?.name].filter(Boolean).join(" · ") || "—"}
          </div>
        </div>
      ),
    },
    {
      title: t("crmPipeline.fields.phone"),
      dataIndex: "phone",
      width: 140,
      render: (v) => v || <span style={{ color: "var(--text-muted)" }}>—</span>,
    },
    {
      title: t("crmPipeline.fields.email"),
      dataIndex: "email",
      width: 200,
      render: (v) => v || <span style={{ color: "var(--text-muted)" }}>—</span>,
    },
    {
      title: t("crmPipeline.fields.organization"),
      width: 180,
      render: (_, row) => row.organization?.name || <span style={{ color: "var(--text-muted)" }}>—</span>,
    },
    {
      title: t("crmPipeline.fields.customer"),
      width: 150,
      render: (_, row) =>
        row.customer ? (
          <Button
            type="link"
            size="small"
            style={{ padding: 0 }}
            onClick={() => navigate(`/customers/${row.customerId}`)}
          >
            {row.customer.name}
          </Button>
        ) : (
          <span style={{ color: "var(--text-muted)" }}>—</span>
        ),
    },
    {
      title: "",
      width: 120,
      align: "right",
      fixed: "right",
      render: (_, row) =>
        canEdit ? (
          <Space size={0}>
            {!row.isPrimary && row.organizationId && (
              <Tooltip title={t("crmPipeline.contacts.setPrimaryTip")}>
                <Button size="small" type="text" icon={<StarOutlined />} onClick={() => setPrimary(row.id)} />
              </Tooltip>
            )}
            <Tooltip title={t("crmPipeline.contacts.edit")}>
              <Button size="small" type="text" icon={<EditOutlined />} onClick={() => openEdit(row)} />
            </Tooltip>
            {row.isActive && (
              <Popconfirm
                title={t("crmPipeline.contacts.hideConfirm")}
                description={t("crmPipeline.contacts.hideConfirmDesc")}
                onConfirm={() => remove(row.id)}
                okText={t("crmPipeline.contacts.ok")}
                cancelText={t("common.cancel")}
              >
                <Button size="small" type="text" danger icon={<DeleteOutlined />} />
              </Popconfirm>
            )}
          </Space>
        ) : null,
    },
  ], [canEdit, navigate]);

  return (
    <>
      <PageHeader
        title={t("crmPipeline.contacts.title")}
        subtitle={t("crmPipeline.contacts.count", { count: total })}
        actions={
          <Space>
            <Tooltip title={t("crmPipeline.common.reload")}>
              <Button icon={<ReloadOutlined />} onClick={load} />
            </Tooltip>
            {canEdit && (
              <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
                {t("crmPipeline.contacts.create")}
              </Button>
            )}
          </Space>
        }
      />

      <div className="filters-bar">
        <Input
          className="filters-bar__search"
          prefix={<SearchOutlined />}
          placeholder={t("crmPipeline.common.searchContact")}
          allowClear
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select
          allowClear
          showSearch
          optionFilterProp="label"
          placeholder={t("crmPipeline.contacts.filterOrg")}
          style={{ width: 220 }}
          value={orgId}
          onChange={setOrgId}
          options={orgs.map((o) => ({ value: o.id, label: o.name }))}
        />
        <Space size={6}>
          <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
            {t("crmPipeline.contacts.showInactive")}
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
          scroll={{ x: 1100 }}
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
                title={t("crmPipeline.contacts.empty")}
                description={t("crmPipeline.contacts.emptyDesc")}
                action={
                  canEdit ? (
                    <Button type="primary" onClick={openCreate}>
                      {t("crmPipeline.contacts.createFirst")}
                    </Button>
                  ) : null
                }
              />
            ),
          }}
        />
      </div>

      <Modal
        title={editing ? t("crmPipeline.contacts.edit") : t("crmPipeline.contacts.create")}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={save}
        confirmLoading={saving}
        okText={t("common.save")}
        cancelText={t("common.cancel")}
        width={560}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            label={t("crmPipeline.fields.fullName")}
            name="fullName"
            rules={[{ required: true, message: t("crmPipeline.contacts.nameRequired") }, { max: 200 }]}
          >
            <Input placeholder={t("crmPipeline.contacts.namePlaceholder")} />
          </Form.Item>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Form.Item
              label={t("crmPipeline.fields.phone")}
              name="phone"
              rules={[{ min: 8, message: t("crmPipeline.contacts.phoneMin") }, { max: 20 }]}
            >
              <Input placeholder="0901234567" />
            </Form.Item>
            <Form.Item
              label={t("crmPipeline.fields.email")}
              name="email"
              rules={[{ type: "email", message: t("crmPipeline.contacts.emailInvalid") }]}
            >
              <Input placeholder="a@congty.com" />
            </Form.Item>
            <Form.Item label={t("crmPipeline.fields.jobTitle")} name="jobTitle" rules={[{ max: 200 }]}>
              <Input placeholder={t("crmPipeline.contacts.jobPlaceholder")} />
            </Form.Item>
            <Form.Item label={t("crmPipeline.fields.organization")} name="organizationId">
              <Select
                allowClear
                showSearch
                optionFilterProp="label"
                placeholder={t("crmPipeline.common.selectOrg")}
                options={orgs.map((o) => ({ value: o.id, label: o.name }))}
              />
            </Form.Item>
          </div>
          {editing && (
            <Space size={24}>
              <Form.Item
                label={t("crmPipeline.contacts.isPrimary")}
                name="isPrimary"
                valuePropName="checked"
                noStyle
              >
                <Switch checkedChildren="Có" unCheckedChildren="Không" />
              </Form.Item>
              <Form.Item label={t("crmPipeline.contacts.isActive")} name="isActive" valuePropName="checked" noStyle>
                <Switch checkedChildren="Có" unCheckedChildren="Không" />
              </Form.Item>
            </Space>
          )}
          <Form.Item label={t("crmPipeline.fields.notes")} name="notes" rules={[{ max: 5000 }]} style={{ marginTop: 16 }}>
            <Input.TextArea rows={2} />
          </Form.Item>
          <Alert
            type="info"
            showIcon
            message={t("crmPipeline.contacts.phoneNotUniqueTitle")}
            description={t("crmPipeline.contacts.phoneNotUniqueDesc")}
          />
        </Form>
      </Modal>
    </>
  );
}
