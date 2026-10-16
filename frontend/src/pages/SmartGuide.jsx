import { useEffect, useState, useRef } from 'react';
import {
  Tabs, Spin, Table, Tag, Space, Typography, Card, Row, Col,
  Progress, Empty, Alert, Badge, Button, Tooltip, message,
} from 'antd';
import {
  DollarOutlined, ShoppingOutlined, HeartOutlined, FileTextOutlined,
  CheckCircleFilled,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import axios from '../api/axios';
import DOMPurify from 'dompurify';
import PageHeader from '../components/layout/PageHeader';
import MoneyDisplay from '../components/shared/MoneyDisplay';
import { proposeReplenishment } from '../api/replenishmentRules';

const { Text, Title } = Typography;

export default function SmartGuide() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('health');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pricing, setPricing] = useState(null);
  const [reorder, setReorder] = useState(null);
  const [health, setHealth] = useState(null);
  const [report, setReport] = useState(null);
  const loadedRef = useRef({});
  // SKU đang gửi đề xuất — để nút bị khoá đúng dòng, tránh bấm hai lần tạo trùng.
  const [proposingSku, setProposingSku] = useState(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (loadedRef.current[activeTab]) return;

      setLoading(true);
      try {
        if (activeTab === 'pricing') {
          const res = await axios.get('/smart-guide/pricing');
          if (!cancelled) setPricing(res.data.data);
        } else if (activeTab === 'reorder') {
          const res = await axios.get('/smart-guide/reorder');
          if (!cancelled) setReorder(res.data.data);
        } else if (activeTab === 'health') {
          const res = await axios.get('/smart-guide/health');
          if (!cancelled) setHealth(res.data.data);
        } else if (activeTab === 'report') {
          const res = await axios.get('/smart-guide/report');
          if (!cancelled) setReport(res.data.data);
        }
        loadedRef.current[activeTab] = true;
      } catch (err) {
        if (!cancelled) setError('Không thể tải dữ liệu. Vui lòng thử lại.');
        console.error('SmartGuide load error:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [activeTab]);

  const healthColor = (score) => {
    if (score >= 80) return '#059669';
    if (score >= 60) return '#d97706';
    if (score >= 40) return '#ea580c';
    return '#dc2626';
  };

  const priorityTag = (p) => {
    const map = { URGENT: 'red', HIGH: 'orange', MEDIUM: 'blue', LOW: 'default' };
    const label = { URGENT: 'GẤP', HIGH: 'Cao', MEDIUM: 'Vừa', LOW: 'Thấp' };
    return <Tag color={map[p]}>{label[p]}</Tag>;
  };

  /**
   * Tạo đề xuất nhập cho một dòng ⇒ sinh human-gate PENDING ở màn "Duyệt đề xuất nhập".
   *
   * Thêm 2026-10-16 — trước đây màn đó chỉ có thể đầy bằng cách chạy script ngoài
   * terminal. Nghĩa là trên trình duyệt không khởi động được luồng AI → người duyệt.
   *
   * Hai lỗi trả về là hành vi ĐÚNG, không phải lỗi:
   *   400 "SKU này chưa cần nhập"      — còn tồn, đề xuất là vô nghĩa
   *   409 "chưa có nhà cung cấp"        — hệ thống không được bịa NCC
   * Nên hiện nguyên văn thay vì báo chung chung "thất bại".
   */
  const handlePropose = async (row) => {
    const sku = row.sku || row.productId;
    setProposingSku(sku);
    try {
      await proposeReplenishment(row.productId || row.id);
      message.success(`Đã tạo đề xuất cho ${sku} — mở màn "Duyệt đề xuất nhập" để xem`);
      navigate('/agent-approvals');
    } catch (err) {
      const msg = err?.response?.data?.message || 'Không tạo được đề xuất';
      message.warning(msg);
    } finally {
      setProposingSku(null);
    }
  };

  // === PRICING TAB ===
  const pricingColumns = [
    { title: 'Sản phẩm', dataIndex: 'name', render: (v, r) => <div><Text strong>{v}</Text><br /><Text type="secondary" style={{ fontSize: 11 }}>SKU: {r.sku}</Text></div> },
    { title: 'Giá vốn', dataIndex: 'costPrice', align: 'right', render: (v) => <MoneyDisplay value={v} short /> },
    { title: 'Giá bán', dataIndex: 'price', align: 'right', render: (v) => <MoneyDisplay value={v} short /> },
    {
      title: 'Lãi',
      dataIndex: 'marginPercent',
      align: 'right',
      render: (v, r) => {
        if (r.costPrice === 0) return <Tag>Chưa có giá vốn</Tag>;
        if (v < 0) return <Tag color="red">{v}%</Tag>;
        if (v < 15) return <Tag color="orange">{v}%</Tag>;
        return <Tag color="green">{v}%</Tag>;
      },
    },
    {
      title: 'Giá đề xuất',
      dataIndex: 'suggestedPrice',
      align: 'right',
      render: (v) => v ? <Text type="success" strong><MoneyDisplay value={v} short /></Text> : '—',
    },
    {
      title: 'Cảnh báo',
      dataIndex: 'warnings',
      render: (warnings) => warnings.length === 0 ? <CheckCircleFilled style={{ color: '#059669' }} /> : warnings.map((w, i) => <div key={i}><Tag color={w.severity === 'HIGH' ? 'red' : 'orange'}>{w.message}</Tag></div>),
    },
  ];

  // === REORDER TAB ===
  const reorderColumns = [
    { title: 'Sản phẩm', dataIndex: 'productName', render: (v, r) => <div><Text strong>{v}</Text><br /><Text type="secondary" style={{ fontSize: 11 }}>SKU: {r.sku} · {r.category}</Text></div> },
    { title: 'Tồn', dataIndex: 'currentStock', align: 'center', render: (v, r) => <span style={{ color: v === 0 ? '#dc2626' : '#d97706', fontWeight: 600 }}>{v} / {r.minStock}</span> },
    { title: 'Bán/tuần', dataIndex: 'weeklySales', align: 'right', render: (v) => v > 0 ? v : '—' },
    {
      title: 'Đề xuất nhập',
      dataIndex: 'suggestedReorderQty',
      align: 'right',
      render: (v, r) => <Text strong>{v} {r.productName ? '' : ''}</Text>,
    },
    { title: 'NCC', dataIndex: 'suggestedVendor', render: (v) => v ? v.name : <Tag color="default">Chưa có</Tag> },
    { title: 'Ưu tiên', dataIndex: 'priority', align: 'center', render: (v) => priorityTag(v) },
    { title: 'Gợi ý', dataIndex: 'message', render: (v) => <Text style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{v}</Text> },
    {
      title: 'Hành động',
      align: 'right',
      render: (_v, r) => {
        const busy = proposingSku === (r.sku || r.productId);
        // Chỉ 7/105 dòng trong bộ demo có NCC. Hiện nút cho 98 dòng còn lại thì
        // người dùng bấm xong nhận 409 "chưa có nhà cung cấp" — nút chết.
        // Nên khoá và nói rõ lý do ngay tại chỗ.
        if (!r.suggestedVendor) {
          return (
            <Tooltip title="SKU này cần nhập nhưng chưa có nhà cung cấp — cần người chọn, hệ thống không tự bịa">
              <span>
                <Button size="small" disabled>
                  Tạo đề xuất
                </Button>
              </span>
            </Tooltip>
          );
        }
        return (
          <Button size="small" type="primary" loading={busy} onClick={() => handlePropose(r)}>
            Tạo đề xuất
          </Button>
        );
      },
    },
  ];

  // === HEALTH TAB ===
  const HealthGauge = ({ score, label, color }) => (
    <div style={{ textAlign: 'center', padding: '24px 0' }}>
      <Progress
        type="dashboard"
        percent={score}
        strokeColor={color}
        format={() => (
          <div>
            <div style={{ fontSize: 36, fontWeight: 800, color }}>{score}</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>/100</div>
          </div>
        )}
        size={200}
      />
      <Title level={3} style={{ color, marginTop: 12 }}>{label}</Title>
    </div>
  );

  return (
    <>
      <PageHeader title="Trợ lý kinh doanh" subtitle="Hướng dẫn thông minh giúp bạn quản lý shop dễ dàng hơn" />

      <Tabs activeKey={activeTab} onChange={setActiveTab} size="large"
        items={[
          { key: 'health', label: <span><HeartOutlined /> Sức khỏe shop</span> },
          { key: 'report', label: <span><FileTextOutlined /> Báo cáo nhanh</span> },
          { key: 'reorder', label: <span><ShoppingOutlined /> Nhập hàng {reorder?.suggestions?.length > 0 ? <Badge count={reorder.suggestions.length} size="small" offset={[4, -4]} style={{ backgroundColor: '#d97706' }} /> : null}</span> },
          { key: 'pricing', label: <span><DollarOutlined /> Giá bán {pricing?.summary?.belowCostCount > 0 ? <Badge count="!" size="small" offset={[4, -4]} style={{ backgroundColor: '#dc2626' }} /> : null}</span> },
        ]}
      />

      {loading ? (
        <div style={{ display: 'grid', placeItems: 'center', padding: 60 }}>
          <Spin size="large" tip="Đang phân tích dữ liệu..." />
        </div>
      ) : error ? (
        <Alert type="error" message="Lỗi tải dữ liệu" description={error} showIcon
          action={<Button onClick={() => { loadedRef.current = {}; setError(null); }}>Thử lại</Button>}
        />
      ) : (
        <>
          {/* HEALTH TAB */}
          {activeTab === 'health' && health && (
            <div>
              <Row gutter={[24, 16]}>
                <Col xs={24} md={10}>
                  <Card>
                    <HealthGauge score={health.score} label={health.label} color={health.color} />
                  </Card>
                </Col>
                <Col xs={24} md={14}>
                  <Card title="Chi tiết điểm số">
                    {Object.entries(health.breakdown).map(([key, val]) => (
                      <div key={key} style={{ marginBottom: 12 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                          <Text>{val.label}</Text>
                          <Text strong style={{ color: healthColor(val.score) }}>{val.score}/100</Text>
                        </div>
                        <Progress percent={(val.score / 100) * val.weight} strokeColor={healthColor(val.score)} showInfo={false} size="small" />
                      </div>
                    ))}
                  </Card>

                  <Card title="Cần làm gì?" style={{ marginTop: 16 }}>
                    {health.insights.length === 0 ? (
                      <Empty description="Mọi thứ đang ổn! Tiếp tục phát huy nhé." />
                    ) : (
                      health.insights.map((ins, i) => (
                        <Alert
                          key={i}
                          type="warning"
                          showIcon
                          message={`${ins.icon} ${ins.area}`}
                          description={ins.suggestion}
                          style={{ marginBottom: 8 }}
                        />
                      ))
                    )}
                  </Card>
                </Col>
              </Row>

              <Card title="Chỉ số tháng này" style={{ marginTop: 16 }}>
                <Row gutter={[16, 16]}>
                  <Col xs={12} sm={6}>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--primary)' }}>
                        <MoneyDisplay value={health.metrics.monthRevenue} short showCurrency={false} />
                      </div>
                      <Text type="secondary">Doanh thu</Text>
                    </div>
                  </Col>
                  <Col xs={12} sm={6}>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 24, fontWeight: 700, color: health.metrics.monthProfit >= 0 ? '#059669' : '#dc2626' }}>
                        <MoneyDisplay value={health.metrics.monthProfit} short showCurrency={false} />
                      </div>
                      <Text type="secondary">Lợi nhuận ({health.metrics.marginPercent}%)</Text>
                    </div>
                  </Col>
                  <Col xs={12} sm={6}>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--primary)' }}>
                        {health.metrics.monthRevenue > 0 ? `${health.metrics.growthPercent > 0 ? '+' : ''}${health.metrics.growthPercent}%` : '—'}
                      </div>
                      <Text type="secondary">Tăng trưởng</Text>
                    </div>
                  </Col>
                  <Col xs={12} sm={6}>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 24, fontWeight: 700, color: health.metrics.arOverdue > 0 ? '#dc2626' : '#059669' }}>
                        <MoneyDisplay value={health.metrics.arOverdue} short showCurrency={false} />
                      </div>
                      <Text type="secondary">Nợ quá hạn</Text>
                    </div>
                  </Col>
                </Row>
              </Card>
            </div>
          )}

          {/* REPORT TAB */}
          {activeTab === 'report' && report && (
            <Card>
              <div style={{ fontSize: 14, lineHeight: 2 }}>
                {report.narrative.map((line, i) => (
                  <div key={i} style={{ marginBottom: 8 }}>
                    {line.includes('**')
                      ? <span dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(line.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')) }} />
                      : <span>{line}</span>
                    }
                  </div>
                ))}
              </div>

              {report.urgentActions.length > 0 && (
                <div style={{ marginTop: 24 }}>
                  <Title level={5} style={{ color: '#d97706' }}>Việc cần làm ngay</Title>
                  {report.urgentActions.map((a, i) => (
                    <Alert
                      key={i}
                      type="warning"
                      showIcon
                      message={a.action}
                      description={a.detail}
                      action={<Button size="small" onClick={() => navigate(a.link)}>Xem ngay</Button>}
                      style={{ marginBottom: 8 }}
                    />
                  ))}
                </div>
              )}
            </Card>
          )}

          {/* REORDER TAB */}
          {activeTab === 'reorder' && reorder && (
            <>
              {reorder.summary.total > 0 && (
                <Alert
                  type={reorder.summary.urgentCount > 0 ? 'error' : 'warning'}
                  showIcon
                  message={
                    reorder.summary.urgentCount > 0
                      ? `Có ${reorder.summary.urgentCount} sản phẩm HẾT HÀNG — cần nhập gấp!`
                      : `${reorder.summary.total} sản phẩm sắp hết, ${reorder.summary.noVendorCount} chưa có nhà cung cấp`
                  }
                  style={{ marginBottom: 16 }}
                />
              )}
              <Table
                dataSource={reorder.suggestions}
                columns={reorderColumns}
                rowKey="productId"
                pagination={false}
                size="middle"
                locale={{ emptyText: <Empty description="Tất cả sản phẩm đều đủ hàng. Tốt lắm!" /> }}
              />
            </>
          )}

          {/* PRICING TAB */}
          {activeTab === 'pricing' && pricing && (
            <>
              {pricing.summary.belowCostCount > 0 || pricing.summary.lowMarginCount > 3 ? (
                <Alert
                  type={pricing.summary.belowCostCount > 0 ? 'error' : 'warning'}
                  showIcon
                  message={pricing.summary.healthLabel}
                  style={{ marginBottom: 16 }}
                />
              ) : (
                <Alert type="success" showIcon message={pricing.summary.healthLabel} style={{ marginBottom: 16 }} />
              )}
              <Table
                dataSource={pricing.products}
                columns={pricingColumns}
                rowKey="id"
                pagination={{ pageSize: 20 }}
                size="middle"
                locale={{ emptyText: <Empty description="Chưa có sản phẩm nào. Thêm sản phẩm đầu tiên!" /> }}
              />
            </>
          )}
        </>
      )}
    </>
  );
}
