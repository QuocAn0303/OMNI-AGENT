/**
 * Frontend: pages/Segments.jsx — Phân khúc khách hàng (Segments)
 * 
 * Tổng quan:
 * - Danh sách segment dạng Card grid (GET /crm/segments), mỗi segment hiển thị số KH
 * - Tạo/sửa segment qua modal với Rule Builder (kết hợp các điều kiện: hạng KH, chi tiêu, điểm, số đơn, lần mua cuối, tag, công nợ)
 * - Combinator: ALL (tất cả) hoặc ANY (bất kỳ)
 * - Preview khách hàng match (POST /crm/segments/preview) trước khi lưu
 * - Xóa segment (DELETE /crm/segments/:id)
 * - State: segments/loading/tagOptions — modal state (name/description/combinator/rules/previewData)
 * - Bọc trong PlanGate
 * 
 * Components/Hooks/Exports:
 * - Segments (default): Page chính — Card list + modal rule builder
 * - RuleValueInput: Component con — render input tương ứng với từng field/operator
 */
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  List, Card, Button, Input, Select, InputNumber, Form, Modal, Tag,
  message, Popconfirm, Space, Empty, Spin, Divider,
} from 'antd';
import {
  PlusOutlined, DeleteOutlined, EditOutlined, EyeOutlined,
  ReloadOutlined, MinusCircleOutlined,
} from '@ant-design/icons';
import axios from '../api/axios';
import PageHeader from '../components/layout/PageHeader';
import MoneyDisplay from '../components/shared/MoneyDisplay';
import EmptyState from '../components/shared/EmptyState';
import PlanGate from '../components/PlanGate';

// Định nghĩa fields + ops cho rule builder
const FIELD_DEFS = {
  tier: {
    label: 'Hạng khách hàng',
    ops: [
      { value: 'in', label: 'thuộc' },
      { value: 'notIn', label: 'không thuộc' },
    ],
    valueType: 'tierMulti',
  },
  totalSpent: {
    label: 'Tổng chi tiêu (VND)',
    ops: [
      { value: 'gte', label: '>=' },
      { value: 'lte', label: '<=' },
      { value: 'between', label: 'trong khoảng' },
    ],
    valueType: 'money',
  },
  loyaltyPoints: {
    label: 'Điểm loyalty',
    ops: [
      { value: 'gte', label: '>=' },
      { value: 'lte', label: '<=' },
      { value: 'between', label: 'trong khoảng' },
    ],
    valueType: 'number',
  },
  orderCount: {
    label: 'Số đơn (đã chốt)',
    ops: [
      { value: 'gte', label: '>=' },
      { value: 'lte', label: '<=' },
    ],
    valueType: 'number',
  },
  lastOrderDate: {
    label: 'Lần mua cuối',
    ops: [
      { value: 'withinDays', label: 'trong N ngày qua' },
      { value: 'beforeDays', label: 'lâu hơn N ngày' },
      { value: 'never', label: 'chưa mua bao giờ' },
    ],
    valueType: 'days',
  },
  tag: {
    label: 'Tag',
    ops: [
      { value: 'hasAny', label: 'có ít nhất 1 trong' },
      { value: 'hasAll', label: 'có tất cả' },
      { value: 'hasNone', label: 'không có tag nào trong' },
    ],
    valueType: 'tags',
  },
  hasDebt: {
    label: 'Đang có công nợ',
    ops: [{ value: 'eq', label: 'là' }],
    valueType: 'bool',
  },
};

const TIER_OPTIONS = [
  { value: 'BRONZE', label: 'Đồng' },
  { value: 'SILVER', label: 'Bạc' },
  { value: 'GOLD', label: 'Vàng' },
  { value: 'PLATINUM', label: 'Kim cương' },
];

function RuleValueInput({ field, op, value, onChange, tagOptions }) {
  const def = FIELD_DEFS[field];
  if (!def) return null;

  if (op === 'never') return <span style={{ color: 'var(--text-muted)' }}>—</span>;

  switch (def.valueType) {
    case 'tierMulti':
      return (
        <Select mode="multiple" style={{ minWidth: 200 }} options={TIER_OPTIONS}
          value={Array.isArray(value) ? value : value ? [value] : []} onChange={onChange} />
      );
    case 'money':
    case 'number':
      if (op === 'between') {
        const v = Array.isArray(value) ? value : [0, 0];
        return (
          <Space>
            <InputNumber value={v[0]} onChange={(n) => onChange([n || 0, v[1]])}
              formatter={(x) => `${x || 0}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')} />
            <span>—</span>
            <InputNumber value={v[1]} onChange={(n) => onChange([v[0], n || 0])}
              formatter={(x) => `${x || 0}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')} />
          </Space>
        );
      }
      return <InputNumber value={value} onChange={onChange} style={{ width: 180 }}
        formatter={(x) => `${x || 0}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')} />;
    case 'days':
      return <InputNumber value={value} onChange={onChange} min={1} addonAfter="ngày" style={{ width: 160 }} />;
    case 'tags':
      return (
        <Select mode="multiple" style={{ minWidth: 240 }} placeholder="Chọn tag"
          options={tagOptions.map((t) => ({ value: t.id, label: t.name }))}
          value={Array.isArray(value) ? value : []} onChange={onChange} />
      );
    case 'bool':
      return (
        <Select value={value === true || value === 'true'} onChange={onChange} style={{ width: 100 }}
          options={[{ value: true, label: 'Có' }, { value: false, label: 'Không' }]} />
      );
    default:
      return <Input value={value} onChange={(e) => onChange(e.target.value)} />;
  }
}

export default function Segments() {
  const navigate = useNavigate();
  const [segments, setSegments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tagOptions, setTagOptions] = useState([]);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [combinator, setCombinator] = useState('all'); // all | any
  const [rules, setRules] = useState([{ field: 'tier', op: 'in', value: [] }]);
  const [previewData, setPreviewData] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadSegments = async () => {
    setLoading(true);
    try {
      const [resSeg, resTags] = await Promise.all([
        axios.get('/crm/segments'),
        axios.get('/crm/tags'),
      ]);
      setSegments(resSeg.data?.data || []);
      setTagOptions(resTags.data?.data || []);
    } catch {
      message.error('Không tải được danh sách segment');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadSegments(); }, []);

  const openModal = (seg = null) => {
    setEditing(seg);
    setPreviewData(null);
    if (seg) {
      setName(seg.name);
      setDescription(seg.description || '');
      const r = seg.rules || {};
      if (r.any) { setCombinator('any'); setRules(r.any.length ? r.any : [{ field: 'tier', op: 'in', value: [] }]); }
      else { setCombinator('all'); setRules((r.all && r.all.length) ? r.all : [{ field: 'tier', op: 'in', value: [] }]); }
    } else {
      setName(''); setDescription(''); setCombinator('all');
      setRules([{ field: 'tier', op: 'in', value: [] }]);
    }
    setModalOpen(true);
  };

  const updateRule = (idx, patch) => {
    setRules((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };

  const addRule = () => setRules((p) => [...p, { field: 'tier', op: 'in', value: [] }]);
  const removeRule = (idx) => setRules((p) => p.filter((_, i) => i !== idx));

  const buildPayloadRules = () => ({ [combinator]: rules });

  const doPreview = async () => {
    setPreviewLoading(true);
    try {
      const res = await axios.post('/crm/segments/preview?limit=20', { rules: buildPayloadRules() });
      setPreviewData(res.data?.data || null);
    } catch (err) {
      message.error(err.response?.data?.message || 'Preview thất bại');
    } finally {
      setPreviewLoading(false);
    }
  };

  const save = async () => {
    if (!name.trim()) { message.warning('Nhập tên segment'); return; }
    setSaving(true);
    try {
      const payload = { name: name.trim(), description: description.trim(), rules: buildPayloadRules() };
      if (editing) {
        await axios.put(`/crm/segments/${editing.id}`, payload);
        message.success('Đã cập nhật');
      } else {
        await axios.post('/crm/segments', payload);
        message.success('Đã tạo segment');
      }
      setModalOpen(false);
      loadSegments();
    } catch (err) {
      message.error(err.response?.data?.message || 'Lưu thất bại');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id) => {
    try {
      await axios.delete(`/crm/segments/${id}`);
      message.success('Đã xóa');
      loadSegments();
    } catch {
      message.error('Xóa thất bại');
    }
  };

  return (
    <PlanGate moduleKey="segments" moduleName="Phân khúc khách hàng">
    <>
      <PageHeader
        title="Phân khúc khách hàng"
        subtitle={`${segments.length} segment`}
        actions={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={loadSegments}>Làm mới</Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => openModal()}>Tạo segment</Button>
          </Space>
        }
      />

      {loading ? (
        <div style={{ padding: 48, textAlign: 'center' }}><Spin /></div>
      ) : segments.length === 0 ? (
        <EmptyState
          title="Chưa có segment nào"
          action={<Button type="primary" icon={<PlusOutlined />} onClick={() => openModal()}>Tạo segment đầu tiên</Button>}
        />
      ) : (
        <List
          grid={{ gutter: 16, xs: 1, sm: 1, md: 2, lg: 3, xl: 3 }}
          dataSource={segments}
          renderItem={(seg) => (
            <List.Item>
              <Card
                title={seg.name}
                size="small"
                actions={[
                  <EyeOutlined key="view" title="Xem KH match" onClick={() => navigate(`/customers?segment=${seg.id}`)} />,
                  <EditOutlined key="edit" onClick={() => openModal(seg)} />,
                  <Popconfirm key="del" title="Xóa segment?" onConfirm={() => remove(seg.id)} okText="Xóa" cancelText="Hủy">
                    <DeleteOutlined />
                  </Popconfirm>,
                ]}
              >
                {seg.description && (
                  <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 0 }}>{seg.description}</p>
                )}
                <div>
                  <Tag color="blue">{seg.customerCount} KH</Tag>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    Tạo bởi {seg.createdBy?.fullName}
                  </span>
                </div>
              </Card>
            </List.Item>
          )}
        />
      )}

      <Modal
        title={editing ? 'Sửa segment' : 'Tạo segment mới'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={save}
        confirmLoading={saving}
        okText="Lưu"
        cancelText="Hủy"
        width={820}
      >
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          <Input placeholder="Tên segment *" value={name} onChange={(e) => setName(e.target.value)} />
          <Input placeholder="Mô tả ngắn" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>

        <div style={{ marginBottom: 12 }}>
          <Space>
            <span>Khách hàng thỏa mãn</span>
            <Select value={combinator} onChange={setCombinator}
              options={[
                { value: 'all', label: 'TẤT CẢ' },
                { value: 'any', label: 'BẤT KỲ' },
              ]}
              style={{ width: 110 }}
            />
            <span>điều kiện sau:</span>
          </Space>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rules.map((r, idx) => {
            const def = FIELD_DEFS[r.field];
            return (
              <div key={idx} style={{
                display: 'flex', gap: 8, alignItems: 'center',
                padding: 8, background: 'var(--bg-subtle, #f8fafc)', borderRadius: 8,
              }}>
                <Select
                  value={r.field}
                  style={{ width: 180 }}
                  onChange={(field) => {
                    const newDef = FIELD_DEFS[field];
                    updateRule(idx, { field, op: newDef.ops[0].value, value: undefined });
                  }}
                  options={Object.entries(FIELD_DEFS).map(([key, d]) => ({ value: key, label: d.label }))}
                />
                <Select
                  value={r.op}
                  style={{ width: 180 }}
                  onChange={(op) => updateRule(idx, { op, value: undefined })}
                  options={def?.ops || []}
                />
                <RuleValueInput field={r.field} op={r.op} value={r.value}
                  onChange={(v) => updateRule(idx, { value: v })}
                  tagOptions={tagOptions} />
                <Button type="text" danger icon={<MinusCircleOutlined />}
                  onClick={() => removeRule(idx)} disabled={rules.length <= 1} />
              </div>
            );
          })}
          <Button type="dashed" icon={<PlusOutlined />} onClick={addRule}>
            Thêm điều kiện
          </Button>
        </div>

        <Divider style={{ margin: '16px 0' }} />

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <strong>Xem trước</strong>
          <Button size="small" icon={<EyeOutlined />} onClick={doPreview} loading={previewLoading}>
            Chạy preview
          </Button>
        </div>

        {previewData ? (
          <div>
            <Tag color="blue" style={{ marginBottom: 8 }}>
              Khớp {previewData.total} khách hàng
            </Tag>
            <div style={{ maxHeight: 200, overflow: 'auto', border: '1px solid #f1f5f9', borderRadius: 6 }}>
              {previewData.customers.length === 0 ? (
                <Empty description="Không có khách hàng nào khớp" />
              ) : (
                <table style={{ width: '100%', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: '#f1f5f9' }}>
                      <th style={{ padding: 6, textAlign: 'left' }}>Tên</th>
                      <th style={{ padding: 6, textAlign: 'left' }}>Hạng</th>
                      <th style={{ padding: 6, textAlign: 'right' }}>Chi tiêu</th>
                      <th style={{ padding: 6, textAlign: 'right' }}>Điểm</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewData.customers.map((c) => (
                      <tr key={c.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                        <td style={{ padding: 6 }}>{c.name}</td>
                        <td style={{ padding: 6 }}><Tag>{c.tier}</Tag></td>
                        <td style={{ padding: 6, textAlign: 'right' }}>
                          <MoneyDisplay value={c.totalSpent} />
                        </td>
                        <td style={{ padding: 6, textAlign: 'right' }}>{c.loyaltyPoints}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        ) : (
          <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
            Bấm "Chạy preview" để xem khách hàng nào sẽ thuộc segment này.
          </div>
        )}
      </Modal>
    </>
    </PlanGate>
  );
}
