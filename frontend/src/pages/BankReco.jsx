// frontend/src/pages/BankReco.jsx
import { useState, useEffect, useCallback } from "react";
import { Table, Button, Space, Tag, Upload, Select, message, Modal, Statistic, Row, Col, Card, Tooltip, Descriptions } from "antd";
import { UploadOutlined, SyncOutlined, LinkOutlined, DisconnectOutlined, ReloadOutlined, CheckCircleOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import PageHeader from "../components/layout/PageHeader";
import { getStatements, getStatementLines, importStatement, autoMatch, manualMatch, unmatch } from "../api/bankReco";
import { getJournalEntries } from "../api/accounting";
import { getBankAccounts } from "../api/finance";

const fmtVND = (v) => Number(v || 0).toLocaleString("vi-VN") + "đ";

export default function BankReco() {
  const [statements, setStatements]   = useState([]);
  const [bankAccounts, setBankAccounts] = useState([]);
  const [selectedStmt, setSelectedStmt] = useState(null);
  const [lines, setLines]               = useState([]);
  const [linesPag, setLinesPag]         = useState({});
  const [loading, setLoading]           = useState(false);
  const [uploadOpen, setUploadOpen]     = useState(false);
  const [uploadData, setUploadData]     = useState({ bankAccountId: "", bank: "VCB", file: null });
  const [matchFilter, setMatchFilter]   = useState(undefined);

  useEffect(() => {
    loadStatements();
    loadBankAccounts();
  }, []);

  const loadStatements = async () => {
    try { setStatements(await getStatements()); }
    catch (e) { message.error("Không tải được sao kê"); }
  };

  const loadBankAccounts = async () => {
    try {
      const res = await getBankAccounts();
      setBankAccounts(Array.isArray(res) ? res : res.accounts || []);
    } catch (_) {}
  };

  const loadLines = useCallback(async (stmtId, page = 1) => {
    setLoading(true);
    try {
      const res = await getStatementLines(stmtId, { page, limit: 50, isMatched: matchFilter });
      setLines(res.lines || []);
      setLinesPag(res.pagination || {});
    } catch (e) { message.error("Không tải được dòng sao kê"); }
    finally { setLoading(false); }
  }, [matchFilter]);

  const selectStatement = (stmt) => {
    setSelectedStmt(stmt);
    loadLines(stmt.id);
  };

  const handleImport = async () => {
    if (!uploadData.bankAccountId || !uploadData.file) {
      return message.error("Chọn tài khoản ngân hàng và file sao kê");
    }
    const fd = new FormData();
    fd.append("file", uploadData.file);
    fd.append("bankAccountId", uploadData.bankAccountId);
    fd.append("bank", uploadData.bank);
    try {
      const stmt = await importStatement(fd);
      message.success(`Đã import ${stmt.lineCount} dòng giao dịch`);
      setUploadOpen(false);
      await loadStatements();
      selectStatement(stmt);
    } catch (e) { message.error(e?.response?.data?.message || "Lỗi import"); }
  };

  const handleAutoMatch = async () => {
    if (!selectedStmt) return;
    try {
      const r = await autoMatch(selectedStmt.id);
      message.success(`Auto-match: ${r.matched}/${r.total} dòng khớp`);
      await loadLines(selectedStmt.id);
      await loadStatements();
    } catch (e) { message.error("Lỗi auto-match"); }
  };

  const handleUnmatch = async (lineId) => {
    try {
      await unmatch(lineId);
      await loadLines(selectedStmt.id);
    } catch (e) { message.error("Lỗi bỏ khớp"); }
  };

  const stmtCols = [
    { title: "Ngân hàng", key: "bank", render: (_, r) => `${r.bankAccount?.bankName || ""} - ${r.bankAccount?.accountNumber || ""}` },
    { title: "File", dataIndex: "fileName", ellipsis: true },
    { title: "Từ ngày", dataIndex: "fromDate", render: (v) => v ? dayjs(v).format("DD/MM/YYYY") : "—" },
    { title: "Đến ngày", dataIndex: "toDate", render: (v) => v ? dayjs(v).format("DD/MM/YYYY") : "—" },
    { title: "Số dòng", dataIndex: "lineCount", align: "right" },
    { title: "Trạng thái", dataIndex: "status", render: (v) => <Tag color={v === "RECONCILED" ? "success" : "processing"}>{v}</Tag> },
    { title: "", key: "sel", render: (_, r) => <Button size="small" type={selectedStmt?.id === r.id ? "primary" : "default"} onClick={() => selectStatement(r)}>Xem</Button> },
  ];

  const lineCols = [
    { title: "Ngày GD", dataIndex: "txDate", width: 110, render: (v) => dayjs(v).format("DD/MM/YYYY") },
    { title: "Nội dung", dataIndex: "description", ellipsis: true },
    { title: "Nợ", dataIndex: "debit", width: 130, align: "right", render: (v) => v > 0 ? <span style={{ color: "#dc2626" }}>{fmtVND(v)}</span> : "—" },
    { title: "Có", dataIndex: "credit", width: 130, align: "right", render: (v) => v > 0 ? <span style={{ color: "#059669" }}>{fmtVND(v)}</span> : "—" },
    { title: "Ref", dataIndex: "reference", width: 120, ellipsis: true },
    { title: "Khớp", key: "matched", width: 90, render: (_, r) => r.isMatched ? <Tag color="success"><CheckCircleOutlined /> Khớp</Tag> : <Tag>Chưa</Tag> },
    {
      title: "", key: "act", width: 80,
      render: (_, r) => r.isMatched ? (
        <Tooltip title="Bỏ khớp">
          <Button size="small" icon={<DisconnectOutlined />} danger onClick={() => handleUnmatch(r.id)} />
        </Tooltip>
      ) : null,
    },
  ];

  const matchedCount = lines.filter((l) => l.isMatched).length;
  const matchRate = lines.length ? Math.round(matchedCount / lines.length * 100) : 0;

  return (
    <div>
      <PageHeader title="Đối soát ngân hàng" subtitle="Import sao kê → auto-match với bút toán kế toán" />

      <Space style={{ marginBottom: 16 }}>
        <Button type="primary" icon={<UploadOutlined />} onClick={() => setUploadOpen(true)}>Import sao kê</Button>
        {selectedStmt && (
          <Button icon={<SyncOutlined />} onClick={handleAutoMatch}>Auto-match</Button>
        )}
      </Space>

      <Row gutter={16}>
        <Col xs={24} md={8}>
          <Card title="Danh sách sao kê" size="small" bodyStyle={{ padding: 0 }}>
            <Table rowKey="id" columns={stmtCols} dataSource={statements} size="small" pagination={false} scroll={{ y: 400 }} />
          </Card>
        </Col>
        <Col xs={24} md={16}>
          {selectedStmt ? (
            <Card
              title={`Dòng giao dịch — ${selectedStmt.fileName}`}
              extra={
                <Space>
                  <Tag>{matchRate}% khớp</Tag>
                  <Select allowClear value={matchFilter} placeholder="Lọc trạng thái"
                    style={{ width: 140 }}
                    onChange={(v) => { setMatchFilter(v); loadLines(selectedStmt.id, 1); }}
                    options={[{ value: true, label: "Đã khớp" }, { value: false, label: "Chưa khớp" }]}
                  />
                  <Button size="small" icon={<ReloadOutlined />} onClick={() => loadLines(selectedStmt.id, 1)} />
                </Space>
              }
              size="small" bodyStyle={{ padding: 0 }}
            >
              <Row gutter={8} style={{ padding: "8px 12px" }}>
                <Col span={8}><Statistic title="Tổng dòng" value={linesPag.total || 0} /></Col>
                <Col span={8}><Statistic title="Đã khớp" value={matchedCount} valueStyle={{ color: "#059669" }} /></Col>
                <Col span={8}><Statistic title="Chưa khớp" value={(linesPag.total || 0) - matchedCount} valueStyle={{ color: "#dc2626" }} /></Col>
              </Row>
              <Table
                rowKey="id" columns={lineCols} dataSource={lines} loading={loading}
                size="small" scroll={{ x: 900 }}
                pagination={{
                  current: linesPag.page, pageSize: linesPag.limit, total: linesPag.total, showSizeChanger: false,
                  onChange: (p) => loadLines(selectedStmt.id, p),
                }}
              />
            </Card>
          ) : (
            <Card><p style={{ textAlign: "center", color: "#94a3b8" }}>Chọn sao kê để xem chi tiết</p></Card>
          )}
        </Col>
      </Row>

      {/* Import modal */}
      <Modal title="Import sao kê ngân hàng" open={uploadOpen} onCancel={() => setUploadOpen(false)}
        onOk={handleImport} okText="Import">
        <Space direction="vertical" style={{ width: "100%" }}>
          <Select placeholder="Chọn tài khoản ngân hàng" style={{ width: "100%" }}
            value={uploadData.bankAccountId || undefined}
            onChange={(v) => setUploadData((d) => ({ ...d, bankAccountId: v }))}
            options={bankAccounts.map((a) => ({ value: a.id, label: `${a.bankName} - ${a.accountNumber}` }))}
          />
          <Select value={uploadData.bank} onChange={(v) => setUploadData((d) => ({ ...d, bank: v }))} style={{ width: "100%" }}
            options={[
              { value: "VCB", label: "Vietcombank (XLSX)" },
              { value: "TCB", label: "Techcombank (CSV/XLSX)" },
              { value: "MB",  label: "MB Bank (XLSX)" },
              { value: "BIDV", label: "BIDV (XLSX)" },
            ]}
          />
          <Upload beforeUpload={(f) => { setUploadData((d) => ({ ...d, file: f })); return false; }} maxCount={1} accept=".xlsx,.xls,.csv">
            <Button icon={<UploadOutlined />}>Chọn file sao kê</Button>
          </Upload>
        </Space>
      </Modal>
    </div>
  );
}
