import { useState, useEffect, useCallback } from 'react';
import { Card, Table, Button, Tag, Space, Input, message, Modal, Empty } from 'antd';
import { CheckOutlined, CloseOutlined, ReloadOutlined } from '@ant-design/icons';
import { getPendingApprovals, decideApproval, getRuns } from '../api/workflow';
import PlanGate from '../components/PlanGate';

export default function Approvals() {
  const [approvals, setApprovals] = useState([]);
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(false);
  const [comment, setComment] = useState('');
  const [deciding, setDeciding] = useState(null);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const [a, r] = await Promise.all([
        getPendingApprovals().catch(() => []),
        getRuns(1, 50).catch(() => []),
      ]);
      setApprovals(Array.isArray(a) ? a : []);
      setRuns(Array.isArray(r) ? r : []);
    } catch { setApprovals([]); setRuns([]); }
    setLoading(false);
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  const handleDecide = async (id, status) => {
    try {
      await decideApproval(id, { status, comment });
      message.success(status === 'APPROVED' ? 'Da phe duyet' : 'Da tu choi');
      setComment('');
      fetch();
    } catch (e) {
      message.error(e.response?.data?.message || 'Loi');
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
    { title: 'Loai', dataIndex: ['run', 'workflow', 'trigger'], key: 'trigger', width: 130,
      render: (t) => <Tag color={triggerColor(t)}>{t?.replace(/_/g, ' ') || 'N/A'}</Tag> },
    { title: 'Thoi gian', dataIndex: 'createdAt', key: 'at', width: 160,
      render: (d) => d ? new Date(d).toLocaleString('vi-VN') : '-' },
    { title: 'Hanh dong', key: 'act', width: 200,
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
    { title: 'Thuc the', dataIndex: 'entity', key: 'ent', width: 100 },
    { title: 'Trang thai', dataIndex: 'status', key: 'status', width: 120,
      render: (s) => <Tag color={statusColor(s)}>{s}</Tag> },
    { title: 'Bat dau', dataIndex: 'startedAt', key: 'at', width: 160,
      render: (d) => d ? new Date(d).toLocaleString('vi-VN') : '-' },
  ];

  return (
    <PlanGate moduleKey="workflows">
      <div style={{ padding: 24 }}>
        <h2>Phe duyet & Lich su Workflow</h2>

        <Card title="Cho phe duyet" style={{ marginBottom: 24 }}>
          {approvals.length === 0 ? (
            <Empty description="Khong co yeu cau phe duyet nao" />
          ) : (
            <Table rowKey="id" columns={approvalCols} dataSource={approvals}
              loading={loading} pagination={false} size="small" />
          )}
        </Card>

        <Card title="Lich su Workflow Runs" extra={
          <Button icon={<ReloadOutlined />} onClick={fetch}>Lam moi</Button>
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

        <Modal open={!!deciding} title="Xac nhan phe duyet" onCancel={() => setDeciding(null)}
          onOk={() => handleDecide(deciding, 'APPROVED')} okText="Phe duyet">
          <Input.TextArea rows={3} placeholder="Ghi chu..." value={comment}
            onChange={(e) => setComment(e.target.value)} />
        </Modal>
      </div>
    </PlanGate>
  );
}
