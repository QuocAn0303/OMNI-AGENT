/**
 * Page: hr/Attendance — Chấm công nhân viên
 *
 * Tổng quan:
 * - Hiển thị bảng chấm công với thông tin: ngày, nhân viên, giờ vào/ra, tổng giờ, trạng thái
 * - Bộ lọc: khoảng thời gian (RangePicker), chọn nhân viên
 * - Thống kê nhanh: tổng giờ làm, ngày có mặt, ngày vắng
 * - Gọi API: GET /hr/attendance, GET /hr/employees
 * - Trạng thái: Vắng, Đi muộn, Đúng giờ (kèm Tag màu)
 * - Sử dụng EmptyState khi chưa có dữ liệu
 *
 * Exports:
 * - Attendance: React functional component (default export)
 */
import { useEffect, useState, useMemo } from 'react';
import { Table, DatePicker, Select, Button, message, Tag } from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined, ExportOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import axios from '../../api/axios';
import EmptyState from '../../components/shared/EmptyState';


const { RangePicker } = DatePicker;

/**
 * Attendance — Chấm công nhân viên
 * Endpoint: GET /hr/attendance?from=&to=&employeeId=
 */
export default function Attendance() {
  const [data, setData] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState([
    dayjs().startOf('month'),
    dayjs(),
  ]);
  const [employeeFilter, setEmployeeFilter] = useState(null);

  const load = async () => {
    if (!dateRange) return;
    setLoading(true);
    try {
      const res = await axios.get('/hr/attendance', {
        params: {
          from: dateRange[0].format('YYYY-MM-DD'),
          to: dateRange[1].format('YYYY-MM-DD'),
          employeeId: employeeFilter,
        },
      });
      setData(Array.isArray(res.data) ? res.data : (res.data?.data || []));
    } catch {
      message.error('Không tải được dữ liệu chấm công');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    axios.get('/hr/employees').then((res) => setEmployees(Array.isArray(res.data) ? res.data : (res.data?.data || [])));
  }, []);

  useEffect(() => { load(); }, [dateRange, employeeFilter]);

  // Tính tổng giờ
  const summary = useMemo(() => {
    const totalHours = data.reduce((sum, r) => sum + (r.totalHours || 0), 0);
    const presentDays = data.filter((r) => r.checkIn).length;
    const absentDays = data.filter((r) => !r.checkIn).length;
    return { totalHours, presentDays, absentDays };
  }, [data]);

  const columns = [
    {
      title: 'Ngày',
      dataIndex: 'date',
      width: 120,
      defaultSortOrder: 'descend',
      sorter: (a, b) => dayjs(a.date).unix() - dayjs(b.date).unix(),
      render: (d) => (
        <div>
          <div style={{ fontWeight: 500 }}>{dayjs(d).format('DD/MM/YYYY')}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'][dayjs(d).day()]}
          </div>
        </div>
      ),
    },
    {
      title: 'Nhân viên',
      dataIndex: 'employeeName',
      render: (name, row) => (
        <div>
          <div style={{ fontWeight: 500 }}>{name}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
            {row.employeeCode}
          </div>
        </div>
      ),
    },
    {
      title: 'Vào',
      dataIndex: 'checkIn',
      width: 120,
      render: (t) => t ? (
        <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--success-dark)' }}>
          <CheckCircleOutlined style={{ marginRight: 4 }} />
          {dayjs(t).format('HH:mm')}
        </span>
      ) : (
        <span style={{ color: 'var(--text-muted)' }}>—</span>
      ),
    },
    {
      title: 'Ra',
      dataIndex: 'checkOut',
      width: 120,
      render: (t) => t ? (
        <span style={{ fontFamily: 'var(--font-mono)' }}>
          {dayjs(t).format('HH:mm')}
        </span>
      ) : (
        <span style={{ color: 'var(--text-muted)' }}>—</span>
      ),
    },
    {
      title: 'Giờ làm',
      dataIndex: 'totalHours',
      width: 110,
      align: 'right',
      sorter: (a, b) => (a.totalHours || 0) - (b.totalHours || 0),
      render: (h) => h ? (
        <span style={{ fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>
          {h.toFixed(1)}h
        </span>
      ) : '—',
    },
    {
      title: 'Trạng thái',
      width: 130,
      render: (_, row) => {
        if (!row.checkIn) {
          return (
            <Tag icon={<CloseCircleOutlined />} color="default" style={{ borderRadius: 'var(--radius-full)' }}>
              Vắng
            </Tag>
          );
        }
        if (row.isLate) {
          return (
            <Tag color="orange" style={{ borderRadius: 'var(--radius-full)' }}>
              Đi muộn
            </Tag>
          );
        }
        return (
          <Tag color="success" icon={<CheckCircleOutlined />} style={{ borderRadius: 'var(--radius-full)' }}>
            Đúng giờ
          </Tag>
        );
      },
    },
  ];

  return (
    <>
      {/* Filter bar */}
      <div className="filters-bar" style={{ marginTop: 8 }}>
        <RangePicker
          value={dateRange}
          onChange={setDateRange}
          format="DD/MM/YYYY"
          presets={[
            { label: 'Tuần này', value: [dayjs().startOf('week'), dayjs().endOf('week')] },
            { label: 'Tháng này', value: [dayjs().startOf('month'), dayjs()] },
            { label: 'Tháng trước', value: [dayjs().subtract(1, 'month').startOf('month'), dayjs().subtract(1, 'month').endOf('month')] },
          ]}
        />
        <Select
          placeholder="Tất cả nhân viên"
          style={{ width: 220 }}
          value={employeeFilter}
          onChange={setEmployeeFilter}
          allowClear
          showSearch
          filterOption={(input, option) =>
            (option?.label || '').toLowerCase().includes(input.toLowerCase())
          }
          options={employees.map((row) => ({
            value: row.employee?.id || row.id,
            label: row.employee?.user?.fullName || row.fullName,
          }))}
        />
        <Button icon={<ExportOutlined />} style={{ marginLeft: 'auto' }}>
          Xuất Excel
        </Button>
      </div>

      {/* Quick summary */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: 12,
        marginBottom: 20,
      }}>
        <SummaryStat label="Tổng giờ làm" value={`${summary.totalHours.toFixed(1)}h`} color="var(--primary)" />
        <SummaryStat label="Ngày có mặt" value={summary.presentDays} color="var(--success-dark)" />
        <SummaryStat label="Ngày vắng" value={summary.absentDays} color="var(--danger-dark)" />
      </div>

      <div className="table-card">
        <Table
          columns={columns}
          dataSource={data}
          rowKey="id"
          loading={loading}
          scroll={{ x: 800 }}
          pagination={{ pageSize: 30 }}
          locale={{ emptyText: <EmptyState title="Chưa có dữ liệu chấm công" description="Chọn khoảng thời gian khác hoặc đợi nhân viên check-in." /> }}
        />
      </div>
    </>
  );
}

function SummaryStat({ label, value, color }) {
  return (
    <div style={{
      background: 'var(--bg-secondary)',
      border: '1px solid var(--border-light)',
      borderRadius: 'var(--radius-md)',
      padding: '12px 16px',
    }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color, fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>
        {value}
      </div>
    </div>
  );
}
