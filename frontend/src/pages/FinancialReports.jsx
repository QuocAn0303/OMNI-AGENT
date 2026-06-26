/**
 * Frontend: pages/FinancialReports.jsx — Báo cáo tài chính đa tab
 * 
 * Tổng quan:
 * - Tabs: Lãi/lỗ (P&L), Bảng cân đối kế toán (BS), Lưu chuyển tiền tệ (CF), VAT, Công nợ phải thu/phải trả (Aging), Bảng cân đối phát sinh (TB), Sổ cái (GL)
 * - Mỗi tab là một component riêng, tự gọi API (getProfitLoss, getBalanceSheet, getCashFlow, getVatReport, getAgingReport, getTrialBalance, getGeneralLedger)
 * - Dùng PeriodPicker chung để chọn khoảng thời gian
 * - State: mỗi tab quản lý range/data/loading riêng
 * 
 * Components/Hooks/Exports:
 * - FinancialReports (default): Container chính với Tabs
 * - PeriodPicker: Component chọn khoảng thời gian + nút tải lại
 * - PnLTab, BSTab, CashFlowTab, VATTab, AgingTab, TBTab, GLTab: Các tab con
 */
import { useEffect, useState } from "react";
import { Tabs, Card, DatePicker, Space, Button, Table, Tag, Statistic, Row, Col, Select, message, Empty } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import PageHeader from "../components/layout/PageHeader";

import {
  getBalanceSheet, getProfitLoss, getCashFlow, getVatReport,
  getAgingReport, getTrialBalance, getGeneralLedger, getAccounts,
} from "../api/accounting";

const fmtVND = (v) => Number(v || 0).toLocaleString("vi-VN") + "đ";
const { RangePicker } = DatePicker;

const SOURCE_LABELS = {
  ORDER: "Bán hàng", PAYMENT: "Thu tiền KH", RETURN: "Trả hàng",
  PURCHASE: "Mua hàng", EXPENSE: "Chi phí", PAYROLL: "Lương",
  BANK: "Ngân hàng", MANUAL: "Thủ công", OPENING_BALANCE: "Số dư đầu", ADJUSTMENT: "Điều chỉnh", INVENTORY: "Kho",
};

export default function FinancialReports() {
  return (
    <div>
      <PageHeader title="Báo cáo tài chính" subtitle="Bảng cân đối, KQKD, Lưu chuyển tiền tệ, VAT và công nợ" />
      <Tabs
        defaultActiveKey="pl"
        items={[
          { key: "pl", label: "Báo cáo lãi/lỗ", children: <PnLTab /> },
          { key: "bs", label: "Bảng cân đối kế toán", children: <BSTab /> },
          { key: "cf", label: "Lưu chuyển tiền tệ", children: <CashFlowTab /> },
          { key: "vat", label: "Thuế VAT", children: <VATTab /> },
          { key: "ar", label: "Công nợ phải thu", children: <AgingTab code="131" /> },
          { key: "ap", label: "Công nợ phải trả", children: <AgingTab code="331" /> },
          { key: "tb", label: "Bảng cân đối phát sinh", children: <TBTab /> },
          { key: "gl", label: "Sổ cái tài khoản", children: <GLTab /> },
        ]}
      />
    </div>
  );
}

function PeriodPicker({ range, onChange, onReload, loading }) {
  return (
    <Space style={{ marginBottom: 16 }}>
      <RangePicker
        value={range}
        onChange={onChange}
        format="DD/MM/YYYY"
        presets={[
          { label: "Tháng này", value: [dayjs().startOf("month"), dayjs().endOf("month")] },
          { label: "Tháng trước", value: [dayjs().subtract(1, "month").startOf("month"), dayjs().subtract(1, "month").endOf("month")] },
          { label: "3 tháng gần nhất", value: [dayjs().subtract(3, "month"), dayjs()] },
          { label: "Năm nay", value: [dayjs().startOf("year"), dayjs().endOf("year")] },
        ]}
      />
      <Button icon={<ReloadOutlined />} onClick={onReload} loading={loading}>Tải lại</Button>
    </Space>
  );
}

function PnLTab() {
  const [range, setRange] = useState([dayjs().startOf("month"), dayjs().endOf("month")]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await getProfitLoss({
        from: range[0]?.toISOString(),
        to: range[1]?.toISOString(),
      });
      setData(r);
    } catch (e) { message.error(e.response?.data?.message || "Lỗi"); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [range]);

  return (
    <>
      <PeriodPicker range={range} onChange={setRange} onReload={load} loading={loading} />
      {data && (
        <Card>
          <Row gutter={16} style={{ marginBottom: 16 }}>
            <Col span={6}><Statistic title="Doanh thu thuần" value={data.netRevenue} formatter={fmtVND} /></Col>
            <Col span={6}><Statistic title="Lợi nhuận gộp" value={data.grossProfit} formatter={fmtVND} valueStyle={{ color: data.grossProfit >= 0 ? "#16a34a" : "#dc2626" }} /></Col>
            <Col span={6}><Statistic title="Chi phí" value={data.expenses} formatter={fmtVND} valueStyle={{ color: "#dc2626" }} /></Col>
            <Col span={6}><Statistic title="Lợi nhuận thuần" value={data.operatingProfit} formatter={fmtVND} valueStyle={{ color: data.operatingProfit >= 0 ? "#16a34a" : "#dc2626" }} /></Col>
          </Row>

          <PnLSection title="DOANH THU" rows={data.detail.revenue} sign={1} />
          <PnLSection title="GIẢM TRỪ DOANH THU" rows={data.detail.deductions} sign={-1} />
          <Row><Col span={24}><PnLLine label="DOANH THU THUẦN" value={data.netRevenue} bold /></Col></Row>
          <PnLSection title="GIÁ VỐN" rows={data.detail.cogs} sign={-1} />
          <Row><Col span={24}><PnLLine label="LỢI NHUẬN GỘP" value={data.grossProfit} bold positive={data.grossProfit >= 0} /></Col></Row>
          <PnLSection title="CHI PHÍ" rows={data.detail.expenses} sign={-1} />
          <Row><Col span={24}><PnLLine label="LỢI NHUẬN THUẦN" value={data.operatingProfit} bold highlight positive={data.operatingProfit >= 0} /></Col></Row>
        </Card>
      )}
    </>
  );
}

function PnLSection({ title, rows, sign }) {
  if (!rows?.length) return null;
  return (
    <>
      <div style={{ fontWeight: 600, marginTop: 16, marginBottom: 8 }}>{title}</div>
      {rows.map((r) => (
        <PnLLine key={r.code} label={`  ${r.code} - ${r.name}`} value={sign * r.amount} />
      ))}
    </>
  );
}
function PnLLine({ label, value, bold, positive, highlight }) {
  const color = highlight ? (positive ? "#16a34a" : "#dc2626") : (value < 0 ? "#dc2626" : "inherit");
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", padding: "6px 0",
      borderBottom: "1px solid #f0f0f0", fontWeight: bold ? 700 : 400, color,
      background: highlight ? "#fef3c7" : "transparent",
      paddingLeft: highlight ? 12 : 0, paddingRight: highlight ? 12 : 0,
      fontSize: highlight ? 16 : 14,
    }}>
      <span>{label}</span><span>{fmtVND(value)}</span>
    </div>
  );
}

function BSTab() {
  const [asOf, setAsOf] = useState(dayjs());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try { setData(await getBalanceSheet({ asOf: asOf.toISOString() })); }
    catch (e) { message.error(e.response?.data?.message || "Lỗi"); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [asOf]);

  return (
    <>
      <Space style={{ marginBottom: 16 }}>
        <DatePicker value={asOf} onChange={setAsOf} format="DD/MM/YYYY" />
        <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>Tải lại</Button>
      </Space>

      {data && (
        <Row gutter={16}>
          <Col xs={24} lg={12}>
            <Card title="TÀI SẢN" extra={<Tag color={data.isBalanced ? "green" : "red"}>{data.isBalanced ? "Cân bằng" : "Lệch"}</Tag>}>
              {data.assets.length ? data.assets.map((r) => (
                <PnLLine key={r.code} label={`${r.code} - ${r.name}`} value={r.amount} />
              )) : <Empty />}
              <PnLLine label="TỔNG TÀI SẢN" value={data.totalAssets} bold highlight positive />
            </Card>
          </Col>
          <Col xs={24} lg={12}>
            <Card title="NGUỒN VỐN">
              <div style={{ fontWeight: 600, marginBottom: 8 }}>NỢ PHẢI TRẢ</div>
              {data.liabilities.length ? data.liabilities.map((r) => (
                <PnLLine key={r.code} label={`${r.code} - ${r.name}`} value={r.amount} />
              )) : <div style={{ color: "#9ca3af" }}>(Không có)</div>}
              <PnLLine label="Tổng nợ phải trả" value={data.totalLiabilities} bold />

              <div style={{ fontWeight: 600, marginTop: 16, marginBottom: 8 }}>VỐN CHỦ SỞ HỮU</div>
              {data.equity.length ? data.equity.map((r) => (
                <PnLLine key={r.code} label={`${r.code} - ${r.name}`} value={r.amount} />
              )) : <div style={{ color: "#9ca3af" }}>(Không có)</div>}
              <PnLLine label="Tổng vốn chủ" value={data.totalEquity} bold />

              <PnLLine label="TỔNG NGUỒN VỐN" value={data.totalLiabilitiesAndEquity} bold highlight positive />
            </Card>
          </Col>
        </Row>
      )}
    </>
  );
}

function CashFlowTab() {
  const [range, setRange] = useState([dayjs().startOf("month"), dayjs().endOf("month")]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const load = async () => {
    setLoading(true);
    try { setData(await getCashFlow({ from: range[0]?.toISOString(), to: range[1]?.toISOString() })); }
    catch (e) { message.error(e.response?.data?.message || "Lỗi"); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [range]);

  return (
    <>
      <PeriodPicker range={range} onChange={setRange} onReload={load} loading={loading} />
      {data && (
        <>
          <Row gutter={16} style={{ marginBottom: 16 }}>
            <Col span={6}><Card><Statistic title="Tiền đầu kỳ" value={data.openingCash} formatter={fmtVND} /></Card></Col>
            <Col span={6}><Card><Statistic title="Tiền vào" value={data.totalInflow} formatter={fmtVND} valueStyle={{ color: "#16a34a" }} /></Card></Col>
            <Col span={6}><Card><Statistic title="Tiền ra" value={data.totalOutflow} formatter={fmtVND} valueStyle={{ color: "#dc2626" }} /></Card></Col>
            <Col span={6}><Card><Statistic title="Tiền cuối kỳ" value={data.closingCash} formatter={fmtVND} valueStyle={{ color: data.closingCash > 0 ? "#16a34a" : "#dc2626" }} /></Card></Col>
          </Row>
          <Row gutter={16}>
            <Col xs={24} lg={12}>
              <Card title="Theo loại hoạt động">
                <PnLLine label="Hoạt động kinh doanh" value={data.byActivity.OPERATING} bold positive={data.byActivity.OPERATING >= 0} />
                <PnLLine label="Hoạt động đầu tư" value={data.byActivity.INVESTING} bold positive={data.byActivity.INVESTING >= 0} />
                <PnLLine label="Hoạt động tài chính" value={data.byActivity.FINANCING} bold positive={data.byActivity.FINANCING >= 0} />
                <PnLLine label="Lưu chuyển tiền thuần" value={data.netCashFlow} bold highlight positive={data.netCashFlow >= 0} />
              </Card>
            </Col>
            <Col xs={24} lg={12}>
              <Card title="Theo nguồn">
                <Table
                  size="small"
                  pagination={false}
                  rowKey="source"
                  dataSource={data.bySource}
                  columns={[
                    { title: "Nguồn", dataIndex: "source", render: (s) => SOURCE_LABELS[s] || s },
                    { title: "Vào", dataIndex: "inflow", align: "right", render: fmtVND },
                    { title: "Ra", dataIndex: "outflow", align: "right", render: fmtVND },
                    { title: "Net", dataIndex: "net", align: "right", render: (v) => <Tag color={v >= 0 ? "green" : "red"}>{fmtVND(v)}</Tag> },
                  ]}
                />
              </Card>
            </Col>
          </Row>
        </>
      )}
    </>
  );
}

function VATTab() {
  const [range, setRange] = useState([dayjs().startOf("month"), dayjs().endOf("month")]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const load = async () => {
    setLoading(true);
    try { setData(await getVatReport({ from: range[0]?.toISOString(), to: range[1]?.toISOString() })); }
    catch (e) { message.error(e.response?.data?.message || "Lỗi"); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [range]);

  return (
    <>
      <PeriodPicker range={range} onChange={setRange} onReload={load} loading={loading} />
      {data && (
        <Card title="Tờ khai VAT" style={{ maxWidth: 600 }}>
          <PnLLine label="VAT đầu ra (3331 - bán hàng)" value={data.vatOutput} />
          <PnLLine label="VAT đầu vào (1331 - mua hàng/chi phí)" value={-data.vatInput} />
          <PnLLine label={data.payable >= 0 ? "VAT PHẢI NỘP" : "VAT ĐƯỢC KHẤU TRỪ KỲ SAU"} value={Math.abs(data.payable)} bold highlight positive={data.payable < 0} />
          <div style={{ marginTop: 12, padding: 12, background: "#f0f9ff", borderRadius: 6 }}>{data.note}</div>
        </Card>
      )}
    </>
  );
}

function AgingTab({ code }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const load = async () => {
    setLoading(true);
    try { setData(await getAgingReport({ accountCode: code })); }
    catch (e) { message.error(e.response?.data?.message || "Lỗi"); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [code]);

  return (
    <>
      <Button icon={<ReloadOutlined />} onClick={load} loading={loading} style={{ marginBottom: 16 }}>Tải lại</Button>
      {data && (
        <>
          <Row gutter={16} style={{ marginBottom: 16 }}>
            <Col><Card><Statistic title="Tổng" value={data.totalOutstanding} formatter={fmtVND} /></Card></Col>
            <Col><Card><Statistic title="Hiện hành" value={data.summary.current} formatter={fmtVND} /></Card></Col>
            <Col><Card><Statistic title="1-30 ngày" value={data.summary["1-30"]} formatter={fmtVND} /></Card></Col>
            <Col><Card><Statistic title="31-60 ngày" value={data.summary["31-60"]} formatter={fmtVND} valueStyle={{ color: "#f59e0b" }} /></Card></Col>
            <Col><Card><Statistic title="61-90 ngày" value={data.summary["61-90"]} formatter={fmtVND} valueStyle={{ color: "#ef4444" }} /></Card></Col>
            <Col><Card><Statistic title="Trên 90 ngày" value={data.summary.over90} formatter={fmtVND} valueStyle={{ color: "#dc2626" }} /></Card></Col>
          </Row>
          <Table
            size="small"
            rowKey={(r) => `${r.partyType}-${r.partyId}`}
            dataSource={data.rows}
            pagination={{ pageSize: 20 }}
            columns={[
              { title: "Đối tượng", render: (_, r) => r.party?.name || `(${r.partyType || "Không rõ"})` },
              { title: "SĐT", render: (_, r) => r.party?.phone, width: 130 },
              { title: "Số dư", dataIndex: "balance", align: "right", width: 150, render: fmtVND },
              {
                title: "Tuổi nợ", dataIndex: "ageDays", width: 130,
                render: (d, r) => <Tag color={r.bucket === "over90" ? "red" : r.bucket === "61-90" ? "volcano" : r.bucket === "31-60" ? "orange" : r.bucket === "1-30" ? "blue" : "green"}>{d || 0} ngày</Tag>,
              },
            ]}
          />
        </>
      )}
    </>
  );
}

function TBTab() {
  const [range, setRange] = useState([dayjs().startOf("month"), dayjs().endOf("month")]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const load = async () => {
    setLoading(true);
    try { setData(await getTrialBalance({ from: range[0]?.toISOString(), to: range[1]?.toISOString() })); }
    catch (e) { message.error(e.response?.data?.message || "Lỗi"); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [range]);

  return (
    <>
      <PeriodPicker range={range} onChange={setRange} onReload={load} loading={loading} />
      {data && (
        <Card extra={<Tag color={data.isBalanced ? "green" : "red"}>{data.isBalanced ? "Cân bằng" : "LỆCH!"}</Tag>}>
          <Table
            size="small"
            rowKey="code"
            dataSource={data.rows}
            pagination={{ pageSize: 50 }}
            columns={[
              { title: "Mã", dataIndex: "code", width: 80 },
              { title: "Tên", dataIndex: "name" },
              { title: "Loại", dataIndex: "type", width: 130 },
              { title: "Phát sinh Nợ", dataIndex: "debit", align: "right", render: fmtVND },
              { title: "Phát sinh Có", dataIndex: "credit", align: "right", render: fmtVND },
              { title: "Số dư", dataIndex: "balance", align: "right", render: fmtVND },
            ]}
            summary={() => (
              <Table.Summary fixed>
                <Table.Summary.Row>
                  <Table.Summary.Cell index={0} colSpan={3}><b>TỔNG</b></Table.Summary.Cell>
                  <Table.Summary.Cell index={3} align="right"><b>{fmtVND(data.totalDebit)}</b></Table.Summary.Cell>
                  <Table.Summary.Cell index={4} align="right"><b>{fmtVND(data.totalCredit)}</b></Table.Summary.Cell>
                  <Table.Summary.Cell index={5} />
                </Table.Summary.Row>
              </Table.Summary>
            )}
          />
        </Card>
      )}
    </>
  );
}

function GLTab() {
  const [accounts, setAccounts] = useState([]);
  const [accountId, setAccountId] = useState(null);
  const [range, setRange] = useState([dayjs().startOf("month"), dayjs().endOf("month")]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    getAccounts().then((acc) => {
      setAccounts(acc);
      if (acc?.length && !accountId) setAccountId(acc.find((a) => a.code === "111")?.id || acc[0].id);
    });
  }, []);

  const load = async () => {
    if (!accountId) return;
    setLoading(true);
    try { setData(await getGeneralLedger({ accountId, from: range[0]?.toISOString(), to: range[1]?.toISOString(), limit: 100 })); }
    catch (e) { message.error(e.response?.data?.message || "Lỗi"); }
    finally { setLoading(false); }
  };
  useEffect(() => { if (accountId) load(); }, [accountId, range]);

  return (
    <>
      <Space style={{ marginBottom: 16 }}>
        <Select
          showSearch
          optionFilterProp="label"
          style={{ width: 360 }}
          value={accountId}
          onChange={setAccountId}
          options={accounts.map((a) => ({ value: a.id, label: `${a.code} - ${a.nameVi}` }))}
        />
        <RangePicker value={range} onChange={setRange} format="DD/MM/YYYY" />
        <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>Tải lại</Button>
      </Space>
      {data && (
        <Card title={`${data.account.code} - ${data.account.nameVi}`}>
          <Row gutter={16} style={{ marginBottom: 16 }}>
            <Col><Statistic title="Số dư đầu" value={data.openingBalance} formatter={fmtVND} /></Col>
            <Col><Statistic title="Số dư cuối" value={data.closingBalance} formatter={fmtVND} /></Col>
          </Row>
          <Table
            size="small"
            rowKey="id"
            dataSource={data.items}
            pagination={{ pageSize: 50 }}
            columns={[
              { title: "Ngày", dataIndex: "date", width: 110, render: (d) => dayjs(d).format("DD/MM/YYYY") },
              { title: "Bút toán", dataIndex: "entryCode", width: 160 },
              { title: "Nguồn", dataIndex: "source", width: 110, render: (s) => SOURCE_LABELS[s] || s },
              { title: "Diễn giải", dataIndex: "description", ellipsis: true },
              { title: "Nợ", dataIndex: "debit", align: "right", width: 130, render: (v) => v ? fmtVND(v) : "—" },
              { title: "Có", dataIndex: "credit", align: "right", width: 130, render: (v) => v ? fmtVND(v) : "—" },
              { title: "Số dư", dataIndex: "balance", align: "right", width: 140, render: fmtVND },
            ]}
          />
        </Card>
      )}
    </>
  );
}
