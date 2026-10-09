/**
 * Frontend: src/pages/partners/Partners.jsx — Danh sách đối tác (PRM)
 *
 * Tổng quan:
 * - Nạp `GET /partners` + `GET /partners/stats` + `GET /partners/roi`.
 * - Mỗi dòng gộp số liệu hiệu quả (số khách chuyển đổi, lợi nhuận ròng) vào từ báo
 *   cáo ROI, để người dùng không phải nhảy qua lại giữa hai màn hình.
 * - Bộ lọc: loại đối tác, trạng thái (đang hoạt động / đã ngừng), tìm theo tên hoặc mã.
 *
 * CỐ Ý BỎ: cột giá trị vòng đời dự báo và cột hoa hồng đều có nhãn giải thích khi
 * hover, vì `predictedValue` là giá trị DỰ ĐOÁN chứ không phải doanh thu đã thu. Đọc
 * nhầm hai thứ này là sai lệch lớn nhất khi đọc báo cáo đối tác.
 *
 * Exports: Partners (default)
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Table, Card, Button, Space, Input, Select, Tag, Modal, Form, InputNumber,
  Popconfirm, Tooltip, Row, Col, Alert, Spin, Empty, App,
} from "antd";
import {
  PlusOutlined, ReloadOutlined, SearchOutlined, InfoCircleOutlined, StopOutlined,
} from "@ant-design/icons";
import PageHeader from "../../components/layout/PageHeader";
import StatCard from "../../components/shared/StatCard";
import MoneyDisplay from "../../components/shared/MoneyDisplay";
import { listPartners, getPartnerStats, getPartnerRoi, createPartner, deactivatePartner, restorePartner } from "../../api/partners";
import { partnerTypeOptions, commissionTypeOptions, PARTNER_TYPE_META, commissionLabel } from "../../components/partners/constants";

export default function Partners() {
  const { t } = useTranslation();
  const { message } = App.useApp();

  const [rows, setRows] = useState([]);
  const [stats, setStats] = useState(null);
  const [roi, setRoi] = useState({ rows: [], totals: null });
  const [loading, setLoading] = useState(false);
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0 });
  const [filters, setFilters] = useState({ type: undefined, isActive: true, search: "" });
  const [openCreate, setOpenCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  const typeOptions = useMemo(() => partnerTypeOptions(t), [t]);
  const commissionOptions = useMemo(() => commissionTypeOptions(t), [t]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [listRes, statsRes, roiRes] = await Promise.all([
        listPartners({ page: pagination.page, limit: pagination.limit, ...filters }),
        getPartnerStats(),
        getPartnerRoi({ limit: 200, sortBy: "profit" }),
      ]);
      setRows(listRes.data || []);
      setPagination((p) => ({ ...p, ...(listRes.pagination || {}) }));
      setStats(statsRes);
      setRoi({ rows: roiRes?.partners || [], totals: roiRes?.totals || null });
    } catch (e) {
      message.error(e.response?.data?.message || t("prm.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [pagination.page, pagination.limit, filters, t, message]);

  useEffect(() => { load(); }, [load]);

  const roiTotals = roi.totals;

  // Số liệu hiệu quả theo từng đối tác, tra nhanh khi vẽ bảng.
  //
  // Báo cáo ROI chỉ trả đối tác ĐANG HOẠT ĐỘNG, nên đối tác đã ngừng sẽ không có
  // dòng tương ứng. Đó là hành vi đúng — không phải dữ liệu thiếu — nên cột hiện
  // "—" thay vì số 0.
  const roiByPartner = useMemo(() => {
    const map = {};
    for (const p of roi.rows) map[p.partnerId] = p;
    return map;
  }, [roi.rows]);

  const columns = useMemo(() => [
    {
      title: t("prm.col.code"),
      dataIndex: "code",
      key: "code",
      width: 140,
      render: (code, r) => (
        <Space direction="vertical" size={0}>
          <Link to={`/prm/partners/${r.id}`}>{code}</Link>
          {!r.isActive && <Tag color="default">{t("prm.inactive")}</Tag>}
        </Space>
      ),
    },
    {
      title: t("prm.col.name"),
      dataIndex: "name",
      key: "name",
      render: (name, r) => (
        <Space direction="vertical" size={0}>
          <span>{name}</span>
          {r.phone && <span className="text-muted">{r.phone}</span>}
        </Space>
      ),
    },
    {
      title: t("prm.col.type"),
      dataIndex: "type",
      key: "type",
      width: 170,
      render: (type) => (
        <Tag color={PARTNER_TYPE_META[type]?.color || "default"}>{t(PARTNER_TYPE_META[type]?.labelKey)}</Tag>
      ),
    },
    {
      title: t("prm.col.commission"),
      dataIndex: "commissionType",
      key: "commission",
      width: 170,
      render: (_, r) => (
        <Space direction="vertical" size={0}>
          <span>{commissionLabel(t)(r)}</span>
          <span className="text-muted" style={{ fontSize: 12 }}>
            {t(`prm.commissionType.${r.commissionType}`)}
          </span>
        </Space>
      ),
    },
    {
      // Số liệu hiệu quả lấy từ báo cáo ROI chứ không phải từ API danh sách: hồ sơ
      // đối tác không cần mang theo số liệu tổng hợp, và nếu mang theo thì hai nơi
      // phải cập nhật đồng thời rất dễ lệch.
      title: t("prm.col.converted"),
      key: "converted",
      width: 110,
      align: "right",
      render: (_, r) => {
        const roi = roiByPartner[r.id];
        if (!roi) return <span className="text-muted">—</span>;
        return `${roi.converted}/${roi.referrals}`;
      },
    },
    {
      title: (
        <Space size={4}>
          {t("prm.col.predictedValue")}
          <Tooltip title={t("prm.tooltip.predictedValue")}>
            <InfoCircleOutlined />
          </Tooltip>
        </Space>
      ),
      key: "predictedValue",
      width: 160,
      align: "right",
      render: (_, r) => {
        const roi = roiByPartner[r.id];
        if (!roi) return <span className="text-muted">—</span>;
        return (
          <Space direction="vertical" size={0} style={{ alignItems: "flex-end" }}>
            <MoneyDisplay value={roi.predictedValue} short />
            {roi.coverage < 100 && (
              <Tooltip title={t("prm.tooltip.coverage")}>
                <Tag color="warning" style={{ marginInlineEnd: 0 }}>
                  {roi.coverage}%
                </Tag>
              </Tooltip>
            )}
          </Space>
        );
      },
    },
    {
      title: t("prm.col.netProfit"),
      key: "netProfit",
      width: 160,
      align: "right",
      render: (_, r) => {
        const roi = roiByPartner[r.id];
        if (!roi) return <span className="text-muted">—</span>;
        return (
          <Space direction="vertical" size={0} style={{ alignItems: "flex-end" }}>
            <MoneyDisplay value={roi.netProfit} short />
            <span className="text-muted" style={{ fontSize: 12 }}>
              {t("prm.col.commission")}: <MoneyDisplay value={roi.commission} short showCurrency={false} />
            </span>
          </Space>
        );
      },
    },
    {
      title: "",
      key: "actions",
      width: 110,
      render: (_, r) => (
        <Space size={4}>
          {r.isActive ? (
            <Popconfirm
              title={t("prm.confirmDeactivate")}
              description={t("prm.confirmDeactivateDesc")}
              onConfirm={async () => {
                try {
                  await deactivatePartner(r.id);
                  message.success(t("prm.deactivated"));
                  load();
                } catch (e) {
                  message.error(e.response?.data?.message || t("prm.loadFailed"));
                }
              }}
            >
              <Button size="small" icon={<StopOutlined />} danger>{t("prm.deactivate")}</Button>
            </Popconfirm>
          ) : (
            <Button
              size="small"
              onClick={async () => {
                try {
                  await restorePartner(r.id);
                  message.success(t("prm.restored"));
                  load();
                } catch (e) {
                  message.error(e.response?.data?.message || t("prm.loadFailed"));
                }
              }}
            >
              {t("prm.restore")}
            </Button>
          )}
        </Space>
      ),
    },
  ], [t, roiByPartner, load, message]);

  const submit = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      await createPartner(values);
      message.success(t("prm.created"));
      setOpenCreate(false);
      form.resetFields();
      load();
    } catch (e) {
      message.error(e.response?.data?.message || t("prm.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page">
      <PageHeader
        title={t("prm.partnersTitle")}
        subtitle={t("prm.partnersSubtitle", { count: pagination.total })}
        actions={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={load} loading={loading} />
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpenCreate(true)}>
              {t("prm.addPartner")}
            </Button>
          </Space>
        }
      />

      <Row gutter={[16, 16]} className="mb-lg">
        <Col xs={12} md={6}>
          <StatCard title={t("prm.kpi.activePartners")} value={stats?.active ?? "—"} variant="primary" loading={loading} />
        </Col>
        <Col xs={12} md={6}>
          <StatCard title={t("prm.kpi.totalPartners")} value={stats?.total ?? "—"} variant="info" loading={loading} />
        </Col>
        <Col xs={12} md={6}>
          <StatCard
            title={t("prm.kpi.converted")}
            value={`${roiTotals?.converted ?? 0}/${roiTotals?.referrals ?? 0}`}
            variant="success"
            loading={loading}
          />
        </Col>
        <Col xs={12} md={6}>
          <StatCard
            title={t("prm.kpi.netProfit")}
            value={<MoneyDisplay value={roiTotals?.netProfit ?? 0} short />}
            variant="success"
            loading={loading}
          />
        </Col>
      </Row>

      {roiTotals && roiTotals.contestedCustomers > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message={t("prm.alert.contested", { count: roiTotals.contestedCustomers })}
          description={t("prm.alert.contestedDesc")}
        />
      )}

      <Card>
        <Space wrap style={{ marginBottom: 16 }}>
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder={t("prm.searchPlaceholder")}
            style={{ width: 240 }}
            onPressEnter={(e) => setFilters((f) => ({ ...f, search: e.target.value, page: 1 }))}
          />
          <Select
            allowClear
            placeholder={t("prm.filterType")}
            style={{ width: 200 }}
            options={typeOptions}
            value={filters.type}
            onChange={(v) => setFilters((f) => ({ ...f, type: v, page: 1 }))}
          />
          <Select
            style={{ width: 180 }}
            value={filters.isActive}
            options={[
              { value: true, label: t("prm.onlyActive") },
              { value: false, label: t("prm.onlyInactive") },
              { value: undefined, label: t("prm.allStatus") },
            ]}
            onChange={(v) => setFilters((f) => ({ ...f, isActive: v, page: 1 }))}
          />
        </Space>

        <Table
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={rows}
          scroll={{ x: 1000 }}
          locale={{ emptyText: <Empty description={t("prm.empty")} /> }}
          pagination={{
            current: pagination.page,
            pageSize: pagination.limit,
            total: pagination.total,
            showSizeChanger: true,
            showTotal: (total) => t("prm.totalRecords", { total }),
            onChange: (page, limit) => setPagination((p) => ({ ...p, page, limit })),
          }}
        />
      </Card>

      <Modal
        title={t("prm.addPartner")}
        open={openCreate}
        onCancel={() => setOpenCreate(false)}
        onOk={submit}
        confirmLoading={saving}
        okText={t("common.save")}
        cancelText={t("common.cancel")}
      >
        <Spin spinning={saving}>
          <Form form={form} layout="vertical" initialValues={{ type: "AFFILIATE", commissionType: "PERCENT_OF_CLV", commissionPercent: 10 }}>
            <Form.Item name="name" label={t("prm.col.name")} rules={[{ required: true, message: t("prm.required") }]}>
              <Input />
            </Form.Item>
            <Form.Item name="code" label={`${t("prm.col.code")} (${t("prm.autoCode")})`}>
              <Input placeholder={t("prm.autoCodeHint")} />
            </Form.Item>
            <Form.Item name="type" label={t("prm.col.type")}>
              <Select options={typeOptions} />
            </Form.Item>
            <Form.Item name="commissionType" label={t("prm.col.commission")}>
              <Select options={commissionOptions} />
            </Form.Item>
            <Form.Item noStyle shouldUpdate={(prev, cur) => prev.commissionType !== cur.commissionType}>
              {({ getFieldValue }) =>
                getFieldValue("commissionType") === "FIXED_PER_CUSTOMER" ? (
                  <Form.Item
                    name="fixedCommission"
                    label={t("prm.field.fixedCommission")}
                    rules={[{ required: true, message: t("prm.required") }]}
                  >
                    <InputNumber min={0} style={{ width: "100%" }} addonAfter="₫" />
                  </Form.Item>
                ) : (
                  <Form.Item
                    name="commissionPercent"
                    label={t("prm.field.commissionPercent")}
                    tooltip={t("prm.tooltip.percentInput")}
                    rules={[{ required: true, message: t("prm.required") }]}
                  >
                    <InputNumber min={0} max={100} style={{ width: "100%" }} addonAfter="%" />
                  </Form.Item>
                )
              }
            </Form.Item>
            <Row gutter={12}>
              <Col span={12}>
                <Form.Item name="phone" label={t("prm.field.phone")}>
                  <Input />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="contactName" label={t("prm.field.contactName")}>
                  <Input />
                </Form.Item>
              </Col>
            </Row>
            <Form.Item name="notes" label={t("prm.field.notes")}>
              <Input.TextArea rows={3} />
            </Form.Item>
          </Form>
        </Spin>
      </Modal>
    </div>
  );
}