/**
 * pages/RfqQuotation.jsx — SO SÁNH BÁO GIÁ NHÀ CUNG CẤP
 *
 * Tương ứng bước "Request for Quotation" của Odoo — mà trước đây Aduu ERP
 * không có: hệ thống tự chọn NCC từ PO gần nhất rồi tạo PO thẳng.
 *
 * NGUYÊN TẮC hiển thị:
 *   1. Báo giá THIẾU DÒNG không được xếp hạng — hiện rõ là "chưa đủ giá", vì
 *      tổng tiền thiếu dòng sẽ nhỏ đi và làm NCC đó trông rẻ giả.
 *   2. Rẻ nhất ≠ nên chọn. Luôn hiện điểm giao hàng (OTIF) của NCC cạnh giá,
 *      và cảnh báo bằng lời.
 *   3. NCC báo thiếu hàng ⇒ PO chỉ tạo phần NCC thực sự có, và giao diện nói
 *      rõ TRƯỚC khi chốt để người dùng không tưởng mua đủ.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, App, Button, Card, Col, DatePicker, Empty, Form, Input, InputNumber,
  Modal, Row, Select, Space, Statistic, Table, Tag, Tooltip, Typography, message,
} from 'antd';
import {
  ReloadOutlined, TrophyOutlined, WarningOutlined,
  FileTextOutlined, CheckCircleOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  listRFQs, getRFQComparison, recordQuote, declineQuote, awardRFQ,
} from '../api/rfq';

const { Title, Text, Paragraph } = Typography;

const fmtMoney = (v) =>
  v == null ? '—' : Number(v).toLocaleString('vi-VN', { maximumFractionDigits: 0 });

const QUOTE_STATUS = {
  PENDING: { label: 'Chờ báo giá', color: 'default' },
  QUOTED: { label: 'Đã báo giá', color: 'blue' },
  DECLINED: { label: 'Từ chối', color: 'red' },
  SELECTED: { label: 'Đã chọn', color: 'green' },
};

export default function RfqQuotation() {
  const { modal } = App.useApp();
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [cmp, setCmp] = useState(null);
  const [cmpLoading, setCmpLoading] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [quoteModal, setQuoteModal] = useState(null);
  const [quoteForm] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await listRFQs({ limit: 50 });
      setList(r.rfqs || []);
      setSelectedId((prev) => prev || r.rfqs?.[0]?.id || null);
    } catch (e) {
      message.error(e.response?.data?.message || 'Không tải được danh sách RFQ');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadCmp = useCallback(async (id) => {
    if (!id) return;
    setCmpLoading(true);
    try {
      setCmp(await getRFQComparison(id));
    } catch (e) {
      message.error(e.response?.data?.message || 'Không tải được bảng so sánh');
      setCmp(null);
    } finally {
      setCmpLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadCmp(selectedId); }, [selectedId, loadCmp]);

  const refreshAll = () => { load(); loadCmp(selectedId); };

  const openQuote = (quote) => {
    setQuoteModal(quote);
    quoteForm.setFieldsValue({
      lines: (cmp?.items || []).map((it) => ({
        rfqItemId: it.id,
        description: it.product?.sku || it.description,
        quantity: it.quantity,
        unitCost: null,
        availableQty: it.quantity,
      })),
      promisedAt: null,
      note: null,
    });
  };

  const saveQuote = async () => {
    const v = await quoteForm.validateFields();
    const lines = (v.lines || [])
      .filter((l) => l.unitCost != null && Number(l.unitCost) > 0)
      .map((l) => ({
        rfqItemId: l.rfqItemId,
        unitCost: Number(l.unitCost),
        availableQty: l.availableQty == null ? null : Number(l.availableQty),
      }));
    if (!lines.length) {
      message.error('Cần nhập đơn giá ít nhất một dòng');
      return;
    }
    try {
      await recordQuote(quoteModal.rfqId, quoteModal.vendorId, {
        lines,
        promisedAt: v.promisedAt ? dayjs(v.promisedAt).toISOString() : null,
        note: v.note || null,
      });
      message.success('Đã ghi nhận báo giá');
      setQuoteModal(null);
      loadCmp(selectedId);
    } catch (e) {
      message.error(e.response?.data?.message || 'Lỗi ghi báo giá');
    }
  };

  /** NCC từ chối — bắt buộc có lý do để sau giải thích được. */
  const declineQuoteFlow = (q) => {
    let reason = '';
    modal.confirm({
      title: `Từ chối báo giá của ${q.vendorName}?`,
      content: (
        <Input.TextArea
          rows={3}
          placeholder="Bắt buộc: ghi lý do từ chối để đối chiếu sau"
          onChange={(e) => { reason = e.target.value; }}
        />
      ),
      okText: 'Xác nhận từ chối',
      okButtonProps: { danger: true },
      onOk: async () => {
        if (!reason.trim()) {
          message.error('Cần ghi lý do từ chối');
          return Promise.reject(new Error('thiếu lý do'));
        }
        await declineQuote(selectedId, q.vendorId, reason.trim());
        message.success('Đã ghi nhận từ chối');
        loadCmp(selectedId);
      },
    });
  };

  const award = (quote) => {
    const short = (quote.lines || []).filter((l) => l.short);
    modal.confirm({
      title: `Chốt ${quote.vendorName}?`,
      width: 520,
      content: (
        <Space direction="vertical" size={4} style={{ width: '100%' }}>
          <Text>Tổng báo giá: <b>{fmtMoney(quote.total)}</b></Text>
          {short.length > 0 && (
            <Alert
              type="warning" showIcon style={{ marginTop: 8 }}
              message="Nhà cung cấp không giao đủ số lượng"
              description={
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {short.map((l) => (
                    <li key={l.rfqItemId}>
                      {l.description || l.productId}: nhận {fmtMoney(l.availableQty)}/{fmtMoney(l.quantity)}
                    </li>
                  ))}
                </ul>
              }
            />
          )}
          <Text type="secondary" style={{ fontSize: 12 }}>
            Hệ thống chỉ tạo đơn mua cho phần NCC thực sự có, không tự đặt đủ số lượng.
          </Text>
        </Space>
      ),
      okText: 'Chốt và tạo đơn mua',
      onOk: async () => {
        const r = await awardRFQ(selectedId, quote.vendorId);
        message.success(`Đã tạo đơn mua ${r.purchaseOrder?.poCode || ''}`);
        refreshAll();
      },
    });
  };

  const quoteColumns = useMemo(() => ([
    {
      title: 'Nhà cung cấp',
      key: 'vendor',
      fixed: 'left',
      width: 220,
      render: (_, q) => (
        <Space direction="vertical" size={2}>
          <Space size={6}>
            {q.rank === 1 && <TrophyOutlined style={{ color: '#faad14' }} />}
            <Text strong>{q.vendorName}</Text>
          </Space>
          <Space size={6} wrap>
            <Tag color={QUOTE_STATUS[q.status]?.color}>{QUOTE_STATUS[q.status]?.label || q.status}</Tag>
            {q.vendorGrade && <Tag>{q.vendorGrade}</Tag>}
            {q.otifScore != null && (
              <Tooltip title="Tỷ lệ giao đúng hạn của nhà cung cấp (OTIF)">
                <Text type="secondary" style={{ fontSize: 12 }}>
                  OTIF {Math.round(q.otifScore)}%
                </Text>
              </Tooltip>
            )}
          </Space>
        </Space>
      ),
    },
    {
      title: 'Tổng tiền',
      dataIndex: 'total',
      key: 'total',
      align: 'right',
      width: 180,
      render: (v, q) => (
        <Space direction="vertical" size={0} style={{ alignItems: 'flex-end' }}>
          {v == null ? (
            <Tag color="warning" icon={<WarningOutlined />}>
              Thiếu giá {q.pricedLineCount}/{q.totalLineCount} dòng
            </Tag>
          ) : (
            <>
              <Text strong style={{ fontSize: 15 }}>{fmtMoney(v)}</Text>
              {q.rank === 1 && <Tag color="gold">Rẻ nhất</Tag>}
              {q.rank > 1 && (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  +{q.savingVsCheapestPct}% so với rẻ nhất
                </Text>
              )}
            </>
          )}
        </Space>
      ),
    },
    {
      title: 'Ngày giao hàng',
      dataIndex: 'promisedAt',
      key: 'promisedAt',
      align: 'center',
      width: 130,
      render: (v) => (v ? dayjs(v).format('DD/MM/YYYY') : <Text type="secondary">—</Text>),
    },
    {
      title: 'Thiếu hàng',
      key: 'short',
      width: 110,
      render: (_, q) => {
        const short = (q.lines || []).filter((l) => l.short).length;
        return short ? <Tag color="warning">{short} dòng</Tag> : <Text type="secondary">—</Text>;
      },
    },
    {
      title: '',
      key: 'act',
      fixed: 'right',
      width: 150,
      render: (_, q) => (
        <Space direction="vertical" size={4}>
          {q.status === 'PENDING' && (
            <Button size="small" type="link" onClick={() => openQuote(q)}>Nhập báo giá</Button>
          )}
          {q.status === 'QUOTED' && !q.incomplete && (
            <Button size="small" type="link" danger onClick={() => declineQuoteFlow(q)}>
              Từ chối
            </Button>
          )}
          {q.status === 'QUOTED' && !q.incomplete && (
            <Button size="small" type="primary" icon={<CheckCircleOutlined />} onClick={() => award(q)}>
              Chốt
            </Button>
          )}
        </Space>
      ),
    },
  ]), [cmp]);

  return (
    <div style={{ padding: 16 }}>
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>
            <FileTextOutlined /> So sánh báo giá nhà cung cấp
          </Title>
          <Paragraph type="secondary" style={{ margin: '4px 0 0' }}>
            Hỏi giá nhiều nhà cung cấp cùng lúc, so sánh tổng tiền và độ tin cậy giao hàng,
            rồi mới chốt. Trước đây hệ thống tự chọn nhà cung cấp từ đơn mua gần nhất.
          </Paragraph>
        </div>

        <Row gutter={12} align="middle">
          <Col span={8}>
            <Card size="small" title="Chọn RFQ">
              <Select
                style={{ width: '100%' }}
                value={selectedId}
                onChange={setSelectedId}
                loading={loading}
                options={list.map((r) => ({
                  value: r.id,
                  label: `${r.rfqCode} · ${r.items?.length || 0} dòng · ${r.quotes?.length || 0} NCC`,
                }))}
              />
            </Card>
          </Col>
          <Col span={4}><Statistic title="RFQ đang mở" value={list.filter((r) => r.status === 'OPEN').length} /></Col>
          <Col span={4}><Statistic title="Đã chốt" value={list.filter((r) => r.status === 'AWARDED').length} /></Col>
          <Col span={4}>
            <Button icon={<ReloadOutlined />} onClick={refreshAll}>Tải lại</Button>
          </Col>
        </Row>

        {!cmp ? (
          <Card><Empty description="Chọn một RFQ để xem bảng so sánh" /></Card>
        ) : (
          <>
            <Alert
              type="info"
              showIcon
              message={cmp.caveat}
              description={`RFQ ${cmp.rfq.rfqCode} — ${cmp.items.length} dòng hàng, ${cmp.quotes.length} nhà cung cấp được hỏi.`}
            />

            {cmp.rfq.status === 'AWARDED' && (
              <Alert
                type="success"
                showIcon
                message="RFQ đã chốt — không thể chốt lại nhà cung cấp khác"
                description="Muốn đổi nhà cung cấp thì phải huỷ đơn mua đã tạo trước."
              />
            )}

            <Card size="small" title="Bảng so sánh">
              <Table
                size="small"
                rowKey="quoteId"
                dataSource={cmp.quotes}
                columns={quoteColumns}
                loading={cmpLoading}
                pagination={false}
                scroll={{ x: 900 }}
                expandable={{
                  expandedRowRender: (q) => (
                    <Table
                      size="small" rowKey="rfqItemId" pagination={false}
                      dataSource={q.lines || []}
                      columns={[
                        { title: 'Hàng', dataIndex: 'description', render: (v) => v || '—' },
                        { title: 'Số lượng cần', dataIndex: 'quantity', align: 'right', render: (v) => fmtMoney(v) },
                        { title: 'Đơn giá', dataIndex: 'unitCost', align: 'right', render: (v) => fmtMoney(v) },
                        { title: 'Thành tiền', dataIndex: 'lineTotal', align: 'right', render: (v) => <Text strong>{fmtMoney(v)}</Text> },
                        {
                          title: 'NCC giao được',
                          dataIndex: 'availableQty',
                          align: 'right',
                          render: (v, r) => (r.short
                            ? <Tag color="warning">{fmtMoney(v)}/{fmtMoney(r.quantity)}</Tag>
                            : <Text type="secondary">đủ</Text>),
                        },
                      ]}
                    />
                  ),
                }}
              />
            </Card>

            {cmp.ranking.length > 0 && (
              <Card size="small" title="Nhà cung cấp hứa giao tốt nhất (độ tin cậy giao hàng)">
                <Space wrap>
                  {cmp.ranking
                    .slice()
                    .sort((a, b) => (b.otifScore ?? 0) - (a.otifScore ?? 0))
                    .map((r) => (
                      <Tag key={r.quoteId} color="blue">
                        {r.vendorName}:{' '}
                        {r.otifScore != null ? `giao đúng hạn ${Math.round(r.otifScore)}%` : 'chưa có dữ liệu OTIF'}
                      </Tag>
                    ))}
                </Space>
              </Card>
            )}
          </>
        )}
      </Space>

      <Modal
        open={!!quoteModal}
        title={quoteModal ? `Nhập báo giá — ${quoteModal.vendorName}` : ''}
        onCancel={() => setQuoteModal(null)}
        onOk={saveQuote}
        okText="Lưu báo giá"
        cancelText="Huỷ"
        width={780}
      >
        <Form form={quoteForm} layout="vertical">
          <Table
            size="small" rowKey="rfqItemId" pagination={false}
            dataSource={cmp?.items || []}
            columns={[
              {
                title: 'Hàng',
                render: (_, it) => (
                  <Space direction="vertical" size={0}>
                    <Text>{it.product?.sku || it.description || '—'}</Text>
                    {it.product?.name && (
                      <Text type="secondary" style={{ fontSize: 12 }}>{it.product.name}</Text>
                    )}
                  </Space>
                ),
              },
              { title: 'Cần mua', dataIndex: 'quantity', align: 'right', render: (v) => fmtMoney(v) },
              {
                title: 'Đơn giá',
                align: 'right',
                render: (_, it, i) => (
                  <Form.Item
                    name={['lines', i, 'unitCost']}
                    noStyle
                    rules={[{ required: true, message: 'Nhập đơn giá' }]}
                  >
                    <InputNumber min={1} style={{ width: 140 }} placeholder="đơn giá" />
                  </Form.Item>
                ),
              },
              {
                title: 'NCC giao được',
                align: 'right',
                render: (_, it, i) => (
                  <Form.Item name={['lines', i, 'availableQty']} noStyle>
                    <InputNumber min={0} style={{ width: 110 }} placeholder={it.quantity} />
                  </Form.Item>
                ),
              },
            ]}
          />
          <Space style={{ marginTop: 16 }} align="start">
            <Form.Item label="Ngày hứa giao" name="promisedAt" style={{ marginBottom: 0 }}>
              <DatePicker />
            </Form.Item>
            <Form.Item label="Ghi chú" name="note" style={{ marginBottom: 0 }}>
              <Input placeholder="Điều kiện giao hàng, phương thức thanh toán…" style={{ width: 320 }} />
            </Form.Item>
          </Space>
        </Form>
      </Modal>
    </div>
  );
}