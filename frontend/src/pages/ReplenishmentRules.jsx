/**
 * pages/ReplenishmentRules.jsx — CẤU HÌNH QUY TẮC NHẬP HÀNG
 *
 * Tương ứng `Reordering Rules` của Odoo: cho phép người dùng đặt tham số tồn kho
 * theo từng (sản phẩm × kho) thay vì để hệ thống dùng hằng số cứng.
 *
 * NGUYÊN TẮC hiển thị:
 *   1. Ô TRỐNG = "chưa cấu hình" — KHÔNG phải 0. Hiện rõ mức đang dùng thật sự
 *      (đo được / ước lượng / mặc định) để không tưởng ô trống là sai số.
 *   2. Nói thẳng `maxStock` KHÔNG ép vào công thức ROP — nó chỉ cảnh báo tồn quá
 *      cao. Người dùng dễ hiểu nhầm là "hết trần là không đặt".
 *   3. Mọi thay đổi đi vào audit log (xem API `inventory/routes`).
 */
import { useCallback, useEffect, useState } from 'react';
import {
  Alert, App, Button, Card, Form, InputNumber, Modal, Select, Space, Spin,
  Table, Tag, Tooltip, Typography, Input,
} from 'antd';
import {
  SettingOutlined, ReloadOutlined, InfoCircleOutlined, ExperimentOutlined,
} from '@ant-design/icons';
import { getReplenishmentRules, updateReplenishmentRule } from '../api/replenishmentRules';

const { Title, Text, Paragraph } = Typography;

/** Trợ giúp hiển thị "đang dùng gì": giá trị cấu hình, hoặc mặc định hệ thống. */
const cell = (value, fallback, unit = '') => (
  value === null || value === undefined || value === '' ? (
    <Tooltip title={`Chưa cấu hình — hệ thống dùng ${fallback}`}>
      <Text type="secondary">
        {fallback} <InfoCircleOutlined style={{ fontSize: 11 }} />
      </Text>
    </Tooltip>
  ) : (
    <Text strong>{Number(value).toLocaleString('vi-VN')}{unit}</Text>
  )
);

export default function ReplenishmentRules() {
  const { message } = App.useApp();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [whFilter, setWhFilter] = useState(undefined);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await getReplenishmentRules({ warehouseId: whFilter }));
    } catch (e) {
      message.error(e.response?.data?.message || 'Không tải được quy tắc nhập hàng');
    } finally {
      setLoading(false);
    }
  }, [whFilter, message]);

  useEffect(() => { load(); }, [load]);

  const warehouses = Array.from(
    new Map(rows.filter((r) => r.warehouseId).map((r) => [r.warehouseId, r.warehouse])).values(),
  );
  const warehouseIdOf = (w) => rows.find((r) => r.warehouse?.name === w?.name)?.warehouseId;

  const openEdit = (row) => {
    setEditing(row);
    form.setFieldsValue({
      minStock: row.minStock,
      maxStock: row.maxStock ?? undefined,
      leadTimeDays: row.leadTimeDays ?? undefined,
      packMultiple: row.packMultiple ?? 1,
      serviceLevel: row.serviceLevel ?? undefined,
    });
  };

  const save = async () => {
    const v = await form.validateFields();
    setSaving(true);
    try {
      await updateReplenishmentRule({
        inventoryId: editing.id,
        minStock: v.minStock ?? 0,
        // Ô trống = bỏ cấu hình ⇒ gửi `null`, KHÔNG gửi 0.
        maxStock: v.maxStock ?? null,
        leadTimeDays: v.leadTimeDays ?? null,
        packMultiple: v.packMultiple ?? 1,
        serviceLevel: v.serviceLevel ?? null,
      });
      message.success('Đã lưu quy tắc nhập hàng');
      setEditing(null);
      load();
    } catch (e) {
      if (e?.errorFields) return;
      message.error(e.response?.data?.message || 'Lỗi lưu quy tắc');
    } finally {
      setSaving(false);
    }
  };

  const columns = [
    {
      title: 'Mã hàng',
      dataIndex: ['product', 'sku'],
      key: 'sku',
      fixed: 'left',
      width: 170,
      render: (v, r) => (
        <Space direction="vertical" size={0}>
          <Text strong>{v}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>{r.product?.name}</Text>
        </Space>
      ),
    },
    {
      title: 'Kho',
      dataIndex: ['warehouse', 'name'],
      key: 'wh',
      width: 150,
      render: (v, r) => (
        <Space size={6}>
          <Text>{v}</Text>
          {r.warehouse?.isDefault && <Tag color="blue">mặc định</Tag>}
        </Space>
      ),
    },
    {
      title: 'Tồn hiện tại',
      key: 'qty',
      align: 'right',
      width: 120,
      render: (_, r) => {
        const atp = Number(r.quantity) - Number(r.reserved);
        return (
          <Space direction="vertical" size={0} style={{ alignItems: 'flex-end' }}>
            <Text strong>{atp.toLocaleString('vi-VN')}</Text>
            <Text type="secondary" style={{ fontSize: 12 }}>ATP</Text>
          </Space>
        );
      },
    },
    {
      title: 'Tồn tối thiểu',
      dataIndex: 'minStock',
      key: 'minStock',
      align: 'right',
      width: 130,
      render: (v) => <Text>{Number(v).toLocaleString('vi-VN')}</Text>,
    },
    {
      title: 'Tồn tối đa',
      dataIndex: 'maxStock',
      key: 'maxStock',
      align: 'right',
      width: 140,
      render: (v) => cell(v, 'không giới hạn'),
    },
    {
      title: 'Thời gian nhập',
      dataIndex: 'leadTimeDays',
      key: 'leadTimeDays',
      align: 'right',
      width: 150,
      render: (v) => cell(v, 'đo từ PO→GRN, mặc định 7 ngày', ' ngày'),
    },
    {
      title: 'Quy cách đóng gói',
      dataIndex: 'packMultiple',
      key: 'packMultiple',
      align: 'right',
      width: 150,
      render: (v) => (
        v > 1
          ? <Tag color="blue">bội số {v}</Tag>
          : <Text type="secondary">bán lẻ</Text>
      ),
    },
    {
      title: 'Mức phục vụ',
      dataIndex: 'serviceLevel',
      key: 'serviceLevel',
      align: 'right',
      width: 140,
      render: (v) =>
        v === null || v === undefined
          ? <Text type="secondary">95%</Text>
          : <Text strong>{Math.round(Number(v) * 100)}%</Text>,
    },
    {
      title: '',
      key: 'action',
      fixed: 'right',
      width: 90,
      render: (_, r) => (
        <Button size="small" type="link" icon={<SettingOutlined />} onClick={() => openEdit(r)}>
          Sửa
        </Button>
      ),
    },
  ];

  return (
    <div style={{ padding: 16 }}>
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>
            <ExperimentOutlined /> Quy tắc nhập hàng
          </Title>
          <Paragraph type="secondary" style={{ margin: '4px 0 0' }}>
            Đặt tham số tồn kho theo từng mã hàng, áp dụng cho công thức đề xuất nhập.
            Ô trống nghĩa là chưa cấu hình — hệ thống dùng mặc định hoặc số đo được.
          </Paragraph>
        </div>

        <Alert
          type="info"
          showIcon
          icon={<InfoCircleOutlined />}
          message="Tồn tối đa không ép vào công thức đặt hàng"
          description="ROP là ngưỡng đề xuất, không phải trần cứng. Nếu ép tồn tối đa vào công thức,
            số lượng đặt sẽ bằng 0 và hệ thống sẽ im lặng — mất luôn cảnh báo thiếu hàng.
            Vì vậy tồn tối đa chỉ dùng để cảnh báo tồn quá cao (vốn tiền nằm trong hàng)."
        />

        <Card
          size="small"
          extra={
            <Space>
              <Select
                allowClear placeholder="Tất cả kho" style={{ width: 200 }} value={whFilter}
                onChange={setWhFilter}
                options={warehouses.map((w) => ({ value: warehouseIdOf(w), label: w.name }))}
              />
              <Button icon={<ReloadOutlined />} onClick={load}>Tải lại</Button>
            </Space>
          }
        >
          <Spin spinning={loading}>
            <Table
              size="small" rowKey="id" dataSource={rows} columns={columns}
              pagination={{ pageSize: 20, showSizeChanger: false }}
              scroll={{ x: 1150 }}
              locale={{ emptyText: 'Chưa có dữ liệu tồn kho để đặt quy tắc' }}
            />
          </Spin>
        </Card>
      </Space>

      <Modal
        open={!!editing}
        title={editing ? `Quy tắc — ${editing.product?.sku} @ ${editing.warehouse?.name}` : ''}
        onCancel={() => setEditing(null)}
        onOk={save}
        confirmLoading={saving}
        okText="Lưu"
        cancelText="Huỷ"
        width={520}
      >
        <Paragraph type="secondary" style={{ fontSize: 13 }}>
          Để trống ô nào thì ô đó trở về mặc định của hệ thống.
        </Paragraph>
        <Form form={form} layout="vertical">
          <Form.Item
            name="minStock" label="Tồn tối thiểu (đơn vị)" style={{ marginBottom: 12 }}
          >
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            name="maxStock" label="Tồn tối đa — chỉ để cảnh báo tồn quá cao"
            extra="Không giới hạn nếu để trống. Không dùng để cắt số lượng đặt."
            style={{ marginBottom: 12 }}
          >
            <InputNumber min={1} style={{ width: '100%' }} placeholder="Không giới hạn" />
          </Form.Item>
          <Form.Item
            name="leadTimeDays" label="Thời gian nhập (ngày)"
            extra="Để trống thì hệ thống lấy trung vị từ lịch sử phiếu nhập kho."
            style={{ marginBottom: 12 }}
          >
            <InputNumber min={1} style={{ width: '100%' }} placeholder="Tự đo" />
          </Form.Item>
          <Form.Item
            name="packMultiple" label="Quy cách đóng gói"
            extra="Bán theo thùng/hộp thì đặt 12, 24… Số lượng đặt sẽ làm tròn lên bội số này."
            style={{ marginBottom: 12 }}
          >
            <InputNumber min={1} style={{ width: '100%' }} placeholder={1} />
          </Form.Item>
          <Form.Item
            name="serviceLevel" label="Mức phục vụ mong muốn"
            extra="0,90 = thiếu hàng 10% thời gian; 0,99 = thiếu 1%. Tồn tối thiểu cao hơn khi mức này cao hơn."
            style={{ marginBottom: 0 }}
          >
            <Select
              allowClear placeholder="Mặc định 95%" options={[
                { value: 0.8, label: '80% — giữ tồn thấp' },
                { value: 0.9, label: '90% — cân bằng' },
                { value: 0.95, label: '95% — mặc định' },
                { value: 0.98, label: '98% — giữ tồn cao' },
                { value: 0.99, label: '99% — tốn kho' },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}