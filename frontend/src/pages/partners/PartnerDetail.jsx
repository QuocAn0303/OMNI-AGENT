/**
 * Frontend: src/pages/partners/PartnerDetail.jsx — Chi tiết một đối tác (PRM)
 *
 * Tổng quan:
 * - Nạp `GET /partners/roi/:id` (số liệu xếp hạng + danh sách khách đã chuyển đổi)
 *   và `GET /partners/referrals/funnel?partnerId=` (phễu giới thiệu riêng của đối tác).
 * - Bốn khối: thông tin đối tác + cách tính hoa hồng · KPI lợi nhuận ròng · phễu chuyển
 *   đổi · bảng khách đã chuyển đổi.
 *
 * ĐIỂM ĐỌC DỄ SAI:
 * - Cột giá trị khách là giá trị DỰ ĐOÁN (`clvPredicted`), không phải doanh thu đã
 *   thu. Cột "đã chi" mới là tiền thật. Hai cột đặt cạnh nhau có chủ ý.
 * - Khách chưa đủ lịch sử thì `predictedValue` bằng null và `insufficientData` =
 *   true. Hiển thị "chưa đủ dữ liệu" chứ không hiển thị 0₫, vì 0₫ đọc là khách đó
 *   không có giá trị chứ không phải là chưa biết.
 *
 * Exports: PartnerDetail (default)
 */
import { useCallback, useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Card, Table, Tag, Row, Col, Descriptions, Space, Button, Spin, Empty,
  Tooltip, Alert, Modal, Form, Input, App,
} from "antd";
// StatCard là component CỦA DỰ ÁN, không phải của antd. Import nhầm từ "antd" thì
// ESLint không báo (tên export không tồn tại chỉ lộ ra lúc bundler đóng gói) —
// nên đừng tin lint, hãy tin `npm run build`.
import StatCard from "../../components/shared/StatCard";
import {
  ArrowLeftOutlined, ReloadOutlined, InfoCircleOutlined, WarningOutlined,
} from "@ant-design/icons";
import PageHeader from "../../components/layout/PageHeader";
import MoneyDisplay from "../../components/shared/MoneyDisplay";
import { getPartnerRoiDetail, getReferralFunnel, listReferrals, createReferral } from "../../api/partners";
import {
  PARTNER_TYPE_META, FUNNEL_STAGE_META, DEAD_LABEL_KEY, commissionLabel, percentOf,
} from "../../components/partners/constants";

export default function PartnerDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { message } = App.useApp();

  const [detail, setDetail] = useState(null);
  const [funnelRow, setFunnelRow] = useState(null);
  const [referrals, setReferrals] = useState([]);
  const [loading, setLoading] = useState(false);
  const [openReferral, setOpenReferral] = useState(false);
  const [saving, setSaving] = useState(false);
  const [referralForm] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [d, f, r] = await Promise.all([
        getPartnerRoiDetail(id),
        getReferralFunnel({ partnerId: id }),
        listReferrals({ partnerId: id, limit: 50 }),
      ]);
      setDetail(d);
      setFunnelRow(f?.[0] || null);
      setReferrals(r.data || []);
    } catch (e) {
      if (e.response?.status === 404) {
        message.error(t("prm.notFound"));
        navigate("/prm/partners");
        return;
      }
      message.error(e.response?.data?.message || t("prm.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [id, t, message, navigate]);

  useEffect(() => { load(); }, [load]);

  /** Nhập tay lượt giới thiệu — dùng cho khách đến qua điện thoại, không qua webhook. */
  const submitReferral = async () => {
    const values = await referralForm.validateFields();
    setSaving(true);
    try {
      await createReferral({ partnerId: id, ...values });
      message.success(t("prm.referralAdded"));
      setOpenReferral(false);
      referralForm.resetFields();
      load();
    } catch (err) {
      // 409 là chuyện thường gặp: đối tác gửi lại một khách đã giới thiệu trước đó.
      // Thông điệp từ backend đã nói rõ nguyên nhân nên hiển thị nguyên văn, không
      // thay bằng thông báo chung chung.
      message.error(err.response?.data?.message || t("prm.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const p = detail?.partner;

  const customerColumns = [
    {
      title: t("prm.col.customer"),
      dataIndex: "name",
      render: (name, r) => (
        <Space direction="vertical" size={0}>
          <span>{name || t("prm.customerSoftDeleted")}</span>
          {r.phone && <span className="text-muted">{r.phone}</span>}
        </Space>
      ),
    },
    {
      title: t("prm.col.segment"),
      dataIndex: "rfmSegment",
      width: 130,
      render: (seg) => seg ? <Tag color="blue">{seg}</Tag> : <span className="text-muted">—</span>,
    },
    {
      title: (
        <Space size={4}>
          {t("prm.col.predictedValue")}
          <Tooltip title={t("prm.tooltip.predictedValue")}><InfoCircleOutlined /></Tooltip>
        </Space>
      ),
      dataIndex: "predictedValue",
      width: 150,
      align: "right",
      render: (v) =>
        v == null
          ? <Tooltip title={t("prm.tooltip.insufficientData")}><Tag color="warning">—</Tag></Tooltip>
          : <MoneyDisplay value={v} short />,
    },
    {
      title: t("prm.col.actualValue"),
      dataIndex: "actualValue",
      width: 150,
      align: "right",
      render: (v) => <MoneyDisplay value={v} short />,
    },
    {
      title: t("prm.col.churn"),
      dataIndex: "churnProbability",
      width: 100,
      align: "right",
      render: (c) => (c == null ? "—" : `${Math.round(c * 100)}%`),
    },
    {
      title: t("prm.col.convertedAt"),
      dataIndex: "convertedAt",
      width: 130,
      render: (d) => (d ? new Date(d).toLocaleDateString("vi-VN") : "—"),
    },
  ];

  const referralColumns = [
    {
      title: t("prm.col.referredName"),
      dataIndex: "referredName",
      render: (name, r) => (
        <Space direction="vertical" size={0}>
          <span>{name}</span>
          <span className="text-muted" style={{ fontSize: 12 }}>{r.referralCode}</span>
        </Space>
      ),
    },
    { title: t("prm.col.referredPhone"), dataIndex: "referredPhone", render: (v) => v || "—" },
    {
      title: t("prm.col.status"),
      dataIndex: "converted",
      width: 140,
      render: (c) =>
        c ? <Tag color="success">{t("prm.converted")}</Tag> : <Tag>{t("prm.notConverted")}</Tag>,
    },
    {
      title: t("prm.col.referralDate"),
      dataIndex: "referralDate",
      width: 130,
      render: (d) => new Date(d).toLocaleDateString("vi-VN"),
    },
  ];

  return (
    <div className="page">
      <PageHeader
        title={p ? `${p.name} · ${p.code}` : t("prm.partnerDetail")}
        subtitle={p ? t(PARTNER_TYPE_META[p.type]?.labelKey) : undefined}
        actions={
          <Space>
            <Button icon={<ArrowLeftOutlined />} onClick={() => navigate("/prm/partners")}>
              {t("prm.back")}
            </Button>
            <Button icon={<ReloadOutlined />} onClick={load} loading={loading} />
          </Space>
        }
      />

      <Spin spinning={loading}>
        {!p ? (
          <Card><Empty description={t("prm.loading")} /></Card>
        ) : (
          <>
            {p.coverage < 100 && (
              <Alert
                type="info"
                showIcon
                style={{ marginBottom: 16 }}
                message={t("prm.alert.coverage", { coverage: p.coverage })}
                description={t("prm.alert.coverageDesc")}
              />
            )}

            <Row gutter={[16, 16]}>
              <Col xs={24} lg={8}>
                <Card title={t("prm.card.info")}>
                  <Descriptions column={1} size="small">
                    <Descriptions.Item label={t("prm.col.code")}>{p.code}</Descriptions.Item>
                    <Descriptions.Item label={t("prm.col.type")}>
                      <Tag color={PARTNER_TYPE_META[p.type]?.color}>{t(PARTNER_TYPE_META[p.type]?.labelKey)}</Tag>
                    </Descriptions.Item>
                    <Descriptions.Item label={t("prm.col.commission")}>
                      <Space direction="vertical" size={0}>
                        <span>{commissionLabel(t)(p)}</span>
                        <span className="text-muted" style={{ fontSize: 12 }}>
                          {t(`prm.commissionType.${p.commissionType}`)}
                        </span>
                      </Space>
                    </Descriptions.Item>
                    <Descriptions.Item label={t("prm.col.referrals")}>{p.referrals}</Descriptions.Item>
                    <Descriptions.Item label={t("prm.col.converted")}>{p.converted}</Descriptions.Item>
                  </Descriptions>
                </Card>
              </Col>

              <Col xs={24} lg={16}>
                <Row gutter={[16, 16]}>
                  <Col xs={12} md={6}>
                    <StatCard title={t("prm.kpi.conversionRate")} value={`${p.conversionRate}%`} variant="info" />
                  </Col>
                  <Col xs={12} md={6}>
                    <StatCard
                      title={t("prm.kpi.predictedValue")}
                      value={<MoneyDisplay value={p.predictedValue} short />}
                      variant="primary"
                    />
                  </Col>
                  <Col xs={12} md={6}>
                    <StatCard
                      title={t("prm.kpi.commission")}
                      value={<MoneyDisplay value={p.commission} short />}
                      variant="warning"
                    />
                  </Col>
                  <Col xs={12} md={6}>
                    <StatCard
                      title={t("prm.kpi.netProfit")}
                      value={<MoneyDisplay value={p.netProfit} short />}
                      variant={p.netProfit >= 0 ? "success" : "danger"}
                    />
                  </Col>
                </Row>
              </Col>
            </Row>

            <Card title={t("prm.card.funnel")} style={{ marginTop: 16 }}>
              {funnelRow ? (
                <Row gutter={[16, 8]}>
                  {funnelRow.funnel.map((s, i) => {
                    const prev = i > 0 ? funnelRow.funnel[i - 1].count : null;
                    return (
                      <Col xs={12} md={6} key={s.stage}>
                        <div style={{ marginBottom: 4 }}>
                          <Tag color={FUNNEL_STAGE_META[s.stage]?.color}>{t(FUNNEL_STAGE_META[s.stage]?.labelKey)}</Tag>
                        </div>
                        <div style={{ fontSize: 24, fontWeight: 600 }}>{s.count}</div>
                        {prev != null && (
                          <div className="text-muted" style={{ fontSize: 12 }}>
                            {t("prm.funnelOfPrev")}: {percentOf(s.count, prev)}
                          </div>
                        )}
                      </Col>
                    );
                  })}
                  {funnelRow.dead > 0 && (
                    <Col xs={24}>
                      <Space style={{ marginTop: 8 }}>
                        <WarningOutlined style={{ color: "var(--color-warning, #faad14)" }} />
                        <span>
                          {t(DEAD_LABEL_KEY)}: <b>{funnelRow.dead}</b>
                        </span>
                      </Space>
                    </Col>
                  )}
                </Row>
              ) : (
                <Empty description={t("prm.empty")} />
              )}
            </Card>

            <Card
              title={t("prm.card.convertedCustomers")}
              style={{ marginTop: 16 }}
              extra={
                p.coverage < 100 && (
                  <Tooltip title={t("prm.tooltip.coverage")}>
                    <Tag color="warning">{t("prm.coverage")}: {p.coverage}%</Tag>
                  </Tooltip>
                )
              }
            >
              <Table
                rowKey="referralCode"
                size="small"
                loading={loading}
                columns={customerColumns}
                dataSource={detail.customers}
                pagination={{ pageSize: 10, showTotal: (x) => t("prm.totalRecords", { total: x }) }}
                locale={{ emptyText: <Empty description={t("prm.noConverted")} /> }}
              />
            </Card>

            <Card
              title={t("prm.card.referrals")}
              style={{ marginTop: 16 }}
              extra={
                <Button type="primary" onClick={() => setOpenReferral(true)}>{t("prm.addReferral")}</Button>
              }
            >
              <Table
                rowKey="id"
                size="small"
                loading={loading}
                columns={referralColumns}
                dataSource={referrals}
                pagination={{ pageSize: 10 }}
                locale={{ emptyText: <Empty description={t("prm.empty")} /> }}
              />
            </Card>
          </>
        )}
      </Spin>

      <Modal
        title={t("prm.addReferral")}
        open={openReferral}
        onCancel={() => setOpenReferral(false)}
        onOk={submitReferral}
        confirmLoading={saving}
        okText={t("common.save")}
        cancelText={t("common.cancel")}
      >
        <Form form={referralForm} layout="vertical">
          <Form.Item
            name="referredName"
            label={t("prm.field.referredName")}
            rules={[{ required: true, message: t("prm.required") }]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="referredPhone"
            label={t("prm.field.referredPhone")}
            tooltip={t("prm.tooltip.referredPhone")}
          >
            <Input />
          </Form.Item>
          <Form.Item name="referredEmail" label={t("prm.field.referredEmail")}>
            <Input />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}