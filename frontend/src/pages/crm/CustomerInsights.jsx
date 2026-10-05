/**
 * Frontend: src/pages/crm/CustomerInsights.jsx — RFM / CLV / churn (CRM Phase 4 mục 1)
 *
 * Tổng quan:
 * - Dữ liệu RFM/CLV/churn đã được `rfm.service.js` + `clv-forecast.service.js` ghi
 *   lên `Customer` từ lâu, nhưng trước Phase 4 **không API nào đọc** → có dữ liệu
 *   mà không ai vẽ. Trang này là nơi hiển thị đầu tiên.
 * - Gọi `GET /analytics/customer-insights` — endpoint CHỈ ĐỌC dữ liệu đã chấm,
 *   không tự tính lại RFM/CLV (giữ 1 nguồn sự thật, tránh dashboard lệch với
 *   báo cáo CRM).
 * - Nằm ở nhóm CRM Sales Pipeline thay vì nhét thêm vào `Analytics.jsx`: plan mục 6.1
 *   ghi "thêm biểu đồ vào Analytics.jsx", nhưng Analytics.jsx đã 315 dòng và xài
 *   chung filter from/to cho doanh thu — RFM/CLV là trạng thái hiện tại của khách
 *   (snapshot), không phụ thuộc khoảng thời gian. Tách trang giữ 2 file dễ đọc hơn.
 *
 * Exports: CustomerInsights (default)
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Card, Spin, Empty, Tag, Progress, Table, Tooltip, Row, Col, Alert, message, Button,
  Space, Typography,
} from "antd";
import {
  ReloadOutlined, WarningOutlined, CrownOutlined, HeartOutlined, TeamOutlined,
  UserDeleteOutlined, DollarOutlined, GiftOutlined, AlertOutlined, LineChartOutlined,
} from "@ant-design/icons";
import {
  ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip,
} from "recharts";
import PageHeader from "../../components/layout/PageHeader";
import StatCard from "../../components/shared/StatCard";
import MoneyDisplay from "../../components/shared/MoneyDisplay";
import EmptyState from "../../components/shared/EmptyState";
import PlanGate from "../../components/PlanGate";
import axios from "../../api/axios";

// Màu phân khúc: càng gần RFM "Champions" càng xanh, rủi ro càng đỏ.
// Khớp thứ tự RFM_ORDER ở analytics.service.js.
const RFM_COLOR = {
  Champions: "#16a34a",
  Loyal: "#0d9488",
  Potential: "#0284c7",
  "At-Risk": "#d97706",
  Hibernating: "#dc2626",
  Other: "#94a3b8",
};

const TIER_COLOR = {
  PLATINUM: "#7c3aed",
  GOLD: "#d97706",
  SILVER: "#64748b",
  BRONZE: "#a16207",
};

const RFM_ICON = {
  Champions: <CrownOutlined />,
  Loyal: <HeartOutlined />,
  Potential: <TeamOutlined />,
  "At-Risk": <WarningOutlined />,
  Hibernating: <UserDeleteOutlined />,
};

export default function CustomerInsights() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  // AN.4: KPI giữ chân đọc từ endpoint riêng `/analytics/retention-kpi`.
  // Tách khỏi `customer-insights` vì hai nguồn có nhịp cập nhật khác nhau và nếu
  // gộp chung thì một lỗi của endpoint này làm mất luôn bảng kia.
  const [kpi, setKpi] = useState(null);
  const [kpiError, setKpiError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get("/analytics/customer-insights");
      setData(res.data?.data || res.data);
    } catch (err) {
      message.error(
        err?.response?.data?.message || t("crmPipeline.insights.loadFailed"),
      );
    } finally {
      setLoading(false);
    }
  }, [t]);

  const loadKpi = useCallback(async () => {
    try {
      const res = await axios.get("/analytics/retention-kpi");
      setKpi(res.data?.data || null);
      setKpiError(null);
    } catch (err) {
      setKpiError(err?.response?.data?.message || t("crmPipeline.insights.kpiLoadFailed"));
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadKpi(); }, [loadKpi]);

  const rfmData = (data?.rfmSegments || []).filter((s) => s.count > 0);
  const tierData = (data?.tiers || []).filter((x) => x.count > 0);

  const atRiskColumns = [
    {
      title: t("crmPipeline.insights.customer"),
      dataIndex: "name",
      render: (v, r) => (
        <div>
          <div style={{ fontWeight: 500 }}>{v || t("crmPipeline.insights.unknownCustomer")}</div>
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{r.phone || r.email || "—"}</div>
        </div>
      ),
    },
    {
      title: t("crmPipeline.insights.tier"),
      dataIndex: "tier",
      width: 110,
      render: (v) => <Tag color={TIER_COLOR[v] || "default"}>{v}</Tag>,
    },
    {
      title: t("crmPipeline.insights.segment"),
      dataIndex: "rfmSegment",
      width: 140,
      render: (v) => (v ? <Tag color={RFM_COLOR[v]}>{v}</Tag> : "—"),
    },
    {
      title: t("crmPipeline.insights.churnRisk"),
      dataIndex: "churnProbability",
      width: 150,
      render: (v) => (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Progress
            percent={Math.round(Number(v || 0) * 100)}
            size="small"
            strokeColor={Number(v) >= 0.75 ? "#dc2626" : "#d97706"}
            style={{ flex: 1, margin: 0 }}
          />
          <span style={{ fontVariantNumeric: "tabular-nums", fontSize: 12 }}>
            {Math.round(Number(v || 0) * 100)}%
          </span>
        </div>
      ),
    },
    {
      title: t("crmPipeline.insights.clv"),
      dataIndex: "clvPredicted",
      width: 130,
      align: "right",
      render: (v) => (v == null ? "—" : <MoneyDisplay value={v} short />),
    },
  ];

  const topClvColumns = [
    {
      title: t("crmPipeline.insights.customer"),
      dataIndex: "name",
      render: (v, r) => (
        <div>
          <div style={{ fontWeight: 500 }}>{v || t("crmPipeline.insights.unknownCustomer")}</div>
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
            <Tag color={TIER_COLOR[r.tier] || "default"} style={{ marginInlineEnd: 4 }}>{r.tier}</Tag>
            {r.rfmSegment || "—"}
          </div>
        </div>
      ),
    },
    {
      title: t("crmPipeline.insights.clv"),
      dataIndex: "clvPredicted",
      width: 150,
      align: "right",
      // null = chưa đủ dữ liệu để dự báo (khác với 0₫) — hiện "—"
      render: (v) => (v == null ? "—" : <MoneyDisplay value={v} short />),
    },
    {
      title: t("crmPipeline.insights.totalSpent"),
      dataIndex: "totalSpent",
      width: 150,
      align: "right",
      render: (v) => <MoneyDisplay value={v} short />,
    },
  ];

  if (loading && !data) {
    return (
      <div style={{ padding: 40, textAlign: "center" }}>
        <Spin size="large" />
      </div>
    );
  }

  const nothingScored = (data?.totals?.scoredCustomers ?? 0) === 0;

  return (
    <PlanGate moduleKey="analytics" moduleName={t("crmPipeline.insights.gateName")}>
      <div>
        <PageHeader
          title={t("crmPipeline.insights.title")}
          subtitle={t("crmPipeline.insights.subtitle")}
          actions={
            <Space>
              <Button icon={<ReloadOutlined />} onClick={() => { load(); loadKpi(); }} loading={loading}>
                {t("crmPipeline.insights.refresh")}
              </Button>
            </Space>
          }
        />

        {/* ── AN.4: KPI giữ chân ── */}
        {kpiError ? (
          <Alert type="warning" showIcon style={{ marginBottom: 16 }} message={kpiError} />
        ) : null}
        {kpi ? (
          <>
            <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
              <Col xs={12} md={6}>
                <StatCard
                  title={t("crmPipeline.insights.kpiAtRisk")}
                  value={`${kpi.customers.atRisk ?? 0}`}
                  icon={<UserDeleteOutlined />}
                  variant="danger"
                  loading={loading}
                />
              </Col>
              <Col xs={12} md={6}>
                <StatCard
                  title={t("crmPipeline.insights.kpiAtRiskRate")}
                  value={`${kpi.customers.atRiskRate ?? 0}%`}
                  icon={<LineChartOutlined />}
                  variant="warning"
                  loading={loading}
                />
              </Col>
              <Col xs={12} md={6}>
                <StatCard
                  title={t("crmPipeline.insights.kpiAlerts")}
                  value={`${kpi.winback.alertsTotal ?? 0}`}
                  icon={<AlertOutlined />}
                  variant="info"
                  loading={loading}
                />
              </Col>
              <Col xs={12} md={6}>
                <StatCard
                  title={t("crmPipeline.insights.kpiVoucherUsed")}
                  // Chưa phát voucher thì `null` ≠ 0% — hiện "—" để không bị hiểu
                  // là "đã gửi mà không ai dùng".
                  value={kpi.winback.voucherRedemptionRate == null ? "—" : `${kpi.winback.voucherRedemptionRate}%`}
                  icon={<GiftOutlined />}
                  variant="success"
                  loading={loading}
                />
              </Col>
            </Row>

            <Card
              size="small"
              style={{ marginBottom: 16 }}
              title={t("crmPipeline.insights.kpiCohortTitle")}
            >
              <Table
                size="small"
                pagination={false}
                rowKey="month"
                dataSource={kpi.cohorts || []}
                columns={[
                  { title: t("crmPipeline.insights.kpiCohortMonth"), dataIndex: "month", width: 110 },
                  {
                    title: t("crmPipeline.insights.kpiCohortCustomers"),
                    dataIndex: "customers",
                    width: 110,
                    align: "right",
                  },
                  {
                    title: t("crmPipeline.insights.kpiCohortActive"),
                    dataIndex: "active",
                    width: 170,
                    align: "right",
                  },
                  {
                    title: t("crmPipeline.insights.kpiCohortRate"),
                    dataIndex: "retentionRate",
                    render: (v) =>
                      v == null ? (
                        <span style={{ color: "var(--text-muted)" }}>—</span>
                      ) : (
                        <Progress
                          percent={Math.round(Number(v))}
                          size="small"
                          strokeColor={Number(v) >= 60 ? "#059669" : Number(v) >= 30 ? "#d97706" : "#dc2626"}
                        />
                      ),
                  },
                ]}
              />
              <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0, marginTop: 8 }}>
                {t("crmPipeline.insights.kpiThresholds", {
                  screening: kpi.thresholds?.churnRisk,
                  action: kpi.thresholds?.churnAction,
                })}
                {" · "}
                {(kpi.caveats || []).join(" · ")}
              </Typography.Paragraph>
            </Card>
          </>
        ) : null}

        {nothingScored ? (
          <Alert
            type="info"
            showIcon
            message={t("crmPipeline.insights.noScoreTitle")}
            description={t("crmPipeline.insights.noScoreHelp")}
          />
        ) : null}

        <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
          <Col xs={12} md={6}>
            <StatCard
              title={t("crmPipeline.insights.activeCustomers")}
              value={(data?.totals?.activeCustomers ?? 0).toLocaleString("vi-VN")}
              icon={<TeamOutlined />}
              loading={loading}
            />
          </Col>
          <Col xs={12} md={6}>
            <StatCard
              title={t("crmPipeline.insights.scoredCustomers")}
              value={(data?.totals?.scoredCustomers ?? 0).toLocaleString("vi-VN")}
              icon={<HeartOutlined />}
              variant="info"
              loading={loading}
            />
          </Col>
          <Col xs={12} md={6}>
            <StatCard
              title={t("crmPipeline.insights.totalClv")}
              value={<MoneyDisplay value={data?.clv?.total} short />}
              icon={<DollarOutlined />}
              variant="success"
              loading={loading}
            />
          </Col>
          <Col xs={12} md={6}>
            <StatCard
              title={t("crmPipeline.insights.atRisk")}
              value={(data?.churn?.atRiskTotal ?? 0).toLocaleString("vi-VN")}
              icon={<UserDeleteOutlined />}
              variant="danger"
              loading={loading}
            />
          </Col>
        </Row>

        {data?.totals?.unscoredCustomers > 0 && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
            message={t("crmPipeline.insights.unscored", {
              count: data.totals.unscoredCustomers,
            })}
          />
        )}

        <Row gutter={[16, 16]}>
          <Col xs={24} lg={12}>
            <div className="chart-card">
              <div className="chart-card__header">
                <div>
                  <div className="chart-card__title">{t("crmPipeline.insights.rfmTitle")}</div>
                  <div className="chart-card__subtitle">{t("crmPipeline.insights.rfmSubtitle")}</div>
                </div>
              </div>
              <div style={{ height: 300 }}>
                {loading ? (
                  <div style={{ display: "grid", placeItems: "center", height: "100%" }}><Spin /></div>
                ) : !rfmData.length ? (
                  <EmptyState title={t("crmPipeline.insights.noRfm")} />
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={rfmData}
                        dataKey="count"
                        nameKey="segment"
                        innerRadius="55%"
                        outerRadius="80%"
                        paddingAngle={2}
                        label={({ name, percent }) => `${name} ${Math.round(percent * 100)}%`}
                        labelLine={false}
                      >
                        {rfmData.map((entry) => (
                          <Cell key={entry.segment} fill={RFM_COLOR[entry.segment] || RFM_COLOR.Other} />
                        ))}
                      </Pie>
                      <RTooltip
                        contentStyle={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: 10, fontSize: 12 }}
                        formatter={(v, name) => [`${v} khách hàng`, name]}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>
              {rfmData.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
                  {rfmData.map((s) => (
                    <Tag key={s.segment} color={RFM_COLOR[s.segment]} style={{ marginInlineEnd: 0 }}>
                      {RFM_ICON[s.segment]} {s.segment}: {s.count}
                      {s.avgMonetary != null && (
                        <span style={{ marginLeft: 6, opacity: 0.75 }}>
                          ~{new Intl.NumberFormat("vi-VN", { notation: "compact", maximumFractionDigits: 1 }).format(s.avgMonetary)}₫
                        </span>
                      )}
                    </Tag>
                  ))}
                </div>
              )}
            </div>
          </Col>

          <Col xs={24} lg={12}>
            <div className="chart-card">
              <div className="chart-card__header">
                <div>
                  <div className="chart-card__title">{t("crmPipeline.insights.tierTitle")}</div>
                  <div className="chart-card__subtitle">{t("crmPipeline.insights.tierSubtitle")}</div>
                </div>
              </div>
              <div style={{ height: 300 }}>
                {loading ? (
                  <div style={{ display: "grid", placeItems: "center", height: "100%" }}><Spin /></div>
                ) : !tierData.length ? (
                  <EmptyState title={t("crmPipeline.insights.noTiers")} />
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={tierData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border-light)" vertical={false} />
                      <XAxis dataKey="tier" stroke="var(--text-muted)" fontSize={11} tickLine={false} axisLine={false} />
                      <YAxis stroke="var(--text-muted)" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
                      <RTooltip
                        contentStyle={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: 10, fontSize: 12 }}
                        formatter={(v) => [`${v} khách hàng`, t("crmPipeline.insights.customerCount")]}
                      />
                      <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                        {tierData.map((entry) => (
                          <Cell key={entry.tier} fill={TIER_COLOR[entry.tier] || "#94a3b8"} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          </Col>
        </Row>

        <Card
          style={{ marginTop: 16 }}
          title={
            <span>
              <WarningOutlined style={{ color: "#dc2626" }} />{" "}
              {t("crmPipeline.insights.atRiskTitle")}
              <Tag color="red" style={{ marginLeft: 8 }}>
                {data?.churn?.atRiskTotal ?? 0}
              </Tag>
            </span>
          }
        >
          <Table
            rowKey="id"
            size="small"
            columns={atRiskColumns}
            dataSource={data?.atRisk || []}
            pagination={false}
            scroll={{ x: 700 }}
            locale={{
              emptyText: (
                <Empty
                  description={t("crmPipeline.insights.noAtRisk")}
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                />
              ),
            }}
          />
        </Card>

        <Card style={{ marginTop: 16 }} title={t("crmPipeline.insights.topClvTitle")}>
          <Table
            rowKey="id"
            size="small"
            columns={topClvColumns}
            dataSource={data?.topClv || []}
            pagination={false}
            scroll={{ x: 600 }}
            locale={{
              emptyText: (
                <Empty
                  description={t("crmPipeline.insights.noClv")}
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                />
              ),
            }}
          />
        </Card>

        {data?.churn?.average != null && (
          <Tooltip
            title={t("crmPipeline.insights.churnAvgHelp", {
              pct: Math.round(data.churn.average * 100),
            })}
          >
            <div style={{ marginTop: 12, fontSize: 12, color: "var(--text-muted)" }}>
              {t("crmPipeline.insights.churnAvg", { pct: Math.round(data.churn.average * 100) })}
            </div>
          </Tooltip>
        )}
      </div>
    </PlanGate>
  );
}