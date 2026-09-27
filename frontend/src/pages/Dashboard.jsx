/**
 * Page: Dashboard — Trang tổng quan ERP
 *
 * Tổng quan:
 * - Hiển thị KPI cards: doanh thu tháng, đơn hàng, khách hàng, sản phẩm sắp hết
 * - Biểu đồ doanh thu 7 ngày dạng AreaChart (Recharts)
 * - Biểu đồ tròn phân bổ trạng thái đơn hàng (PieChart)
 * - Bảng sản phẩm tồn kho thấp kèm cảnh báo
 * - Gọi API: GET /dashboard/overview, GET /dashboard/revenue
 * - Tích hợp Joyride tour hướng dẫn và i18n
 * - Sử dụng StatCard, StatusTag, MoneyDisplay, EmptyState
 *
 * Exports:
 * - Dashboard: React functional component (default export)
 */
import { useEffect, useState } from 'react';
import { Joyride, STATUS } from 'react-joyride';
import { useTranslation } from 'react-i18next';
import useTour from '../hooks/useTour';
import { getDashboardTour, getOnboardingTour } from '../config/tourSteps';
import useAuthStore from '../stores/authStore';
import {
  DollarCircleOutlined,
  ShoppingCartOutlined,
  TeamOutlined,
  WarningOutlined,
  RiseOutlined,
} from '@ant-design/icons';
import {
  ResponsiveContainer,
  AreaChart, Area,
  PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import { Table, Spin, Alert, Space, Typography, Button } from 'antd';
import axios from '../api/axios';
import PageHeader from '../components/layout/PageHeader';
import StatCard from '../components/shared/StatCard';
import StatusTag from '../components/shared/StatusTag';
import MoneyDisplay from '../components/shared/MoneyDisplay';
import EmptyState from '../components/shared/EmptyState';
import { useNavigate } from 'react-router-dom';
import OfflineIndicator from '../components/OfflineIndicator';
import TrialBanner from '../components/TrialBanner';

const { Text } = Typography;
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
  const navigate = useNavigate();
  const beginnerMode = useAuthStore((s) => s.beginnerMode);
  const tour = useTour('dashboard');
  const [onboardingTourRun, setOnboardingTourRun] = useState(() => !localStorage.getItem('tour_onboarding_done'));
  const [loading, setLoading] = useState(true);
  const [overview, setOverview] = useState(null);
  const [revenueSeries, setRevenueSeries] = useState([]);
  const [orderStatus, setOrderStatus] = useState([]);
  const [lowStock, setLowStock] = useState([]);
  const [showWelcome, setShowWelcome] = useState(() => !localStorage.getItem('dashboard_welcome_dismissed'));

  const isNewUser = !overview?.totalProducts && !overview?.todayOrders && !overview?.totalCustomers;

  const handleOnboardingTourDone = (data) => {
    const { status } = data;
    if (status === STATUS.FINISHED || status === STATUS.SKIPPED) {
      localStorage.setItem('tour_onboarding_done', 'true');
      setOnboardingTourRun(false);
    }
  };

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const [overviewRes, revenueRes, settingsRes] = await Promise.all([
          axios.get('/dashboard/overview'),
          axios.get('/dashboard/revenue'),
          axios.get('/settings').catch(() => ({ data: { data: {} } })),
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

        // Sync beginner mode from server if available
        const settingsBeginner = settingsRes.data?.data?.beginnerMode;
        if (typeof settingsBeginner === 'boolean') {
          useAuthStore.getState().setBeginnerMode(settingsBeginner);
        }
      } catch (err) {
        console.error('Dashboard load error:', err);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  const revenueTrend = overview?.revenueTrend;
  const ordersTrend = overview?.ordersTrend;

  const dismissWelcome = () => {
    localStorage.setItem('dashboard_welcome_dismissed', 'true');
    setShowWelcome(false);
  };

  return (
    <>
      {/* Onboarding tour for first-time users */}
      <Joyride
        steps={getOnboardingTour()}
        run={onboardingTourRun}
        continuous
        showSkipButton
        showProgress
        locale={{
          back: t('tour.joyride.back'),
          close: t('tour.joyride.close'),
          last: t('tour.joyride.last'),
          next: t('tour.joyride.next'),
          skip: t('tour.joyride.skip'),
        }}
        styles={{
          options: { zIndex: 10000, primaryColor: '#0d9488' },
        }}
        callback={handleOnboardingTourDone}
      />

      {/* Dashboard tour (shows again on restart) */}
      <Joyride
        steps={getDashboardTour()}
        run={tour.run}
        continuous
        showSkipButton
        showProgress
        locale={{
          back: t('tour.joyride.back'),
          close: t('tour.joyride.close'),
          last: t('tour.joyride.last'),
          next: t('tour.joyride.next'),
          skip: t('tour.joyride.skip'),
        }}
        styles={{
          options: { zIndex: 10000, primaryColor: '#0d9488' },
        }}
        callback={(data) => {
          if (data.status === STATUS.FINISHED || data.status === STATUS.SKIPPED) {
            tour.markDone();
          }
        }}
      />

      <PageHeader
        title={beginnerMode ? t('dashboard.beginnerTitle') : t('dashboard.title')}
        subtitle={beginnerMode
          ? t('dashboard.beginnerSubtitle')
          : t('dashboard.subtitle')
        }
      />

      {/* Welcome banner for new users */}
      {showWelcome && (
        <Alert
          type="info"
          showIcon
          icon={<RiseOutlined />}
          message={t('dashboard.welcomeMessage')}
          description={
            <div>
              <p>{t('dashboard.welcomeDesc')}</p>
              <Space>
                {isNewUser && (
                  <Button type="primary" size="small" onClick={() => navigate('/products')}>
                    {t('dashboard.addFirstProduct')}
                  </Button>
                )}
                <Button size="small" onClick={() => navigate('/pos')}>
                  {t('dashboard.createFirstOrder')}
                </Button>
                <Button size="small" type="link" onClick={dismissWelcome}>
                  {t('dashboard.gotIt')}
                </Button>
              </Space>
            </div>
          }
          style={{ marginBottom: 16 }}
          closable
          onClose={dismissWelcome}
        />
      )}

      <TrialBanner />
      <OfflineIndicator />

      {/* KPI Cards */}
      <div className="stat-grid">
        <StatCard
          title={beginnerMode ? t('dashboard.todayRevenue') : t('dashboard.monthRevenue')}
          value={<MoneyDisplay value={beginnerMode ? overview?.todayRevenue : overview?.monthRevenue} short showCurrency={false} />}
          icon={<DollarCircleOutlined />}
          variant="primary"
          trend={revenueTrend?.direction}
          trendValue={revenueTrend?.label}
          loading={loading}
        />
        <StatCard
          title={beginnerMode ? t('dashboard.todayOrders') : t('dashboard.monthOrders')}
          value={(beginnerMode ? (overview?.todayOrders ?? 0) : (overview?.monthOrders ?? 0)).toLocaleString('vi-VN')}
          icon={<ShoppingCartOutlined />}
          variant="info"
          trend={ordersTrend?.direction}
          trendValue={ordersTrend?.label}
          loading={loading}
        />
        <StatCard
          title={t('dashboard.customers')}
          value={(overview?.totalCustomers ?? 0).toLocaleString('vi-VN')}
          icon={<TeamOutlined />}
          variant="success"
          loading={loading}
        />
        <StatCard
          title={t('dashboard.lowStock')}
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
              <div className="chart-card__title">{t('dashboard.revenue7Days')}</div>
              <div className="chart-card__subtitle">{t('dashboard.revenueUnit')}</div>
            </div>
          </div>
          <div style={{ height: 260 }}>
            {loading ? (
              <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}>
                <Spin />
              </div>
            ) : revenueSeries.length === 0 ? (
              <EmptyState title={t('dashboard.noData')} description={t('dashboard.noDataDesc')} />
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
                    formatter={(v) => [new Intl.NumberFormat('vi-VN').format(v) + '₫', t('dashboard.revenue')]}
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
              <div className="chart-card__title">{t('dashboard.orderStatus')}</div>
              <div className="chart-card__subtitle">{t('dashboard.monthDistribution')}</div>
            </div>
          </div>
          <div style={{ height: 260 }}>
            {loading ? (
              <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}>
                <Spin />
              </div>
            ) : orderStatus.length === 0 ? (
              <EmptyState title={t('dashboard.noOrders')} />
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
          <div className="chart-card__title">{t('dashboard.lowStockTitle')}</div>
          <div className="chart-card__subtitle">{t('dashboard.lowStockSubtitle')}</div>
        </div>
        <Table
          dataSource={lowStock}
          rowKey="id"
          pagination={false}
          loading={loading}
          locale={{
              emptyText: (
              <EmptyState
                title={t('dashboard.allStocked')}
                description={t('dashboard.allStockedDesc')}
              />
            ),
          }}
          columns={[
            {
              title: t('dashboard.product'),
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
              title: t('products.category'),
              dataIndex: 'categoryName',
              render: (v) => v || '—',
            },
            {
              title: t('products.stock'),
              dataIndex: 'quantity',
              align: 'right',
              render: (q, row) => (
                <span style={{ fontWeight: 500, color: q === 0 ? 'var(--danger)' : 'var(--warning-dark)' }}>
                  {q} / {row.minStock}
                </span>
              ),
            },
            {
              title: t('common.status'),
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
