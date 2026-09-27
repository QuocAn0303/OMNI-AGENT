import { useEffect, useCallback, useReducer, useState } from 'react';
import { Card, Table, Button, Tag, Space, Input, message, Modal, Empty } from 'antd';
import { CheckOutlined, CloseOutlined, ReloadOutlined } from '@ant-design/icons';
import { getPendingApprovals, decideApproval, getRuns } from '../api/workflow';
import PlanGate from '../components/PlanGate';

export default function Approvals() {
  const [state, dispatch] = useReducer(
    (prev, action) => {
      switch (action.type) {
        case 'FETCH_DONE':
          return { ...prev, loading: false, approvals: action.approvals, runs: action.runs };
        case 'FETCH_ERROR':
          return { ...prev, loading: false, approvals: [], runs: [] };
        default:
          return prev;
      }
    },
    { loading: true, approvals: [], runs: [] }
  );
  const { loading, approvals, runs } = state;
  const [comment, setComment] = useState('');
  const [deciding, setDeciding] = useState(null);

  const fetch = useCallback(async () => {
    try {
      const [a, r] = await Promise.all([
        getPendingApprovals().catch(() => []),
        getRuns(1, 50).catch(() => []),
      ]);
      dispatch({ type: 'FETCH_DONE', approvals: Array.isArray(a) ? a : [], runs: Array.isArray(r) ? r : [] });
    } catch {
      dispatch({ type: 'FETCH_ERROR' });
    }
  }, []);

  useEffect(() => {
    fetch();
  }, [fetch]);

  const handleDecide = async (id, status) => {
    try {
      await decideApproval(id, { status, comment });
      message.success(status === 'APPROVED' ? 'Đã phê duyệt' : 'Đã từ chối');
      setComment('');
      fetch();
    } catch (e) {
      message.error(e.response?.data?.message || 'Lỗi');
    }
    setDeciding(null);
  };

  const triggerColor = (t) => {
    if (t === 'EXPENSE_ABOVE') return 'orange';
    if (t === 'PO_ABOVE') return 'blue';
    if (t === 'LEAVE_REQUEST') return 'green';
    return 'default';
  };

  const statusColor = (s) => s === 'APPROVED' ? 'green' : s === 'REJECTED' ? 'red' : 'orange';

  const approvalCols = [
    { title: 'Workflow', dataIndex: ['run', 'workflow', 'name'], key: 'wf', width: 200 },
    { title: 'Loại', dataIndex: ['run', 'workflow', 'trigger'], key: 'trigger', width: 130,
      render: (t) => <Tag color={triggerColor(t)}>{t?.replace(/_/g, ' ') || 'N/A'}</Tag> },
    { title: 'Thời gian', dataIndex: 'createdAt', key: 'at', width: 160,
      render: (d) => d ? new Date(d).toLocaleString('vi-VN') : '-' },
    { title: 'Hành động', key: 'act', width: 200,
      render: (_, r) => (
        <Space>
          <Button size="small" type="primary" icon={<CheckOutlined />}
            onClick={() => setDeciding(r.id)}>Duyet</Button>
          <Button size="small" danger icon={<CloseOutlined />}
            onClick={() => handleDecide(r.id, 'REJECTED')}>Tu choi</Button>
        </Space>
      ) },
  ];

  const runCols = [
    { title: 'Workflow', dataIndex: ['workflow', 'name'], key: 'wf' },
    { title: 'Thực thể', dataIndex: 'entity', key: 'ent', width: 100 },
    { title: 'Trạng thái', dataIndex: 'status', key: 'status', width: 120,
      render: (s) => <Tag color={statusColor(s)}>{s}</Tag> },
    { title: 'Bắt đầu', dataIndex: 'startedAt', key: 'at', width: 160,
      render: (d) => d ? new Date(d).toLocaleString('vi-VN') : '-' },
  ];

  return (
    <PlanGate moduleKey="workflows">
      <div style={{ padding: 24 }}>
        <h2>Phê duyệt & Lịch sử Workflow</h2>

        <Card title="Chờ phê duyệt" style={{ marginBottom: 24 }}>
          {approvals.length === 0 ? (
            <Empty description="Không có yêu cầu phê duyệt nào" />
          ) : (
            <Table rowKey="id" columns={approvalCols} dataSource={approvals}
              loading={loading} pagination={false} size="small" />
          )}
        </Card>

        <Card title="Lịch sử Workflow Runs" extra={
          <Button icon={<ReloadOutlined />} onClick={fetch}>Làm mới</Button>
        }>
          <Table rowKey="id" columns={runCols} dataSource={runs}
            loading={loading} size="small"
            expandable={{
              expandedRowRender: (run) => (
                <div style={{ padding: 8 }}>
                  {run.approvals?.map((a) => (
                    <div key={a.id} style={{ marginBottom: 4 }}>
                      <Tag color={statusColor(a.status)}>{a.status}</Tag>
                      <span>{a.approver?.fullName || 'N/A'}</span>
                      {a.comment && <span style={{ marginLeft: 8, color: '#888' }}>— {a.comment}</span>}
                    </div>
                  ))}
                </div>
              ),
            }}
          />
        </Card>

        <Modal open={!!deciding} title="Xác nhận phê duyệt" onCancel={() => setDeciding(null)}
          onOk={() => handleDecide(deciding, 'APPROVED')} okText="Phê duyệt">
          <Input.TextArea rows={3} placeholder="Ghi chú..." value={comment}
            onChange={(e) => setComment(e.target.value)} />
        </Modal>
      </div>
    </PlanGate>
  );
}
