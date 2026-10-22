/**
 * pages/EvidenceBacktest.jsx — BẰNG CHỨNG: VÌ SAO CHỌN ROP THAY VÌ NGƯỠNG CỐ ĐỊNH
 *
 * Màn hình này trả lời câu hỏi khó nhất khi giám khảo hỏi thí nghiệm:
 *   "Chứng minh đi bằng số đi — ROP có thật sự tốt hơn không?"
 *
 * NGUYÊN TẮC HIỂN THỊ (giữ đúng kỷ luật của `docs/aisc26/AI-HANDOVER.md`):
 *   1. Mọi con số đều kèm nguồn: tập dữ liệu + sha256 + cửa sổ đo.
 *   2. Phân biệt MÔ PHỎNG (backtest) với DỮ LIỆU THẬT (snapshot của tenant).
 *   3. KHÔNG kết luận "tốt hơn" nếu số không đủ. Nếu ROP giảm chi phí nhưng mất
 *      mức phục vụ thì nói thẳng là đánh đổi, không bịa lợi thế.
 *   4. Danh sách giới hạn hiện ngay trên đầu trang, không thu vào mục "chi tiết".
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Alert, Card, Col, Descriptions, Empty, Row, Select, Space, Spin,
  Statistic, Table, Tag, Tooltip, Typography, message,
} from 'antd';
import {
  ExperimentOutlined, FileTextOutlined, DatabaseOutlined,
  WarningOutlined, ReloadOutlined,
} from '@ant-design/icons';
import { getBacktestEvidence, getLiveSnapshot } from '../api/evidence';

const { Title, Text, Paragraph } = Typography;

const fmtInt = (v) => (v == null ? '—' : Number(v).toLocaleString('vi-VN'));
const fmtMoney = (v) =>
  v == null ? '—' : `${Number(v).toLocaleString('vi-VN', { maximumFractionDigits: 0 })}`;
const fmtSigned = (v, suffix = '') =>
  v == null ? '—' : `${v > 0 ? '+' : ''}${Number(v).toLocaleString('vi-VN')}${suffix}`;

const FAMILY_COLOR = { NGUONG_CO_DINH: 'default', ROP_THEO_CONG_THUC: 'green' };

export default function EvidenceBacktest() {
  const [data, setData] = useState(null);
  const [live, setLive] = useState(null);
  const [loading, setLoading] = useState(true);
  const [leadTime, setLeadTime] = useState(7);
  const [branch, setBranch] = useState('A');
  const [positionMode, setPositionMode] = useState('withOnOrder');

  const load = async (lt = leadTime, br = branch, pm = positionMode) => {
    setLoading(true);
    try {
      const [d, l] = await Promise.all([
        getBacktestEvidence({ leadTime: lt, branch: br, positionMode: pm }),
        getLiveSnapshot().catch(() => null),
      ]);
      setData(d);
      setLive(l);
    } catch (e) {
      message.error(e.response?.data?.message || 'Không tải được bằng chứng');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(leadTime, branch, positionMode); /* eslint-disable-next-line */ }, []);

  const policies = useMemo(
    () => (data?.policies ? Object.values(data.policies) : []),
    [data],
  );
  const comparison = data?.comparison;

  const columns = [
    {
      title: 'Phương án',
      dataIndex: 'nameVi',
      key: 'nameVi',
      fixed: 'left',
      width: 260,
      render: (v, r) => (
        <Space direction="vertical" size={0}>
          <Space size={6}>
            <Tag color={FAMILY_COLOR[r.family]}>{r.key}</Tag>
            <Text strong>{v}</Text>
          </Space>
          <Text type="secondary" style={{ fontSize: 12 }}>{r.how}</Text>
        </Space>
      ),
    },
    {
      title: 'Mức phục vụ',
      dataIndex: 'fillRate',
      key: 'fillRate',
      align: 'right',
      sorter: (a, b) => a.fillRate - b.fillRate,
      render: (v, r) => (
        <Space direction="vertical" size={0} style={{ alignItems: 'flex-end' }}>
          <Text strong>{v}%</Text>
          {r.constraintInfeasible && (
            <Tooltip title="Không đạt được mức phục vụ tối thiểu trong kịch bản này">
              <Tag color="warning" style={{ marginInlineEnd: 0 }}>dưới ngưỡng</Tag>
            </Tooltip>
          )}
        </Space>
      ),
    },
    {
      title: 'Tồn kho TB',
      dataIndex: 'avgInventoryValue',
      key: 'avgInventoryValue',
      align: 'right',
      sorter: (a, b) => a.avgInventoryValue - b.avgInventoryValue,
      render: (v) => fmtMoney(v),
    },
    {
      title: 'Giá trị thiếu hàng',
      dataIndex: 'lostValue',
      key: 'lostValue',
      align: 'right',
      sorter: (a, b) => a.lostValue - b.lostValue,
      render: (v, r) => (
        <Space direction="vertical" size={0} style={{ alignItems: 'flex-end' }}>
          <Text>{fmtMoney(v)}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>{fmtInt(r.lostUnits)} cái</Text>
        </Space>
      ),
    },
    {
      title: 'Tổng chi phí',
      dataIndex: 'totalCost',
      key: 'totalCost',
      align: 'right',
      sorter: (a, b) => a.totalCost - b.totalCost,
      render: (v) => <Text strong>{fmtMoney(v)}</Text>,
    },
    {
      title: 'Số đơn đặt',
      dataIndex: 'orderCount',
      key: 'orderCount',
      align: 'right',
      sorter: (a, b) => a.orderCount - b.orderCount,
      render: (v) => fmtInt(v),
    },
  ];

  return (
    <div style={{ padding: 16 }}>
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        {/* TIÊU ĐỀ */}
        <div>
          <Title level={4} style={{ margin: 0 }}>
            <ExperimentOutlined /> Bằng chứng thực nghiệm — chính sách tồn kho
          </Title>
          <Paragraph type="secondary" style={{ margin: '4px 0 0' }}>
            So sánh ROP của hệ thống với ngưỡng cố định trên tập dữ liệu công khai.
            Mọi con số dưới đây là <b>mô phỏng</b>, không phải kết quả trên doanh nghiệp thật.
          </Paragraph>
        </div>

        {/* GIỚI HẠN — đặt trên cùng, không thu vào chi tiết */}
        {data?.caveats?.length > 0 && (
          <Alert
            type="warning"
            showIcon
            icon={<WarningOutlined />}
            message="Giới hạn của số liệu này — đọc trước khi trích dẫn"
            description={
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {data.caveats.map((c) => <li key={c}><Text style={{ fontSize: 13 }}>{c}</Text></li>)}
              </ul>
            }
          />
        )}

        {/* SỐ ĐO THẬT của doanh nghiệp đang chạy */}
        {live && (
          <Card size="small" title={<><DatabaseOutlined /> Số đo trên dữ liệu doanh nghiệp đang chạy</>}>
            <Text type="secondary" style={{ fontSize: 13 }}>
              Phần này đọc thẳng ERP của tenant đang đăng nhập — KHÔNG mô phỏng.
            </Text>
            <Row gutter={16} style={{ marginTop: 12 }}>
              <Col span={6}><Statistic title="SKU đang kinh doanh" value={fmtInt(live.activeSkus)} /></Col>
              <Col span={6}><Statistic title="SKU dưới ngưỡng tối thiểu" value={fmtInt(live.belowMinStock)} valueStyle={{ color: live.belowMinStock > 0 ? '#faad14' : undefined }} /></Col>
              <Col span={6}><Statistic title="SKU hết hàng (ATP ≤ 0)" value={fmtInt(live.zeroStock)} valueStyle={{ color: live.zeroStock > 0 ? '#cf1322' : undefined }} /></Col>
              <Col span={6}><Statistic title="PO đang mở" value={fmtInt(live.openPurchaseOrders)} /></Col>
            </Row>
          </Card>
        )}

        <Spin spinning={loading}>
          {!data?.available ? (
            <Card>
              <Empty description={data?.reason || 'Chưa có dữ liệu'} />
            </Card>
          ) : (
            <>
              {/* THAM SỐ + NGUỒN */}
              <Card
                size="small"
                title={<><FileTextOutlined /> Kịch bản đo</>}
                extra={
                  <Space wrap>
                    <Select
                      size="small" value={leadTime} style={{ width: 150 }}
                      onChange={(v) => { setLeadTime(v); load(v, branch, positionMode); }}
                      options={(data.availableLeadTimes || [3, 7, 14]).map((x) => ({
                        value: x, label: `Thời gian nhập ${x} ngày`,
                      }))}
                    />
                    <Select
                      size="small" value={branch} style={{ width: 170 }}
                      onChange={(v) => { setBranch(v); load(leadTime, v, positionMode); }}
                      options={(data.availableBranches || ['A']).map((x) => ({
                        value: x, label: `Nhánh ${x}`,
                      }))}
                    />
                    <Select
                      size="small" value={positionMode} style={{ width: 180 }}
                      onChange={(v) => { setPositionMode(v); load(leadTime, branch, v); }}
                      options={(data.availablePositionModes || ['withOnOrder']).map((x) => ({
                        value: x, label: x === 'withOnOrder' ? 'Tính cả đang đặt' : 'Chỉ tồn khả dụng',
                      }))}
                    />
                    <Tooltip title="Tải lại"><ReloadOutlined onClick={() => load(leadTime, branch, positionMode)} /></Tooltip>
                  </Space>
                }
              >
                <Descriptions size="small" column={{ xs: 1, md: 3 }} bordered>
                  <Descriptions.Item label="Tập dữ liệu">
                    UCI Online Retail II (CC BY 4.0)
                  </Descriptions.Item>
                  <Descriptions.Item label="SHA-256 tệp nguồn">
                    <Text code style={{ fontSize: 11 }}>
                      {data.source?.sha256?.slice(0, 16)}…
                    </Text>
                  </Descriptions.Item>
                  <Descriptions.Item label="Số SKU đo">{fmtInt(data.params?.skuCount)}</Descriptions.Item>
                  <Descriptions.Item label="Cửa sổ kiểm tra">
                    {data.window?.testStartDate} → {data.window?.testEndDate}
                  </Descriptions.Item>
                  <Descriptions.Item label="Huấn luyện đến">{data.window?.trainEndDate}</Descriptions.Item>
                  <Descriptions.Item label="Thí nghiệm">
                    #{data.experiment} — {data.label}
                  </Descriptions.Item>
                </Descriptions>
              </Card>

              {/* KẾT LUẬN SO SÁNH */}
              {comparison && (
                <Alert
                  type={comparison.deltaFillRate < 0 ? 'info' : 'success'}
                  showIcon
                  message={
                    <Space wrap>
                      <Text strong>
                        {comparison.baselineName} → {comparison.systemName}
                      </Text>
                      <Tag>mức phục vụ {fmtSigned(comparison.deltaFillRate, ' điểm')}</Tag>
                      <Tag>tổng chi phí {fmtSigned(comparison.deltaTotalCostPct, '%')}</Tag>
                      <Tag>tồn kho {fmtSigned(comparison.deltaInventoryValuePct, '%')}</Tag>
                    </Space>
                  }
                  description={
                    <Space direction="vertical" size={4}>
                      <Text>{comparison.verdict}</Text>
                      <Text type="secondary" style={{ fontSize: 13 }}>
                        Chỉ số thay đổi khi đổi phương án, KHÔNG phải lợi nhuận: tồn kho giảm
                        thì tiền khóa trong hàng, mức phục vụ giảm thì mất đơn.
                      </Text>
                    </Space>
                  }
                />
              )}

              {/* BẢNG SO SÁNH */}
              <Card size="small" title="Kết quả từng phương án">
                <Table
                  size="small"
                  rowKey="key"
                  dataSource={policies}
                  columns={columns}
                  pagination={false}
                  scroll={{ x: 980 }}
                  rowClassName={(r) => (r.family === 'ROP_THEO_CONG_THUC' ? 'row-rop' : 'row-fixed')}
                />
                <Paragraph type="secondary" style={{ fontSize: 12, marginTop: 8, marginBottom: 0 }}>
                  Tiền tính bằng sterling của tập dữ liệu, không quy đổi. “Tổng chi phí” =
                  giá trị tồn kho + giá trị hàng thiếu + giá vốn hàng bán, do bộ mô phỏng
                  tự tính. Các ngưỡng khác nhau không so sánh trực tiếp được nếu chưa
                  cùng một ràng buộc mức phục vụ.
                </Paragraph>
              </Card>
            </>
          )}
        </Spin>
      </Space>
    </div>
  );
}