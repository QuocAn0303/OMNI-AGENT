/**
 * MoneyDisplay — format tiền VND thống nhất toàn app
 *
 * Props:
 *   value:       number — số tiền (đơn vị đồng)
 *   short:       boolean — rút gọn (125,000,000 → "125M")
 *   showCurrency: boolean — hiện "₫" hay "VND" (default true)
 *   className:   string
 */

const VND_FORMATTER = new Intl.NumberFormat('vi-VN', {
  style: 'currency',
  currency: 'VND',
  maximumFractionDigits: 0,
});

const NUMBER_FORMATTER = new Intl.NumberFormat('vi-VN', {
  maximumFractionDigits: 0,
});

export default function MoneyDisplay({
  value,
  short = false,
  showCurrency = true,
  className = '',
}) {
  if (value == null || isNaN(value)) {
    return <span className={`money ${className}`}>—</span>;
  }

  if (short) {
    return (
      <span className={`money ${className}`}>
        {formatShort(value)}
        {showCurrency && <span style={{ opacity: 0.6, marginLeft: 2 }}>₫</span>}
      </span>
    );
  }

  if (showCurrency) {
    return (
      <span className={`money ${className}`}>
        {VND_FORMATTER.format(value).replace('₫', '').trim()}
        <span style={{ opacity: 0.6, marginLeft: 2 }}>₫</span>
      </span>
    );
  }

  return (
    <span className={`money ${className}`}>
      {NUMBER_FORMATTER.format(value)}
    </span>
  );
}

function formatShort(n) {
  const abs = Math.abs(n);
  if (abs >= 1e9) return (n / 1e9).toFixed(abs >= 1e10 ? 0 : 1) + 'B';
  if (abs >= 1e6) return (n / 1e6).toFixed(abs >= 1e7 ? 0 : 1) + 'M';
  if (abs >= 1e3) return (n / 1e3).toFixed(abs >= 1e4 ? 0 : 1) + 'K';
  return NUMBER_FORMATTER.format(n);
}

