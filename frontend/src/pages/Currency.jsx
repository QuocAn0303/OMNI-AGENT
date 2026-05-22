// frontend/src/pages/Currency.jsx
import { useState, useEffect } from "react";
import {
  Table, Button, Space, Tag, Modal, Form, Input, InputNumber,
  DatePicker, message, Card, Statistic, Row, Col, Descriptions,
} from "antd";
import { EditOutlined, HistoryOutlined, PlusOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import PageHeader from "../components/layout/PageHeader";
import { getCurrencies, getRateHistory, setExchangeRate } from "../api/currency";

const fmtRate = (v) => v != null ? Number(v).toLocaleString("vi-VN") : "—";

export default function Currency() {
  const [currencies, setCurrencies] = useState([]);
  const [loading, setLoading]       = useState(false);

  // Rate history modal
  const [historyOpen, setHistoryOpen]     = useState(false);
  const [historyCur, setHistoryCur]       = useState(null);
  const [historyData, setHistoryData]     = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Set rate modal
  const [rateOpen, setRateOpen]   = useState(false);
  const [rateTarget, setRateTarget] = useState(null);
  const [rateForm] = Form.useForm();
  const [rateSaving, setRateSaving] = useState(false);

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    try { setCurrencies(await getCurrencies()); }
    catch { message.error("Không tải được tỷ giá"); }
    finally { setLoading(false); }
  };

  const openHistory = async (cur) => {
    setHistoryCur(cur);
    setHistoryOpen(true);
    setHistoryLoading(true);
    try { setHistoryData(await getRateHistory(cur.code, { limit: 60 })); }
    catch { message.error("Không tải lịch sử"); }
    finally { setHistoryLoading(false); }
  };

  const openSetRate = (cur) => {
    setRateTarget(cur);
    rateForm.setFieldsValue({ date: dayjs(), rate: cur.currentRate || "" });
    setRateOpen(true);
  };

  const handleSetRate = async () => {
    const vals = await rateForm.validateFields();
    setRateSaving(true);
    try {
      await setExchangeRate(rateTarget.code, {
        date: vals.date.format("YYYY-MM-DD"),
        rate: vals.rate,
      });
      message.success(`Đã cập nhật tỷ giá ${rateTarget.code}`);
      setRateOpen(false);
      await load();
    } catch (e) {
      message.error(e?.response?.data?.message || "Lỗi cập nhật tỷ giá");
    } finally { setRateSaving(false); }
  };

  const cols = [
    {
      title: "Tiền tệ", key: "currency",
      render: (_, r) => (
        <Space>
          <span style={{ fontSize: 18 }}>{r.symbol}</span>
          <span><strong>{r.code}</strong> — {r.name}</span>
          {r.isBase && <Tag color="gold">Cơ sở</Tag>}
          {!r.isActive && <Tag>Tắt</Tag>}
        </Space>
      ),
    },
    {
      title: "Tỷ giá (1 đơn vị → VNĐ)", key: "rate", align: "right",
      render: (_, r) => r.isBase
        ? <span style={{ color: "#94a3b8" }}>1</span>
        : r.currentRate
          ? <strong>{fmtRate(r.currentRate)}</strong>
          : <Tag color="warning">Chưa có</Tag>,
    },
    {
      title: "Ngày cập nhật", dataIndex: "rateDate", width: 140,
      render: (v) => v ? dayjs(v).format("DD/MM/YYYY") : "—",
    },
    { title: "Nguồn", dataIndex: "rateSource", width: 100, render: (v) => v || "—" },
    {
      title: "", key: "act", width: 110,
      render: (_, r) => !r.isBase && (
        <Space size={4}>
          <Button size="small" icon={<EditOutlined />} onClick={() => openSetRate(r)}>Cập nhật</Button>
          <Button size="small" icon={<HistoryOutlined />} onClick={() => openHistory(r)} />
        </Space>
      ),
    },
  ];

  const historyCols = [
    { title: "Ngày", dataIndex: "date", render: (v) => dayjs(v).format("DD/MM/YYYY") },
    { title: "Tỷ giá", dataIndex: "rate", align: "right", render: (v) => fmtRate(v) },
    { title: "Nguồn", dataIndex: "source" },
  ];

  const usd = currencies.find((c) => c.code === "USD");
  const eur = currencies.find((c) => c.code === "EUR");

  return (
    <div>
      <PageHeader title="Quản lý tỷ giá" subtitle="Tỷ giá ngoại tệ so với VNĐ" />

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}>
          <Card size="small">
            <Statistic title="USD → VNĐ" value={usd?.currentRate ? fmtRate(usd.currentRate) : "—"} suffix="₫" />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic title="EUR → VNĐ" value={eur?.currentRate ? fmtRate(eur.currentRate) : "—"} suffix="₫" />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic title="Số tiền tệ" value={currencies.filter((c) => !c.isBase).length} suffix="loại" />
          </Card>
        </Col>
      </Row>

      <Table
        rowKey="id" columns={cols} dataSource={currencies} loading={loading}
        size="small" pagination={false}
      />

      {/* Set rate modal */}
      <Modal
        title={`Cập nhật tỷ giá ${rateTarget?.code}`}
        open={rateOpen} onCancel={() => setRateOpen(false)}
        onOk={handleSetRate} confirmLoading={rateSaving} okText="Lưu"
      >
        <Form form={rateForm} layout="vertical" requiredMark={false}>
          <Form.Item name="date" label="Ngày áp dụng" rules={[{ required: true }]}>
            <DatePicker style={{ width: "100%" }} format="DD/MM/YYYY" />
          </Form.Item>
          <Form.Item name="rate" label={`1 ${rateTarget?.code} = ? VNĐ`} rules={[{ required: true }]}>
            <InputNumber
              style={{ width: "100%" }} min={0.000001} step={100}
              formatter={(v) => Number(v || 0).toLocaleString()}
              placeholder="25300"
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* Rate history modal */}
      <Modal
        title={`Lịch sử tỷ giá ${historyCur?.code}`}
        open={historyOpen} onCancel={() => setHistoryOpen(false)}
        footer={null} width={500}
      >
        <Table
          rowKey="id" columns={historyCols} dataSource={historyData}
          loading={historyLoading} size="small" pagination={{ pageSize: 15 }}
        />
      </Modal>
    </div>
  );
}
