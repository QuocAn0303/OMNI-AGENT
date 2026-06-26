/**
 * Page: hr/Payroll — Bảng lương nhân viên theo tháng
 *
 * Tổng quan:
 * - Hiển thị bảng lương với các cột: giờ làm, lương cơ bản, thưởng, khấu trừ, thực lãnh
 * - Bộ lọc: chọn tháng (DatePicker picker="month")
 * - Chức năng: tính lại lương (POST /hr/payroll/calculate), điều chỉnh thưởng/khấu trừ (Modal)
 * - Thống kê nhanh: tổng nhân viên, tổng giờ, tổng quỹ lương
 * - Gọi API: GET/POST /hr/payroll, PUT /hr/payroll/:id
 * - Sử dụng EmptyState khi chưa có bảng lương
 *
 * Exports:
 * - Payroll: React functional component (default export)
 */
import { useEffect, useState, useMemo } from 'react';
import { Table, DatePicker, Button, message, Modal, InputNumber, Form } from 'antd';
import { ExportOutlined, CalculatorOutlined, EditOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import axios from '../../api/axios';
import MoneyDisplay from '../../components/shared/MoneyDisplay';
import EmptyState from '../../components/shared/EmptyState';


/**
 * Payroll — Bảng lương theo tháng
 * Endpoints:
 *   GET  /hr/payroll?month=YYYY-MM
 *   POST /hr/payroll/calculate?month=YYYY-MM   (tính lại)
 *   PUT  /hr/payroll/:id                        (điều chỉnh)
 */
export default function Payroll() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [calculating, setCalculating] = useState(false);
  const [month, setMonth] = useState(dayjs());
  const [editing, setEditing] = useState(null);
  const [form] = Form.useForm();

  const load = async () => {
    setLoading(true);
    try {
      const res = await axios.get('/hr/payroll', {
        params: { month: month.format('YYYY-MM') },
      });
      setData(Array.isArray(res.data) ? res.data : (res.data?.data || []));
    } catch {
      message.error('Không tải được bảng lương');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [month]);

  const handleCalculate = async () => {
    setCalculating(true);
    try {
      await axios.post('/hr/payroll/calculate', null, {
        params: { month: month.format('YYYY-MM') },
      });
      message.success('Đã tính lại lương cho ' + month.format('MM/YYYY'));
      load();
    } catch {
      message.error('Tính lương thất bại');
    } finally {
      setCalculating(false);
    }
  };

  const openEdit = (row) => {
    setEditing(row);
    form.setFieldsValue({
      bonus: row.bonus || 0,
      deduction: row.deduction || 0,
      notes: row.notes || '',
    });
  };

  const handleSaveAdjust = async () => {
    try {
      const values = await form.validateFields();
      await axios.put(`/hr/payroll/${editing.id}`, values);
      message.success('Đã cập nhật');
      setEditing(null);
      load();
    } catch (err) {
      if (err.errorFields) return;
      message.error('Lưu thất bại');
    }
  };

  const summary = useMemo(() => {
    const totalSalary = data.reduce((sum, r) => sum + (r.netSalary || 0), 0);
    const totalEmployees = data.length;
    const totalHours = data.reduce((sum, r) => sum + (r.totalHours || 0), 0);
    return { totalSalary, totalEmployees, totalHours };
  }, [data]);

  const columns = [
    {
      title: 'Nhân viên',
      dataIndex: 'employeeName',
      width: 200,
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
      title: 'Giờ làm',
      dataIndex: 'totalHours',
      width: 100,
      align: 'right',
      render: (h) => (
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>
          {(h || 0).toFixed(1)}h
        </span>
      ),
    },
    {
      title: 'Lương cơ bản',
      dataIndex: 'baseSalary',
      width: 130,
      align: 'right',
      render: (v) => <MoneyDisplay value={v} />,
    },
    {
      title: 'Thưởng',
      dataIndex: 'bonus',
      width: 130,
      align: 'right',
      render: (v) => v > 0 ? (
        <span style={{ color: 'var(--success-dark)', fontWeight: 500 }}>
          + <MoneyDisplay value={v} />
        </span>
      ) : <span style={{ color: 'var(--text-muted)' }}>—</span>,
    },
    {
      title: 'Khấu trừ',
      dataIndex: 'deduction',
      width: 130,
      align: 'right',
      render: (v) => v > 0 ? (
        <span style={{ color: 'var(--danger-dark)', fontWeight: 500 }}>
          − <MoneyDisplay value={v} />
        </span>
      ) : <span style={{ color: 'var(--text-muted)' }}>—</span>,
    },
    {
      title: 'Thực lãnh',
      dataIndex: 'netSalary',
      width: 150,
      align: 'right',
      sorter: (a, b) => (a.netSalary || 0) - (b.netSalary || 0),
      render: (v) => (
        <span style={{
          fontWeight: 700,
          color: 'var(--primary)',
          fontVariantNumeric: 'tabular-nums',
          fontSize: 14,
        }}>
          <MoneyDisplay value={v} />
        </span>
      ),
    },
    {
      title: '',
      width: 60,
      align: 'right',
      fixed: 'right',
      render: (_, row) => (
        <Button
          type="text" size="small"
          icon={<EditOutlined />}
          onClick={() => openEdit(row)}
          title="Điều chỉnh"
        />
      ),
    },
  ];

  return (
    <>
      <div className="filters-bar" style={{ marginTop: 8 }}>
        <DatePicker
          picker="month"
          value={month}
          onChange={(v) => v && setMonth(v)}
          format="MM/YYYY"
          allowClear={false}
        />
        <Button
          icon={<CalculatorOutlined />}
          onClick={handleCalculate}
          loading={calculating}
        >
          Tính lại lương
        </Button>
        <Button icon={<ExportOutlined />} style={{ marginLeft: 'auto' }}>
          Xuất bảng lương
        </Button>
      </div>

      {/* Summary */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: 12,
        marginBottom: 20,
      }}>
        <SummaryStat label="Tổng nhân viên" value={summary.totalEmployees} />
        <SummaryStat label="Tổng giờ làm" value={`${summary.totalHours.toFixed(0)}h`} />
        <SummaryStat
          label="Tổng quỹ lương"
          value={<MoneyDisplay value={summary.totalSalary} short />}
          color="var(--primary)"
          big
        />
      </div>

      <div className="table-card">
        <Table
          columns={columns}
          dataSource={data}
          rowKey="id"
          loading={loading}
          scroll={{ x: 1000 }}
          pagination={false}
          locale={{
            emptyText: (
              <EmptyState
                title="Chưa có bảng lương"
                description={`Chưa có dữ liệu lương cho tháng ${month.format('MM/YYYY')}. Bấm "Tính lại lương" để tạo.`}
                action={
                  <Button type="primary" icon={<CalculatorOutlined />} onClick={handleCalculate} loading={calculating}>
                    Tính lương ngay
                  </Button>
                }
              />
            ),
          }}
          summary={(pageData) => {
            if (pageData.length === 0) return null;
            const total = pageData.reduce((sum, r) => sum + (r.netSalary || 0), 0);
            return (
              <Table.Summary.Row style={{ background: 'var(--bg-tertiary)' }}>
                <Table.Summary.Cell index={0} colSpan={5}>
                  <strong>TỔNG CỘNG</strong>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={5} align="right">
                  <span style={{
                    fontWeight: 700,
                    fontSize: 16,
                    color: 'var(--primary)',
                    fontVariantNumeric: 'tabular-nums',
                  }}>
                    <MoneyDisplay value={total} />
                  </span>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={6} />
              </Table.Summary.Row>
            );
          }}
        />
      </div>

      {/* Adjust modal */}
      <Modal
        title={`Điều chỉnh lương — ${editing?.employeeName || ''}`}
        open={!!editing}
        onCancel={() => setEditing(null)}
        onOk={handleSaveAdjust}
        okText="Lưu"
        cancelText="Hủy"
        width={420}
      >
        <Form form={form} layout="vertical" size="large" style={{ marginTop: 16 }}>
          <Form.Item label="Thưởng" name="bonus">
            <InputNumber
              style={{ width: '100%' }}
              min={0}
              step={100000}
              formatter={(v) => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
              parser={(v) => v.replace(/,/g, '')}
              addonAfter="₫"
            />
          </Form.Item>
          <Form.Item label="Khấu trừ" name="deduction">
            <InputNumber
              style={{ width: '100%' }}
              min={0}
              step={100000}
              formatter={(v) => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
              parser={(v) => v.replace(/,/g, '')}
              addonAfter="₫"
            />
          </Form.Item>
          <Form.Item label="Ghi chú" name="notes">
            <textarea
              style={{
                width: '100%',
                padding: 12,
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-md)',
                fontFamily: 'inherit',
                fontSize: 14,
                resize: 'vertical',
              }}
              rows={2}
              placeholder="Lý do điều chỉnh..."
            />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}

function SummaryStat({ label, value, color = 'var(--text-primary)', big = false }) {
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
      <div style={{
        fontSize: big ? 22 : 20,
        fontWeight: 700,
        color,
        fontVariantNumeric: 'tabular-nums',
        marginTop: 2,
      }}>
        {value}
      </div>
    </div>
  );
}
