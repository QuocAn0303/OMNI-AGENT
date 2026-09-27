import { useState } from "react";
import {
  Table, Button, Modal, Form, Input, InputNumber, Select,
  message, Card, Row, Col, Statistic, Tag,
} from "antd";
import {
  PlusOutlined, SearchOutlined, WalletOutlined, SwapOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import api from "../api/axios";
import PageHeader from "../components/layout/PageHeader";
import MoneyDisplay from "../components/shared/MoneyDisplay";

const typeColors = { EARN: "green", SPEND: "red", ADJUST: "orange", REFUND: "blue" };
const typeLabels = { EARN: "Cộng", SPEND: "Trừ", ADJUST: "Điều chỉnh", REFUND: "Hoàn tiền" };

export default function StoreCredits() {
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [balance, setBalance] = useState(0);
  const [customerId, setCustomerId] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerOpen, setCustomerOpen] = useState(false);
  const [customers, setCustomers] = useState([]);
  const [txOpen, setTxOpen] = useState(false);
  const [txForm] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);

  const loadTx = async (cid) => {
    setLoading(true);
    try {
      const { data } = await api.get(`/store-credits/${cid}`, { params: { limit: 50 } });
      setTransactions(data?.data || []);
    } catch { setTransactions([]); }
    finally { setLoading(false); }
  };

  const loadBalance = async (cid) => {
    try {
      const { data } = await api.get(`/store-credits/${cid}/balance`);
      setBalance(data?.data ?? 0);
    } catch { setBalance(0); }
  };

  const searchCustomer = async (q = "") => {
    try {
      const { data } = await api.get("/customers", { params: { search: q, limit: 20 } });
      setCustomers(data?.data || []);
    } catch { setCustomers([]); }
  };

  const selectCustomer = (c) => {
    setCustomerId(c.id);
    setCustomerName(c.name);
    setCustomerOpen(false);
    loadTx(c.id);
    loadBalance(c.id);
  };

  const openCustomerPicker = () => {
    searchCustomer();
    setCustomerOpen(true);
  };

  const handleSubmitTx = async () => {
    try {
      const values = await txForm.validateFields();
      setSubmitting(true);
      await api.post(`/store-credits/${customerId}`, values);
      message.success("Ghi nhận store credit thành công");
      setTxOpen(false);
      txForm.resetFields();
      loadTx(customerId);
      loadBalance(customerId);
    } catch (err) {
      if (err?.errorFields) return;
      message.error(err?.response?.data?.message || "Lỗi ghi nhận");
    } finally { setSubmitting(false); }
  };

  const columns = [
    { title: "Ngày", dataIndex: "createdAt", width: 140,
      render: (v) => dayjs(v).format("DD/MM/YYYY HH:mm"),
    },
    { title: "Loại", dataIndex: "type", width: 120,
      render: (v) => <Tag color={typeColors[v]}>{typeLabels[v] || v}</Tag>,
    },
    { title: "Số tiền", dataIndex: "amount", width: 140,
      render: (v) => <MoneyDisplay value={v} />,
    },
    { title: "Ghi chú", dataIndex: "note", render: (v) => v || "—" },
    { title: "Tham chiếu", dataIndex: "referenceId", width: 200,
      render: (v) => v ? v.slice(0, 8) + "..." : "—",
    },
    { title: "Nhân viên", dataIndex: ["createdBy", "name"], width: 140 },
  ];

  return (
    <>
      <PageHeader
        title="Store Credit"
        subtitle="Quản lý số dư & lịch sử store credit của khách hàng"
        extra={
          customerId && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setTxOpen(true)}>
              Ghi nhận
            </Button>
          )
        }
      />

      {!customerId ? (
        <Card>
          <Button type="primary" size="large" icon={<SearchOutlined />} onClick={openCustomerPicker}>
            Chọn khách hàng
          </Button>
          <div style={{ marginTop: 16, color: "#94a3b8" }}>Vui lòng chọn khách hàng để xem store credit</div>
        </Card>
      ) : (
        <>
          <Row gutter={16} style={{ marginBottom: 16 }}>
            <Col span={8}>
              <Card>
                <Statistic
                  title="Khách hàng"
                  value={customerName}
                  prefix={<WalletOutlined />}
                  valueStyle={{ fontSize: 18 }}
                />
                <Button type="link" style={{ padding: 0 }} onClick={openCustomerPicker}>
                  Đổi khách hàng
                </Button>
              </Card>
            </Col>
            <Col span={8}>
              <Card>
                <Statistic
                  title="Số dư hiện tại"
                  value={balance}
                  precision={0}
                  prefix={<SwapOutlined />}
                  suffix="đ"
                  valueStyle={{ color: balance >= 0 ? "#059669" : "#dc2626", fontSize: 24 }}
                />
              </Card>
            </Col>
          </Row>

          <Card title="Lịch sử giao dịch">
            <Table
              dataSource={transactions}
              columns={columns}
              rowKey="id"
              loading={loading}
              pagination={{ pageSize: 20 }}
              locale={{ emptyText: "Chưa có giao dịch nào" }}
            />
          </Card>
        </>
      )}

      <Modal title="Chọn khách hàng" open={customerOpen} onCancel={() => setCustomerOpen(false)} footer={null}>
        <Input.Search
          placeholder="Tìm khách hàng..."
          onSearch={searchCustomer}
          onChange={(e) => searchCustomer(e.target.value)}
          style={{ marginBottom: 12 }}
        />
        <Table
          dataSource={customers}
          columns={[
            { title: "Tên", dataIndex: "name" },
            { title: "SĐT", dataIndex: "phone" },
            { title: "Email", dataIndex: "email" },
          ]}
          rowKey="id"
          size="small"
          pagination={false}
          onRow={(r) => ({ onClick: () => selectCustomer(r), style: { cursor: "pointer" } })}
          locale={{ emptyText: "Không tìm thấy khách hàng" }}
        />
      </Modal>

      <Modal
        title="Ghi nhận Store Credit"
        open={txOpen}
        onCancel={() => { setTxOpen(false); txForm.resetFields(); }}
        onOk={handleSubmitTx}
        confirmLoading={submitting}
      >
        <Form form={txForm} layout="vertical">
          <Form.Item name="type" label="Loại" rules={[{ required: true }]}>
            <Select>
              <Select.Option value="EARN">Cộng (EARN)</Select.Option>
              <Select.Option value="SPEND">Trừ (SPEND)</Select.Option>
              <Select.Option value="ADJUST">Điều chỉnh (ADJUST)</Select.Option>
              <Select.Option value="REFUND">Hoàn tiền (REFUND)</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item name="amount" label="Số tiền" rules={[{ required: true }]}>
            <InputNumber min={1} style={{ width: "100%" }} prefix="₫" />
          </Form.Item>
          <Form.Item name="note" label="Ghi chú">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="referenceId" label="Mã tham chiếu (đơn hàng / trả hàng)">
            <Input placeholder="ID đơn hàng hoặc phiếu trả" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
