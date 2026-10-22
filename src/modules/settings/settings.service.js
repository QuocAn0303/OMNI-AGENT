/**
 * modules/settings/settings.service.js — Cài đặt công ty
 * 
 * Tổng quan:
 * - Quản lý thông tin công ty (tên, địa chỉ, SĐT, email, mã số thuế, logo, ngành, tiền tệ)
 * - Tự động tạo settings nếu chưa tồn tại
 * - Quản lý tiến trình onboarding
 * 
 * Hàm:
 * - getOrCreate(): Lấy thông tin công ty, tự động tạo nếu chưa có
 * - update(data): Cập nhật thông tin công ty
 * - updateOnboardingStep(step, done): Cập nhật bước onboarding, đánh dấu hoàn thành nếu cần
 */
const prisma = require('../../config/prisma');

/**
 * Ngưỡng duyệt tài chính mặc định khi tenant chưa cấu hình.
 *
 * Dùng khi dòng settings thiếu, hoặc `poApprovalThreshold` để NULL — phải trả
 * về con số, không ném lỗi, vì luồng tạo PO không được chết vì thiếu cấu hình.
 */
const DEFAULT_PO_APPROVAL_THRESHOLD = 5_000_000;

/**
 * Đọc CÀI ĐẶT của tenant.
 *
 * `orderBy` là BẮT BUỘC, không phải cho đẹp: bảng này thiết kế 1-1 nhưng **chưa
 * có ràng buộc UNIQUE(tenantId)** (backlog), và đã có 36 dòng cho một tenant trên
 * DB phát triển. `findFirst()` không có `orderBy` thì trả về một dòng tuỳ ý theo
 * thứ tự vật lý ⇒ hành vi luồng duyệt PO phụ thuộc vào thứ tự heap.
 *
 * Chọn dòng **tạo sớm nhất** là dòng gốc của tenant nên đó là dòng mang cấu
 * hình thật; các dòng sinh sau là rác.
 *
 * `orderBy` có HAI khoá, không phải một: `createdAt` rồi `id`. Nếu chỉ
 * `createdAt`, hai dòng tạo trong cùng một mili-giây sẽ bị sắp xếp tuỳ ý và
 * `findCanonical` có thể trả về hai kết quả khác nhau ở hai lần gọi khác nhau —
 * tức lại quay về trạng thái không xác định mà bản vá này sinh ra để chữa.
 */
const CANONICAL_ORDER = [{ createdAt: 'asc' }, { id: 'asc' }];

const findCanonical = async (client = prisma) =>
  client.companySettings.findFirst({
    where: { tenantId: client.tenantId ?? undefined },
    orderBy: CANONICAL_ORDER,
  });

/**
 * Lấy settings, tự tạo nếu chưa có.
 *
 * `findFirst` → `create` là mẫu **race read-then-write**: hai request song song
 * (hoặc hai tiến trình) cùng thấy chưa có rồi cùng tạo. Không có UNIQUE nên
 * cả hai thành công, và từ đó `findFirst()` trả về dòng nào là tuỳ ý — tức hành
 * vi nghiệp vụ (đặc biệt là ngưỡng duyệt PO) trở nên không xác định. **Đây là
 * lỗi xảy ra được ở mã chạy thật, không chỉ ở test.**
 *
 * Không sửa được bằng migration ở Vòng 2 (thêm UNIQUE lúc này sẽ thất bại trên
 * môi trường đang có dữ liệu trùng), nên ở đây làm **hội tụ về đúng một dòng**:
 * sau khi tạo, đọc lại theo thứ tự chuẩn; nếu dòng vừa tạo không phải dòng gốc
 * thì xoá dòng vừa tạo đi. Lệnh gọi sau đó luôn thấy đúng một dòng.
 */
const getOrCreate = async () => {
  const existing = await findCanonical();
  if (existing) return existing;

  const created = await prisma.companySettings.create({ data: {} });

  const canonical = await findCanonical();
  if (canonical && canonical.id !== created.id) {
    await prisma.companySettings.delete({ where: { id: created.id } }).catch((e) => {
      // Xoá dòng thừa thất bại không được làm sập luồng đọc settings; ghi log
      // để người vận hành biết còn dư dòng.
      const logger = require('../../utils/logger');
      logger.error(`[settings] tạo trùng company_settings (id=${created.id}), xoá dòng thừa thất bại: ${e.message}`);
    });
    return canonical;
  }
  return created;
};

/**
 * Ngưỡng duyệt PO của tenant: số đọc từ cấu hình, thiếu thì dùng mặc định.
 * Luôn trả về số — không ném lỗi.
 */
const getPoApprovalThreshold = async () => {
  try {
    const settings = await findCanonical();
    const v = settings?.poApprovalThreshold;
    const n = Number(v);
    if (v !== null && v !== undefined && v !== '' && Number.isFinite(n) && n > 0) return n;
  } catch (e) {
    // Không nuốt lỗi: ghi log rồi dùng mặc định, để vẫn đọc được settings.
    const logger = require('../../utils/logger');
    logger.warn(`[settings] đọc poApprovalThreshold lỗi, dùng mặc định: ${e.message}`);
  }
  return DEFAULT_PO_APPROVAL_THRESHOLD;
};

const update = async (data) => {
  const settings = await getOrCreate();
  return prisma.companySettings.update({
    where: { id: settings.id },
    data,
  });
};

const updateOnboardingStep = async (step, done = false) => {
  const settings = await getOrCreate();
  return prisma.companySettings.update({
    where: { id: settings.id },
    data: {
      onboardingStep: step,
      ...(done && { onboardingDone: true }),
    },
  });
};

const getBeginnerMode = async () => {
  const settings = await getOrCreate();
  return settings.beginnerMode;
};

const setBeginnerMode = async (enabled) => {
  const settings = await getOrCreate();
  return prisma.companySettings.update({
    where: { id: settings.id },
    data: { beginnerMode: enabled },
  });
};

const setBusinessTemplate = async (template) => {
  const settings = await getOrCreate();
  return prisma.companySettings.update({
    where: { id: settings.id },
    data: { businessTemplate: template },
  });
};

// Phase 11: HKD mode (SIMPLIFIED_HKD = ẩn kế toán double-entry, chỉ Thu/Chi)
const setAccountingMode = async (mode) => {
  const settings = await getOrCreate();
  return prisma.companySettings.update({
    where: { id: settings.id },
    data: { accountingMode: mode },
  });
};

module.exports = {
  getOrCreate,
  update,
  updateOnboardingStep,
  getBeginnerMode,
  setBeginnerMode,
  setBusinessTemplate,
  setAccountingMode,
  findCanonical,
  getPoApprovalThreshold,
  DEFAULT_PO_APPROVAL_THRESHOLD,
};
