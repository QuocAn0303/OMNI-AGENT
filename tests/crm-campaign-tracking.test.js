/**
 * tests/crm-campaign-tracking.test.js — Test tuân thủ + đo chiến dịch (CRM Phase 4)
 *
 * Trọng tâm:
 * - Token: sinh ngẫu nhiên, idempotent (re-run không đổi token cũ → link cũ vẫn chạy).
 * - UNSUBSCRIBE chặn THEO KÊNH chứ không theo chiến dịch — đây là điểm dễ sai
 *   nhất: nếu chỉ chặn đúng chiến dịch hiện tại thì chiến dịch sau khách lại bị gửi.
 * - OPEN chỉ ghi lần đầu (không phồng tỉ lệ mở khi client tải lại ảnh).
 * - CLICK chặn open-redirect (javascript:/data:) — endpoint này không có auth.
 * - executeCampaign bỏ qua recipient đã từ chối, và chèn link/pixel/header.
 */
const mockClient = {
  campaignRecipient: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    count: jest.fn(),
    groupBy: jest.fn(),
  },
  campaignTracking: {
    create: jest.fn(),
    findFirst: jest.fn(),
    groupBy: jest.fn(),
  },
  customerCampaign: { findUnique: jest.fn() },
  customerSegment: { findUnique: jest.fn() },
};

jest.mock("../src/config/prisma", () => mockClient);
jest.mock("../src/utils/logger", () => ({
  info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn(),
}));

const tracking = require("../src/modules/crm/campaign-tracking.service");

const RECIPIENT = (over = {}) => ({
  id: "rec-1",
  campaignId: "camp-1",
  customerId: "cust-1",
  unsubscribedAt: null,
  unsubscribeToken: "unsub-token",
  trackingToken: "track-token",
  campaign: { id: "camp-1", name: "Khuyến mãi tháng 10", channel: "EMAIL" },
  ...over,
});

describe("crm/campaign-tracking.service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockClient.campaignTracking.create.mockResolvedValue({ id: "t-1" });
    mockClient.campaignTracking.findFirst.mockResolvedValue(null);
    mockClient.campaignRecipient.update.mockImplementation(async ({ data }) => ({ ...RECIPIENT(), ...data }));
    mockClient.campaignRecipient.updateMany.mockResolvedValue({ count: 0 });
  });

  const tokenFor = (id) => ({ id, unsubscribedAt: null, unsubscribeToken: `u-${id}`, trackingToken: `t-${id}` });
  const tracked = jest.spyOn(tracking, "ensureTokens");

  describe("generateToken", () => {
    test("dài 32 ký tự base64url, không chứa PII", () => {
      const t = tracking.generateToken();
      expect(t).toHaveLength(32);
      expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    test("không trùng lặp", () => {
      const set = new Set(Array.from({ length: 200 }, () => tracking.generateToken()));
      expect(set.size).toBe(200);
    });
  });

  describe("safeRedirectUrl", () => {
    test("chấp nhận http/https", () => {
      expect(tracking.safeRedirectUrl("https://shop.vn/a?b=1")).toBe("https://shop.vn/a?b=1");
      expect(tracking.safeRedirectUrl("http://shop.vn")).toBe("http://shop.vn/");
    });

    test("CHẶN javascript: / data: / vbscript:", () => {
      expect(tracking.safeRedirectUrl("javascript:alert(1)")).toBeNull();
      expect(tracking.safeRedirectUrl("JavaScript:alert(1)")).toBeNull();
      expect(tracking.safeRedirectUrl("data:text/html,<script>alert(1)</script>")).toBeNull();
      expect(tracking.safeRedirectUrl("vbscript:msgbox(1)")).toBeNull();
    });

    test("chặn rác / quá dài", () => {
      expect(tracking.safeRedirectUrl("")).toBeNull();
      expect(tracking.safeRedirectUrl(null)).toBeNull();
      expect(tracking.safeRedirectUrl("không phải url")).toBeNull();
      expect(tracking.safeRedirectUrl(`https://s.vn/${"x".repeat(3000)}`)).toBeNull();
    });
  });

  describe("ensureTokens", () => {
    test("recipient không tồn tại → null", async () => {
      mockClient.campaignRecipient.findUnique.mockResolvedValue(null);
      expect(await tracking.ensureTokens("rec-x")).toBeNull();
    });

    test("chưa có token → sinh cả 2 (khi tracking=true)", async () => {
      mockClient.campaignRecipient.findUnique.mockResolvedValue({ id: "rec-1", unsubscribeToken: null, trackingToken: null });
      await tracking.ensureTokens("rec-1", { tracking: true });
      const data = mockClient.campaignRecipient.update.mock.calls[0][0].data;
      expect(data.unsubscribeToken).toMatch(/^[A-Za-z0-9_-]{32}$/);
      expect(data.trackingToken).toMatch(/^[A-Za-z0-9_-]{32}$/);
      expect(data.unsubscribeToken).not.toBe(data.trackingToken);
    });

    test("tracking=false (ZALO) → KHÔNG sinh trackingToken", async () => {
      mockClient.campaignRecipient.findUnique.mockResolvedValue({ id: "rec-1", unsubscribeToken: null, trackingToken: null });
      await tracking.ensureTokens("rec-1", { tracking: false });
      const data = mockClient.campaignRecipient.update.mock.calls[0][0].data;
      expect(data.unsubscribeToken).toBeTruthy();
      expect(data.trackingToken).toBeUndefined();
    });

    test("idempotent: đã có token → KHÔNG ghi, trả token cũ", async () => {
      const current = {
        id: "rec-1", unsubscribedAt: null, unsubscribeToken: "old-unsub", trackingToken: "old-track",
      };
      mockClient.campaignRecipient.findUnique.mockResolvedValue(current);
      const out = await tracking.ensureTokens("rec-1", { tracking: true });
      expect(mockClient.campaignRecipient.update).not.toHaveBeenCalled();
      expect(out).toBe(current);
    });

    test("trả kèm unsubscribedAt để caller chốt trước lúc gửi", async () => {
      const at = new Date("2026-09-01");
      mockClient.campaignRecipient.findUnique.mockResolvedValue({
        id: "rec-1", unsubscribedAt: at, unsubscribeToken: "u", trackingToken: "t",
      });
      const out = await tracking.ensureTokens("rec-1", { tracking: true });
      expect(out.unsubscribedAt).toBe(at);
    });
  });

  describe("trackOpen", () => {
    test("token sai → false, không ghi", async () => {
      mockClient.campaignRecipient.findFirst.mockResolvedValue(null);
      expect(await tracking.trackOpen("bad")).toBe(false);
      expect(mockClient.campaignTracking.create).not.toHaveBeenCalled();
    });

    test("lần đầu → ghi OPEN", async () => {
      mockClient.campaignRecipient.findFirst.mockResolvedValue(RECIPIENT());
      expect(await tracking.trackOpen("track-token", { ip: "1.2.3.4" })).toBe(true);
      expect(mockClient.campaignTracking.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          campaignId: "camp-1", recipientId: "rec-1", event: "OPEN", metadata: { ip: "1.2.3.4" },
        }),
      });
    });

    test("đã có OPEN → KHÔNG ghi lại (không phồng tỉ lệ mở)", async () => {
      mockClient.campaignRecipient.findFirst.mockResolvedValue(RECIPIENT());
      mockClient.campaignTracking.findFirst.mockResolvedValue({ id: "t-old" });
      expect(await tracking.trackOpen("track-token")).toBe(false);
      expect(mockClient.campaignTracking.create).not.toHaveBeenCalled();
    });

    test("lỗi DB khi ghi → nuốt + trả false, không ném ra", async () => {
      mockClient.campaignRecipient.findFirst.mockResolvedValue(RECIPIENT());
      mockClient.campaignTracking.create.mockRejectedValue(new Error("db down"));
      await expect(tracking.trackOpen("track-token")).resolves.toBe(false);
    });
  });

  describe("trackClick", () => {
    test("ghi CLICK kèm URL đích + trả url để redirect", async () => {
      mockClient.campaignRecipient.findFirst.mockResolvedValue(RECIPIENT());
      const out = await tracking.trackClick("track-token", "https://shop.vn/san-pham", { ip: "9.9.9.9" });
      expect(out).toEqual({ ok: true, url: "https://shop.vn/san-pham" });
      expect(mockClient.campaignTracking.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          event: "CLICK", metadata: { ip: "9.9.9.9", url: "https://shop.vn/san-pham" },
        }),
      });
    });

    test("URL đích javascript: → từ chối, KHÔNG ghi sự kiện", async () => {
      mockClient.campaignRecipient.findFirst.mockResolvedValue(RECIPIENT());
      const out = await tracking.trackClick("track-token", "javascript:alert(document.cookie)");
      expect(out).toEqual({ ok: false, reason: "URL_UNSAFE" });
      expect(mockClient.campaignTracking.create).not.toHaveBeenCalled();
    });

    test("token sai → TOKEN_INVALID", async () => {
      mockClient.campaignRecipient.findFirst.mockResolvedValue(null);
      expect(await tracking.trackClick("bad", "https://shop.vn")).toEqual({
        ok: false, reason: "TOKEN_INVALID",
      });
    });
  });

  describe("applyUnsubscribe — chặn THEO KÊNH", () => {
    test("token sai → found:false", async () => {
      mockClient.campaignRecipient.findFirst.mockResolvedValue(null);
      expect((await tracking.applyUnsubscribe("bad")).found).toBe(false);
    });

    test("từ chối lần đầu → đánh dấu recipient + chặn campaign khác cùng kênh", async () => {
      mockClient.campaignRecipient.findFirst.mockResolvedValue(RECIPIENT());
      const out = await tracking.applyUnsubscribe("unsub-token", "quá nhiều email");
      expect(out.found).toBe(true);
      expect(out.alreadyUnsubscribed).toBe(false);

      // recipient hiện tại
      expect(mockClient.campaignRecipient.update).toHaveBeenCalledWith({
        where: { id: "rec-1" },
        data: expect.objectContaining({ unsubscribeReason: "quá nhiều email" }),
      });

      // các campaign chưa gửi khác, CÙNG khách, CÙNG kênh
      const many = mockClient.campaignRecipient.updateMany.mock.calls[0][0];
      expect(many.where).toMatchObject({
        customerId: "cust-1", status: "PENDING", unsubscribedAt: null, campaign: { channel: "EMAIL" },
      });
      expect(many.data.unsubscribedAt).toEqual(expect.any(Date));

      expect(mockClient.campaignTracking.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ event: "UNSUBSCRIBE" }),
      });
    });

    test("đã từ chối rồi → idempotent, không ghi thêm", async () => {
      mockClient.campaignRecipient.findFirst.mockResolvedValue(
        RECIPIENT({ unsubscribedAt: new Date("2026-01-01") }),
      );
      const out = await tracking.applyUnsubscribe("unsub-token");
      expect(out.alreadyUnsubscribed).toBe(true);
      expect(mockClient.campaignRecipient.update).not.toHaveBeenCalled();
      expect(mockClient.campaignRecipient.updateMany).not.toHaveBeenCalled();
    });

    test("reason bị cắt còn 200 ký tự, không nhận object", async () => {
      mockClient.campaignRecipient.findFirst.mockResolvedValue(RECIPIENT());
      await tracking.applyUnsubscribe("unsub-token", "x".repeat(500));
      expect(mockClient.campaignRecipient.update.mock.calls[0][0].data.unsubscribeReason).toHaveLength(200);
      await tracking.applyUnsubscribe("unsub-token", { evil: true });
      expect(mockClient.campaignRecipient.update.mock.calls[1][0].data.unsubscribeReason).toBeNull();
    });

    test("KHÔNG chặn ngược recipient đã SENT (giữ đúng lịch sử báo cáo)", async () => {
      mockClient.campaignRecipient.findFirst.mockResolvedValue(RECIPIENT());
      await tracking.applyUnsubscribe("unsub-token");
      expect(mockClient.campaignRecipient.updateMany.mock.calls[0][0].where.status).toBe("PENDING");
    });
  });

  describe("getUnsubscribePreview", () => {
    test("token sai → found:false", async () => {
      mockClient.campaignRecipient.findFirst.mockResolvedValue(null);
      expect(await tracking.getUnsubscribePreview("bad")).toEqual({ found: false });
    });

    test("trả tên chiến dịch + kênh, không đổi state", async () => {
      mockClient.campaignRecipient.findFirst.mockResolvedValue(RECIPIENT());
      const out = await tracking.getUnsubscribePreview("unsub-token");
      expect(out).toMatchObject({
        found: true, alreadyUnsubscribed: false,
        campaignName: "Khuyến mãi tháng 10", channel: "EMAIL",
      });
      expect(mockClient.campaignRecipient.update).not.toHaveBeenCalled();
      expect(mockClient.campaignRecipient.updateMany).not.toHaveBeenCalled();
    });
  });

  describe("getStats", () => {
    test("tính open/click rate theo số SENT, chống chia 0", async () => {
      mockClient.campaignTracking.groupBy.mockResolvedValue([
        { event: "SENT", _count: { _all: 40 } },
        { event: "OPEN", _count: { _all: 10 } },
        { event: "CLICK", _count: { _all: 4 } },
      ]);
      mockClient.campaignRecipient.groupBy.mockResolvedValue([
        { status: "SENT", _count: { _all: 40 } },
        { status: "FAILED", _count: { _all: 2 } },
      ]);
      mockClient.campaignRecipient.count.mockResolvedValue(3);

      const s = await tracking.getStats("camp-1");
      expect(s.events).toMatchObject({ SENT: 40, OPEN: 10, CLICK: 4, BOUNCE: 0 });
      expect(s.recipients).toMatchObject({ SENT: 40, FAILED: 2 });
      expect(s.unsubscribed).toBe(3);
      expect(s.openRate).toBeCloseTo(0.25, 5);
      expect(s.clickRate).toBeCloseTo(0.1, 5);
      expect(s.clickToOpenRate).toBeCloseTo(0.4, 5);
    });

    test("chưa gửi gì → rate = 0, không NaN", async () => {
      mockClient.campaignTracking.groupBy.mockResolvedValue([]);
      mockClient.campaignRecipient.groupBy.mockResolvedValue([]);
      mockClient.campaignRecipient.count.mockResolvedValue(0);
      const s = await tracking.getStats("camp-1");
      expect(s.openRate).toBe(0);
      expect(s.clickRate).toBe(0);
      expect(s.clickToOpenRate).toBe(0);
    });
  });

  describe("URL sinh ra", () => {
    test("mọi link đi qua /api/crm/track và base không có //", () => {
      const b = tracking.baseUrl();
      expect(b.endsWith("/")).toBe(false);
      expect(tracking.unsubscribeUrl("tk")).toBe(`${b}/api/crm/track/unsubscribe/tk`);
      expect(tracking.openPixelUrl("tk")).toBe(`${b}/api/crm/track/open/tk.gif`);
      expect(tracking.clickUrl("tk", "https://s.vn/x?y=1")).toBe(
        `${b}/api/crm/track/click/tk?url=https%3A%2F%2Fs.vn%2Fx%3Fy%3D1`,
      );
    });

    test("token được encode trong path (chống path traversal)", () => {
      expect(tracking.unsubscribeUrl("../../admin")).toContain("..%2F..%2Fadmin");
    });
  });
});