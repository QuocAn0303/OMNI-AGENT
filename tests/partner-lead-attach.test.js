/**
 * tests/partner-lead-attach.test.js — PRM: gắn lead vào đối tác qua webhook
 *
 * LỖI ĐÃ XẢY RA THẬT, ĐÃ SỬA, VÀ PHẢI CÓ TEST GIỮ LẠI:
 * Khi lượt giới thiệu đã tồn tại (nhân viên nhập tay) mà webhook lại gửi cùng số
 * điện thoại, `attachToLead` trả về dòng cũ mà KHÔNG gắn `leadId`. Sau đó
 * `markConverted(leadId)` không tìm thấy dòng nào ⇒ lượt giới thiệu không bao giờ
 * được đánh dấu chuyển đổi ⇒ đối tác mất hoa hồng mà báo cáo vẫn bình thường.
 *
 * Test này khoá lại đúng hành vi đó, cộng thêm việc chống tạo trùng và chống gắn
 * hai lead vào một lượt.
 */

jest.mock("../src/config/prisma", () => ({
  partner: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  partnerReferral: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    count: jest.fn(),
  },
  customer: { update: jest.fn() },
}));

jest.mock("../src/modules/partners/partner.service", () => ({
  findActiveByCode: jest.fn(),
  genReferralCode: jest.fn(() => "RF-TESTCODE01"),
}));

jest.mock("../src/utils/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const prisma = require("../src/config/prisma");
const partnerService = require("../src/modules/partners/partner.service");
const { attachToLead, markConverted } = require("../src/modules/partners/referral.service");

const PARTNER = { id: "p1", code: "ĐT-202610-0001", name: "Đối tác A" };
const LEAD = { id: "l1", leadName: "Nguyễn Văn A", mobileNo: "0900000001", email: null };

beforeEach(() => {
  jest.clearAllMocks();
  partnerService.findActiveByCode.mockResolvedValue(PARTNER);
});

describe("attachToLead", () => {
  test("mã đối tác không hợp lệ hoặc đã ngừng → trả null, KHÔNG tạo lượt giới thiệu", async () => {
    partnerService.findActiveByCode.mockResolvedValue(null);
    const out = await attachToLead({ partnerCode: "KHONG-CO", lead: LEAD });
    expect(out).toBeNull();
    expect(prisma.partnerReferral.create).not.toHaveBeenCalled();
  });

  test("lượt giới thiệu mới → tạo dòng có leadId", async () => {
    prisma.partnerReferral.findFirst.mockResolvedValue(null);
    prisma.partnerReferral.create.mockResolvedValue({ id: "r1", referralCode: "RF-TESTCODE01" });

    const out = await attachToLead({ partnerCode: PARTNER.code, lead: LEAD });

    expect(out.id).toBe("r1");
    const arg = prisma.partnerReferral.create.mock.calls[0][0].data;
    expect(arg.leadId).toBe("l1");
    expect(arg.partnerId).toBe("p1");
    expect(arg.referredPhone).toBe("0900000001");
  });

  test("LƯỢT ĐÃ TỒN TẠI CHƯA GẮN LEAD → gắn bổ sung leadId, không tạo dòng mới", async () => {
    // Đây là hành vi đã sửa. Không có nó thì hoa hồng bị mất âm thầm.
    prisma.partnerReferral.findFirst.mockResolvedValue({
      id: "r-old",
      referralCode: "RF-CU",
      converted: false,
      leadId: null,
      customerId: null,
    });
    prisma.partnerReferral.update.mockResolvedValue({
      id: "r-old",
      referralCode: "RF-CU",
      converted: false,
      leadId: "l1",
      customerId: null,
    });

    const out = await attachToLead({ partnerCode: PARTNER.code, lead: LEAD });

    expect(prisma.partnerReferral.create).not.toHaveBeenCalled();
    expect(prisma.partnerReferral.update).toHaveBeenCalledTimes(1);
    expect(prisma.partnerReferral.update.mock.calls[0][0].data.leadId).toBe("l1");
    expect(out.leadId).toBe("l1");
  });

  test("lượt đã tồn tại, chưa có khách, webhook kèm customerId → ghi luôn chiều ngược", async () => {
    prisma.partnerReferral.findFirst.mockResolvedValue({
      id: "r-old",
      referralCode: "RF-CU",
      converted: false,
      leadId: null,
      customerId: null,
    });
    prisma.partnerReferral.update.mockResolvedValue({ id: "r-old", leadId: "l1", customerId: "c9" });

    await attachToLead({ partnerCode: PARTNER.code, lead: LEAD, customerId: "c9" });

    expect(prisma.partnerReferral.update.mock.calls[0][0].data).toEqual({
      leadId: "l1",
      customerId: "c9",
    });
  });

  test("lượt đã tồn tại và ĐÃ gắn lead → bỏ qua, không ghi đè lead khác", async () => {
    // Ghi đè sẽ làm mất liên kết giữa lượt giới thiệu và lead đã tạo deal.
    prisma.partnerReferral.findFirst.mockResolvedValue({
      id: "r-old",
      referralCode: "RF-CU",
      converted: true,
      leadId: "l-cu",
      customerId: "c-cu",
    });

    const out = await attachToLead({ partnerCode: PARTNER.code, lead: LEAD, customerId: "c-moi" });

    expect(prisma.partnerReferral.update).not.toHaveBeenCalled();
    expect(prisma.partnerReferral.create).not.toHaveBeenCalled();
    expect(out.id).toBe("r-old");
  });

  test("hai webhook song song trúng ràng buộc DB → trả null thay vì ném lỗi ra ngoài", async () => {
    prisma.partnerReferral.findFirst.mockResolvedValue(null);
    prisma.partnerReferral.create.mockRejectedValue({ code: "P2002" });

    const out = await attachToLead({ partnerCode: PARTNER.code, lead: LEAD });

    expect(out).toBeNull();
  });

  test("lỗi khác P2002 thì vẫn ném lên — không nuốt lỗi thật", async () => {
    prisma.partnerReferral.findFirst.mockResolvedValue(null);
    prisma.partnerReferral.create.mockRejectedValue(new Error("hết kết nối"));

    await expect(attachToLead({ partnerCode: PARTNER.code, lead: LEAD })).rejects.toThrow("hết kết nối");
  });
});

describe("markConverted", () => {
  test("đánh dấu chuyển đổi và ghi ngược partnerReferralId lên khách", async () => {
    // `markConverted` đọc lại danh sách id trước khi update, để trả về đúng số
    // dòng và biết id nào sẽ ghi ngược lên khách.
    prisma.partnerReferral.findMany.mockResolvedValue([{ id: "r1" }]);
    prisma.partnerReferral.updateMany.mockResolvedValue({ count: 1 });
    prisma.customer.update.mockResolvedValue({});

    const out = await markConverted("l1", "c1");

    expect(out.updated).toBe(1);
    expect(prisma.partnerReferral.findMany.mock.calls[0][0].where).toEqual({
      leadId: "l1",
      converted: false,
    });
    // Chỉ đánh dấu dòng CHƯA chuyển đổi — nếu bỏ điều kiện này thì một lead có
    // nhiều lượt giới thiệu sẽ dồn hoa hồng mỗi lần convert lại.
    expect(prisma.partnerReferral.updateMany.mock.calls[0][0].where).toEqual({
      id: { in: ["r1"] },
    });
    expect(prisma.customer.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "c1" },
        data: { partnerReferralId: "r1" },
      }),
    );
  });

  test("KHÔNG đánh dấu lại lượt đã chuyển đổi (tránh dồn hoa hồng)", async () => {
    prisma.partnerReferral.findMany.mockResolvedValue([]);
    prisma.partnerReferral.updateMany.mockResolvedValue({ count: 0 });

    const out = await markConverted("l1", "c1");

    expect(out.updated).toBe(0);
    expect(prisma.partnerReferral.updateMany).not.toHaveBeenCalled();
    expect(prisma.customer.update).not.toHaveBeenCalled();
  });

  test("không có customerId thì không ghi chiều ngược", async () => {
    prisma.partnerReferral.findMany.mockResolvedValue([{ id: "r1" }]);
    prisma.partnerReferral.updateMany.mockResolvedValue({ count: 1 });

    await markConverted("l1", null);

    expect(prisma.customer.update).not.toHaveBeenCalled();
  });
});