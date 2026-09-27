/**
 * tests/vendor-scorecard.test.js — Vendor Scorecard / OTIF (Mục 6.4)
 */
const mockClient = {
  vendor: { findMany: jest.fn(), update: jest.fn() },
  purchaseOrder: { findMany: jest.fn() },
  goodsReceiptNote: { findMany: jest.fn() },
};

jest.mock("../src/config/prisma", () => mockClient);
jest.mock("../src/modules/notifications/notification.service", () => ({
  createOne: jest.fn().mockResolvedValue({}),
}));

const job = require("../src/jobs/vendor-scorecard.job");
const notificationService = require("../src/modules/notifications/notification.service");

describe("vendor-scorecard.job (Mục 6.4)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockClient.vendor.update.mockResolvedValue({});
    mockClient.goodsReceiptNote.findMany.mockResolvedValue([]);
  });

  describe("computeScorecard", () => {
    test("NCC hoàn hảo (OTIF 100%, defect 0%) → điểm 100, hạng A", () => {
      const r = job.computeScorecard({ poCount: 10, onTimeFullCount: 10, rejectQty: 0, receivedQty: 100 });
      expect(r.otifScore).toBe(100);
      expect(r.defectRate).toBe(0);
      expect(r.vendorGrade).toBe("A");
    });

    test("hạng A/B là khả đạt (sửa lỗi: max cũ chỉ 60)", () => {
      const a = job.computeScorecard({ poCount: 10, onTimeFullCount: 10, rejectQty: 0, receivedQty: 100 });
      const b = job.computeScorecard({ poCount: 10, onTimeFullCount: 8, rejectQty: 5, receivedQty: 100 });
      const c = job.computeScorecard({ poCount: 10, onTimeFullCount: 5, rejectQty: 10, receivedQty: 100 });
      expect(a.vendorGrade).toBe("A");
      expect(b.vendorGrade).toBe("B");
      expect(c.vendorGrade).toBe("C");
    });

    test("ngưỡng hạng: >=90 → A, 75-89 → B, <75 → C", () => {
      expect(job.gradeOf(90)).toBe("A");
      expect(job.gradeOf(89.9)).toBe("B");
      expect(job.gradeOf(75)).toBe("B");
      expect(job.gradeOf(74.9)).toBe("C");
    });

    test("OTIF = tỷ lệ PO đúng hạn + đủ hàng", () => {
      const r = job.computeScorecard({ poCount: 3, onTimeFullCount: 1, rejectQty: 1, receivedQty: 3 });
      expect(r.otifScore).toBe(33.3);
      expect(r.defectRate).toBe(33.3);
    });

    test("không có PO trong kỳ → OTIF 0", () => {
      const r = job.computeScorecard({ poCount: 0, onTimeFullCount: 0, rejectQty: 0, receivedQty: 0 });
      expect(r.otifScore).toBe(0);
      expect(r.defectRate).toBe(0);
    });

    test("có priceVarianceScore → dùng công thức 3 thành phần (0.6/0.3/0.1)", () => {
      const r = job.computeScorecard({ poCount: 10, onTimeFullCount: 10, rejectQty: 0, receivedQty: 100, priceVarianceScore: 100 });
      expect(r.vendorGrade).toBe("A");
    });

    test("defectRate 100% → điểm chất lượng 0", () => {
      const perfect = job.computeScorecard({ poCount: 1, onTimeFullCount: 1, rejectQty: 0, receivedQty: 10 });
      const allBad = job.computeScorecard({ poCount: 1, onTimeFullCount: 1, rejectQty: 10, receivedQty: 10 });
      expect(allBad.defectRate).toBe(100);
      expect(allBad.vendorGrade).toBe("C");
      expect(perfect.vendorGrade).toBe("A");
    });
  });

  describe("runForTenant", () => {
    test("PO giao trễ (GRN onTime=false) → không tính là OTIF", async () => {
      mockClient.vendor.findMany.mockResolvedValue([{ id: "v1", name: "NCC A" }]);
      mockClient.purchaseOrder.findMany.mockResolvedValue([
        { id: "po1", items: [{ id: "pi1", quantity: 10 }] },
        { id: "po2", items: [{ id: "pi2", quantity: 10 }] },
      ]);
      mockClient.goodsReceiptNote.findMany.mockResolvedValue([
        { id: "g1", onTime: true, purchaseOrderId: "po1", items: [{ receivedQty: 10, passQty: 10, rejectQty: 0, purchaseItemId: "pi1" }] },
        { id: "g2", onTime: false, purchaseOrderId: "po2", items: [{ receivedQty: 10, passQty: 10, rejectQty: 0, purchaseItemId: "pi2" }] },
      ]);
      const res = await job.runForTenant({ year: 2026, month: 8 });
      expect(res).toHaveLength(1);
      expect(res[0].otifScore).toBe(50);
      expect(res[0].defectRate).toBe(0);
      expect(mockClient.vendor.update).toHaveBeenCalledWith({ where: { id: "v1" }, data: expect.objectContaining({ otifScore: 50 }) });
    });

    test("PO thiếu số lượng (passQty < quantity) → không tính là OTIF", async () => {
      mockClient.vendor.findMany.mockResolvedValue([{ id: "v1", name: "NCC A" }]);
      mockClient.purchaseOrder.findMany.mockResolvedValue([{ id: "po1", items: [{ id: "pi1", quantity: 10 }] }]);
      mockClient.goodsReceiptNote.findMany.mockResolvedValue([
        { id: "g1", onTime: true, purchaseOrderId: "po1", items: [{ receivedQty: 8, passQty: 8, rejectQty: 0, purchaseItemId: "pi1" }] },
      ]);
      const res = await job.runForTenant({ year: 2026, month: 8 });
      expect(res[0].otifScore).toBe(0);
    });

    test("tính đúng DefectRate từ rejectQty/receivedQty", async () => {
      mockClient.vendor.findMany.mockResolvedValue([{ id: "v1", name: "NCC A" }]);
      mockClient.purchaseOrder.findMany.mockResolvedValue([{ id: "po1", items: [{ id: "pi1", quantity: 100 }] }]);
      mockClient.goodsReceiptNote.findMany.mockResolvedValue([
        { id: "g1", onTime: true, purchaseOrderId: "po1", items: [{ receivedQty: 100, passQty: 90, rejectQty: 10, purchaseItemId: "pi1" }] },
      ]);
      const res = await job.runForTenant({ year: 2026, month: 8 });
      expect(res[0].defectRate).toBe(10);
      expect(res[0].otifScore).toBe(0);
    });

    test("NCC hạng C → tạo Notification cảnh báo cho ADMIN", async () => {
      mockClient.vendor.findMany.mockResolvedValue([{ id: "v1", name: "NCC Xấu" }]);
      mockClient.purchaseOrder.findMany.mockResolvedValue([{ id: "po1", items: [{ id: "pi1", quantity: 10 }] }]);
      mockClient.goodsReceiptNote.findMany.mockResolvedValue([]);
      await job.runForTenant({ year: 2026, month: 8 });
      expect(notificationService.createOne).toHaveBeenCalledTimes(1);
      expect(notificationService.createOne).toHaveBeenCalledWith(expect.objectContaining({ roleScope: "ADMIN", severity: "WARNING" }));
    });

    test("NCC hạng A → KHÔNG bắn cảnh báo", async () => {
      mockClient.vendor.findMany.mockResolvedValue([{ id: "v1", name: "NCC Tốt" }]);
      mockClient.purchaseOrder.findMany.mockResolvedValue([{ id: "po1", items: [{ id: "pi1", quantity: 10 }] }]);
      mockClient.goodsReceiptNote.findMany.mockResolvedValue([
        { id: "g1", onTime: true, purchaseOrderId: "po1", items: [{ receivedQty: 10, passQty: 10, rejectQty: 0, purchaseItemId: "pi1" }] },
      ]);
      await job.runForTenant({ year: 2026, month: 8 });
      expect(notificationService.createOne).not.toHaveBeenCalled();
    });

    test("vendor không có PO trong kỳ → bỏ qua", async () => {
      mockClient.vendor.findMany.mockResolvedValue([{ id: "v1", name: "NCC A" }]);
      mockClient.purchaseOrder.findMany.mockResolvedValue([]);
      const res = await job.runForTenant({ year: 2026, month: 8 });
      expect(res).toEqual([]);
      expect(mockClient.vendor.update).not.toHaveBeenCalled();
      expect(notificationService.createOne).not.toHaveBeenCalled();
    });

    test("không truyền kỳ → tự lấy tháng trước", async () => {
      mockClient.vendor.findMany.mockResolvedValue([]);
      const res = await job.runForTenant();
      expect(res).toEqual([]);
      expect(mockClient.vendor.findMany).toHaveBeenCalled();
    });
  });
});
