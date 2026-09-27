/**
 * Page: ModifierGroups — Nhóm tùy chọn món (F&B)
 *
 * Tổng quan:
 * - Danh sách nhóm tùy chọn (topping, size, đường, đá...) theo sản phẩm
 * - CRUD ModifierGroup + ModifierOption qua Form Modal
 * - Gọi API: GET/POST/PATCH/DELETE /menu/modifier-groups, POST /menu/modifier-groups/:id/options, PATCH/DELETE /menu/modifier-options/:id
 *
 * Exports:
 * - ModifierGroups: React functional component (default export)
 */
import { useEffect, useState, useCallback } from 'react';
import { Table, Button, Space, Popconfirm, Modal, Form, Input, InputNumber, Select, Switch, Tag } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, SearchOutlined, AppstoreAddOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import axios from '../api/axios';
import PageHeader from '../components/layout/PageHeader';
import EmptyState from '../components/shared/EmptyState';
import useToast from '../components/shared/useToast';
import PermissionGate from '../components/shared/PermissionGate';

export default function ModifierGroups() {
  const { t } = useTranslation();
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState([]);
  const [products, setProducts] = useState([]);
  const [productFilter, setProductFilter] = useState(null);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [optionModalOpen, setOptionModalOpen] = useState(false);
  const [optionGroup, setOptionGroup] = useState(null);
  const [editingOption, setEditingOption] = useState(null);
  const [optionSaving, setOptionSaving] = useState(false);
  const [form] = Form.useForm();
  const [optionForm] = Form.useForm();

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get('/menu/modifier-groups', { params: { productId: productFilter || undefined } });
      let list = Array.isArray(res.data) ? res.data : (res.data?.data || []);
      if (search) list = list.filter((g) => g.name?.toLowerCase().includes(search.toLowerCase()));
      setData(list);
    } catch {
      toast.error(t('modifiers.loadError'));
    } finally {
      setLoading(false);
    }
  }, [productFilter, search, toast, t]);

  useEffect(() => { loadData(); }, [loadData]);

  const loadProducts = async () => {
    try {
      const res = await axios.get('/products', { params: { limit: 200 } });
      setProducts(Array.isArray(res.data) ? res.data : (res.data?.data || []));
    } catch { /* optional */ }
  };

  useEffect(() => { loadProducts(); }, []);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ type: 'SINGLE', isRequired: false, minSelect: 0, maxSelect: 1, sortOrder: 0 });
    setModalOpen(true);
  };

  const openEdit = (row) => {
    setEditing(row);
    form.setFieldsValue({
      productId: row.productId,
      name: row.name,
      type: row.type,
      isRequired: row.isRequired,
      minSelect: row.minSelect,
      maxSelect: row.maxSelect,
      sortOrder: row.sortOrder,
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      if (editing) {
        await axios.patch(`/menu/modifier-groups/${editing.id}`, values);
        toast.success(t('modifiers.updateSuccess'));
      } else {
        await axios.post('/menu/modifier-groups', values);
        toast.success(t('modifiers.createSuccess'));
      }
      setModalOpen(false);
      loadData();
    } catch (e) {
      if (e?.errorFields) return;
      toast.error(t('modifiers.saveError'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (row) => {
    try {
      await axios.delete(`/menu/modifier-groups/${row.id}`);
      toast.success(t('modifiers.deleteSuccess'));
      loadData();
    } catch {
      toast.error(t('modifiers.deleteError'));
    }
  };

  const openCreateOption = (group) => {
    setOptionGroup(group);
    setEditingOption(null);
    optionForm.resetFields();
    optionForm.setFieldsValue({ priceAdjust: 0, sortOrder: 0 });
    setOptionModalOpen(true);
  };

  const openEditOption = (group, opt) => {
    setOptionGroup(group);
    setEditingOption(opt);
    optionForm.setFieldsValue({ name: opt.name, priceAdjust: opt.priceAdjust, sortOrder: opt.sortOrder });
    setOptionModalOpen(true);
  };

  const handleSaveOption = async () => {
    try {
      const values = await optionForm.validateFields();
      setOptionSaving(true);
      if (editingOption) {
        await axios.patch(`/menu/modifier-options/${editingOption.id}`, values);
        toast.success(t('modifiers.optionUpdateSuccess'));
      } else {
        await axios.post(`/menu/modifier-groups/${optionGroup.id}/options`, values);
        toast.success(t('modifiers.optionCreateSuccess'));
      }
      setOptionModalOpen(false);
      loadData();
    } catch (e) {
      if (e?.errorFields) return;
      toast.error(t('modifiers.saveError'));
    } finally {
      setOptionSaving(false);
    }
  };

  const handleDeleteOption = async (opt) => {
    try {
      await axios.delete(`/menu/modifier-options/${opt.id}`);
      toast.success(t('modifiers.deleteSuccess'));
      loadData();
    } catch {
      toast.error(t('modifiers.deleteError'));
    }
  };

  const productName = (id) => products.find((p) => p.id === id)?.name || id;

  const columns = [
    {
      title: t('modifiers.name'),
      dataIndex: 'name',
      width: 220,
      render: (name) => <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{name}</span>,
    },
    {
      title: t('modifiers.product'),
      dataIndex: 'productId',
      width: 200,
      render: (id) => productName(id),
    },
    {
      title: t('modifiers.type'),
      dataIndex: 'type',
      width: 110,
      render: (v) => (v === 'MULTIPLE' ? <Tag color="blue">Nhiều lựa chọn</Tag> : <Tag>Một lựa chọn</Tag>),
    },
    {
      title: t('modifiers.required'),
      dataIndex: 'isRequired',
      width: 90,
      render: (v) => (v ? <Tag color="orange">Bắt buộc</Tag> : '—'),
    },
    {
      title: t('modifiers.selection'),
      width: 130,
      render: (_, row) => `${row.minSelect ?? 0} – ${row.maxSelect ?? 1}`,
    },
    {
      title: t('modifiers.options'),
      width: 220,
      render: (_, row) => (
        <Space size={4} wrap>
          {(row.options || []).map((o) => (
            <Tag
              key={o.id}
              closable
              onClose={(e) => { e.preventDefault(); handleDeleteOption(o); }}
              style={{ cursor: 'default' }}
            >
              {o.name}
              {o.priceAdjust ? ` +${o.priceAdjust.toLocaleString('vi-VN')}đ` : ''}
              <Button
                type="text"
                size="small"
                icon={<EditOutlined />}
                onClick={() => openEditOption(row, o)}
                style={{ marginLeft: 4, padding: 0, height: 14, fontSize: 10 }}
              />
            </Tag>
          ))}
          <Button type="text" size="small" icon={<AppstoreAddOutlined />} onClick={() => openCreateOption(row)}>
            {t('modifiers.addOption')}
          </Button>
        </Space>
      ),
    },
    {
      title: t('common.actions'),
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

  return (
    <>
      <PageHeader
        title={t('modifiers.title')}
        subtitle={t('modifiers.count', { count: data.length })}
        actions={
          <PermissionGate permission="products.edit">
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              {t('modifiers.addNew')}
            </Button>
          </PermissionGate>
        }
      />

      <div className="filters-bar">
        <Input
          className="filters-bar__search"
          placeholder={t('modifiers.searchPlaceholder')}
          prefix={<SearchOutlined style={{ color: 'var(--text-muted)' }} />}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          allowClear
        />
        <Select
          placeholder={t('modifiers.product')}
          style={{ width: 220 }}
          value={productFilter}
          onChange={setProductFilter}
          allowClear
          showSearch
          optionFilterProp="label"
          options={products.map((p) => ({ value: p.id, label: p.name }))}
        />
      </div>

      <div className="table-card">
        <Table
          columns={columns}
          dataSource={data}
          rowKey="id"
          loading={loading}
          scroll={{ x: 1000 }}
          pagination={{ pageSize: 20, showSizeChanger: false, showTotal: (total) => t('modifiers.count', { count: total }) }}
          locale={{
            emptyText: (
              <EmptyState
                title={t('modifiers.empty')}
                description={t('modifiers.emptyDesc')}
                action={
                  <PermissionGate permission="products.edit">
                    <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
                      {t('modifiers.addFirst')}
                    </Button>
                  </PermissionGate>
                }
              />
            ),
          }}
        />
      </div>

      <Modal
        title={editing ? t('modifiers.editTitle') : t('modifiers.createTitle')}
        open={modalOpen}
        onOk={handleSave}
        onCancel={() => setModalOpen(false)}
        confirmLoading={saving}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item name="productId" label={t('modifiers.product')} rules={[{ required: true, message: t('modifiers.productRequired') }]}>
            <Select showSearch optionFilterProp="label" options={products.map((p) => ({ value: p.id, label: p.name }))} />
          </Form.Item>
          <Form.Item name="name" label={t('modifiers.name')} rules={[{ required: true, message: t('modifiers.nameRequired') }]}>
            <Input />
          </Form.Item>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Form.Item name="type" label={t('modifiers.type')}>
              <Select
                options={[
                  { value: 'SINGLE', label: 'Một lựa chọn' },
                  { value: 'MULTIPLE', label: 'Nhiều lựa chọn' },
                ]}
              />
            </Form.Item>
            <Form.Item name="isRequired" label={t('modifiers.required')} valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item name="minSelect" label={t('modifiers.minSelect')}>
              <InputNumber min={0} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="maxSelect" label={t('modifiers.maxSelect')}>
              <InputNumber min={1} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="sortOrder" label={t('modifiers.sortOrder')}>
              <InputNumber style={{ width: '100%' }} />
            </Form.Item>
          </div>
        </Form>
      </Modal>

      <Modal
        title={editingOption ? t('modifiers.optionEditTitle') : t('modifiers.optionCreateTitle')}
        open={optionModalOpen}
        onOk={handleSaveOption}
        onCancel={() => setOptionModalOpen(false)}
        confirmLoading={optionSaving}
        destroyOnClose
      >
        <Form form={optionForm} layout="vertical">
          <Form.Item name="name" label={t('modifiers.optionName')} rules={[{ required: true, message: t('modifiers.optionNameRequired') }]}>
            <Input />
          </Form.Item>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Form.Item name="priceAdjust" label={t('modifiers.priceAdjust')}>
              <InputNumber min={0} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="sortOrder" label={t('modifiers.sortOrder')}>
              <InputNumber style={{ width: '100%' }} />
            </Form.Item>
          </div>
        </Form>
      </Modal>
    </>
  );
}
