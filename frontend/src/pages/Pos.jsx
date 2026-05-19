import { useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
  Dropdown,
  Empty,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Switch,
  Tag,
  message,
} from "antd";
import {
  DeleteOutlined,
  MinusOutlined,
  PlusOutlined,
  PrinterOutlined,
  ScanOutlined,
  SearchOutlined,
  ShoppingCartOutlined,
} from "@ant-design/icons";
import axios from "../api/axios";
import MoneyDisplay from "../components/shared/MoneyDisplay";
import Receipt from "../components/Receipt";
import TransferQrCode from "../components/TransferQrCode";
import useBarcodeScanner from "../hooks/useBarcodeScanner";

const PAYMENT_METHODS = [
  { value: "CASH", label: "Tiền mặt" },
  { value: "BANK_TRANSFER", label: "Chuyển khoản" },
  { value: "CARD", label: "Thẻ" },
];

export default function Pos() {
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState(null);
  const [loading, setLoading] = useState(true);
  const [cart, setCart] = useState([]);
  const [discount, setDiscount] = useState(0);
  const [customer, setCustomer] = useState(null);
  const [customerOptions, setCustomerOptions] = useState([]);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState("CASH");
  const [splitPayment, setSplitPayment] = useState(false);
  const [splitPayments, setSplitPayments] = useState([{ method: "CASH", amount: 0, reference: "" }]);
  const [paying, setPaying] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const [heldOrders, setHeldOrders] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("pos_held_orders") || "[]");
    } catch {
      return [];
    }
  });

  const normalizeProduct = (product) => ({
    ...product,
    quantity: (product.inventory?.quantity ?? 0) - (product.inventory?.reserved ?? 0),
    minStock: product.inventory?.minStock ?? 0,
  });

  const loadProducts = async () => {
    const res = await axios.get("/products");
    const list = Array.isArray(res.data) ? res.data : res.data?.data || [];
    setProducts(list.map(normalizeProduct));
  };

  useEffect(() => {
    (async () => {
      try {
        const [, cRes] = await Promise.all([loadProducts(), axios.get("/categories")]);
        setCategories(Array.isArray(cRes.data) ? cRes.data : cRes.data?.data || []);
      } catch {
        message.error("Không tải được dữ liệu POS");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    localStorage.setItem("pos_held_orders", JSON.stringify(heldOrders));
  }, [heldOrders]);

  const subtotal = useMemo(() => cart.reduce((sum, item) => sum + Number(item.price) * item.quantity, 0), [cart]);
  const total = Math.max(0, subtotal - discount);
  const splitTotal = splitPayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);

  const showBankQr = splitPayment
    ? splitPayments.some((payment) => payment.method === "BANK_TRANSFER")
    : paymentMethod === "BANK_TRANSFER";

  const bankTransferAmount = splitPayment
    ? splitPayments
        .filter((payment) => payment.method === "BANK_TRANSFER")
        .reduce((sum, payment) => sum + Number(payment.amount || 0), 0)
    : total;

  useEffect(() => {
    if (checkoutOpen) setSplitPayments([{ method: paymentMethod, amount: total, reference: "" }]);
  }, [checkoutOpen, paymentMethod, total]);

  const filteredProducts = useMemo(() => products.filter((product) => {
    if (product.quantity <= 0) return false;
    if (activeCategory && product.categoryId !== activeCategory) return false;
    if (search && !`${product.name} ${product.sku}`.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }), [products, search, activeCategory]);

  const addToCart = (product) => {
    setCart((prev) => {
      const found = prev.find((item) => item.id === product.id);
      if (found) {
        if (found.quantity >= product.quantity) {
          message.warning(`Chỉ còn ${product.quantity} ${product.name}`);
          return prev;
        }
        return prev.map((item) => item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item);
      }
      return [...prev, {
        id: product.id,
        name: product.name,
        sku: product.sku,
        price: product.price,
        quantity: 1,
        stock: product.quantity,
      }];
    });
  };

  useBarcodeScanner(async (sku) => {
    try {
      const res = await axios.get(`/products/sku/${encodeURIComponent(sku)}`);
      const product = normalizeProduct(res.data?.data || res.data);
      addToCart(product);
      message.success(`Đã quét ${product.name}`);
    } catch {
      message.warning(`Không tìm thấy SKU ${sku}`);
    }
  });

  const updateQty = (id, delta) => {
    setCart((prev) => prev.map((item) => {
      if (item.id !== id) return item;
      const nextQty = item.quantity + delta;
      if (nextQty < 1) return item;
      if (nextQty > item.stock) {
        message.warning(`Tồn kho chỉ còn ${item.stock}`);
        return item;
      }
      return { ...item, quantity: nextQty };
    }));
  };

  const clearCart = () => {
    setCart([]);
    setDiscount(0);
    setCustomer(null);
  };

  const searchCustomers = async (term) => {
    try {
      const res = await axios.get("/customers", { params: { search: term, limit: 5 } });
      const list = res.data?.data || [];
      setCustomerOptions(list.map((item) => ({
        value: item.id,
        label: `${item.name}${item.phone ? ` - ${item.phone}` : ""}`,
        customer: item,
      })));
    } catch {
      setCustomerOptions([]);
    }
  };

  const holdOrder = () => {
    if (!cart.length) {
      message.warning("Giỏ hàng trống");
      return;
    }
    setHeldOrders((prev) => [
      {
        id: `hold-${Date.now()}`,
        label: `${customer?.name || "Khách lẻ"} - ${cart.length} món`,
        cart,
        customer,
        discount,
        timestamp: new Date().toISOString(),
      },
      ...prev,
    ].slice(0, 10));
    clearCart();
    message.success("Đã giữ đơn");
  };

  const resumeOrder = (held) => {
    setCart(held.cart || []);
    setCustomer(held.customer || null);
    setDiscount(held.discount || 0);
    setHeldOrders((prev) => prev.filter((item) => item.id !== held.id));
  };

  const updateSplitPayment = (index, patch) => {
    setSplitPayments((prev) => prev.map((payment, i) => i === index ? { ...payment, ...patch } : payment));
  };

  const addSplitPayment = () => {
    setSplitPayments((prev) => [...prev, { method: "CASH", amount: Math.max(0, total - splitTotal), reference: "" }]);
  };

  const handleCheckout = async () => {
    if (!cart.length) {
      message.warning("Giỏ hàng trống");
      return;
    }
    const payments = splitPayment
      ? splitPayments.map((payment) => ({ ...payment, amount: Number(payment.amount || 0) }))
      : [{ method: paymentMethod, amount: total }];
    const paidTotal = payments.reduce((sum, payment) => sum + payment.amount, 0);
    if (Math.abs(paidTotal - total) > 0.001) {
      message.error("Tổng thanh toán phải bằng tổng đơn hàng");
      return;
    }

    setPaying(true);
    try {
      const res = await axios.post("/orders", {
        customerId: customer?.id || null,
        items: cart.map((item) => ({ productId: item.id, quantity: item.quantity })),
        discount,
        paymentMethod: payments[0]?.method || paymentMethod,
        payments,
        paymentStatus: "PAID",
        status: "COMPLETED",
      });
      const order = res.data?.data || res.data;
      setReceipt({
        ...order,
        customer,
        customerName: customer?.name || "Khách lẻ",
        items: cart.map((item) => ({ ...item, subtotal: Number(item.price) * item.quantity })),
        payments,
        subtotal,
        discount,
        total,
        createdAt: new Date().toISOString(),
      });
      message.success("Thanh toán thành công");
      clearCart();
      setCheckoutOpen(false);
      await loadProducts();
    } catch (err) {
      message.error(err?.response?.data?.message || "Thanh toán thất bại");
    } finally {
      setPaying(false);
    }
  };

  return (
    <div className="pos-layout">
      <section className="pos-products">
        <div className="pos-products__search">
          <Input
            placeholder="Tìm sản phẩm hoặc quét mã SKU..."
            prefix={<SearchOutlined style={{ color: "var(--text-muted)" }} />}
            suffix={<ScanOutlined style={{ color: "var(--text-muted)" }} />}
            size="large"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            allowClear
            autoFocus
          />
        </div>

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
          <Tag.CheckableTag checked={!activeCategory} onChange={() => setActiveCategory(null)}>Tất cả</Tag.CheckableTag>
          {categories.map((category) => (
            <Tag.CheckableTag key={category.id} checked={activeCategory === category.id} onChange={() => setActiveCategory(category.id === activeCategory ? null : category.id)}>
              {category.name}
            </Tag.CheckableTag>
          ))}
        </div>

        {loading ? (
          <div style={{ display: "grid", placeItems: "center", flex: 1 }}><Empty description="Đang tải..." /></div>
        ) : filteredProducts.length === 0 ? (
          <div style={{ display: "grid", placeItems: "center", flex: 1 }}><Empty description="Không có sản phẩm phù hợp" /></div>
        ) : (
          <div className="pos-products__grid">
            {filteredProducts.map((product) => (
              <button key={product.id} type="button" className="pos-product-card" onClick={() => addToCart(product)}>
                <div className="pos-product-card__image">
                  {product.imageUrl ? <img src={product.imageUrl} alt={product.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : "SP"}
                </div>
                <div className="pos-product-card__name">{product.name}</div>
                <div className="pos-product-card__meta">
                  <span className="pos-product-card__price"><MoneyDisplay value={product.price} short showCurrency={false} /></span>
                  <span className="pos-product-card__stock">Còn {product.quantity}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

      <aside className="pos-cart">
        <div className="pos-cart__header">
          <div>
            <div className="pos-cart__title">Giỏ hàng</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>{customer ? customer.name : "Khách lẻ"}</div>
          </div>
          <span className="pos-cart__count">{cart.length} món</span>
        </div>

        <div style={{ padding: "0 16px 12px" }}>
          <Select
            showSearch
            allowClear
            placeholder="Tìm khách hàng"
            value={customer?.id}
            filterOption={false}
            onSearch={searchCustomers}
            onChange={(_, option) => setCustomer(option?.customer || null)}
            options={customerOptions}
            style={{ width: "100%" }}
          />
        </div>

        {cart.length === 0 ? (
          <div style={{ flex: 1, display: "grid", placeItems: "center", padding: 32 }}>
            <Empty image={<ShoppingCartOutlined style={{ fontSize: 48, color: "var(--text-muted)" }} />} description="Chưa có sản phẩm" />
          </div>
        ) : (
          <div className="pos-cart__items">
            {cart.map((item) => (
              <div key={item.id} className="pos-cart__item">
                <div className="pos-cart__item-info">
                  <div className="pos-cart__item-name">{item.name}</div>
                  <div className="pos-cart__item-price"><MoneyDisplay value={item.price} /> x {item.quantity}</div>
                </div>
                <Space size={4}>
                  <Button type="text" size="small" shape="circle" icon={<MinusOutlined />} onClick={() => updateQty(item.id, -1)} />
                  <span style={{ minWidth: 24, textAlign: "center", fontWeight: 500 }}>{item.quantity}</span>
                  <Button type="text" size="small" shape="circle" icon={<PlusOutlined />} onClick={() => updateQty(item.id, 1)} />
                  <Button type="text" size="small" danger icon={<DeleteOutlined />} onClick={() => setCart((prev) => prev.filter((cartItem) => cartItem.id !== item.id))} />
                </Space>
              </div>
            ))}
          </div>
        )}

        <div className="pos-cart__footer">
          <CartRow label="Tạm tính" value={subtotal} />
          <div className="pos-cart__row" style={{ alignItems: "center" }}>
            <span>Giảm giá</span>
            <InputNumber size="small" min={0} max={subtotal} step={1000} value={discount} onChange={(value) => setDiscount(value || 0)} style={{ width: 120 }} />
          </div>
          <div className="pos-cart__total">
            <span className="pos-cart__total-label">Tổng cộng</span>
            <span className="pos-cart__total-value"><MoneyDisplay value={total} /></span>
          </div>
          <Space wrap>
            <Button onClick={holdOrder} disabled={!cart.length}>Giữ đơn</Button>
            <Dropdown
              menu={{ items: heldOrders.map((held) => ({ key: held.id, label: `${held.label} · ${new Date(held.timestamp).toLocaleTimeString("vi-VN")}`, onClick: () => resumeOrder(held) })) }}
              disabled={!heldOrders.length}
            >
              <Button><Badge count={heldOrders.length} size="small">Đơn đang giữ</Badge></Button>
            </Dropdown>
            <Button onClick={clearCart} disabled={!cart.length}>Xóa</Button>
            <Button type="primary" disabled={!cart.length} onClick={() => setCheckoutOpen(true)}>Thanh toán</Button>
          </Space>
        </div>
      </aside>

      <Modal title={null} open={checkoutOpen} onCancel={() => !paying && setCheckoutOpen(false)} footer={null} width={showBankQr ? 400 : 560} centered closable={!paying}>
        <div style={{ padding: 8 }}>
          <div style={{ fontSize: 28, fontWeight: 800, marginBottom: 16 }}><MoneyDisplay value={total} /></div>
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>Tách thanh toán</span>
              <Switch checked={splitPayment} onChange={setSplitPayment} />
            </div>

            {!splitPayment ? (
              <Select value={paymentMethod} onChange={setPaymentMethod} options={PAYMENT_METHODS} style={{ width: "100%" }} />
            ) : null}

            {showBankQr && (
              <TransferQrCode amount={bankTransferAmount} addInfo="Thanh toan POS" />
            )}

            {splitPayment ? (
              <Space direction="vertical" style={{ width: "100%" }}>
                {splitPayments.map((payment, index) => (
                  <Space key={index} style={{ width: "100%" }} align="start">
                    <Select value={payment.method} onChange={(value) => updateSplitPayment(index, { method: value })} options={PAYMENT_METHODS} style={{ width: 150 }} />
                    <InputNumber min={0} value={payment.amount} onChange={(value) => updateSplitPayment(index, { amount: value || 0 })} style={{ width: 140 }} />
                    <Input placeholder="Mã GD" value={payment.reference} onChange={(event) => updateSplitPayment(index, { reference: event.target.value })} />
                    <Button danger onClick={() => setSplitPayments((prev) => prev.filter((_, i) => i !== index))} disabled={splitPayments.length === 1}>Xóa</Button>
                  </Space>
                ))}
                <Button onClick={addSplitPayment}>Thêm dòng</Button>
                <div style={{ color: Math.abs(splitTotal - total) < 0.001 ? "var(--success-dark)" : "var(--danger-dark)" }}>
                  Còn lại: {(total - splitTotal).toLocaleString("vi-VN")} VND
                </div>
              </Space>
            ) : null}

            <Space>
              <Button onClick={() => setCheckoutOpen(false)} disabled={paying}>Hủy</Button>
              <Button type="primary" loading={paying} onClick={handleCheckout}>Xác nhận</Button>
            </Space>
          </Space>
        </div>
      </Modal>

      <Modal
        title="Hóa đơn bán hàng"
        open={!!receipt}
        onCancel={() => setReceipt(null)}
        footer={[
          <Button key="close" onClick={() => setReceipt(null)}>Đóng</Button>,
          <Button key="print" type="primary" icon={<PrinterOutlined />} onClick={() => printReceipt(receipt)}>In hóa đơn</Button>,
        ]}
        width={420}
      >
        {receipt && <Receipt order={receipt} />}
      </Modal>
    </div>
  );
}

function CartRow({ label, value }) {
  return <div className="pos-cart__row"><span>{label}</span><MoneyDisplay value={value} /></div>;
}

function printReceipt(receipt) {
  const html = document.getElementById("pos-receipt")?.outerHTML;
  if (!html) return;
  const win = window.open("", "_blank", "width=420,height=640");
  win.document.write(`
    <html>
      <head><title>${receipt.orderCode}</title></head>
      <body style="margin:0">${html}</body>
      <script>window.onload=function(){window.print();window.close();}</script>
    </html>
  `);
  win.document.close();
}
