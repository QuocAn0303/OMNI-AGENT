// src/modules/reports/report.service.js
const prisma = require("../../config/prisma");

// Helper: tránh lệch timezone UTC+7
const toLocalDateString = (date) =>
  date.toLocaleDateString("sv-SE", { timeZone: "Asia/Ho_Chi_Minh" });

const toLocalMonthString = (date) => toLocalDateString(date).slice(0, 7); // "YYYY-MM"

// ==================== GET REVENUE (theo ngày) ====================
const getRevenue = async (from, to) => {
  if (!from || !to) {
    throw {
      status: 400,
      message: "Vui lòng cung cấp ngày bắt đầu (from) và ngày kết thúc (to)",
    };
  }

  const startDate = new Date(from);
  startDate.setHours(0, 0, 0, 0);

  const endDate = new Date(to);
  endDate.setHours(23, 59, 59, 999);

  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    throw { status: 400, message: "Định dạng ngày không hợp lệ" };
  }

  const orders = await prisma.order.findMany({
    where: {
      status: "COMPLETED",
      createdAt: { gte: startDate, lte: endDate },
    },
    select: { createdAt: true, total: true },
    orderBy: { createdAt: "asc" },
  });

  const revenueByDate = orders.reduce((acc, order) => {
    const dateStr = toLocalDateString(order.createdAt); // ✅ fix timezone
    acc[dateStr] = (acc[dateStr] || 0) + Number(order.total);
    return acc;
  }, {});

  return Object.keys(revenueByDate).map((date) => ({
    date,
    revenue: revenueByDate[date],
  }));
};

// ==================== GET REVENUE MONTHLY ====================
const getRevenueMonthly = async () => {
  // Giới hạn 12 tháng gần nhất, tránh load toàn bộ bảng
  const twelveMonthsAgo = new Date();
  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

  const orders = await prisma.order.findMany({
    where: {
      status: "COMPLETED",
      createdAt: { gte: twelveMonthsAgo },
    },
    select: { createdAt: true, total: true },
    orderBy: { createdAt: "asc" },
  });

  const revenueByMonth = orders.reduce((acc, order) => {
    const monthStr = toLocalMonthString(order.createdAt); // ✅ fix timezone
    acc[monthStr] = (acc[monthStr] || 0) + Number(order.total);
    return acc;
  }, {});

  return Object.keys(revenueByMonth).map((month) => ({
    month,
    revenue: revenueByMonth[month],
  }));
};

// ==================== GET TOP PRODUCTS ====================
const getTopProducts = async (limit = 10) => {
  const completedOrders = await prisma.order.findMany({
    where: { status: "COMPLETED" },
    select: { id: true },
  });
  const orderIds = completedOrders.map((o) => o.id);

  if (orderIds.length === 0) return [];

  const topItems = await prisma.orderItem.groupBy({
    by: ["productId"],
    where: { orderId: { in: orderIds } },
    _sum: { quantity: true, subtotal: true },
    orderBy: { _sum: { quantity: "desc" } },
    take: Number(limit),
  });

  const productIds = topItems.map((item) => item.productId);
  const products = await prisma.product.findMany({
    where: { id: { in: productIds }, isActive: true },
    select: { id: true, name: true, sku: true },
  });

  return topItems.map((item) => {
    const product = products.find((p) => p.id === item.productId);
    return {
      productId: item.productId,
      sku: product?.sku || "N/A",
      name: product?.name || "Sản phẩm không xác định",
      totalQuantitySold: item._sum.quantity || 0,
      totalRevenue: Number(item._sum.subtotal || 0),
    };
  });
};

// ==================== GET INVENTORY REPORT ====================
const getInventoryReport = async () => {
  const inventories = await prisma.inventory.findMany({
    where: {
      product: { isActive: true },
    },
    include: {
      product: { select: { id: true, name: true, sku: true, costPrice: true } },
    },
    orderBy: { quantity: "desc" },
  });

  const details = inventories.map((inv) => {
    const costPrice = Number(inv.product.costPrice || 0);
    const quantity = inv.quantity;
    return {
      productId: inv.product.id,
      sku: inv.product.sku,
      name: inv.product.name,
      quantity,
      costPrice,
      totalValue: quantity * costPrice,
    };
  });

  const summary = {
    totalItems: details.reduce((sum, item) => sum + item.quantity, 0),
    totalInventoryValue: details.reduce(
      (sum, item) => sum + item.totalValue,
      0,
    ),
  };

  return { summary, details };
};

// ==================== EXPORT REVENUE -> EXCEL ====================
// Chú thích: hàm này tạo buffer Excel và trả về cho controller để stream về client
const exportRevenueExcel = async (from, to) => {
  const rows = await getRevenue(from, to); // [{date,revenue}, ...]
  const ExcelJS = require("exceljs");
  const wb = new ExcelJS.Workbook();
  wb.creator = "Aduu";
  const ws = wb.addWorksheet("Doanh thu");

  // Header (tiếng Việt để người đọc dễ hiểu)
  ws.addRow(["Ngày", "Doanh thu (VND)"]);
  ws.getRow(1).font = { bold: true };

  rows.forEach((r) => {
    ws.addRow([r.date, Number(r.revenue)]);
  });

  // Tổng
  const total = rows.reduce((s, r) => s + Number(r.revenue), 0);
  ws.addRow([]);
  ws.addRow(["Tổng", total]);
  ws.getRow(ws.rowCount).font = { bold: true };

  const buf = await wb.xlsx.writeBuffer();
  return buf;
};

// ==================== EXPORT INVENTORY -> EXCEL ====================
const exportInventoryExcel = async () => {
  const data = await getInventoryReport();
  const ExcelJS = require("exceljs");
  const wb = new ExcelJS.Workbook();
  wb.creator = "Aduu";

  // Summary sheet
  const s1 = wb.addWorksheet("Tổng quan tồn kho");
  s1.addRow(["Tổng số mặt hàng", data.summary.totalItems]);
  s1.addRow(["Tổng giá trị tồn kho (VND)", data.summary.totalInventoryValue]);

  // Details sheet
  const s2 = wb.addWorksheet("Chi tiết tồn kho");
  s2.addRow(["SKU", "Tên sản phẩm", "Số lượng", "Giá vốn", "Giá trị"]);
  s2.getRow(1).font = { bold: true };
  data.details.forEach((d) => {
    s2.addRow([d.sku, d.name, d.quantity, d.costPrice, d.totalValue]);
  });

  const buf = await wb.xlsx.writeBuffer();
  return buf;
};

const dateRangeWhere = (from, to) => {
  const start = new Date(from);
  start.setHours(0, 0, 0, 0);
  const end = new Date(to);
  end.setHours(23, 59, 59, 999);
  return { gte: start, lte: end };
};

const fmt = (n) => Number(n || 0).toLocaleString("vi-VN");
const fmtDate = (d) => toLocalDateString(new Date(d));

const STATUS_VI = {
  PENDING: "Ch\u1edd x\u1eed l\u00fd", CONFIRMED: "\u0110\u00e3 x\u00e1c nh\u1eadn",
  SHIPPING: "\u0110ang giao", COMPLETED: "Ho\u00e0n th\u00e0nh", CANCELLED: "\u0110\u00e3 hu\u1ef7",
};
const PAYMENT_VI = {
  CASH: "Ti\u1ec1n m\u1eb7t", BANK_TRANSFER: "Chuy\u1ec3n kho\u1ea3n", CARD: "Th\u1ebb",
};
const SHIFT_VI = { MORNING: "Ca s\u00e1ng", AFTERNOON: "Ca chi\u1ec1u", NIGHT: "Ca t\u1ed1i" };

// \u2500\u2500\u2500 Style helpers \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
const HEADER_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F766E" } };
const SUBHEADER_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FF115E59" } };
const ACCENT_FILL  = { type: "pattern", pattern: "solid", fgColor: { argb: "FFCCFBF1" } };
const TOTAL_FILL   = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF0FDF4" } };
const WHITE_FONT   = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
const BOLD_FONT    = { bold: true, size: 11 };
const NUM_FMT      = '#,##0';
const DATE_FMT     = 'DD/MM/YYYY';

const addMeta = (ws, title, dateFrom, dateTo, colSpan) => {
  // Ti\u00eau \u0111\u1ec1
  ws.mergeCells(`A1:${String.fromCharCode(64 + colSpan)}1`);
  const titleCell = ws.getCell("A1");
  titleCell.value = title;
  titleCell.font = { bold: true, size: 14, color: { argb: "FF0F172A" } };
  titleCell.alignment = { horizontal: "center", vertical: "middle" };
  titleCell.fill = ACCENT_FILL;
  ws.getRow(1).height = 30;

  // Kho\u1ea3ng th\u1eddi gian
  ws.mergeCells(`A2:${String.fromCharCode(64 + colSpan)}2`);
  const subCell = ws.getCell("A2");
  subCell.value = `K\u1ef3 b\u00e1o c\u00e1o: ${dateFrom} \u2192 ${dateTo}   |   Xu\u1ea5t l\u00fac: ${new Date().toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}`;
  subCell.font = { italic: true, size: 10, color: { argb: "FF475569" } };
  subCell.alignment = { horizontal: "center" };
  ws.getRow(2).height = 18;

  ws.addRow([]); // d\u00f2ng tr\u1ed1ng
};

const styleHeaderRow = (ws, rowNum, colCount) => {
  const row = ws.getRow(rowNum);
  row.height = 22;
  for (let c = 1; c <= colCount; c++) {
    const cell = row.getCell(c);
    cell.fill = HEADER_FILL;
    cell.font = WHITE_FONT;
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.border = { bottom: { style: "thin", color: { argb: "FF0D9488" } } };
  }
};

const styleDataRows = (ws, startRow, endRow, colCount) => {
  for (let r = startRow; r <= endRow; r++) {
    const isEven = (r - startRow) % 2 === 0;
    for (let c = 1; c <= colCount; c++) {
      const cell = ws.getCell(r, c);
      if (isEven) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };
      cell.border = {
        bottom: { style: "hair", color: { argb: "FFE2E8F0" } },
        left:   c === 1 ? { style: "thin", color: { argb: "FFCBD5E1" } } : undefined,
        right:  c === colCount ? { style: "thin", color: { argb: "FFCBD5E1" } } : undefined,
      };
    }
  }
};

const addTotalRow = (ws, label, values, colCount) => {
  const row = ws.addRow([label, ...values]);
  row.height = 20;
  for (let c = 1; c <= colCount; c++) {
    const cell = row.getCell(c);
    cell.fill = TOTAL_FILL;
    cell.font = BOLD_FONT;
    cell.border = { top: { style: "medium", color: { argb: "FF0F766E" } } };
  }
};

// \u2500\u2500\u2500 EXPORT: SALES \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
const exportSalesExcel = async (from, to) => {
  const ExcelJS = require("exceljs");
  const orders = await prisma.order.findMany({
    where: { createdAt: dateRangeWhere(from, to) },
    include: { customer: { select: { name: true } }, createdBy: { select: { fullName: true } }, items: true },
    orderBy: { createdAt: "asc" },
  });

  const wb = new ExcelJS.Workbook();
  wb.creator = "Aduu";

  // \u2500\u2500 Sheet 1: T\u1ed5ng quan \u2500\u2500
  const ws1 = wb.addWorksheet("T\u1ed5ng quan");
  addMeta(ws1, "B\u00c1O C\u00c1O DOANH THU", from, to, 2);

  const totalRevenue = orders.filter(o => o.status === "COMPLETED").reduce((s, o) => s + Number(o.total), 0);
  const completedOrders = orders.filter(o => o.status === "COMPLETED");

  const summaryData = [
    ["T\u1ed5ng \u0111\u01a1n h\u00e0ng", orders.length],
    ["\u0110\u01a1n ho\u00e0n th\u00e0nh", completedOrders.length],
    ["\u0110\u01a1n hu\u1ef7", orders.filter(o => o.status === "CANCELLED").length],
    ["T\u1ed5ng doanh thu (VND)", totalRevenue],
    ["Doanh thu trung b\u00ecnh/\u0111\u01a1n (VND)", completedOrders.length ? Math.round(totalRevenue / completedOrders.length) : 0],
  ];

  ws1.getRow(4).values = ["Ch\u1ec9 ti\u00eau", "Gi\u00e1 tr\u1ecb"];
  styleHeaderRow(ws1, 4, 2);
  summaryData.forEach(([label, val], i) => {
    ws1.addRow([label, val]);
    if (typeof val === "number") ws1.getCell(5 + i, 2).numFmt = NUM_FMT;
  });
  styleDataRows(ws1, 5, 5 + summaryData.length - 1, 2);
  ws1.getColumn(1).width = 36;
  ws1.getColumn(2).width = 20;

  // Doanh thu theo ph\u01b0\u01a1ng th\u1ee9c
  ws1.addRow([]);
  const pmRow = ws1.rowCount + 1;
  ws1.getRow(pmRow).values = ["Ph\u01b0\u01a1ng th\u1ee9c thanh to\u00e1n", "S\u1ed1 \u0111\u01a1n", "Doanh thu (VND)"];
  styleHeaderRow(ws1, pmRow, 3);
  const byPM = {};
  orders.filter(o => o.status !== "CANCELLED").forEach(o => {
    if (!byPM[o.paymentMethod]) byPM[o.paymentMethod] = { count: 0, total: 0 };
    byPM[o.paymentMethod].count++;
    byPM[o.paymentMethod].total += Number(o.total);
  });
  Object.entries(byPM).forEach(([pm, v]) => {
    const r = ws1.addRow([PAYMENT_VI[pm] || pm, v.count, v.total]);
    r.getCell(3).numFmt = NUM_FMT;
  });
  styleDataRows(ws1, pmRow + 1, ws1.rowCount, 3);
  ws1.getColumn(3).width = 20;

  // \u2500\u2500 Sheet 2: Chi ti\u1ebft \u0111\u01a1n h\u00e0ng \u2500\u2500
  const ws2 = wb.addWorksheet("Chi ti\u1ebft \u0111\u01a1n h\u00e0ng");
  const cols2 = ["M\u00e3 \u0111\u01a1n", "Ng\u00e0y", "Kh\u00e1ch h\u00e0ng", "Nh\u00e2n vi\u00ean", "Tr\u1ea1ng th\u00e1i", "Thanh to\u00e1n", "T\u1ea1m t\u00ednh", "Gi\u1ea3m gi\u00e1", "T\u1ed5ng ti\u1ec1n"];
  addMeta(ws2, "CHI TI\u1ebeT \u0110\u01a0N H\u00c0NG", from, to, cols2.length);
  ws2.getRow(4).values = cols2;
  styleHeaderRow(ws2, 4, cols2.length);

  orders.forEach(o => {
    const row = ws2.addRow([
      o.orderCode,
      fmtDate(o.createdAt),
      o.customer?.name || "Kh\u00e1ch l\u1ebb",
      o.createdBy?.fullName || "",
      STATUS_VI[o.status] || o.status,
      PAYMENT_VI[o.paymentMethod] || o.paymentMethod,
      Number(o.subtotal),
      Number(o.discount),
      Number(o.total),
    ]);
    [7,8,9].forEach(c => { row.getCell(c).numFmt = NUM_FMT; });
  });
  styleDataRows(ws2, 5, ws2.rowCount, cols2.length);
  if (orders.length) {
    addTotalRow(ws2, "T\u1ed4NG", [
      "", "", "", "",
      orders.reduce((s,o) => s+Number(o.subtotal), 0),
      orders.reduce((s,o) => s+Number(o.discount), 0),
      orders.reduce((s,o) => s+Number(o.total), 0),
    ], cols2.length);
    [7,8,9].forEach(c => ws2.lastRow.getCell(c).numFmt = NUM_FMT);
  }
  [18, 12, 14, 14, 14, 14, 16, 12, 16].forEach((w, i) => ws2.getColumn(i+1).width = w);

  return { buffer: await wb.xlsx.writeBuffer(), contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
};

// \u2500\u2500\u2500 EXPORT: ORDERS \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
const exportOrdersExcel = async (from, to) => {
  const ExcelJS = require("exceljs");
  const orders = await prisma.order.findMany({
    where: { createdAt: dateRangeWhere(from, to) },
    include: {
      customer: { select: { name: true, phone: true } },
      createdBy: { select: { fullName: true } },
      items: { include: { product: { select: { name: true, sku: true } } } },
    },
    orderBy: { createdAt: "desc" },
  });

  const wb = new ExcelJS.Workbook();
  wb.creator = "Aduu";

  // Sheet 1: Danh s\u00e1ch \u0111\u01a1n
  const ws1 = wb.addWorksheet("Danh s\u00e1ch \u0111\u01a1n h\u00e0ng");
  const cols1 = ["M\u00e3 \u0111\u01a1n", "Ng\u00e0y t\u1ea1o", "Kh\u00e1ch h\u00e0ng", "S\u0110T", "Nh\u00e2n vi\u00ean", "S\u1ed1 SP", "Tr\u1ea1ng th\u00e1i", "Thanh to\u00e1n", "T\u1ed5ng ti\u1ec1n (VND)"];
  addMeta(ws1, "B\u00c1O C\u00c1O \u0110\u01a0N H\u00c0NG", from, to, cols1.length);
  ws1.getRow(4).values = cols1;
  styleHeaderRow(ws1, 4, cols1.length);
  orders.forEach(o => {
    const row = ws1.addRow([
      o.orderCode, fmtDate(o.createdAt),
      o.customer?.name || "Kh\u00e1ch l\u1ebb", o.customer?.phone || "",
      o.createdBy?.fullName || "", o.items.length,
      STATUS_VI[o.status] || o.status, PAYMENT_VI[o.paymentMethod] || o.paymentMethod,
      Number(o.total),
    ]);
    row.getCell(9).numFmt = NUM_FMT;
  });
  styleDataRows(ws1, 5, ws1.rowCount, cols1.length);
  if (orders.length) {
    addTotalRow(ws1, `T\u1ed4NG: ${orders.length} \u0111\u01a1n`, ["","","","","","","", orders.reduce((s,o) => s+Number(o.total), 0)], cols1.length);
    ws1.lastRow.getCell(9).numFmt = NUM_FMT;
  }
  [18,12,16,13,14,8,14,14,18].forEach((w,i) => ws1.getColumn(i+1).width = w);

  // Sheet 2: Chi ti\u1ebft s\u1ea3n ph\u1ea9m trong \u0111\u01a1n
  const ws2 = wb.addWorksheet("Chi ti\u1ebft s\u1ea3n ph\u1ea9m");
  const cols2 = ["M\u00e3 \u0111\u01a1n", "Ng\u00e0y", "SKU", "S\u1ea3n ph\u1ea9m", "S\u1ed1 l\u01b0\u1ee3ng", "\u0110\u01a1n gi\u00e1 (VND)", "Th\u00e0nh ti\u1ec1n (VND)"];
  addMeta(ws2, "CHI TI\u1ebeT S\u1ea2N PH\u1ea8M TRONG \u0110\u01a0N", from, to, cols2.length);
  ws2.getRow(4).values = cols2;
  styleHeaderRow(ws2, 4, cols2.length);
  orders.forEach(o => {
    o.items.forEach(it => {
      const row = ws2.addRow([o.orderCode, fmtDate(o.createdAt), it.product.sku, it.product.name, it.quantity, Number(it.price), Number(it.subtotal)]);
      [6,7].forEach(c => row.getCell(c).numFmt = NUM_FMT);
    });
  });
  styleDataRows(ws2, 5, ws2.rowCount, cols2.length);
  [18,12,12,24,10,18,18].forEach((w,i) => ws2.getColumn(i+1).width = w);

  return { buffer: await wb.xlsx.writeBuffer(), contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
};

// \u2500\u2500\u2500 EXPORT: PROFIT \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
const exportProfitExcel = async (from, to) => {
  const ExcelJS = require("exceljs");
  const orders = await prisma.order.findMany({
    where: { createdAt: dateRangeWhere(from, to), status: { not: "CANCELLED" } },
    include: { items: { include: { product: { select: { name: true, sku: true, costPrice: true } } } } },
    orderBy: { createdAt: "asc" },
  });

  const wb = new ExcelJS.Workbook();
  wb.creator = "Aduu";

  // T\u1ed5ng h\u1ee3p theo s\u1ea3n ph\u1ea9m
  const byProduct = {};
  orders.forEach(o => {
    o.items.forEach(it => {
      if (!byProduct[it.productId]) {
        byProduct[it.productId] = { sku: it.product.sku, name: it.product.name, qty: 0, revenue: 0, cost: 0 };
      }
      byProduct[it.productId].qty += it.quantity;
      byProduct[it.productId].revenue += Number(it.subtotal);
      byProduct[it.productId].cost += Number(it.product.costPrice || 0) * it.quantity;
    });
  });
  const productRows = Object.values(byProduct).map(p => ({ ...p, profit: p.revenue - p.cost, margin: p.revenue ? ((p.revenue - p.cost) / p.revenue * 100) : 0 })).sort((a, b) => b.profit - a.profit);

  const ws1 = wb.addWorksheet("L\u1ee3i nhu\u1eadn theo s\u1ea3n ph\u1ea9m");
  const cols1 = ["SKU", "S\u1ea3n ph\u1ea9m", "SL b\u00e1n", "Doanh thu (VND)", "Gi\u00e1 v\u1ed1n (VND)", "L\u1ee3i nhu\u1eadn (VND)", "Margin (%)"];
  addMeta(ws1, "B\u00c1O C\u00c1O L\u1ee2I NHU\u1eacN", from, to, cols1.length);
  ws1.getRow(4).values = cols1;
  styleHeaderRow(ws1, 4, cols1.length);
  productRows.forEach(p => {
    const row = ws1.addRow([p.sku, p.name, p.qty, p.revenue, p.cost, p.profit, +p.margin.toFixed(1)]);
    [4,5,6].forEach(c => row.getCell(c).numFmt = NUM_FMT);
    row.getCell(7).numFmt = '0.0"%"';
    if (p.profit < 0) row.getCell(6).font = { color: { argb: "FFDC2626" }, bold: true };
  });
  styleDataRows(ws1, 5, ws1.rowCount, cols1.length);
  const totalRev = productRows.reduce((s,p) => s+p.revenue, 0);
  const totalCost = productRows.reduce((s,p) => s+p.cost, 0);
  addTotalRow(ws1, "T\u1ed4NG", ["", productRows.reduce((s,p) => s+p.qty, 0), totalRev, totalCost, totalRev - totalCost, ""], cols1.length);
  [5,6,7].forEach(c => ws1.lastRow.getCell(c).numFmt = NUM_FMT);
  [12,28,10,18,18,18,12].forEach((w,i) => ws1.getColumn(i+1).width = w);

  // Sheet 2: Chi ti\u1ebft t\u1eebng \u0111\u01a1n
  const ws2 = wb.addWorksheet("Chi ti\u1ebft theo \u0111\u01a1n");
  const cols2 = ["M\u00e3 \u0111\u01a1n", "Ng\u00e0y", "S\u1ea3n ph\u1ea9m", "S\u1ed1 l\u01b0\u1ee3ng", "Doanh thu", "Gi\u00e1 v\u1ed1n", "L\u1ee3i nhu\u1eadn"];
  addMeta(ws2, "CHI TI\u1ebeT L\u1ee2I NHU\u1eacN THEO \u0110\u01a0N", from, to, cols2.length);
  ws2.getRow(4).values = cols2;
  styleHeaderRow(ws2, 4, cols2.length);
  orders.forEach(o => {
    o.items.forEach(it => {
      const rev = Number(it.subtotal);
      const cost = Number(it.product.costPrice || 0) * it.quantity;
      const row = ws2.addRow([o.orderCode, fmtDate(o.createdAt), it.product.name, it.quantity, rev, cost, rev - cost]);
      [5,6,7].forEach(c => row.getCell(c).numFmt = NUM_FMT);
    });
  });
  styleDataRows(ws2, 5, ws2.rowCount, cols2.length);
  [18,12,26,10,18,18,18].forEach((w,i) => ws2.getColumn(i+1).width = w);

  return { buffer: await wb.xlsx.writeBuffer(), contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
};

// \u2500\u2500\u2500 EXPORT: CUSTOMERS \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
const exportCustomersExcel = async (from, to) => {
  const ExcelJS = require("exceljs");
  const customers = await prisma.customer.findMany({
    where: { isActive: true },
    include: {
      orders: {
        where: { createdAt: dateRangeWhere(from, to), status: { not: "CANCELLED" } },
        select: { total: true, createdAt: true },
      },
    },
    orderBy: { totalSpent: "desc" },
  });

  const wb = new ExcelJS.Workbook();
  wb.creator = "Aduu";

  const ws = wb.addWorksheet("Kh\u00e1ch h\u00e0ng");
  const cols = ["#", "T\u00ean kh\u00e1ch h\u00e0ng", "\u0110i\u1ec7n tho\u1ea1i", "Email", "\u0110\u1ecba ch\u1ec9", "\u0110\u01a1n trong k\u1ef3", "Doanh thu trong k\u1ef3 (VND)", "T\u1ed5ng chi ti\u00eau (VND)"];
  addMeta(ws, "B\u00c1O C\u00c1O KH\u00c1CH H\u00c0NG", from, to, cols.length);
  ws.getRow(4).values = cols;
  styleHeaderRow(ws, 4, cols.length);
  customers.forEach((c, i) => {
    const periodRev = c.orders.reduce((s, o) => s + Number(o.total), 0);
    const row = ws.addRow([i + 1, c.name, c.phone || "", c.email || "", c.address || "", c.orders.length, periodRev, Number(c.totalSpent)]);
    [7,8].forEach(col => row.getCell(col).numFmt = NUM_FMT);
    // Top 3 d\u00f9ng m\u00e0u v\u00e0ng
    if (i < 3) row.getCell(2).font = { bold: true, color: { argb: "FFB45309" } };
  });
  styleDataRows(ws, 5, ws.rowCount, cols.length);
  if (customers.length) {
    addTotalRow(ws, `T\u1ed4NG: ${customers.length} kh\u00e1ch`, ["","","","",
      customers.reduce((s,c) => s+c.orders.length, 0),
      customers.reduce((s,c) => s+c.orders.reduce((ss,o) => ss+Number(o.total), 0), 0),
      customers.reduce((s,c) => s+Number(c.totalSpent), 0),
    ], cols.length);
    [7,8].forEach(col => ws.lastRow.getCell(col).numFmt = NUM_FMT);
  }
  [5,22,13,22,20,12,22,22].forEach((w,i) => ws.getColumn(i+1).width = w);

  return { buffer: await wb.xlsx.writeBuffer(), contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
};

// \u2500\u2500\u2500 EXPORT: INVENTORY \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
const exportInventoryExcelFull = async (from, to) => {
  const ExcelJS = require("exceljs");
  const data = await getInventoryReport();
  const today = new Date().toISOString().slice(0, 10);

  const wb = new ExcelJS.Workbook();
  wb.creator = "Aduu";

  // Sheet 1: T\u1ed3n kho \u0111\u1ea7y \u0111\u1ee7
  const ws1 = wb.addWorksheet("T\u1ed3n kho");
  const cols1 = ["#", "SKU", "T\u00ean s\u1ea3n ph\u1ea9m", "T\u1ed3n kho", "T\u1ed3n t\u1ed1i thi\u1ec3u", "Gi\u00e1 v\u1ed1n (VND)", "Gi\u00e1 tr\u1ecb t\u1ed3n (VND)", "Tr\u1ea1ng th\u00e1i"];
  addMeta(ws1, "B\u00c1O C\u00c1O T\u1ed2N KHO", today, today, cols1.length);

  const inventories = await prisma.inventory.findMany({
    where: { product: { isActive: true } },
    include: { product: { select: { name: true, sku: true, costPrice: true } } },
    orderBy: { quantity: "asc" },
  });

  ws1.getRow(4).values = cols1;
  styleHeaderRow(ws1, 4, cols1.length);
  inventories.forEach((inv, i) => {
    const isLow = inv.quantity <= inv.minStock;
    const row = ws1.addRow([
      i + 1, inv.product.sku, inv.product.name,
      inv.quantity, inv.minStock,
      Number(inv.product.costPrice || 0),
      inv.quantity * Number(inv.product.costPrice || 0),
      isLow ? "\u26a0\ufe0f S\u1eafp h\u1ebft" : "\u2713 B\u00ecnh th\u01b0\u1eddng",
    ]);
    [6,7].forEach(c => row.getCell(c).numFmt = NUM_FMT);
    if (isLow) {
      row.getCell(4).font = { color: { argb: "FFDC2626" }, bold: true };
      row.getCell(8).font = { color: { argb: "FFDC2626" } };
    }
  });
  styleDataRows(ws1, 5, ws1.rowCount, cols1.length);
  const totalQty = inventories.reduce((s,i) => s+i.quantity, 0);
  const totalVal = inventories.reduce((s,i) => s + i.quantity * Number(i.product.costPrice || 0), 0);
  addTotalRow(ws1, "T\u1ed4NG", ["", "", totalQty, "", "", totalVal, ""], cols1.length);
  ws1.lastRow.getCell(7).numFmt = NUM_FMT;
  [5,12,28,10,12,18,20,14].forEach((w,i) => ws1.getColumn(i+1).width = w);

  // Sheet 2: S\u1ea3n ph\u1ea9m s\u1eafp h\u1ebft
  const ws2 = wb.addWorksheet("\u26a0\ufe0f S\u1eafp h\u1ebft h\u00e0ng");
  const lowStock = inventories.filter(inv => inv.quantity <= inv.minStock);
  addMeta(ws2, "S\u1ea2N PH\u1ea8M S\u1eaeP H\u1ebeT H\u00c0NG", today, today, 6);
  ws2.getRow(4).values = ["SKU", "T\u00ean s\u1ea3n ph\u1ea9m", "T\u1ed3n kho", "T\u1ed3n t\u1ed1i thi\u1ec3u", "Thi\u1ebfu", "Gi\u00e1 v\u1ed1n (VND)"];
  styleHeaderRow(ws2, 4, 6);
  lowStock.forEach(inv => {
    const row = ws2.addRow([inv.product.sku, inv.product.name, inv.quantity, inv.minStock, Math.max(0, inv.minStock - inv.quantity), Number(inv.product.costPrice || 0)]);
    row.getCell(3).font = { color: { argb: "FFDC2626" }, bold: true };
    row.getCell(6).numFmt = NUM_FMT;
  });
  styleDataRows(ws2, 5, ws2.rowCount, 6);
  if (!lowStock.length) ws2.addRow(["Kh\u00f4ng c\u00f3 s\u1ea3n ph\u1ea9m n\u00e0o s\u1eafp h\u1ebft h\u00e0ng \u2713"]);
  [12,28,10,12,10,16].forEach((w,i) => ws2.getColumn(i+1).width = w);

  return { buffer: await wb.xlsx.writeBuffer(), contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
};

// \u2500\u2500\u2500 EXPORT: HR \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
const exportHRExcel = async (from, to) => {
  const ExcelJS = require("exceljs");

  const shifts = await prisma.shift.findMany({
    where: { date: dateRangeWhere(from, to) },
    include: { employee: { include: { user: true } } },
    orderBy: { date: "asc" },
  });

  const violations = await prisma.violation.findMany({
    where: { date: dateRangeWhere(from, to) },
    include: { employee: { include: { user: true } } },
    orderBy: { date: "desc" },
  });

  // T\u00f3m t\u1eaft theo nh\u00e2n vi\u00ean
  const byEmp = {};
  shifts.forEach(s => {
    const name = s.employee.user.fullName;
    if (!byEmp[name]) byEmp[name] = { shifts: 0, hours: 0, violations: 0 };
    byEmp[name].shifts++;
    byEmp[name].hours += 8;
  });
  violations.forEach(v => {
    const name = v.employee.user.fullName;
    if (!byEmp[name]) byEmp[name] = { shifts: 0, hours: 0, violations: 0 };
    byEmp[name].violations++;
  });

  const wb = new ExcelJS.Workbook();
  wb.creator = "Aduu";

  // Sheet 1: T\u1ed5ng h\u1ee3p
  const ws1 = wb.addWorksheet("T\u1ed5ng h\u1ee3p nh\u00e2n s\u1ef1");
  const cols1 = ["Nh\u00e2n vi\u00ean", "S\u1ed1 ca l\u00e0m", "T\u1ed5ng gi\u1edd", "S\u1ed1 vi ph\u1ea1m"];
  addMeta(ws1, "B\u00c1O C\u00c1O NH\u00c2N S\u1ef0", from, to, cols1.length);
  ws1.getRow(4).values = cols1;
  styleHeaderRow(ws1, 4, cols1.length);
  Object.entries(byEmp).forEach(([name, v]) => {
    const row = ws1.addRow([name, v.shifts, v.hours, v.violations]);
    if (v.violations > 0) row.getCell(4).font = { color: { argb: "FFDC2626" } };
  });
  styleDataRows(ws1, 5, ws1.rowCount, cols1.length);
  addTotalRow(ws1, "T\u1ed4NG", [
    shifts.length,
    shifts.length * 8,
    violations.length,
  ], cols1.length);
  [24,12,12,12].forEach((w,i) => ws1.getColumn(i+1).width = w);

  // Sheet 2: Ch\u1ea5m c\u00f4ng chi ti\u1ebft
  const ws2 = wb.addWorksheet("Ch\u1ea5m c\u00f4ng chi ti\u1ebft");
  const cols2 = ["Ng\u00e0y", "Nh\u00e2n vi\u00ean", "V\u1ecb tr\u00ed", "Ca l\u00e0m", "Gi\u1edd c\u00f4ng"];
  addMeta(ws2, "B\u1ea2NG CH\u1ea4M C\u00d4NG", from, to, cols2.length);
  ws2.getRow(4).values = cols2;
  styleHeaderRow(ws2, 4, cols2.length);
  shifts.forEach(s => {
    ws2.addRow([fmtDate(s.date), s.employee.user.fullName, s.employee.position || "", SHIFT_VI[s.type] || s.type, 8]);
  });
  styleDataRows(ws2, 5, ws2.rowCount, cols2.length);
  if (!shifts.length) ws2.addRow(["Kh\u00f4ng c\u00f3 d\u1eef li\u1ec7u ch\u1ea5m c\u00f4ng trong k\u1ef3"]);
  [14,24,14,12,10].forEach((w,i) => ws2.getColumn(i+1).width = w);

  // Sheet 3: Vi ph\u1ea1m
  const ws3 = wb.addWorksheet("Vi ph\u1ea1m");
  const cols3 = ["Ng\u00e0y", "Nh\u00e2n vi\u00ean", "Lo\u1ea1i vi ph\u1ea1m", "Ghi ch\u00fa", "Ph\u1ea1t (VND)"];
  addMeta(ws3, "B\u1ea2NG VI PH\u1ea0M", from, to, cols3.length);
  ws3.getRow(4).values = cols3;
  styleHeaderRow(ws3, 4, cols3.length);
  const VIOL_VI = { LATE: "\u0110i tr\u1ec5", EARLY: "V\u1ec1 s\u1edbm", PACKING_ERROR: "\u0110\u00f3ng g\u00f3i sai", DAMAGED_GOODS: "H\u00e0ng h\u1ecfng", UNAUTHORIZED_ABSENCE: "V\u1eafng kh\u00f4ng ph\u00e9p" };
  violations.forEach(v => {
    const row = ws3.addRow([fmtDate(v.date), v.employee.user.fullName, VIOL_VI[v.type] || v.type, v.note || "", Number(v.penalty || 0)]);
    row.getCell(5).numFmt = NUM_FMT;
    row.getCell(3).font = { color: { argb: "FFDC2626" } };
  });
  styleDataRows(ws3, 5, ws3.rowCount, cols3.length);
  if (!violations.length) ws3.addRow(["Kh\u00f4ng c\u00f3 vi ph\u1ea1m trong k\u1ef3 \u2713"]);
  if (violations.length) {
    addTotalRow(ws3, "T\u1ed5ng ph\u1ea1t", ["", "", "", violations.reduce((s,v) => s+Number(v.penalty||0), 0)], cols3.length);
    ws3.lastRow.getCell(5).numFmt = NUM_FMT;
  }
  [14,24,18,24,14].forEach((w,i) => ws3.getColumn(i+1).width = w);

  return { buffer: await wb.xlsx.writeBuffer(), contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
};

// \u2500\u2500\u2500 DISPATCHER \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
const exportReport = async (type, from, to, format = "xlsx") => {
  let result;
  switch (type) {
    case "sales":     result = await exportSalesExcel(from, to);     break;
    case "orders":    result = await exportOrdersExcel(from, to);    break;
    case "profit":    result = await exportProfitExcel(from, to);    break;
    case "customers": result = await exportCustomersExcel(from, to); break;
    case "inventory": result = await exportInventoryExcelFull(from, to); break;
    case "hr":        result = await exportHRExcel(from, to);        break;
    default: throw { status: 404, message: "Lo\u1ea1i b\u00e1o c\u00e1o kh\u00f4ng t\u1ed3n t\u1ea1i" };
  }

  if (format === "csv") {
    // CSV ch\u1ec9 h\u1ed7 tr\u1ee3 1 sheet \u2014 xu\u1ea5t d\u1eef li\u1ec7u th\u00f4
    return { buffer: Buffer.from("Vui l\u00f2ng xu\u1ea5t \u0111\u1ecbnh d\u1ea1ng Excel \u0111\u1ec3 xem \u0111\u1ea7y \u0111\u1ee7 d\u1eef li\u1ec7u.", "utf8"), contentType: "text/csv" };
  }

  return result;
};

module.exports = {
  getRevenue,
  getRevenueMonthly,
  getTopProducts,
  getInventoryReport,
  exportRevenueExcel,
  exportInventoryExcel,
  exportReport,
};
