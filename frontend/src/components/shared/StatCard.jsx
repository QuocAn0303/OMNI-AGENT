/**
 * Component: shared/StatCard — Thẻ hiển thị chỉ số KPI trên Dashboard
 *
 * Tổng quan:
 * - Props: title (string), value (string|number), icon (ReactNode),
 *          variant ('primary'|'success'|'warning'|'danger'|'info'),
 *          trend ('up'|'down'|'flat'), trendValue (string), loading (bool)
 * - Hỗ trợ trạng thái loading với skeleton placeholder
 * - Hiển thị xu hướng tăng/giảm kèm icon mũi tên
 *
 * Exports:
 * - StatCard: React functional component (default export)
 */
import { ArrowUpOutlined, ArrowDownOutlined } from '@ant-design/icons';

/**
 * StatCard — KPI card cho Dashboard
 *
 * Props:
 *   title:      string  — tên KPI (vd: "Doanh thu tháng")
 *   value:      string|number — số liệu (đã format)
 *   icon:       ReactNode — icon từ @ant-design/icons
 *   variant:    'primary' | 'success' | 'warning' | 'danger' | 'info' (default 'primary')
 *   trend:      'up' | 'down' | 'flat' (optional)
 *   trendValue: string (vd: "+12%")
 *   loading:    boolean
 */
export default function StatCard({
  title,
  value,
  icon,
  variant = 'primary',
  trend,
  trendValue,
  loading = false,
}) {
  if (loading) {
    return (
      <div className="stat-card" aria-busy="true">
        <div
          className={`stat-card__icon stat-card__icon--${variant}`}
          style={{ opacity: 0.3 }}
        />
        <div className="stat-card__content">
          <div
            style={{
              width: 80,
              height: 10,
              background: 'var(--bg-tertiary)',
              borderRadius: 4,
              marginBottom: 8,
            }}
          />
          <div
            style={{
              width: 120,
              height: 20,
              background: 'var(--bg-tertiary)',
              borderRadius: 4,
            }}
          />
        </div>
      </div>
    );
  }

  const trendIcon =
    trend === 'up' ? <ArrowUpOutlined /> :
    trend === 'down' ? <ArrowDownOutlined /> :
    null;

  return (
    <div className="stat-card">
      <div className={`stat-card__icon stat-card__icon--${variant}`}>
        {icon}
      </div>
      <div className="stat-card__content">
        <div className="stat-card__title">{title}</div>
        <div className="stat-card__value">{value}</div>
        {trend && trendValue && (
          <div className={`stat-card__trend stat-card__trend--${trend}`}>
            {trendIcon} {trendValue}
          </div>
        )}
      </div>
    </div>
  );
}
