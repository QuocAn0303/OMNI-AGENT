import { useState, useEffect, useCallback } from "react";
import {
  Table, Button, Space, Tag, Upload, Select, message, Modal, Statistic,
  Row, Col, Card, Tooltip, Input, Form, InputNumber, Descriptions, Empty,
} from "antd";
import {
  UploadOutlined, SyncOutlined, LinkOutlined, DisconnectOutlined,
  ReloadOutlined, CheckCircleOutlined, ThunderboltOutlined,
  DollarOutlined, SearchOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import PageHeader from "../components/layout/PageHeader";
import { getStatements, getStatementLines, importStatement, autoMatch, manualMatch, unmatch, createAdjustment } from "../api/bankReco";
import { getBankAccounts } from "../api/finance";
import useDebounce from "../hooks/useDebounce";
import axios from "../api/axios";

const fmtVND = (v) => Number(v || 0).toLocaleString("vi-VN") + "₫";

export default function BankReco() {
  const [statements, setStatements] = useState([]);
  const [bankAccounts, setBankAccounts] = useState([]);
  const [selectedStmt, setSelectedStmt] = useState(null);
  const [lines, setLines] = useState([]);
  const [linesPag, setLinesPag] = useState({});
  const [loading, setLoading] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadData, setUploadData] = useState({ bankAccountId: "", bank: "VCB", file: null });
  const [matchFilter, setMatchFilter] = useState(undefined);

  // Manual match modal
  const [matchModal, setMatchModal] = useState({ open: false, lineId: null });
  const [jeSearch, setJeSearch] = useState("");
  const debouncedJeSearch = useDebounce(jeSearch, 400);
  const [jeResults, setJeResults] = useState([]);
  const [jeLoading, setJeLoading] = useState(false);

  // Adjustment modal
  const [adjModal, setAdjModal] = useState({ open: false, lineId: null });
  const [adjForm] = Form.useForm();
  const [adjSaving, setAdjSaving] = useState(false);

  // Batch match loading
  const [batchLoading, setBatchLoading] = useState(false);

  useEffect(() => { loadStatements(); loadBankAccounts(); }, []);

  const loadStatements = async () => {
    try {
      const res = await getStatements();
      setStatements(Array.isArray(res) ? res : res.statements || res.data || []);
    } catch { message.error("Không tải được sao kê"); }
  };

  const loadBankAccounts = async () => {
    try {
      const res = await getBankAccounts();
      setBankAccounts(Array.isArray(res) ? res : res.accounts || []);
    } catch { /* noop */ }
  };

  const loadLines = useCallback(async (stmtId, page = 1) => {
    setLoading(true);
    try {
      const res = await getStatementLines(stmtId, { page, limit: 50, isMatched: matchFilter });
      setLines(res.lines || []);
      setLinesPag(res.pagination || {});
    } catch { message.error("Không tải được dòng sao kê"); }
    finally { setLoading(false); }
  }, [matchFilter]);

  const selectStatement = (stmt) => { setSelectedStmt(stmt); loadLines(stmt.id); };

  const handleImport = async () => {
    if (!uploadData.bankAccountId || !uploadData.file) return message.error("Chọn tài khoản ngân hàng và file sao kê");
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
    } catch { message.error("Lỗi auto-match"); }
  };

  const handleBatchMatch = async () => {
    setBatchLoading(true);
    try {
      const r = await axios.post("/bank-reco/statements/auto-match-all").then(r => r.data.data);
      message.success(`Đã duyệt ${r.processed || 0} sao kê, khớp ${r.totalMatched || 0} dòng`);
      await loadStatements();
      if (selectedStmt) await loadLines(selectedStmt.id);
    } catch { message.error("Lỗi auto-match hàng loạt"); }
    finally { setBatchLoading(false); }
  };

  const handleUnmatch = async (lineId) => {
    try {
      await unmatch(lineId);
      await loadLines(selectedStmt.id);
    } catch { message.error("Lỗi bỏ khớp"); }
  };

  // Manual match — search journal entries
  const openMatchModal = (lineId) => {
    setMatchModal({ open: true, lineId });
    setJeSearch("");
    setJeResults([]);
  };

  const searchJE = async (query) => {
    if (!query || query.length < 2) { setJeResults([]); return; }
    setJeLoading(true);
    try {
      const res = await axios.get("/bank-reco/journal-entries/search", { params: { q: query } });
      setJeResults(res.data.data || []);
    } catch { setJeResults([]); }
    finally { setJeLoading(false); }
  };

  // Debounced search
  useEffect(() => {
    if (matchModal.open) searchJE(debouncedJeSearch);
  }, [debouncedJeSearch, matchModal.open]);

  const handleManualMatch = async () => {
    const entryId = matchModal.entryId;
    if (!entryId) return message.warning("Chọn bút toán cần khớp");
    try {
      await manualMatch(matchModal.lineId, entryId);
      message.success("Đã khớp thủ công");
      setMatchModal({ open: false, lineId: null });
      await loadLines(selectedStmt.id);
    } catch (e) { message.error(e?.response?.data?.message || "Lỗi khớp thủ công"); }
  };

  // Adjustment
  const openAdjModal = (lineId) => {
    setAdjModal({ open: true, lineId });
  };

  const handleCreateAdjustment = async () => {
    try {
      const values = await adjForm.validateFields();
      setAdjSaving(true);
      await createAdjustment(adjModal.lineId, values);
      message.success("Đã tạo bút toán điều chỉnh");
      setAdjModal({ open: false, lineId: null });
      adjForm.resetFields();
      await loadLines(selectedStmt.id);
    } catch (e) {
      if (e?.errorFields) return;
      message.error(e?.response?.data?.message || "Lỗi tạo điều chỉnh");
    }
    finally { setAdjSaving(false); }
  };

  const stmtCols = [
    { title: "Ngân hàng", key: "bank", render: (_, r) => `${r.bankAccount?.bankName || ""} - ${r.bankAccount?.accountNumber || ""}` },
    { title: "Tệp tin", dataIndex: "fileName", ellipsis: true },
    { title: "Từ ngày", dataIndex: "fromDate", render: (v) => v ? dayjs(v).format("DD/MM/YYYY") : "—" },
    { title: "Đến ngày", dataIndex: "toDate", render: (v) => v ? dayjs(v).format("DD/MM/YYYY") : "—" },
    { title: "Số dòng", dataIndex: "lineCount", align: "right" },
    { title: "Trạng thái", dataIndex: "status", render: (v) => <Tag color={v === "RECONCILED" ? "success" : "processing"}>{v === "IMPORTED" ? "Đã import" : "Đã đối soát"}</Tag> },
    { title: "", key: "sel", render: (_, r) => <Button size="small" type={selectedStmt?.id === r.id ? "primary" : "default"} onClick={() => selectStatement(r)}>Xem</Button> },
  ];

  const lineCols = [
    { title: "Ngày GD", dataIndex: "txDate", width: 110, render: (v) => dayjs(v).format("DD/MM/YYYY") },
    { title: "Nội dung", dataIndex: "description", ellipsis: true },
    { title: "Nợ", dataIndex: "debit", width: 130, align: "right", render: (v) => v > 0 ? <span style={{ color: "#dc2626" }}>{fmtVND(v)}</span> : "—" },
    { title: "Có", dataIndex: "credit", width: 130, align: "right", render: (v) => v > 0 ? <span style={{ color: "#059669" }}>{fmtVND(v)}</span> : "—" },
    { title: "Tham chiếu", dataIndex: "reference", width: 120, ellipsis: true },
    { title: "Khớp", key: "matched", width: 90, render: (_, r) => r.isMatched ? <Tag color="success"><CheckCircleOutlined /> Khớp</Tag> : <Tag>Chưa</Tag> },
    {
      title: "", key: "act", width: 140,
      render: (_, r) => r.isMatched ? (
        <Space size={4}>
          <Tooltip title="Bỏ khớp"><Button size="small" icon={<DisconnectOutlined />} danger onClick={() => handleUnmatch(r.id)} /></Tooltip>
          {r.isAdjustment && <Tag color="blue" style={{ margin: 0 }}>ĐC</Tag>}
        </Space>
      ) : (
        <Space size={4}>
          <Tooltip title="Khớp thủ công"><Button size="small" icon={<LinkOutlined />} onClick={() => openMatchModal(r.id)} /></Tooltip>
          <Tooltip title="Tạo bút toán điều chỉnh"><Button size="small" icon={<DollarOutlined />} onClick={() => openAdjModal(r.id)} /></Tooltip>
        </Space>
      ),
    },
  ];

  const matchedCount = lines.filter((l) => l.isMatched).length;
  const matchRate = lines.length ? Math.round((matchedCount / lines.length) * 100) : 0;

  return (
    <PlanGate moduleKey="bank-reco" moduleName="Đối soát ngân hàng">
    <div>
      <PageHeader title="Đối soát ngân hàng" subtitle="Nhập sao kê → tự động khớp với bút toán kế toán" />

      <Space style={{ marginBottom: 16 }}>
        <Button type="primary" icon={<UploadOutlined />} onClick={() => setUploadOpen(true)}>Nhập sao kê</Button>
        {selectedStmt && <Button icon={<SyncOutlined />} onClick={handleAutoMatch}>Khớp tự động</Button>}
        <Button icon={<ThunderboltOutlined />} loading={batchLoading} onClick={handleBatchMatch}>Khớp tất cả</Button>
      </Space>

      <Row gutter={16}>
        <Col xs={24} md={8}>
          <Card title="Danh sách sao kê" size="small" bodyStyle={{ padding: 0 }}>
            <Table rowKey="id" columns={stmtCols} dataSource={statements} size="small" pagination={false} scroll={{ y: 400 }} />
          </Card>
        </Col>
        <Col xs={24} md={16}>
          {selectedStmt ? (
            <Card title={`Dòng giao dịch — ${selectedStmt.fileName}`}
              extra={
                <Space>
                  <Tag>{matchRate}% khớp</Tag>
                  <Select allowClear value={matchFilter} placeholder="Lọc trạng thái" style={{ width: 140 }}
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
              <Table rowKey="id" columns={lineCols} dataSource={lines} loading={loading} size="small" scroll={{ x: 1000 }}
                pagination={{ current: linesPag.page, pageSize: linesPag.limit, total: linesPag.total, showSizeChanger: false, onChange: (p) => loadLines(selectedStmt.id, p) }}
              />
            </Card>
          ) : (
            <Card><p style={{ textAlign: "center", color: "#94a3b8" }}>Chọn sao kê để xem chi tiết</p></Card>
          )}
        </Col>
      </Row>

      {/* Import modal */}
      <Modal title="Import sao kê ngân hàng" open={uploadOpen} onCancel={() => setUploadOpen(false)}         onOk={handleImport}
        okText="Nhập">
        <Space direction="vertical" style={{ width: "100%" }}>
          <Select placeholder="Chọn tài khoản ngân hàng" style={{ width: "100%" }} value={uploadData.bankAccountId || undefined}
            onChange={(v) => setUploadData((d) => ({ ...d, bankAccountId: v }))}
            options={bankAccounts.map((a) => ({ value: a.id, label: `${a.bankName} - ${a.accountNumber}` }))} />
          <Select value={uploadData.bank} onChange={(v) => setUploadData((d) => ({ ...d, bank: v }))} style={{ width: "100%" }}
            options={[{ value: "VCB", label: "Vietcombank (XLSX)" }, { value: "TCB", label: "Techcombank (CSV/XLSX)" }, { value: "MB", label: "MB Bank (XLSX)" }, { value: "BIDV", label: "BIDV (XLSX)" }]} />
          <Upload beforeUpload={(f) => { setUploadData((d) => ({ ...d, file: f })); return false; }} maxCount={1} accept=".xlsx,.xls,.csv">
            <Button icon={<UploadOutlined />}>Chọn file sao kê</Button>
          </Upload>
        </Space>
      </Modal>

      {/* Manual match modal */}
      <Modal title="Khớp thủ công với bút toán" open={matchModal.open} onCancel={() => setMatchModal({ open: false, lineId: null })} onOk={handleManualMatch} okText="Khớp">
        <Space direction="vertical" style={{ width: "100%" }}>
          <Input.Search prefix={<SearchOutlined />} placeholder="Tìm mã bút toán hoặc nội dung..." value={jeSearch}
            onChange={(e) => setJeSearch(e.target.value)} loading={jeLoading} enterButton />
          <Table rowKey="id" size="small" pagination={false} dataSource={jeResults} scroll={{ y: 300 }}
            locale={{ emptyText: <Empty description="Không tìm thấy bút toán. Thử từ khóa khác." /> }}
            rowSelection={{ type: 'radio', onChange: (keys) => setMatchModal((m) => ({ ...m, entryId: keys[0] })) }}
            columns={[
              { title: "Mã CT", dataIndex: "entryCode", width: 140 },
              { title: "Ngày", dataIndex: "date", width: 110, render: (v) => dayjs(v).format("DD/MM/YYYY") },
              { title: "Diễn giải", dataIndex: "description", ellipsis: true },
              { title: "Nguồn", dataIndex: "source", width: 100 },
            ]}
          />
        </Space>
      </Modal>

      {/* Adjustment modal */}
      <Modal title="Tạo bút toán điều chỉnh" open={adjModal.open} onCancel={() => setAdjModal({ open: false, lineId: null })} onOk={handleCreateAdjustment} okText="Tạo" confirmLoading={adjSaving}>
        <Form form={adjForm} layout="vertical">
          <Form.Item label="Tài khoản ngân hàng" name="bankAccountId" rules={[{ required: true, message: "Chọn tài khoản" }]}>
            <Select placeholder="Chọn tài khoản NH"
              options={bankAccounts.map((a) => ({ value: a.id, label: `${a.bankName} - ${a.accountNumber}` }))} />
          </Form.Item>
          <Form.Item label="Nội dung điều chỉnh" name="description" rules={[{ required: true }]}>
            <Input placeholder="VD: Phí duy trì thẻ, chênh lệch số dư..." />
          </Form.Item>
          <Form.Item label="Số tiền (VNĐ)" name="amount" rules={[{ required: true }]}>
            <InputNumber style={{ width: "100%" }} min={0} step={1000} placeholder="Nhập số tiền" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
    </PlanGate>
  );
}
