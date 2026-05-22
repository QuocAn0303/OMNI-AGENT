// src/modules/tax-report/tax-report.service.js
// Tạo báo cáo thuế GTGT (01/GTGT), TNCN (05/KK-TNCN), BHXH (D02-LT)
// và xuất XML đúng schema HTKK.
const prisma = require("../../config/prisma");
const ExcelJS = require("exceljs");

const toNum = (v) => Number(v || 0);
const round0 = (n) => Math.round(Number(n) || 0);

// ======== VAT 01/GTGT ========

/**
 * Tổng hợp thuế GTGT từ dữ liệu đơn hàng + mua hàng.
 * Ưu tiên dùng account 3331/1331 nếu đã được hạch toán,
 * fallback sang tính từ order/purchase data (10% on revenue).
 */
const generateVAT = async (year, month) => {
  const from = new Date(year, month - 1, 1);
  const to   = new Date(year, month, 0, 23, 59, 59);

  // Thử lấy từ TK 3331/1331 trước
  const fetchJournalBalance = async (code, side) => {
    const acc = await prisma.account.findUnique({ where: { code } });
    if (!acc) return 0;
    const lines = await prisma.journalLine.findMany({
      where: { accountId: acc.id, entry: { status: "POSTED", date: { gte: from, lte: to } } },
      select: { debit: true, credit: true },
    });
    return round0(lines.reduce((s, l) => s + toNum(l[side]), 0));
  };

  const [acc3331Credit, acc1331Debit] = await Promise.all([
    fetchJournalBalance("3331", "credit"),
    fetchJournalBalance("1331", "debit"),
  ]);

  // Nếu có số liệu từ journal → dùng
  if (acc3331Credit > 0 || acc1331Debit > 0) {
    const vatPayable = Math.max(0, acc3331Credit - acc1331Debit);
    const vatRefundable = Math.max(0, acc1331Debit - acc3331Credit);
    return { period: { year, month }, vatOutput: acc3331Credit, vatInput: acc1331Debit, vatPayable, vatRefundable };
  }

  // Fallback: tính từ đơn hàng & PO (10% inclusive VAT)
  const [orders, pos] = await Promise.all([
    prisma.order.findMany({
      where: { status: "COMPLETED", createdAt: { gte: from, lte: to } },
      select: { total: true },
    }),
    prisma.purchaseOrder.findMany({
      where: { status: "RECEIVED", receivedAt: { gte: from, lte: to } },
      select: { taxAmount: true },
    }),
  ]);

  const totalRevenue = orders.reduce((s, o) => s + toNum(o.total), 0);
  const vatOutput = round0(totalRevenue - totalRevenue / 1.1);  // VAT 10% inclusive
  const vatInput  = round0(pos.reduce((s, p) => s + toNum(p.taxAmount), 0));
  const vatPayable = Math.max(0, vatOutput - vatInput);
  const vatRefundable = Math.max(0, vatInput - vatOutput);

  return { period: { year, month }, vatOutput, vatInput, vatPayable, vatRefundable };
};

/**
 * Bảng kê hóa đơn bán ra 01-1/GTGT
 */
const generateSalesList = async (year, month) => {
  const from = new Date(year, month - 1, 1);
  const to   = new Date(year, month, 0, 23, 59, 59);

  const orders = await prisma.order.findMany({
    where: {
      status: "COMPLETED",
      createdAt: { gte: from, lte: to },
    },
    include: {
      customer: { select: { name: true, taxCode: true, address: true } },
      electronicInvoice: { select: { invoiceNo: true, serial: true, issueDate: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  return orders.map((o) => {
    const total = toNum(o.total);
    const taxRate = 10;
    const totalBeforeTax = round0(total / (1 + taxRate / 100));
    const taxAmount = round0(total - totalBeforeTax);
    return {
      invoiceNo:    o.electronicInvoice?.invoiceNo || "",
      serial:       o.electronicInvoice?.serial || "",
      invoiceDate:  o.electronicInvoice?.issueDate || o.createdAt,
      buyerName:    o.customer?.name || "Khách lẻ",
      buyerTaxCode: o.customer?.taxCode || "",
      buyerAddress: o.customer?.address || "",
      totalBeforeTax,
      taxRate,
      taxAmount,
      total: round0(total),
      orderCode: o.orderCode,
    };
  });
};

/**
 * Bảng kê hóa đơn mua vào 01-2/GTGT
 */
const generatePurchaseList = async (year, month) => {
  const from = new Date(year, month - 1, 1);
  const to   = new Date(year, month, 0, 23, 59, 59);

  const pos = await prisma.purchaseOrder.findMany({
    where: {
      status: "RECEIVED",
      receivedAt: { gte: from, lte: to },
    },
    include: {
      vendor: { select: { name: true, taxCode: true, address: true } },
    },
    orderBy: { receivedAt: "asc" },
  });

  return pos.map((po) => ({
    poCode:       po.poCode,
    invoiceNo:    po.invoiceNumber || "",
    invoiceDate:  po.receivedAt || po.createdAt,
    sellerName:   po.vendor.name,
    sellerTaxCode: po.vendor.taxCode || "",
    sellerAddress: po.vendor.address || "",
    totalBeforeTax: round0(toNum(po.subtotal)),
    taxAmount: round0(toNum(po.taxAmount)),
    total: round0(toNum(po.total)),
  }));
};

/**
 * Báo cáo thuế TNCN tháng (từ Payroll)
 */
const generatePIT = async (year, month) => {
  const payrolls = await prisma.payroll.findMany({
    where: { year, month },
    include: { employee: { include: { user: { select: { fullName: true } } } } },
  });

  const rows = payrolls.map((p) => ({
    employeeId: p.employeeId,
    employeeName: p.employee.user.fullName,
    socialInsuranceCode: p.employee.socialInsuranceCode || "",
    grossSalary: round0(toNum(p.finalSalary)),
    bhxhEmployee: round0(toNum(p.bhxhEmployee)),
    pitAmount: round0(toNum(p.pitAmount)),
    dependents: p.employee.dependents || 0,
  }));

  const totals = rows.reduce(
    (s, r) => ({
      grossSalary: s.grossSalary + r.grossSalary,
      bhxhEmployee: s.bhxhEmployee + r.bhxhEmployee,
      pitAmount: s.pitAmount + r.pitAmount,
    }),
    { grossSalary: 0, bhxhEmployee: 0, pitAmount: 0 },
  );

  return { period: { year, month }, rows, totals };
};

// ======== Excel Export ========

const headerStyle = {
  font: { bold: true, color: { argb: "FFFFFFFF" } },
  fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E79" } },
  alignment: { horizontal: "center", vertical: "middle" },
  border: {
    top: { style: "thin" }, bottom: { style: "thin" },
    left: { style: "thin" }, right: { style: "thin" },
  },
};

const cellBorder = {
  border: {
    top: { style: "thin", color: { argb: "FFD0D7E0" } },
    bottom: { style: "thin", color: { argb: "FFD0D7E0" } },
    left: { style: "thin", color: { argb: "FFD0D7E0" } },
    right: { style: "thin", color: { argb: "FFD0D7E0" } },
  },
};

/**
 * Xuất Excel: 01/GTGT + 01-1 + 01-2 + PIT
 */
const exportExcel = async (year, month) => {
  const [vat, sales, purchases, pit] = await Promise.all([
    generateVAT(year, month),
    generateSalesList(year, month),
    generatePurchaseList(year, month),
    generatePIT(year, month),
  ]);

  const wb = new ExcelJS.Workbook();
  wb.creator = "Aduu ERP";
  wb.created = new Date();

  // Sheet 1: 01/GTGT
  {
    const ws = wb.addWorksheet("01-GTGT");
    ws.mergeCells("A1:D1");
    const title = ws.getCell("A1");
    title.value = `TỜ KHAI THUẾ GTGT THÁNG ${month}/${year} (01/GTGT)`;
    title.font = { bold: true, size: 14 };
    title.alignment = { horizontal: "center" };

    const rows = [
      ["Chỉ tiêu", "Mã số", "Số tiền (VND)", ""],
      ["I. Thuế GTGT còn được khấu trừ kỳ trước", "[21]", "0", ""],
      ["II. Thuế GTGT phát sinh trong kỳ", "", "", ""],
      ["1. Hàng hóa, dịch vụ mua vào", "", "", ""],
      ["   - Giá trị hàng hóa, dịch vụ mua vào", "[22]", purchases.reduce((s, r) => s + r.totalBeforeTax, 0), ""],
      ["   - Thuế GTGT của hàng hóa, dịch vụ mua vào", "[23]", vat.vatInput, ""],
      ["2. Hàng hóa, dịch vụ bán ra", "", "", ""],
      ["   - Tổng doanh thu", "[29]", sales.reduce((s, r) => s + r.totalBeforeTax, 0), ""],
      ["   - Thuế GTGT của hàng bán ra (10%)", "[32]", vat.vatOutput, ""],
      ["III. Thuế GTGT phải nộp (=[32]-[23])", "[40]", vat.vatPayable, ""],
      ["   Hoặc thuế GTGT được hoàn", "[41]", vat.vatRefundable, ""],
    ];

    rows.forEach((row, i) => {
      const r = ws.addRow(row);
      if (i === 0) {
        r.eachCell((c) => Object.assign(c, headerStyle));
      } else {
        r.eachCell((c) => Object.assign(c, cellBorder));
        if (row[0].startsWith("III")) {
          r.font = { bold: true };
        }
      }
    });

    ws.getColumn(1).width = 50;
    ws.getColumn(2).width = 10;
    ws.getColumn(3).width = 20;
    ws.getColumn(3).numFmt = "#,##0";
  }

  // Sheet 2: 01-1/GTGT - Bảng kê bán ra
  {
    const ws = wb.addWorksheet("01-1 Bán ra");
    ws.mergeCells("A1:I1");
    ws.getCell("A1").value = `BẢNG KÊ HÓA ĐƠN HÀNG HÓA, DỊCH VỤ BÁN RA THÁNG ${month}/${year}`;
    ws.getCell("A1").font = { bold: true, size: 12 };

    const headers = ["STT", "Ký hiệu HĐ", "Số HĐ", "Ngày HĐ", "Tên người mua", "MST người mua", "Doanh số chưa thuế", "Thuế suất", "Thuế GTGT"];
    const hr = ws.addRow(headers);
    hr.eachCell((c) => Object.assign(c, headerStyle));

    sales.forEach((s, i) => {
      const r = ws.addRow([
        i + 1, s.serial, s.invoiceNo,
        s.invoiceDate ? new Date(s.invoiceDate).toLocaleDateString("vi-VN") : "",
        s.buyerName, s.buyerTaxCode,
        s.totalBeforeTax, `${s.taxRate}%`, s.taxAmount,
      ]);
      r.eachCell((c) => Object.assign(c, cellBorder));
    });

    // Totals row
    if (sales.length) {
      const tot = ws.addRow(["", "", "", "", "TỔNG CỘNG", "",
        sales.reduce((s, r) => s + r.totalBeforeTax, 0), "",
        sales.reduce((s, r) => s + r.taxAmount, 0)]);
      tot.font = { bold: true };
    }

    [40, 15, 15, 15, 30, 20, 20, 10, 20].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
    ws.getColumn(7).numFmt = "#,##0";
    ws.getColumn(9).numFmt = "#,##0";
  }

  // Sheet 3: 01-2/GTGT - Bảng kê mua vào
  {
    const ws = wb.addWorksheet("01-2 Mua vào");
    ws.mergeCells("A1:I1");
    ws.getCell("A1").value = `BẢNG KÊ HÓA ĐƠN HÀNG HÓA, DỊCH VỤ MUA VÀO THÁNG ${month}/${year}`;
    ws.getCell("A1").font = { bold: true, size: 12 };

    const headers = ["STT", "Số PO", "Số HĐ", "Ngày HĐ", "Tên người bán", "MST người bán", "Giá trị chưa thuế", "Thuế suất", "Thuế GTGT"];
    const hr = ws.addRow(headers);
    hr.eachCell((c) => Object.assign(c, headerStyle));

    purchases.forEach((p, i) => {
      const r = ws.addRow([
        i + 1, p.poCode, p.invoiceNo,
        p.invoiceDate ? new Date(p.invoiceDate).toLocaleDateString("vi-VN") : "",
        p.sellerName, p.sellerTaxCode,
        p.totalBeforeTax, "10%", p.taxAmount,
      ]);
      r.eachCell((c) => Object.assign(c, cellBorder));
    });

    if (purchases.length) {
      const tot = ws.addRow(["", "", "", "", "TỔNG CỘNG", "",
        purchases.reduce((s, r) => s + r.totalBeforeTax, 0), "",
        purchases.reduce((s, r) => s + r.taxAmount, 0)]);
      tot.font = { bold: true };
    }

    ws.getColumn(7).numFmt = "#,##0";
    ws.getColumn(9).numFmt = "#,##0";
    [15, 15, 15, 15, 30, 20, 20, 10, 20].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  }

  // Sheet 4: TNCN
  {
    const ws = wb.addWorksheet("TNCN");
    ws.mergeCells("A1:G1");
    ws.getCell("A1").value = `TỜ KHAI THUẾ TNCN THÁNG ${month}/${year} (05/KK-TNCN)`;
    ws.getCell("A1").font = { bold: true, size: 12 };

    const headers = ["STT", "Họ tên NV", "Mã số BHXH", "Số người phụ thuộc", "Lương gross", "BHXH NV đóng", "Thuế TNCN"];
    const hr = ws.addRow(headers);
    hr.eachCell((c) => Object.assign(c, headerStyle));

    pit.rows.forEach((p, i) => {
      const r = ws.addRow([i + 1, p.employeeName, p.socialInsuranceCode, p.dependents, p.grossSalary, p.bhxhEmployee, p.pitAmount]);
      r.eachCell((c) => Object.assign(c, cellBorder));
    });

    const tot = ws.addRow(["", "TỔNG CỘNG", "", "", pit.totals.grossSalary, pit.totals.bhxhEmployee, pit.totals.pitAmount]);
    tot.font = { bold: true };

    [5, 25, 15, 10, 20, 20, 20].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
    [5, 6, 7].forEach((c) => { ws.getColumn(c).numFmt = "#,##0"; });
  }

  return wb;
};

/**
 * Xuất XML 01/GTGT đúng schema HTKK.
 */
const exportXML = async (year, month, companyInfo = {}) => {
  const vat = await generateVAT(year, month);
  const from = new Date(year, month - 1, 1).toISOString().slice(0, 10);
  const to   = new Date(year, month, 0).toISOString().slice(0, 10);

  const e = (tag, val) => `<${tag}>${String(val || "").replace(/&/g, "&amp;").replace(/</g, "&lt;")}</${tag}>`;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<To_Khai_Dien_Tu xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <TTChung>
    ${e("MA_CQT", companyInfo.taxOfficerCode || "")}
    ${e("NNT_MST", companyInfo.taxCode || "")}
    ${e("NNT_Ten", companyInfo.name || "")}
    ${e("NNT_DChi", companyInfo.address || "")}
    ${e("NNT_DienThoai", companyInfo.phone || "")}
    ${e("NNT_Fax", "")}
    ${e("NNT_Email", companyInfo.email || "")}
    ${e("Ky_KK_Tu", from)}
    ${e("Ky_KK_Den", to)}
    ${e("LTTP", "CK")}
    ${e("Lan_Dau", "1")}
    ${e("Bo_Sung_Lan", "0")}
    ${e("ChuKyHieuLuc", "N")}
  </TTChung>
  <ChiTiet>
    <TKKHAU_GTGT>
      ${e("C21", 0)}
      ${e("C22", 0)}
      ${e("C23", vat.vatInput)}
      ${e("C24", 0)}
      ${e("C25", 0)}
      ${e("C26", 0)}
      ${e("C27", 0)}
      ${e("C28", 0)}
      ${e("C29", 0)}
      ${e("C30", 0)}
      ${e("C31", 0)}
      ${e("C32", vat.vatOutput)}
      ${e("C33", 0)}
      ${e("C40", vat.vatPayable)}
      ${e("C41", vat.vatRefundable)}
      ${e("C42", 0)}
      ${e("C43", 0)}
    </TKKHAU_GTGT>
  </ChiTiet>
</To_Khai_Dien_Tu>`;

  return xml;
};

/**
 * Xuất file BHXH D02-LT dạng Excel.
 */
const exportBHXH = async (year, month) => {
  const payrolls = await prisma.payroll.findMany({
    where: { year, month },
    include: { employee: { include: { user: { select: { fullName: true } } } } },
    orderBy: { createdAt: "asc" },
  });

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("D02-LT");

  ws.mergeCells("A1:J1");
  ws.getCell("A1").value = `DANH SÁCH LAO ĐỘNG THAM GIA BHXH, BHYT, BHTN - THÁNG ${month}/${year} (D02-LT)`;
  ws.getCell("A1").font = { bold: true, size: 12 };

  const headers = [
    "STT", "Họ tên", "Mã BHXH", "Mức lương đóng BHXH",
    "BHXH NV (8%)", "BHYT NV (1.5%)", "BHTN NV (1%)",
    "Tổng NV đóng (10.5%)", "BHXH DN (17%)", "Tổng DN đóng (21.5%)",
  ];
  const hr = ws.addRow(headers);
  hr.eachCell((c) => Object.assign(c, headerStyle));

  const BHXH_CAP = 46_800_000; // mức lương tối đa đóng BHXH 2024

  payrolls.forEach((p, i) => {
    const gross = toNum(p.finalSalary);
    const bhxhBase = Math.min(gross, BHXH_CAP);
    const bhxhNV = round0(bhxhBase * 0.08);
    const bhytNV = round0(bhxhBase * 0.015);
    const bhtnNV = round0(bhxhBase * 0.01);
    const totalNV = bhxhNV + bhytNV + bhtnNV;
    const bhxhDN = round0(bhxhBase * 0.17);
    const totalDN = round0(bhxhBase * 0.215);

    const r = ws.addRow([
      i + 1,
      p.employee.user.fullName,
      p.employee.socialInsuranceCode || "",
      bhxhBase,
      bhxhNV, bhytNV, bhtnNV, totalNV,
      bhxhDN, totalDN,
    ]);
    r.eachCell((c) => Object.assign(c, cellBorder));
  });

  [5, 25, 15, 20, 18, 18, 18, 20, 18, 20].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  [4, 5, 6, 7, 8, 9, 10].forEach((c) => { ws.getColumn(c).numFmt = "#,##0"; });

  return wb;
};

module.exports = {
  generateVAT,
  generateSalesList,
  generatePurchaseList,
  generatePIT,
  exportExcel,
  exportXML,
  exportBHXH,
};
