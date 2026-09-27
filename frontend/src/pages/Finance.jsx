/**
 * Frontend: pages/Finance.jsx — Sức khỏe tài chính (Founder Dashboard)
 * 
 * Tổng quan:
 * - Dashboard tổng quan tài chính dành cho founder: tiền mặt, runway, doanh thu, lãi/lỗ
 * - Gọi API getFounderDashboard() khi mount, hiển thị KPIs, cảnh báo, P&L, top chi phí, công nợ
 * - State: loading/error/data — tự quản lý bằng useState, không dùng store
 * 
 * Components/Hooks/Exports:
 * - Finance (default): Page chính, render các Statistic, Card, Alert
 * - PnLRow: Component con hiển thị một dòng trong báo cáo lãi/lỗ
 */
import { useEffect, useState } from "react";
import { Card, Col, Row, Spin, Alert, Tag, Statistic, Table, Empty } from "antd";
import {
  WalletOutlined,
  RiseOutlined,
  FallOutlined,
  AlertOutlined,
  BankOutlined,
  DollarCircleOutlined,
  WarningOutlined,
  ClockCircleOutlined,
} from "@ant-design/icons";
import PageHeader from "../components/layout/PageHeader";

import { getFounderDashboard } from "../api/accounting";

const fmtVND = (v) => Number(v || 0).toLocaleString("vi-VN") + "đ";
const fmtPercent = (v) => (v == null ? "—" : `${v > 0 ? "+" : ""}${v}%`);

export default function Finance() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const d = await getFounderDashboard();
        if (mounted) setData(d);
      } catch (e) {
        if (mounted) setErr(e.response?.data?.message || e.message);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  if (loading) return <div style={{ padding: 48, textAlign: "center" }}><Spin size="large" /></div>;
  if (err) return <Alert type="error" message={err} showIcon />;
  if (!data) return <Empty />;

  const profitColor = data.thisMonth.operatingProfit >= 0 ? "#16a34a" : "#dc2626";
  const runwayColor =
    data.runway.months == null ? "#6b7280" :
    data.runway.months < 3 ? "#dc2626" :
    data.runway.months < 6 ? "#f59e0b" : "#16a34a";

  return (
    <div>
      <PageHeader
        title="Sức khỏe tài chính"
        subtitle="Bức tranh tài chính tổng quan dành cho founder"
      />

      {/* CẢNH BÁO */}
      {data.alerts?.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          {data.alerts.map((a, i) => (
            <Alert
              key={i}
              message={a.message}
              type={a.severity === "critical" ? "error" : a.severity === "warning" ? "warning" : "info"}
              showIcon
              style={{ marginBottom: 8 }}
              icon={<AlertOutlined />}
            />
          ))}
        </div>
      )}

      {/* HÀNG 1: KPI lớn */}
      <Row gutter={16}>
        <Col xs={24} md={12} lg={6}>
          <Card>
            <Statistic
              title={<><WalletOutlined /> Tiền đang có</>}
              value={data.cash.total}
              formatter={(v) => fmtVND(v)}
              valueStyle={{ color: data.cash.total > 0 ? "#16a34a" : "#dc2626" }}
            />
            <div style={{ marginTop: 8, fontSize: 12, color: "#6b7280" }}>
              {data.cash.breakdown.map((b) => (
                <div key={b.code}>{b.name}: <b>{fmtVND(b.balance)}</b></div>
              ))}
            </div>
          </Card>
        </Col>
        <Col xs={24} md={12} lg={6}>
          <Card>
            <Statistic
              title={<><ClockCircleOutlined /> Runway còn lại</>}
              value={data.runway.months ?? "∞"}
              suffix={data.runway.months == null ? "(không lỗ)" : "tháng"}
              valueStyle={{ color: runwayColor }}
            />
            <div style={{ marginTop: 8, fontSize: 12, color: "#6b7280" }}>
              Net burn/tháng: <b>{fmtVND(data.runway.monthlyNetBurn)}</b>
            </div>
          </Card>
        </Col>
        <Col xs={24} md={12} lg={6}>
          <Card>
            <Statistic
              title={<><RiseOutlined /> Doanh thu tháng này</>}
              value={data.thisMonth.netRevenue}
              formatter={(v) => fmtVND(v)}
              valueStyle={{ color: "#0f766e" }}
            />
            <div style={{ marginTop: 8, fontSize: 12, color: "#6b7280" }}>
              {data.growth.revenue != null ? (
                <>So tháng trước: <Tag color={data.growth.revenue >= 0 ? "green" : "red"}>{fmtPercent(data.growth.revenue)}</Tag></>
              ) : "Chưa có dữ liệu tháng trước"}
            </div>
          </Card>
        </Col>
        <Col xs={24} md={12} lg={6}>
          <Card>
            <Statistic
              title={<><DollarCircleOutlined /> Lãi/Lỗ tháng này</>}
              value={data.thisMonth.operatingProfit}
              formatter={(v) => fmtVND(v)}
              valueStyle={{ color: profitColor }}
              prefix={data.thisMonth.operatingProfit >= 0 ? <RiseOutlined /> : <FallOutlined />}
            />
            <div style={{ marginTop: 8, fontSize: 12, color: "#6b7280" }}>
              Biên lợi nhuận gộp: <b>{data.thisMonth.grossMargin}%</b>
            </div>
          </Card>
        </Col>
      </Row>

      {/* HÀNG 2: P&L breakdown + Top expenses */}
      <Row gutter={16} style={{ marginTop: 16 }}>
        <Col xs={24} lg={12}>
          <Card title="Báo cáo lãi/lỗ tháng này">
            <PnLRow label="Doanh thu" value={data.thisMonth.revenue} positive />
            <PnLRow label="Giá vốn hàng bán (-)" value={-data.thisMonth.cogs} />
            <PnLRow label="Lợi nhuận gộp" value={data.thisMonth.grossProfit} bold positive={data.thisMonth.grossProfit >= 0} />
            <PnLRow label="Chi phí hoạt động (-)" value={-data.thisMonth.expenses} />
            <PnLRow label="Lợi nhuận thuần" value={data.thisMonth.operatingProfit} bold positive={data.thisMonth.operatingProfit >= 0} highlight />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="Top 5 chi phí lớn nhất tháng">
            {data.topExpenses.length ? (
              <Table
                size="small"
                pagination={false}
                rowKey="code"
                dataSource={data.topExpenses}
                columns={[
                  { title: "Mã", dataIndex: "code", width: 80 },
                  { title: "Khoản chi phí", dataIndex: "name" },
                  { title: "Số tiền", dataIndex: "amount", align: "right", render: fmtVND },
                ]}
              />
            ) : <Empty description="Chưa có chi phí" />}
          </Card>
        </Col>
      </Row>

      {/* HÀNG 3: Công nợ */}
      <Row gutter={16} style={{ marginTop: 16 }}>
        <Col xs={24} lg={12}>
          <Card
            title={<><BankOutlined /> Khách hàng còn nợ (Phải thu)</>}
            extra={<Tag color="blue">{fmtVND(data.receivables.total)}</Tag>}
          >
            <Statistic
              title="Quá hạn"
              value={data.receivables.overdue}
              formatter={(v) => fmtVND(v)}
              valueStyle={{ color: data.receivables.overdue > 0 ? "#dc2626" : "#16a34a" }}
            />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card
            title={<><WarningOutlined /> Cần trả nhà cung cấp (Phải trả)</>}
            extra={<Tag color="orange">{fmtVND(data.payables.total)}</Tag>}
          >
            <Statistic
              title="Quá hạn"
              value={data.payables.overdue}
              formatter={(v) => fmtVND(v)}
              valueStyle={{ color: data.payables.overdue > 0 ? "#dc2626" : "#16a34a" }}
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
}

function PnLRow({ label, value, bold, positive, highlight }) {
  const color = highlight
    ? (positive ? "#16a34a" : "#dc2626")
    : value < 0 ? "#dc2626" : "inherit";
  return (
    <div style={{
      display: "flex",
      justifyContent: "space-between",
      padding: "8px 0",
      borderBottom: "1px solid #f0f0f0",
      fontWeight: bold ? 600 : 400,
      fontSize: highlight ? 16 : 14,
      color,
      background: highlight ? "#fef3c7" : "transparent",
      paddingLeft: highlight ? 12 : 0,
      paddingRight: highlight ? 12 : 0,
      marginLeft: highlight ? -12 : 0,
      marginRight: highlight ? -12 : 0,
    }}>
      <span>{label}</span>
      <span>{fmtVND(value)}</span>
    </div>
  );
}
