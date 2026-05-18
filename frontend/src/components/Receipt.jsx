const paymentLabels = {
  CASH: "Tiền mặt",
  CARD: "Thẻ",
  BANK_TRANSFER: "Chuyển khoản",
};

const money = (value) => Number(value || 0).toLocaleString("vi-VN");

export default function Receipt({ order }) {
  if (!order) return null;

  const items = order.items || [];
  const payments = order.payments || [];

  return (
    <div id="pos-receipt" className="thermal-receipt">
      <style>{`
        .thermal-receipt {
          width: 280px;
          color: #111;
          background: #fff;
          font-family: Arial, sans-serif;
          font-size: 12px;
          line-height: 1.35;
          padding: 12px;
        }
        .thermal-receipt__center { text-align: center; }
        .thermal-receipt__title { font-size: 16px; font-weight: 700; }
        .thermal-receipt__line { border-top: 1px dashed #111; margin: 8px 0; }
        .thermal-receipt__row { display: flex; justify-content: space-between; gap: 8px; }
        .thermal-receipt__name { font-weight: 600; margin-top: 6px; }
        @media print {
          body * { visibility: hidden; }
          .thermal-receipt, .thermal-receipt * { visibility: visible; }
          .thermal-receipt { position: fixed; left: 0; top: 0; }
        }
      `}</style>
      <div className="thermal-receipt__center">
        <div className="thermal-receipt__title">{import.meta.env.VITE_STORE_NAME || "MINI ERP"}</div>
        <div>Cảm ơn quý khách!</div>
      </div>
      <div className="thermal-receipt__line" />
      <div>Mã đơn: {order.orderCode}</div>
      <div>Ngày: {new Date(order.createdAt || Date.now()).toLocaleString("vi-VN")}</div>
      <div>Nhân viên: {order.createdBy?.fullName || order.cashierName || "-"}</div>
      <div>Khách: {order.customer?.name || order.customerName || "Khách lẻ"}</div>
      <div className="thermal-receipt__line" />
      {items.map((item) => (
        <div key={item.id || item.productId}>
          <div className="thermal-receipt__name">{item.product?.name || item.name}</div>
          <div className="thermal-receipt__row">
            <span>{item.quantity} x {money(item.price)}</span>
            <span>{money(item.subtotal ?? Number(item.price || 0) * item.quantity)}</span>
          </div>
        </div>
      ))}
      <div className="thermal-receipt__line" />
      <div className="thermal-receipt__row"><span>Tạm tính</span><span>{money(order.subtotal)}</span></div>
      <div className="thermal-receipt__row"><span>Giảm giá</span><span>{money(order.discount)}</span></div>
      <div className="thermal-receipt__row"><strong>Tổng</strong><strong>{money(order.total)}</strong></div>
      <div className="thermal-receipt__line" />
      <div>
        Thanh toán:{" "}
        {payments.length
          ? payments.map((p) => `${paymentLabels[p.method] || p.method} ${money(p.amount)}`).join(", ")
          : paymentLabels[order.paymentMethod] || order.paymentMethod}
      </div>
      <div className="thermal-receipt__center" style={{ marginTop: 10 }}>Hẹn gặp lại!</div>
    </div>
  );
}
