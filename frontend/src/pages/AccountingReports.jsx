import { useState, useCallback } from "react";
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
      message.error(e.response?.data?.message || "Lỗi");
      setData(null);
    }
    setLoading(false);
  }, [year, month]);

  const periodParams = { year, month };

  const tabs = [
    { key: "trial", label: "Bảng CĐSPS", fn: () => fetch("/accounting/reports/trial-balance-6col") },
    { key: "b01", label: "B01 - Bảng CĐKT", fn: () => fetch("/accounting/reports/balance-sheet-b01") },
    { key: "b02", label: "B02 - KQKD", fn: () => fetch("/accounting/reports/profit-loss-b02") },
    { key: "journal", label: "Sổ Nhật ký chung", fn: () => fetch("/accounting/reports/general-journal") },
    { key: "ledger", label: "Sổ Cái", fn: () => accountId ? fetch("/accounting/reports/account-ledger", { accountId }) : message.warning("Vui lòng chọn tài khoản") },
    { key: "subLedger", label: "Sổ Chi Tiết", fn: () => accountCode ? fetch("/accounting/reports/sub-ledger", { accountCode }) : message.warning("Vui lòng nhập mã TK") },
    { key: "valuation", label: "Định giá tồn kho", fn: () => fetch("/accounting/reports/inventory-valuation") },
  ];

  const handleTabChange = (key) => { setTab(key); setData(null); };

  const handleClose = async () => {
    try {
      await api.post("/accounting/fiscal-periods/period-close", periodParams);
      message.success("Kết chuyển cuối kỳ thành công");
    } catch (e) { message.error(e.response?.data?.message || "Lỗi"); }
  };

  const handleDepreciation = async () => {
    try {
      await api.post("/accounting/depreciation/run", periodParams);
      message.success("Khấu hao thành công");
    } catch (e) { message.error(e.response?.data?.message || "Lỗi"); }
  };

  const handleCIT = async () => {
    try {
      await api.post("/accounting/tax/cit", { year, quarter });
      message.success("Tính thuế TNDN thành công");
    } catch (e) { message.error(e.response?.data?.message || "Lỗi"); }
  };

  const handlePrepaid = async () => {
    try {
      await api.post("/accounting/prepaid/allocate", periodParams);
      message.success("Phân bổ chi phí trả trước thành công");
    } catch (e) { message.error(e.response?.data?.message || "Lỗi"); }
  };

  const trialCols = [
    { title: "Mã TK", dataIndex: "code", width: 80 },
    { title: "Tên TK", dataIndex: "name", ellipsis: true },
    { title: "Dư ĐK Nợ", dataIndex: "opDebit", align: "right", render: (v) => fmt(v) },
    { title: "Dư ĐK Có", dataIndex: "opCredit", align: "right", render: (v) => fmt(v) },
    { title: "PS Nợ", dataIndex: "periodDebit", align: "right", render: (v) => fmt(v) },
    { title: "PS Có", dataIndex: "periodCredit", align: "right", render: (v) => fmt(v) },
    { title: "Dư CK Nợ", dataIndex: "clDebit", align: "right", render: (v) => fmt(v) },
    { title: "Dư CK Có", dataIndex: "clCredit", align: "right", render: (v) => fmt(v) },
  ];

  const journalCols = [
    { title: "Ngày", dataIndex: "date", width: 100 },
    { title: "Mã CT", dataIndex: "entryCode", width: 120 },
    { title: "Diễn giải", dataIndex: "description", ellipsis: true },
    { title: "TK", dataIndex: "accountCode", width: 70 },
    { title: "Tên TK", dataIndex: "accountName", width: 120 },
    { title: "Nợ", dataIndex: "debit", align: "right", render: (v) => v ? fmt(v) : "" },
    { title: "Có", dataIndex: "credit", align: "right", render: (v) => v ? fmt(v) : "" },
    { title: "TK ĐƯ", dataIndex: "counterpart", width: 100 },
  ];

  const ledgerCols = [
    { title: "Ngày", dataIndex: "date", width: 100 },
    { title: "Mã CT", dataIndex: "entryCode", width: 120 },
    { title: "Diễn giải", dataIndex: "description", ellipsis: true },
    { title: "TK đối ứng", dataIndex: "counterpart", width: 150 },
    { title: "Nợ", dataIndex: "debit", align: "right", render: (v) => v ? fmt(v) : "" },
    { title: "Có", dataIndex: "credit", align: "right", render: (v) => v ? fmt(v) : "" },
    { title: "Số dư", dataIndex: "balance", align: "right", render: (v) => fmt(v) },
  ];

  const subLedgerCols = [
    { title: "Ngày", dataIndex: "date", width: 100 },
    { title: "Mã CT", dataIndex: "entryCode", width: 120 },
    { title: "Diễn giải", dataIndex: "description", ellipsis: true },
    { title: "Nợ", dataIndex: "debit", align: "right", render: (v) => v ? fmt(v) : "" },
    { title: "Có", dataIndex: "credit", align: "right", render: (v) => v ? fmt(v) : "" },
    { title: "Số dư", dataIndex: "balance", align: "right", render: (v) => fmt(v) },
  ];

  const b02Cols = [
    { title: "Mã", dataIndex: "code", width: 60 },
    { title: "Chỉ tiêu", dataIndex: "name" },
    { title: "Số tiền", dataIndex: "value", align: "right", render: (v, r) => ({ children: fmt(v), props: { style: { fontWeight: r.bold ? 700 : 400 } } }) },
  ];

  const renderCard = (title, columns, rows, extra) => (
    <Card title={title} extra={extra} style={{ marginBottom: 16 }}>
      {rows && rows.length > 0 ? (
        <Table columns={columns} dataSource={rows} rowKey={(r, i) => r.code || r.date || r.entryCode || i} size="small" loading={loading} scroll={{ x: 1200 }} pagination={{ pageSize: 50 }} />
      ) : (
        <Empty description="Chưa có dữ liệu. Chọn tháng rồi bấm nút tương ứng." />
      )}
    </Card>
  );

  const renderB01 = () => {
    if (!data) return <Empty description="Chọn tháng rồi bấm Lấy dữ liệu" />;
    const { assets, liabilities, equity } = data;
    return (
        <Card title="B01-DN: Bảng Cân Đối Kế Toán" style={{ marginBottom: 16 }}>
        <Table size="small" loading={loading} pagination={false} dataSource={[
          { key: "a1", item: "A. TÀI SẢN NGẮN HẠN", value: fmt(assets?.short || 0) },
          { key: "a2", item: "B. TÀI SẢN DÀI HẠN", value: fmt(assets?.long || 0) },
          { key: "a3", item: "TỔNG TÀI SẢN", value: fmt(assets?.total || 0), bold: true },
          { key: "l1", item: "C. NỢ PHẢI TRẢ", value: fmt(liabilities?.total || 0) },
          { key: "e1", item: "D. VỐN CHỦ SỞ HỮU", value: fmt(equity?.total || 0) },
          { key: "t1", item: "TỔNG NGUỒN VỐN", value: fmt(data.totalLiabilitiesEquity || 0), bold: true },
        ]} columns={[
          { title: "Khoản mục", dataIndex: "item" },
          { title: "Số tiền", dataIndex: "value", align: "right", render: (v, r) => ({ children: v, props: { style: { fontWeight: r.bold ? 700 : 400 } } }) },
        ]} />
        <Tag color={data.balanced ? "green" : "red"} style={{ marginTop: 8 }}>
          {data.balanced ? "CÂN BẰNG" : "KHÔNG CÂN BẰNG! Kiểm tra lại bút toán."}
        </Tag>
      </Card>
    );
  };

  return (
    <div style={{ padding: 24 }}>
      <PageHeader title="Sổ sách kế toán" subtitle={`Kỳ: Tháng ${month}/${year}`} />

      <Card size="small" style={{ marginBottom: 16 }}>
        <Space wrap>
          <span>Năm: <InputNumber min={2020} max={2030} value={year} onChange={setYear} style={{ width: 80 }} /></span>
          <span>Tháng: <InputNumber min={1} max={12} value={month} onChange={setMonth} style={{ width: 60 }} /></span>
          <span>Quý (CIT): <InputNumber min={1} max={4} value={quarter} onChange={setQuarter} style={{ width: 50 }} /></span>
          <span>TK (Sổ Cái): <Select showSearch value={accountId} onChange={setAccountId} style={{ width: 300 }} placeholder="Chọn tài khoản" allowClear
            options={[]} /></span>
          <span>Mã TK (Chi Tiết): <Select showSearch value={accountCode} onChange={setAccountCode} style={{ width: 120 }} placeholder="VD: 131" allowClear
            options={[{ value: "131", label: "131 - Phải thu KH" }, { value: "331", label: "331 - Phải trả NB" }, { value: "334", label: "334 - Phải trả NV" }, { value: "111", label: "111 - Tiền mặt" }, { value: "112", label: "112 - TGNH" }]} /></span>
        </Space>
      </Card>

      <Tabs activeKey={tab} onChange={handleTabChange} items={[
        { key: "trial", label: "CDSPS 6 cột", children: renderCard("Bảng Cân Đối Số Phát Sinh", trialCols, data?.rows) },
        { key: "b01", label: "B01-DN", children: renderB01() },
        { key: "b02", label: "B02-DN", children: renderCard("Kết Quả Kinh Doanh", b02Cols, data?.rows) },
        { key: "journal", label: "Sổ NKC", children: renderCard("Sổ Nhật Ký Chung", journalCols, data?.rows) },
        {
          key: "ledger", label: "Sổ Cái", children: (
            <Card title="Sổ Cái Tài Khoản" extra={<Button onClick={() => accountId ? tabs.find(t => t.key === "ledger")?.fn() : null}>Lấy dữ liệu</Button>} style={{ marginBottom: 16 }}>
              {data?.account && <Tag color="blue">TK {data.account.code} - {data.account.name} | Số dư ĐK: {fmt(data.openingBalance)} | Số dư CK: {fmt(data.closingBalance)}</Tag>}
              {data?.rows ? <Table columns={ledgerCols} dataSource={data.rows} rowKey={(r, i) => i} size="small" loading={loading} scroll={{ x: 1200 }} pagination={{ pageSize: 50 }} /> : <Empty description="Chọn TK rồi bấm Lấy dữ liệu" />}
            </Card>
          ),
        },
        {
          key: "subLedger", label: "Sổ Chi Tiết", children: (
            <Card title="Sổ Chi Tiết" extra={<Button onClick={() => accountCode ? tabs.find(t => t.key === "subLedger")?.fn() : null}>Lấy dữ liệu</Button>} style={{ marginBottom: 16 }}>
              {data?.account && <Tag color="blue">TK {data.account.code} - {data.account.name} | Số dư ĐK: {fmt(data.openingBalance)} | Số dư CK: {fmt(data.closingBalance)}</Tag>}
              {data?.rows ? <Table columns={subLedgerCols} dataSource={data.rows} rowKey={(r, i) => i} size="small" loading={loading} scroll={{ x: 1000 }} pagination={{ pageSize: 50 }} /> : <Empty description="Nhập mã TK rồi bấm Lấy dữ liệu" />}
            </Card>
          ),
        },
        { key: "valuation", label: "Tồn kho", children: (
          <Card title="Định Giá Hàng Tồn Kho">
            {data ? (
              <>
                <Space style={{ marginBottom: 16 }}>
                  <Tag>Phương pháp: {data.method || "Bình quân gia quyền"}</Tag>
                  <Tag>Tổng SL: {data.totalQuantity}</Tag>
                  <Tag>Tổng giá vốn: {fmt(data.totalCost)}</Tag>
                  <Tag>Tổng giá thị trường: {fmt(data.totalMarket)}</Tag>
                </Space>
              </>
            ) : <Empty description="Chọn tháng rồi bấm tab Tồn kho" />}
          </Card>
        )},
      ]} />

      <Card title="Thao tác cuối kỳ" size="small" style={{ marginTop: 16 }}>
        <Space wrap>
          <Button icon={<CalculatorOutlined />} type="primary" onClick={handleClose}>Kết chuyển cuối kỳ</Button>
          <Button icon={<CloseCircleOutlined />} danger onClick={async () => {
            try { await api.post("/accounting/fiscal-periods/reverse-close", periodParams); message.success("Đã đảo kết chuyển"); } catch (e) { message.error(e.response?.data?.message || "Lỗi"); }
          }}>Đảo kết chuyển</Button>
          <Button onClick={handleDepreciation}>Chạy khấu hao TSCĐ</Button>
          <Button onClick={handlePrepaid}>Phân bổ CP trả trước</Button>
          <Button onClick={handleCIT}>Tính thuế TNDN Q{quarter}</Button>
        </Space>
      </Card>
    </div>
  );
}
