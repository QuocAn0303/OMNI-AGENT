/**
 * tests/partner-referral.service.test.js — Lượt giới thiệu của đối tác (PRM)
 *
 * Trọng tâm:
 * - Chống giới thiệu trùng: ràng buộc DB (P2002) phải ra lỗi 409 dễ hiểu, và đối tác
 *   gửi lại cùng khách thì BỎ QUA chứ không phải báo lỗi.
 * - `converted` chỉ chuyển đúng một lần, tại điểm khách thực sự mua.
 * - Phễu chuyển đổi đếm đúng 4 mốc của `CrmLeadStatus` cộng nhánh DEAD.
 */
const fs = require("fs");
const path = require("path");
const mockClient = {
  partner: { findFirst: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), groupBy: jest.fn() },
  partnerReferral: {
    create: jest.fn(),
    // `update` dùng để gắn bổ sung leadId khi lượt giới thiệu đã tồn tại từ lần
    // nhập tay. Thiếu mock này thì test báo lỗi matcher chứ không phải lỗi logic.
    update: jest.fn(),
    updateMany: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    groupBy: jest.fn(),
    count: jest.fn(),
  },
  crmLead: { findMany: jest.fn() },
  customer: { update: jest.fn() },
  tenant: { findMany: jest.fn() },
};

jest.mock("../src/config/prisma", () => mockClient);
jest.mock("../src/utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const service = require("../src/modules/partners/referral.service");

const leadFixture = (over = {}) => ({
  id: "lead-1",
  leadName: "Nguyễn Văn A",
  mobileNo: "0901234567",
  email: "a@example.com",
  ...over,
});

describe("referral.service — tạo lượt giới thiệu", () => {
  beforeEach(() => jest.clearAllMocks());

  test("tạo được và trả về mã lượt", async () => {
    mockClient.partner.findUnique.mockResolvedValue({ id: "p1" });
    mockClient.partnerReferral.findFirst.mockResolvedValue(null);
    mockClient.partnerReferral.create.mockImplementation(async ({ data }) => ({ id: "r1", ...data }));

    const out = await service.create({ partnerId: "p1", referredName: "An", referredPhone: "0901234567" });

    expect(out.referralCode).toMatch(/^RF-[0-9A-F]{10}$/);
    expect(mockClient.partnerReferral.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ partnerId: "p1", referredName: "An", converted: false }),
      }),
    );
  });

  test("trả 404 khi đối tác không tồn tại", async () => {
    mockClient.partner.findUnique.mockResolvedValue(null);

    await expect(service.create({ partnerId: "nope", referredName: "An" })).rejects.toMatchObject({
      status: 404,
    });
  });

  // Ràng buộc `@@unique([partnerId, referredPhone])` ở tầng DB là hàng phòng thủ
  // cuối; service chỉ việc đổi mã lỗi kỹ thuật thành thông điệp đọc được. Nếu để
  // lộ P2002 thì đối tác gửi form lại thấy lỗi kỹ thuật và không hiểu đã sửa gì.
  test("lỗi P2002 đổi thành 409 nói rõ nguyên nhân", async () => {
    mockClient.partner.findUnique.mockResolvedValue({ id: "p1" });
    mockClient.partnerReferral.findFirst.mockResolvedValue(null);
    mockClient.partnerReferral.create.mockRejectedValue({ code: "P2002" });

    await expect(
      service.create({ partnerId: "p1", referredName: "An", referredPhone: "0901234567" }),
    ).rejects.toMatchObject({ status: 409 });
  });

  test("lỗi khác P2002 thì ném nguyên vẹn", async () => {
    mockClient.partner.findUnique.mockResolvedValue({ id: "p1" });
    mockClient.partnerReferral.findFirst.mockResolvedValue(null);
    mockClient.partnerReferral.create.mockRejectedValue({ code: "P5000", message: "hỏng db" });

    await expect(
      service.create({ partnerId: "p1", referredName: "An" }),
    ).rejects.toMatchObject({ code: "P5000" });
  });
});

describe("referral.service — gắn lượt giới thiệu từ webhook", () => {
  beforeEach(() => jest.clearAllMocks());

  test("gắn được khi mã đối tác hợp lệ", async () => {
    mockClient.partner.findFirst.mockResolvedValue({ id: "p1", code: "ĐT-202610-0001", isActive: true });
    mockClient.partnerReferral.findFirst.mockResolvedValue(null);
    mockClient.partnerReferral.create.mockImplementation(async ({ data }) => ({ id: "r1", ...data }));

    const out = await service.attachToLead({ partnerCode: "ĐT-202610-0001", lead: leadFixture() });

    expect(out.referralCode).toMatch(/^RF-/);
    expect(mockClient.partnerReferral.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          leadId: "lead-1",
          referredName: "Nguyễn Văn A",
          sourceSnapshot: "ĐT-202610-0001",
        }),
      }),
    );
  });

  test("mã đối tác không hợp lệ thì trả null, KHÔNG ném lỗi", async () => {
    mockClient.partner.findFirst.mockResolvedValue(null);

    expect(await service.attachToLead({ partnerCode: "KHÔNG-CÓ", lead: leadFixture() })).toBeNull();
  });

  // Đối tác gửi lại cùng một khách là chuyện thường, KHÔNG phải sự cố. Báo lỗi
// sẽ khiến webhook retry vô hạn và làm nhiễu đối tác.
  test("đối tác gửi lại khách đã gắn lead rồi thì bỏ qua, không tạo bản ghi mới", async () => {
    mockClient.partner.findFirst.mockResolvedValue({ id: "p1", code: "ĐT-202610-0001" });
    // `leadId` đã có ⇒ đây mới là trùng thật. Nếu `leadId` rỗng thì dòng cũ chưa
    // từng gắn lead, và phải gắn bổ sung (xem test kế bên) — nếu không thì lượt
    // giới thiệu đó không bao giờ được đánh dấu chuyển đổi.
    mockClient.partnerReferral.findFirst.mockResolvedValue({
      id: "r-old",
      referralCode: "RF-OLD",
      converted: false,
      leadId: "l-da-co",
      customerId: null,
    });

    const out = await service.attachToLead({ partnerCode: "ĐT-202610-0001", lead: leadFixture() });

    expect(out.referralCode).toBe("RF-OLD");
    expect(mockClient.partnerReferral.create).not.toHaveBeenCalled();
    expect(mockClient.partnerReferral.update).not.toHaveBeenCalled();
  });

  test("lượt đã có nhưng CHƯA gắn lead (nhập tay rồi webhook đến) → gắn bổ sung", async () => {
    mockClient.partner.findFirst.mockResolvedValue({ id: "p1", code: "ĐT-202610-0001" });
    mockClient.partnerReferral.findFirst.mockResolvedValue({
      id: "r-old",
      referralCode: "RF-OLD",
      converted: false,
      leadId: null,
      customerId: null,
    });
    mockClient.partnerReferral.update.mockResolvedValue({
      id: "r-old",
      referralCode: "RF-OLD",
      converted: false,
      leadId: "lead-1",
      customerId: null,
    });

    const out = await service.attachToLead({ partnerCode: "ĐT-202610-0001", lead: leadFixture() });

    expect(mockClient.partnerReferral.create).not.toHaveBeenCalled();
    expect(mockClient.partnerReferral.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "r-old" },
        data: expect.objectContaining({ leadId: "lead-1" }),
      }),
    );
    expect(out.leadId).toBe("lead-1");
  });

  test("race condition (P2002) thì trả null chứ không làm hỏng webhook", async () => {
    mockClient.partner.findFirst.mockResolvedValue({ id: "p1", code: "ĐT-202610-0001" });
    mockClient.partnerReferral.findFirst.mockResolvedValue(null);
    mockClient.partnerReferral.create.mockRejectedValue({ code: "P2002" });

    expect(await service.attachToLead({ partnerCode: "ĐT-202610-0001", lead: leadFixture() })).toBeNull();
  });
});

describe("referral.service — đánh dấu chuyển đổi", () => {
  beforeEach(() => jest.clearAllMocks());

  test("đánh dấu lượt chưa chuyển đổi và gắn customerId", async () => {
    mockClient.partnerReferral.findMany.mockResolvedValue([{ id: "r1" }, { id: "r2" }]);
    mockClient.partnerReferral.updateMany.mockResolvedValue({ count: 2 });
    mockClient.customer.update.mockResolvedValue({});

    const out = await service.markConverted("lead-1", "cust-1");

    expect(out.updated).toBe(2);
    expect(mockClient.partnerReferral.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ["r1", "r2"] } },
        data: expect.objectContaining({ converted: true, customerId: "cust-1" }),
      }),
    );
  });

  test("ghi thêm partnerReferralId lên bảng khách hàng", async () => {
    mockClient.partnerReferral.findMany.mockResolvedValue([{ id: "r1" }]);
    mockClient.partnerReferral.updateMany.mockResolvedValue({ count: 1 });
    mockClient.customer.update.mockResolvedValue({});

    await service.markConverted("lead-1", "cust-1");

    expect(mockClient.customer.update).toHaveBeenCalledWith({
      where: { id: "cust-1" },
      data: { partnerReferralId: "r1" },
    });
  });

  // Truy vấn lọc `converted: false`, nên lượt đã chuyển đổi không bị chạm lần nữa và
  // `convertedAt` giữ nguyên mốc thời gian doanh nghiệp bắt đầu được hưởng hoa hồng.
  test("lượt đã chuyển đổi không bị đánh dấu lại", async () => {
    mockClient.partnerReferral.findMany.mockResolvedValue([]);

    const out = await service.markConverted("lead-1", "cust-1");

    expect(out.updated).toBe(0);
    expect(mockClient.partnerReferral.updateMany).not.toHaveBeenCalled();
  });

  test("lỗi ghi partnerReferralId không được làm hỏng luồng tạo đơn", async () => {
    mockClient.partnerReferral.findMany.mockResolvedValue([{ id: "r1" }]);
    mockClient.partnerReferral.updateMany.mockResolvedValue({ count: 1 });
    mockClient.customer.update.mockRejectedValue(new Error("cột chưa có"));

    // Không ném lỗi: đơn hàng đã tạo xong, mất nó tệ hơn là bỏ sót một cờ.
    await expect(service.markConverted("lead-1", "cust-1")).resolves.toMatchObject({ updated: 1 });
  });
});

describe("referral.service — phễu chuyển đổi", () => {
  beforeEach(() => jest.clearAllMocks());

  test("bốn mốc phễu khớp CrmLeadStatus, cộng nhánh DEAD", () => {
    // Mốc cuối là `CONVERTED`, KHÔNG phải `CUSTOMER`. `CUSTOMER` là giá trị của
    // enum khác (`LeadStatus`) và không tồn tại trong `CrmLeadStatus` — dùng sai thì
    // `stages["CUSTOMER"]` luôn undefined và cột cuối của phễu luôn bằng 0.
    expect(service.FUNNEL_STAGES).toEqual(["NEW", "CONTACTED", "QUALIFIED", "CONVERTED"]);
  });

  test("mọi mốc phễu đều là giá trị thật của enum CrmLeadStatus trong schema", () => {
    // Khoá bằng schema chứ không bằng một danh sách viết tay ở test: nếu ai đó đổi
    // enum trong prisma/schema.prisma thì test này đỏ, thay vì im lặng lệch.
    const schema = fs.readFileSync(
      path.join(__dirname, "..", "prisma", "schema.prisma"),
      "utf8",
    );
    const block = schema.match(/enum CrmLeadStatus \{([\s\S]*?)\}/);
    expect(block).not.toBeNull();
    const values = block[1]
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && l !== "}")
      .map((l) => l.replace(/\s*\/.*$/, "").trim());

    for (const stage of service.FUNNEL_STAGES) {
      expect(values).toContain(stage);
    }
    expect(values).toContain("DEAD");
  });

  test("tính tỷ lệ chuyển đổi theo đối tác", async () => {
    mockClient.partner.findMany.mockResolvedValue([
      { id: "p1", code: "ĐT-202610-0001", name: "A", type: "AFFILIATE", isActive: true },
    ]);
    mockClient.partnerReferral.groupBy.mockResolvedValue([
      { partnerId: "p1", converted: false, _count: { _all: 6 } },
      { partnerId: "p1", converted: true, _count: { _all: 4 } },
    ]);
    mockClient.crmLead.findMany.mockResolvedValue([
      { source: "ĐT-202610-0001", status: "NEW" },
      { source: "ĐT-202610-0001", status: "CONTACTED" },
      { source: "ĐT-202610-0001", status: "QUALIFIED" },
      { source: "ĐT-202610-0001", status: "CONVERTED" },
      { source: "ĐT-202610-0001", status: "DEAD" },
    ]);

    const [row] = await service.funnel();

    expect(row.referrals).toBe(10);
    expect(row.converted).toBe(4);
    expect(row.conversionRate).toBe(40);
    expect(row.dead).toBe(1);
    expect(row.funnel).toEqual([
      { stage: "NEW", count: 1 },
      { stage: "CONTACTED", count: 1 },
      { stage: "QUALIFIED", count: 1 },
      { stage: "CONVERTED", count: 1 },
    ]);
  });

  test("đối tác chưa có lượt nào vẫn ra dòng, tỷ lệ 0", async () => {
    mockClient.partner.findMany.mockResolvedValue([
      { id: "p1", code: "ĐT-202610-0001", name: "A", type: "AFFILIATE", isActive: true },
    ]);
    mockClient.partnerReferral.groupBy.mockResolvedValue([]);
    mockClient.crmLead.findMany.mockResolvedValue([]);

    const [row] = await service.funnel();

    expect(row.referrals).toBe(0);
    expect(row.conversionRate).toBe(0);
    expect(row.funnel.every((s) => s.count === 0)).toBe(true);
  });

  test("không có đối tác thì trả mảng rỗng, không lỗi", async () => {
    mockClient.partner.findMany.mockResolvedValue([]);
    mockClient.partnerReferral.groupBy.mockResolvedValue([]);
    mockClient.crmLead.findMany.mockResolvedValue([]);

    expect(await service.funnel()).toEqual([]);
  });
});