/**
 * StatusTag — Badge thống nhất cho order status, payment status, stock status...
 *
 * Props:
 *   status:  string — key từ dict bên dưới HOẶC custom string
 *   label:   string — text hiển thị (nếu không truyền, dùng default từ dict)
 *   variant: 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'primary'
 *            (chỉ cần truyền khi dùng custom status không có trong dict)
 */

// Mapping status nghiệp vụ → variant màu + label mặc định (tiếng Việt)
const STATUS_DICT = {
  // Order status
  PENDING:    { variant: 'warning', label: 'Chờ xác nhận' },
  CONFIRMED:  { variant: 'info',    label: 'Đã xác nhận' },
  SHIPPING:   { variant: 'primary', label: 'Đang giao' },
  COMPLETED:  { variant: 'success', label: 'Hoàn thành' },
  CANCELLED:  { variant: 'danger',  label: 'Đã hủy' },

  // Payment status
  PAID:       { variant: 'success', label: 'Đã thanh toán' },
  UNPAID:     { variant: 'warning', label: 'Chưa thanh toán' },
  REFUNDED:   { variant: 'neutral', label: 'Đã hoàn tiền' },

  // Stock status
  IN_STOCK:   { variant: 'success', label: 'Còn hàng' },
  LOW_STOCK:  { variant: 'warning', label: 'Sắp hết' },
  OUT_STOCK:  { variant: 'danger',  label: 'Hết hàng' },

  // User status
  ACTIVE:     { variant: 'success', label: 'Hoạt động' },
  INACTIVE:   { variant: 'neutral', label: 'Ngưng hoạt động' },
  LOCKED:     { variant: 'danger',  label: 'Đã khóa' },

  // HR
  ON_SHIFT:   { variant: 'success', label: 'Đang ca' },
  OFF_SHIFT:  { variant: 'neutral', label: 'Ngoài ca' },
};

export default function StatusTag({ status, label, variant }) {
  const config = STATUS_DICT[status] || {};
  const finalVariant = variant || config.variant || 'neutral';
  const finalLabel = label || config.label || status;

  return (
    <span className={`status-tag status-tag--${finalVariant}`}>
      {finalLabel}
    </span>
  );
}

export { STATUS_DICT };
