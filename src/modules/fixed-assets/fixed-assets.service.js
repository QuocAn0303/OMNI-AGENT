/**
 * modules/fixed-assets/fixed-assets.service.js — Quản lý tài sản cố định & khấu hao
 * 
 * Tổng quan:
 * - CRUD tài sản cố định (TSCĐ) + nhóm tài sản
 * - Tự động sinh lịch khấu hao theo phương pháp đường thẳng
 * - Chạy khấu hao tháng (cron), tự động post bút toán
 * - Thanh lý tài sản, tính lãi/lỗ thanh lý
 * 
 * Hàm:
 * - generateAssetCode(): Sinh mã TSCĐ tự động (TSCD-00001)
 * - createAsset(data, userId): Tạo tài sản mới + sinh lịch khấu hao + ghi audit
 * - generateSchedule(asset, category): Sinh lịch khấu hao theo tháng, period cuối hấp thụ rounding
 * - runMonthlyDepreciation(year, month, userId): Chạy khấu hao tháng, post bút toán, cập nhật accumulated
 * - disposeAsset(assetId, {disposalDate, proceedsAmount, reason}, userId): Thanh lý, tạo bút toán, ghi audit
 * - listAssets({status, categoryId, page, limit}): Danh sách TSCĐ phân trang
 * - getAsset(id): Chi tiết TSCĐ kèm lịch khấu hao
 * - listCategories(): Danh sách nhóm tài sản
 * - createCategory(data): Tạo nhóm tài sản mới
 */
// src/modules/fixed-assets/fixed-assets.service.js
// Quản lý tài sản cố định + tự động khấu hao tháng.
const prisma = require("../../config/prisma");
const journalService = require("../accounting/journal.service");
const autopostService = require("../accounting/autopost.service");
const postingErrorService = require("../accounting/posting-error.service");
const auditService = require("../audit/audit.service");

const toNum = (v) => Number(v || 0);
const round2 = (n) => Math.round(Number(n) * 100) / 100;

// Sinh mã tài sản tự động
const generateAssetCode = async () => {
  const count = await prisma.fixedAsset.count();
  return `TSCD-${String(count + 1).padStart(5, "0")}`;
};

/**
 * Tạo mới tài sản cố định + sinh lịch khấu hao.
 */
const createAsset = async (data, userId = null) => {
  const {
    name, categoryId, purchaseDate, cost, salvageValue = 0,
    lifeMonths, method = "STRAIGHT_LINE", departmentId, note, code,
  } = data;

  if (!name || !categoryId || !purchaseDate || !cost || !lifeMonths) {
    throw { status: 400, message: "Thiếu thông tin tài sản: name, categoryId, purchaseDate, cost, lifeMonths" };
  }

  const category = await prisma.fixedAssetCategory.findUnique({ where: { id: categoryId } });
  if (!category) throw { status: 404, message: "Không tìm thấy nhóm tài sản" };

  const assetCode = code || (await generateAssetCode());

  const asset = await prisma.fixedAsset.create({
    data: {
      code: assetCode,
      name, categoryId,
      purchaseDate: new Date(purchaseDate),
      cost: cost,
      salvageValue: salvageValue,
      lifeMonths: Number(lifeMonths),
      method,
      departmentId: departmentId || null,
      note: note || null,
      status: "ACTIVE",
    },
  });

  // Sinh lịch khấu hao
  await generateSchedule(asset, category);

  await auditService.log({ userId, action: "FIXED_ASSET_CREATED", entity: "FixedAsset", entityId: asset.id });

  // Tự động hạch toán mua TSCĐ (DR 211, CR 331)
  postingErrorService.tryPostOrQueue(
    () => autopostService.postAssetAcquisition({ asset, userId }),
    { source: "INVENTORY", sourceId: asset.id, payload: { operation: "ASSET_ACQUIRED" } },
  );

  return prisma.fixedAsset.findUnique({ where: { id: asset.id }, include: { category: true, depreciationSchedules: { take: 12 } } });
};

/**
 * Sinh lịch khấu hao từ kỳ mua vào.
 */
const generateSchedule = async (asset, category) => {
  const depreciable = toNum(asset.cost) - toNum(asset.salvageValue);
  if (depreciable <= 0 || asset.lifeMonths <= 0) return;

  const monthlyDepr = round2(depreciable / asset.lifeMonths);
  const start = new Date(asset.purchaseDate);

  const schedules = [];
  for (let i = 0; i < asset.lifeMonths; i++) {
    const d = new Date(start.getFullYear(), start.getMonth() + 1 + i, 1);
    const period = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    // Last period: absorb rounding difference
    const amount = i === asset.lifeMonths - 1
      ? round2(depreciable - monthlyDepr * (asset.lifeMonths - 1))
      : monthlyDepr;
    schedules.push({ assetId: asset.id, period, amount });
  }

  await prisma.depreciationSchedule.createMany({ data: schedules, skipDuplicates: true });
};

/**
 * Chạy khấu hao cho tháng hiện tại (cron tháng 28).
 * Idempotent: kiểm tra postedAt trước khi post.
 */
const runMonthlyDepreciation = async (year, month, userId = null) => {
  const period = `${year}-${String(month).padStart(2, "0")}`;

  const schedules = await prisma.depreciationSchedule.findMany({
    where: { period, postedAt: null },
    include: { asset: { include: { category: true } } },
  });

  const results = [];
  for (const sched of schedules) {
    const asset = sched.asset;
    if (asset.status !== "ACTIVE") continue;

    try {
      const entry = await journalService.postEntry({
        date: new Date(year, month - 1, 28),
        description: `Khấu hao TSCD: ${asset.name} - ${period}`,
        source: "INVENTORY",
        sourceId: asset.id,
        operation: `DEPRECIATION:${period}`,
        userId,
        lines: [
          { accountCode: asset.category.expAccountId,  debit: toNum(sched.amount), description: `Kh/h ${asset.name}` },
          { accountCode: asset.category.deprAccountId, credit: toNum(sched.amount), description: `Kh/h lũy kế ${asset.name}` },
        ],
      });

      await prisma.depreciationSchedule.update({
        where: { id: sched.id },
        data: { journalEntryId: entry.id, postedAt: new Date() },
      });

      // Cập nhật accumulated depreciation
      await prisma.fixedAsset.update({
        where: { id: asset.id },
        data: { accumulatedDepreciation: { increment: toNum(sched.amount) } },
      });

      results.push({ assetId: asset.id, assetName: asset.name, amount: sched.amount, entryId: entry.id });
    } catch (err) {
      await postingErrorService.recordError({
        source: "INVENTORY",
        sourceId: asset.id,
        payload: { operation: `DEPRECIATION:${period}`, scheduleId: sched.id },
        error: err,
      }).catch(() => {});
      results.push({ assetId: asset.id, assetName: asset.name, error: err.message });
    }
  }

  return { period, processed: schedules.length, results };
};

/**
 * Thanh lý tài sản (dispose).
 * DR 214 (accumulated depr) + DR 214 (remainder) / CR 211 (original cost) → Lãi/lỗ thanh lý.
 */
const disposeAsset = async (assetId, { disposalDate, proceedsAmount = 0, reason }, userId = null) => {
  const asset = await prisma.fixedAsset.findUnique({ where: { id: assetId }, include: { category: true } });
  if (!asset) throw { status: 404, message: "Không tìm thấy tài sản" };
  if (asset.status !== "ACTIVE") throw { status: 400, message: "Tài sản không ở trạng thái ACTIVE" };

  const cost      = toNum(asset.cost);
  const accumulated = toNum(asset.accumulatedDepreciation);
  const netBook   = round2(cost - accumulated);
  const proceeds  = toNum(proceedsAmount);
  const gainLoss  = round2(proceeds - netBook);

  const lines = [
    { accountCode: asset.category.deprAccountId, debit: accumulated, description: "Xóa khấu hao lũy kế" },
    { accountCode: asset.category.accountId, credit: cost, description: "Xóa nguyên giá TSCD" },
  ];

  if (proceeds > 0) {
    lines.push({ accountCode: "111", debit: proceeds, description: "Thu từ thanh lý TSCD" });
  }

  // 711: thu nhập khác, 811: chi phí khác
  if (gainLoss > 0) {
    lines.push({ accountCode: "711", credit: gainLoss, description: "Lãi thanh lý TSCD" });
  } else if (gainLoss < 0) {
    lines.push({ accountCode: "811", debit: -gainLoss, description: "Lỗ thanh lý TSCD" });
  }

  const entry = await journalService.postEntry({
    date: disposalDate ? new Date(disposalDate) : new Date(),
    description: `Thanh lý TSCD: ${asset.name}`,
    source: "INVENTORY",
    sourceId: assetId,
    operation: `DISPOSAL:${assetId.slice(0, 8)}`,
    userId,
    lines,
  });

  await prisma.fixedAsset.update({
    where: { id: assetId },
    data: { status: "DISPOSED" },
  });

  await auditService.log({ userId, action: "FIXED_ASSET_DISPOSED", entity: "FixedAsset", entityId: assetId });
  return { asset, entry, gainLoss };
};

const listAssets = async ({ status, categoryId, page = 1, limit = 20 } = {}) => {
  const skip = (Number(page) - 1) * Number(limit);
  const where = {};
  if (status) where.status = status;
  if (categoryId) where.categoryId = categoryId;

  const [items, total] = await Promise.all([
    prisma.fixedAsset.findMany({
      where, skip, take: Number(limit),
      orderBy: { createdAt: "desc" },
      include: { category: true },
    }),
    prisma.fixedAsset.count({ where }),
  ]);
  return { items, pagination: { page: Number(page), limit: Number(limit), total, totalPages: Math.ceil(total / Number(limit)) } };
};

const getAsset = async (id) => {
  const asset = await prisma.fixedAsset.findUnique({
    where: { id },
    include: { category: true, depreciationSchedules: { orderBy: { period: "asc" } } },
  });
  if (!asset) throw { status: 404, message: "Không tìm thấy tài sản" };
  return asset;
};

const listCategories = async () => prisma.fixedAssetCategory.findMany({ orderBy: { code: "asc" } });

const createCategory = async (data) => {
  const { code, name, accountId, deprAccountId, expAccountId, lifeMonths = 60, method = "STRAIGHT_LINE" } = data;
  if (!code || !name || !accountId || !deprAccountId || !expAccountId) {
    throw { status: 400, message: "Thiếu thông tin nhóm tài sản" };
  }
  return prisma.fixedAssetCategory.create({ data: { code, name, accountId, deprAccountId, expAccountId, lifeMonths: Number(lifeMonths), method } });
};

module.exports = {
  createAsset, listAssets, getAsset,
  runMonthlyDepreciation, disposeAsset,
  listCategories, createCategory,
};
