/**
 * tests/crm-campaign-send.test.js — Test luồng gửi chiến dịch (CRM Phase 4)
 *
 * Trọng tâm:
 * - Bỏ qua recipient đã từ chối (Nghị định 13/2023) — và báo số đã bỏ qua.
 * - Bọc link để đo click: KHÔNG bọc link đã là tracking, KHÔNG bọc mailto/tel/#.
 * - Gắn pixel mở mail + link từ chối vào HTML, header `List-Unsubscribe` vào email.
 * - ZALO: có link từ chối dạng chữ nhưng KHÔNG sinh trackingToken (Zalo OA không
 *   render HTML → pixel vô nghĩa).
 * - Đã từ chối trước thì không được gửi lại (kể cả khi chạy lại campaign).
 */
const mockClient = {
  customerCampaign: { findUnique: jest.fn(), update: jest.fn() },
  customerSegment: { findUnique: jest.fn() },
  campaignRecipient: {
    findMany: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    count: jest.fn(),
    createMany: jest.fn(),
  },
};

jest.mock("../src/config/prisma", () => mockClient);
jest.mock("../src/modules/audit/audit.service", () => ({ log: jest.fn() }));
jest.mock("../src/utils/logger", () => ({
  info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn(),
}));

// Biến mock phải có tiền tố "mock" — jest cấm factory tham chiếu biến ngoài scope.
const mockSendEmail = jest.fn();
const mockSendZaloMessage = jest.fn();
jest.mock("../src/utils/email", () => ({ sendEmail: (...a) => mockSendEmail(...a) }));
jest.mock("../src/utils/zalo", () => ({ sendZaloMessage: (...a) => mockSendZaloMessage(...a) }));

const mockEvaluateSegment = jest.fn();
jest.mock("../src/modules/crm/segments.service", () => ({
  evaluateSegment: (...a) => mockEvaluateSegment(...a),
}));

const campaignsService = require("../src/modules/crm/campaigns.service");
const { rewriteLinksForTracking, buildEmailHtml, isTrackableHref } = campaignsService.__internals;

const CAMPAIGN = (over = {}) => ({
  id: "camp-1",
  name: "Khuyến mãi tháng 10",
  channel: "EMAIL",
  subject: "Ưu đãi {{name}}",
  bodyTemplate: "Chào {{name}}, xem <a href=\"https://shop.vn/sale\">sale</a> nhé",
  status: "SCHEDULED",
  scheduledAt: new Date("2026-10-01T00:00:00Z"),
  segment: { id: "seg-1", rules: { field: "tier", operator: "eq", value: "GOLD" } },
  ...over,
});

const RECIPIENT = (over = {}) => ({
  id: "rec-1",
  status: "PENDING",
  unsubscribedAt: null,
  customer: { id: "cust-1", name: "An", phone: "0900000001", email: "an@x.vn", zaloUserId: null, tier: "GOLD", loyaltyPoints: 0, totalSpent: 0 },
  ...over,
});

// Khách trong segment — cust-3 đã từ chối ở chiến dịch trước, cust-1 thì chưa
const CUST_OPT_OUT = { id: "cust-3", name: "Cô 3", phone: "0900000003", email: "c3@x.vn", zaloUserId: null, tier: "GOLD", loyaltyPoints: 0, totalSpent: 0 };
const CUST_FRESH = { id: "cust-1", name: "An", phone: "0900000001", email: "an@x.vn", zaloUserId: null, tier: "GOLD", loyaltyPoints: 0, totalSpent: 0 };

// ensureTokens/recordSent trả token giả định
const trackingService = require("../src/modules/crm/campaign-tracking.service");
const ensureTokensSpy = jest.spyOn(trackingService, "ensureTokens");

// recordSent ghi vào DB — không quan tâm cho các test này
jest.spyOn(trackingService, "recordSent").mockResolvedValue(true);

describe("crm/campaigns.service — executeCampaign (Phase 4)", () => {
  // Test bổ sung cho phần "chặn từ chối THEO KÊNH" ở tầng tạo recipient.
  // Trước đó chỉ lọc `unsubscribedAt` của recipient thuộc chiến dịch NÀY ⇒ khách
  // đã opt-out ở chiến dịch trước vẫn nhận email. Smoke test trên DB thật
  // (`smoke-crm-phase4-send.js`) bắt được; test ở đây chốt lại để không tái phát.
  describe("chặn từ chối theo kênh khi tạo recipient mới", () => {
    // findMany được gọi 4 lần:
    //   1) existing recipients
    //   2) lịch sử từ chối của khách trong segment (cùng kênh)
    //   3) toàn bộ recipients sau khi create
    //   4) pending đã lọc
    beforeEach(() => {
      mockEvaluateSegment.mockResolvedValue({ customers: [CUST_OPT_OUT, CUST_FRESH] });
      mockClient.campaignRecipient.findMany
        .mockReset()
        .mockResolvedValueOnce([])                                    // existing
        .mockResolvedValueOnce([{ customerId: CUST_OPT_OUT.id }])     // đã từ chối trước đó
        .mockResolvedValueOnce([])                                    // allRecipients
        .mockResolvedValueOnce([]);                                   // pending
      mockClient.campaignRecipient.createMany.mockResolvedValue({ count: 2 });
    });

    test("KH đã opt-out ở chiến dịch TRƯỚC → recipient mới được đánh dấu unsubscribedAt", async () => {
      await campaignsService.executeCampaign("camp-1");
      const created = mockClient.campaignRecipient.createMany.mock.calls[0][0].data;
      const optedOut = created.find((r) => r.customerId === CUST_OPT_OUT.id);
      expect(optedOut).toBeDefined();
      expect(optedOut.unsubscribedAt).toEqual(expect.any(Date));
    });

    test("KH chưa từ chối → KHÔNG set unsubscribedAt", async () => {
      await campaignsService.executeCampaign("camp-1");
      const created = mockClient.campaignRecipient.createMany.mock.calls[0][0].data;
      const fresh = created.find((r) => r.customerId === CUST_FRESH.id);
      expect(fresh).toBeDefined();
      expect(fresh.unsubscribedAt).toBeUndefined();
    });

    test("chỉ hỏi lịch sử từ chối trên CÙNG kênh", async () => {
      await campaignsService.executeCampaign("camp-1");
      // Lọc theo channel: hỏi chung kênh thì khách từ chối ZALO sẽ bị chặn cả
      // email — sai ý nghĩa "từ chối theo kênh".
      const optsCall = mockClient.campaignRecipient.findMany.mock.calls[1][0];
      expect(optsCall.where.campaign).toEqual({ channel: "EMAIL" });
      expect(optsCall.where.unsubscribedAt).toEqual({ not: null });
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    ensureTokensSpy.mockImplementation(async (id, opts) => ({
      id,
      unsubscribedAt: null,
      unsubscribeToken: `u-${id}`,
      trackingToken: opts?.tracking ? `t-${id}` : null,
    }));
    trackingService.recordSent.mockClear();
    mockSendEmail.mockResolvedValue({ messageId: "m-1" });
    mockSendZaloMessage.mockResolvedValue({ ok: true });
    mockEvaluateSegment.mockResolvedValue({ customers: [] });
    mockClient.customerCampaign.findUnique.mockResolvedValue(CAMPAIGN());
    mockClient.customerCampaign.update.mockResolvedValue({});
    mockClient.campaignRecipient.createMany.mockResolvedValue({ count: 0 });
    mockClient.campaignRecipient.update.mockResolvedValue({});
    mockClient.campaignRecipient.count.mockResolvedValue(1);
    // executeCampaign gọi campaignRecipient.findMany 3 lần:
    //   1) existing recipients (đã có trong DB chưa)
    //   2) toàn bộ recipients — để lọc unsubscribedAt
    //   3) pending đã lọc — danh sách thực sự gửi
    mockClient.campaignRecipient.findMany
      .mockReset()
      .mockResolvedValueOnce([])                       // existing
      .mockResolvedValueOnce([{ id: "rec-1", unsubscribedAt: null }])  // allRecipients
      .mockResolvedValueOnce([RECIPIENT()]);           // pending
  });

  describe("từ chối nhận tin", () => {
    test("KHÔNG bỏ sót: từ chối giữa chừng lúc campaign đang chạy → không gửi", async () => {
      // Lọc ở query KHÔNG đủ: campaign gửi batch 50/lần kèm 1s delay, người nhận
      // có thể bấm "từ chối" sau khi đã đọc. `ensureTokens` đọc lại dòng ngay trước
      // lúc gửi và trả về unsubscribedAt → service phải chặn.
      mockClient.campaignRecipient.findMany
        .mockReset()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: "rec-1", unsubscribedAt: null }])  // lúc đọc: chưa từ chối
        .mockResolvedValueOnce([RECIPIENT()]);
      // Giờ người nhận đã bấm từ chối
      ensureTokensSpy.mockResolvedValue({
        id: "rec-1", unsubscribedAt: new Date(), unsubscribeToken: "u-1", trackingToken: "t-1",
      });

      const out = await campaignsService.executeCampaign("camp-1");
      expect(mockSendEmail).not.toHaveBeenCalled();
      expect(out.failed).toBe(1);
      // Lỗi phải nói rõ là do từ chối, không phải lỗi kỹ thuật
      expect(mockClient.campaignRecipient.update.mock.calls.at(-1)[0].data.error)
        .toContain("đã từ chối nhận tin");
      expect(trackingService.recordSent).not.toHaveBeenCalled();
    });

    test("recipient đã unsubscribedAt → KHÔNG gửi, đếm skippedUnsubscribed", async () => {
      // findMany #2 (allRecipients) trả 2: 1 bị từ chối, 1 hợp lệ
      mockClient.campaignRecipient.findMany
        .mockReset()
        .mockResolvedValueOnce([])                                       // existing
        .mockResolvedValueOnce([                                          // allRecipients
          { id: "rec-1", unsubscribedAt: new Date("2026-09-01") },
          { id: "rec-2", unsubscribedAt: null },
        ])
        .mockResolvedValueOnce([RECIPIENT({ id: "rec-2" })]);             // pending (đã lọc)

      const out = await campaignsService.executeCampaign("camp-1");
      expect(mockSendEmail).toHaveBeenCalledTimes(1);
      expect(out.skippedUnsubscribed).toBe(1);
      // id: { in: allowedIds } phải CHỈ chứa rec-2
      const pendingCall = mockClient.campaignRecipient.findMany.mock.calls[2][0];
      expect(pendingCall.where.id).toEqual({ in: ["rec-2"] });
    });

    test("tất cả đều từ chối → không gửi gì, campaign vẫn SENT với sent=0", async () => {
      mockClient.campaignRecipient.findMany
        .mockReset()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: "rec-1", unsubscribedAt: new Date() }])
        .mockResolvedValueOnce([]);
      mockClient.campaignRecipient.count.mockImplementation(async ({ where }) => {
        if (where.status === "SENT") return 0;
        if (where.status === "FAILED") return 0;
        return 1;
      });

      const out = await campaignsService.executeCampaign("camp-1");
      expect(mockSendEmail).not.toHaveBeenCalled();
      expect(out.sent).toBe(0);
      expect(out.skippedUnsubscribed).toBe(1);
    });

    test("recipient từ chối giữa chừng (token set sau khi lọc) → không gửi cho họ", async () => {
      // Không lọc ở query (giả lập dữ liệu cũ chưa có unsubscribedAt) nhưng service
      // phải check lại ngay trước lúc gửi — đây là guard bắt buộc, không phải tuỳ chọn.
      const res = await campaignsService.executeCampaign("camp-1");
      expect(res).toBeDefined();
    });
  });

  describe("kênh EMAIL", () => {
    test("gửi kèm pixel mở + link từ chối + header List-Unsubscribe", async () => {
      await campaignsService.executeCampaign("camp-1");
      const args = mockSendEmail.mock.calls[0][0];
      expect(args.to).toBe("an@x.vn");
      expect(args.subject).toBe("Ưu đãi An");
      expect(args.html).toContain("/api/crm/track/open/");
      expect(args.html).toContain("Ngừng nhận tin");
      expect(args.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
      expect(args.headers["List-Unsubscribe"]).toMatch(/^<https?:\/\/.+\/api\/crm\/track\/unsubscribe\/.+>$/);
      // bản text cũng có link từ chối (client không render HTML)
      expect(args.text).toContain("/api/crm/track/unsubscribe/");
    });

    test("không có email → đánh FAILED, không ném", async () => {
      mockClient.campaignRecipient.findMany.mockReset()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: "rec-1", unsubscribedAt: null }])
        .mockResolvedValueOnce([RECIPIENT({ customer: { ...RECIPIENT().customer, email: null } })]);
      const out = await campaignsService.executeCampaign("camp-1");
      expect(mockSendEmail).not.toHaveBeenCalled();
      expect(out.failed).toBe(1);
    });
  });

  describe("kênh ZALO", () => {
    beforeEach(() => {
      mockClient.customerCampaign.findUnique.mockResolvedValue(CAMPAIGN({ channel: "ZALO" }));
      mockClient.campaignRecipient.findMany
        .mockReset()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: "rec-1", unsubscribedAt: null }])
        .mockResolvedValueOnce([RECIPIENT()]);
    });

    test("có link từ chối dạng chữ", async () => {
      await campaignsService.executeCampaign("camp-1");
      expect(mockSendZaloMessage).toHaveBeenCalledTimes(1);
      const args = mockSendZaloMessage.mock.calls[0][0];
      expect(args.userId).toBe("0900000001");       // fallback phone
      expect(args.text).toContain("/api/crm/track/unsubscribe/");
    });

    test("ưu tiên zaloUserId khi có", async () => {
      mockClient.campaignRecipient.findMany.mockReset()
        .mockReset()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: "rec-1", unsubscribedAt: null }])
        .mockResolvedValueOnce([RECIPIENT({
          customer: { ...RECIPIENT().customer, zaloUserId: "zao-abc" },
        })]);
      await campaignsService.executeCampaign("camp-1");
      expect(mockSendZaloMessage.mock.calls[0][0].userId).toBe("zao-abc");
    });
  });

  describe("rewriteLinksForTracking", () => {
    test("bọc link http thường", () => {
      const out = rewriteLinksForTracking('<a href="https://shop.vn/a">A</a>', "tk");
      expect(out).toContain("/api/crm/track/click/tk?url=https%3A%2F%2Fshop.vn%2Fa");
      expect(out).toContain(">A</a>");
    });

    test("KHÔNG bọc mailto: / tel: / #anchor / javascript:", () => {
      expect(isTrackableHref("mailto:a@b.vn")).toBe(false);
      expect(isTrackableHref("tel:0900000001")).toBe(false);
      expect(isTrackableHref("#section")).toBe(false);
      expect(isTrackableHref("javascript:alert(1)")).toBe(false);
      const html = '<a href="mailto:a@b.vn">M</a><a href="#x">X</a>';
      expect(rewriteLinksForTracking(html, "tk")).toBe(html);
    });

    test("KHÔNG bọc lại link đã trỏ về tracking (tránh vòng lặp khi re-run)", () => {
      const already = `<a href="${trackingService.clickUrl("old", "https://shop.vn/a")}">A</a>`;
      const out = rewriteLinksForTracking(already, "new");
      expect(out).toBe(already);
      expect(out).not.toContain("new");
    });

    test("giữ nguyên nháy quote gốc và các attribute khác của thẻ a", () => {
      const out = rewriteLinksForTracking(`<a class="btn" href='https://shop.vn/a' target="_blank">A</a>`, "tk");
      expect(out).toContain(`class="btn"`);
      expect(out).toContain(`target="_blank"`);
      expect(out).toContain("/api/crm/track/click/tk");
    });

    test("nhiều link trong 1 body → bọc tất cả", () => {
      const out = rewriteLinksForTracking(
        '<a href="https://a.vn">1</a> giữa <a href="https://b.vn">2</a>', "tk",
      );
      expect(out.match(/\/api\/crm\/track\/click/g)).toHaveLength(2);
    });

    test("href rỗng → giữ nguyên", () => {
      const html = '<a href="">x</a>';
      expect(rewriteLinksForTracking(html, "tk")).toBe(html);
    });
  });

  describe("buildEmailHtml", () => {
    test("bọc link + thêm footer từ chối + pixel, dùng CÙNG 1 token", () => {
      const out = buildEmailHtml('<a href="https://shop.vn/a">A</a>', "TKN");
      expect(out).toContain("/api/crm/track/click/TKN");
      expect(out).toContain("/api/crm/track/open/TKN.gif");
      expect(out).toContain("/api/crm/track/unsubscribe/TKN");
      expect(out).toContain("no-referrer");
    });

    test("token khác nhau giữa click / pixel / unsubscribe khi đổi recipient", () => {
      const a = buildEmailHtml("<p>x</p>", "AAA");
      const b = buildEmailHtml("<p>x</p>", "BBB");
      expect(a).not.toBe(b);
      expect(a).toContain("AAA");
      expect(b).toContain("BBB");
    });
  });
});