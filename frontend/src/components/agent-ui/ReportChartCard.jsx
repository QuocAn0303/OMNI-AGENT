/**
 * Frontend: components/agent-ui/ReportChartCard.jsx — Thẻ biểu đồ báo cáo
 *
 * Tổng quan:
 * - Hiển thị biểu đồ dạng Bar hoặc Line từ dữ liệu báo cáo
 * - Dùng Recharts (ResponsiveContainer, BarChart/LineChart)
 * - Hỗ trợ nút xuất Excel qua prop onExport
 * - Khi data rỗng → hiển thị Spin loading
 *
 * Props:
 *   data:     Array<{ label/date/name, totalAmount/value/count }> — Dữ liệu biểu đồ
 *   type:     'bar' | 'line' — Loại biểu đồ (default 'bar')
 *   title:    string — Tiêu đề card
 *   onExport: function — Callback xuất Excel
 *
 * Exports:
 *   ReportChartCard: Component chính
 */
import { Card, Button, Spin } from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

export default function ReportChartCard({ data, type = 'bar', title, onExport }) {
  if (!data || !data.length) {
    return (
      <Card size="small" style={{ margin: '8px 0' }}>
        <div style={{ textAlign: 'center', padding: 16 }}>
          <Spin />
          <div style={{ marginTop: 8, color: 'var(--text-muted)', fontSize: 13 }}>Đang tải dữ liệu...</div>
        </div>
      </Card>
    );
  }

  const chartData = data.map(item => ({
    name: item.label || item.date || item.name || '',
    value: Number(item.totalAmount || item.value || item.count || 0),
  }));

  const Chart = type === 'line' ? LineChart : BarChart;

  return (
    <Card
      size="small"
      title={title || 'Biểu đồ'}
      style={{ margin: '8px 0' }}
      extra={onExport && <Button size="small" icon={<DownloadOutlined />} onClick={onExport}>Xuất Excel</Button>}
    >
      <ResponsiveContainer width="100%" height={200}>
        <Chart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="name" fontSize={11} />
          <YAxis fontSize={11} />
          <Tooltip />
          {type === 'line' ? (
            <Line type="monotone" dataKey="value" stroke="#0d9488" strokeWidth={2} />
          ) : (
            <Bar dataKey="value" fill="#0d9488" radius={[4, 4, 0, 0]} />
          )}
        </Chart>
      </ResponsiveContainer>
    </Card>
  );
}
