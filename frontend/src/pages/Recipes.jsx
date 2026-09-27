/**
 * Page: Recipes — Công thức món + COGS (F&B)
 *
 * Tổng quan:
 * - Danh sách công thức theo sản phẩm: phần, nguyên liệu + hao hụt
 * - Upsert công thức, log phế liệu, báo cáo COGS/ biên lợi nhuận
 * - Gọi API: GET/POST /recipe, GET /recipe/cogs, POST /recipe/waste
 *
 * Exports:
 * - Recipes: React functional component (default export)
 */
import { useEffect, useState, useCallback } from 'react';
import { Table, Button, Space, Modal, Form, InputNumber, Select, Input, Tabs, Tag, Tooltip } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, SearchOutlined, FileAddOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import axios from '../api/axios';
import PageHeader from '../components/layout/PageHeader';
import EmptyState from '../components/shared/EmptyState';
import useToast from '../components/shared/useToast';
import PermissionGate from '../components/shared/PermissionGate';
import MoneyDisplay from '../components/shared/MoneyDisplay';

export default function Recipes() {
  const { t } = useTranslation();
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState([]);
  const [products, setProducts] = useState([]);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState('list');
  const [cogs, setCogs] = useState([]);
  const [cogsLoading, setCogsLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [ingredients, setIngredients] = useState([]);
  const [form] = Form.useForm();
  const [wasteModalOpen, setWasteModalOpen] = useState(false);
  const [wasteSaving, setWasteSaving] = useState(false);
  const [wasteForm] = Form.useForm();

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get('/recipe');
      let list = Array.isArray(res.data) ? res.data : (res.data?.data || []);
      if (search) list = list.filter((r) => r.product?.name?.toLowerCase().includes(search.toLowerCase()));
      setData(list);
    } catch {
      toast.error(t('recipes.loadError'));
    } finally {
      setLoading(false);
    }
  }, [search, toast, t]);

  useEffect(() => { loadData(); }, [loadData]);

  const loadOptions = async () => {
    try {
      const res = await axios.get('/products', { params: { limit: 200 } });
      const list = Array.isArray(res.data) ? res.data : (res.data?.data || []);
      setProducts(list);
    } catch { /* optional */ }
  };

  const loadCogs = async () => {
    setCogsLoading(true);
    try {
      const res = await axios.get('/recipe/cogs');
      setCogs(Array.isArray(res.data) ? res.data : (res.data?.data || []));
    } catch {
      toast.error(t('recipes.cogsError'));
    } finally {
      setCogsLoading(false);
    }
  };

  useEffect(() => {
    loadOptions();
    if (activeTab === 'cogs') loadCogs();
  }, [activeTab]);

  const openCreate = () => {
    setEditing(null);
    setIngredients([]);
    form.resetFields();
    form.setFieldsValue({ portions: 1 });
    setModalOpen(true);
  };

  const openEdit = async (row) => {
    setEditing(row);
    try {
      const res = await axios.get(`/recipe/${row.productId}`);
      const recipe = res.data?.data || res.data;
      setIngredients((recipe.ingredients || []).map((ing) => ({
        ingredientProductId: ing.ingredientProductId,
        quantity: ing.quantity,
        wastePercent: ing.wastePercent || 0,
      })));
      form.setFieldsValue({ productId: row.productId, portions: recipe.portions || 1 });
    } catch { /* fallback */ }
    setModalOpen(true);
  };

  const addIngredientRow = () => setIngredients((prev) => [...prev, { ingredientProductId: null, quantity: 1, wastePercent: 0 }]);

  const updateIngredientRow = (idx, field, value) => {
    setIngredients((prev) => prev.map((it, i) => (i === idx ? { ...it, [field]: value } : it)));
  };

  const removeIngredientRow = (idx) => setIngredients((prev) => prev.filter((_, i) => i !== idx));

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      if (ingredients.some((it) => !it.ingredientProductId)) {
        toast.error(t('recipes.ingredientsRequired'));
        return;
      }
      setSaving(true);
      const payload = {
        portions: values.portions,
        ingredients: ingredients.map((it) => ({
          ingredientProductId: it.ingredientProductId,
          quantity: it.quantity,
          wastePercent: it.wastePercent || 0,
        })),
      };
      await axios.post(`/recipe/${values.productId}`, payload);
      toast.success(editing ? t('recipes.updateSuccess') : t('recipes.createSuccess'));
      setModalOpen(false);
      loadData();
    } catch (e) {
      if (e?.errorFields) return;
      toast.error(t('recipes.saveError'));
    } finally {
      setSaving(false);
    }
  };

  const handleLogWaste = async () => {
    try {
      const values = await wasteForm.validateFields();
      setWasteSaving(true);
      await axios.post('/recipe/waste', values);
      toast.success(t('recipes.wasteSuccess'));
      setWasteModalOpen(false);
      wasteForm.resetFields();
    } catch (e) {
      if (e?.errorFields) return;
      toast.error(t('recipes.wasteError'));
    } finally {
      setWasteSaving(false);
    }
  };

  const columns = [
    {
      title: t('recipes.product'),
      dataIndex: ['product', 'name'],
      width: 240,
      render: (name) => <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{name || '—'}</span>,
    },
    {
      title: t('recipes.portions'),
      dataIndex: 'portions',
      width: 100,
      align: 'right',
      render: (v) => v ?? 1,
    },
    {
      title: t('recipes.ingredients'),
      width: 300,
      render: (_, row) => (
        <Space size={4} wrap>
          {(row.ingredients || []).map((ing) => (
            <Tag key={ing.id} color="geekblue">
              {ing.ingredientProduct?.name} ×{ing.quantity}
              {ing.wastePercent ? ` (+${ing.wastePercent}%)` : ''}
            </Tag>
          ))}
        </Space>
      ),
    },
    {
      title: t('recipes.actions'),
      width: 110,
      align: 'right',
      fixed: 'right',
      render: (_, row) => (
        <Space size={4}>
          <Button type="text" size="small" icon={<EditOutlined />} onClick={() => openEdit(row)} />
          <Tooltip title={t('recipes.logWaste')}>
            <Button type="text" size="small" icon={<FileAddOutlined />} onClick={() => {
              wasteForm.resetFields();
              wasteForm.setFieldsValue({ productId: row.productId });
              setWasteModalOpen(true);
            }} />
          </Tooltip>
        </Space>
      ),
    },
  ];

  const cogsColumns = [
    { title: t('recipes.product'), dataIndex: 'name', width: 240, render: (v) => <b>{v}</b> },
    { title: t('recipes.price'), dataIndex: 'price', width: 140, align: 'right', render: (v) => <MoneyDisplay value={v} /> },
    { title: t('recipes.cogs'), dataIndex: 'cogs', width: 140, align: 'right', render: (v) => <MoneyDisplay value={v} /> },
    {
      title: t('recipes.margin'),
      dataIndex: 'margin',
      width: 140,
      align: 'right',
      render: (v) => (
        <span style={{ color: v < 0 ? 'var(--danger)' : v < 30 ? 'var(--warning-dark)' : 'var(--success)' }}>
          {v}%
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title={t('recipes.title')}
        subtitle={t('recipes.count', { count: data.length })}
        actions={
          <Space>
            <PermissionGate permission="products.edit">
              <Button icon={<FileAddOutlined />} onClick={() => { wasteForm.resetFields(); setWasteModalOpen(true); }}>
                {t('recipes.logWaste')}
              </Button>
            </PermissionGate>
            <PermissionGate permission="products.edit">
              <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
                {t('recipes.addNew')}
              </Button>
            </PermissionGate>
          </Space>
        }
      />

      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          {
            key: 'list',
            label: t('recipes.tabList'),
            children: (
              <>
                <div className="filters-bar">
                  <Input
                    className="filters-bar__search"
                    placeholder={t('recipes.searchPlaceholder')}
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
                    rowKey={(r) => r.id || r.productId}
                    loading={loading}
                    scroll={{ x: 800 }}
                    pagination={{ pageSize: 20, showSizeChanger: false, showTotal: (total) => t('recipes.count', { count: total }) }}
                    locale={{
                      emptyText: (
                        <EmptyState
                          title={t('recipes.empty')}
                          description={t('recipes.emptyDesc')}
                          action={
                            <PermissionGate permission="products.edit">
                              <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
                                {t('recipes.addFirst')}
                              </Button>
                            </PermissionGate>
                          }
                        />
                      ),
                    }}
                  />
                </div>
              </>
            ),
          },
          {
            key: 'cogs',
            label: t('recipes.cogsTab'),
            children: (
              <div className="table-card">
                <Table
                  columns={cogsColumns}
                  dataSource={cogs}
                  rowKey="productId"
                  loading={cogsLoading}
                  pagination={false}
                  locale={{ emptyText: <EmptyState title={t('recipes.cogsEmpty')} description={t('recipes.cogsEmptyDesc')} /> }}
                />
              </div>
            ),
          },
        ]}
      />

      <Modal
        title={editing ? t('recipes.editTitle') : t('recipes.createTitle')}
        open={modalOpen}
        onOk={handleSave}
        onCancel={() => setModalOpen(false)}
        confirmLoading={saving}
        width={640}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px', gap: 12 }}>
            <Form.Item name="productId" label={t('recipes.product')} rules={[{ required: true, message: t('recipes.productRequired') }]}>
              <Select
                showSearch
                optionFilterProp="label"
                options={products.map((p) => ({ value: p.id, label: p.name }))}
                disabled={!!editing}
              />
            </Form.Item>
            <Form.Item name="portions" label={t('recipes.portions')}>
              <InputNumber min={1} style={{ width: '100%' }} />
            </Form.Item>
          </div>
          <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong>{t('recipes.ingredients')}</strong>
            <Button size="small" type="dashed" icon={<PlusOutlined />} onClick={addIngredientRow}>
              {t('recipes.addIngredient')}
            </Button>
          </div>
          {ingredients.map((ing, idx) => (
            <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1fr 90px 90px 36px', gap: 8, marginBottom: 8 }}>
              <Select
                placeholder={t('recipes.ingredientProduct')}
                value={ing.ingredientProductId || undefined}
                onChange={(v) => updateIngredientRow(idx, 'ingredientProductId', v)}
                showSearch
                optionFilterProp="label"
                options={products.filter((p) => !editing || p.id !== editing.productId).map((p) => ({ value: p.id, label: p.name }))}
              />
              <InputNumber placeholder="SL" min={0.01} step={0.1} value={ing.quantity} onChange={(v) => updateIngredientRow(idx, 'quantity', v || 1)} />
              <InputNumber placeholder="% hao" min={0} max={100} value={ing.wastePercent} onChange={(v) => updateIngredientRow(idx, 'wastePercent', v || 0)} />
              <Button danger type="text" icon={<DeleteOutlined />} onClick={() => removeIngredientRow(idx)} />
            </div>
          ))}
          {!ingredients.length && (
            <div style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 8 }}>
              {t('recipes.noIngredients')}
            </div>
          )}
        </Form>
      </Modal>

      <Modal
        title={t('recipes.wasteTitle')}
        open={wasteModalOpen}
        onOk={handleLogWaste}
        onCancel={() => setWasteModalOpen(false)}
        confirmLoading={wasteSaving}
        destroyOnClose
      >
        <Form form={wasteForm} layout="vertical">
          <Form.Item name="productId" label={t('recipes.product')} rules={[{ required: true, message: t('recipes.productRequired') }]}>
            <Select showSearch optionFilterProp="label" options={products.map((p) => ({ value: p.id, label: p.name }))} />
          </Form.Item>
          <Form.Item name="quantity" label={t('recipes.wasteQuantity')} rules={[{ required: true, message: t('recipes.wasteQtyRequired') }]}>
            <InputNumber min={0.01} step={0.1} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="reason" label={t('recipes.wasteReason')}>
            <Input.TextArea rows={2} placeholder={t('recipes.wasteReasonPlaceholder')} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
