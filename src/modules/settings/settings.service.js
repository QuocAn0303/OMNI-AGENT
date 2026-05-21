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

module.exports = { getOrCreate, update, updateOnboardingStep };
