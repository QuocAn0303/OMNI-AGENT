/**
 * Frontend: pages/Analytics.jsx — Phân tích kinh doanh (Analytics)
 * 
 * Tổng quan:
 * - Dashboard phân tích: doanh thu, đơn hàng, AOV, khách mới theo khoảng thời gian
 * - Biểu đồ: xu hướng doanh thu (AreaChart), top 10 sản phẩm (BarChart), top khách hàng (danh sách)
 * - Gọi GET /analytics với params from/to/groupBy (day/week/month)
 * - Dùng Recharts (ResponsiveContainer, AreaChart, BarChart) và StatCard component
 * - State: dateRange/groupBy/loading/data — tự quản lý
 * - Bọc trong PlanGate
 * 
 * Components/Hooks/Exports:
 * - Analytics (default): Page chính — filter bar + KPI stats + biểu đồ
 */
import { useState, useEffect } from 'react';
import { DatePicker, Select, Spin, message } from 'antd';
import {
  ResponsiveContainer,
  AreaChart, Area, BarChart, Bar,
  LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import dayjs from 'dayjs';
import axios from '../api/axios';
import PageHeader from '../components/layout/PageHeader';
import StatCard from '../components/shared/StatCard';
import MoneyDisplay from '../components/shared/MoneyDisplay';
import EmptyState from '../components/shared/EmptyState';
import PlanGate from '../components/PlanGate';
import {
  DollarCircleOutlined, ShoppingCartOutlined,
  ArrowUpOutlined, RiseOutlined,
} from '@ant-design/icons';

const { RangePicker } = DatePicker;

const CHART = {
  primary: '#0f766e',
  primaryFill: 'rgba(15, 118, 110, 0.12)',
  secondary: '#0891b2',
  accent: '#d97706',
};

/**
 * Analytics — Phân tích chuyên sâu
 * Endpoints: GET /analytics?from=&to=
 */
export default function Analytics() {
  const [dateRange, setDateRange] = useState([
    dayjs().subtract(29, 'day'),
    dayjs(),
  ]);
  const [groupBy, setGroupBy] = useState('day');
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);

  useEffect(() => {
    if (!dateRange) return;
    setLoading(true);
    axios
      .get('/analytics', {
        params: {
          from: dateRange[0].format('YYYY-MM-DD'),
          to: dateRange[1].format('YYYY-MM-DD'),
          groupBy,
        },
      })
      .then((res) => setData(res.data?.data || res.data))
      .catch(() => message.error('Không tải được dữ liệu phân tích'))
      .finally(() => setLoading(false));
  }, [dateRange, groupBy]);

  return (
    <PlanGate moduleKey="analytics" moduleName="Phân tích kinh doanh">
    <>
      <PageHeader
        title="Analytics"
        subtitle="Phân tích doanh thu, sản phẩm và khách hàng"
      />

      {/* Filter */}
      <div style={{
        display: 'flex',
        gap: 12,
        marginBottom: 24,
        flexWrap: 'wrap',
      }}>
        <RangePicker
          value={dateRange}
          onChange={setDateRange}
          format="DD/MM/YYYY"
          size="large"
          presets={[
            { label: '7 ngày', value: [dayjs().subtract(6, 'day'), dayjs()] },
            { label: '30 ngày', value: [dayjs().subtract(29, 'day'), dayjs()] },
            { label: '90 ngày', value: [dayjs().subtract(89, 'day'), dayjs()] },
            { label: 'Năm nay', value: [dayjs().startOf('year'), dayjs()] },
          ]}
        />
        <Select
          value={groupBy}
          onChange={setGroupBy}
          size="large"
          style={{ width: 140 }}
          options={[
            { value: 'day', label: 'Theo ngày' },
            { value: 'week', label: 'Theo tuần' },
            { value: 'month', label: 'Theo tháng' },
          ]}
        />
      </div>

      {/* KPI summary */}
      <div className="stat-grid">
        <StatCard
          title="Doanh thu"
          value={<MoneyDisplay value={data?.summary?.revenue} short showCurrency={false} />}
          icon={<DollarCircleOutlined />}
          variant="primary"
          trend={data?.summary?.revenueTrend?.direction}
          trendValue={data?.summary?.revenueTrend?.label}
          loading={loading}
        />
        <StatCard
          title="Đơn hàng"
          value={(data?.summary?.orders ?? 0).toLocaleString('vi-VN')}
          icon={<ShoppingCartOutlined />}
          variant="info"
          trend={data?.summary?.ordersTrend?.direction}
          trendValue={data?.summary?.ordersTrend?.label}
          loading={loading}
        />
        <StatCard
          title="AOV (Đơn TB)"
          value={<MoneyDisplay value={data?.summary?.aov} short showCurrency={false} />}
          icon={<RiseOutlined />}
          variant="success"
          loading={loading}
        />
        <StatCard
          title="Khách mới"
          value={(data?.summary?.newCustomers ?? 0).toLocaleString('vi-VN')}
          icon={<ArrowUpOutlined />}
          variant="warning"
          loading={loading}
        />
      </div>

      {/* Revenue trend */}
      <div className="chart-card" style={{ marginBottom: 16 }}>
        <div className="chart-card__header">
          <div>
            <div className="chart-card__title">Xu hướng doanh thu</div>
            <div className="chart-card__subtitle">
              {dateRange?.[0]?.format('DD/MM')} – {dateRange?.[1]?.format('DD/MM/YYYY')}
            </div>
          </div>
        </div>
        <div style={{ height: 320 }}>
          {loading ? (
            <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}>
              <Spin />
            </div>
          ) : !data?.timeSeries?.length ? (
            <EmptyState title="Chưa có dữ liệu" />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.timeSeries} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradAnalytics" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={CHART.primary} stopOpacity={0.25} />
                    <stop offset="100%" stopColor={CHART.primary} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-light)" vertical={false} />
                <XAxis dataKey="period" stroke="var(--text-muted)" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="var(--text-muted)" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => (v / 1e6).toFixed(0) + 'M'} />
                <Tooltip
                  contentStyle={{
                    background: 'var(--bg-secondary)',
                    border: '1px solid var(--border)',
                    borderRadius: 10,
                    fontSize: 12,
                    boxShadow: 'var(--shadow-md)',
                  }}
                  formatter={(v, name) => {
                    if (name === 'revenue') return [new Intl.NumberFormat('vi-VN').format(v) + '₫', 'Doanh thu'];
                    if (name === 'orders')  return [v, 'Đơn hàng'];
                    return [v, name];
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="revenue"
                  stroke={CHART.primary}
                  strokeWidth={2}
                  fill="url(#gradAnalytics)"
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Two-column charts */}
      <div className="dashboard-grid">
        {/* Top products */}
        <div className="chart-card">
          <div className="chart-card__header">
            <div>
              <div className="chart-card__title">Top 10 sản phẩm</div>
              <div className="chart-card__subtitle">Theo doanh thu</div>
            </div>
          </div>
          <div style={{ height: 320 }}>
            {loading ? (
              <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}>
                <Spin />
              </div>
            ) : !data?.topProducts?.length ? (
              <EmptyState title="Chưa có dữ liệu" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={data.topProducts.slice(0, 10)}
                  layout="vertical"
                  margin={{ top: 4, right: 8, left: 8, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-light)" horizontal={false} />
                  <XAxis type="number" stroke="var(--text-muted)" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => (v / 1e6).toFixed(0) + 'M'} />
                  <YAxis dataKey="name" type="category" stroke="var(--text-muted)" fontSize={11} tickLine={false} axisLine={false} width={120} />
                  <Tooltip
                    contentStyle={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 12 }}
                    formatter={(v) => [new Intl.NumberFormat('vi-VN').format(v) + '₫', 'Doanh thu']}
                  />
                  <Bar dataKey="revenue" fill={CHART.primary} radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Top customers */}
        <div className="chart-card">
          <div className="chart-card__header">
            <div>
              <div className="chart-card__title">Top khách hàng</div>
              <div className="chart-card__subtitle">Theo chi tiêu</div>
            </div>
          </div>
          <div style={{ height: 320, overflow: 'auto', paddingRight: 4 }}>
            {loading ? (
              <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}>
                <Spin />
              </div>
            ) : !data?.topCustomers?.length ? (
              <EmptyState title="Chưa có dữ liệu" />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {data.topCustomers.slice(0, 10).map((c, i) => (
                  <div
                    key={c.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: 12,
                      background: 'var(--bg-tertiary)',
                      borderRadius: 'var(--radius-md)',
                    }}
                  >
                    <div style={{
                      width: 28, height: 28,
                      borderRadius: '50%',
                      background: i < 3 ? CHART.primary : 'var(--bg-secondary)',
                      color: i < 3 ? '#fff' : 'var(--text-muted)',
                      display: 'grid', placeItems: 'center',
                      fontSize: 12, fontWeight: 600,
                      flexShrink: 0,
                    }}>
                      {i + 1}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontWeight: 500, fontSize: 13,
                        color: 'var(--text-primary)',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>
                        {c.name || 'Khách lẻ'}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        {c.orderCount} đơn
                      </div>
                    </div>
                    <div style={{
                      fontWeight: 600,
                      color: 'var(--primary)',
                      fontVariantNumeric: 'tabular-nums',
                    }}>
                      <MoneyDisplay value={c.totalSpent} short />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
    </PlanGate>
  );
}
