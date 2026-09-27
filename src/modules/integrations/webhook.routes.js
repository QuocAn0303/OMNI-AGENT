const router = require('express').Router();
const { authenticate, authorize } = require('../../middleware/auth.middleware');
const { sendSuccess } = require('../../utils/response');
const prisma = require('../../config/prisma');
const { z } = require('zod');
const { encrypt } = require('../../utils/crypto');

router.use(authenticate);

// GET /api/webhooks — list endpoints
router.get('/', async (req, res, next) => {
  try {
    const endpoints = await prisma.webhookEndpoint.findMany({
      where: { tenantId: req.user.tenantId },
      orderBy: { createdAt: 'desc' },
    });
    sendSuccess(res, endpoints);
  } catch (e) { next(e); }
});

// POST /api/webhooks — create endpoint
const createSchema = z.object({
  url: z.string().url(),
  secret: z.string().min(8),
  events: z.array(z.string()).min(1),
});
router.post('/', authorize('ADMIN', 'MANAGER'), async (req, res, next) => {
  try {
    const data = createSchema.parse(req.body);
    const enc = encrypt(data.secret);
    const ep = await prisma.webhookEndpoint.create({
      data: { ...data, secret: enc.valueEnc, secretIv: enc.iv, tenantId: req.user.tenantId },
    });
    const { secret: _, secretIv: __, ...safe } = ep;
    sendSuccess(res, safe, 'Tạo webhook thành công');
  } catch (e) { next(e); }
});

// PATCH /api/webhooks/:id — update
router.patch('/:id', authorize('ADMIN', 'MANAGER'), async (req, res, next) => {
  try {
    const ep = await prisma.webhookEndpoint.findFirst({ where: { id: req.params.id, tenantId: req.user.tenantId } });
    if (!ep) throw { status: 404, message: 'Không tìm thấy webhook' };
    const patchData = {};
    if (req.body.url) patchData.url = req.body.url;
    if (req.body.events) patchData.events = req.body.events;
    if (req.body.secret) {
      const enc = encrypt(req.body.secret);
      patchData.secret = enc.valueEnc;
      patchData.secretIv = enc.iv;
    }
    const updated = await prisma.webhookEndpoint.update({
      where: { id: req.params.id },
      data: patchData,
    });
    const { secret: _, secretIv: __, ...safe } = updated;
    sendSuccess(res, safe, 'Cập nhật thành công');
  } catch (e) { next(e); }
});

// DELETE /api/webhooks/:id
router.delete('/:id', authorize('ADMIN', 'MANAGER'), async (req, res, next) => {
  try {
    await prisma.webhookEndpoint.updateMany({
      where: { id: req.params.id, tenantId: req.user.tenantId },
      data: { isActive: false },
    });
    sendSuccess(res, null, 'Đã xóa webhook');
  } catch (e) { next(e); }
});

module.exports = router;
