/**
 * Frontend: pages/MultiAgentOpsPage.jsx — Màn hình quản trị Multi-Agent hợp nhất (Bước 9)
 *
 * Một cửa duy nhất cho 5 nhóm việc của đề SE373 Mục 5:
 *   1. Đội agent & thực thi realtime (RunTimeline) — `GET /agents-overview`, `POST /runs`,
 *      `GET /runs/:runId/trace`.
 *   2. Hỏi đáp SOP có trích dẫn (UC-002) — `POST /kb/search` + bộ chọn thời điểm hiệu lực.
 *   3. Đối chiếu hoá đơn 3 bên (UC-004), báo giá MCP (UC-005) và hàng đợi gate chung.
 *   4. Bộ nhớ dài hạn & compaction 5 mục (UC-007).
 *   5. Tra cứu audit log & ma trận phân quyền (UC-009).
 *
 * BẤT BIẾN: trang này KHÔNG tự quyết định gì thay con người. Nút Duyệt/Từ chối chỉ
 * gọi `POST /gates/:id/decide`; quyền duyệt, chặn tự duyệt (403) và chặn duyệt lần
 * hai (409) do server quyết. UI chỉ hiển thị lại lý do server trả.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Empty,
  Input,
  InputNumber,
  Modal,
  Row,
  Select,
  Space,
  Statistic,
  Switch,
  Table,
  Tabs,
  Tag,
  Timeline,
  Typography,
  message,
} from 'antd';
import {
  ApiOutlined,
  CloudServerOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  RobotOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import * as agentGateway from '../api/agentGateway.api';

const { Text, Paragraph } = Typography;

const GATEWAY_ACTION_TYPES = ['INVOICE_3WAY_APPROVAL', 'QUOTE_DISCOUNT_APPROVAL'];

/** Phòng ban gợi ý khi SOP không có kết quả — người hỏi biết cần liên hệ ai. */
const DEPARTMENT_HINTS = [
  { value: 'FINANCE', label: 'Phòng Tài chính – Kế toán' },
  { value: 'SALES', label: 'Phòng Kinh doanh' },
  { value: 'HR', label: 'Phòng Nhân sự' },
  { value: 'OPS', label: 'Phòng Vận hành' },
  { value: 'WAREHOUSE', label: 'Bộ phận Kho' },
];

const REPORT_GROUPS = [
  { key: 'completed', label: 'Hoàn tất', color: 'success' },
  { key: 'denied_or_blocked', label: 'Bị chặn', color: 'warning' },
  { key: 'pending_approval', label: 'Chờ duyệt', color: 'processing' },
  { key: 'failed', label: 'Lỗi', color: 'error' },
];

const errorText = (e) => e?.response?.data?.message || e?.message || 'Lỗi không xác định';
const errorCode = (e) => e?.response?.data?.details?.code || null;
const fmtDate = (value) => (value ? new Date(value).toLocaleString('vi-VN') : '—');
const fmtMoney = (value) => Number(value ?? 0).toLocaleString('vi-VN');

const mono = { fontFamily: "'Geist Mono', ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12 };
const codeBox = {
  ...mono,
  background: '#0f172a',
  color: '#e2e8f0',
  padding: 12,
  borderRadius: 8,
  maxHeight: 320,
  overflow: 'auto',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  margin: 0,
};

function JsonBlock({ value }) {
  if (value === null || value === undefined) return null;
  return <pre style={codeBox}>{JSON.stringify(value, null, 2)}</pre>;
}

const decisionColor = (decision) => (decision === 'ALLOW' ? 'green' : 'red');

// ═════════════════════════════════════════════════════════════════════════════
// TAB 6 — Kết quả eval Regression baseline vs improved (Bước 10)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * CHỈ ĐỌC. Server trả nội dung `evals/results/*` do `npm run eval:all` sinh ra;
 * trang này không kích hoạt eval (eval ghi DB và phải dọn trong `finally`).
 * Thiếu artefact là trạng thái hợp lệ — hiển thị hướng dẫn thay vì số liệu giả.
 */
function EvalSummaryTab() {
  const [summary, setSummary] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setSummary(await agentGateway.getEvalsSummary());
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const rows = [];
  const baselineUcs = new Map((summary?.baseline?.useCases || []).map((uc) => [uc.useCase, uc]));
  for (const uc of summary?.improved?.useCases || []) {
    const base = baselineUcs.get(uc.useCase);
    for (const [key, metric] of Object.entries(uc.metrics || {})) {
      const baseMetric = base?.metrics?.[key];
      rows.push({
        key: `${uc.useCase}.${key}`,
        useCase: uc.useCase,
        metric: key,
        baseline: baseMetric ? baseMetric.rate : null,
        improved: metric.rate,
        threshold: metric.threshold,
        passed: metric.passedThreshold,
      });
    }
  }

  const columns = [
    { title: 'UC', dataIndex: 'useCase', width: 90 },
    { title: 'Chỉ số', dataIndex: 'metric' },
    {
      title: 'Baseline',
      dataIndex: 'baseline',
      width: 100,
      render: (value) => (value === null || value === undefined ? '—' : value.toFixed(4)),
    },
    {
      title: 'Improved',
      dataIndex: 'improved',
      width: 100,
      render: (value) => Number(value ?? 0).toFixed(4),
    },
    { title: 'Ngưỡng', dataIndex: 'threshold', width: 90 },
    {
      title: 'Đạt',
      dataIndex: 'passed',
      width: 70,
      render: (value) => <Tag color={value ? 'green' : 'red'}>{value ? 'ĐẠT' : 'CHƯA'}</Tag>,
    },
  ];

  const counts = summary?.datasets?.counts || {};

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      {error && <Alert type="error" showIcon message={error} />}

      <Card
        size="small"
        title="Bộ dữ liệu chuẩn (evals/datasets)"
        extra={<Button size="small" icon={<ReloadOutlined />} loading={busy} onClick={load}>Làm mới</Button>}
      >
        <Space wrap size="middle">
          <Tag color={summary?.datasets?.ok ? 'green' : 'red'}>
            {summary?.datasets?.ok ? 'hợp lệ' : 'chưa hợp lệ'}
          </Tag>
          <Text>SOP: {counts.sopDocuments ?? 0} tài liệu</Text>
          <Text>Câu hỏi: {counts.sopQuestions ?? 0}</Text>
          <Text>Hoá đơn: {counts.invoiceCases ?? 0}</Text>
          <Text>CRM: {counts.crmCases ?? 0}</Text>
          <Text>Bộ nhớ: {counts.memoryCases ?? 0}</Text>
          <Text>Định tuyến: {counts.routingCases ?? 0} ({counts.crossDepartmentCases ?? 0} liên phòng ban)</Text>
          <Text>Tấn công: {counts.securityCases ?? 0}/6</Text>
        </Space>
        {(summary?.datasets?.errors || []).length > 0 && (
          <Alert
            style={{ marginTop: 12 }}
            type="warning"
            showIcon
            message={`${summary.datasets.errors.length} lỗi dữ liệu`}
            description={summary.datasets.errors.join(' · ')}
          />
        )}
      </Card>

      <Card size="small" title="Regression baseline vs improved">
        {!summary?.improved?.available ? (
          <Alert
            type="info"
            showIcon
            message="Chưa có kết quả eval"
            description={summary?.improved?.hint || 'Chạy `npm run eval:all` rồi tải lại trang.'}
          />
        ) : (
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <Space wrap>
              <Tag color={summary.improved.totals.allThresholdsPassed ? 'green' : 'red'}>
                improved: {summary.improved.totals.passedThresholds}/{summary.improved.totals.metrics} ngưỡng đạt
              </Tag>
              <Tag color={summary.baseline?.totals?.allThresholdsPassed ? 'green' : 'orange'}>
                baseline: {summary.baseline?.totals?.passedThresholds ?? 0}/{summary.baseline?.totals?.metrics ?? 0} ngưỡng đạt
              </Tag>
              <Text type="secondary">{summary.improved.generatedAt}</Text>
            </Space>
            <Table
              size="small"
              rowKey="key"
              columns={columns}
              dataSource={rows}
              pagination={false}
              scroll={{ x: 720 }}
            />
          </Space>
        )}
      </Card>

      {summary?.regression?.available && (
        <Card size="small" title="evals/results/regression-report.md">
          <pre style={codeBox}>{summary.regression.content}</pre>
        </Card>
      )}
    </Space>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// TAB 1 — Đội Agent & thực thi realtime
// ═════════════════════════════════════════════════════════════════════════════

function RunTimelineTab({ overview, loadingOverview, onReloadOverview }) {
  const [runMessage, setRunMessage] = useState('Tra cứu quy định công tác phí mới nhất');
  const [opsRequestText, setOpsRequestText] = useState('');
  const [run, setRun] = useState(null);
  const [trace, setTrace] = useState(null);
  const [busy, setBusy] = useState(false);

  const execute = async () => {
    let opsRequest;
    if (opsRequestText.trim()) {
      try {
        opsRequest = JSON.parse(opsRequestText);
      } catch (e) {
        message.error(`opsRequest phải là JSON hợp lệ: ${e.message}`);
        return;
      }
    }
    setBusy(true);
    setTrace(null);
    try {
      const result = await agentGateway.startRun({ message: runMessage, opsRequest });
      setRun(result);
      message.success(`Đã chạy ${result.runId} · ${result.status}`);
      setTrace(await agentGateway.getRunTrace(result.runId));
    } catch (e) {
      message.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const loadTrace = async (runId) => {
    setBusy(true);
    try {
      setTrace(await agentGateway.getRunTrace(runId));
    } catch (e) {
      message.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const agentColumns = [
    { title: 'Agent', dataIndex: 'name', width: 130, render: (v, row) => (
      <Space direction="vertical" size={0}>
        <Text strong>{v}</Text>
        <Text type="secondary" style={{ fontSize: 12 }}>{row.label}</Text>
      </Space>
    ) },
    { title: 'Phòng', dataIndex: 'department', width: 100, render: (v) => (v ? <Tag>{v}</Tag> : '—') },
    { title: 'Use case', dataIndex: 'useCases', width: 110, render: (v) => (v || []).join(', ') },
    {
      title: 'Trạng thái',
      dataIndex: 'status',
      width: 140,
      render: (v, row) => (
        <Space size={4}>
          <Tag color={v === 'ACTIVE' ? 'green' : 'default'}>{v}</Tag>
          {row.alwaysAllowed && <Tag color="blue">always-allowed</Tag>}
          {row.requiresHumanGate && <Tag color="orange">gate</Tag>}
        </Space>
      ),
    },
    {
      title: 'Resource / action được phép đọc (policy.config.json)',
      dataIndex: 'resourceActions',
      render: (rows) => (
        (rows || []).length === 0
          ? <Text type="secondary">Không có tool — chỉ điều phối</Text>
          : (rows || []).map((row) => (
            <div key={row.resource} style={{ marginBottom: 4 }}>
              <Text code style={{ fontSize: 12 }}>{row.resource}</Text>{' '}
              {(row.actions || []).map((action) => (
                <Tag key={`${row.resource}:${action}`} color="geekblue" style={{ marginInlineEnd: 4 }}>
                  {action}
                </Tag>
              ))}
            </div>
          ))
      ),
    },
  ];

  const skillColumns = [
    { title: 'Skill', dataIndex: 'name', width: 200, render: (v, row) => (
      <Space direction="vertical" size={0}>
        <Text strong>{v}</Text>
        <Text type="secondary" style={{ fontSize: 12 }}>{row.path}</Text>
      </Space>
    ) },
    { title: 'Phiên bản', dataIndex: 'version', width: 90 },
    { title: 'Phòng', dataIndex: 'department', width: 90, render: (v) => <Tag>{v}</Tag> },
    { title: 'UC', dataIndex: 'useCase', width: 80 },
    {
      title: 'Tool allowlist',
      dataIndex: 'allowedTools',
      render: (v) => (v || []).map((tool) => <Tag key={tool} style={{ marginBottom: 4 }}>{tool}</Tag>),
    },
    {
      title: 'Hợp đồng',
      dataIndex: 'valid',
      width: 200,
      render: (v, row) => (v
        ? <Tag color="green">valid: true</Tag>
        : <Space direction="vertical" size={0}>
          <Tag color="red">valid: false</Tag>
          {(row.errors || []).map((err) => <Text key={err} type="danger" style={{ fontSize: 12 }}>{err}</Text>)}
        </Space>),
    },
  ];

  const mcpColumns = [
    { title: 'MCP server', dataIndex: 'name', width: 140, render: (v, row) => (
      <Space direction="vertical" size={0}>
        <Text strong>{v}</Text>
        <Text type="secondary" style={{ fontSize: 12 }}>{row.transport}</Text>
      </Space>
    ) },
    {
      title: 'Tools',
      dataIndex: 'tools',
      render: (tools) => (tools || []).map((tool) => (
        <Tag key={tool.name} color={tool.idempotent ? 'cyan' : 'default'} style={{ marginBottom: 4 }}>
          {tool.name}
        </Tag>
      )),
    },
    {
      title: 'Resources',
      dataIndex: 'resources',
      render: (rows) => (rows || []).map((r) => <Tag key={String(r)}>{String(r)}</Tag>),
    },
    {
      title: 'Scopes',
      dataIndex: 'scopes',
      render: (rows) => (rows || []).map((s) => <Tag key={String(s)} color="purple">{String(s)}</Tag>),
    },
    {
      title: 'Timeout / retry / idempotency',
      width: 260,
      render: (_, row) => (
        <Text style={{ fontSize: 12 }}>
          {row.timeoutMs} ms · {row.maxRetries} lần · {row.idempotency}
        </Text>
      ),
    },
  ];

  const approvalColumns = [
    { title: 'actionType', dataIndex: 'actionType', width: 240 },
    {
      title: 'Role được duyệt',
      dataIndex: 'approverRoles',
      render: (rows) => (rows || []).map((r) => <Tag key={r} color="blue">{r}</Tag>),
    },
    {
      title: 'Hạn mức (VND)',
      dataIndex: 'limits',
      render: (limits) => Object.entries(limits || {}).map(([role, limit]) => (
        <div key={role} style={{ fontSize: 12 }}>
          <Text code>{role}</Text> {limit === null ? 'không giới hạn' : fmtMoney(limit)}
        </div>
      )),
    },
    {
      title: 'Tự duyệt',
      dataIndex: 'selfApprovalAllowed',
      width: 120,
      render: (v) => (v ? <Tag color="orange">cho phép</Tag> : <Tag color="green">cấm</Tag>),
    },
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card
        size="small"
        title={<Space><RobotOutlined />Đội Agent (5) · Skills (2) · MCP Servers (3)</Space>}
        extra={(
          <Button icon={<ReloadOutlined />} onClick={onReloadOverview} loading={loadingOverview}>
            Làm mới
          </Button>
        )}
      >
        {!overview && !loadingOverview && (
          <Alert type="warning" showIcon message="Không tải được tổng quan Multi-Agent" />
        )}
        {overview && (
          <>
            <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
              <Col xs={12} md={6}><Statistic title="Agent" value={overview.agents?.length || 0} /></Col>
              <Col xs={12} md={6}>
                <Statistic
                  title="Skill hợp lệ"
                  value={(overview.skills || []).filter((s) => s.valid).length}
                  suffix={`/ ${(overview.skills || []).length}`}
                />
              </Col>
              <Col xs={12} md={6}><Statistic title="MCP server" value={overview.mcpServers?.length || 0} /></Col>
              <Col xs={12} md={6}>
                <Statistic title="Policy" value={overview.policyVersion || '—'} />
              </Col>
            </Row>

            <Table
              rowKey="name"
              size="small"
              pagination={false}
              columns={agentColumns}
              dataSource={overview.agents || []}
              style={{ marginBottom: 16 }}
            />

            <Row gutter={[16, 16]}>
              <Col xs={24} xl={12}>
                <Card size="small" title="Skills (hợp đồng đọc từ skills/*/SKILL.md)">
                  <Table rowKey="name" size="small" pagination={false} columns={skillColumns} dataSource={overview.skills || []} />
                </Card>
              </Col>
              <Col xs={24} xl={12}>
                <Card size="small" title={<Space><CloudServerOutlined />MCP servers</Space>}>
                  <Table rowKey="name" size="small" pagination={false} columns={mcpColumns} dataSource={overview.mcpServers || []} />
                </Card>
              </Col>
            </Row>

            <Card size="small" title="Quy tắc phê duyệt gate" style={{ marginTop: 16 }}>
              <Table
                rowKey="actionType"
                size="small"
                pagination={false}
                columns={approvalColumns}
                dataSource={overview.approvalRules || []}
              />
            </Card>

            <Alert
              style={{ marginTop: 16 }}
              type="info"
              showIcon
              message="Telegram bot"
              description={(
                <Text style={{ fontSize: 12 }}>
                  {overview.telegram?.configured ? 'Đã cấu hình TELEGRAM_BOT_TOKEN' : 'Chưa cấu hình TELEGRAM_BOT_TOKEN (webhook vẫn kiểm chứng được bằng HTTP)'}
                  {' · '}webhook <Text code>{overview.telegram?.webhookPath}</Text>
                  {' · '}callback <Text code>{overview.telegram?.callbackPath}</Text>
                  {' · '}nút: {overview.telegram?.buttons?.map((b) => b.label).join(' / ')}
                </Text>
              )}
            />
          </>
        )}
      </Card>

      <Card size="small" title={<Space><PlayCircleOutlined />Giao việc cho hệ Multi-Agent</Space>}>
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Input.TextArea
            rows={2}
            value={runMessage}
            onChange={(e) => setRunMessage(e.target.value)}
            placeholder="Ví dụ: Tra cứu quy định công tác phí mới nhất"
          />
          <Input.TextArea
            rows={4}
            value={opsRequestText}
            onChange={(e) => setOpsRequestText(e.target.value)}
            placeholder={'Tuỳ chọn — opsRequest JSON, ví dụ:\n{ "subtasks": [ { "id": "t1", "agent": "knowledge", "action": "search", "params": { "query": "tạm ứng" } } ] }'}
            style={mono}
          />
          <Space>
            <Button type="primary" icon={<PlayCircleOutlined />} loading={busy} onClick={execute}>
              Chạy điều phối
            </Button>
            {run && (
              <Button icon={<ReloadOutlined />} onClick={() => loadTrace(run.runId)} loading={busy}>
                Tải lại trace
              </Button>
            )}
          </Space>

          {run && (
            <>
              <Descriptions size="small" column={{ xs: 1, md: 4 }} bordered>
                <Descriptions.Item label="runId"><Text code>{run.runId}</Text></Descriptions.Item>
                <Descriptions.Item label="Trạng thái"><Tag color="blue">{run.status}</Tag></Descriptions.Item>
                <Descriptions.Item label="Bộ nhớ đã nạp">{run.memoriesUsed ?? 0}</Descriptions.Item>
                <Descriptions.Item label="Sự kiện trace">{run.traceSummary?.events ?? 0}</Descriptions.Item>
                <Descriptions.Item label="Điều phối bởi" span={4}>
                  {run.actor?.role} · phòng {run.actor?.department || '—'} · userId <Text code>{run.actor?.userId}</Text>
                </Descriptions.Item>
              </Descriptions>

              <Row gutter={[12, 12]}>
                {REPORT_GROUPS.map((group) => {
                  const items = run.report?.[group.key] || [];
                  return (
                    <Col xs={24} md={12} xl={6} key={group.key}>
                      <Card size="small" title={<Space><Tag color={group.color}>{group.label}</Tag>{items.length}</Space>}>
                        {items.length === 0
                          ? <Text type="secondary" style={{ fontSize: 12 }}>Không có</Text>
                          : items.map((item, index) => (
                            <div key={`${group.key}-${index}`} style={{ marginBottom: 8 }}>
                              <Text strong style={{ fontSize: 12 }}>
                                {item.agent} · {item.action}
                              </Text>
                              <div><Text style={{ fontSize: 12 }}>{item.summary}</Text></div>
                              {item.gateId && (
                                <Text code style={{ fontSize: 11 }}>gate {item.gateId}</Text>
                              )}
                              {item.reason && (
                                <div><Text type="secondary" style={{ fontSize: 11 }}>lý do: {item.reason}</Text></div>
                              )}
                            </div>
                          ))}
                      </Card>
                    </Col>
                  );
                })}
              </Row>
            </>
          )}
        </Space>
      </Card>

      <Card size="small" title={`Timeline Trace JSONL${trace ? ` — ${trace.runId}` : ''}`}>
        {!trace && <Empty description="Chạy một yêu cầu để xem trace từng bước" />}
        {trace && (
          <>
            <Space wrap style={{ marginBottom: 12 }}>
              <Text type="secondary">Tổng {trace.total} sự kiện</Text>
              <Text type="secondary">· phạm vi xem: {trace.viewer?.scope}</Text>
              <Text type="secondary">· agent: {(trace.summary?.agents || []).join(', ') || '—'}</Text>
              <Text type="secondary">· gate: {(trace.summary?.gates || []).length}</Text>
            </Space>
            <Timeline
              items={(trace.events || []).map((event) => ({
                color: event.decision === 'DENY'
                  ? 'red'
                  : event.event === 'run.completed'
                    ? 'green'
                    : event.event === 'policy.decision'
                      ? 'blue'
                      : 'gray',
                children: (
                  <div>
                    <Space size={6} wrap>
                      <Text style={{ fontSize: 12 }} type="secondary">{fmtDate(event.ts)}</Text>
                      <Tag>{event.event}</Tag>
                      {event.agent && <Tag color="blue">{event.agent}</Tag>}
                      {event.tool && <Text code style={{ fontSize: 11 }}>{event.tool}</Text>}
                      {event.decision && <Tag color={decisionColor(event.decision)}>{event.decision}</Tag>}
                      {event.gateId && <Text code style={{ fontSize: 11 }}>gate {event.gateId}</Text>}
                    </Space>
                    {event.summary && <div style={{ fontSize: 12 }}>{event.summary}</div>}
                    {event.reason && <div><Text type="secondary" style={{ fontSize: 11 }}>{event.reason}</Text></div>}
                  </div>
                ),
              }))}
            />
            <details>
              <summary style={{ cursor: 'pointer', fontSize: 12 }}>Xem JSON đã mask PII/token</summary>
              <div style={{ marginTop: 8 }}><JsonBlock value={trace.events} /></div>
            </details>
          </>
        )}
      </Card>
    </Space>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// TAB 2 — Hỏi đáp SOP có trích dẫn (UC-002)
// ═════════════════════════════════════════════════════════════════════════════

function KnowledgeTab() {
  const [query, setQuery] = useState('công tác phí');
  const [asOf, setAsOf] = useState('');
  const [includeHistorical, setIncludeHistorical] = useState(false);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  const search = async () => {
    setBusy(true);
    try {
      const data = await agentGateway.searchKb({
        query,
        asOf: asOf.trim() || null,
        includeHistorical,
        topK: 5,
      });
      setResult(data);
    } catch (e) {
      message.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card size="small" title="Hỏi quy định nội bộ — trả lời kèm trích dẫn">
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onPressEnter={search}
            placeholder="Ví dụ: hạn mức công tác phí, quy trình tạm ứng, thời hạn bảo hành"
          />
          <Space wrap>
            <Space size={6}>
              <Text type="secondary">Thời điểm hiệu lực (asOf)</Text>
              <Input
                style={{ width: 210, ...mono }}
                value={asOf}
                onChange={(e) => setAsOf(e.target.value)}
                placeholder="2026-11-01T00:00:00Z"
              />
            </Space>
            <Space size={6}>
              <Text type="secondary">Gồm bản đã hết hiệu lực</Text>
              <Switch checked={includeHistorical} onChange={setIncludeHistorical} size="small" />
            </Space>
            <Button type="primary" loading={busy} onClick={search}>Tra cứu</Button>
          </Space>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Bộ lọc phiên bản chạy trong SQL: chỉ bản có <Text code>effective_date ≤ asOf</Text> và
            chưa bị thay thế tại thời điểm đó. Trả lời không có trích dẫn thì không dùng được.
          </Text>
        </Space>
      </Card>

      {result && (
        <Card
          size="small"
          title={`Trích dẫn tìm thấy: ${result.chunks?.length || 0}/${result.total ?? 0}`}
          extra={<Text type="secondary" style={{ fontSize: 12 }}>asOf {result.asOf}</Text>}
        >
          {(result.chunks || []).length === 0
            ? (
              <Alert
                type="warning"
                showIcon
                message="Không tìm thấy đoạn quy định phù hợp"
                description={(
                  <Space direction="vertical" size={6}>
                    <Text>Hệ thống không được phép tự đoán. Hãy hỏi phòng ban sở hữu quy định:</Text>
                    <Space wrap>
                      {DEPARTMENT_HINTS.map((d) => <Tag key={d.value} color="blue">{d.label}</Tag>)}
                    </Space>
                  </Space>
                )}
              />
            )
            : (result.chunks || []).map((chunk) => (
              <Card
                key={`${chunk.docCode}-${chunk.version}-${chunk.chunkIndex ?? chunk.sectionHeading}`}
                size="small"
                style={{ marginBottom: 12 }}
                title={(
                  <Space wrap>
                    <Text code>{chunk.docCode}</Text>
                    <Tag color="blue">v{chunk.version}</Tag>
                    <Tag>{chunk.department}</Tag>
                    <Text style={{ fontSize: 12 }} type="secondary">hiệu lực {fmtDate(chunk.effectiveDate)}</Text>
                  </Space>
                )}
                extra={<Text type="secondary" style={{ fontSize: 12 }}>điểm {Number(chunk.score || 0).toFixed(2)}</Text>}
              >
                <Paragraph strong style={{ marginBottom: 8 }}>{chunk.sectionHeading || '(không có tiêu đề mục)'}</Paragraph>
                <Paragraph style={{ marginBottom: 0, whiteSpace: 'pre-wrap' }}>
                  {String(chunk.content || '').slice(0, 800)}
                </Paragraph>
              </Card>
            ))}
        </Card>
      )}
    </Space>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// TAB 3 — UC-004 + UC-005 + hàng đợi gate
// ═════════════════════════════════════════════════════════════════════════════

const INVOICE_TEMPLATE = {
  invoiceNumber: 'HD-0001',
  vendorTaxCode: '0312345678',
  vendorName: 'Công ty TNHH Bao Bì Xanh',
  vendorBankAccount: '0123456789',
  issueDate: '2026-11-01',
  poNumber: 'PO-20261101-0001',
  items: [{ sku: 'BB-001', name: 'Thùng carton 5 lớp', qty: 100, unitPrice: 25000, lineTotal: 2500000 }],
  subtotal: 2500000,
  vatRate: 0.1,
  vatAmount: 250000,
  totalAmount: 2750000,
  rawText: 'HÓA ĐƠN GTGT số HD-0001',
};

function FinanceSalesTab({ onChanged }) {
  const [invoiceText, setInvoiceText] = useState(JSON.stringify(INVOICE_TEMPLATE, null, 2));
  const [reconcileResult, setReconcileResult] = useState(null);
  const [quoteForm, setQuoteForm] = useState({
    customerName: '',
    customerPhone: '',
    customerEmail: '',
    lines: '[{ "sku": "SKU-001", "qty": 2 }]',
    discountPercent: 8,
    vatRate: 0.1,
    quoteNumber: '',
  });
  const [quoteResult, setQuoteResult] = useState(null);
  const [gates, setGates] = useState([]);
  const [gateNote, setGateNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [gatesBusy, setGatesBusy] = useState(false);

  const loadGates = useCallback(async () => {
    setGatesBusy(true);
    try {
      const rows = await agentGateway.listPendingGates();
      setGates(Array.isArray(rows) ? rows : []);
    } catch (e) {
      message.error(errorText(e));
    } finally {
      setGatesBusy(false);
    }
  }, []);

  useEffect(() => {
    loadGates();
  }, [loadGates]);

  const reconcile = async () => {
    let invoice;
    try {
      invoice = JSON.parse(invoiceText);
    } catch (e) {
      message.error(`invoice phải là JSON hợp lệ: ${e.message}`);
      return;
    }
    setBusy(true);
    try {
      const data = await agentGateway.reconcileInvoice({ invoice });
      setReconcileResult(data);
      message.success(`Đối chiếu xong: ${data.classification || data.status || 'xong'}`);
      loadGates();
      onChanged?.();
    } catch (e) {
      setReconcileResult({ error: errorText(e), code: errorCode(e) });
      message.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const createQuote = async () => {
    let lines;
    try {
      lines = JSON.parse(quoteForm.lines);
    } catch (e) {
      message.error(`lines phải là JSON hợp lệ: ${e.message}`);
      return;
    }
    setBusy(true);
    try {
      const data = await agentGateway.createQuote({
        customer: {
          name: quoteForm.customerName,
          phone: quoteForm.customerPhone || undefined,
          email: quoteForm.customerEmail || undefined,
        },
        lines,
        discountPercent: Number(quoteForm.discountPercent) || 0,
        vatRate: Number(quoteForm.vatRate) || 0,
        quoteNumber: quoteForm.quoteNumber || undefined,
      });
      setQuoteResult(data);
      message.success(data.status === 'PENDING_APPROVAL'
        ? 'Chiết khấu vượt hạn mức — đã tạo gate chờ duyệt'
        : 'Đã tạo báo giá và thư nháp (chưa gửi)');
      loadGates();
      onChanged?.();
    } catch (e) {
      setQuoteResult({ error: errorText(e), code: errorCode(e) });
      message.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const decide = async (gateId, decision) => {
    if (decision === 'REJECTED' && !gateNote.trim()) {
      message.warning('Từ chối đề xuất cần nhập lý do (server trả 400 nếu thiếu)');
      return;
    }
    Modal.confirm({
      title: decision === 'APPROVED' ? 'Duyệt đề xuất này?' : 'Từ chối đề xuất này?',
      content: 'Quyết định được ghi vào audit log và không thể đổi lại. Người đề xuất không được tự duyệt.',
      okText: decision === 'APPROVED' ? 'Duyệt' : 'Từ chối',
      okButtonProps: { danger: decision === 'REJECTED' },
      onOk: async () => {
        try {
          const gate = await agentGateway.decideGatewayGate(gateId, {
            decision,
            note: gateNote.trim() || null,
          });
          message.success(`Gate đã chuyển sang ${gate.status}`);
          setGateNote('');
          loadGates();
          onChanged?.();
        } catch (e) {
          const code = errorCode(e);
          message.error(`${errorText(e)}${code ? ` (${code})` : ''}`);
          loadGates();
        }
      },
    });
  };

  const gateColumns = [
    { title: 'Loại', dataIndex: 'actionType', width: 210, render: (v) => <Tag color="purple">{v}</Tag> },
    {
      title: 'Nội dung',
      dataIndex: 'actionSummary',
      render: (v, row) => (
        <Space direction="vertical" size={0}>
          <Text>{v}</Text>
          <Text type="secondary" style={{ fontSize: 11 }}>
            tạo bởi {row.actionPayload?.createdByRole || '—'} · {fmtDate(row.createdAt)}
          </Text>
        </Space>
      ),
    },
    {
      title: 'Hạn',
      dataIndex: 'expiresAt',
      width: 160,
      render: (v) => <Text style={{ fontSize: 12 }}>{fmtDate(v)}</Text>,
    },
    {
      title: 'Quyết định',
      width: 190,
      render: (_, row) => (
        <Space size={6}>
          <Button size="small" type="primary" onClick={() => decide(row.id, 'APPROVED')}>Duyệt</Button>
          <Button size="small" danger onClick={() => decide(row.id, 'REJECTED')}>Từ chối</Button>
        </Space>
      ),
    },
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Row gutter={[16, 16]}>
        <Col xs={24} xl={12}>
          <Card size="small" title="UC-004 · Đối chiếu hoá đơn 3 bên (PO ↔ GRN ↔ Invoice)">
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              <Input.TextArea
                rows={10}
                value={invoiceText}
                onChange={(e) => setInvoiceText(e.target.value)}
                style={mono}
                placeholder="JSON hoá đơn đã trích"
              />
              <Button type="primary" loading={busy} onClick={reconcile}>Đối chiếu</Button>
              {reconcileResult && (
                <>
                  <Alert
                    type={reconcileResult.gateId ? 'success' : reconcileResult.error ? 'error' : 'warning'}
                    showIcon
                    message={reconcileResult.error
                      ? reconcileResult.error
                      : `classification: ${reconcileResult.classification}`}
                    description={reconcileResult.gateId
                      ? `Đã tạo gate ${reconcileResult.gateId} chờ duyệt — chưa có lệnh chi nào.`
                      : (reconcileResult.issues || []).map((i) => `${i.code}${i.detail ? `: ${i.detail}` : ''}`).join(' · ')}
                  />
                  <details>
                    <summary style={{ cursor: 'pointer', fontSize: 12 }}>Xem phản hồi đầy đủ</summary>
                    <div style={{ marginTop: 8 }}><JsonBlock value={reconcileResult} /></div>
                  </details>
                </>
              )}
            </Space>
          </Card>
        </Col>

        <Col xs={24} xl={12}>
          <Card size="small" title="UC-005 · Báo giá qua MCP (crm · sheets · mail)">
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
              <Input
                placeholder="Tên khách hàng"
                value={quoteForm.customerName}
                onChange={(e) => setQuoteForm({ ...quoteForm, customerName: e.target.value })}
              />
              <Space style={{ width: '100%' }} wrap>
                <Input
                  placeholder="SĐT"
                  style={{ width: 180 }}
                  value={quoteForm.customerPhone}
                  onChange={(e) => setQuoteForm({ ...quoteForm, customerPhone: e.target.value })}
                />
                <Input
                  placeholder="Email"
                  style={{ width: 220 }}
                  value={quoteForm.customerEmail}
                  onChange={(e) => setQuoteForm({ ...quoteForm, customerEmail: e.target.value })}
                />
              </Space>
              <Input.TextArea
                rows={3}
                style={mono}
                value={quoteForm.lines}
                onChange={(e) => setQuoteForm({ ...quoteForm, lines: e.target.value })}
                placeholder='[{ "sku": "SKU-001", "qty": 2 }]'
              />
              <Space wrap>
                <Space size={6}>
                  <Text type="secondary">Chiết khấu %</Text>
                  <InputNumber
                    min={0}
                    max={100}
                    value={quoteForm.discountPercent}
                    onChange={(v) => setQuoteForm({ ...quoteForm, discountPercent: v })}
                  />
                </Space>
                <Space size={6}>
                  <Text type="secondary">VAT (phân số)</Text>
                  <InputNumber
                    min={0}
                    max={1}
                    step={0.01}
                    value={quoteForm.vatRate}
                    onChange={(v) => setQuoteForm({ ...quoteForm, vatRate: v })}
                  />
                </Space>
                <Input
                  placeholder="Số báo giá (tuỳ chọn)"
                  style={{ width: 200 }}
                  value={quoteForm.quoteNumber}
                  onChange={(e) => setQuoteForm({ ...quoteForm, quoteNumber: e.target.value })}
                />
              </Space>
              <Text type="secondary" style={{ fontSize: 12 }}>
                Chiết khấu &gt; 10% luôn dừng ở gate <Text code>QUOTE_DISCOUNT_APPROVAL</Text>; nháp chỉ
                được tạo sau khi người khác duyệt. Hệ thống không gửi email — chỉ tạo nháp.
              </Text>
              <Button type="primary" loading={busy} onClick={createQuote}>Tạo báo giá</Button>
              {quoteResult && (
                <Alert
                  type={quoteResult.error ? 'error' : quoteResult.status === 'PENDING_APPROVAL' ? 'warning' : 'success'}
                  showIcon
                  message={quoteResult.error || `status: ${quoteResult.status}`}
                  description={quoteResult.gateId
                    ? `Gate ${quoteResult.gateId} đang chờ duyệt. Tổng tiền báo giá ${fmtMoney(quoteResult.quote?.totalAmount)} VND.`
                    : (quoteResult.quote
                      ? `Tổng ${fmtMoney(quoteResult.quote.totalAmount)} VND · nháp ${quoteResult.draft?.status || '—'} · đã gửi: ${quoteResult.draft?.sent === true ? 'có' : 'không'}`
                      : null)}
                />
              )}
            </Space>
          </Card>
        </Col>
      </Row>

      <Card
        size="small"
        title={`Hàng đợi phê duyệt chung — ${gates.length} đề xuất đang chờ`}
        extra={<Button icon={<ReloadOutlined />} loading={gatesBusy} onClick={loadGates}>Làm mới</Button>}
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Alert
            type="info"
            showIcon
            message="Quyền duyệt do server quyết"
            description="Tự duyệt bị chặn 403. Người khác vừa xử lý xong thì lần bấm sau trả 409. Từ chối bắt buộc nhập lý do."
          />
          <Input
            placeholder="Lý do (bắt buộc khi Từ chối)"
            value={gateNote}
            onChange={(e) => setGateNote(e.target.value)}
          />
          <Table
            rowKey="id"
            size="small"
            loading={gatesBusy}
            pagination={{ pageSize: 8 }}
            columns={gateColumns}
            dataSource={gates}
            locale={{ emptyText: <Empty description="Không có đề xuất nào đang chờ" /> }}
          />
          <Text type="secondary" style={{ fontSize: 12 }}>
            Gate của Multi-Agent: {GATEWAY_ACTION_TYPES.join(' · ')}. Danh sách gồm mọi gate PENDING của
            tenant (kể cả đề xuất nhập hàng của AI) — một hàng đợi duy nhất, không tách rời.
          </Text>
        </Space>
      </Card>
    </Space>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// TAB 4 — Bộ nhớ dài hạn & compaction (UC-007)
// ═════════════════════════════════════════════════════════════════════════════

const CHECKPOINT_SECTIONS = [
  ['goal', 'Mục tiêu'],
  ['constraints', 'Ràng buộc'],
  ['completed_work', 'Đã làm'],
  ['current_state', 'Trạng thái hiện tại'],
  ['open_items_and_next_steps', 'Việc mở & bước tiếp'],
];

function MemoryTab() {
  const [memories, setMemories] = useState([]);
  const [loading, setLoading] = useState(false);
  const [scopeFilter, setScopeFilter] = useState(undefined);
  const [form, setForm] = useState({
    scope: 'user',
    department: '',
    memoryKey: '',
    content: '',
    expiresAt: '',
  });
  const [violation, setViolation] = useState(null);
  const [editing, setEditing] = useState(null);
  const [checkpointId, setCheckpointId] = useState('');
  const [checkpoint, setCheckpoint] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { items } = await agentGateway.listMemories({ scope: scopeFilter, limit: 100 });
      setMemories(items);
    } catch (e) {
      message.error(errorText(e));
    } finally {
      setLoading(false);
    }
  }, [scopeFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const handleWriteError = (e) => {
    const code = errorCode(e);
    if (code === 'PII_FORBIDDEN' || code === 'MEMORY_BOUNDARY_FORBIDDEN') {
      setViolation({
        code,
        message: errorText(e),
        categories: e?.response?.data?.details?.categories || [],
        labels: e?.response?.data?.details?.categoryLabels || [],
      });
    }
    message.error(`${errorText(e)}${code ? ` (${code})` : ''}`);
  };

  const create = async () => {
    setViolation(null);
    try {
      await agentGateway.createMemory({
        scope: form.scope,
        department: form.scope === 'department' ? form.department : undefined,
        memoryKey: form.memoryKey,
        content: form.content,
        expiresAt: form.expiresAt.trim() || undefined,
      });
      message.success('Đã lưu bộ nhớ');
      setForm({ ...form, memoryKey: '', content: '', expiresAt: '' });
      load();
    } catch (e) {
      handleWriteError(e);
    }
  };

  const saveEdit = async () => {
    try {
      await agentGateway.updateMemory(editing.id, { content: editing.content });
      message.success('Đã cập nhật bộ nhớ');
      setEditing(null);
      load();
    } catch (e) {
      handleWriteError(e);
    }
  };

  const remove = (row) => {
    Modal.confirm({
      title: 'Xoá bộ nhớ này?',
      content: `${row.scope} · ${row.memoryKey} · version ${row.version}`,
      okButtonProps: { danger: true },
      okText: 'Xoá',
      onOk: async () => {
        try {
          await agentGateway.deleteMemory(row.id);
          message.success('Đã xoá bộ nhớ');
          load();
        } catch (e) {
          message.error(`${errorText(e)}${errorCode(e) ? ` (${errorCode(e)})` : ''}`);
        }
      },
    });
  };

  const loadCheckpoint = async () => {
    if (!checkpointId.trim()) {
      message.warning('Nhập sessionId cần xem');
      return;
    }
    try {
      setCheckpoint(await agentGateway.getCheckpointSummary(checkpointId.trim()));
    } catch (e) {
      setCheckpoint(null);
      message.error(errorText(e));
    }
  };

  const columns = [
    { title: 'Phạm vi', dataIndex: 'scope', width: 110, render: (v, row) => (
      <Space direction="vertical" size={0}>
        <Tag color={v === 'company' ? 'purple' : v === 'department' ? 'blue' : 'default'}>{v}</Tag>
        {row.department && <Text style={{ fontSize: 11 }}>{row.department}</Text>}
      </Space>
    ) },
    { title: 'memoryKey', dataIndex: 'memoryKey', width: 200, render: (v) => <Text code style={{ fontSize: 12 }}>{v}</Text> },
    { title: 'Nội dung', dataIndex: 'content', render: (v) => <Text style={{ fontSize: 12 }}>{v}</Text> },
    { title: 'Ver', dataIndex: 'version', width: 60 },
    { title: 'Hết hạn', dataIndex: 'expiresAt', width: 160, render: (v) => <Text style={{ fontSize: 12 }}>{v ? fmtDate(v) : 'không'}</Text> },
    {
      title: '',
      width: 130,
      render: (_, row) => (
        <Space size={4}>
          <Button size="small" onClick={() => setEditing({ id: row.id, content: row.content })}>Sửa</Button>
          <Button size="small" danger onClick={() => remove(row)}>Xoá</Button>
        </Space>
      ),
    },
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {violation && (
        <Alert
          type="error"
          showIcon
          closable
          onClose={() => setViolation(null)}
          message={violation.code === 'PII_FORBIDDEN'
            ? 'PII_FORBIDDEN — không được lưu dữ liệu cá nhân nhạy cảm'
            : 'MEMORY_BOUNDARY_FORBIDDEN — không được ghi đè quy tắc nghiệp vụ'}
          description={(
            <Space direction="vertical" size={4}>
              <Text>{violation.message}</Text>
              {violation.labels.length > 0 && (
                <Space wrap>
                  {violation.labels.map((label) => <Tag key={label} color="red">{label}</Tag>)}
                </Space>
              )}
              <Text type="secondary" style={{ fontSize: 12 }}>
                Danh mục: {(violation.categories || []).join(', ') || '—'}
              </Text>
            </Space>
          )}
        />
      )}

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={14}>
          <Card
            size="small"
            title="Bộ nhớ đang hiệu lực của tôi & phạm vi được thấy"
            extra={(
              <Space>
                <Select
                  allowClear
                  placeholder="Lọc phạm vi"
                  style={{ width: 140 }}
                  value={scopeFilter}
                  onChange={setScopeFilter}
                  options={[
                    { value: 'user', label: 'user' },
                    { value: 'department', label: 'department' },
                    { value: 'company', label: 'company' },
                  ]}
                />
                <Button icon={<ReloadOutlined />} loading={loading} onClick={load}>Làm mới</Button>
              </Space>
            )}
          >
            <Table
              rowKey="id"
              size="small"
              loading={loading}
              pagination={{ pageSize: 8 }}
              columns={columns}
              dataSource={memories}
              locale={{ emptyText: <Empty description="Chưa có bộ nhớ nào đang hiệu lực" /> }}
            />
          </Card>
        </Col>

        <Col xs={24} xl={10}>
          <Card size="small" title="Lưu bộ nhớ mới">
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
              <Space wrap>
                <Select
                  style={{ width: 150 }}
                  value={form.scope}
                  onChange={(v) => setForm({ ...form, scope: v })}
                  options={[
                    { value: 'user', label: 'user (của tôi)' },
                    { value: 'department', label: 'department' },
                    { value: 'company', label: 'company' },
                  ]}
                />
                {form.scope === 'department' && (
                  <Input
                    style={{ width: 160 }}
                    placeholder="Mã phòng (FINANCE…)"
                    value={form.department}
                    onChange={(e) => setForm({ ...form, department: e.target.value })}
                  />
                )}
              </Space>
              <Input
                placeholder="memoryKey (vd: cach-bao-cao)"
                value={form.memoryKey}
                onChange={(e) => setForm({ ...form, memoryKey: e.target.value })}
              />
              <Input.TextArea
                rows={4}
                placeholder="Nội dung cần nhớ (không chứa CCCD/SĐT/lương; không ghi đè giá, hạn mức, tồn kho, RBAC, SOP)"
                value={form.content}
                onChange={(e) => setForm({ ...form, content: e.target.value })}
              />
              <Input
                placeholder="expiresAt ISO (tuỳ chọn) — 2026-12-31T00:00:00Z"
                style={mono}
                value={form.expiresAt}
                onChange={(e) => setForm({ ...form, expiresAt: e.target.value })}
              />
              <Button type="primary" onClick={create}>Lưu bộ nhớ</Button>
              <Text type="secondary" style={{ fontSize: 12 }}>
                Cùng <Text code>scope + memoryKey</Text> sẽ supersede bản cũ (version +1). Bản cũ vẫn còn
                trong DB để đối chiếu.
              </Text>
            </Space>
          </Card>

          <Card size="small" title="Checkpoint 5 mục của phiên" style={{ marginTop: 16 }}>
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
              <Space.Compact style={{ width: '100%' }}>
                <Input
                  placeholder="sessionId"
                  value={checkpointId}
                  onChange={(e) => setCheckpointId(e.target.value)}
                />
                <Button onClick={loadCheckpoint}>Xem</Button>
              </Space.Compact>
              {checkpoint && (
                <>
                  <Descriptions size="small" column={1} bordered>
                    {CHECKPOINT_SECTIONS.map(([key, label]) => (
                      <Descriptions.Item key={key} label={label}>
                        {checkpoint.summary?.[key] === undefined || checkpoint.summary?.[key] === null
                          ? <Text type="secondary">—</Text>
                          : typeof checkpoint.summary[key] === 'string'
                            ? checkpoint.summary[key]
                            : <JsonBlock value={checkpoint.summary[key]} />}
                      </Descriptions.Item>
                    ))}
                  </Descriptions>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    Cập nhật {fmtDate(checkpoint.updatedAt)} · {checkpoint.openGates?.length || 0} gate đang mở
                  </Text>
                  {(checkpoint.openGates || []).map((gate) => (
                    <div key={gate.gateId} style={{ fontSize: 12 }}>
                      <Tag color="orange">{gate.actionType}</Tag>
                      <Text code>{gate.gateId}</Text> {gate.summary}
                    </div>
                  ))}
                </>
              )}
            </Space>
          </Card>
        </Col>
      </Row>

      <Modal
        open={Boolean(editing)}
        title="Sửa nội dung bộ nhớ"
        onCancel={() => setEditing(null)}
        onOk={saveEdit}
        okText="Lưu"
      >
        <Input.TextArea
          rows={5}
          value={editing?.content || ''}
          onChange={(e) => setEditing({ ...editing, content: e.target.value })}
        />
        <Text type="secondary" style={{ fontSize: 12 }}>
          PII và ranh giới nghiệp vụ được kiểm lại ở server cho mọi lần sửa.
        </Text>
      </Modal>
    </Space>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// TAB 5 — Audit log + ma trận phân quyền (UC-009)
// ═════════════════════════════════════════════════════════════════════════════

function AuditTab() {
  const [filters, setFilters] = useState({
    runId: '',
    agentName: '',
    toolName: '',
    decision: undefined,
    fromDate: '',
    toDate: '',
  });
  const [logs, setLogs] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [matrix, setMatrix] = useState(null);

  const loadLogs = useCallback(async (targetPage = 1) => {
    setLoading(true);
    try {
      const params = { page: targetPage, limit: 50 };
      for (const key of ['runId', 'agentName', 'toolName', 'fromDate', 'toDate']) {
        if (String(filters[key] || '').trim()) params[key] = filters[key].trim();
      }
      if (filters.decision) params.decision = filters.decision;
      const { items, pagination: info } = await agentGateway.queryAuditLogs(params);
      setLogs(items);
      setPagination(info);
      setPage(targetPage);
    } catch (e) {
      message.error(errorText(e));
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    loadLogs(1);
  }, [loadLogs]);

  useEffect(() => {
    agentGateway.getPermissionMatrix()
      .then(setMatrix)
      .catch((e) => message.error(errorText(e)));
  }, []);

  const logColumns = [
    { title: 'Thời điểm', dataIndex: 'createdAt', width: 160, render: (v) => <Text style={{ fontSize: 12 }}>{fmtDate(v)}</Text> },
    { title: 'runId', dataIndex: 'runId', width: 190, render: (v) => <Text code style={{ fontSize: 11 }}>{v}</Text> },
    { title: 'Agent', dataIndex: 'agentName', width: 110, render: (v) => (v ? <Tag color="blue">{v}</Tag> : '—') },
    { title: 'Tool', dataIndex: 'toolName', width: 170, render: (v) => (v ? <Text code style={{ fontSize: 11 }}>{v}</Text> : '—') },
    {
      title: 'Quyết định',
      dataIndex: 'decision',
      width: 110,
      render: (v) => <Tag color={decisionColor(v)}>{v}</Tag>,
    },
    { title: 'Lý do', dataIndex: 'reason', render: (v) => <Text style={{ fontSize: 12 }}>{v || '—'}</Text> },
    { title: 'Phòng', dataIndex: 'department', width: 100, render: (v) => (v ? <Tag>{v}</Tag> : '—') },
  ];

  const ruleColumns = [
    { title: 'Role', dataIndex: 'role', width: 180, render: (v) => <Text code>{v || '*'}</Text> },
    { title: 'Resource', dataIndex: 'resource', width: 230, render: (v) => <Text code style={{ fontSize: 12 }}>{v}</Text> },
    { title: 'Actions', dataIndex: 'actions', render: (v) => (v || []).map((a) => <Tag key={a} color="geekblue">{a}</Tag>) },
    { title: 'Hiệu lực', dataIndex: 'effect', width: 100, render: (v) => <Tag color={v === 'DENY' ? 'red' : 'green'}>{v || 'ALLOW'}</Tag> },
  ];

  const approvalColumns = [
    { title: 'actionType', dataIndex: 'actionType', width: 240 },
    { title: 'Role duyệt', dataIndex: 'approverRoles', render: (v) => (v || []).map((r) => <Tag key={r} color="blue">{r}</Tag>) },
    {
      title: 'Hạn mức',
      dataIndex: 'limits',
      render: (limits) => Object.entries(limits || {}).map(([role, limit]) => (
        <div key={role} style={{ fontSize: 12 }}>
          <Text code>{role}</Text> {limit === null ? 'không giới hạn' : fmtMoney(limit)}
        </div>
      )),
    },
    {
      title: 'Tự duyệt',
      dataIndex: 'selfApprovalAllowed',
      width: 110,
      render: (v) => (v ? <Tag color="orange">cho phép</Tag> : <Tag color="green">cấm</Tag>),
    },
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card size="small" title="Tra cứu Audit Log của agent">
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Space wrap>
            <Input
              placeholder="runId"
              style={{ width: 220 }}
              value={filters.runId}
              onChange={(e) => setFilters({ ...filters, runId: e.target.value })}
            />
            <Input
              placeholder="agentName"
              style={{ width: 150 }}
              value={filters.agentName}
              onChange={(e) => setFilters({ ...filters, agentName: e.target.value })}
            />
            <Input
              placeholder="toolName"
              style={{ width: 180 }}
              value={filters.toolName}
              onChange={(e) => setFilters({ ...filters, toolName: e.target.value })}
            />
            <Select
              allowClear
              placeholder="decision"
              style={{ width: 130 }}
              value={filters.decision}
              onChange={(v) => setFilters({ ...filters, decision: v })}
              options={[{ value: 'ALLOW', label: 'ALLOW' }, { value: 'DENY', label: 'DENY' }]}
            />
            <Input
              placeholder="từ (ISO)"
              style={{ width: 180, ...mono }}
              value={filters.fromDate}
              onChange={(e) => setFilters({ ...filters, fromDate: e.target.value })}
            />
            <Input
              placeholder="đến (ISO)"
              style={{ width: 180, ...mono }}
              value={filters.toDate}
              onChange={(e) => setFilters({ ...filters, toDate: e.target.value })}
            />
            <Button type="primary" loading={loading} onClick={() => loadLogs(1)}>Tra cứu</Button>
          </Space>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Nhân viên thường chỉ thấy dòng của chính mình; ADMIN/SUPER_*/EXEC xem được toàn tenant. Bộ lọc
            <Text code> userId </Text> bị server ép về chính actor với role thường.
          </Text>
          <Table
            rowKey="id"
            size="small"
            loading={loading}
            columns={logColumns}
            dataSource={logs}
            pagination={{
              current: page,
              pageSize: pagination?.limit || 50,
              total: pagination?.total || 0,
              showSizeChanger: false,
              onChange: (next) => loadLogs(next),
            }}
            locale={{ emptyText: <Empty description="Không có bản ghi phù hợp" /> }}
          />
        </Space>
      </Card>

      <Card
        size="small"
        title={<Space><SafetyCertificateOutlined />Ma trận phân quyền & hạn mức duyệt</Space>}
        extra={matrix && <Text type="secondary" style={{ fontSize: 12 }}>policy v{matrix.version} · mặc định {matrix.defaultEffect}</Text>}
      >
        {!matrix && <Empty description="Chưa tải được ma trận phân quyền" />}
        {matrix && (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Row gutter={[12, 12]}>
              <Col xs={12} md={6}><Statistic title="Số rule" value={(matrix.rules || []).length} /></Col>
              <Col xs={12} md={6}><Statistic title="Role" value={(matrix.roles || []).length} /></Col>
              <Col xs={12} md={6}><Statistic title="Phòng ban" value={(matrix.departments || []).length} /></Col>
              <Col xs={12} md={6}>
                <Statistic title="Gate được tự duyệt" value={(matrix.approval?.selfApprovalAllowed || []).length} />
              </Col>
            </Row>
            <Table rowKey={(row) => `${row.role}-${row.resource}`} size="small" pagination={false} columns={ruleColumns} dataSource={matrix.rules || []} />
            <Card size="small" title="Hạn mức duyệt gate">
              <Table rowKey="actionType" size="small" pagination={false} columns={approvalColumns} dataSource={matrix.approval?.rules || []} />
            </Card>
            <Text type="secondary" style={{ fontSize: 12 }}>
              Người xem: {matrix.viewer?.role} · phòng {matrix.viewer?.department || '—'} · userId{' '}
              <Text code>{matrix.viewer?.userId}</Text>
            </Text>
          </Space>
        )}
      </Card>
    </Space>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Trang
// ═════════════════════════════════════════════════════════════════════════════

export default function MultiAgentOpsPage() {
  const [overview, setOverview] = useState(null);
  const [loadingOverview, setLoadingOverview] = useState(false);

  const loadOverview = useCallback(async () => {
    setLoadingOverview(true);
    try {
      setOverview(await agentGateway.getAgentsOverview());
    } catch (e) {
      message.error(errorText(e));
    } finally {
      setLoadingOverview(false);
    }
  }, []);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  return (
    <div style={{ padding: 24 }}>
      <Card
        size="small"
        style={{ marginBottom: 16 }}
        title={(
          <Space>
            <RobotOutlined />
            Quản trị Multi-Agent — điều phối, phê duyệt, bộ nhớ, audit
          </Space>
        )}
        extra={(
          <Space>
            {overview?.runtime && (
              <Tag color={overview.runtime.distAvailable ? 'green' : 'default'}>
                agents/dist {overview.runtime.distAvailable ? 'sẵn sàng' : 'chưa build'}
              </Tag>
            )}
            <Tag>trace: {overview?.runtime?.traceFormat || 'JSONL'}</Tag>
            <Button icon={<ReloadOutlined />} loading={loadingOverview} onClick={loadOverview}>
              Làm mới
            </Button>
          </Space>
        )}
      >
        <Text type="secondary" style={{ fontSize: 12 }}>
          Mọi thao tác đi qua server: danh tính lấy từ phiên đăng nhập của bạn, không từ dữ liệu trang gửi lên.
          Lệnh chi và chiết khấu vượt hạn mức luôn dừng ở human-gate; người đề xuất không được tự duyệt.
        </Text>
      </Card>

      <Tabs
        destroyOnHidden
        items={[
          {
            key: 'run',
            label: <Space><PlayCircleOutlined />Đội Agent & Thực thi</Space>,
            children: (
              <RunTimelineTab
                overview={overview}
                loadingOverview={loadingOverview}
                onReloadOverview={loadOverview}
              />
            ),
          },
          {
            key: 'knowledge',
            label: <Space><ApiOutlined />Hỏi đáp SOP</Space>,
            children: <KnowledgeTab />,
          },
          {
            key: 'ops',
            label: <Space><SafetyCertificateOutlined />Đối chiếu · Báo giá · Duyệt</Space>,
            children: <FinanceSalesTab />,
          },
          {
            key: 'memory',
            label: <Space><RobotOutlined />Bộ nhớ dài hạn</Space>,
            children: <MemoryTab />,
          },
          {
            key: 'audit',
            label: <Space><SafetyCertificateOutlined />Audit & Phân quyền</Space>,
            children: <AuditTab />,
          },
          {
            key: 'evals',
            label: <Space><CloudServerOutlined />Regression Eval</Space>,
            children: <EvalSummaryTab />,
          },
        ]}
      />
    </div>
  );
}
