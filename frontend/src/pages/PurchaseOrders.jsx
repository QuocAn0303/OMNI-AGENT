import { useEffect, useState } from "react";
import { Table, Button, Modal, Form, Select, InputNumber, Space, message, Tag, DatePicker, Card } from "antd";
import { PlusOutlined, InboxOutlined, DollarOutlined, MinusCircleOutlined, EyeOutlined, SendOutlined, CheckOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { useNavigate } from "react-router-dom";
import PageHeader from "../components/layout/PageHeader";
import {
  getPurchaseOrders,
  receivePurchaseOrder,
  payPurchaseOrder,
  cancelPurchaseOrder,
  submitPurchaseOrder,
  approvePurchaseOrder,
} from "../api/accounting";
import { getVendors } from "../api/accounting";
import useAuthStore from "../stores/authStore";

const STATUS_COLORS = {
  DRAFT: "default",
  PENDING: "gold",
  APPROVED: "blue",
  ORDERED: "blue",
  RECEIVED: "cyan",
  PAID: "green",
  CANCELLED: "red",
};
const STATUS_LABEL = {
  DRAFT: "Nháp",
  PENDING: "Chờ duyệt",
  APPROVED: "Đã duyệt",
  ORDERED: "Đã đặt",
  RECEIVED: "Đã nhập kho",
  PAID: "Đã thanh toán",
  CANCELLED: "Đã hủy",
};

const fmtVND = (v) => Number(v || 0).toLocaleString("vi-VN") + "đ";

export default function PurchaseOrders() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const role = user?.role;
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState({ purchaseOrders: [], pagination: { total: 0 } });
  const [filters, setFilters] = useState({ page: 1, limit: 20 });
  const [vendors, setVendors] = useState([]);
  const [paying, setPaying] = useState(null);
  const [payForm] = Form.useForm();

  const load = async () => {
    setLoading(true);
    try {
      setData(await getPurchaseOrders(filters));
    } catch (e) {
      message.error(e.response?.data?.message || "Lỗi");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [filters]);

  useEffect(() => {
    getVendors({ limit: 100 })
      .then((v) => setVendors(v?.vendors || []))
      .catch(() => {});
  }, []);

  const submitPay = async () => {
    try {
      const v = await payForm.validateFields();
      await payPurchaseOrder(paying.id, v);
      message.success("Đã thanh toán");
      setPaying(null);
      load();
    } catch (e) {
      if (e.errorFields) return;
      message.error(e.response?.data?.message || "Lỗi");
    }
  };

  const canApprove = ["ADMIN", "MANAGER"].includes(role);
  const canWarehouse = ["ADMIN", "MANAGER", "WAREHOUSE"].includes(role);

  const columns = [
    {
      title: "Mã PO",
      dataIndex: "poCode",
      width: 160,
      render: (t, r) => (
        <Button type="link" size="small" onClick={() => navigate(`/purchase-orders/${r.id}`)}>
          {t}
        </Button>
      ),
    },
    { title: "Ngày", dataIndex: "date", width: 110, render: (d) => dayjs(d).format("DD/MM/YYYY") },
    { title: "NCC", dataIndex: ["vendor", "name"] },
    { title: "Số mặt hàng", width: 100, align: "right", render: (_, r) => r.items?.length || 0 },
    { title: "Tổng tiền", dataIndex: "total", width: 130, align: "right", render: fmtVND },
    {
      title: "Đã trả",
      dataIndex: "paidAmount",
      width: 130,
      align: "right",
      render: (v, r) => <Tag color={Number(v) >= Number(r.total) ? "green" : "orange"}>{fmtVND(v)}</Tag>,
    },
    { title: "TT thanh toán", dataIndex: "paymentStatus", width: 100 },
    { title: "Trạng thái", dataIndex: "status", width: 130, render: (s) => <Tag color={STATUS_COLORS[s]}>{STATUS_LABEL[s] || s}</Tag> },
    {
      title: "",
      key: "actions",
      width: 280,
      fixed: "right",
      render: (_, r) => (
        <Space wrap>
          <Button size="small" type="link" icon={<EyeOutlined />} onClick={() => navigate(`/purchase-orders/${r.id}`)}>
            Chi tiết
          </Button>
          {r.status === "DRAFT" && canWarehouse && (
            <Button size="small" type="link" icon={<SendOutlined />} onClick={async () => { await submitPurchaseOrder(r.id); message.success("Đã gửi duyệt"); load(); }}>
              Gửi
            </Button>
          )}
          {r.status === "PENDING" && canApprove && (
            <Button size="small" type="link" icon={<CheckOutlined />} onClick={async () => { await approvePurchaseOrder(r.id); message.success("Đã duyệt"); load(); }}>
              Duyệt
            </Button>
          )}
          {r.status === "APPROVED" && canWarehouse && (
            <Button size="small" type="link" icon={<InboxOutlined />} onClick={async () => { await receivePurchaseOrder(r.id); message.success("Đã nhập kho"); load(); }}>
              Nhập kho
            </Button>
          )}
          {r.status === "RECEIVED" && Number(r.paidAmount) < Number(r.total) && ["ADMIN", "MANAGER", "CASHIER"].includes(role) && (
            <Button
              size="small"
              type="link"
              icon={<DollarOutlined />}
              onClick={() => {
                setPaying(r);
                payForm.resetFields();
                payForm.setFieldsValue({ amount: Number(r.total) - Number(r.paidAmount), method: "BANK_TRANSFER" });
              }}
            >
              Trả tiền
            </Button>
          )}
          {["DRAFT", "PENDING", "APPROVED"].includes(r.status) && ["ADMIN", "MANAGER"].includes(role) && (
            <Button size="small" type="link" danger icon={<MinusCircleOutlined />} onClick={async () => { await cancelPurchaseOrder(r.id); message.success("Đã hủy"); load(); }}>
              Hủy
            </Button>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Đơn nhập hàng (PO)"
        subtitle="Duyệt → nhập kho → công nợ NCC / hạch toán tự động"
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate("/purchase-orders/new")}>
            Tạo PO mới
          </Button>
        }
      />

      <Card size="small" style={{ marginBottom: 16 }}>
        <Space wrap align="center">
          <span>Lọc:</span>
          <Select
            allowClear
            placeholder="Trạng thái"
            style={{ width: 160 }}
            value={filters.status}
            onChange={(status) => setFilters({ ...filters, page: 1, status })}
            options={Object.keys(STATUS_LABEL).map((k) => ({ value: k, label: STATUS_LABEL[k] }))}
          />
          <Select
            allowClear
            placeholder="NCC"
            style={{ width: 200 }}
            showSearch
            optionFilterProp="label"
            value={filters.vendorId}
            onChange={(vendorId) => setFilters({ ...filters, page: 1, vendorId })}
            options={vendors.map((v) => ({ value: v.id, label: v.name }))}
          />
          <DatePicker.RangePicker
            onChange={(range) => {
              if (!range || !range[0]) setFilters({ ...filters, page: 1, from: undefined, to: undefined });
              else setFilters({ ...filters, page: 1, from: range[0].toISOString(), to: range[1].endOf("day").toISOString() });
            }}
          />
        </Space>
      </Card>

      <Table
        loading={loading}
        rowKey="id"
        dataSource={data.purchaseOrders}
        columns={columns}
        scroll={{ x: 1400 }}
        pagination={{
          current: filters.page,
          pageSize: filters.limit,
          total: data.pagination.total,
          onChange: (page, limit) => setFilters({ ...filters, page, limit }),
        }}
      />

      <Modal title={`Thanh toán PO ${paying?.poCode || ""}`} open={!!paying} onOk={submitPay} onCancel={() => setPaying(null)} okText="Thanh toán">
        <Form form={payForm} layout="vertical">
          <Form.Item label="Số tiền" name="amount" rules={[{ required: true }]}>
            <InputNumber style={{ width: "100%" }} min={1} />
          </Form.Item>
          <Form.Item label="Phương thức" name="method" initialValue="BANK_TRANSFER">
            <Select options={[{ value: "CASH", label: "Tiền mặt" }, { value: "BANK_TRANSFER", label: "CK" }, { value: "CARD", label: "Thẻ" }]} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
