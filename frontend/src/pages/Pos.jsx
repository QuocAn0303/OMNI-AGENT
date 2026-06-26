/**
 * Frontend: pages/Pos.jsx — Màn hình bán hàng (Point of Sale)
 * 
 * Tổng quan:
 * - POS với lưới sản phẩm, giỏ hàng bên phải, tìm kiếm/quét barcode, chọn khách hàng, thanh toán
 * - API: GET /products, GET /categories, GET /customers, GET /customers/:id/full, GET /products/sku/:sku, POST /orders
 * - State: cart, customer, discount, payment method, receipt, heldOrders (localStorage), splitPayment
 * - Logic: Thêm/xóa/sửa số lượng sản phẩm, giảm giá theo hạng KH, đổi điểm loyalty, tách thanh toán, giữ đơn
 * 
 * Components/Hooks/Exports:
 * - Pos (default export): Giao diện POS đầy đủ
 * - CartRow: Component hiển thị dòng tổng phụ
 * - printReceipt: Hàm in hóa đơn
 */
import { useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
  Drawer,
  Dropdown,
  Empty,
  Form,
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
  PhoneOutlined,
  PlusOutlined,
  PrinterOutlined,
  ScanOutlined,
  SearchOutlined,
  ShoppingCartOutlined,
  StarFilled,
  UserAddOutlined,
} from "@ant-design/icons";
import { Joyride } from "react-joyride";
import { useTranslation } from "react-i18next";
import axios from "../api/axios";
import MoneyDisplay from "../components/shared/MoneyDisplay";
import Receipt from "../components/Receipt";
import TransferQrCode from "../components/TransferQrCode";
import useBarcodeScanner from "../hooks/useBarcodeScanner";
import CameraScanner from "../components/CameraScanner";
import useTour from "../hooks/useTour";
import { getPosTour } from "../config/tourSteps";
const PAYMENT_METHODS = [
  { value: "CASH", label: "Tiền mặt" },
  { value: "BANK_TRANSFER", label: "Chuyển khoản" },
  { value: "CARD", label: "Thẻ" },
];
//các giá trị giảm giá theo hạng khách hàng
const TIER_LABEL = {
  BRONZE: "Đồng",
  SILVER: "Bạc",
  GOLD: "Vàng",
  PLATINUM: "Kim cương",
};
const TIER_DISCOUNT = {
  BRONZE: 0,
  SILVER: 3,
  GOLD: 5,
  PLATINUM: 8,
};

export default function Pos() {
  const { t } = useTranslation();
  const tour = useTour("pos");
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState(null);
  const [loading, setLoading] = useState(true);
  const [cart, setCart] = useState([]);
  const [discount, setDiscount] = useState(0);
  const [customer, setCustomer] = useState(null);
  const [useLoyaltyPoints, setUseLoyaltyPoints] = useState(false);

  useEffect(() => {
    // Tự động tắt nút gạt khi đổi khách hàng hoặc xóa/đổi giỏ hàng
    setUseLoyaltyPoints(false);
  }, [customer, cart.length]);

  const [customerOptions, setCustomerOptions] = useState([]);
  const [phoneLookup, setPhoneLookup] = useState("");
  const [phoneLoading, setPhoneLoading] = useState(false);
  const [quickCreate, setQuickCreate] = useState({ open: false, phone: "" });
  const [quickCreateForm] = Form.useForm();
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState("CASH");
  const [splitPayment, setSplitPayment] = useState(false);
  const [splitPayments, setSplitPayments] = useState([
    { method: "CASH", amount: 0, reference: "" },
  ]);
  const [paying, setPaying] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const [heldOrders, setHeldOrders] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("pos_held_orders") || "[]");
    } catch {
      return [];
    }
  });
  const [cartDrawer, setCartDrawer] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 1024);

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth <= 1024);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  const normalizeProduct = (product) => ({
    ...product,
    quantity:
      (product.inventory?.quantity ?? 0) - (product.inventory?.reserved ?? 0),
    minStock: product.inventory?.minStock ?? 0,
  });

  const loadProducts = async () => {
    const res = await axios.get("/pos/products");
    const list = Array.isArray(res.data) ? res.data : res.data?.data || [];
    setProducts(list.map(normalizeProduct));
  };

  useEffect(() => {
    (async () => {
      try {
        const [, cRes] = await Promise.all([
          loadProducts(),
          axios.get("/pos/categories"),
        ]);
        setCategories(
          Array.isArray(cRes.data) ? cRes.data : cRes.data?.data || [],
        );
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

  const subtotal = useMemo(
    () =>
      cart.reduce((sum, item) => sum + Number(item.price) * item.quantity, 0),
    [cart],
  );
  // --- BẮT ĐẦU ĐOẠN THAY THẾ (Khoảng dòng 113) ---
  // 1. Logic tính % giảm giá theo hạng
  const tierDiscountPercent = customer?.tier
    ? TIER_DISCOUNT[customer.tier] || 0
    : 0;
  const tierDiscountAmount = Math.round((subtotal * tierDiscountPercent) / 100);

  // 2. Tính toán số tiền CÒN LẠI ĐƯỢC PHÉP thanh toán bằng điểm
  // (Đảm bảo không bao giờ giảm lố qua 0đ)
  // *Lưu ý: Nếu chính sách của bạn là "chỉ được giảm tối đa 50% giá trị đơn hàng",
  // hãy thay chữ `subtotal` ở dòng dưới thành `(subtotal * 0.5)` nhé!
  const remainingBeforePoints = Math.max(
    0,
    subtotal * 0.5 - discount - tierDiscountAmount,
  );

  // 3. Logic tính điểm quy đổi TỐI ĐA cho phép
  // Tổng điểm khách đang có (làm tròn bội số 100)
  const availablePoints = customer
    ? Math.floor((customer.loyaltyPoints || 0) / 100) * 100
    : 0;

  // Tính số điểm cần thiết để trả nốt số tiền còn lại (cứ 100 điểm = 10.000đ)
  const maxPointsAllowed = Math.floor(remainingBeforePoints / 10000) * 100;

  // CHỐT: Số điểm ĐƯỢC PHÉP dùng là số nhỏ hơn giữa (Điểm đang có) và (Điểm tối đa cần cho đơn này)
  const redeemablePoints = Math.min(availablePoints, maxPointsAllowed);
  const loyaltyDiscountValue = (redeemablePoints / 100) * 10000;

  const actualLoyaltyPointsUsed = useLoyaltyPoints ? redeemablePoints : 0;
  const actualLoyaltyDiscount = useLoyaltyPoints ? loyaltyDiscountValue : 0;

  // 4. Công thức total mới
  const total = Math.max(
    0,
    subtotal - discount - tierDiscountAmount - actualLoyaltyDiscount,
  );
  // --- KẾT THÚC ĐOẠN THAY THẾ ---

  const splitTotal = splitPayments.reduce(
    (sum, payment) => sum + Number(payment.amount || 0),
    0,
  );

  const showBankQr = splitPayment
    ? splitPayments.some((payment) => payment.method === "BANK_TRANSFER")
    : paymentMethod === "BANK_TRANSFER";

  const bankTransferAmount = splitPayment
    ? splitPayments
        .filter((payment) => payment.method === "BANK_TRANSFER")
        .reduce((sum, payment) => sum + Number(payment.amount || 0), 0)
    : total;

  useEffect(() => {
    if (checkoutOpen)
      setSplitPayments([
        { method: paymentMethod, amount: total, reference: "" },
      ]);
  }, [checkoutOpen, paymentMethod, total]);

  const filteredProducts = useMemo(
    () =>
      products.filter((product) => {
        if (product.quantity <= 0) return false;
        if (activeCategory && product.categoryId !== activeCategory)
          return false;
        if (
          search &&
          !`${product.name} ${product.sku}`
            .toLowerCase()
            .includes(search.toLowerCase())
        )
          return false;
        return true;
      }),
    [products, search, activeCategory],
  );

  const addToCart = (product) => {
    setCart((prev) => {
      const found = prev.find((item) => item.id === product.id);
      if (found) {
        if (found.quantity >= product.quantity) {
          message.warning(`Chỉ còn ${product.quantity} ${product.name}`);
          return prev;
        }
        return prev.map((item) =>
          item.id === product.id
            ? { ...item, quantity: item.quantity + 1 }
            : item,
        );
      }
      return [
        ...prev,
        {
          id: product.id,
          name: product.name,
          sku: product.sku,
          price: product.price,
          quantity: 1,
          stock: product.quantity,
        },
      ];
    });
  };

  const [cameraOpen, setCameraOpen] = useState(false);

  const handleScannedCode = async (sku) => {
    try {
      const res = await axios.get(`/pos/products/sku/${encodeURIComponent(sku)}`);
      const product = normalizeProduct(res.data?.data || res.data);
      addToCart(product);
      message.success(`Đã quét ${product.name}`);
    } catch {
      message.warning(`Không tìm thấy SKU ${sku}`);
    }
  };

  useBarcodeScanner(handleScannedCode);

  const updateQty = (id, delta) => {
    setCart((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        const nextQty = item.quantity + delta;
        if (nextQty < 1) return item;
        if (nextQty > item.stock) {
          message.warning(`Tồn kho chỉ còn ${item.stock}`);
          return item;
        }
        return { ...item, quantity: nextQty };
      }),
    );
  };

  const clearCart = () => {
    setCart([]);
    setDiscount(0);
    setCustomer(null);
  };

  const searchCustomers = async (term) => {
    try {
      const res = await axios.get("/customers", {
        params: { search: term, limit: 5 },
      });
      const list = res.data?.data || [];
      setCustomerOptions(
        list.map((item) => ({
          value: item.id,
          label: `${item.name}${item.phone ? ` - ${item.phone}` : ""}`,
          customer: item,
        })),
      );
    } catch {
      setCustomerOptions([]);
    }
  };

  const handleSelectCustomer = async (selectedCustomer) => {
    if (!selectedCustomer) {
      setCustomer(null);
      return;
    }
    try {
      // 1. SỬA ĐƯỜNG DẪN: Thêm "/full" vào cuối để gọi đúng API đã có ở Backend
      const res = await axios.get(`/customers/${selectedCustomer.id}/full`);
      const detailData = res.data?.data || res.data;

      // 2. SỬA DATA: Vì API /full trả về { customer: {...}, recentOrders: [], ... }
      // Nên ta chỉ cần trích xuất thuộc tính .customer ra để lưu vào State
      setCustomer(detailData.customer || selectedCustomer);
    } catch {
      setCustomer(selectedCustomer); // Fallback nếu lỗi
    }
  };

  // KiotViet-style: tra cứu theo SĐT → tự chọn KH nếu có, không có thì mở modal tạo nhanh.
  const lookupByPhone = async (rawPhone) => {
    const phone = String(rawPhone || "")
      .replace(/\s|-/g, "")
      .trim();
    if (!phone) return;
    if (!/^0\d{8,10}$/.test(phone)) {
      message.warning("Số điện thoại không hợp lệ");
      return;
    }
    setPhoneLoading(true);
    try {
      const res = await axios.get("/customers", {
        params: { search: phone, limit: 5 },
      });
      const list = res.data?.data || [];
      const exact = list.find(
        (c) => (c.phone || "").replace(/\s|-/g, "") === phone,
      );
      if (exact) {
        await handleSelectCustomer(exact);
        message.success(`Đã chọn KH: ${exact.name}`);
      } else {
        quickCreateForm.setFieldsValue({ phone, name: "" });
        setQuickCreate({ open: true, phone });
      }
    } catch {
      message.error("Không tra cứu được khách hàng");
    } finally {
      setPhoneLoading(false);
    }
  };

  const submitQuickCreate = async (values) => {
    try {
      const res = await axios.post("/customers", {
        name: values.name?.trim() || `Khách ${values.phone}`,
        phone: values.phone,
      });
      const created = res.data?.data || res.data;
      setCustomer(created);
      setQuickCreate({ open: false, phone: "" });
      setPhoneLookup("");
      message.success("Đã tạo khách hàng mới");
    } catch (e) {
      message.error(e.response?.data?.message || "Tạo khách hàng thất bại");
    }
  };

  const holdOrder = () => {
    if (!cart.length) {
      message.warning("Giỏ hàng trống");
      return;
    }
    setHeldOrders((prev) =>
      [
        {
          id: `hold-${Date.now()}`,
          label: `${customer?.name || "Khách lẻ"} - ${cart.length} món`,
          cart,
          customer,
          discount,
          timestamp: new Date().toISOString(),
        },
        ...prev,
      ].slice(0, 10),
    );
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
    setSplitPayments((prev) =>
      prev.map((payment, i) =>
        i === index ? { ...payment, ...patch } : payment,
      ),
    );
  };

  const addSplitPayment = () => {
    setSplitPayments((prev) => [
      ...prev,
      {
        method: "CASH",
        amount: Math.max(0, total - splitTotal),
        reference: "",
      },
    ]);
  };

  const handleCheckout = async () => {
    if (!cart.length) {
      message.warning("Giỏ hàng trống");
      return;
    }
    const payments = splitPayment
      ? splitPayments.map((payment) => ({
          ...payment,
          amount: Number(payment.amount || 0),
        }))
      : [{ method: paymentMethod, amount: total }];
    const paidTotal = payments.reduce(
      (sum, payment) => sum + payment.amount,
      0,
    );
    if (Math.abs(paidTotal - total) > 0.001) {
      message.error("Tổng thanh toán phải bằng tổng đơn hàng");
      return;
    }

    setPaying(true);
    try {
      const res = await axios.post("/pos/orders", {
        customerId: customer?.id || null,
        items: cart.map((item) => ({
          productId: item.id,
          quantity: item.quantity,
        })),
        discount,
        loyaltyPointsUsed: actualLoyaltyPointsUsed, // Gửi số điểm thực tế đã sử dụng đến backend
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
        items: cart.map((item) => ({
          ...item,
          subtotal: Number(item.price) * item.quantity,
        })),
        payments,
        subtotal,
        discount,
        total,
        createdAt: new Date().toISOString(),
      });
      message.success("Thanh toán thành công");
      clearCart();
      setCheckoutOpen(false);
      window.dispatchEvent(new CustomEvent('order-created'));
      await loadProducts();
    } catch (err) {
      message.error(err?.response?.data?.message || "Thanh toán thất bại");
    } finally {
      setPaying(false);
    }
  };

  const handlePayLater = async () => {
    if (!cart.length) {
      message.warning("Giỏ hàng trống");
      return;
    }
    setPaying(true);
    try {
      await axios.post("/pos/orders", {
        customerId: customer?.id || null,
        items: cart.map((item) => ({
          productId: item.id,
          quantity: item.quantity,
        })),
        discount,
        loyaltyPointsUsed: actualLoyaltyPointsUsed,
        payments: [],
        paymentStatus: "UNPAID",
        status: "PENDING",
      });
      message.success("Đã tạo đơn — chờ thanh toán sau");
      clearCart();
      window.dispatchEvent(new CustomEvent('order-created'));
      await loadProducts();
    } catch (err) {
      message.error(err?.response?.data?.message || "Tạo đơn thất bại");
    } finally {
      setPaying(false);
    }
  };

  const allTourSteps = getPosTour(t);
  const tourSteps = isMobile
    ? allTourSteps.filter((s) => !s.target.includes("pos-cart"))
    : allTourSteps;

  return (
    <div className="pos-layout">
      <Joyride
        steps={tourSteps}
        run={tour.run}
        continuous
        showSkipButton
        showProgress
        callback={({ status }) => {
          if (status === "finished" || status === "skipped") tour.markDone();
        }}
        styles={{ options: { primaryColor: "#0f766e", zIndex: 2000 } }}
      />
      <section className="pos-products">
        <div className="pos-products__search">
          <Input
            placeholder="Tìm sản phẩm hoặc quét mã SKU..."
            prefix={<SearchOutlined style={{ color: "var(--text-muted)" }} />}
            suffix={
              <ScanOutlined
                style={{
                  color: "var(--text-muted)",
                  cursor: "pointer",
                  fontSize: 18,
                }}
                onClick={() => setCameraOpen(true)}
                title="Quét bằng camera"
              />
            }
            size="large"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            allowClear
            autoFocus
          />
        </div>

        <div
          style={{
            display: "flex",
            gap: 6,
            flexWrap: "wrap",
            marginBottom: 16,
          }}
        >
          <Tag.CheckableTag
            checked={!activeCategory}
            onChange={() => setActiveCategory(null)}
          >
            Tất cả
          </Tag.CheckableTag>
          {categories.map((category) => (
            <Tag.CheckableTag
              key={category.id}
              checked={activeCategory === category.id}
              onChange={() =>
                setActiveCategory(
                  category.id === activeCategory ? null : category.id,
                )
              }
            >
              {category.name}
            </Tag.CheckableTag>
          ))}
        </div>

        {loading ? (
          <div style={{ display: "grid", placeItems: "center", flex: 1 }}>
            <Empty description="Đang tải..." />
          </div>
        ) : filteredProducts.length === 0 ? (
          <div style={{ display: "grid", placeItems: "center", flex: 1 }}>
            <Empty description="Không có sản phẩm phù hợp" />
          </div>
        ) : (
          <div className="pos-products__grid">
            {filteredProducts.map((product) => (
              <button
                key={product.id}
                type="button"
                className="pos-product-card"
                onClick={() => addToCart(product)}
              >
                <div className="pos-product-card__image">
                  {product.imageUrl ? (
                    <img
                      src={product.imageUrl}
                      alt={product.name}
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                      }}
                    />
                  ) : (
                    "SP"
                  )}
                </div>
                <div className="pos-product-card__name">{product.name}</div>
                <div className="pos-product-card__meta">
                  <span className="pos-product-card__price">
                    <MoneyDisplay
                      value={product.price}
                      short
                      showCurrency={false}
                    />
                  </span>
                  <span className="pos-product-card__stock">
                    Còn {product.quantity}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

      {isMobile && (
        <button
          type="button"
          className="cart-fab"
          onClick={() => setCartDrawer(true)}
        >
          <ShoppingCartOutlined />
          {cart.length > 0 && (
            <span className="cart-fab__badge">{cart.length}</span>
          )}
        </button>
      )}

      {!isMobile ? (
        <aside className="pos-cart">
          <div className="pos-cart__header">
            <div>
              <div className="pos-cart__title">Giỏ hàng</div>
              <div
                style={{
                  fontSize: 12,
                  color: "var(--text-muted)",
                  marginTop: 2,
                }}
              >
                {customer ? customer.name : "Khách lẻ"}
              </div>
            </div>
            <span className="pos-cart__count">{cart.length} món</span>
          </div>

          <div style={{ padding: "0 16px 12px" }}>
            <Input.Search
              allowClear
              placeholder="SĐT khách hàng (Enter để tra cứu)"
              prefix={<PhoneOutlined />}
              value={phoneLookup}
              onChange={(e) => setPhoneLookup(e.target.value)}
              onSearch={lookupByPhone}
              loading={phoneLoading}
              enterButton="Tra cứu"
              style={{ marginBottom: 8 }}
            />
            <Select
              showSearch
              allowClear
              placeholder="hoặc tìm theo tên"
              value={customer?.id}
              filterOption={false}
              onSearch={searchCustomers}
              onChange={(_, option) => handleSelectCustomer(option?.customer)}
              options={customerOptions}
              style={{ width: "100%" }}
            />
            {customer && (
              <div
                style={{
                  marginTop: 8,
                  padding: "8px 10px",
                  background: "var(--bg-soft, #f8fafc)",
                  borderRadius: 8,
                  fontSize: 12,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div>
                  <div style={{ fontWeight: 600 }}>{customer.name}</div>
                  {customer.phone && (
                    <div style={{ color: "var(--text-muted)" }}>
                      {customer.phone}
                    </div>
                  )}
                </div>
                <Space size={4}>
                  <Tag color="gold" icon={<StarFilled />} style={{ margin: 0 }}>
                    {Number(customer.loyaltyPoints || 0).toLocaleString(
                      "vi-VN",
                    )}{" "}
                    điểm
                  </Tag>
                  {customer.tier && (
                    <Tag color="purple" style={{ margin: 0 }}>
                      {TIER_LABEL[customer.tier] || customer.tier}
                    </Tag>
                  )}
                </Space>
              </div>
            )}
          </div>

          {cart.length === 0 ? (
            <div
              style={{
                flex: 1,
                display: "grid",
                placeItems: "center",
                padding: 32,
              }}
            >
              <Empty
                image={
                  <ShoppingCartOutlined
                    style={{ fontSize: 48, color: "var(--text-muted)" }}
                  />
                }
                description="Chưa có sản phẩm"
              />
            </div>
          ) : (
            <div className="pos-cart__items">
              {cart.map((item) => (
                <div key={item.id} className="pos-cart__item">
                  <div className="pos-cart__item-info">
                    <div className="pos-cart__item-name">{item.name}</div>
                    <div className="pos-cart__item-price">
                      <MoneyDisplay value={item.price} /> x {item.quantity}
                    </div>
                  </div>
                  <Space size={4}>
                    <Button
                      type="text"
                      size="small"
                      shape="circle"
                      icon={<MinusOutlined />}
                      onClick={() => updateQty(item.id, -1)}
                    />
                    <span
                      style={{
                        minWidth: 24,
                        textAlign: "center",
                        fontWeight: 500,
                      }}
                    >
                      {item.quantity}
                    </span>
                    <Button
                      type="text"
                      size="small"
                      shape="circle"
                      icon={<PlusOutlined />}
                      onClick={() => updateQty(item.id, 1)}
                    />
                    <Button
                      type="text"
                      size="small"
                      danger
                      icon={<DeleteOutlined />}
                      onClick={() =>
                        setCart((prev) =>
                          prev.filter((cartItem) => cartItem.id !== item.id),
                        )
                      }
                    />
                  </Space>
                </div>
              ))}
            </div>
          )}

          <div className="pos-cart__footer">
            <CartRow label="Tạm tính" value={subtotal} />
            <div className="pos-cart__row" style={{ alignItems: "center" }}>
              <span>Giảm giá</span>
              <InputNumber
                size="small"
                min={0}
                max={subtotal}
                step={1000}
                value={discount}
                onChange={(value) => setDiscount(value || 0)}
                style={{ width: 120 }}
              />
            </div>
            {/* --- HIỂN THỊ ƯU ĐÃI HẠNG (MÀU XANH) --- */}
            {tierDiscountAmount > 0 && (
              <div
                className="pos-cart__row"
                style={{ color: "var(--primary-color, #0f766e)" }}
              >
                <span>
                  Ưu đãi hạng {TIER_LABEL[customer.tier] || customer.tier} ({tierDiscountPercent}%)
                </span>
                <span>
                  -
                  <MoneyDisplay
                    value={tierDiscountAmount}
                    showCurrency={false}
                  />
                  đ
                </span>
              </div>
            )}
            {customer && redeemablePoints > 0 && (
              <div
                className="pos-cart__row"
                style={{
                  alignItems: "center",
                  color: "var(--warning-dark, #d97706)",
                }}
              >
                <span>
                  Dùng {redeemablePoints.toLocaleString("vi-VN")} điểm (-
                  <MoneyDisplay
                    value={loyaltyDiscountValue}
                    showCurrency={false}
                  />
                  đ)
                </span>
                <Switch
                  checked={useLoyaltyPoints}
                  onChange={setUseLoyaltyPoints}
                  size="small"
                />
              </div>
            )}
            <div className="pos-cart__total">
              <span className="pos-cart__total-label">Tổng cộng</span>
              <span className="pos-cart__total-value">
                <MoneyDisplay value={total} />
              </span>
            </div>
            <Space wrap>
              <Button onClick={holdOrder} disabled={!cart.length}>
                Giữ đơn
              </Button>
              <Dropdown
                menu={{
                  items: heldOrders.map((held) => ({
                    key: held.id,
                    label: `${held.label} · ${new Date(held.timestamp).toLocaleTimeString("vi-VN")}`,
                    onClick: () => resumeOrder(held),
                  })),
                }}
                disabled={!heldOrders.length}
                trigger={['click']}
              >
                <Button>
                  <Badge count={heldOrders.length} size="small">
                    Đơn đang giữ
                  </Badge>
                </Button>
              </Dropdown>
              <Button onClick={clearCart} disabled={!cart.length}>
                Xóa
              </Button>
              <Button
                disabled={!cart.length}
                loading={paying}
                onClick={handlePayLater}
              >
                Thanh toán sau
              </Button>
              <Button
                type="primary"
                disabled={!cart.length}
                onClick={() => setCheckoutOpen(true)}
              >
                Thanh toán
              </Button>
            </Space>
          </div>
        </aside>
      ) : (
        <Drawer
          title={`Giỏ hàng (${cart.length} món)`}
          placement="bottom"
          height="80vh"
          open={cartDrawer}
          onClose={() => setCartDrawer(false)}
          styles={{ body: { padding: 0 } }}
        >
          <aside
            className="pos-cart"
            style={{ height: "100%", border: "none" }}
          >
            <div className="pos-cart__header">
              <div>
                <div className="pos-cart__title">Giỏ hàng</div>
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--text-muted)",
                    marginTop: 2,
                  }}
                >
                  {customer ? customer.name : "Khách lẻ"}
                </div>
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
                onChange={(_, option) => handleSelectCustomer(option?.customer)}
                options={customerOptions}
                style={{ width: "100%" }}
              />
            </div>

            {cart.length === 0 ? (
              <div
                style={{
                  flex: 1,
                  display: "grid",
                  placeItems: "center",
                  padding: 32,
                }}
              >
                <Empty
                  image={
                    <ShoppingCartOutlined
                      style={{ fontSize: 48, color: "var(--text-muted)" }}
                    />
                  }
                  description="Chưa có sản phẩm"
                />
              </div>
            ) : (
              <div className="pos-cart__items">
                {cart.map((item) => (
                  <div key={item.id} className="pos-cart__item">
                    <div className="pos-cart__item-info">
                      <div className="pos-cart__item-name">{item.name}</div>
                      <div className="pos-cart__item-price">
                        <MoneyDisplay value={item.price} /> x {item.quantity}
                      </div>
                    </div>
                    <Space size={4}>
                      <Button
                        type="text"
                        size="small"
                        shape="circle"
                        icon={<MinusOutlined />}
                        onClick={() => updateQty(item.id, -1)}
                      />
                      <span
                        style={{
                          minWidth: 24,
                          textAlign: "center",
                          fontWeight: 500,
                        }}
                      >
                        {item.quantity}
                      </span>
                      <Button
                        type="text"
                        size="small"
                        shape="circle"
                        icon={<PlusOutlined />}
                        onClick={() => updateQty(item.id, 1)}
                      />
                      <Button
                        type="text"
                        size="small"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={() =>
                          setCart((prev) =>
                            prev.filter((cartItem) => cartItem.id !== item.id),
                          )
                        }
                      />
                    </Space>
                  </div>
                ))}
              </div>
            )}

            <div className="pos-cart__footer">
              <CartRow label="Tạm tính" value={subtotal} />
              <div className="pos-cart__row" style={{ alignItems: "center" }}>
                <span>Giảm giá</span>
                <InputNumber
                  size="small"
                  min={0}
                  max={subtotal}
                  step={1000}
                  value={discount}
                  onChange={(value) => setDiscount(value || 0)}
                  style={{ width: 120 }}
                />
              </div>
              {/* --- HIỂN THỊ ƯU ĐÃI HẠNG (MÀU XANH) --- */}
              {tierDiscountAmount > 0 && (
                <div
                  className="pos-cart__row"
                  style={{ color: "var(--primary-color, #0f766e)" }}
                >
                  <span>
                    Ưu đãi hạng {TIER_LABEL[customer.tier] || customer.tier} ({tierDiscountPercent}%)
                  </span>
                  <span>
                    -
                    <MoneyDisplay
                      value={tierDiscountAmount}
                      showCurrency={false}
                    />
                    đ
                  </span>
                </div>
              )}
              {customer && redeemablePoints > 0 && (
                <div
                  className="pos-cart__row"
                  style={{
                    alignItems: "center",
                    color: "var(--warning-dark, #d97706)",
                  }}
                >
                  <span>
                    Dùng {redeemablePoints.toLocaleString("vi-VN")} điểm (-
                    <MoneyDisplay
                      value={loyaltyDiscountValue}
                      showCurrency={false}
                    />
                    đ)
                  </span>
                  <Switch
                    checked={useLoyaltyPoints}
                    onChange={setUseLoyaltyPoints}
                    size="small"
                  />
                </div>
              )}
              <div className="pos-cart__total">
                <span className="pos-cart__total-label">Tổng cộng</span>
                <span className="pos-cart__total-value">
                  <MoneyDisplay value={total} />
                </span>
              </div>
              <Space wrap>
                <Button onClick={holdOrder} disabled={!cart.length}>
                  Giữ đơn
                </Button>
                <Dropdown
                  menu={{
                    items: heldOrders.map((held) => ({
                      key: held.id,
                      label: `${held.label} · ${new Date(held.timestamp).toLocaleTimeString("vi-VN")}`,
                      onClick: () => resumeOrder(held),
                    })),
                  }}
                  disabled={!heldOrders.length}
                  trigger={['click']}
                >
                  <Button>
                    <Badge count={heldOrders.length} size="small">
                      Đơn đang giữ
                    </Badge>
                  </Button>
                </Dropdown>
                <Button onClick={clearCart} disabled={!cart.length}>
                  Xóa
                </Button>
                <Button
                  disabled={!cart.length}
                  loading={paying}
                  onClick={handlePayLater}
                >
                  Thanh toán sau
                </Button>
                <Button
                  type="primary"
                  disabled={!cart.length}
                  onClick={() => {
                    setCheckoutOpen(true);
                    setCartDrawer(false);
                  }}
                >
                  Thanh toán
                </Button>
              </Space>
            </div>
          </aside>
        </Drawer>
      )}

      <Modal
        title={null}
        open={checkoutOpen}
        onCancel={() => !paying && setCheckoutOpen(false)}
        footer={null}
        width={showBankQr ? 400 : 560}
        centered
        closable={!paying}
      >
        <div style={{ padding: 8 }}>
          <div style={{ fontSize: 28, fontWeight: 800, marginBottom: 16 }}>
            <MoneyDisplay value={total} />
          </div>
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span>Tách thanh toán</span>
              <Switch checked={splitPayment} onChange={setSplitPayment} />
            </div>

            {!splitPayment ? (
              <Select
                value={paymentMethod}
                onChange={setPaymentMethod}
                options={PAYMENT_METHODS}
                style={{ width: "100%" }}
              />
            ) : null}

            {showBankQr && (
              <TransferQrCode
                amount={bankTransferAmount}
                addInfo="Thanh toan POS"
              />
            )}

            {splitPayment ? (
              <Space direction="vertical" style={{ width: "100%" }}>
                {splitPayments.map((payment, index) => (
                  <Space key={index} style={{ width: "100%" }} align="start">
                    <Select
                      value={payment.method}
                      onChange={(value) =>
                        updateSplitPayment(index, { method: value })
                      }
                      options={PAYMENT_METHODS}
                      style={{ width: 150 }}
                    />
                    <InputNumber
                      min={0}
                      value={payment.amount}
                      onChange={(value) =>
                        updateSplitPayment(index, { amount: value || 0 })
                      }
                      style={{ width: 140 }}
                    />
                    <Input
                      placeholder="Mã GD"
                      value={payment.reference}
                      onChange={(event) =>
                        updateSplitPayment(index, {
                          reference: event.target.value,
                        })
                      }
                    />
                    <Button
                      danger
                      onClick={() =>
                        setSplitPayments((prev) =>
                          prev.filter((_, i) => i !== index),
                        )
                      }
                      disabled={splitPayments.length === 1}
                    >
                      Xóa
                    </Button>
                  </Space>
                ))}
                <Button onClick={addSplitPayment}>Thêm dòng</Button>
                <div
                  style={{
                    color:
                      Math.abs(splitTotal - total) < 0.001
                        ? "var(--success-dark)"
                        : "var(--danger-dark)",
                  }}
                >
                  Còn lại: {(total - splitTotal).toLocaleString("vi-VN")} VND
                </div>
              </Space>
            ) : null}

            <Space>
              <Button onClick={() => setCheckoutOpen(false)} disabled={paying}>
                Hủy
              </Button>
              <Button type="primary" loading={paying} onClick={handleCheckout}>
                Xác nhận
              </Button>
            </Space>
          </Space>
        </div>
      </Modal>

      <Modal
        title="Hóa đơn bán hàng"
        open={!!receipt}
        onCancel={() => setReceipt(null)}
        footer={[
          <Button key="close" onClick={() => setReceipt(null)}>
            Đóng
          </Button>,
          <Button
            key="print"
            type="primary"
            icon={<PrinterOutlined />}
            onClick={() => printReceipt(receipt)}
          >
            In hóa đơn
          </Button>,
        ]}
        width={420}
      >
        {receipt && <Receipt order={receipt} />}
      </Modal>

      <Modal
        title={
          <Space>
            <UserAddOutlined /> Tạo nhanh khách hàng
          </Space>
        }
        open={quickCreate.open}
        onCancel={() => setQuickCreate({ open: false, phone: "" })}
        footer={null}
        destroyOnClose
        width={400}
      >
        <p style={{ color: "var(--text-muted)", marginTop: 0 }}>
          Số điện thoại <strong>{quickCreate.phone}</strong> chưa có trong hệ
          thống. Tạo khách mới để tích điểm?
        </p>
        <Form
          form={quickCreateForm}
          layout="vertical"
          onFinish={submitQuickCreate}
        >
          <Form.Item
            name="phone"
            label="Số điện thoại"
            rules={[{ required: true }]}
          >
            <Input disabled prefix={<PhoneOutlined />} />
          </Form.Item>
          <Form.Item
            name="name"
            label="Tên khách hàng"
            extra="Để trống sẽ dùng 'Khách <SĐT>'"
          >
            <Input placeholder="VD: Nguyễn Văn A" autoFocus />
          </Form.Item>
          <Space>
            <Button type="primary" htmlType="submit" icon={<UserAddOutlined />}>
              Tạo & chọn
            </Button>
            <Button onClick={() => setQuickCreate({ open: false, phone: "" })}>
              Hủy
            </Button>
          </Space>
        </Form>
      </Modal>

      <CameraScanner
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onDetect={async (code) => {
          setCameraOpen(false);
          await handleScannedCode(code);
        }}
      />
    </div>
  );
}

function CartRow({ label, value }) {
  return (
    <div className="pos-cart__row">
      <span>{label}</span>
      <MoneyDisplay value={value} />
    </div>
  );
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
