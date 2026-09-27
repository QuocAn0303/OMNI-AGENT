import { useState, useCallback, useEffect, useRef, useReducer } from 'react';
import { Modal, Input, List, Typography, Tag, Spin, Empty } from 'antd';
import { SearchOutlined, ProductOutlined, ShoppingCartOutlined, UserOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { globalSearch } from '../../api/search';

export default function GlobalSearch({ open, onClose }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const inputRef = useRef(null);
  const [query, queryDispatch] = useReducer((_, value) => value, '');
  const [results, resultsDispatch] = useReducer(
    (_, action) => action,
    { products: [], orders: [], customers: [] }
  );
  const [loading, setLoading] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => {
    if (open) {
      const focusTimer = setTimeout(() => inputRef.current?.focus(), 100);
      queryDispatch('');
      resultsDispatch({ products: [], orders: [], customers: [] });
      return () => clearTimeout(focusTimer);
    }
  }, [open]);

  const doSearch = useCallback((q) => {
    if (q.length < 2) {
      resultsDispatch({ products: [], orders: [], customers: [] });
      setLoading(false);
      return;
    }
    setLoading(true);
    globalSearch(q)
      .then((data) => resultsDispatch(data))
      .catch(() => resultsDispatch({ products: [], orders: [], customers: [] }))
      .finally(() => setLoading(false));
  }, []);

  const handleSearch = (value) => {
    queryDispatch(value);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => doSearch(value), 250);
  };

  const handleSelect = (type, item) => {
    onClose();
    const paths = {
      product: `/products/${item.id}/edit`,
      order: `/orders`,
      customer: `/customers/${item.id}`,
    };
    navigate(paths[type]);
  };

  const sections = [
    { key: 'products', icon: <ProductOutlined />, label: t('menu.products'), data: results.products, type: 'product' },
    { key: 'orders', icon: <ShoppingCartOutlined />, label: t('orders.title'), data: results.orders, type: 'order' },
    { key: 'customers', icon: <UserOutlined />, label: t('menu.customers'), data: results.customers, type: 'customer' },
  ];

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width={560}
      destroyOnClose
      styles={{ body: { padding: '16px 0' } }}
    >
      <div style={{ padding: '0 16px 12px' }}>
        <Input.Search
          ref={inputRef}
          size="large"
          placeholder={t('common.search')}
          prefix={<SearchOutlined style={{ color: 'var(--color-text-tertiary, #94a3b8)' }} />}
          value={query}
          onChange={(e) => handleSearch(e.target.value)}
          onSearch={(value) => doSearch(value)}
        />
      </div>

      {loading && (
        <div style={{ textAlign: 'center', padding: 32 }}>
          <Spin />
        </div>
      )}

      {!loading && query.length > 0 && !results.products.length && !results.orders.length && !results.customers.length && (
        <Empty description={t('common.noData')} style={{ padding: 32 }} />
      )}

      {!loading && sections.map((section) =>
        section.data.length > 0 ? (
          <div key={section.key} style={{ padding: '0 16px', marginBottom: 16 }}>
            <Typography.Text strong style={{ fontSize: 12, color: 'var(--color-text-tertiary, #94a3b8)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {section.icon} {section.label}
            </Typography.Text>
            <List
              size="small"
              dataSource={section.data}
              renderItem={(item) => (
                <List.Item
                  onClick={() => handleSelect(section.type, item)}
                  style={{ cursor: 'pointer', borderRadius: 8, padding: '8px 12px' }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-bg-layout, #f1f5f9)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                >
                  {section.type === 'product' && (
                    <List.Item.Meta
                      title={<Typography.Text strong>{item.name}</Typography.Text>}
                      description={<><Typography.Text code>{item.sku}</Typography.Text> — <Typography.Text type="success">{Number(item.price).toLocaleString()}₫</Typography.Text></>}
                    />
                  )}
                  {section.type === 'order' && (
                    <List.Item.Meta
                      title={<Typography.Text strong>{item.orderCode}</Typography.Text>}
                      description={<Typography.Text type="success">{Number(item.total).toLocaleString()}₫</Typography.Text>}
                    />
                  )}
                  {section.type === 'customer' && (
                    <List.Item.Meta
                      title={<Typography.Text strong>{item.name}</Typography.Text>}
                      description={<Typography.Text type="secondary">{item.phone || item.email}</Typography.Text>}
                    />
                  )}
                </List.Item>
              )}
            />
          </div>
        ) : null
      )}
    </Modal>
  );
}
