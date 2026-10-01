/**
 * Frontend: src/components/crm/ConvertLeadModal.jsx — Modal chuyển Lead → Deal
 *
 * Tổng quan:
 * - Gọi `POST /crm/leads/:id/convert`. Backend trong 1 transaction:
 *   tìm/tạo `CrmContact` → tạo `CrmDeal` ở stage ONGOING đầu tiên →
 *   set `lead.status = CONVERTED` + `convertedDealId` + `convertedAt`.
 * - Mặc định điền sẵn: tên deal = tên lead, giá trị = expectedValue của lead,
 *   người phụ trách = người phụ trách lead.
 * - `createContact` mặc định `true` (chuẩn Frappe CRM). Tắt thì dùng
 *   `contactId` đã chọn; nếu cả hai đều trống, deal sẽ không có contact.
 * - 409 = lead đã convert trước đó → đóng modal và chuyển sang deal đã có.
 *
 * Props:
 *   open:     boolean
 *   lead:     CrmLead | null
 *   onCancel: () => void
 *   onSuccess: ({ deal, lead }) => void
 *
 * Exports:
 *   ConvertLeadModal (default)
 */
import { useEffect, useState } from "react";
import {
  Modal, Form, Input, InputNumber, Select, DatePicker, Switch, Space, Alert, message,
} from "antd";
import { useTranslation } from "react-i18next";
import dayjs from "dayjs";
import { convertLead, listOrganizations, listContacts, getLeadFields } from "../../api/crm";
import useStages from "../../hooks/useCrmStages";

export default function ConvertLeadModal({ open, lead, onCancel, onSuccess }) {
  const { t } = useTranslation();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [orgs, setOrgs] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [owners, setOwners] = useState([]);
  const createContact = Form.useWatch("createContact", form);

  // Giai đoạn DEAL (không phải stage của kanban lead — backend chặn nhầm loại với 400)
  const { stages } = useStages("DEAL");

  useEffect(() => {
    if (!open) return;
    listOrganizations({ page: 1, limit: 200 })
      .then((r) => setOrgs(r.data || []))
      .catch(() => setOrgs([]));
    getLeadFields()
      .then((res) => setOwners(res?.owners || []))
      .catch(() => setOwners([]));
  }, [open]);

  // Chỉ tải contact khi lead đã có tổ chức + người dùng tắt "tạo contact mới"
  useEffect(() => {
    if (!open || createContact !== false || !lead?.organizationId) {
      if (!open) setContacts([]);
      return;
    }
    listContacts({ organizationId: lead.organizationId, page: 1, limit: 200 })
      .then((r) => setContacts(r.data || []))
      .catch(() => setContacts([]));
  }, [open, createContact, lead?.organizationId]);

  // Điền sẵn giá trị mặc định mỗi lần mở
  useEffect(() => {
    if (!open || !lead) return;
    form.setFieldsValue({
      dealName: lead.leadName,
      organizationId: lead.organizationId || undefined,
      contactId: lead.contactId || undefined,
      expectedValue: Number(lead.expectedValue) || 0,
      expectedCloseDate: null,
      dealOwnerId: lead.leadOwnerId || undefined,
      createContact: true,
      nextStep: null,
      note: null,
    });
  }, [open, lead, form]);

  const submit = async () => {
    try {
      const values = await form.validateFields();
      const payload = {
        dealName: values.dealName?.trim(),
        organizationId: values.organizationId || null,
        contactId: values.contactId || null,
        stageId: values.stageId || null,
        expectedValue: values.expectedValue || 0,
        expectedCloseDate: values.expectedCloseDate
          ? values.expectedCloseDate.format("YYYY-MM-DD")
          : null,
        dealOwnerId: values.dealOwnerId || null,
        createContact: values.createContact !== false,
        nextStep: values.nextStep || null,
        note: values.note || null,
      };
      setSaving(true);
      const res = await convertLead(lead.id, payload);
      message.success(t("crmPipeline.convertLead.success"));
      onSuccess?.(res);
    } catch (err) {
      if (err?.errorFields) return;
      if (err?.response?.status === 409) {
        message.warning(t("crmPipeline.convertLead.alreadyConverted"));
        onSuccess?.(null);
      } else {
        message.error(err?.response?.data?.message || t("crmPipeline.common.saveFailed"));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={t("crmPipeline.convertLead.title")}
      open={open}
      onCancel={onCancel}
      onOk={submit}
      confirmLoading={saving}
      okText={t("crmPipeline.convertLead.ok")}
      cancelText={t("common.cancel")}
      width={620}
      destroyOnHidden
    >
      {lead && (
        <Alert
          type="info"
          showIcon
          style={{ margin: "16px 0" }}
          message={`${lead.leadName}${lead.mobileNo ? ` · ${lead.mobileNo}` : ""}`}
          description={t("crmPipeline.convertLead.alertDesc")}
        />
      )}

      <Form form={form} layout="vertical">
        <Form.Item
          label={t("crmPipeline.fields.dealName")}
          name="dealName"
          rules={[{ required: true, message: t("crmPipeline.deals.nameRequired") }, { max: 200 }]}
        >
          <Input placeholder={t("crmPipeline.convertLead.namePlaceholder")} />
        </Form.Item>

        <Space.Compact style={{ width: "100%" }} block>
          <Form.Item
            label={t("crmPipeline.fields.organization")}
            name="organizationId"
            style={{ flex: 1 }}
            extra={t("crmPipeline.convertLead.orgExtra")}
          >
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder={t("crmPipeline.common.selectOrg")}
              options={orgs.map((o) => ({ value: o.id, label: o.name }))}
            />
          </Form.Item>
          <Form.Item
            label={t("crmPipeline.fields.value")}
            name="expectedValue"
            style={{ width: 190 }}
          >
            <InputNumber
              min={0}
              step={1000000}
              style={{ width: "100%" }}
              formatter={(v) => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ".")}
              parser={(v) => v?.replace(/\./g, "")}
              placeholder="0"
            />
          </Form.Item>
        </Space.Compact>

        <Space.Compact style={{ width: "100%" }} block>
          <Form.Item
            label={t("crmPipeline.convertLead.dealStage")}
            name="stageId"
            style={{ flex: 1 }}
            extra={t("crmPipeline.convertLead.dealStageExtra")}
          >
            <Select
              allowClear
              placeholder={t("crmPipeline.common.selectStage")}
              options={stages
                .filter((s) => s.isActive !== false)
                .map((s) => ({
                  value: s.id,
                  label: t("crmPipeline.deals.stageWithProb", { label: s.label, prob: s.probability }),
                }))}
            />
          </Form.Item>
          <Form.Item
            label={t("crmPipeline.fields.owner")}
            name="dealOwnerId"
            style={{ flex: 1 }}
            extra={t("crmPipeline.convertLead.ownerExtra")}
          >
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder={t("crmPipeline.common.notOwner")}
              options={owners.map((u) => ({ value: u.id, label: `${u.fullName} (${u.role})` }))}
            />
          </Form.Item>
          <Form.Item
            label={t("crmPipeline.fields.expectedCloseDate")}
            name="expectedCloseDate"
            style={{ width: 200 }}
          >
            <DatePicker
              style={{ width: "100%" }}
              format="DD/MM/YYYY"
              disabledDate={(d) => d && d < dayjs().startOf("day")}
            />
          </Form.Item>
        </Space.Compact>

        <Form.Item
          label={t("crmPipeline.convertLead.createContact")}
          name="createContact"
          valuePropName="checked"
          extra={t("crmPipeline.convertLead.createContactExtra")}
        >
          <Switch />
        </Form.Item>

        {!createContact && (
          <Form.Item
            label={t("crmPipeline.fields.contact")}
            name="contactId"
            extra={lead?.organizationId ? undefined : t("crmPipeline.convertLead.noOrgForContacts")}
          >
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder={t("crmPipeline.common.selectContact")}
              options={contacts.map((c) => ({
                value: c.id,
                label: `${c.fullName}${c.phone ? ` (${c.phone})` : ""}`,
              }))}
            />
          </Form.Item>
        )}

        <Form.Item label={t("crmPipeline.fields.nextStep")} name="nextStep">
          <Input placeholder={t("crmPipeline.convertLead.nextStepPlaceholder")} maxLength={500} />
        </Form.Item>

        <Form.Item label={t("crmPipeline.convertLead.timelineNote")} name="note">
          <Input.TextArea
            rows={2}
            maxLength={2000}
            placeholder={t("crmPipeline.convertLead.timelineNotePlaceholder")}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
