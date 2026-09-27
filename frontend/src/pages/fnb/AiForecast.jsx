/**
 * Frontend: src/pages/fnb/AiForecast.jsx — Dashboard AI dự báo F&B (USP)
 *
 * - Dự báo giờ cao điểm (chart) + top món
 * - Menu engineering matrix (Stars/Dogs/Puzzle/Plowhorse)
 * - Đề xuất dynamic pricing (approve/reject = human-gate)
 */
import { useState, useEffect, useCallback } from 'react';
import { Card, Row, Col, Button, Tag, Space, Spin, message, Empty, Statistic, Table, Tooltip } from 'antd';
import { ThunderboltOutlined, ReloadOutlined, CheckOutlined, CloseOutlined, BulbOutlined } from '@ant-design/icons';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip as RTooltip, CartesianGrid } from 'recharts';
import api from '../../api/axios';

const CATEGORY_COLOR = {
  STAR: { color: 'green', label: 'Star — giữ' },
  PLOWHORSE: { color: 'blue', label: 'Plowhorse — tăng giá' },
  PUZZLE: { color: 'orange', label: 'Puzzle — đẩy MKT' },
  DOG: { color: 'red', label: 'Dog — cân nhắc bỏ' },
};

export default function AiForecast() {
  const [forecast, setForecast] = useState(null);
  const [menu, setMenu] = useState(null);
  const [recs, setRecs] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [f, m, r] = await Promise.all([
        api.get('/ai-forecast/forecast?days=2'),
        api.get('/ai-forecast/menu-engineering'),
        api.get('/ai-forecast/recommendations'),
      ]);
      setForecast(f.data?.data);
      setMenu(m.data?.data);
      setRecs(r.data?.data || []);
    } catch {
      message.error('Không tải được dữ liệu AI');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSuggest = async () => {
    try {
      await api.post('/ai-forecast/suggest-pricing');
      message.success('Đã tạo đề xuất giá');
      load();
    } catch (err) {
      message.error(err.response?.data?.message || 'Lỗi');
    }
  };

  const handleDecide = async (id, decision) => {
    try {
      await api.post(`/ai-forecast/recommendations/${id}/${decision}`);
      load();
    } catch {
      message.error('Lỗi');
    }
  };

  if (loading) return <Spin style={{ display: 'flex', justifyContent: 'center', marginTop: 100 }} />;

  const peakData = forecast?.summary?.peakHours?.map((p) => ({ name: `${p.hour}h`, orders: p.predictedOrders })) || [];

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>
          <ThunderboltOutlined style={{ color: '#7c3aed', marginRight: 8 }} />
          AI Dự báo F&B
        </h2>
        <Space>
          <Button icon={<BulbOutlined />} onClick={handleSuggest}>Gợi ý giá theo giờ</Button>
          <Button icon={<ReloadOutlined />} onClick={load} />
        </Space>
      </div>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={14}>
          <Card title="Giờ cao điểm dự báo (2 ngày tới)">
            {peakData.length === 0 ? (
              <Empty description="Chưa đủ dữ liệu (cần ≥ 30 đơn trong 90 ngày)" />
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={peakData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <RTooltip />
                  <Bar dataKey="orders" fill="#7c3aed" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
            <div style={{ marginTop: 8, color: '#6b7280', fontSize: 12 }}>
              Độ tin cậy: {forecast?.summary?.confidence}% — {forecast?.summary?.totalHistoricalOrders} đơn lịch sử
            </div>
          </Card>
        </Col>
        <Col xs={24} lg={10}>
          <Card title="Đề xuất AI (chờ duyệt)">
            {recs.filter((r) => r.status === 'PENDING').length === 0 ? (
              <Empty description="Không có đề xuất chờ duyệt" />
            ) : (
              recs.filter((r) => r.status === 'PENDING').map((r) => (
                <Card key={r.id} size="small" style={{ marginBottom: 8 }} bodyStyle={{ padding: 12 }}>
                  <Tag color="purple">{r.type}</Tag>
                  <div style={{ marginTop: 4 }}>{r.payload?.suggestion}</div>
                  <Space style={{ marginTop: 8 }}>
                    <Button size="small" type="primary" icon={<CheckOutlined />} onClick={() => handleDecide(r.id, 'APPROVED')}>Duyệt</Button>
                    <Button size="small" danger icon={<CloseOutlined />} onClick={() => handleDecide(r.id, 'REJECTED')}>Bỏ</Button>
                  </Space>
                </Card>
              ))
            )}
          </Card>
        </Col>
      </Row>

      <Card title="Menu Engineering (doanh số × biên lợi nhuận)" style={{ marginTop: 16 }}>
        <Table
          size="small"
          rowKey="productId"
          dataSource={menu?.items || []}
          pagination={false}
          columns={[
            { title: 'Món', dataIndex: 'name' },
            { title: 'Doanh thu 30 ngày', dataIndex: 'revenue', render: (v) => Number(v).toLocaleString('vi-VN') + '₫' },
            { title: 'Biên LN %', dataIndex: 'margin' },
            {
              title: 'Phân loại', dataIndex: 'category',
              render: (c) => <Tag color={CATEGORY_COLOR[c]?.color}>{CATEGORY_COLOR[c]?.label || c}</Tag>,
            },
            { title: 'Hành động', dataIndex: 'action' },
          ]}
        />
      </Card>
    </div>
  );
}
