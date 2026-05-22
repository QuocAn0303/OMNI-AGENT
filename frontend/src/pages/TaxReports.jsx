// frontend/src/pages/TaxReports.jsx
import { useState, useCallback } from "react";
import { Tabs, Card, Row, Col, Statistic, Button, Space, Table, Select, DatePicker, message, Spin, Empty } from "antd";
import { DownloadOutlined, ReloadOutlined, FileExcelOutlined, FileTextOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import PageHeader from "../components/layout/PageHeader";
import { getVATReport, getPITReport, downloadVATExcel, downloadVATXML, downloadBHXHExcel } from "../api/taxReport";

const fmtVND = (v) => Number(v || 0).toLocaleString("vi-VN") + "đ";
const fmtNum = (v) => Number(v || 0).toLocaleString("vi-VN");

const downloadBlob = (res, filename) => {
  const url = URL.createObjectURL(res.data);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
};

export default function TaxReports() {
  const now = dayjs();
  const [year,  setYear]  = useState(now.year());
  const [month, setMonth] = useState(now.month() + 1);

  const PeriodSelector = () => (
    <Space style={{ marginBottom: 16 }}>
      <DatePicker
        picker="month"
        value={dayjs(`${year}-${String(month).padStart(2,"0")}-01`)}
        format="MM/YYYY"
        onChange={(d) => { if (d) { setYear(d.year()); setMonth(d.month() + 1); } }}
        allowClear={false}
        style={{ width: 140 }}
      />
    </Space>
  );

  return (
    <div>
      <PageHeader title="Báo cáo thuế" subtitle="01/GTGT, TNCN, BHXH — xuất Excel + XML HTKK" />
      <Tabs
        items={[
          { key: "vat", label: "VAT (01/GTGT)",  children: <VATTab year={year} month={month} PeriodSelector={PeriodSelector} /> },
          { key: "pit", label: "TNCN (05/KK-TNCN)", children: <PITTab year={year} month={month} PeriodSelector={PeriodSelector} /> },
          { key: "bhxh", label: "BHXH (D02-LT)", children: <BHXHTab year={year} month={month} PeriodSelector={PeriodSelector} /> },
        ]}
      />
    </div>
  );
}

function VATTab({ year, month, PeriodSelector }) {
  const [data, setData]     = useState(null);
  const [loading, setLoading] = useState(false);
  const [dlLoading, setDlLoading] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await getVATReport({ year, month })); }
    catch (e) { message.error(e?.response?.data?.message || "Lỗi tải báo cáo"); }
    finally { setLoading(false); }
  }, [year, month]);

  const handleDownload = async (type) => {
    setDlLoading(type);
    try {
      if (type === "excel") {
        const res = await downloadVATExcel({ year, month });
        downloadBlob(res, `bao-cao-thue-${year}-${String(month).padStart(2,"0")}.xlsx`);
      } else {
        const res = await downloadVATXML({ year, month });
        downloadBlob(res, `01-GTGT-${year}-${String(month).padStart(2,"0")}.xml`);
      }
    } catch (e) { message.error("Lỗi tải file"); }
    finally { setDlLoading(""); }
  };

  const salesCols = [
    { title: "Số HĐ", dataIndex: "invoiceNo", width: 120 },
    { title: "Ngày HĐ", dataIndex: "invoiceDate", width: 120, render: (v) => v ? dayjs(v).format("DD/MM/YYYY") : "—" },
    { title: "Tên người mua", dataIndex: "buyerName", ellipsis: true },
    { title: "MST", dataIndex: "buyerTaxCode", width: 130 },
    { title: "Doanh số chưa thuế", dataIndex: "totalBeforeTax", width: 150, align: "right", render: fmtVND },
    { title: "Thuế GTGT", dataIndex: "taxAmount", width: 120, align: "right", render: fmtVND },
  ];

  const purchaseCols = [
    { title: "Số PO", dataIndex: "poCode", width: 130 },
    { title: "Số HĐ", dataIndex: "invoiceNo", width: 120 },
    { title: "Ngày HĐ", dataIndex: "invoiceDate", width: 120, render: (v) => v ? dayjs(v).format("DD/MM/YYYY") : "—" },
    { title: "Người bán", dataIndex: "sellerName", ellipsis: true },
    { title: "MST", dataIndex: "sellerTaxCode", width: 130 },
    { title: "Giá trị chưa thuế", dataIndex: "totalBeforeTax", width: 150, align: "right", render: fmtVND },
    { title: "Thuế GTGT", dataIndex: "taxAmount", width: 120, align: "right", render: fmtVND },
  ];

  return (
    <div>
      <PeriodSelector />
      <Space style={{ marginBottom: 16 }}>
        <Button icon={<ReloadOutlined />} type="primary" onClick={load} loading={loading}>Tính toán</Button>
        <Button icon={<FileExcelOutlined />} onClick={() => handleDownload("excel")} loading={dlLoading === "excel"}>Xuất Excel</Button>
        <Button icon={<FileTextOutlined />} onClick={() => handleDownload("xml")} loading={dlLoading === "xml"}>Xuất XML (HTKK)</Button>
      </Space>

      {loading && <Spin />}
      {data && (
        <>
          <Row gutter={16} style={{ marginBottom: 24 }}>
            <Col xs={24} sm={12} md={6}>
              <Card><Statistic title="Thuế GTGT đầu ra" value={data.vat.vatOutput} formatter={fmtNum} suffix="đ" /></Card>
            </Col>
            <Col xs={24} sm={12} md={6}>
              <Card><Statistic title="Thuế GTGT đầu vào" value={data.vat.vatInput} formatter={fmtNum} suffix="đ" /></Card>
            </Col>
            <Col xs={24} sm={12} md={6}>
              <Card><Statistic title="Thuế phải nộp" value={data.vat.vatPayable} formatter={fmtNum} suffix="đ" valueStyle={{ color: "#dc2626" }} /></Card>
            </Col>
            <Col xs={24} sm={12} md={6}>
              <Card><Statistic title="Được hoàn thuế" value={data.vat.vatRefundable} formatter={fmtNum} suffix="đ" valueStyle={{ color: "#059669" }} /></Card>
            </Col>
          </Row>

          <Tabs items={[
            { key: "s", label: `Bảng kê bán ra (${data.sales.length} HĐ)`,
              children: <Table rowKey="orderCode" columns={salesCols} dataSource={data.sales} size="small" scroll={{ x: 800 }} pagination={{ pageSize: 20 }} /> },
            { key: "p", label: `Bảng kê mua vào (${data.purchases.length} PO)`,
              children: <Table rowKey="poCode" columns={purchaseCols} dataSource={data.purchases} size="small" scroll={{ x: 800 }} pagination={{ pageSize: 20 }} /> },
          ]} />
        </>
      )}
      {!data && !loading && <Empty description="Chọn kỳ và nhấn Tính toán" />}
    </div>
  );
}

function PITTab({ year, month, PeriodSelector }) {
  const [data, setData]     = useState(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await getPITReport({ year, month })); }
    catch (e) { message.error(e?.response?.data?.message || "Lỗi tải báo cáo"); }
    finally { setLoading(false); }
  }, [year, month]);

  const cols = [
    { title: "STT", render: (_, __, i) => i + 1, width: 50 },
    { title: "Họ tên", dataIndex: "employeeName" },
    { title: "Mã BHXH", dataIndex: "socialInsuranceCode", width: 130 },
    { title: "Số NPT", dataIndex: "dependents", width: 80, align: "right" },
    { title: "Lương gross", dataIndex: "grossSalary", width: 140, align: "right", render: fmtVND },
    { title: "BHXH NV đóng", dataIndex: "bhxhEmployee", width: 140, align: "right", render: fmtVND },
    { title: "Thuế TNCN", dataIndex: "pitAmount", width: 120, align: "right",
      render: (v) => <span style={{ color: v > 0 ? "#dc2626" : undefined }}>{fmtVND(v)}</span> },
  ];

  return (
    <div>
      <PeriodSelector />
      <Button icon={<ReloadOutlined />} type="primary" onClick={load} loading={loading} style={{ marginBottom: 16 }}>Tính toán</Button>

      {data && (
        <>
          <Row gutter={16} style={{ marginBottom: 16 }}>
            <Col xs={24} md={8}><Card><Statistic title="Tổng lương gross" value={data.totals.grossSalary} formatter={fmtNum} suffix="đ" /></Card></Col>
            <Col xs={24} md={8}><Card><Statistic title="Tổng BHXH NV" value={data.totals.bhxhEmployee} formatter={fmtNum} suffix="đ" /></Card></Col>
            <Col xs={24} md={8}><Card><Statistic title="Tổng thuế TNCN" value={data.totals.pitAmount} formatter={fmtNum} suffix="đ" valueStyle={{ color: "#dc2626" }} /></Card></Col>
          </Row>
          <Table rowKey="employeeId" columns={cols} dataSource={data.rows} size="small" pagination={false} />
        </>
      )}
      {!data && !loading && <Empty description="Chọn kỳ và nhấn Tính toán" />}
    </div>
  );
}

function BHXHTab({ year, month, PeriodSelector }) {
  const [dlLoading, setDlLoading] = useState(false);

  const handleDownload = async () => {
    setDlLoading(true);
    try {
      const res = await downloadBHXHExcel({ year, month });
      downloadBlob(res, `D02-LT-${year}-${String(month).padStart(2,"0")}.xlsx`);
    } catch (e) { message.error("Lỗi tải file BHXH"); }
    finally { setDlLoading(false); }
  };

  return (
    <div>
      <PeriodSelector />
      <Card style={{ maxWidth: 500 }}>
        <p>Xuất file D02-LT (danh sách lao động tham gia BHXH/BHYT/BHTN) để nộp cho cơ quan BHXH hoặc nhập vào phần mềm eBH.</p>
        <p>Tỷ lệ NV đóng: BHXH 8% + BHYT 1.5% + BHTN 1% = <strong>10.5%</strong></p>
        <p>Mức đóng tối đa: <strong>46,800,000 đ/tháng</strong> (20 × lương cơ sở 2024)</p>
        <Button
          type="primary" icon={<FileExcelOutlined />}
          onClick={handleDownload} loading={dlLoading}
          style={{ marginTop: 8 }}
        >
          Xuất file D02-LT.xlsx
        </Button>
      </Card>
    </div>
  );
}
