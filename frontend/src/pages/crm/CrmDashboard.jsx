/**
 * Frontend: src/pages/crm/CrmDashboard.jsx — Dashboard CRM Sales Pipeline
 *
 * Tổng quan:
 * - Một lần gọi `GET /crm/dashboard?months=6` → vẽ nhiều biểu đồ (Recharts).
 * - KPI: tổng lead, lead đủ thông tin, deal đang mở, giá trị pipeline,
 *   dự báo có trọng số, giá trị deal dự kiến chốt trong 30 ngày, tỉ lệ thắng,
 *   TB giá trị deal thắng.
 * - Biểu đồ:
 *   1. **Phễu lead** — `.crm-funnel` (CSS thuần, không Recharts): số lead mỗi giai
 *      đoạn + tỉ lệ chuyển đổi so với giai đoạn trước.
 *   2. **Giá trị deal theo giai đoạn** — BarChart ngang (tổng + có trọng số).
 *   3. **Thắng / thua theo tháng** — BarChart nhóm.
 *   4. **Lead theo tháng** — AreaChart (tạo mới vs đã chuyển đổi).
 *   5. **Nguồn lead** — PieChart top nguồn.
 *   6. **Lý do thua** + **Trạng thái lead** — bảng nhỏ.
 * - `scope` trả về từ backend là "TENANT" (quản lý) hoặc "OWN" (nhân viên) → hiện
 *   thông báo nhỏ để không hiểu nhầm số liệu toàn công ty.
 * - Phân quyền: route chỉ cho ADMIN/MANAGER; CASHIER vẫn xem được số liệu của
 *   chính mình qua GET /crm/dashboard nếu mở trực tiếp URL.
 *
 * Exports: CrmDashboard (default)
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Select, Row, Col, Card, Spin, Empty, Table, message, Tag, Space, Button, Tooltip } from "antd";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as ChartTooltip, Legend,
  AreaChart, Area, PieChart, Pie, Cell,
} from "recharts";
import {
  TeamOutlined, DollarCircleOutlined, AimOutlined, TrophyOutlined, ReloadOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import PageHeader from "../../components/layout/PageHeader";
import StatCard from "../../components/shared/StatCard";
import MoneyDisplay from "../../components/shared/MoneyDisplay";
import { getCrmDashboard } from "../../api/crm";
import { LEAD_STATUS_META, DEAL_KIND_META, shortMoney } from "../../components/crm/constants";

const CHART_COLORS = [
  "var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)",
  "var(--chart-5)", "var(--chart-6)", "var(--chart-7)",
];

const axisProps = {
  stroke: "var(--text-muted)",
  fontSize: 11,
  tickLine: false,
  axisLine: false,
};

const monthLabel = (m) => {
  const d = dayjs(`${m}-01`);
  return d.isValid() ? d.format("MM/YY") : m;
};

export default function CrmDashboard() {
  const { t } = useTranslation();
  const [months, setMonths] = useState(6);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      setData(await getCrmDashboard(months));
    } catch (err) {
      message.error(err?.response?.data?.message || t("crmPipeline.dashboard.loadError"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [months]);

  const kpi = data?.kpi || {};
  const funnel = data?.funnel?.steps || [];

  // Thanh phễu co giãn theo giá trị lớn nhất
  const funnelMax = useMemo(() => Math.max(1, ...funnel.map((s) => s.count || 0)), [funnel]);

  const byMonthData = useMemo(
    () => (data?.dealByMonth || []).map((r) => ({ ...r, label: monthLabel(r.month) })),
    [data],
  );
  const leadByMonthData = useMemo(
    () => (data?.leadByMonth || []).map((r) => ({ ...r, label: monthLabel(r.month) })),
    [data],
  );
  const sourceData = useMemo(() => (data?.leadBySource || []).slice(0, 8), [data]);
  const stageData = useMemo(() => data?.dealByStage || [], [data]);

  const tooltipStyle = {
    contentStyle: {
      background: "var(--bg-secondary)",
      border: "1px solid var(--border)",
      borderRadius: 10,
      fontSize: 12,
    },
    labelStyle: { color: "var(--text-primary)" },
  };

  if (loading && !data) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "80px 0" }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title={t("crmPipeline.dashboard.title")}
        subtitle={
          data?.scope === "OWN"
            ? t("crmPipeline.dashboard.subOwn")
            : t("crmPipeline.dashboard.subTenant")
        }
        actions={
          <Space>
            <Select
              value={months}
              onChange={setMonths}
              style={{ width: 170 }}
              options={[
                { value: 3, label: t("crmPipeline.dashboard.months3") },
                { value: 6, label: t("crmPipeline.dashboard.months6") },
                { value: 12, label: t("crmPipeline.dashboard.months12") },
              ]}
            />
            <Tooltip title={t("crmPipeline.common.reload")}>
              <Button icon={<ReloadOutlined />} onClick={load} loading={loading} />
            </Tooltip>
          </Space>
        }
      />

      {data?.scope === "OWN" && (
        <Card size="small" style={{ marginBottom: 16 }}>
          <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
            {t("crmPipeline.dashboard.ownNote")}
          </span>
        </Card>
      )}

      <div className="stat-grid">
        <StatCard
          title={t("crmPipeline.dashboard.kpiTotalLeads")}
          value={kpi.totalLeads ?? 0}
          icon={<TeamOutlined />}
          variant="primary"
        />
        <StatCard
          title={t("crmPipeline.dashboard.kpiQualified")}
          value={kpi.qualifiedLeads ?? 0}
          icon={<AimOutlined />}
          variant="info"
        />
        <StatCard
          title={t("crmPipeline.dashboard.kpiOpenDeals")}
          value={kpi.openDeals ?? 0}
          icon={<TrophyOutlined />}
          variant="warning"
        />
        <StatCard
          title={t("crmPipeline.dashboard.kpiPipeline")}
          value={<MoneyDisplay value={kpi.pipelineValue ?? 0} />}
          icon={<DollarCircleOutlined />}
          variant="primary"
        />
        <StatCard
          title={t("crmPipeline.dashboard.kpiWeighted")}
          value={<MoneyDisplay value={kpi.weightedForecast ?? 0} />}
          icon={<AimOutlined />}
          variant="success"
        />
        <StatCard
          title={t("crmPipeline.dashboard.kpiDueSoon")}
          value={<MoneyDisplay value={kpi.dueSoonValue ?? 0} />}
          icon={<DollarCircleOutlined />}
          variant="info"
        />
        <StatCard
          title={t("crmPipeline.dashboard.kpiWinRate")}
          value={`${kpi.winRate ?? 0}%`}
          icon={<TrophyOutlined />}
          variant="success"
        />
        <StatCard
          title={t("crmPipeline.dashboard.kpiAvgDeal")}
          value={<MoneyDisplay value={kpi.avgDealSize ?? 0} />}
          icon={<DollarCircleOutlined />}
          variant="primary"
        />
      </div>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={10}>
          <Card title={t("crmPipeline.dashboard.funnel")} style={{ height: "100%" }}>
            {!funnel.length ? (
              <Empty description={t("crmPipeline.dashboard.funnelEmpty")} />
            ) : (
              <div className="crm-funnel">
                {funnel.map((s, i) => (
                  <div className="crm-funnel__step" key={s.stageId || `none-${i}`}>
                    <span className="crm-funnel__label" title={s.label}>
                      {s.label}
                    </span>
                    <div className="crm-funnel__track">
                      <div
                        className="crm-funnel__bar"
                        style={{
                          width: `${Math.max(4, ((s.count || 0) / funnelMax) * 100)}%`,
                          background: s.color || "var(--chart-1)",
                        }}
                      >
                        {s.count}
                      </div>
                    </div>
                    <span className="crm-funnel__rate">
                      {s.conversionRate == null ? "" : `${s.conversionRate}%`}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 12 }}>
              {t("crmPipeline.dashboard.funnelNote", { total: data?.funnel?.total ?? 0 })}
            </div>
          </Card>
        </Col>

        <Col xs={24} lg={14}>
          <Card title={t("crmPipeline.dashboard.byStage")} style={{ height: "100%" }}>
            {!stageData.length ? (
              <Empty description={t("crmPipeline.dashboard.byStageEmpty")} />
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={stageData} layout="vertical" margin={{ left: 8, right: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-light)" horizontal={false} />
                  <XAxis type="number" {...axisProps} tickFormatter={(v) => shortMoney(v)} />
                  <YAxis type="category" dataKey="label" {...axisProps} width={130} />
                  <ChartTooltip
                    {...tooltipStyle}
                    formatter={(v, n) => [
                      Number(v || 0).toLocaleString("vi-VN"),
                      n === "value"
                        ? t("crmPipeline.dashboard.legendTotal")
                        : t("crmPipeline.dashboard.legendWeighted"),
                    ]}
                  />
                  <Legend
                    formatter={(v) =>
                      v === "value"
                        ? t("crmPipeline.dashboard.legendTotal")
                        : t("crmPipeline.dashboard.legendWeighted")
                    }
                  />
                  <Bar dataKey="value" fill="var(--chart-1)" radius={[0, 4, 4, 0]} maxBarSize={22} />
                  <Bar dataKey="weightedValue" fill="var(--chart-2)" radius={[0, 4, 4, 0]} maxBarSize={22} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </Card>
        </Col>

        <Col xs={24} lg={12}>
          <Card title={t("crmPipeline.dashboard.wonLost")} style={{ height: "100%" }}>
            {!byMonthData.length ? (
              <Empty description={t("crmPipeline.dashboard.wonLostEmpty", { months })} />
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={byMonthData} margin={{ left: 8, right: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-light)" vertical={false} />
                  <XAxis dataKey="label" {...axisProps} />
                  <YAxis {...axisProps} allowDecimals={false} />
                  <ChartTooltip {...tooltipStyle} />
                  <Legend
                    formatter={(v) =>
                      v.startsWith("won")
                        ? t("crmPipeline.dashboard.legendWon")
                        : t("crmPipeline.dashboard.legendLost")
                    }
                  />
                  <Bar dataKey="wonCount" name="wonCount" fill="var(--chart-6)" radius={[4, 4, 0, 0]} maxBarSize={28} />
                  <Bar dataKey="lostCount" name="lostCount" fill="var(--chart-7)" radius={[4, 4, 0, 0]} maxBarSize={28} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </Card>
        </Col>

        <Col xs={24} lg={12}>
          <Card title={t("crmPipeline.dashboard.leadMonth")} style={{ height: "100%" }}>
            {!leadByMonthData.length ? (
              <Empty description={t("crmPipeline.dashboard.leadMonthEmpty", { months })} />
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={leadByMonthData} margin={{ left: 8, right: 16 }}>
                  <defs>
                    <linearGradient id="crmLeadNew" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-light)" vertical={false} />
                  <XAxis dataKey="label" {...axisProps} />
                  <YAxis {...axisProps} allowDecimals={false} />
                  <ChartTooltip {...tooltipStyle} />
                  <Legend
                    formatter={(v) =>
                      v === "created"
                        ? t("crmPipeline.dashboard.legendNew")
                        : t("crmPipeline.dashboard.legendConverted")
                    }
                  />
                  <Area
                    type="monotone"
                    dataKey="created"
                    name="created"
                    stroke="var(--chart-1)"
                    strokeWidth={2}
                    fill="url(#crmLeadNew)"
                  />
                  <Area
                    type="monotone"
                    dataKey="converted"
                    name="converted"
                    stroke="var(--chart-6)"
                    strokeWidth={2}
                    fill="transparent"
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </Card>
        </Col>

        <Col xs={24} lg={8}>
          <Card title={t("crmPipeline.dashboard.source")} style={{ height: "100%" }}>
            {!sourceData.length ? (
              <Empty description={t("crmPipeline.dashboard.sourceEmpty")} />
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie
                    data={sourceData}
                    dataKey="count"
                    nameKey="source"
                    innerRadius={50}
                    outerRadius={80}
                    paddingAngle={2}
                  >
                    {sourceData.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <ChartTooltip {...tooltipStyle} />
                  <Legend formatter={(v) => <span style={{ fontSize: 12 }}>{v}</span>} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </Card>
        </Col>

        <Col xs={24} lg={8}>
          <Card title={t("crmPipeline.dashboard.leadStatus")} style={{ height: "100%" }}>
            {!data?.leadByStatus?.length ? (
              <Empty description={t("crmPipeline.dashboard.leadStatusEmpty")} />
            ) : (
              <Table
                size="small"
                rowKey="status"
                pagination={false}
                showHeader={false}
                dataSource={data.leadByStatus}
                columns={[
                  {
                    title: t("crmPipeline.fields.status"),
                    dataIndex: "status",
                    render: (v) => (
                      <Tag color={LEAD_STATUS_META[v]?.color}>{t(LEAD_STATUS_META[v]?.labelKey || "")}</Tag>
                    ),
                  },
                  {
                    title: t("crmPipeline.dashboard.countLabel"),
                    dataIndex: "count",
                    align: "right",
                    width: 90,
                    render: (v) => <b style={{ fontVariantNumeric: "tabular-nums" }}>{v}</b>,
                  },
                ]}
              />
            )}
          </Card>
        </Col>

        <Col xs={24} lg={8}>
          <Card title={t("crmPipeline.dashboard.lostReasons")} style={{ height: "100%" }}>
            {!data?.lostReasons?.length ? (
              <Empty description={t("crmPipeline.dashboard.lostReasonsEmpty", { months })} />
            ) : (
              <Table
                size="small"
                rowKey="reason"
                pagination={false}
                showHeader={false}
                dataSource={data.lostReasons.slice(0, 8)}
                columns={[
                  { title: t("crmPipeline.dashboard.reasonLabel"), dataIndex: "reason" },
                  {
                    title: t("crmPipeline.dashboard.dealCountLabel"),
                    dataIndex: "count",
                    align: "right",
                    width: 80,
                    render: (v) => (
                      <b style={{ fontVariantNumeric: "tabular-nums", color: DEAL_KIND_META.LOST.color }}>
                        {v}
                      </b>
                    ),
                  },
                ]}
              />
            )}
          </Card>
        </Col>

        <Col xs={24}>
          <Card title={t("crmPipeline.dashboard.recentDeals")}>
            {!data?.recentDeals?.length ? (
              <Empty description={t("crmPipeline.dashboard.noDeals")} />
            ) : (
              <Table
                size="small"
                rowKey="id"
                pagination={false}
                dataSource={data.recentDeals}
                columns={[
                  { title: t("crmPipeline.deals.deal"), dataIndex: "dealName" },
                  {
                    title: t("crmPipeline.fields.stage"),
                    dataIndex: "stage",
                    width: 150,
                    render: (_, row) => (
                      <Space size={6}>
                        <span className="crm-stage__dot" style={{ background: row.stage?.color }} />
                        {row.stage?.label || "—"}
                      </Space>
                    ),
                  },
                  {
                    title: t("crmPipeline.fields.status"),
                    dataIndex: "kind",
                    width: 110,
                    render: (v) => (
                      <Tag color={DEAL_KIND_META[v]?.color}>{t(DEAL_KIND_META[v]?.labelKey || "")}</Tag>
                    ),
                  },
                  {
                    title: t("crmPipeline.fields.value"),
                    dataIndex: "value",
                    width: 130,
                    align: "right",
                    render: (v) => <MoneyDisplay value={v} short />,
                  },
                  {
                    title: t("crmPipeline.fields.expectedCloseDate"),
                    dataIndex: "expectedCloseDate",
                    width: 130,
                    render: (d) => (d ? dayjs(d).format("DD/MM/YYYY") : "—"),
                  },
                ]}
              />
            )}
          </Card>
        </Col>
      </Row>
    </>
  );
}
