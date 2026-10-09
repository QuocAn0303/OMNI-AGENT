/**
 * Frontend: src/pages/partners/PartnerRoi.jsx — Bảng xếp hạng đối tác + phễu (PRM)
 *
 * Tổng quan:
 * - Một màn hình trả lời hai câu hỏi của quản lý: "đối tác nào đáng giữ" và "đối tác
 *   nào chỉ giới thiệu nhiều mà khách rẻ".
 * - Bộ điều khiển quyết định CÁCH ĐO, và mỗi lần đổi đều hiện lại nhãn đang đo:
 *     metric  = predicted | actual   (giá trị dự báo hay tiền đã thu)
 *     sortBy  = profit | revenue | conversion | referrals
 * - Chuyển `sortBy` KHÔNG đổi `metric`. Lý do: so sánh hai đối tác theo hai thước đo
 *   khác loại là so sánh không cùng đơn vị, ra kết luận sai. Đổi thước đo phải do
 *   người dùng chọn, không tự nhảy theo thứ tự cột.
 *
 * ĐIỂM ĐỌC DỄ SAI:
 * - Cột giá trị là giá trị DỰ ĐOÁN khi metric = predicted. Cột "đã chi" luôn là tiền
 *   thật. Hai cột có nhãn khác nhau và cặp cạnh nhau để không nhầm.
 * - Cột độ phủ cho biết phần khách chuyển đổi đã đủ dữ liệu để dự báo. Độ phủ thấp
 *   thì giá trị dự báo chỉ phủ một phần khách, và đối tác đó bị so sánh thiếu cơ sở.
 *
 * Exports: PartnerRoi (default)
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Card, Table, Tag, Row, Col, Space, Select, Tooltip, Alert, Empty, Spin, App, Progress, Button,
} from "antd";
// StatCard là component của dự án, không phải của antd.
import StatCard from "../../components/shared/StatCard";
import { InfoCircleOutlined, ReloadOutlined, WarningOutlined } from "@ant-design/icons";
import PageHeader from "../../components/layout/PageHeader";
import MoneyDisplay from "../../components/shared/MoneyDisplay";
import { getPartnerRoi, getReferralFunnel } from "../../api/partners";
import {
  PARTNER_TYPE_META, FUNNEL_STAGE_META, FUNNEL_STAGES, DEAD_LABEL_KEY,
  commissionLabel, percentOf,
} from "../../components/partners/constants";

const SORTS = ["profit", "revenue", "conversion", "referrals"];
const METRICS = ["predicted", "actual"];

// Thứ tự cột phễu lấy từ mảng hằng dùng chung, để backend và frontend không lệch
// nhau. Dùng mảng thay vì `Object.keys` vì `Object.keys` đi theo thứ tự chèn vào
// object — thêm một mốc sẽ khiến bố cục đổi mà không ai nhận ra.
const FUNNEL_ORDER = FUNNEL_STAGES;

export default function PartnerRoi() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { message } = App.useApp();

  const [metric, setMetric] = useState("predicted");
  const [sortBy, setSortBy] = useState("profit");
  const [activeOnly, setActiveOnly] = useState(true);
  const [data, setData] = useState(null);
  const [funnel, setFunnel] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [roiRes, funnelRes] = await Promise.all([
        getPartnerRoi({ metric, sortBy, limit: 200, activeOnly }),
        getReferralFunnel(),
      ]);
      setData(roiRes);
      setFunnel(funnelRes || []);
    } catch (e) {
      message.error(e.response?.data?.message || t("prm.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [metric, sortBy, activeOnly, t, message]);

  useEffect(() => { load(); }, [load]);

  const totals = data?.totals;
  const rows = data?.partners || [];

  /**
   * Cột giá trị ở hàng KPI phải theo `metric`, nhưng tên trường trong `totals` là
   * `predictedValue` và `actualValue` — không phải `predicted`/`actual`. Tra cứu
   * `totals[metric]` sẽ ra `undefined` và hiển thị 0₫. Vì vậy ánh xạ tường minh.
   */
  const TOTAL_FIELD = { predicted: "predictedValue", actual: "actualValue" };
  const totalValue = totals?.[TOTAL_FIELD[metric]] ?? 0;

  const columns = useMemo(() => [
    {
      title: t("prm.col.rank"),
      key: "rank",
      width: 60,
      align: "right",
      render: (_, r) => (r.rank <= 3 ? <Tag color="gold">#{r.rank}</Tag> : r.rank),
    },
    {
      title: t("prm.col.name"),
      key: "name",
      render: (_, r) => (
        <Space direction="vertical" size={0}>
          <a onClick={() => navigate(`/prm/partners/${r.partnerId}`)}>{r.name}</a>
          <span className="text-muted" style={{ fontSize: 12 }}>{r.code}</span>
        </Space>
      ),
    },
    {
      title: t("prm.col.type"),
      dataIndex: "type",
      width: 160,
      render: (type) => <Tag color={PARTNER_TYPE_META[type]?.color}>{t(PARTNER_TYPE_META[type]?.labelKey)}</Tag>,
    },
    {
      title: t("prm.col.commission"),
      key: "commissionType",
      width: 150,
      render: (_, r) => commissionLabel(t)(r),
    },
    {
      title: t("prm.col.converted"),
      key: "converted",
      width: 110,
      align: "right",
      render: (_, r) => `${r.converted}/${r.referrals}`,
    },
    {
      title: t("prm.col.conversionRate"),
      dataIndex: "conversionRate",
      width: 110,
      align: "right",
      render: (v) => `${v}%`,
    },
    {
      title: (
        <Space size={4}>
          {t("prm.col.roiValue", { metric: t(metric === "predicted" ? "prm.predictedShort" : "prm.actualShort") })}
          <Tooltip title={t("prm.tooltip.predictedValue")}><InfoCircleOutlined /></Tooltip>
        </Space>
      ),
      dataIndex: "predictedValue",
      width: 160,
      align: "right",
      sorter: (a, b) => a.predictedValue - b.predictedValue,
      render: (v, r) => (
        <Space direction="vertical" size={0} style={{ alignItems: "flex-end" }}>
          <MoneyDisplay value={v} short />
          {metric === "predicted" && r.coverage < 100 && (
            <Tooltip title={t("prm.tooltip.coverage")}>
              <Tag color="warning" style={{ marginInlineEnd: 0 }}>{r.coverage}%</Tag>
            </Tooltip>
          )}
        </Space>
      ),
    },
    {
      // Cột này KHÔNG đổi theo `metric`: tiền đã chi là tiền đã chi, không phụ thuộc
      // vào việc đang đo theo dự báo hay thực tế. Đổi cột này theo metric sẽ làm
      // người đọc tưởng nó cũng là con số dự báo.
      title: t("prm.col.actualValue"),
      dataIndex: "actualValue",
      width: 140,
      align: "right",
      render: (v) => <MoneyDisplay value={v} short />,
    },
    {
      title: t("prm.col.commissionPaid"),
      dataIndex: "commission",
      width: 140,
      align: "right",
      render: (v) => <MoneyDisplay value={v} short />,
    },
    {
      title: t("prm.col.netProfit"),
      dataIndex: "netProfit",
      width: 150,
      align: "right",
      sorter: (a, b) => a.netProfit - b.netProfit,
      render: (v) => <MoneyDisplay value={v} short />,
    },
  ], [t, metric, navigate]);

  // Phễu tổng hợp mọi đối tác, để thấy chỗ nào rò rỉ trước khi vào từng đối tác.
  const totalFunnel = useMemo(() => {
    const acc = Object.fromEntries(FUNNEL_STAGES.map((s) => [s, 0]));
    for (const f of funnel) {
      for (const s of f.funnel || []) acc[s.stage] = (acc[s.stage] || 0) + s.count;
    }
    return acc;
  }, [funnel]);

  const totalDead = useMemo(
    () => funnel.reduce((s, f) => s + (f.dead || 0), 0),
    [funnel],
  );

  return (
    <div className="page">
      <PageHeader
        title={t("prm.roiTitle")}
        subtitle={t("prm.roiSubtitle")}
        actions={
          <Space>
            <Select
              style={{ width: 220 }}
              value={metric}
              onChange={setMetric}
              options={METRICS.map((m) => ({
                value: m,
                label: m === "predicted" ? t("prm.metric.predicted") : t("prm.metric.actual"),
              }))}
            />
            <Select
              style={{ width: 190 }}
              value={sortBy}
              onChange={setSortBy}
              options={SORTS.map((s) => ({ value: s, label: t(`prm.sort.${s}`) }))}
            />
            <Select
              style={{ width: 170 }}
              value={activeOnly}
              onChange={setActiveOnly}
              options={[
                { value: true, label: t("prm.onlyActive") },
                { value: false, label: t("prm.allStatus") },
              ]}
            />
            <Button icon={<ReloadOutlined />} onClick={load} loading={loading} aria-label={t("common.refresh")} />
          </Space>
        }
      />

      {metric === "predicted" && (
        <Alert
          type="info"
          showIcon
          icon={<InfoCircleOutlined />}
          style={{ marginBottom: 16 }}
          message={t("prm.alert.predicted")}
          description={t("prm.alert.predictedDesc")}
        />
      )}

      <Row gutter={[16, 16]} className="mb-lg">
        <Col xs={12} md={6}>
          <StatCard
            title={t("prm.kpi.overallConversion")}
            value={`${totals?.overallConversionRate ?? 0}%`}
            variant="info"
            loading={loading}
          />
        </Col>
        <Col xs={12} md={6}>
          <StatCard
            title={t("prm.kpi.roiValue", { metric: t(metric === "predicted" ? "prm.predictedShort" : "prm.actualShort") })}
            value={<MoneyDisplay value={totalValue} short />}
            variant="primary"
            loading={loading}
          />
        </Col>
        <Col xs={12} md={6}>
          <StatCard
            title={t("prm.kpi.commission")}
            value={<MoneyDisplay value={totals?.commission ?? 0} short />}
            variant="warning"
            loading={loading}
          />
        </Col>
        <Col xs={12} md={6}>
          <StatCard
            title={t("prm.kpi.netProfit")}
            value={<MoneyDisplay value={totals?.netProfit ?? 0} short />}
            variant={(totals?.netProfit ?? 0) >= 0 ? "success" : "danger"}
            loading={loading}
          />
        </Col>
      </Row>

      {totals?.roiOnCommission != null && (
        <Card size="small" style={{ marginBottom: 16 }}>
          <Space size={24} wrap>
            <span>
              {t("prm.kpi.roiOnCommission")}: <b>{totals.roiOnCommission}%</b>
            </span>
            {totals.unattachedReferrals > 0 && (
              <Tooltip title={t("prm.tooltip.unattached")}>
                <Tag color="warning">{t("prm.unattached")}: {totals.unattachedReferrals}</Tag>
              </Tooltip>
            )}
            {totals.contestedCustomers > 0 && (
              <Tooltip title={t("prm.tooltip.contested")}>
                <Tag color="error">{t("prm.contested")}: {totals.contestedCustomers}</Tag>
              </Tooltip>
            )}
          </Space>
        </Card>
      )}

      <Card title={t("prm.card.funnelAll")} style={{ marginBottom: 16 }}>
        <Spin spinning={loading}>
          <Row gutter={[16, 12]}>
            {FUNNEL_ORDER.map((stage, i) => {
              const prev = i > 0 ? totalFunnel[FUNNEL_ORDER[i - 1]] : null;
              // Thanh tiến độ so với mốc đầu tiên, dùng để thấy độ dốc của phễu.
              const top = totalFunnel[FUNNEL_ORDER[0]] || 0;
              return (
                <Col xs={12} md={6} key={stage}>
                  <div style={{ marginBottom: 4 }}>
                    <Tag color={FUNNEL_STAGE_META[stage]?.color}>{t(FUNNEL_STAGE_META[stage]?.labelKey)}</Tag>
                  </div>
                  <div style={{ fontSize: 22, fontWeight: 600 }}>{totalFunnel[stage]}</div>
                  {prev != null && (
                    <div className="text-muted" style={{ fontSize: 12 }}>
                      {t("prm.funnelOfPrev")}: {percentOf(totalFunnel[stage], prev)}
                    </div>
                  )}
                  <Progress
                    percent={top ? Math.min(100, Math.round((totalFunnel[stage] / top) * 100)) : 0}
                    showInfo={false}
                    size="small"
                  />
                </Col>
              );
            })}
            {totalDead > 0 && (
              <Col xs={24}>
                <Space>
                  <WarningOutlined style={{ color: "var(--color-warning, #faad14)" }} />
                  <span>{t(DEAD_LABEL_KEY)}: <b>{totalDead}</b></span>
                </Space>
              </Col>
            )}
          </Row>
        </Spin>
      </Card>

      <Card title={t("prm.card.ranking")}>
        <Table
          rowKey="partnerId"
          loading={loading}
          columns={columns}
          dataSource={rows}
          scroll={{ x: 1200 }}
          pagination={{ pageSize: 20, showTotal: (x) => t("prm.totalRecords", { total: x }) }}
          locale={{ emptyText: <Empty description={t("prm.empty")} /> }}
        />
      </Card>
    </div>
  );
}