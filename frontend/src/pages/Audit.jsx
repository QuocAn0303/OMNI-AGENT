/**
 * Page: Audit — Lịch sử thao tác hệ thống (Admin only)
 *
 * Tổng quan:
 * - Hiển thị audit log với bảng danh sách các hành động CREATE/UPDATE/DELETE/LOGIN/LOGOUT/EXPORT
 * - Gọi API: GET /audit với phân trang
 * - Bộ lọc: tìm kiếm theo user/entity/mô tả, lọc theo hành động, khoảng thời gian
 * - Drawer chi tiết hiển thị đầy đủ thông tin: thời gian, người dùng, IP, changes JSON
 * - Sử dụng EmptyState khi chưa có bản ghi
 *
 * Exports:
 * - Audit: React functional component (default export)
 */
import { useEffect, useState, useMemo } from 'react';
import useDebounce from '../hooks/useDebounce';
import { Table, Input, Select, DatePicker, Drawer, message } from 'antd';
import { SearchOutlined, EyeOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import axios from '../api/axios';
import PageHeader from '../components/layout/PageHeader';
import EmptyState from '../components/shared/EmptyState';

const { RangePicker } = DatePicker;

const ACTION_CONFIG = {
  CREATE: { color: '#059669', label: 'Tạo' },
  UPDATE: { color: '#0284c7', label: 'Sửa' },
  DELETE: { color: '#dc2626', label: 'Xóa' },
  LOGIN:  { color: '#7c3aed', label: 'Đăng nhập' },
  LOGOUT: { color: '#94a3b8', label: 'Đăng xuất' },
  EXPORT: { color: '#d97706', label: 'Xuất file' },
};

/**
 * Audit — Lịch sử thao tác hệ thống (Admin only)
 * Endpoint: GET /api/audit
 */
export default function Audit() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const [actionFilter, setActionFilter] = useState(null);
  const [dateRange, setDateRange] = useState(null);

  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detail, setDetail] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await axios.get('/audit', { params: { page, limit: 50, ...(actionFilter && { action: actionFilter }) } });
      const raw = res.data?.data;
      const list = Array.isArray(raw) ? raw : [];
      setData(list);
      setTotal(res.data?.pagination?.total || 0);
    } catch {
      message.error('Không tải được audit log');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [page, actionFilter]);

  useEffect(() => {
    setPage(1);
  }, [actionFilter]);

  const filtered = useMemo(() => {
    return data.filter((log) => {
      if (debouncedSearch) {
        const term = debouncedSearch.toLowerCase();
        if (!`${log.userName} ${log.entity} ${log.description || ''}`.toLowerCase().includes(term))
          return false;
      }
      if (dateRange) {
        const d = dayjs(log.createdAt);
        if (d.isBefore(dateRange[0], 'day') || d.isAfter(dateRange[1], 'day')) return false;
      }
      return true;
    });
  }, [data, debouncedSearch, dateRange]);

  const columns = [
    {
      title: 'Thời gian',
      dataIndex: 'createdAt',
      width: 150,
      defaultSortOrder: 'descend',
      sorter: (a, b) => dayjs(a.createdAt).unix() - dayjs(b.createdAt).unix(),
      render: (d) => (
        <div>
          <div style={{ fontSize: 13 }}>{dayjs(d).format('DD/MM/YYYY')}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
            {dayjs(d).format('HH:mm:ss')}
          </div>
        </div>
      ),
    },
    {
      title: 'Người thực hiện',
      dataIndex: 'userName',
      width: 160,
      render: (name, row) => (
        <div>
          <div style={{ fontWeight: 500 }}>{name || 'System'}</div>
          {row.userRole && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
              {row.userRole}
            </div>
          )}
        </div>
      ),
    },
    {
      title: 'Hành động',
      dataIndex: 'action',
      width: 130,
      render: (action) => {
        const cfg = ACTION_CONFIG[action] || { color: '#94a3b8', label: action };
        return (
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '2px 10px',
            borderRadius: 'var(--radius-full)',
            background: cfg.color + '15',
            color: cfg.color,
            fontSize: 12,
            fontWeight: 500,
          }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: cfg.color }} />
            {cfg.label}
          </span>
        );
      },
    },
    {
      title: 'Đối tượng',
      dataIndex: 'entity',
      width: 130,
      render: (e, row) => (
        <div>
          <div style={{ fontSize: 13, fontWeight: 500 }}>{e}</div>
          {row.entityId && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
              #{row.entityId}
            </div>
          )}
        </div>
      ),
    },
    {
      title: 'Mô tả',
      dataIndex: 'description',
      ellipsis: true,
      render: (v) => v || <span style={{ color: 'var(--text-muted)' }}>—</span>,
    },
    {
      title: 'IP',
      dataIndex: 'ipAddress',
      width: 130,
      render: (ip) => (
        <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
          {ip || '—'}
        </span>
      ),
    },
    {
      title: '',
      width: 50,
      align: 'right',
      render: (_, row) => (
        <button
          type="button"
          onClick={() => { setDetail(row); setDetailOpen(true); }}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            padding: 4,
          }}
        >
          <EyeOutlined />
        </button>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Audit Log"
        subtitle={`${filtered.length} bản ghi`}
      />

      <div className="filters-bar">
        <Input
          className="filters-bar__search"
          placeholder="Tìm theo user, entity, mô tả..."
          prefix={<SearchOutlined style={{ color: 'var(--text-muted)' }} />}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          allowClear
        />
        <Select
          placeholder="Hành động"
          style={{ width: 160 }}
          value={actionFilter}
          onChange={setActionFilter}
          allowClear
          options={Object.entries(ACTION_CONFIG).map(([k, v]) => ({ value: k, label: v.label }))}
        />
        <RangePicker
          value={dateRange}
          onChange={setDateRange}
          format="DD/MM/YYYY"
          placeholder={['Từ ngày', 'Đến ngày']}
        />
      </div>

      <div className="table-card">
        <Table
          columns={columns}
          dataSource={filtered}
          rowKey="id"
          loading={loading}
          scroll={{ x: 1100 }}
          pagination={{ current: page, pageSize: 50, total, showSizeChanger: false, onChange: (p) => setPage(p) }}
          locale={{ emptyText: <EmptyState title="Chưa có bản ghi" /> }}
        />
      </div>

      {/* Detail Drawer */}
      <Drawer
        title="Chi tiết audit log"
        width={520}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
      >
        {detail && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Row label="Thời gian" value={dayjs(detail.createdAt).format('DD/MM/YYYY HH:mm:ss')} mono />
            <Row
              label="Người thực hiện"
              value={`${detail.userName || '—'}${detail.userRole ? ` (${detail.userRole})` : ''}`}
            />
            <Row label="Hành động" value={ACTION_CONFIG[detail.action]?.label || detail.action} />
            <Row label="Đối tượng" value={`${detail.entity} #${detail.entityId || ''}`} mono />
            <Row label="IP Address" value={detail.ipAddress || '—'} mono />
            <Row label="User Agent" value={detail.userAgent || '—'} mono small />
            <Row label="Mô tả" value={detail.description || '—'} />

            {detail.changes && (
              <>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Thay đổi
                </div>
                <pre style={{
                  background: 'var(--bg-tertiary)',
                  padding: 12,
                  borderRadius: 'var(--radius-md)',
                  fontSize: 12,
                  overflow: 'auto',
                  fontFamily: 'var(--font-mono)',
                  margin: 0,
                }}>
                  {typeof detail.changes === 'string' ? detail.changes : JSON.stringify(detail.changes, null, 2)}
                </pre>
              </>
            )}
          </div>
        )}
      </Drawer>
    </>
  );
}

function Row({ label, value, mono, small }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>
        {label}
      </div>
      <div style={{
        fontSize: small ? 11 : 13,
        fontFamily: mono ? 'var(--font-mono)' : 'inherit',
        color: 'var(--text-primary)',
        wordBreak: 'break-word',
      }}>
        {value}
      </div>
    </div>
  );
}
