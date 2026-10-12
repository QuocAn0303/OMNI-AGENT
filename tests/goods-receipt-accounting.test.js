/**
 * tests/goods-receipt-accounting.test.js
 *
 * KHOÁ HÀNH VI: GRN POSTED phải ĐÓNG VÒNG MUA HÀNG — cộng tồn kho, ghi bút toán
 * (Nợ 156 / Có 331) và tạo công nợ phải trả.
 *
 * BỐI CẢNH (đo 2026-10-12 trên DB phát triển): 39 PO của tenant demo nhập kho qua
 * GRN mà KHÔNG có bút toán nào. Sổ cái vẫn "cân bằng" (Nợ = Có) vì không ghi gì cả,
 * nhưng TK 156 thiếu hết tài sản của hàng đã nhập. Đây là lệch dữ liệu, không phải
 * thiếu tính năng — nên phải có test khoá lại.
 *
 * Các test ở đây là UNIT (mock Prisma). `tests/../scripts/check-accounting-integrity.js`
 * và `smoke:po-gate` mới là kiểm chứng trên DB thật — theo quy tắc ở
 * `docs/aisc26/STATE.md`: unit test mock KHÔNG được coi là bằng chứng hoàn tất.
 */

jest.mock("../src/config/prisma", () => ({
  goodsReceiptNote: { findUnique: jest.fn(), findMany: jest.fn(async () => []) },
  goodsReceiptItem: { aggregate: jest.fn(async () => ({ _sum: { receivedQty: 0, passQty: 0 } })) },
  purchaseOrder: { findUnique: jest.fn() },
  debt: { findFirst: jest.fn() },
  $transaction: jest.fn(),
  $disconnect: jest.fn(),
}));

jest.mock("../src/modules/accounting/journal.service", () => ({
  withCodeRetry: jest.fn(async (fn) => fn()),
}));

jest.mock("../src/utils/warehouse.helper", () => ({
  getDefaultWarehouseId: jest.fn(async () => "wh-1"),
  findInventory: jest.fn(),
}));

jest.mock("../src/modules/accounting/autopost.service", () => ({
  buildGoodsReceiptEntry: jest.fn(),
  // `grn.service.post` gọi `postBuiltEntry` (payload đã dựng sẵn), không gọi
  // `postGoodsReceipt` — xem chú thích tại chỗ gọi trong service.
  postBuiltEntry: jest.fn(async () => ({ id: "je-1", entryCode: "JE-1", totalDebit: 0 })),
  postGoodsReceipt: jest.fn(async () => ({ id: "je-1" })),
}));

jest.mock("../src/modules/debt/debt.service", () => ({
  createPayableForPoInTx: jest.fn(),
}));

jest.mock("../src/modules/accounting/posting-error.service", () => ({
  // `tryPostOrQueue` THẬT SỰ nuốt lỗi rồi ghi outbox — mock phải giữ đúng bản chất
  // đó, nếu không test "lỗi hạch không làm mất kho" sẽ pass vì sai lý do.
  tryPostOrQueue: jest.fn(async (fn, meta) => {
    try {
      return await fn();
    } catch {
      return null;
    }
  }),
}));

jest.mock("../src/modules/audit/audit.service", () => ({ log: jest.fn(async () => {}) }));

const prisma = require("../src/config/prisma");
const autopost = require("../src/modules/accounting/autopost.service");
const debtService = require("../src/modules/debt/debt.service");
const postingError = require("../src/modules/accounting/posting-error.service");
const { findInventory } = require("../src/utils/warehouse.helper");
const grnService = require("../src/modules/accounting/grn.service");

/** GRN 2 dòng, mỗi dòng đặt 100. Dòng 1 đạt 60, dòng 2 đạt 100 (tổng 160/200). */
const makeGrn = (overrides = {}) => ({
  id: "grn-1",
  grnCode: "GRN-20261012-0001",
  status: "QC_DONE",
  receivedAt: new Date("2026-10-12T00:00:00Z"),
  warehouseId: "wh-1",
  purchaseOrderId: "po-1",
  items: [
    {
      productId: "p1",
      passQty: 60,
      rejectQty: 0,
      lotCode: null,
      expiryDate: null,
      product: { id: "p1", sku: "SKU-1", costPrice: 10 },
      purchaseItem: { id: "pi1", quantity: 100, unitCost: 10, taxAmount: 0 },
    },
    {
      productId: "p2",
      passQty: 100,
      rejectQty: 0,
      lotCode: null,
      expiryDate: null,
      product: { id: "p2", sku: "SKU-2", costPrice: 20 },
      purchaseItem: { id: "pi2", quantity: 100, unitCost: 20, taxAmount: 1000 },
    },
  ],
  purchaseOrder: {
    id: "po-1",
    poCode: "PO-20261012-0001",
    status: "APPROVED",
    expectedAt: null,
    total: 4000,
    subtotal: 3000,
    taxAmount: 1000,
    paidAmount: 0,
    paymentStatus: "UNPAID",
    vendorId: "v1",
    vendor: { id: "v1", name: "NCC A" },
    items: [{ id: "pi1", quantity: 100 }, { id: "pi2", quantity: 100 }],
  },
  ...overrides,
});

/** Transaction client giả: ghi lại các lệnh để assert. */
const makeTx = () => ({
  inventory: { create: jest.fn(), update: jest.fn(async () => ({})) },
  product: { update: jest.fn(async () => ({})) },
  inventoryTransaction: { create: jest.fn(async () => ({})) },
  inventoryLot: { findFirst: jest.fn(async () => null), create: jest.fn(async () => ({})) },
  goodsReceiptNote: {
    update: jest.fn(async () => ({ id: "grn-1", status: "POSTED" })),
    findMany: jest.fn(async () => []),
  },
  goodsReceiptItem: { aggregate: jest.fn(async () => ({ _sum: { receivedQty: 60 } })) },
  purchaseOrder: { update: jest.fn(async () => ({})) },
  debt: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  vendor: { update: jest.fn() },
});

beforeEach(() => {
  jest.clearAllMocks();
  findInventory.mockImplementation(async (tx, productId) =>
    productId === "p1"
      ? { id: "inv-1", quantity: 40, productId, warehouseId: "wh-1" }
      : { id: "inv-2", quantity: 5, productId, warehouseId: "wh-1" },
  );
  // Builder thật (tính trên passQty) nhưng trả về payload đơn giản để assert.
  autopost.buildGoodsReceiptEntry.mockImplementation(({ grn, purchaseOrder }) => ({
    sourceId: purchaseOrder.id,
    operation: `GRN:${grn.id}`,
    goodsReceiptValue: 2600,
  }));
  // `clearAllMocks` xoá cả implementation ⇒ mỗi test bắt đầu ở trạng thái hạch
  // thành công. Test nào muốn hạch lỗi thì tự dựng lại.
  autopost.postGoodsReceipt.mockImplementation(async () => ({ id: "je-1" }));
  autopost.postBuiltEntry.mockImplementation(async () => ({
    entryCode: "JE-20261012-0001",
    totalDebit: 2600,
  }));
  // Đọc lại PO + công nợ ở phần TỔNG KẾT vòng đã đóng.
  prisma.purchaseOrder.findUnique.mockResolvedValue({
    id: "po-1",
    poCode: "PO-1",
    status: "APPROVED",
    expectedAt: null,
  });
  prisma.debt.findFirst.mockResolvedValue(null);
  prisma.goodsReceiptItem.aggregate.mockResolvedValue({ _sum: { receivedQty: 0, passQty: 0 } });
});

describe("GRN POSTED đóng vòng mua hàng (bút toán + công nợ)", () => {
  test("ghi bút toán SAU transaction, không để lỗi kế toán rollback phần kho", async () => {
    const order = [];
    const tx = makeTx();
    prisma.goodsReceiptNote.findUnique.mockResolvedValue(makeGrn());
    prisma.$transaction.mockImplementation(async (fn) => {
      order.push("tx");
      return fn(tx);
    });
    postingError.tryPostOrQueue.mockImplementation(async (fn) => {
      order.push("post");
      try {
        return await fn();
      } catch {
        return null;
      }
    });

    await grnService.post("grn-1", "u1");

    // Kho đã nhập (trong tx) TRƯỚC, bút toán SAU. Đảo thứ tự sẽ mất hàng khi lỗi hạch.
    expect(order).toEqual(["tx", "post"]);
  });

  test("công nợ theo TỔNG giá trị đã nhận TÍCH LUỸ, không phải tổng PO", async () => {
    const tx = makeTx();
    // Sau khi GRN này POSTED, hệ thống đọc lại TẤT CẢ GRN POSTED của PO để lấy
    // tổng tích luỹ (mô phỏng 2.600.000đ đã nhập trước + 600.000đ lần này).
    tx.goodsReceiptNote.findMany = jest.fn(async () => [
      {
        items: [
          { passQty: 60, purchaseItem: { quantity: 100, unitCost: 10000, taxAmount: 0 } },
          { passQty: 100, purchaseItem: { quantity: 100, unitCost: 20000, taxAmount: 1000 } },
          { passQty: 30, purchaseItem: { quantity: 100, unitCost: 20000, taxAmount: 1000 } },
        ],
      },
    ]);
    prisma.goodsReceiptNote.findUnique.mockResolvedValue(makeGrn());
    prisma.$transaction.mockImplementation((fn) => fn(tx));

    await grnService.post("grn-1", "u1");

    expect(debtService.createPayableForPoInTx).toHaveBeenCalledTimes(1);
    const call = debtService.createPayableForPoInTx.mock.calls[0];
    // 60*10.000 + 130*20.000 = 3.200.000; VAT theo tỷ lệ nhận/đặt:
    //   dòng 100/100 → 1.000; dòng 30/100 → 300  ⇒  tổng 3.201.300
    expect(call[1].amount).toBe(3_201_300);
    expect(call[1].po.id).toBe("po-1");
  });

  test("không ghi bút toán khi GRN không còn dòng hàng đạt (QC loại hết)", async () => {
    const tx = makeTx();
    const grn = makeGrn();
    grn.items = grn.items.map((i) => ({ ...i, passQty: 0 }));
    prisma.goodsReceiptNote.findUnique.mockResolvedValue(grn);
    prisma.$transaction.mockImplementation((fn) => fn(tx));
    autopost.buildGoodsReceiptEntry.mockReturnValue(null);

    await grnService.post("grn-1", "u1");

    expect(debtService.createPayableForPoInTx).not.toHaveBeenCalled();
    expect(postingError.tryPostOrQueue).not.toHaveBeenCalled();
  });

  test("lỗi hạch kế toán KHÔNG làm mất phần kho đã nhập", async () => {
    const tx = makeTx();
    prisma.goodsReceiptNote.findUnique.mockResolvedValue(makeGrn());
    prisma.$transaction.mockImplementation((fn) => fn(tx));
    autopost.postGoodsReceipt.mockRejectedValue(new Error("kỳ kế toán đã đóng"));

    // `tryPostOrQueue` nuốt lỗi và ghi outbox — `post` không được ném lại.
    await expect(grnService.post("grn-1", "u1")).resolves.toBeTruthy();
    // Tồn kho vẫn đã cộng trong transaction.
    expect(tx.inventory.update).toHaveBeenCalledTimes(2);
    expect(tx.goodsReceiptNote.update).toHaveBeenCalled();
  });

  test("PO nhận đủ mới chuyển RECEIVED; nhận thiếu thì giữ nguyên (backorder)", async () => {
    // Trong transaction `aggregate` đọc trên `tx`; ở phần TỔNG KẾT lại đọc trên
    // `client` (mặc định `prisma`). Vì vậy mock CẢ HAI để dữ liệu khớp.
    // aggregate trả 160/200 ⇒ chưa đủ ⇒ KHÔNG chuyển RECEIVED.
    const txPartial = makeTx();
    const agg160 = { _sum: { receivedQty: 160, passQty: 160 } };
    txPartial.goodsReceiptItem.aggregate.mockResolvedValue(agg160);
    prisma.goodsReceiptItem.aggregate.mockResolvedValue(agg160);
    prisma.goodsReceiptNote.findUnique.mockResolvedValue(makeGrn());
    prisma.$transaction.mockImplementation((fn) => fn(txPartial));

    const outPartial = await grnService.post("grn-1", "u1");
    expect(txPartial.purchaseOrder.update).not.toHaveBeenCalled();
    expect(outPartial.fullyReceived).toBe(false);
    expect(outPartial.remainingQty).toBe(40);

    // aggregate trả 200/200 ⇒ đủ ⇒ chuyển RECEIVED.
    const txFull = makeTx();
    const agg200 = { _sum: { receivedQty: 200, passQty: 200 } };
    txFull.goodsReceiptItem.aggregate.mockResolvedValue(agg200);
    prisma.goodsReceiptItem.aggregate.mockResolvedValue(agg200);
    prisma.$transaction.mockImplementation((fn) => fn(txFull));

    await grnService.post("grn-1", "u1");
    expect(txFull.purchaseOrder.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "po-1" }, data: expect.objectContaining({ status: "RECEIVED" }) }),
    );
  });

  test("trả về TỔNG KẾT vòng đã đóng để UI hiện được hệ quả", async () => {
    const tx = makeTx();
    const agg = { _sum: { receivedQty: 160, passQty: 160 } };
    tx.goodsReceiptItem.aggregate.mockResolvedValue(agg);
    prisma.goodsReceiptItem.aggregate.mockResolvedValue(agg);
    prisma.goodsReceiptNote.findUnique.mockResolvedValue(makeGrn());
    prisma.$transaction.mockImplementation((fn) => fn(tx));
    prisma.purchaseOrder.findUnique.mockResolvedValue({ id: "po-1", poCode: "PO-1", status: "APPROVED", expectedAt: null });
    prisma.debt.findFirst.mockResolvedValue({ id: "d1", amount: 2600, paidAmount: 0, dueDate: new Date() });
    autopost.postBuiltEntry.mockResolvedValue({ entryCode: "JE-20261012-0001", totalDebit: 2600 });

    const out = await grnService.post("grn-1", "u1");

    expect(out.acceptedQty).toBe(160);            // hàng ĐẠT của riêng lần này
    expect(out.receivedValue).toBe(2600);
    expect(out.orderedQty).toBe(200);
    expect(out.receivedQty).toBe(160);
    expect(out.fullyReceived).toBe(false);
    expect(out.remainingQty).toBe(40);            // backorder còn thiếu
    expect(out.journalEntry.entryCode).toBe("JE-20261012-0001");
    expect(out.payable.amount).toBe(2600);
  });

test("báo TRUNG THỰC khi bút toán lỗi: journalEntry = null, không báo thành công giả", async () => {
    const tx = makeTx();
    tx.goodsReceiptItem.aggregate.mockResolvedValue({ _sum: { receivedQty: 160, passQty: 160 } });
    prisma.goodsReceiptNote.findUnique.mockResolvedValue(makeGrn());
    prisma.$transaction.mockImplementation((fn) => fn(tx));
    autopost.postBuiltEntry.mockRejectedValue(new Error("kỳ kế toán đã đóng"));

    const out = await grnService.post("grn-1", "u1");

    // Kho vẫn nhập (đúng), nhưng phải nói rõ sổ cái CHƯA ghi.
    expect(out.status).toBe("POSTED");
    expect(out.journalEntry).toBeNull();
  });
});