// frontend/src/pages/ReportBuilder.jsx
import { useState, useEffect } from "react";
import {
  Table, Button, Space, Select, Form, Input, Modal, message,
  Card, Row, Col, Tag, Collapse, Tooltip,
} from "antd";
import { PlayCircleOutlined, SaveOutlined, PlusOutlined, DeleteOutlined } from "@ant-design/icons";
import PageHeader from "../components/layout/PageHeader";
import { getTables, getReports, createReport, deleteReport, runAdHoc, runSavedReport } from "../api/reportBuilder";

const AGG_FNS = ["SUM", "COUNT", "AVG", "MIN", "MAX"];
const OPS = ["=", "!=", ">", "<", ">=", "<=", "ILIKE"];

export default function ReportBuilder() {
  const [tables, setTables]         = useState([]);
  const [savedReports, setSavedReports] = useState([]);
  const [loading, setLoading]       = useState(false);

  // Builder state
  const [selectedTable, setSelectedTable] = useState(null);
  const [selectedFields, setSelectedFields] = useState([]);
  const [filters, setFilters]       = useState([]);
  const [groupBy, setGroupBy]       = useState(null);
  const [aggregate, setAggregate]   = useState(null);
  const [results, setResults]       = useState(null);
  const [running, setRunning]       = useState(false);

  const [saveOpen, setSaveOpen] = useState(false);
  const [saveForm] = Form.useForm();
  const [saving, setSaving] = useState(false);

  useEffect(() => { load(); }, []);

  const load = async () => {
    const [t, r] = await Promise.all([getTables(), getReports()]);
    setTables(t || []);
    setSavedReports(r || []);
  };

  const currentTable = tables.find((t) => t.key === selectedTable);
  const fieldOpts = currentTable?.fields.map((f) => ({ value: f, label: f })) || [];

  const handleRun = async () => {
    if (!selectedTable || !selectedFields.length) return message.warning("Chọn bảng và ít nhất 1 cột");
    setRunning(true);
    try {
      const config = { table: selectedTable, fields: selectedFields, filters, groupBy, aggregate };
      const data = await runAdHoc(config);
      setResults(Array.isArray(data) ? data : []);
    } catch (e) { message.error(e?.response?.data?.message || "Lỗi chạy báo cáo"); }
    finally { setRunning(false); }
  };

  const handleSave = async () => {
    const vals = await saveForm.validateFields();
    setSaving(true);
    try {
      await createReport({ ...vals, config: { table: selectedTable, fields: selectedFields, filters, groupBy, aggregate } });
      message.success("Đã lưu báo cáo");
      setSaveOpen(false);
      saveForm.resetFields();
      const r = await getReports();
      setSavedReports(r || []);
    } catch (e) { message.error(e?.response?.data?.message || "Lỗi lưu"); }
    finally { setSaving(false); }
  };

  const handleRunSaved = async (id) => {
    setRunning(true);
    try { setResults(await runSavedReport(id)); }
    catch (e) { message.error("Lỗi chạy báo cáo"); }
    finally { setRunning(false); }
  };

  const handleDeleteSaved = async (id) => {
    await deleteReport(id);
    setSavedReports((prev) => prev.filter((r) => r.id !== id));
  };

  const addFilter = () => setFilters((prev) => [...prev, { field: currentTable?.fields[0] || "", op: "=", value: "" }]);
  const updateFilter = (i, key, val) => setFilters((prev) => prev.map((f, idx) => idx === i ? { ...f, [key]: val } : f));
  const removeFilter = (i) => setFilters((prev) => prev.filter((_, idx) => idx !== i));

  // Build result columns from first row
  const resultCols = results?.length
    ? Object.keys(results[0]).map((k) => ({ title: k, dataIndex: k, key: k, render: (v) => v == null ? "—" : String(v) }))
    : [];

  const savedCols = [
    { title: "Tên", dataIndex: "name", ellipsis: true },
    { title: "Bảng", key: "table", render: (_, r) => r.config?.table || "—" },
    { title: "Người tạo", key: "by", render: (_, r) => r.createdBy?.fullName || "—" },
    {
      title: "", key: "act", width: 110,
      render: (_, r) => (
        <Space size={4}>
          <Button size="small" icon={<PlayCircleOutlined />} onClick={() => handleRunSaved(r.id)}>Chạy</Button>
          <Button size="small" danger icon={<DeleteOutlined />} onClick={() => handleDeleteSaved(r.id)} />
        </Space>
      ),
    },
  ];

  return (
    <div>
      <PageHeader title="Report Builder" subtitle="Tạo báo cáo kéo-thả, không cần lập trình" />

      <Row gutter={16}>
        <Col xs={24} md={8}>
          <Card title="Báo cáo đã lưu" size="small" bodyStyle={{ padding: 0 }}>
            <Table rowKey="id" columns={savedCols} dataSource={savedReports} size="small" pagination={false} loading={loading} />
          </Card>
        </Col>
        <Col xs={24} md={16}>
          <Card
            title="Tạo báo cáo mới"
            extra={
              <Space>
                <Button icon={<SaveOutlined />} onClick={() => setSaveOpen(true)} disabled={!selectedTable}>Lưu</Button>
                <Button type="primary" icon={<PlayCircleOutlined />} loading={running} onClick={handleRun}>Chạy</Button>
              </Space>
            }
            size="small"
          >
            <Space direction="vertical" style={{ width: "100%" }}>
              <Row gutter={12}>
                <Col span={12}>
                  <label style={{ fontSize: 12, color: "#64748b" }}>Bảng dữ liệu</label>
                  <Select style={{ width: "100%", marginTop: 4 }} placeholder="Chọn bảng"
                    value={selectedTable}
                    onChange={(v) => { setSelectedTable(v); setSelectedFields([]); setFilters([]); setGroupBy(null); }}
                    options={tables.map((t) => ({ value: t.key, label: t.label }))}
                  />
                </Col>
                <Col span={12}>
                  <label style={{ fontSize: 12, color: "#64748b" }}>Các cột hiển thị</label>
                  <Select mode="multiple" style={{ width: "100%", marginTop: 4 }} placeholder="Chọn cột"
                    value={selectedFields} onChange={setSelectedFields} options={fieldOpts} disabled={!selectedTable}
                  />
                </Col>
              </Row>

              <Collapse size="small" ghost items={[
                {
                  key: "filter", label: `Bộ lọc (${filters.length})`,
                  children: (
                    <Space direction="vertical" style={{ width: "100%" }}>
                      {filters.map((f, i) => (
                        <Row key={i} gutter={8} align="middle">
                          <Col span={7}><Select size="small" style={{ width: "100%" }} value={f.field} onChange={(v) => updateFilter(i, "field", v)} options={fieldOpts} /></Col>
                          <Col span={5}><Select size="small" style={{ width: "100%" }} value={f.op} onChange={(v) => updateFilter(i, "op", v)} options={OPS.map((o) => ({ value: o, label: o }))} /></Col>
                          <Col span={9}><Input size="small" value={f.value} onChange={(e) => updateFilter(i, "value", e.target.value)} /></Col>
                          <Col span={3}><Button size="small" danger icon={<DeleteOutlined />} onClick={() => removeFilter(i)} /></Col>
                        </Row>
                      ))}
                      <Button size="small" icon={<PlusOutlined />} onClick={addFilter} disabled={!selectedTable}>Thêm điều kiện</Button>
                    </Space>
                  ),
                },
                {
                  key: "agg", label: "Nhóm & Tổng hợp",
                  children: (
                    <Row gutter={12}>
                      <Col span={12}>
                        <label style={{ fontSize: 12, color: "#64748b" }}>Nhóm theo</label>
                        <Select allowClear style={{ width: "100%", marginTop: 4 }} value={groupBy} onChange={setGroupBy} options={fieldOpts} disabled={!selectedTable} />
                      </Col>
                      <Col span={6}>
                        <label style={{ fontSize: 12, color: "#64748b" }}>Hàm tổng hợp</label>
                        <Select allowClear style={{ width: "100%", marginTop: 4 }} value={aggregate?.fn}
                          onChange={(v) => setAggregate(v ? { fn: v, field: selectedFields[0] } : null)}
                          options={AGG_FNS.map((f) => ({ value: f, label: f }))} disabled={!selectedTable}
                        />
                      </Col>
                      {aggregate && (
                        <Col span={6}>
                          <label style={{ fontSize: 12, color: "#64748b" }}>Cột tính</label>
                          <Select style={{ width: "100%", marginTop: 4 }} value={aggregate.field}
                            onChange={(v) => setAggregate((a) => ({ ...a, field: v }))} options={fieldOpts}
                          />
                        </Col>
                      )}
                    </Row>
                  ),
                },
              ]} />

              {results && (
                <Table
                  rowKey={(r, i) => i}
                  columns={resultCols}
                  dataSource={results}
                  size="small"
                  scroll={{ x: "max-content" }}
                  pagination={{ pageSize: 20 }}
                />
              )}
            </Space>
          </Card>
        </Col>
      </Row>

      <Modal title="Lưu báo cáo" open={saveOpen} onCancel={() => setSaveOpen(false)}
        onOk={handleSave} confirmLoading={saving} okText="Lưu">
        <Form form={saveForm} layout="vertical" requiredMark={false}>
          <Form.Item name="name" label="Tên báo cáo" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="description" label="Mô tả">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
