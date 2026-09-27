/**
 * Page: Printers — Cấu hình máy in (F&B)
 *
 * Tổng quan:
 * - Danh sách máy in ESC/POS: tên, khu vực (station), loại kết nối, khổ giấy
 * - CRUD máy in qua Form Modal
 * - Gọi API: GET/POST/PATCH/DELETE /printers
 *
 * Exports:
 * - Printers: React functional component (default export)
 */
import { useEffect, useState, useCallback } from 'react';
import { Table, Button, Space, Tag, Popconfirm, Modal, Form, Input, Select, InputNumber, Switch } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, SearchOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import axios from '../api/axios';
import PageHeader from '../components/layout/PageHeader';
import EmptyState from '../components/shared/EmptyState';
import useToast from '../components/shared/useToast';
import PermissionGate from '../components/shared/PermissionGate';

const CONNECTION_TYPES = [
  { value: 'BLUETOOTH', label: 'Bluetooth' },
  { value: 'NETWORK', label: 'Mạng (IP)' },
  { value: 'USB', label: 'USB' },
];

export default function Printers() {
  const { t } = useTranslation();
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState([]);
  const [stations, setStations] = useState([]);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();
  const connectionType = Form.useWatch('connectionType', form);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get('/printers');
      let list = Array.isArray(res.data) ? res.data : (res.data?.data || []);
      if (search) list = list.filter((p) => p.name?.toLowerCase().includes(search.toLowerCase()));
      setData(list);
    } catch {
      toast.error(t('printers.loadError'));
    } finally {
      setLoading(false);
    }
  }, [search, toast, t]);

  useEffect(() => { loadData(); }, [loadData]);

  const loadStations = async () => {
    try {
      const res = await axios.get('/kds/stations');
      const list = Array.isArray(res.data) ? res.data : (res.data?.data || []);
      setStations(list.filter((s) => s.isActive !== false));
    } catch { /* optional */ }
  };

  useEffect(() => { loadStations(); }, []);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ connectionType: 'BLUETOOTH', paperWidth: 58, isActive: true });
    setModalOpen(true);
  };

  const openEdit = (row) => {
    setEditing(row);
    form.setFieldsValue({
      name: row.name,
      stationId: row.stationId,
      connectionType: row.connectionType || 'BLUETOOTH',
      macAddress: row.macAddress,
      ipAddress: row.ipAddress,
      paperWidth: row.paperWidth || 58,
      isActive: row.isActive !== false,
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      if (values.connectionType !== 'NETWORK') delete values.ipAddress;
      if (values.connectionType !== 'BLUETOOTH') delete values.macAddress;
      if (editing) {
        await axios.patch(`/printers/${editing.id}`, values);
        toast.success(t('printers.updateSuccess'));
      } else {
        await axios.post('/printers', values);
        toast.success(t('printers.createSuccess'));
      }
      setModalOpen(false);
      loadData();
    } catch (e) {
      if (e?.errorFields) return;
      toast.error(t('printers.saveError'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (row) => {
    try {
      await axios.delete(`/printers/${row.id}`);
      toast.success(t('printers.deleteSuccess'));
      loadData();
    } catch {
      toast.error(t('printers.deleteError'));
    }
  };

  const stationName = (id) => stations.find((s) => s.id === id)?.name || '—';

  const columns = [
    {
      title: t('printers.name'),
      dataIndex: 'name',
      width: 200,
      render: (v) => <b>{v}</b>,
    },
    {
      title: t('printers.station'),
      dataIndex: 'stationId',
      width: 160,
      render: (v) => stationName(v),
    },
    {
      title: t('printers.connectionType'),
      dataIndex: 'connectionType',
      width: 130,
      render: (v) => <Tag color={v === 'NETWORK' ? 'blue' : v === 'BLUETOOTH' ? 'purple' : 'default'}>{v}</Tag>,
    },
    {
      title: t('printers.address'),
      width: 200,
      render: (_, row) => row.macAddress || row.ipAddress || '—',
    },
    {
      title: t('printers.paperWidth'),
      dataIndex: 'paperWidth',
      width: 110,
      align: 'right',
      render: (v) => `${v ?? 58}mm`,
    },
    {
      title: t('common.status'),
      dataIndex: 'isActive',
      width: 100,
      render: (v) => (v === false ? <Tag>Ngừng</Tag> : <Tag color="green">Hoạt động</Tag>),
    },
    {
      title: '',
      width: 100,
      align: 'right',
      fixed: 'right',
      render: (_, row) => (
        <Space size={4}>
          <Button type="text" size="small" icon={<EditOutlined />} onClick={() => openEdit(row)} />
          <Popconfirm
            title={t('common.confirmDelete')}
            okText={t('common.delete')}
            cancelText={t('common.cancel')}
            okButtonProps={{ danger: true }}
            onConfirm={() => handleDelete(row)}
          >
            <Button type="text" size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title={t('printers.title')}
        subtitle={t('printers.count', { count: data.length })}
        actions={
          <PermissionGate permission="settings.edit">
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              {t('printers.addNew')}
            </Button>
          </PermissionGate>
        }
      />

      <div className="filters-bar">
        <Input
          className="filters-bar__search"
          placeholder={t('printers.searchPlaceholder')}
          prefix={<SearchOutlined style={{ color: 'var(--text-muted)' }} />}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          allowClear
        />
      </div>

      <div className="table-card">
        <Table
          columns={columns}
          dataSource={data}
          rowKey="id"
          loading={loading}
          scroll={{ x: 900 }}
          pagination={{ pageSize: 20, showSizeChanger: false, showTotal: (total) => t('printers.count', { count: total }) }}
          locale={{
            emptyText: (
              <EmptyState
                title={t('printers.empty')}
                description={t('printers.emptyDesc')}
                action={
                  <PermissionGate permission="settings.edit">
                    <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
                      {t('printers.addFirst')}
                    </Button>
                  </PermissionGate>
                }
              />
            ),
          }}
        />
      </div>

      <Modal
        title={editing ? t('printers.editTitle') : t('printers.createTitle')}
        open={modalOpen}
        onOk={handleSave}
        onCancel={() => setModalOpen(false)}
        confirmLoading={saving}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Form.Item name="name" label={t('printers.name')} rules={[{ required: true, message: t('printers.nameRequired') }]}>
              <Input />
            </Form.Item>
            <Form.Item name="stationId" label={t('printers.station')}>
              <Select
                allowClear
                placeholder={t('printers.stationPlaceholder')}
                options={stations.map((s) => ({ value: s.id, label: s.name }))}
              />
            </Form.Item>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Form.Item name="connectionType" label={t('printers.connectionType')}>
              <Select options={CONNECTION_TYPES} />
            </Form.Item>
            <Form.Item name="paperWidth" label={t('printers.paperWidth')}>
              <Select
                options={[
                  { value: 58, label: '58mm' },
                  { value: 80, label: '80mm' },
                ]}
              />
            </Form.Item>
          </div>
          {connectionType === 'BLUETOOTH' && (
            <Form.Item name="macAddress" label={t('printers.macAddress')} rules={[{ required: true, message: t('printers.macRequired') }]}>
              <Input placeholder="AA:BB:CC:DD:EE:FF" />
            </Form.Item>
          )}
          {connectionType === 'NETWORK' && (
            <Form.Item name="ipAddress" label={t('printers.ipAddress')} rules={[{ required: true, message: t('printers.ipRequired') }]}>
              <Input placeholder="192.168.1.100" />
            </Form.Item>
          )}
          <Form.Item name="isActive" label={t('common.status')} valuePropName="checked">
            <Switch checkedChildren={t('common.active')} unCheckedChildren={t('common.inactive')} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
