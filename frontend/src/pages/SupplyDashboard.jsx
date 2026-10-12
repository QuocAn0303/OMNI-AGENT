/**
 * pages/SupplyDashboard.jsx — DASHBOARD CHUỖI CUNG ỨNG
 *
 * Mọi số ở đây đọc thẳng từ dữ liệu doanh nghiệp đang chạy, KHÔNG mô phỏng.
 *
 * NGUYÊN TẮC hiển thị — quan trọng hơn vẻ đẹp:
 *   1. `null` (chưa đủ dữ liệu) hiện bằng "chưa đủ dữ liệu" + lý do, KHÔNG
 *      hiện 0. Một ô "0 vòng quay" đọc ra như "vòng quay bằng không" — sai hoàn
 *      toàn, trong khi sự thật là chưa có dữ liệu để tính.
 *   2. Mọi nhóm chỉ số có nút "?" hiện `note` của backend: cách tính và giới hạn.
 *   3. Số tiền tôn trọng đơn vị của dữ liệu, không tự quy đổi.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  Alert, App, Card, Col, Progress, Row, Select, Space, Spin, Statistic,
  Table, Tag, Tooltip, Typography,
} from 'antd';
import {
  DashboardOutlined, QuestionCircleOutlined, WarningOutlined,
  ClockCircleOutlined,
} from '@ant-design/icons';
import { getSupplyKpis } from '../api/supply';

const { Title, Text, Paragraph } = Typography;

const fmtMoney = (v) =>
  v == null ? '—' : `${Number(v).toLocaleString('vi-VN', { maximumFractionDigits: 0 })}`;
const fmtNum = (v) => (v == null ? '—' : Number(v).toLocaleString('vi-VN'));
const fmtPct = (v) => (v == null ? null : `${Number(v).toFixed(2)}%`);

/** Ô số: nếu `null` thì nói rõ chưa đủ dữ liệu thay vì in 0. */
function Value({ value, money, suffix }) {
  if (value === null || value === undefined) {
    return (
      <Tooltip title="Chưa đủ dữ liệu để tính chỉ số này">
        <Text type="secondary">
          chưa đủ dữ liệu <QuestionCircleOutlined style={{ fontSize: 11 }} />
        </Text>
      </Tooltip>
    );
  }
  return <Text strong>{money ? fmtMoney(value) : fmtNum(value)}{suffix}</Text>;
}

/** Thẻ chỉ số kèm chú thích cách tính. */
function Kpi({ title, value, money, suffix, note, color, extra }) {
  return (
    <Card size="small" style={{ height: '100%' }}>
      <Statistic
        title={
          <Space size={4}>
            {title}
            {note && (
              <Tooltip title={note}>
                <QuestionCircleOutlined style={{ fontSize: 12 }} />
              </Tooltip>
            )}
          </Space>
        }
        valueRender={() => <Value value={value} money={money} suffix={suffix} />}
        valueStyle={{ fontSize: 22, color }}
      />
      {extra}
    </Card>
  );
}

export default function SupplyDashboard() {
  const { message } = App.useApp();
  const [d, setD] = useState(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);

  const load = useCallback(async (d2 = days) => {
    setLoading(true);
    try {
      setD(await getSupplyKpis(d2));
    } catch (e) {
      message.error(e.response?.data?.message || 'Không tải được số liệu chuỗi cung ứng');
    } finally {
      setLoading(false);
    }
  }, [days, message]);

  useEffect(() => { load(days); }, []); // eslint-disable-line

  const stockRows = (d?.byWarehouse || []).map((w) => ({
    key: w.id,
    code: w.code,
    name: w.name,
    value: w.value,
    share: d.inventory.stockValue > 0 ? (w.value / d.inventory.stockValue) * 100 : 0,
  }));

  return (
    <div style={{ padding: 16 }}>
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Row align="middle">
          <Col span={16}>
            <Title level={4} style={{ margin: 0 }}>
              <DashboardOutlined /> Chuỗi cung ứng — chỉ số vận hành
            </Title>
            <Paragraph type="secondary" style={{ margin: '4px 0 0' }}>
              Toàn bộ số liệu đọc từ dữ liệu doanh nghiệp đang chạy, không mô phỏng.
              Chỉ số chưa đủ dữ liệu được ghi là “chưa đủ dữ liệu” chứ không ghi 0.
            </Paragraph>
          </Col>
          <Col span={8}>
            <Space style={{ float: 'right' }}>
              <Select
                value={days} style={{ width: 160 }}
                onChange={(v) => { setDays(v); load(v); }}
                options={[
                  { value: 7, label: '7 ngày' },
                  { value: 30, label: '30 ngày' },
                  { value: 90, label: '90 ngày' },
                  { value: 180, label: '180 ngày' },
                ]}
              />
            </Space>
          </Col>
        </Row>

        <Spin spinning={loading}>
          {d && (
            <>
              <Row gutter={[12, 12]}>
                <Col xs={12} md={6}>
                  <Kpi
                    title="Giá trị tồn kho" value={d.inventory.stockValue} money
                    note={d.inventory.note}
                    extra={<Text type="secondary" style={{ fontSize: 12 }}>
                      {fmtNum(d.inventory.skus)} SKU · tồn khả dụng {fmtNum(d.inventory.atpUnits)}
                    </Text>}
                  />
                </Col>
                <Col xs={12} md={6}>
                  <Kpi
                    title="Số ngày phủ tồn" value={d.velocity.daysOfCover} suffix=" ngày"
                    note={d.velocity.note}
                    extra={d.velocity.turnoverPerYear != null && (
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        ≈ {d.velocity.turnoverPerYear} vòng/năm
                      </Text>
                    )}
                  />
                </Col>
                <Col xs={12} md={6}>
                  <Kpi
                    title="Tồn chết (90 ngày không bán)" value={d.slowMoving.value} money
                    color={d.slowMoving.shareOfStock > 30 ? '#fa8c16' : undefined}
                    note={d.slowMoving.note}
                    extra={d.slowMoving.shareOfStock != null && (
                      <Progress
                        percent={Number(d.slowMoving.shareOfStock.toFixed(1))}
                        size="small"
                        status={d.slowMoving.shareOfStock > 30 ? 'exception' : 'normal'}
                      />
                    )}
                  />
                </Col>
                <Col xs={12} md={6}>
                  <Kpi
                    title="SKU đang hết hàng" value={d.stockouts.skusAtZero}
                    color={d.stockouts.skusAtZero > 0 ? '#cf1322' : '#3f8600'}
                    note={d.stockouts.note}
                    extra={d.stockouts.share != null && (
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {fmtPct(d.stockouts.share)} tổng số SKU
                      </Text>
                    )}
                  />
                </Col>
              </Row>

              <Row gutter={[12, 12]}>
                <Col xs={12} md={6}>
                  <Kpi
                    title="Đơn mua đang mở" value={d.purchasing.openCount}
                    note={d.purchasing.note}
                    extra={<Text type="secondary" style={{ fontSize: 12 }}>
                      {fmtMoney(d.purchasing.openValue)} đ
                    </Text>}
                  />
                </Col>
                <Col xs={12} md={6}>
                  <Kpi
                    title="PO quá hạn giao hàng" value={d.purchasing.overdueCount}
                    color={d.purchasing.overdueCount > 0 ? '#fa541c' : '#3f8600'}
                    note="Đã quá ngày giao dự kiến mà chưa có phiếu nhập kho."
                    extra={d.purchasing.overdueCount > 0 && (
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {fmtMoney(d.purchasing.overdueValue)} đ
                      </Text>
                    )}
                  />
                </Col>
                <Col xs={12} md={6}>
                  <Kpi
                    title="Giao đúng hạn (OTIF)" value={d.supplierDelivery.onTimeRate} suffix="%"
                    color={d.supplierDelivery.onTimeRate == null ? undefined
                      : d.supplierDelivery.onTimeRate >= 90 ? '#3f8600' : '#fa8c16'}
                    note={d.supplierDelivery.note}
                    extra={d.supplierDelivery.gradedCount > 0 && (
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        trên {d.supplierDelivery.gradedCount}/{d.supplierDelivery.receivedCount} phiếu nhận
                      </Text>
                    )}
                  />
                </Col>
                <Col xs={12} md={6}>
                  <Kpi
                    title="Mua hàng trong kỳ" value={d.purchasing.createdValue} money
                    note="Tổng giá trị đơn mua phát sinh trong kỳ so với kỳ trước."
                    extra={d.purchasing.changePct != null && (
                      <Text
                        type="secondary"
                        style={{ fontSize: 12, color: d.purchasing.changePct > 0 ? '#fa541c' : '#3f8600' }}
                      >
                        {d.purchasing.changePct > 0 ? '▲' : '▼'} {Math.abs(d.purchasing.changePct)}% so với kỳ trước
                      </Text>
                    )}
                  />
                </Col>
              </Row>

              {d.supplierDelivery.onTimeRate === null && (
                <Alert
                  type="info"
                  showIcon
                  icon={<WarningOutlined />}
                  message="Chưa tính được tỷ lệ giao đúng hạn"
                  description={
                    <>
                      {d.supplierDelivery.note} Để có chỉ số này, khi tạo đơn mua hãy chốt
                      <b> ngày giao hàng dự kiến</b> — hệ thống sẽ tự so với ngày phiếu nhập kho thực tế.
                    </>
                  }
                />
              )}

              {d.purchasing.overdue.length > 0 && (
                <Card size="small" title={<><ClockCircleOutlined /> Đơn mua quá hạn</>}>
                  <Table
                    size="small" rowKey="id" pagination={false} dataSource={d.purchasing.overdue}
                    columns={[
                      { title: 'Mã đơn', dataIndex: 'poCode', width: 170 },
                      { title: 'Trễ (ngày)', dataIndex: 'daysLate', align: 'right', width: 110,
                        render: (v) => <Tag color="error">{v}</Tag> },
                      { title: 'Ngày giao dự kiến', dataIndex: 'expectedAt',
                        render: (v) => new Date(v).toLocaleDateString('vi-VN') },
                      { title: 'Giá trị', dataIndex: 'total', align: 'right',
                        render: (v) => <Text strong>{fmtMoney(v)} đ</Text> },
                    ]}
                  />
                </Card>
              )}

              {stockRows.length > 0 && (
                <Card size="small" title="Vốn tiền nằm trong từng kho">
                  <Table
                    size="small" rowKey="key" pagination={false} dataSource={stockRows}
                    columns={[
                      { title: 'Kho', dataIndex: 'name', render: (v, r) => `${r.code} — ${v}` },
                      { title: 'Giá trị', dataIndex: 'value', align: 'right', width: 170,
                        render: (v) => <Text strong>{fmtMoney(v)} đ</Text> },
                      {
                        title: 'Tỷ trọng', dataIndex: 'share', align: 'right', width: 220,
                        render: (v) => <Progress percent={Number(v.toFixed(1))} size="small" />,
                      },
                    ]}
                  />
                </Card>
              )}
            </>
          )}
        </Spin>
      </Space>
    </div>
  );
}