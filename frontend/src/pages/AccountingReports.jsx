import { useEffect, useState, useCallback } from "react";
import { Card, Tabs, Table, Button, InputNumber, Select, message, Tag, Space, DatePicker, Empty } from "antd";
import { PrinterOutlined, DownloadOutlined, CalculatorOutlined, CloseCircleOutlined } from "@ant-design/icons";
import api from "../api/axios";
import PageHeader from "../components/layout/PageHeader";

const unwrap = (res) => res.data?.data ?? res.data;
const fmt = (v) => Number(v || 0).toLocaleString("vi-VN");

const now = new Date();
const thisYear = now.getFullYear();
const thisMonth = now.getMonth() + 1;

export default function AccountingReports() {
  const [year, setYear] = useState(thisYear);
  const [month, setMonth] = useState(thisMonth);
  const [quarter, setQuarter] = useState(Math.ceil(thisMonth / 3));
  const [accountId, setAccountId] = useState("");
  const [accountCode, setAccountCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [tab, setTab] = useState("trial");

  const fetch = useCallback(async (endpoint, params = {}) => {
    setLoading(true);
    try {
      const res = await api.get(endpoint, { params: { year, month, ...params } }).then(unwrap);
      setData(res);
    } catch (e) {
      message.error(e.response?.data?.message || "Loi");
      setData(null);
    }
    setLoading(false);
  }, [year, month]);

  const periodParams = { year, month };

  const tabs = [
    { key: "trial", label: "CDSPS 6 cot", fn: () => fetch("/accounting/reports/trial-balance-6col") },
    { key: "b01", label: "B01-DN", fn: () => fetch("/accounting/reports/balance-sheet-b01") },
    { key: "b02", label: "B02-DN", fn: () => fetch("/accounting/reports/profit-loss-b02") },
    { key: "journal", label: "So NKC", fn: () => fetch("/accounting/reports/general-journal") },
    { key: "ledger", label: "So Cai", fn: () => accountId ? fetch("/accounting/reports/account-ledger", { accountId }) : message.warning("Chon TK truoc") },
    { key: "subLedger", label: "So Chi Tiet", fn: () => accountCode ? fetch("/accounting/reports/sub-ledger", { accountCode }) : message.warning("Nhap ma TK") },
    { key: "valuation", label: "Dinh gia ton kho", fn: () => fetch("/accounting/reports/inventory-valuation") },
  ];

  const handleTabChange = (key) => { setTab(key); setData(null); };

  const handleClose = async () => {
    try {
      await api.post("/accounting/fiscal-periods/period-close", periodParams);
      message.success("Ket chuyen cuoi ky thanh cong");
    } catch (e) { message.error(e.response?.data?.message || "Loi"); }
  };

  const handleDepreciation = async () => {
    try {
      await api.post("/accounting/depreciation/run", periodParams);
      message.success("Khau hao thanh cong");
    } catch (e) { message.error(e.response?.data?.message || "Loi"); }
  };

  const handleCIT = async () => {
    try {
      await api.post("/accounting/tax/cit", { year, quarter });
      message.success("Tinh thue TNDN thanh cong");
    } catch (e) { message.error(e.response?.data?.message || "Loi"); }
  };

  const handlePrepaid = async () => {
    try {
      await api.post("/accounting/prepaid/allocate", periodParams);
      message.success("Phan bo chi phi thanh cong");
    } catch (e) { message.error(e.response?.data?.message || "Loi"); }
  };

  const trialCols = [
    { title: "Ma TK", dataIndex: "code", width: 80 },
    { title: "Ten TK", dataIndex: "name", ellipsis: true },
    { title: "Du DK No", dataIndex: "opDebit", align: "right", render: (v) => fmt(v) },
    { title: "Du DK Co", dataIndex: "opCredit", align: "right", render: (v) => fmt(v) },
    { title: "PS No", dataIndex: "periodDebit", align: "right", render: (v) => fmt(v) },
    { title: "PS Co", dataIndex: "periodCredit", align: "right", render: (v) => fmt(v) },
    { title: "Du CK No", dataIndex: "clDebit", align: "right", render: (v) => fmt(v) },
    { title: "Du CK Co", dataIndex: "clCredit", align: "right", render: (v) => fmt(v) },
  ];

  const journalCols = [
    { title: "Ngay", dataIndex: "date", width: 100 },
    { title: "Ma CT", dataIndex: "entryCode", width: 120 },
    { title: "Dien giai", dataIndex: "description", ellipsis: true },
    { title: "TK", dataIndex: "accountCode", width: 70 },
    { title: "Ten TK", dataIndex: "accountName", width: 120 },
    { title: "No", dataIndex: "debit", align: "right", render: (v) => v ? fmt(v) : "" },
    { title: "Co", dataIndex: "credit", align: "right", render: (v) => v ? fmt(v) : "" },
    { title: "TK DU", dataIndex: "counterpart", width: 100 },
  ];

  const ledgerCols = [
    { title: "Ngay", dataIndex: "date", width: 100 },
    { title: "Ma CT", dataIndex: "entryCode", width: 120 },
    { title: "Dien giai", dataIndex: "description", ellipsis: true },
    { title: "TK doi ung", dataIndex: "counterpart", width: 150 },
    { title: "No", dataIndex: "debit", align: "right", render: (v) => v ? fmt(v) : "" },
    { title: "Co", dataIndex: "credit", align: "right", render: (v) => v ? fmt(v) : "" },
    { title: "So du", dataIndex: "balance", align: "right", render: (v) => fmt(v) },
  ];

  const subLedgerCols = [
    { title: "Ngay", dataIndex: "date", width: 100 },
    { title: "Ma CT", dataIndex: "entryCode", width: 120 },
    { title: "Dien giai", dataIndex: "description", ellipsis: true },
    { title: "No", dataIndex: "debit", align: "right", render: (v) => v ? fmt(v) : "" },
    { title: "Co", dataIndex: "credit", align: "right", render: (v) => v ? fmt(v) : "" },
    { title: "So du", dataIndex: "balance", align: "right", render: (v) => fmt(v) },
  ];

  const b02Cols = [
    { title: "Ma", dataIndex: "code", width: 60 },
    { title: "Chi tieu", dataIndex: "name" },
    { title: "So tien", dataIndex: "value", align: "right", render: (v, r) => ({ children: fmt(v), props: { style: { fontWeight: r.bold ? 700 : 400 } } }) },
  ];

  const renderCard = (title, columns, rows, extra) => (
    <Card title={title} extra={extra} style={{ marginBottom: 16 }}>
      {rows && rows.length > 0 ? (
        <Table columns={columns} dataSource={rows} rowKey={(r, i) => r.code || r.date || r.entryCode || i} size="small" loading={loading} scroll={{ x: 1200 }} pagination={{ pageSize: 50 }} />
      ) : (
        <Empty description="Chua co du lieu. Chon thang roi bam button tuong ung." />
      )}
    </Card>
  );

  const renderB01 = () => {
    if (!data) return <Empty description="Chon thang roi bam Lay du lieu" />;
    const { assets, liabilities, equity } = data;
    return (
      <Card title="B01-DN: Bang Can Doi Ke Toan" style={{ marginBottom: 16 }}>
        <Table size="small" loading={loading} pagination={false} dataSource={[
          { key: "a1", item: "A. TAI SAN NGAN HAN", value: fmt(assets?.short || 0) },
          { key: "a2", item: "B. TAI SAN DAI HAN", value: fmt(assets?.long || 0) },
          { key: "a3", item: "TONG TAI SAN", value: fmt(assets?.total || 0), bold: true },
          { key: "l1", item: "C. NO PHAI TRA", value: fmt(liabilities?.total || 0) },
          { key: "e1", item: "D. VON CHU SO HUU", value: fmt(equity?.total || 0) },
          { key: "t1", item: "TONG NGUON VON", value: fmt(data.totalLiabilitiesEquity || 0), bold: true },
        ]} columns={[
          { title: "Khoan muc", dataIndex: "item" },
          { title: "So tien", dataIndex: "value", align: "right", render: (v, r) => ({ children: v, props: { style: { fontWeight: r.bold ? 700 : 400 } } }) },
        ]} />
        <Tag color={data.balanced ? "green" : "red"} style={{ marginTop: 8 }}>
          {data.balanced ? "CAN BANG" : "KHONG CAN BANG! Kiem tra lai but toan."}
        </Tag>
      </Card>
    );
  };

  return (
    <div style={{ padding: 24 }}>
      <PageHeader title="So sach ke toan" subtitle={`Ky: Thang ${month}/${year}`} />

      <Card size="small" style={{ marginBottom: 16 }}>
        <Space wrap>
          <span>Nam: <InputNumber min={2020} max={2030} value={year} onChange={setYear} style={{ width: 80 }} /></span>
          <span>Thang: <InputNumber min={1} max={12} value={month} onChange={setMonth} style={{ width: 60 }} /></span>
          <span>Quy (CIT): <InputNumber min={1} max={4} value={quarter} onChange={setQuarter} style={{ width: 50 }} /></span>
          <span>TK (So Cai): <Select showSearch value={accountId} onChange={setAccountId} style={{ width: 300 }} placeholder="Chon tai khoan" allowClear
            options={[]} /></span>
          <span>Ma TK (Chi Tiet): <Select showSearch value={accountCode} onChange={setAccountCode} style={{ width: 120 }} placeholder="VD: 131" allowClear
            options={[{ value: "131", label: "131 - Phai thu KH" }, { value: "331", label: "331 - Phai tra NB" }, { value: "334", label: "334 - Phai tra NV" }, { value: "111", label: "111 - Tien mat" }, { value: "112", label: "112 - TGNH" }]} /></span>
        </Space>
      </Card>

      <Tabs activeKey={tab} onChange={handleTabChange} items={[
        { key: "trial", label: "CDSPS 6 cot", children: renderCard("Bang Can Doi So Phat Sinh", trialCols, data?.rows) },
        { key: "b01", label: "B01-DN", children: renderB01() },
        { key: "b02", label: "B02-DN", children: renderCard("Ket Qua Kinh Doanh", b02Cols, data?.rows) },
        { key: "journal", label: "So NKC", children: renderCard("So Nhat Ky Chung", journalCols, data?.rows) },
        {
          key: "ledger", label: "So Cai", children: (
            <Card title="So Cai Tai Khoan" extra={<Button onClick={() => accountId ? tabs.find(t => t.key === "ledger")?.fn() : null}>Lay du lieu</Button>} style={{ marginBottom: 16 }}>
              {data?.account && <Tag color="blue">TK {data.account.code} - {data.account.name} | So du DK: {fmt(data.openingBalance)} | So du CK: {fmt(data.closingBalance)}</Tag>}
              {data?.rows ? <Table columns={ledgerCols} dataSource={data.rows} rowKey={(r, i) => i} size="small" loading={loading} scroll={{ x: 1200 }} pagination={{ pageSize: 50 }} /> : <Empty description="Chon TK roi bam Lay du lieu" />}
            </Card>
          ),
        },
        {
          key: "subLedger", label: "So Chi Tiet", children: (
            <Card title="So Chi Tiet" extra={<Button onClick={() => accountCode ? tabs.find(t => t.key === "subLedger")?.fn() : null}>Lay du lieu</Button>} style={{ marginBottom: 16 }}>
              {data?.account && <Tag color="blue">TK {data.account.code} - {data.account.name} | So du DK: {fmt(data.openingBalance)} | So du CK: {fmt(data.closingBalance)}</Tag>}
              {data?.rows ? <Table columns={subLedgerCols} dataSource={data.rows} rowKey={(r, i) => i} size="small" loading={loading} scroll={{ x: 1000 }} pagination={{ pageSize: 50 }} /> : <Empty description="Nhap ma TK roi bam Lay du lieu" />}
            </Card>
          ),
        },
        { key: "valuation", label: "Ton kho", children: (
          <Card title="Dinh Gia Hang Ton Kho">
            {data ? (
              <>
                <Space style={{ marginBottom: 16 }}>
                  <Tag>Phuong phap: {data.method || "Binh quan gia quyen"}</Tag>
                  <Tag>Tong SL: {data.totalQuantity}</Tag>
                  <Tag>Tong gia von: {fmt(data.totalCost)}</Tag>
                  <Tag>Tong gia thi truong: {fmt(data.totalMarket)}</Tag>
                </Space>
              </>
            ) : <Empty description="Chon thang roi bam tab Ton kho" />}
          </Card>
        )},
      ]} />

      <Card title="Thao tac cuoi ky" size="small" style={{ marginTop: 16 }}>
        <Space wrap>
          <Button icon={<CalculatorOutlined />} type="primary" onClick={handleClose}>Ket chuyen cuoi ky</Button>
          <Button icon={<CloseCircleOutlined />} danger onClick={async () => {
            try { await api.post("/accounting/fiscal-periods/reverse-close", periodParams); message.success("Da dao ket chuyen"); } catch (e) { message.error(e.response?.data?.message || "Loi"); }
          }}>Dao ket chuyen</Button>
          <Button onClick={handleDepreciation}>Chay khau hao TSCD</Button>
          <Button onClick={handlePrepaid}>Phan bo CP tra truoc</Button>
          <Button onClick={handleCIT}>Tinh thue TNDN Q{quarter}</Button>
        </Space>
      </Card>
    </div>
  );
}
