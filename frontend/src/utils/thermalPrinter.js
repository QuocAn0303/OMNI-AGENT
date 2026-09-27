/**
 * Thermal Printer Service — ESC/POS commands for 58mm/80mm Bluetooth printers
 *
 * Supports: K80, Xprinter XP-58, Epson TM-T88, and other ESC/POS-compatible printers.
 * Uses Web Bluetooth API (Chrome/Edge on Android, Windows, Mac).
 *
 * Exports:
 * - connect(): Connect to a Bluetooth thermal printer
 * - printReceipt(order, config): Print a POS receipt
 * - printTestPage(): Print a test page to verify connection
 * - disconnect(): Disconnect from printer
 * - isSupported(): Check if Web Bluetooth is available
 */

// ESC/POS command constants
const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;
const CUT_FEED = 4;

// VN thermal printer service UUIDs (common across Xprinter/K80/Epson)
const PRINTER_SERVICE_UUID = '000018f0-0000-1000-8000-00805f9b34fb';
const PRINTER_CHAR_UUID = '00002af1-0000-1000-8000-00805f9b34fb';

let device = null;
let characteristic = null;

function textEncoder() {
  return new TextEncoder();
}

function command(...bytes) {
  return new Uint8Array(bytes);
}

function textLine(str, align = 'left') {
  const encoder = textEncoder();
  const raw = encoder.encode(str);
  const cmd = [];
  if (align === 'center') cmd.push(ESC, 0x61, 1);
  else if (align === 'right') cmd.push(ESC, 0x61, 2);
  else cmd.push(ESC, 0x61, 0);
  return new Uint8Array([...cmd, ...raw, LF]);
}

function boldLine(str) {
  const encoder = textEncoder();
  const raw = encoder.encode(str);
  return new Uint8Array([ESC, 0x45, 1, ...raw, ESC, 0x45, 0, LF]);
}

function doubleSize(str) {
  const encoder = textEncoder();
  const raw = encoder.encode(str);
  return new Uint8Array([ESC, 0x21, 0x30, ESC, 0x61, 1, ...raw, ESC, 0x21, 0x00, ESC, 0x61, 0, LF]);
}

function dashedLine() {
  const line = '-'.repeat(32);
  return textLine(line);
}

function cutPaper() {
  return command(GS, 0x56, 0x42, CUT_FEED);
}

function openCashDrawer() {
  return command(ESC, 0x70, 0x00, 0x19, 0xfa);
}

function padRight(str, len) {
  const clean = (str || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (clean.length >= len) return clean.substring(0, len);
  return clean + ' '.repeat(len - clean.length);
}

function formatMoney(val) {
  return Number(val || 0).toLocaleString('vi-VN');
}

/**
 * Build receipt bytes from order data
 */
export function buildReceiptBytes(order, config = {}) {
  const {
    shopName = 'CỬA HÀNG CỦA BẠN',
    shopAddress = '',
    shopPhone = '',
    note = 'Cảm ơn quý khách! Hẹn gặp lại.',
  } = config;

  const parts = [];

  // Header
  parts.push(doubleSize(shopName));
  if (shopAddress) parts.push(textLine(shopAddress, 'center'));
  if (shopPhone) parts.push(textLine(shopPhone, 'center'));
  parts.push(dashedLine());

  // Order info
  parts.push(textLine(`Số HĐ: ${order.orderCode || '---'}`));
  parts.push(textLine(`Ngay: ${new Date(order.createdAt || Date.now()).toLocaleString('vi-VN')}`));
  if (order.customerName) {
    parts.push(textLine(`KH: ${order.customerName}`));
  }
  parts.push(dashedLine());

  // Column headers
  parts.push(boldLine(padRight('Mặt hàng', 16) + padRight('SL', 4) + padRight('Đơn giá', 6) + 'Thành tiền'));

  // Items
  const items = order.items || [];
  for (const item of items) {
    const name = padRight((item.name || item.productName || 'SP').substring(0, 16), 16);
    const qty = padRight(String(item.quantity || 1), 4);
    const price = padRight(formatMoney(item.price), 6);
    const subtotal = formatMoney((item.quantity || 1) * (item.price || 0));
    parts.push(textLine(name + qty + price + subtotal));
  }

  parts.push(dashedLine());

  // Totals
  if (order.subtotal) {
    parts.push(textLine(padRight('Tạm tính:', 20) + padRight(formatMoney(order.subtotal), 12), 'right'));
  }
  if (order.discount > 0) {
    parts.push(textLine(padRight('Giảm giá:', 20) + padRight('-' + formatMoney(order.discount), 12), 'right'));
  }
  parts.push(boldLine(padRight('TỔNG CỘNG:', 20) + padRight(formatMoney(order.total), 12)));

  // Payment info
  const payments = order.payments || [];
  if (payments.length > 0) {
    parts.push(dashedLine());
    for (const p of payments) {
      const methodLabel = { CASH: 'Tiền mặt', CARD: 'Thẻ', BANK_TRANSFER: 'CK' }[p.method] || p.method;
      parts.push(textLine(padRight(methodLabel + ':', 20) + padRight(formatMoney(p.amount), 12), 'right'));
    }
  }

  // Footer
  parts.push(dashedLine());
  parts.push(textLine(note, 'center'));
  parts.push(LF, LF);

  // Cut paper
  parts.push(cutPaper());

  // Open cash drawer (if CASH payment)
  const hasCash = payments.some(p => p.method === 'CASH');
  if (hasCash) {
    parts.push(openCashDrawer());
  }

  // Concatenate all parts
  const totalLen = parts.reduce((sum, p) => sum + (p.length || p.byteLength || 0), 0);
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const p of parts) {
    const arr = p instanceof Uint8Array ? p : new Uint8Array(p);
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

/**
 * Connect to Bluetooth thermal printer
 */
export async function connect() {
  if (!isSupported()) {
    throw new Error('Trình duyệt không hỗ trợ Bluetooth. Vui lòng sử dụng Chrome/Edge trên Android, Windows hoặc Mac.');
  }

  try {
    device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: [PRINTER_SERVICE_UUID],
    });

    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(PRINTER_SERVICE_UUID);
    characteristic = await service.getCharacteristic(PRINTER_CHAR_UUID);

    return { name: device.name, connected: true };
  } catch (err) {
    if (err.message?.includes('cancelled') || err.message?.includes('chooser')) {
      // User cancelled - not an error
      return null;
    }
    throw err;
  }
}

/**
 * Send data to printer
 */
async function sendData(bytes) {
  if (!characteristic) {
    throw new Error('Chưa kết nối máy in. Vui lòng kết nối trước.');
  }

  // Send in chunks (Bluetooth can only handle small packets)
  const CHUNK_SIZE = 512;
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    const chunk = bytes.slice(i, i + CHUNK_SIZE);
    await characteristic.writeValueWithoutResponse(chunk);
    await new Promise(r => setTimeout(r, 50)); // Small delay between chunks
  }
}

/**
 * Print receipt via Bluetooth
 */
export async function printReceipt(order, config = {}) {
  const bytes = buildReceiptBytes(order, config);
  await sendData(bytes);
}

/**
 * Print a test page
 */
export async function printTestPage() {
  const config = {
    shopName: 'TEST PRINT',
    shopAddress: 'Aduu ERP Thermal Printer',
    shopPhone: '0900000000',
  };
  const testOrder = {
    orderCode: 'TEST-001',
    createdAt: new Date().toISOString(),
    customerName: 'Test Customer',
    items: [
      { name: 'Sản phẩm mẫu 1', quantity: 2, price: 50000 },
      { name: 'Sản phẩm mẫu 2', quantity: 1, price: 150000 },
    ],
    subtotal: 250000,
    discount: 10000,
    total: 240000,
    payments: [{ method: 'CASH', amount: 240000 }],
  };
  const bytes = buildReceiptBytes(testOrder, config);
  await sendData(bytes);
}

/**
 * Disconnect from printer
 */
export async function disconnect() {
  if (device?.gatt?.connected) {
    await device.gatt.disconnect();
  }
  device = null;
  characteristic = null;
}

/**
 * Check if Web Bluetooth is supported
 */
export function isSupported() {
  return !!navigator?.bluetooth?.requestDevice;
}

/**
 * Fallback: print via browser window.print() (css @media print)
 */
export function printViaBrowser(elementId = 'pos-receipt') {
  const el = document.getElementById(elementId);
  if (!el) {
    window.print();
    return;
  }
  const printWindow = window.open('', '_blank', 'width=300,height=600');
  if (!printWindow) {
    window.print();
    return;
  }
  const styles = document.querySelectorAll('style, link[rel="stylesheet"]');
  let styleContent = '';
  styles.forEach(s => {
    if (s.tagName === 'STYLE') styleContent += s.outerHTML;
  });
  printWindow.document.write(`
    <!DOCTYPE html><html><head><meta charset="UTF-8"><title>In hóa đơn</title>
    ${styleContent}</head><body>${el.outerHTML}</body></html>
  `);
  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => { printWindow.print(); printWindow.close(); }, 300);
}
