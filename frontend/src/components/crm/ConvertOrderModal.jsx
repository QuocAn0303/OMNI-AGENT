/**
 * Frontend: src/components/crm/ConvertOrderModal.jsx — Modal tạo đơn hàng từ Deal thắng
 *
 * Tổng quan:
 * - Gọi `POST /crm/deals/:id/convert-to-order`. Backend **delegate** `orderService.create`
 *   nên đơn sinh mã `ORD-YYYYMMDD-XXXX`, trừ tồn kho, bút toán kế toán, e-invoice…
 *   giống hệt tạo đơn từ POS. FE không cần biết chi tiết.
 * - Điều kiện backend: deal phải `kind = WON` (400 nếu chưa) và phải có ít nhất
 *   1 dòng sản phẩm gắn `productId` (400 nếu chưa). 1 deal chỉ sinh tối đa 1 đơn
 *   (`CrmDeal.orderId` là `@unique`) → 409 nếu đã có đơn.
 * - Về giá: backend dùng `product.price` rồi bù chênh lệch bằng chiết khấu cấp
 *   đơn (FIXED). UI hiển thị số tiền dự kiến chỉ để người dùng đối chiếu.
 *
 * Props:
 *   open:      boolean
 *   deal:      CrmDeal | null (phải có items)
 *   onCancel:  () => void
 *   onSuccess: ({ deal, order }) => void
 *
 * Exports:
 *   ConvertOrderModal (default)
 */
import { useEffect, useState } from "react";
import { Modal, Form, Select, Input, Alert, message, Space, Descriptions } from "antd";
import { useTranslation } from "react-i18next";
import axios from "../../api/axios";
import { convertDealToOrder } from "../../api/crm";
import MoneyDisplay from "../shared/MoneyDisplay";

const ORDER_STATUS = ["PENDING", "CONFIRMED", "COMPLETED"];
const PAYMENT_METHODS = ["CASH", "BANK_TRANSFER", "CARD"];

export default function ConvertOrderModal({ open, deal, onCancel, onSuccess }) {
  const { t } = useTranslation();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [warehouses, setWarehouses] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [customerSearch, setCustomerSearch] = useState("");

  const sellable = (deal?.items || []).filter((i) => i.productId);

  useEffect(() => {
    if (!open) return;
    axios
      .get("/warehouses")
      .then((res) => setWarehouses(res.data?.data || []))
      .catch(() => setWarehouses([]));
  }, [open]);

  // Tìm khách hàng (server-side) khi người dùng muốn gắn KH có sẵn
  useEffect(() => {
    if (!open) return;
    let active = true;
    const t = setTimeout(() => {
      axios
        .get("/customers", {
          params: { page: 1, limit: 20, ...(customerSearch ? { search: customerSearch } : {}) },
        })
        .then((res) => {
          if (active) setCustomers(res.data?.data || []);
        })
        .catch(() => {
          if (active) setCustomers([]);
        });
    }, 250);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [open, customerSearch]);

  useEffect(() => {
    if (!open || !deal) return;
    form.setFieldsValue({
      customerId: deal.customerId || undefined,
      createCustomer: !deal.customerId,
      warehouseId: undefined,
      orderStatus: "PENDING",
      paymentMethod: "BANK_TRANSFER",
      note: null,
    });
  }, [open, deal, form]);

  const submit = async () => {
    try {
      const values = await form.validateFields();
      const payload = {
        customerId: values.customerId || undefined,
        createCustomer: values.createCustomer !== false,
        warehouseId: values.warehouseId || undefined,
        orderStatus: values.orderStatus || "PENDING",
        paymentMethod: values.paymentMethod || "BANK_TRANSFER",
        note: values.note || undefined,
      };
      setSaving(true);
      const res = await convertDealToOrder(deal.id, payload);
      message.success(t("crmPipeline.convertOrder.success", { code: res?.order?.orderCode || "" }));
      onSuccess?.(res);
    } catch (err) {
      if (err?.errorFields) return;
      message.error(err?.response?.data?.message || t("crmPipeline.common.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const estSubtotal = sellable.reduce(
    (s, i) => s + Number(i.product?.price ?? i.unitPrice ?? 0) * Number(i.quantity || 0),
    0,
  );
  const dealTotal = sellable.reduce((s, i) => s + Number(i.amount || 0), 0);
  const discountHint = estSubtotal - dealTotal;

  return (
    <Modal
      title={t("crmPipeline.convertOrder.title")}
      open={open}
      onCancel={onCancel}
      onOk={submit}
      confirmLoading={saving}
      okText={t("crmPipeline.convertOrder.ok")}
      cancelText={t("common.cancel")}
      width={620}
      destroyOnHidden
    >
      {deal && (
        <>
          <Alert
            type="warning"
            showIcon
            style={{ margin: "16px 0" }}
            message={t("crmPipeline.convertOrder.alertTitle")}
            description={
              discountHint > 0
                ? t("crmPipeline.convertOrder.alertDescDiscount", {
                    amount: Math.round(discountHint).toLocaleString("vi-VN"),
                  })
                : t("crmPipeline.convertOrder.alertDescMatch")
            }
          />

          <Descriptions size="small" column={2} bordered style={{ marginBottom: 16 }}>
            <Descriptions.Item label={t("crmPipeline.convertOrder.labelDeal")}>
              {deal.dealName}
            </Descriptions.Item>
            <Descriptions.Item label={t("crmPipeline.convertOrder.labelValue")}>
              <MoneyDisplay value={deal.value} />
            </Descriptions.Item>
            <Descriptions.Item label={t("crmPipeline.convertOrder.labelItems")}>
              {sellable.length}
            </Descriptions.Item>
            <Descriptions.Item label={t("crmPipeline.convertOrder.labelTotal")}>
              <MoneyDisplay value={estSubtotal} />
            </Descriptions.Item>
          </Descriptions>
        </>
      )}

      {sellable.length === 0 && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
          message={t("crmPipeline.convertOrder.noProductTitle")}
          description={t("crmPipeline.convertOrder.noProductDesc")}
        />
      )}

      <Form form={form} layout="vertical">
        <Form.Item
          label={t("crmPipeline.convertOrder.customer")}
          name="customerId"
          extra={t("crmPipeline.convertOrder.customerExtra")}
        >
          <Select
            showSearch
            filterOption={false}
            onSearch={setCustomerSearch}
            allowClear
            placeholder={t("crmPipeline.convertOrder.customerSearch")}
            options={customers.map((c) => ({
              value: c.id,
              label: `${c.name}${c.phone ? ` (${c.phone})` : ""}`,
            }))}
          />
        </Form.Item>

        <Form.Item
          label={t("crmPipeline.convertOrder.createCustomer")}
          name="createCustomer"
          extra={t("crmPipeline.convertOrder.createCustomerExtra")}
        >
          <Select
            options={[
              { value: true, label: t("crmPipeline.convertOrder.createCustomerYes") },
              { value: false, label: t("crmPipeline.convertOrder.createCustomerNo") },
            ]}
            style={{ width: 280 }}
          />
        </Form.Item>

        <Space.Compact style={{ width: "100%" }} block>
          <Form.Item
            label={t("crmPipeline.convertOrder.warehouse")}
            name="warehouseId"
            style={{ flex: 1 }}
            extra={t("crmPipeline.convertOrder.warehouseExtra")}
          >
            <Select
              allowClear
              placeholder={t("crmPipeline.convertOrder.warehousePlaceholder")}
              options={warehouses.map((w) => ({ value: w.id, label: w.name }))}
            />
          </Form.Item>
          <Form.Item label={t("crmPipeline.convertOrder.orderStatus")} name="orderStatus" style={{ flex: 1 }}>
            <Select
              options={ORDER_STATUS.map((v) => ({
                value: v,
                label: t(`crmPipeline.convertOrder.status${v}`),
              }))}
            />
          </Form.Item>
          <Form.Item label={t("crmPipeline.convertOrder.paymentMethod")} name="paymentMethod" style={{ flex: 1 }}>
            <Select
              options={PAYMENT_METHODS.map((v) => ({
                value: v,
                label: t(`crmPipeline.convertOrder.pay${v}`),
              }))}
            />
          </Form.Item>
        </Space.Compact>

        <Form.Item label={t("crmPipeline.convertOrder.orderNote")} name="note">
          <Input.TextArea
            rows={2}
            maxLength={500}
            placeholder={t("crmPipeline.convertOrder.orderNotePlaceholder")}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
