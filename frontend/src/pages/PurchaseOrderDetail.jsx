import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button, Card, Descriptions, Table, Space, message, Tag, Modal, Form, InputNumber, Select } from "antd";
import { ArrowLeftOutlined, SendOutlined, CheckOutlined, InboxOutlined, DollarOutlined, StopOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import PageHeader from "../components/layout/PageHeader";
import useAuthStore from "../stores/authStore";
import {
  getPurchaseOrder,
  submitPurchaseOrder,
  approvePurchaseOrder,
  receivePurchaseOrder,
  payPurchaseOrder,
  cancelPurchaseOrder,
} from "../api/accounting";

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

export default function PurchaseOrderDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const role = user?.role;
  const [po, setPo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [payOpen, setPayOpen] = useState(false);
  const [payForm] = Form.useForm();

  const load = async () => {
    setLoading(true);
    try {
      setPo(await getPurchaseOrder(id));
    } catch (e) {
      message.error(e.response?.data?.message || "Lỗi");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [id]);

  if (!po && !loading) return <div>Không tìm thấy PO</div>;
  if (!po) return null;

  const canApprove = ["ADMIN", "MANAGER"].includes(role);
  const canWarehouse = ["ADMIN", "MANAGER", "WAREHOUSE"].includes(role);

  return (
    <div>
      <PageHeader
        title={po.poCode}
        subtitle={po.vendor?.name}
        extra={
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate("/purchase-orders")}>
            Danh sách
          </Button>
        }
      />

      <Card loading={loading}>
        <Descriptions bordered size="small" column={2}>
          <Descriptions.Item label="Ngày">{dayjs(po.date).format("DD/MM/YYYY")}</Descriptions.Item>
          <Descriptions.Item label="Trạng thái">
            <Tag>{STATUS_LABEL[po.status] || po.status}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="Thanh toán">{po.paymentStatus}</Descriptions.Item>
          <Descriptions.Item label="Tổng">{fmtVND(po.total)}</Descriptions.Item>
        </Descriptions>

        <Table
          style={{ marginTop: 16 }}
          size="small"
          rowKey="id"
          dataSource={po.items || []}
          pagination={false}
          columns={[
            { title: "Sản phẩm", dataIndex: ["product", "name"] },
            { title: "SL", dataIndex: "quantity", width: 80, align: "right" },
            { title: "Đơn giá", dataIndex: "unitCost", render: fmtVND },
          ]}
        />

        <Space wrap style={{ marginTop: 16 }}>
          {po.status === "DRAFT" && canWarehouse && (
            <Button type="primary" icon={<SendOutlined />} onClick={async () => { await submitPurchaseOrder(id); message.success("Đã gửi"); load(); }}>
              Gửi duyệt
            </Button>
          )}
          {po.status === "PENDING" && canApprove && (
            <Button type="primary" icon={<CheckOutlined />} onClick={async () => { await approvePurchaseOrder(id); message.success("Đã duyệt"); load(); }}>
              Duyệt
            </Button>
          )}
          {po.status === "APPROVED" && canWarehouse && (
            <Button type="primary" icon={<InboxOutlined />} onClick={async () => { await receivePurchaseOrder(id); message.success("Đã nhập kho"); load(); }}>
              Nhập kho
            </Button>
          )}
          {po.status === "RECEIVED" && Number(po.paidAmount) < Number(po.total) && ["ADMIN", "MANAGER", "CASHIER"].includes(role) && (
            <Button icon={<DollarOutlined />} onClick={() => { setPayOpen(true); payForm.setFieldsValue({ amount: Number(po.total) - Number(po.paidAmount), method: "BANK_TRANSFER" }); }}>
              Thanh toán
            </Button>
          )}
          {["DRAFT", "PENDING", "APPROVED"].includes(po.status) && ["ADMIN", "MANAGER"].includes(role) && (
            <Button danger icon={<StopOutlined />} onClick={async () => { await cancelPurchaseOrder(id); message.success("Đã hủy"); load(); }}>
              Hủy PO
            </Button>
          )}
        </Space>
      </Card>

      <Modal
        title="Thanh toán PO"
        open={payOpen}
        onOk={async () => {
          try {
            const v = await payForm.validateFields();
            await payPurchaseOrder(id, v);
            message.success("Đã thanh toán");
            setPayOpen(false);
            load();
          } catch (e) {
            if (!e.errorFields) message.error(e.response?.data?.message || "Lỗi");
          }
        }}
        onCancel={() => setPayOpen(false)}
      >
        <Form form={payForm} layout="vertical">
          <Form.Item name="amount" label="Số tiền" rules={[{ required: true }]}>
            <InputNumber style={{ width: "100%" }} min={1} />
          </Form.Item>
          <Form.Item name="method" label="Phương thức">
            <Select options={[{ value: "CASH", label: "Tiền mặt" }, { value: "BANK_TRANSFER", label: "CK" }, { value: "CARD", label: "Thẻ" }]} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
