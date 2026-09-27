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

const getOrCreate = async () => {
  let settings = await prisma.companySettings.findFirst();
  if (!settings) {
    settings = await prisma.companySettings.create({ data: {} });
  }
  return settings;
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

module.exports = { getOrCreate, update, updateOnboardingStep, getBeginnerMode, setBeginnerMode, setBusinessTemplate, setAccountingMode };
