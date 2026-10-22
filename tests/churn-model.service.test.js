/**
 * tests/churn-model.service.test.js — Mô hình churn (AN.4)
 *
 * Ghim 4 hành vi dễ hỏng nhất:
 *   1. `mapToSystemScale` — dưới ngưỡng mô hình phải trả 0 (KHÔNG nâng cảnh báo),
 *      trên ngưỡng trả [0.70, 0.85] để kích hoạt automation.
 *   2. `combine` — lấy giá trị cao hơn giữa công thức và mô hình.
 *   3. `scoreCustomer` — khách có < 2 đơn thì trả null (không suy đoán), khách đủ
 *      lịch sử thì trả xác suất trong (0,1) kèm engine.
 *   4. Thiếu file mô hình → `isAvailable()` false, KHÔNG ném lỗi (hệ thống phải
 *      chạy tiếp được bằng công thức).
 */
const fs = require("fs");
const path = require("path");

jest.mock("../src/config/prisma", () => ({
  customer: { findUnique: jest.fn(), update: jest.fn() },
  order: { findMany: jest.fn() },
  $disconnect: jest.fn(),
}));

const MODEL_PATH = path.join(__dirname, "..", "data", "dataset", "churn", "churn-logreg.json");
const churnModel = require("../src/modules/customers/churn-model.service");
const { SYSTEM_CHURN_THRESHOLD } = churnModel;

describe("churn-model.service", () => {
  describe("mapToSystemScale", () => {
    const T = 0.207;

    test("dưới ngưỡng mô hình → 0 (không nâng cảnh báo)", () => {
      expect(churnModel.mapToSystemScale(0.0, T)).toBe(0);
      expect(churnModel.mapToSystemScale(0.1, T)).toBe(0);
      expect(churnModel.mapToSystemScale(0.206, T)).toBe(0);
    });

    test("bằng ngưỡng → đúng ngưỡng hành động của hệ thống", () => {
      expect(churnModel.mapToSystemScale(T, T)).toBeCloseTo(SYSTEM_CHURN_THRESHOLD, 4);
    });

    test("trên ngưỡng → nằm trong [0.70, 0.85] và tăng dần", () => {
      const a = churnModel.mapToSystemScale(0.4, T);
      const b = churnModel.mapToSystemScale(0.9, T);
      expect(a).toBeGreaterThanOrEqual(SYSTEM_CHURN_THRESHOLD);
      expect(a).toBeLessThanOrEqual(0.85);
      expect(b).toBeGreaterThan(a);
      expect(b).toBeLessThanOrEqual(0.85);
    });

    test("xác suất 1.0 → 0.85 (mức CRITICAL)", () => {
      expect(churnModel.mapToSystemScale(1, T)).toBeCloseTo(0.85, 4);
    });

    test("ngưỡng mô hình bị hỏng (0 hoặc 1) → trả nhị phân, không chia 0", () => {
      // Ngưỡng 0 = "mô hình coi mọi khách là rủi ro" ⇒ mọi xác suất đều thành 1.
      expect(churnModel.mapToSystemScale(0.9, 0)).toBe(1);
      expect(churnModel.mapToSystemScale(0.1, 0)).toBe(1);
      // Ngưỡng 1 = "không khách nào rủi ro" ⇒ 0.
      expect(churnModel.mapToSystemScale(0.9, 1)).toBe(0);
      expect(churnModel.mapToSystemScale(1, 1)).toBe(1);
    });
  });

  describe("combine", () => {
    test("lấy giá trị cao hơn", () => {
      expect(churnModel.combine(0.8, 0.75)).toBe(0.8);
      expect(churnModel.combine(0.5, 0.75)).toBe(0.75);
    });
    test("null được coi là 0 (không mất kết quả công thức)", () => {
      expect(churnModel.combine(null, 0.75)).toBe(0.75);
      expect(churnModel.combine(0.8, null)).toBe(0.8);
      expect(churnModel.combine(null, null)).toBe(0);
    });
  });

  describe("scoreCustomer", () => {
    const metrics = {
      recencyDays: 120,
      frequency: 8,
      monetary: 4500000,
      avgGap: 40,
      tenureDays: 400,
      avgOrderValue: 560000,
    };

    test("khách có < 2 đơn → null (không suy đoán)", () => {
      expect(churnModel.scoreCustomer({}, { ...metrics, frequency: 1 })).toBeNull();
    });
    test("không có metrics → null", () => {
      expect(churnModel.scoreCustomer({}, null)).toBeNull();
    });
    test("chưa có recency → null", () => {
      expect(churnModel.scoreCustomer({}, { ...metrics, recencyDays: null })).toBeNull();
    });

    const hasModel = fs.existsSync(MODEL_PATH);
    (hasModel ? test : test.skip)("khách đủ lịch sử → xác suất trong (0,1) + engine", () => {
      const out = churnModel.scoreCustomer({ id: "c1" }, metrics);
      expect(out).not.toBeNull();
      expect(out.p).toBeGreaterThan(0);
      expect(out.p).toBeLessThan(1);
      expect(typeof out.engine).toBe("string");
      expect(out.threshold).toBeGreaterThan(0);
    });

    (hasModel ? test : test.skip)("khách im lặng lâu hơn khách tích cực → p lớn hơn", () => {
      const active = churnModel.scoreCustomer({}, { ...metrics, recencyDays: 3, avgGap: 30 });
      const dormant = churnModel.scoreCustomer({}, { ...metrics, recencyDays: 300, avgGap: 30 });
      expect(dormant.p).toBeGreaterThan(active.p);
    });

    (hasModel ? test : test.skip)("khách mua nhiều hơn → p nhỏ hơn", () => {
      const rare = churnModel.scoreCustomer({}, { ...metrics, frequency: 2 });
      const frequent = churnModel.scoreCustomer({}, { ...metrics, frequency: 30 });
      expect(frequent.p).toBeLessThan(rare.p);
    });
  });

  describe("getModelInfo", () => {
    const hasModel = fs.existsSync(MODEL_PATH);
    (hasModel ? test : test.skip)("trả về thông tin mô hình + AUC + giới hạn đã ghi", () => {
      const info = churnModel.getModelInfo();
      expect(info.available).toBe(true);
      expect(Array.isArray(info.features)).toBe(true);
      expect(info.metrics.aucTest).toBeGreaterThan(0.5);
      // Giới hạn phải được ghi kèm trong file mô hình — đây là thứ nhóm phải đọc
      // được khi bảo vệ đồ án.
      expect(Array.isArray(info.limitations)).toBe(true);
      expect(info.limitations.length).toBeGreaterThan(0);
    });

    test("file mô hình hỏng/không đọc được → available=false, KHÔNG ném lỗi", () => {
      // Phải chặn `statSync` chứ không `existsSync`: `loadModel()` kiểm tra cache
      // trước (`if (cache.model && ...) return cache.model`), nên nếu chặn
      // existsSync thì vẫn trả về mô hình đã cache và test thành vô nghĩa.
      const spy = jest.spyOn(fs, "statSync").mockImplementation(() => {
        throw new Error("ENOENT: file mô hình không tồn tại");
      });
      const info = churnModel.getModelInfo();
      expect(info.available).toBe(false);
      expect(info.engine).toBe("bnbd-formula");
      spy.mockRestore();
    });
  });
});
