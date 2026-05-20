const express = require('express');
const multer = require('multer');
const { authenticate, authorize } = require('../../middleware/auth.middleware');
const settingsService = require('./settings.service');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// GET /api/settings
router.get('/', authenticate, async (req, res, next) => {
  try {
    const settings = await settingsService.getOrCreate();
    res.json({ success: true, data: settings });
  } catch (err) { next(err); }
});

// PUT /api/settings
router.put('/', authenticate, authorize('ADMIN'), async (req, res, next) => {
  try {
    const allowed = ['name', 'address', 'phone', 'email', 'taxCode', 'logo', 'industry', 'currency'];
    const data = Object.fromEntries(
      Object.entries(req.body).filter(([k]) => allowed.includes(k))
    );
    const settings = await settingsService.update(data);
    res.json({ success: true, data: settings });
  } catch (err) { next(err); }
});

// PUT /api/settings/onboarding
router.put('/onboarding', authenticate, authorize('ADMIN'), async (req, res, next) => {
  try {
    const { step, done } = req.body;
    const settings = await settingsService.updateOnboardingStep(Number(step), !!done);
    res.json({ success: true, data: settings });
  } catch (err) { next(err); }
});

module.exports = router;
