/**
 * Page: Combos — Quản lý Combo (F&B)
 *
 * Tổng quan:
 * - Danh sách combo: sản phẩm combo, giá, số lượng món thành phần
 * - CRUD Combo: tạo mới với selector sản phẩm + bảng chọn món
 * - Gọi API: GET/POST/PATCH/DELETE /menu/combos, GET /menu/combos/:id
 *
 * Exports:
 * - Combos: React functional component (default export)
 */
import { useEffect, useState, useCallback } from 'react';
import { Table, Button, Space, Popconfirm, Modal, Form, InputNumber, Select, Input, Tag } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, SearchOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import axios from '../api/axios';
import PageHeader from '../components/layout/PageHeader';
import EmptyState from '../components/shared/EmptyState';
import useToast from '../components/shared/useToast';
import PermissionGate from '../components/shared/PermissionGate';
import MoneyDisplay from '../components/shared/MoneyDisplay';

export default function Combos() {
  const { t } = useTranslation();
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState([]);
  const [products, setProducts] = useState([]);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [items, setItems] = useState([]);
  const [form] = Form.useForm();

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get('/menu/combos');
      let list = Array.isArray(res.data) ? res.data : (res.data?.data || []);
      if (search) list = list.filter((c) => c.product?.name?.toLowerCase().includes(search.toLowerCase()));
      setData(list);
    } catch {
      toast.error(t('combos.loadError'));
    } finally {
      setLoading(false);
    }
  }, [search, toast, t]);

  useEffect(() => { loadData(); }, [loadData]);

  const loadProducts = async () => {
    try {
      const res = await axios.get('/products', { params: { limit: 200 } });
      const list = Array.isArray(res.data) ? res.data : (res.data?.data || []);
      setProducts(list.filter((p) => p.type !== 'COMBO'));
    } catch { /* optional */ }
  };

  useEffect(() => { loadProducts(); }, []);

  const openCreate = () => {
    setEditing(null);
    setItems([]);
    form.resetFields();
    setModalOpen(true);
  };

  const openEdit = async (row) => {
    setEditing(row);
    setItems((row.items || []).map((it) => ({ productId: it.productId, quantity: it.quantity })));
    form.setFieldsValue({
      productId: row.productId,
      price: row.price,
      isActive: row.isActive !== false,
    });
    setModalOpen(true);
  };

  const addItemRow = () => setItems((prev) => [...prev, { productId: null, quantity: 1 }]);

  const updateItemRow = (idx, field, value) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, [field]: value } : it)));
  };

  const removeItemRow = (idx) => setItems((prev) => prev.filter((_, i) => i !== idx));

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      if (!items.length || items.some((it) => !it.productId)) {
        toast.error(t('combos.itemsRequired'));
        return;
      }
      setSaving(true);
      const payload = {
        productId: values.productId,
        price: values.price,
        items: items.map((it) => ({ productId: it.productId, quantity: it.quantity })),
      };
      if (editing) {
        await axios.patch(`/menu/combos/${editing.id}`, payload);
        toast.success(t('combos.updateSuccess'));
      } else {
        await axios.post('/menu/combos', payload);
        toast.success(t('combos.createSuccess'));
      }
      setModalOpen(false);
      loadData();
    } catch (e) {
      if (e?.errorFields) return;
      toast.error(t('combos.saveError'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (row) => {
    try {
      await axios.delete(`/menu/combos/${row.id}`);
      toast.success(t('combos.deleteSuccess'));
      loadData();
    } catch {
      toast.error(t('combos.deleteError'));
    }
  };

  const columns = [
    {
      title: t('combos.name'),
      dataIndex: ['product', 'name'],
      width: 240,
      render: (name) => <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{name || '—'}</span>,
    },
    {
      title: t('combos.sku'),
      dataIndex: ['product', 'sku'],
      width: 140,
      render: (v) => v ? <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>{v}</span> : '—',
    },
    {
      title: t('combos.items'),
      width: 280,
      render: (_, row) => (
        <Space size={4} wrap>
          {(row.items || []).map((it) => (
            <Tag key={it.id} color="blue">
              {it.product?.name} ×{it.quantity}
            </Tag>
          ))}
        </Space>
      ),
    },
    {
      title: t('combos.price'),
      dataIndex: 'price',
      width: 140,
      align: 'right',
      render: (v) => <MoneyDisplay value={v} />,
    },
    {
      title: t('combos.status'),
      dataIndex: 'isActive',
      width: 110,
      render: (v) => (v === false ? <Tag>Ngừng bán</Tag> : <Tag color="green">Đang bán</Tag>),
    },
    {
      title: '',
      width: 110,
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

  const availableProducts = products.filter((p) => !editing || p.id !== editing.productId);

  return (
    <>
      <PageHeader
        title={t('combos.title')}
        subtitle={t('combos.count', { count: data.length })}
        actions={
          <PermissionGate permission="products.edit">
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              {t('combos.addNew')}
            </Button>
          </PermissionGate>
        }
      />

      <div className="filters-bar">
        <Input
          className="filters-bar__search"
          placeholder={t('combos.searchPlaceholder')}
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
          pagination={{ pageSize: 20, showSizeChanger: false, showTotal: (total) => t('combos.count', { count: total }) }}
          locale={{
            emptyText: (
              <EmptyState
                title={t('combos.empty')}
                description={t('combos.emptyDesc')}
                action={
                  <PermissionGate permission="products.edit">
                    <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
                      {t('combos.addFirst')}
                    </Button>
                  </PermissionGate>
                }
              />
            ),
          }}
        />
      </div>

      <Modal
        title={editing ? t('combos.editTitle') : t('combos.createTitle')}
        open={modalOpen}
        onOk={handleSave}
        onCancel={() => setModalOpen(false)}
        confirmLoading={saving}
        width={640}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Form.Item name="productId" label={t('combos.comboProduct')} rules={[{ required: true, message: t('combos.productRequired') }]}>
              <Select showSearch optionFilterProp="label" options={availableProducts.map((p) => ({ value: p.id, label: p.name }))} />
            </Form.Item>
            <Form.Item name="price" label={t('combos.price')} rules={[{ required: true, message: t('combos.priceRequired') }]}>
              <InputNumber min={0} style={{ width: '100%' }} />
            </Form.Item>
          </div>
          <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong>{t('combos.includeItems')}</strong>
            <Button size="small" type="dashed" icon={<PlusOutlined />} onClick={addItemRow}>
              {t('combos.addItem')}
            </Button>
          </div>
          {items.map((it, idx) => (
            <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1fr 100px 36px', gap: 8, marginBottom: 8 }}>
              <Select
                placeholder={t('combos.itemProduct')}
                value={it.productId || undefined}
                onChange={(v) => updateItemRow(idx, 'productId', v)}
                showSearch
                optionFilterProp="label"
                options={availableProducts.map((p) => ({ value: p.id, label: p.name }))}
              />
              <InputNumber
                placeholder="SL"
                min={1}
                value={it.quantity}
                onChange={(v) => updateItemRow(idx, 'quantity', v || 1)}
              />
              <Button danger type="text" icon={<DeleteOutlined />} onClick={() => removeItemRow(idx)} />
            </div>
          ))}
          {!items.length && (
            <div style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 8 }}>
              {t('combos.noItems')}
            </div>
          )}
        </Form>
      </Modal>
    </>
  );
}
