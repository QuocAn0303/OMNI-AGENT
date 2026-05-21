import { useEffect, useState } from 'react';
import { Joyride } from 'react-joyride';
import { useTranslation } from 'react-i18next';
import useTour from '../hooks/useTour';
import { getDashboardTour } from '../config/tourSteps';
import {
  DollarCircleOutlined,
  ShoppingCartOutlined,
  TeamOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import {
  ResponsiveContainer,
  AreaChart, Area,
  PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import { Table, Spin } from 'antd';
import axios from '../api/axios';
import PageHeader from '../components/layout/PageHeader';
import StatCard from '../components/shared/StatCard';
import StatusTag from '../components/shared/StatusTag';
import MoneyDisplay from '../components/shared/MoneyDisplay';
import EmptyState from '../components/shared/EmptyState';

/**
 * Dashboard — Tổng quan ERP
 * Giữ nguyên endpoint cũ: /dashboard/overview, /dashboard/revenue
 */

const CHART_COLORS = {
  primary: '#0f766e',
  primaryLight: 'rgba(15, 118, 110, 0.12)',
  pie: ['#0f766e', '#0891b2', '#d97706', '#7c3aed', '#db2777'],
};

export default function Dashboard() {
  const { t } = useTranslation();
  const tour = useTour('dashboard');
  const [loading, setLoading] = useState(true);
  const [overview, setOverview] = useState(null);
  const [revenueSeries, setRevenueSeries] = useState([]);
  const [orderStatus, setOrderStatus] = useState([]);
  const [lowStock, setLowStock] = useState([]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const [overviewRes, revenueRes] = await Promise.all([
          axios.get('/dashboard/overview'),
          axios.get('/dashboard/revenue'),
        ]);
        if (!mounted) return;

        setOverview(overviewRes.data?.data || overviewRes.data || {});
        setRevenueSeries(revenueRes.data?.data?.daily || revenueRes.data?.daily || []);
        setOrderStatus(overviewRes.data?.data?.orderStatus ? Object.entries(overviewRes.data?.data?.orderStatus).map(([status, count]) => ({status, count})) : []);
        const rawLow = overviewRes.data?.data?.lowStockProducts || [];
        setLowStock(
          rawLow.map((row) => ({
            ...row,
            name: row.name ?? row.product?.name,
            sku: row.sku ?? row.product?.sku,
            categoryName: row.categoryName ?? row.product?.category?.name,
          })),
        );
      } catch (err) {
        console.error('Dashboard load error:', err);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  // Compute trend (so sánh với kỳ trước nếu BE trả)
  const revenueTrend = overview?.revenueTrend;
  const ordersTrend = overview?.ordersTrend;

  return (
    <>
      <Joyride
        steps={getDashboardTour(t)}
        run={tour.run}
        continuous
        showSkipButton
        showProgress
        callback={({ status }) => {
          if (status === 'finished' || status === 'skipped') tour.markDone();
        }}
        styles={{ options: { primaryColor: '#0f766e', zIndex: 2000 } }}
      />
      <PageHeader
        title="Tổng quan"
        subtitle="Tình hình kinh doanh hôm nay và 7 ngày gần nhất"
      />

      {/* KPI Cards */}
      <div className="stat-grid">
        <StatCard
          title="Doanh thu tháng"
          value={<MoneyDisplay value={overview?.monthRevenue} short showCurrency={false} />}
          icon={<DollarCircleOutlined />}
          variant="primary"
          trend={revenueTrend?.direction}
          trendValue={revenueTrend?.label}
          loading={loading}
        />
        <StatCard
          title="Đơn hàng tháng"
          value={(overview?.monthOrders ?? 0).toLocaleString('vi-VN')}
          icon={<ShoppingCartOutlined />}
          variant="info"
          trend={ordersTrend?.direction}
          trendValue={ordersTrend?.label}
          loading={loading}
        />
        <StatCard
          title="Khách hàng"
          value={(overview?.totalCustomers ?? 0).toLocaleString('vi-VN')}
          icon={<TeamOutlined />}
          variant="success"
          loading={loading}
        />
        <StatCard
          title="Sản phẩm sắp hết"
          value={(overview?.lowStockCount ?? 0).toLocaleString('vi-VN')}
          icon={<WarningOutlined />}
          variant="warning"
          loading={loading}
        />
      </div>

      {/* Charts row */}
      <div className="dashboard-grid">
        {/* Revenue chart */}
        <div className="chart-card">
          <div className="chart-card__header">
            <div>
              <div className="chart-card__title">Doanh thu 7 ngày</div>
              <div className="chart-card__subtitle">Đơn vị: nghìn đồng</div>
            </div>
          </div>
          <div style={{ height: 260 }}>
            {loading ? (
              <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}>
                <Spin />
              </div>
            ) : revenueSeries.length === 0 ? (
              <EmptyState title="Chưa có dữ liệu" description="Dữ liệu sẽ xuất hiện sau đơn hàng đầu tiên." />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={revenueSeries} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gradRevenue" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%"  stopColor={CHART_COLORS.primary} stopOpacity={0.25} />
                      <stop offset="100%" stopColor={CHART_COLORS.primary} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-light)" vertical={false} />
                  <XAxis
                    dataKey="date"
                    stroke="var(--text-muted)"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    stroke="var(--text-muted)"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v) => (v / 1000).toFixed(0) + 'k'}
                  />
                  <Tooltip
                    contentStyle={{
                      background: 'var(--bg-secondary)',
                      border: '1px solid var(--border)',
                      borderRadius: 10,
                      fontSize: 12,
                      boxShadow: 'var(--shadow-md)',
                    }}
                    labelStyle={{ color: 'var(--text-muted)', fontSize: 11 }}
                    formatter={(v) => [new Intl.NumberFormat('vi-VN').format(v) + '₫', 'Doanh thu']}
                  />
                  <Area
                    type="monotone"
                    dataKey="revenue"
                    stroke={CHART_COLORS.primary}
                    strokeWidth={2}
                    fill="url(#gradRevenue)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Order status pie */}
        <div className="chart-card">
          <div className="chart-card__header">
            <div>
              <div className="chart-card__title">Trạng thái đơn</div>
              <div className="chart-card__subtitle">Phân bổ tháng này</div>
            </div>
          </div>
          <div style={{ height: 260 }}>
            {loading ? (
              <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}>
                <Spin />
              </div>
            ) : orderStatus.length === 0 ? (
              <EmptyState title="Chưa có đơn hàng" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={orderStatus}
                    dataKey="count"
                    nameKey="status"
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={85}
                    paddingAngle={2}
                  >
                    {orderStatus.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS.pie[i % CHART_COLORS.pie.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      background: 'var(--bg-secondary)',
                      border: '1px solid var(--border)',
                      borderRadius: 10,
                      fontSize: 12,
                      boxShadow: 'var(--shadow-md)',
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
          {/* Legend tùy biến */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
            {orderStatus.map((item, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                <span style={{
                  width: 8, height: 8,
                  borderRadius: 2,
                  background: CHART_COLORS.pie[i % CHART_COLORS.pie.length],
                }} />
                <span style={{ color: 'var(--text-secondary)' }}>
                  {item.status}: <strong style={{ color: 'var(--text-primary)' }}>{item.count}</strong>
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Low stock alert table */}
      <div className="table-card">
        <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border-light)' }}>
          <div className="chart-card__title">Sản phẩm sắp hết hàng</div>
          <div className="chart-card__subtitle">Tồn kho dưới mức tối thiểu</div>
        </div>
        <Table
          dataSource={lowStock}
          rowKey="id"
          pagination={false}
          loading={loading}
          locale={{
            emptyText: (
              <EmptyState
                title="Tất cả sản phẩm đủ hàng"
                description="Không có sản phẩm nào dưới mức tồn kho tối thiểu."
              />
            ),
          }}
          columns={[
            {
              title: 'Sản phẩm',
              dataIndex: 'name',
              render: (name, row) => (
                <div>
                  <div style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{name || '—'}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    SKU: {row.sku || '—'}
                  </div>
                </div>
              ),
            },
            {
              title: 'Danh mục',
              dataIndex: 'categoryName',
              render: (v) => v || '—',
            },
            {
              title: 'Tồn kho',
              dataIndex: 'quantity',
              align: 'right',
              render: (q, row) => (
                <span style={{ fontWeight: 500, color: q === 0 ? 'var(--danger)' : 'var(--warning-dark)' }}>
                  {q} / {row.minStock}
                </span>
              ),
            },
            {
              title: 'Trạng thái',
              dataIndex: 'quantity',
              align: 'right',
              render: (q) => (
                <StatusTag status={q === 0 ? 'OUT_STOCK' : 'LOW_STOCK'} />
              ),
            },
          ]}
        />
      </div>
    </>
  );
}
