/**
 * Frontend: src/pages/QrOrderingPage.jsx — PWA QR đặt món (trang KHÁCH HÀNG, không cần đăng nhập)
 *
 * URL: /q/:qrToken (hoặc /qr/:qrToken — link cũ từ QrOrderingSetup)
 *
 * Flow:
 * 1. Khách quét QR bàn → mở menu theo category (tabs dính trên cùng)
 * 2. Chọn món + tùy chọn (modifier: SINGLE/MULTIPLE/REQUIRED) → giỏ hàng (drawer đáy)
 * 3. Đặt món → backend tự gửi bếp (KDS) → lưu publicToken → view theo dõi
 * 4. Theo dõi trạng thái từng món (PENDING → FIRED → SERVED) bằng polling 6s
 * 5. Gọi phục vụ, thanh toán VietQR, feedback
 *
 * Dùng qrApi (axios public, không interceptor JWT) — khách không có token.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Spin, Empty, Result, Tabs, Card, Tag, Button, Drawer, Modal, Input,
  Rate, message, Typography, Badge, FloatButton, Space, Checkbox, Radio, Divider, Alert,
} from 'antd';
import {
  PlusOutlined, MinusOutlined, ShoppingOutlined, BellOutlined,
  BankOutlined, StarOutlined, EnvironmentOutlined, ArrowLeftOutlined, CheckCircleOutlined,
} from '@ant-design/icons';
import { QRCodeSVG } from 'qrcode.react';
import { useParams } from 'react-router-dom';
import qrApi from '../api/qrAxios';

const { Text, Title } = Typography;

const fmtMoney = (v) => (v == null ? '—' : Number(v).toLocaleString('vi-VN'));

const ITEM_STATUS_MAP = {
  PENDING: { color: 'default', label: 'Chờ bếp' },
  FIRED: { color: 'processing', label: 'Đang chế biến' },
  SERVED: { color: 'success', label: 'Đã lên món' },
  VOIDED: { color: 'error', label: 'Đã hủy' },
};

const ORDER_STATUS_MAP = {
  PENDING: { color: 'default', label: 'Chờ xác nhận' },
  CONFIRMED: { color: 'processing', label: 'Bếp đang chuẩn bị' },
  COMPLETED: { color: 'success', label: 'Hoàn thành' },
  CANCELLED: { color: 'error', label: 'Đã hủy' },
};

export default function QrOrderingPage() {
  const { qrToken } = useParams();

  const [menu, setMenu] = useState(null);
  const [table, setTable] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [cart, setCart] = useState([]);
  const [cartOpen, setCartOpen] = useState(false);

  const [addModal, setAddModal] = useState(null);
  const [selMods, setSelMods] = useState({});
  const [addQty, setAddQty] = useState(1);

  const [customerName, setCustomerName] = useState('');
  const [orderNote, setOrderNote] = useState('');
  const [placing, setPlacing] = useState(false);

  const storageKey = useMemo(() => (qrToken ? `qr_order_${qrToken}` : null), [qrToken]);
  const [publicToken, setPublicToken] = useState(() => (storageKey ? localStorage.getItem(storageKey) : null));

  const loadMenu = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await qrApi.get(`/qr/menu/${qrToken}`);
      const data = res.data?.data || {};
      setMenu(data.menu || {});
      setTable(data.table || null);
    } catch (e) {
      setError(e.response?.data?.message || 'Không tải được menu');
    } finally {
      setLoading(false);
    }
  }, [qrToken]);

  useEffect(() => { loadMenu(); }, [loadMenu]);

  const cartCount = useMemo(() => cart.reduce((s, it) => s + it.qty, 0), [cart]);
  const cartTotal = useMemo(() => cart.reduce((s, it) => s + it.unitPrice * it.qty, 0), [cart]);

  // Menu items theo category (dùng cho Tabs) — khai báo trước các early-return
  const categories = useMemo(() => Object.keys(menu || {}), [menu]);
  const menuItems = useMemo(() => {
    if (!menu) return [];
    return categories.map((cat) => ({
      key: cat,
      label: cat,
      children: (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {menu[cat].map((p) => (
            <Card key={p.id} size="small" styles={{ body: { padding: 10 } }}
              cover={p.imageUrl ? (
                <img src={p.imageUrl} alt={p.name} style={{ width: '100%', aspectRatio: '1/1', objectFit: 'cover', borderTopLeftRadius: 8, borderTopRightRadius: 8 }} />
              ) : (
                <div style={{ width: '100%', aspectRatio: '1/1', background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#cbd5e1', fontSize: 28 }}>
                  <ShoppingOutlined />
                </div>
              )}
            >
              <div style={{ minHeight: 74, position: 'relative', paddingBottom: 26 }}>
                <Text strong style={{ display: 'block', fontSize: 13 }} ellipsis={{ tooltip: p.name }}>{p.name}</Text>
                <Text type="secondary" style={{ fontSize: 11, display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                  {p.description || ''}
                </Text>
                <Text strong style={{ color: 'var(--color-primary, #0d9488)', fontSize: 13 }}>{fmtMoney(p.price)}đ</Text>
                <Button type="primary" shape="circle" size="small"
                  icon={<PlusOutlined />}
                  style={{ position: 'absolute', right: 0, bottom: 0 }}
                  onClick={() => openAddModal(p)} />
              </div>
            </Card>
          ))}
        </div>
      ),
    }));
  }, [menu, categories]);

  // ============ GIỎ HÀNG ============

  const addItem = (product, selectedMods) => {
    const mods = Object.entries(selectedMods)
      .filter(([, optIds]) => optIds && optIds.length)
      .map(([groupId, optIds]) => {
        const group = product.modifierGroups?.find((g) => g.id === groupId);
        const opts = (group?.options || []).filter((o) => optIds.includes(o.id));
        return {
          groupId,
          groupName: group?.name || '',
          optionIds: optIds,
          optionNames: opts.map((o) => o.name),
          adjust: opts.reduce((s, o) => s + Number(o.priceAdjust || 0), 0),
        };
      });
    const adjust = mods.reduce((s, m) => s + m.adjust, 0);
    const unitPrice = Number(product.price) + adjust;
    const key = `${product.id}|${mods.map((m) => [...m.optionIds].sort().join(',')).join(';')}`;

    setCart((prev) => {
      const found = prev.find((it) => it.key === key);
      if (found) {
        return prev.map((it) => (it.key === key ? { ...it, qty: it.qty + 1 } : it));
      }
      return [...prev, {
        key, product, qty: 1, modifiers: mods, unitPrice,
      }];
    });
    message.success(`Đã thêm ${product.name} vào giỏ`);
    setAddModal(null);
    setSelMods({});
    setAddQty(1);
  };

  const updateQty = (key, delta) => {
    setCart((prev) => prev
      .map((it) => (it.key === key ? { ...it, qty: it.qty + delta } : it))
      .filter((it) => it.qty > 0));
  };

  const placeOrder = async () => {
    if (cart.length === 0) return;
    setPlacing(true);
    try {
      const items = cart.map((it) => ({
        productId: it.product.id,
        quantity: it.qty,
        modifiers: it.modifiers.length
          ? it.modifiers.map((m) => ({ groupId: m.groupId, optionIds: m.optionIds }))
          : undefined,
      }));
      const res = await qrApi.post(`/qr/order/${qrToken}`, {
        items,
        customerName: customerName.trim() || undefined,
        note: orderNote.trim() || undefined,
      });
      const { publicToken: token } = res.data?.data || {};
      if (!token) throw new Error('Không nhận được token đơn hàng');
      if (storageKey) localStorage.setItem(storageKey, token);
      setPublicToken(token);
      setCartOpen(false);
      setCart([]);
      setCustomerName('');
      setOrderNote('');
    } catch (e) {
      message.error(e.response?.data?.message || 'Không đặt được món — thử lại');
    } finally {
      setPlacing(false);
    }
  };

  // ============ MODIFIER MODAL ============

  const openAddModal = (product) => {
    const initial = {};
    for (const g of product.modifierGroups || []) {
      if (g.type === 'REQUIRED' && g.minSelect === 1 && g.options?.length === 1) {
        initial[g.id] = [g.options[0].id]; // auto chọn option duy nhất
      }
    }
    setSelMods(initial);
    setAddQty(1);
    setAddModal(product);
  };

  const canConfirmModifier = (product) => {
    for (const g of product.modifierGroups || []) {
      const n = (selMods[g.id] || []).length;
      if (g.type === 'REQUIRED' && n < (g.minSelect || 1)) return false;
    }
    return true;
  };

  // ============ VIEW THEO DÕI ============

  const [orderInfo, setOrderInfo] = useState(null);
  const [pollErr, setPollErr] = useState(false);
  const [waiterOpen, setWaiterOpen] = useState(false);
  const [waiterNote, setWaiterNote] = useState('');
  const [waiterBusy, setWaiterBusy] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [payInfo, setPayInfo] = useState(null);
  const [payLoading, setPayLoading] = useState(false);
  const [fbOpen, setFbOpen] = useState(false);
  const [fbRating, setFbRating] = useState(5);
  const [fbComment, setFbComment] = useState('');
  const [fbBusy, setFbBusy] = useState(false);

  const refreshStatus = useCallback(async () => {
    if (!publicToken) return;
    try {
      const res = await qrApi.get(`/qr/order/${publicToken}`);
      setOrderInfo(res.data?.data || null);
      setPollErr(false);
    } catch {
      setPollErr(true);
    }
  }, [publicToken]);

  useEffect(() => {
    if (!publicToken) return undefined;
    refreshStatus();
    const timer = setInterval(refreshStatus, 6000);
    return () => clearInterval(timer);
  }, [publicToken, refreshStatus]);

  const order = orderInfo?.order || null;

  const callWaiter = async () => {
    setWaiterBusy(true);
    try {
      await qrApi.post(`/qr/order/${publicToken}/call-waiter`, { note: waiterNote.trim() || undefined });
      message.success('Đã báo nhân viên — họ sẽ đến ngay');
      setWaiterOpen(false);
      setWaiterNote('');
    } catch (e) {
      message.error(e.response?.data?.message || 'Không gửi được');
    } finally {
      setWaiterBusy(false);
    }
  };

  const fetchPay = async () => {
    setPayOpen(true);
    setPayLoading(true);
    setPayInfo(null);
    try {
      const res = await qrApi.get(`/qr/order/${publicToken}/pay`);
      setPayInfo(res.data?.data || null);
    } catch (e) {
      message.error(e.response?.data?.message || 'Không tạo được mã thanh toán');
      setPayOpen(false);
    } finally {
      setPayLoading(false);
    }
  };

  const submitFeedback = async () => {
    setFbBusy(true);
    try {
      await qrApi.post(`/qr/feedback/${publicToken}`, { rating: fbRating, comment: fbComment.trim() || undefined });
      message.success('Cảm ơn bạn đã đánh giá!');
      setFbOpen(false);
      setFbComment('');
    } catch (e) {
      message.error(e.response?.data?.message || 'Không gửi được đánh giá');
    } finally {
      setFbBusy(false);
    }
  };

  const resetToMenu = () => {
    if (storageKey) localStorage.removeItem(storageKey);
    setPublicToken(null);
    setOrderInfo(null);
    setCart([]);
  };

  // ============ RENDER ============

  if (loading) {
    return (
      <div style={centerStyle}>
        <Spin size="large" />
        <Text type="secondary" style={{ marginTop: 12 }}>Đang tải menu…</Text>
      </div>
    );
  }

  if (error) {
    return (
      <div style={centerStyle}>
        <Result status="warning" title="Không mở được menu" subTitle={error} />
        <Button type="primary" onClick={() => window.location.reload()}>Thử lại</Button>
      </div>
    );
  }

  // ----- Tracking view -----
  if (publicToken) {
    const orderCfg = ORDER_STATUS_MAP[order?.status] || { color: 'default', label: order?.status || 'Đang tải' };
    const paid = order?.paymentStatus === 'PAID';

    return (
      <div style={pageStyle}>
        <div style={headerStyle}>
          <Title level={4} style={{ margin: 0, color: '#fff' }}>Đơn của bạn</Title>
          <Text style={{ color: 'rgba(255,255,255,.85)', fontSize: 13 }}>
            Bàn {orderInfo?.tableName || table?.code || ''} · {order?.orderCode || ''}
          </Text>
        </div>

        <div style={{ padding: 16 }}>
          {pollErr && (
            <Alert type="warning" showIcon style={{ marginBottom: 12 }}
              message="Mất kết nối — đang thử lại…" />
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <Tag color={orderCfg.color} style={{ fontSize: 13, padding: '4px 10px' }}>{orderCfg.label}</Tag>
            {paid && <Tag color="success" icon={<CheckCircleOutlined />}>Đã thanh toán</Tag>}
          </div>

          <Card size="small" style={{ marginBottom: 12 }}>
            {order?.items?.length ? order.items.map((it) => {
              const cfg = ITEM_STATUS_MAP[it.status] || { color: 'default', label: it.status };
              return (
                <div key={it.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '8px 0', borderBottom: '1px solid #f1f5f9' }}>
                  <div style={{ flex: 1 }}>
                    <Space size={8} wrap>
                      <Text strong>{it.product?.name}</Text>
                      {it.quantity > 1 && <Tag>×{it.quantity}</Tag>}
                      <Tag color={cfg.color}>{cfg.label}</Tag>
                    </Space>
                    {it.modifiers?.length > 0 && (
                      <div style={{ marginTop: 4 }}>
                        {it.modifiers.map((m) => (
                          <Text key={m.id} type="secondary" style={{ fontSize: 12, display: 'block' }}>
                            + {m.modifierOption?.name}
                            {Number(m.priceAdjust) > 0 ? ` (+${fmtMoney(m.priceAdjust)}đ)` : ''}
                          </Text>
                        ))}
                      </div>
                    )}
                  </div>
                  <Text strong style={{ whiteSpace: 'nowrap' }}>{fmtMoney(Number(it.price) * Number(it.quantity))}đ</Text>
                </div>
              );
            }) : (
              <Empty description="Đang tải món…" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            )}
          </Card>

          <Card size="small" style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <Text>Tổng cộng</Text>
              <Text strong style={{ fontSize: 18, color: 'var(--color-primary, #0d9488)' }}>{fmtMoney(order?.total)}đ</Text>
            </div>
          </Card>

          <Space direction="vertical" style={{ width: '100%' }} size={10}>
            <Button block size="large" icon={<BellOutlined />} onClick={() => setWaiterOpen(true)}>
              Gọi phục vụ
            </Button>
            <Button block size="large" icon={<BankOutlined />} disabled={paid} onClick={fetchPay}>
              {paid ? 'Đã thanh toán' : 'Thanh toán ngay'}
            </Button>
            <Button block size="large" icon={<StarOutlined />} onClick={() => setFbOpen(true)}>
              Đánh giá quán
            </Button>
            {order?.status === 'COMPLETED' && (
              <Button block size="large" icon={<ArrowLeftOutlined />} onClick={resetToMenu}>
                Đặt món thêm
              </Button>
            )}
          </Space>
        </div>

        {/* Gọi phục vụ */}
        <Modal title="Gọi phục vụ" open={waiterOpen} onCancel={() => setWaiterOpen(false)}
          footer={null} destroyOnClose>
          <Input.TextArea rows={2} maxLength={200} value={waiterNote}
            onChange={(e) => setWaiterNote(e.target.value)}
            placeholder="Ghi chú (vd: cần thêm nước, mang khăn giấy…) — không bắt buộc" />
          <Button type="primary" block size="large" style={{ marginTop: 12 }} loading={waiterBusy} onClick={callWaiter}>
            Báo nhân viên
          </Button>
        </Modal>

        {/* Thanh toán */}
        <Modal title="Thanh toán chuyển khoản" open={payOpen}
          onCancel={() => setPayOpen(false)} footer={null} destroyOnClose>
          {payLoading ? (
            <div style={centerStyle}><Spin /></div>
          ) : payInfo?.qrString ? (
            <div style={{ textAlign: 'center' }}>
              <div style={{ display: 'inline-block', padding: 16, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12 }}>
                <QRCodeSVG value={payInfo.qrString} size={220} includeMargin />
              </div>
              <Text strong style={{ display: 'block', fontSize: 20, marginTop: 12 }}>{fmtMoney(payInfo.total)}đ</Text>
              <Space direction="vertical" size={4} style={{ marginTop: 8 }}>
                <Text type="secondary">Ngân hàng: {payInfo.bankInfo.bankName}</Text>
                <Text type="secondary">Số tài khoản: {payInfo.bankInfo.accountNumber}</Text>
                <Text type="secondary">Chủ tài khoản: {payInfo.bankInfo.accountName}</Text>
              </Space>
              <Text type="secondary" style={{ display: 'block', fontSize: 12, marginTop: 8 }}>
                Quét mã bằng app ngân hàng — nhân viên sẽ xác nhận khi nhận được tiền
              </Text>
            </div>
          ) : (
            <Empty description="Quán chưa cấu hình tài khoản ngân hàng — vui lòng thanh toán trực tiếp tại quầy" />
          )}
        </Modal>

        {/* Feedback */}
        <Modal title="Đánh giá quán" open={fbOpen} onCancel={() => setFbOpen(false)}
          footer={null} destroyOnClose>
          <div style={{ textAlign: 'center', padding: '8px 0' }}>
            <Rate value={fbRating} onChange={setFbRating} style={{ fontSize: 28 }} />
            <Input.TextArea rows={3} maxLength={500} value={fbComment}
              onChange={(e) => setFbComment(e.target.value)}
              placeholder="Chia sẻ trải nghiệm của bạn (không bắt buộc)" style={{ marginTop: 12 }} />
            <Button type="primary" block size="large" style={{ marginTop: 12 }} loading={fbBusy} onClick={submitFeedback}>
              Gửi đánh giá
            </Button>
          </div>
        </Modal>
      </div>
    );
  }

  // ----- Menu view -----
  return (
    <div style={pageStyle}>
      <div style={headerStyle}>
        <Title level={4} style={{ margin: 0, color: '#fff' }}>Thực đơn</Title>
        <Space size={8}>
          {table && (
            <Text style={{ color: 'rgba(255,255,255,.85)', fontSize: 13 }}>
              <EnvironmentOutlined /> Bàn {table.code}{table.areaName ? ` · ${table.areaName}` : ''}
            </Text>
          )}
        </Space>
      </div>

      {cartCount > 0 && (
        <Alert type="success" showIcon style={{ margin: '12px 16px 0' }}
          message={`${cartCount} món trong giỏ — ${fmtMoney(cartTotal)}đ`}
          action={<Button size="small" type="primary" onClick={() => setCartOpen(true)}>Xem giỏ</Button>} />
      )}

      {categories.length === 0 ? (
        <div style={{ padding: 40 }}>
          <Empty description="Quán chưa cập nhật món — vui lòng gọi nhân viên" />
        </div>
      ) : (
        <Tabs
          items={menuItems}
          tabBarStyle={{ position: 'sticky', top: 0, zIndex: 5, background: '#f8fafc', marginBottom: 12, paddingTop: 8 }}
          style={{ padding: '0 16px 80px' }}
        />
      )}

      {cartCount > 0 && (
        <FloatButton
          shape="circle"
          type="primary"
          style={{ right: 20, bottom: 40, width: 60, height: 60 }}
          icon={
            <Badge count={cartCount} overflowCount={99} size="small" offset={[-8, 8]}>
              <ShoppingOutlined style={{ fontSize: 24 }} />
            </Badge>
          }
          onClick={() => setCartOpen(true)}
        />
      )}

      {/* Modifier modal */}
      <Modal
        title={addModal ? addModal.name : ''}
        open={!!addModal}
        onCancel={() => { setAddModal(null); setSelMods({}); }}
        footer={null}
        destroyOnClose
      >
        {addModal && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <Text strong style={{ fontSize: 16 }}>{fmtMoney(Number(addModal.price))}đ</Text>
              <Space>
                <Button size="small" shape="circle" icon={<MinusOutlined />} disabled={addQty <= 1}
                  onClick={() => setAddQty((q) => q - 1)} />
                <Text strong>{addQty}</Text>
                <Button size="small" shape="circle" icon={<PlusOutlined />}
                  onClick={() => setAddQty((q) => Math.min(q + 1, 99))} />
              </Space>
            </div>

            {(addModal.modifierGroups || []).map((g) => {
              const selected = selMods[g.id] || [];
              const toggle = (optId) => {
                const next = new Set(selected);
                if (g.type === 'SINGLE') next.clear();
                if (next.has(optId)) next.delete(optId);
                else if (g.maxSelect > 0 && next.size >= g.maxSelect) {
                  message.warning(`Chỉ chọn tối đa ${g.maxSelect} lựa chọn`);
                  return;
                } else next.add(optId);
                setSelMods((prev) => ({ ...prev, [g.id]: [...next] }));
              };
              return (
                <div key={g.id} style={{ marginBottom: 16 }}>
                  <Space size={6} style={{ marginBottom: 6 }}>
                    <Text strong>{g.name}</Text>
                    {g.type === 'REQUIRED' && <Tag color="red">Bắt buộc</Tag>}
                    {g.maxSelect > 1 && <Text type="secondary" style={{ fontSize: 11 }}>Chọn tối đa {g.maxSelect}</Text>}
                  </Space>
                  {g.type === 'SINGLE' ? (
                    <Radio.Group
                      value={selected[0]}
                      onChange={(e) => setSelMods((prev) => ({ ...prev, [g.id]: [e.target.value] }))}
                      style={{ width: '100%' }}
                    >
                      <Space direction="vertical" style={{ width: '100%' }}>
                        {g.options.map((o) => (
                          <Radio key={o.id} value={o.id} style={{ width: '100%' }}>
                            {o.name} {Number(o.priceAdjust) > 0 ? ` (+${fmtMoney(o.priceAdjust)}đ)` : ''}
                          </Radio>
                        ))}
                      </Space>
                    </Radio.Group>
                  ) : (
                    <Checkbox.Group
                      value={selected}
                      style={{ width: '100%' }}
                    >
                      <Space direction="vertical" style={{ width: '100%' }}>
                        {g.options.map((o) => (
                          <Checkbox key={o.id} value={o.id} onChange={() => toggle(o.id)} checked={selected.includes(o.id)} style={{ width: '100%' }}>
                            {o.name} {Number(o.priceAdjust) > 0 ? ` (+${fmtMoney(o.priceAdjust)}đ)` : ''}
                          </Checkbox>
                        ))}
                      </Space>
                    </Checkbox.Group>
                  )}
                </div>
              );
            })}

            <Button type="primary" block size="large" style={{ marginTop: 8 }}
              disabled={!canConfirmModifier(addModal)}
              onClick={() => {
                for (let i = 0; i < addQty; i++) addItem(addModal, selMods);
              }}>
              Thêm vào giỏ — {fmtMoney(Number(addModal.price) * addQty)}đ
            </Button>
          </div>
        )}
      </Modal>

      {/* Giỏ hàng drawer */}
      <Drawer
        title={`Giỏ hàng (${cartCount} món)`}
        open={cartOpen}
        onClose={() => setCartOpen(false)}
        placement="bottom"
        height="72vh"
        destroyOnClose
      >
        {cart.length === 0 ? (
          <Empty description="Giỏ hàng đang trống" />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {cart.map((it) => (
                <div key={it.key} style={{ padding: '10px 0', borderBottom: '1px solid #f1f5f9' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                    <Text strong style={{ flex: 1 }}>{it.product.name}</Text>
                    <Space size={6}>
                      <Button size="small" shape="circle" icon={<MinusOutlined />}
                        onClick={() => updateQty(it.key, -1)} />
                      <Text>{it.qty}</Text>
                      <Button size="small" shape="circle" icon={<PlusOutlined />}
                        onClick={() => updateQty(it.key, 1)} />
                    </Space>
                  </div>
                  {it.modifiers.map((m) => (
                    <Text key={m.groupId} type="secondary" style={{ fontSize: 12, display: 'block' }}>
                      + {m.optionNames.join(', ')}
                      {m.adjust > 0 ? ` (+${fmtMoney(m.adjust)}đ)` : ''}
                    </Text>
                  ))}
                  <Text strong style={{ fontSize: 13, color: 'var(--color-primary, #0d9488)' }}>
                    {fmtMoney(it.unitPrice * it.qty)}đ
                  </Text>
                </div>
              ))}
            </div>
            <Divider style={{ margin: '8px 0' }} />
            <Input placeholder="Tên của bạn (không bắt buộc)" value={customerName} maxLength={50}
              onChange={(e) => setCustomerName(e.target.value)} style={{ marginBottom: 8 }} />
            <Input placeholder="Ghi chú cho bếp (vd: ít cay, không hành…)" value={orderNote} maxLength={200}
              onChange={(e) => setOrderNote(e.target.value)} style={{ marginBottom: 12 }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
              <Text>Tổng cộng</Text>
              <Text strong style={{ fontSize: 18, color: 'var(--color-primary, #0d9488)' }}>{fmtMoney(cartTotal)}đ</Text>
            </div>
            <Button type="primary" block size="large" loading={placing} onClick={placeOrder}>
              Đặt món ({cartCount})
            </Button>
          </div>
        )}
      </Drawer>
    </div>
  );
}

const pageStyle = {
  maxWidth: 480,
  margin: '0 auto',
  minHeight: '100vh',
  background: '#f8fafc',
  paddingBottom: 'env(safe-area-inset-bottom)',
};

const headerStyle = {
  background: 'linear-gradient(135deg, #0d9488, #0f766e)',
  padding: '20px 16px',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
};

const centerStyle = {
  minHeight: '100vh',
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
  alignItems: 'center',
  gap: 4,
  background: '#f8fafc',
};
