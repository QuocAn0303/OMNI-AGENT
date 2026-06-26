/**
 * Frontend: pages/Reports.jsx — Trung tâm báo cáo
 * 
 * Tổng quan:
 * - Grid card chọn loại báo cáo (doanh thu, đơn hàng, tồn kho, KH, nhân sự, lợi nhuận)
 * - Chọn khoảng thời gian + định dạng (xlsx/csv) → tải file Excel về
 * - Mỗi báo cáo có endpoint riêng (GET /reports/sales, /reports/orders, ...)
 * - State: dateRange/format/downloading — tự quản lý
 * 
 * Components/Hooks/Exports:
 * - Reports (default): Page chính — filter bar + grid card + download handler
 */
import { useState } from 'react';
import { DatePicker, Select, Button, message, Spin } from 'antd';
import {
  FileExcelOutlined, BarChartOutlined,
  DollarCircleOutlined, ShoppingCartOutlined, TeamOutlined,
  DatabaseOutlined, SolutionOutlined, DownloadOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import axios from '../api/axios';
import PageHeader from '../components/layout/PageHeader';
const { RangePicker } = DatePicker;

/**
 * Reports — Trung tâm báo cáo
 * Card grid để chọn loại báo cáo + format + khoảng thời gian
 */
const REPORT_TYPES = [
  {
    key: 'sales',
    icon: <DollarCircleOutlined />,
    title: 'Báo cáo doanh thu',
    description: 'Tổng doanh thu, lợi nhuận theo ngày/tuần/tháng',
    variant: 'primary',
    endpoint: '/reports/sales',
  },
  {
    key: 'orders',
    icon: <ShoppingCartOutlined />,
    title: 'Báo cáo đơn hàng',
    description: 'Chi tiết đơn hàng, trạng thái, phương thức thanh toán',
    variant: 'info',
    endpoint: '/reports/orders',
  },
  {
    key: 'inventory',
    icon: <DatabaseOutlined />,
    title: 'Báo cáo tồn kho',
    description: 'Snapshot tồn kho, giá trị tồn, sản phẩm sắp hết',
    variant: 'warning',
    endpoint: '/reports/inventory',
  },
  {
    key: 'customers',
    icon: <TeamOutlined />,
    title: 'Báo cáo khách hàng',
    description: 'Top khách hàng, tần suất mua, RFM analysis',
    variant: 'success',
    endpoint: '/reports/customers',
  },
  {
    key: 'hr',
    icon: <SolutionOutlined />,
    title: 'Báo cáo nhân sự',
    description: 'Chấm công, giờ làm, tổng lương theo kỳ',
    variant: 'primary',
    endpoint: '/reports/hr',
  },
  {
    key: 'profit',
    icon: <BarChartOutlined />,
    title: 'Báo cáo lợi nhuận',
    description: 'Phân tích margin theo sản phẩm, danh mục',
    variant: 'danger',
    endpoint: '/reports/profit',
  },
];

export default function Reports() {
  const [dateRange, setDateRange] = useState([
    dayjs().startOf('month'),
    dayjs(),
  ]);
  const [format, setFormat] = useState('xlsx');
  const [downloading, setDownloading] = useState(null);

  const handleDownload = async (report) => {
    if (!dateRange || dateRange.length !== 2) {
      message.warning('Chọn khoảng thời gian');
      return;
    }
    setDownloading(report.key);
    try {
      const res = await axios.get(report.endpoint, {
        params: {
          from: dateRange[0].format('YYYY-MM-DD'),
          to: dateRange[1].format('YYYY-MM-DD'),
          format,
        },
        responseType: 'blob',
      });
      // Trigger download
      const blob = new Blob([res.data], { type: res.headers['content-type'] });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${report.key}_${dateRange[0].format('YYYYMMDD')}_${dateRange[1].format('YYYYMMDD')}.${format}`;
      a.click();
      URL.revokeObjectURL(url);
      message.success('Đã tải xuống');
    } catch (err) {
      message.error('Không tạo được báo cáo');
    } finally {
      setDownloading(null);
    }
  };

  return (
    <>
      <PageHeader
        title="Báo cáo"
        subtitle="Xuất báo cáo Excel/PDF theo khoảng thời gian"
      />

      {/* Filter bar */}
      <div style={{
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-light)',
        borderRadius: 'var(--radius-lg)',
        padding: 20,
        marginBottom: 24,
        display: 'flex',
        gap: 16,
        flexWrap: 'wrap',
        alignItems: 'flex-end',
      }}>
        <div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Khoảng thời gian
          </div>
          <RangePicker
            value={dateRange}
            onChange={setDateRange}
            format="DD/MM/YYYY"
            size="large"
            presets={[
              { label: 'Hôm nay', value: [dayjs(), dayjs()] },
              { label: '7 ngày qua', value: [dayjs().subtract(6, 'day'), dayjs()] },
              { label: 'Tháng này', value: [dayjs().startOf('month'), dayjs()] },
              { label: 'Tháng trước', value: [dayjs().subtract(1, 'month').startOf('month'), dayjs().subtract(1, 'month').endOf('month')] },
              { label: 'Năm nay', value: [dayjs().startOf('year'), dayjs()] },
            ]}
          />
        </div>

        <div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Định dạng
          </div>
          <Select
            value={format}
            onChange={setFormat}
            size="large"
            style={{ width: 160 }}
            options={[
              { value: 'xlsx', label: <><FileExcelOutlined style={{ color: 'var(--success-dark)' }} /> Excel</> },
              { value: 'csv',  label: 'CSV' },
            ]}
          />
        </div>
      </div>

      {/* Report cards grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
        gap: 16,
      }}>
        {REPORT_TYPES.map((report) => (
          <div
            key={report.key}
            style={{
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-light)',
              borderRadius: 'var(--radius-lg)',
              padding: 20,
              transition: 'all var(--transition-base)',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'var(--border)';
              e.currentTarget.style.boxShadow = 'var(--shadow-md)';
              e.currentTarget.style.transform = 'translateY(-1px)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--border-light)';
              e.currentTarget.style.boxShadow = 'none';
              e.currentTarget.style.transform = 'translateY(0)';
            }}
          >
            <div className={`stat-card__icon stat-card__icon--${report.variant}`} style={{ width: 40, height: 40 }}>
              {report.icon}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>
                {report.title}
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                {report.description}
              </div>
            </div>
            <Button
              type="primary"
              icon={downloading === report.key ? <Spin size="small" /> : <DownloadOutlined />}
              onClick={() => handleDownload(report)}
              loading={downloading === report.key}
              block
            >
              Xuất {format.toUpperCase()}
            </Button>
          </div>
        ))}
      </div>
    </>
  );
}
