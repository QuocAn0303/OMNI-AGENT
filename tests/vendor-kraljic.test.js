/**
 * tests/vendor-kraljic.test.js — Test Kraljic Matrix (Mục 5)
 */
const mockClient = {
  vendor: { findUnique: jest.fn(), update: jest.fn() },
  auditLog: { create: jest.fn() },
};

jest.mock("../src/config/prisma", () => mockClient);
jest.mock("../src/utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const service = require("../src/modules/accounting/vendor.service");

describe("vendor.service — Kraljic Matrix (Mục 5)", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("deriveKraljic", () => {
    test("Cao/Cao → STRATEGIC", () => {
      expect(service.deriveKraljic(8, 7)).toBe("STRATEGIC");
    });

    test("Cao/Thấp → LEVERAGE", () => {
      expect(service.deriveKraljic(9, 3)).toBe("LEVERAGE");
    });

    test("Thấp/Cao → BOTTLENECK", () => {
      expect(service.deriveKraljic(3, 8)).toBe("BOTTLENECK");
    });

    test("Thấp/Thấp → ROUTINE", () => {
      expect(service.deriveKraljic(2, 4)).toBe("ROUTINE");
    });

    test("ngưỡng = 6: >=6 = Cao, <6 = Thấp", () => {
      expect(service.deriveKraljic(6, 6)).toBe("STRATEGIC");
      expect(service.deriveKraljic(6, 5)).toBe("LEVERAGE");
      expect(service.deriveKraljic(5, 6)).toBe("BOTTLENECK");
      expect(service.deriveKraljic(5, 5)).toBe("ROUTINE");
    });
  });

  describe("updateKraljic", () => {
    test("update điểm + tự động tính kraljicCategory", async () => {
      mockClient.vendor.findUnique.mockResolvedValue({
        id: "v1", name: "NCC Test", kraljicCategory: "ROUTINE",
        profitImpactScore: 3, supplyRiskScore: 4,
      });
      mockClient.vendor.update.mockResolvedValue({
        id: "v1", kraljicCategory: "STRATEGIC",
        profitImpactScore: 8, supplyRiskScore: 7,
      });

      const res = await service.updateKraljic("v1", { profitImpactScore: 8, supplyRiskScore: 7 });

      expect(res.kraljicCategory).toBe("STRATEGIC");
      expect(mockClient.vendor.update).toHaveBeenCalledWith({
        where: { id: "v1" },
        data: expect.objectContaining({
          kraljicCategory: "STRATEGIC",
          profitImpactScore: 8,
          supplyRiskScore: 7,
        }),
      });
    });

    test("vendor không tồn tại → 404", async () => {
      mockClient.vendor.findUnique.mockResolvedValue(null);
      await expect(service.updateKraljic("missing", { profitImpactScore: 5, supplyRiskScore: 5 }))
        .rejects.toMatchObject({ status: 404 });
    });
  });
});
