import { useEffect, useState } from "react";
import { Form, Select, InputNumber, Button, DatePicker, Input, Space, message, Card } from "antd";
import { PlusOutlined, MinusCircleOutlined, ArrowLeftOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import PageHeader from "../components/layout/PageHeader";
import { createPurchaseOrder, getVendors, getTaxRates } from "../api/accounting";
import axios from "../api/axios";

export default function PurchaseOrderNew() {
  const navigate = useNavigate();
  const [vendors, setVendors] = useState([]);
  const [products, setProducts] = useState([]);
  const [taxRates, setTaxRates] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm();

  useEffect(() => {
    Promise.all([
      getVendors({ limit: 100 }),
      axios.get("/products?limit=200").then((r) => r.data?.data || r.data),
      getTaxRates(),
    ])
      .then(([v, p, t]) => {
        setVendors(v?.vendors || []);
        setProducts(p?.products || []);
        setTaxRates(t || []);
      })
      .catch(() => {});
  }, []);

  const submit = async () => {
    setSubmitting(true);
    try {
      const v = await form.validateFields();
      await createPurchaseOrder({
        ...v,
        expectedAt: v.expectedAt ? v.expectedAt.toISOString() : undefined,
      });
      message.success("Đã tạo PO");
      navigate("/purchase-orders");
    } catch (e) {
      if (e.errorFields) return;
      message.error(e.response?.data?.message || "Lỗi");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Tạo đơn nhập hàng"
        subtitle="PO ở trạng thái nháp — gửi duyệt sau khi tạo"
        extra={
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate("/purchase-orders")}>
            Quay lại
          </Button>
        }
      />
      <Card>
        <Form form={form} layout="vertical">
          <Form.Item label="Nhà cung cấp" name="vendorId" rules={[{ required: true }]}>
            <Select showSearch optionFilterProp="label" options={vendors.map((x) => ({ value: x.id, label: x.name }))} />
          </Form.Item>
          <Form.Item label="Ngày dự kiến nhập" name="expectedAt">
            <DatePicker format="DD/MM/YYYY" style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item label="Số hóa đơn" name="invoiceNumber">
            <Input />
          </Form.Item>
          <Form.Item label="Ghi chú" name="note">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.List name="items" initialValue={[{}]}>
            {(fields, { add, remove }) => (
              <>
                <div style={{ marginBottom: 8, fontWeight: 600 }}>Mặt hàng nhập</div>
                {fields.map(({ key, name, ...rest }) => (
                  <Space key={key} align="baseline" style={{ display: "flex", marginBottom: 8, width: "100%" }}>
                    <Form.Item {...rest} name={[name, "productId"]} rules={[{ required: true }]} style={{ flex: 2, marginBottom: 0 }}>
                      <Select
                        showSearch
                        optionFilterProp="label"
                        placeholder="Sản phẩm"
                        style={{ width: 280 }}
                        options={products.map((p) => ({ value: p.id, label: `${p.sku} - ${p.name}` }))}
                      />
                    </Form.Item>
                    <Form.Item {...rest} name={[name, "quantity"]} rules={[{ required: true }]} style={{ marginBottom: 0 }}>
                      <InputNumber min={1} placeholder="SL" style={{ width: 90 }} />
                    </Form.Item>
                    <Form.Item {...rest} name={[name, "unitCost"]} rules={[{ required: true }]} style={{ marginBottom: 0 }}>
                      <InputNumber min={0} placeholder="Đơn giá" style={{ width: 140 }} />
                    </Form.Item>
                    <Form.Item {...rest} name={[name, "taxRateId"]} style={{ marginBottom: 0 }}>
                      <Select allowClear placeholder="Thuế" style={{ width: 120 }} options={taxRates.map((t) => ({ value: t.id, label: t.name }))} />
                    </Form.Item>
                    <MinusCircleOutlined onClick={() => remove(name)} />
                  </Space>
                ))}
                <Button type="dashed" onClick={() => add()} icon={<PlusOutlined />}>
                  Thêm mặt hàng
                </Button>
              </>
            )}
          </Form.List>
          <Button type="primary" style={{ marginTop: 16 }} onClick={submit} loading={submitting}>
            Tạo PO
          </Button>
        </Form>
      </Card>
    </div>
  );
}
