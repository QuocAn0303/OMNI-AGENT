/**
 * modules/stamp-card/stamp-card.routes.js
 */

/**
 * @swagger
 * /api/stamp-card/templates:
 *   get:
 *     summary: Danh sách mẫu thẻ tích điểm
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: OK }
 *   post:
 *     summary: Tạo mẫu thẻ tích điểm (ADMIN, MANAGER)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Created }
 *
 * /api/stamp-card/customers/{customerId}:
 *   get:
 *     summary: Danh sách thẻ tích điểm của khách hàng
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: customerId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: OK }
 *
 * /api/stamp-card/{id}/redeem:
 *   post:
 *     summary: Đổi thưởng thẻ tích điểm
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: OK }
 */
const router = require('express').Router();
const { authenticate, authorize } = require('../../middleware/auth.middleware');
const { sendSuccess } = require('../../utils/response');
const service = require('./stamp-card.service');
const { createTemplate } = require('./stamp-card.validation');

router.use(authenticate);

router.get('/templates', async (req, res, next) => { try { sendSuccess(res, await service.listTemplates()); } catch (e) { next(e); } });
router.post('/templates', authorize('ADMIN', 'MANAGER'), async (req, res, next) => { try { sendSuccess(res, await service.createTemplate(createTemplate.parse(req.body), req.user.id), null, 201); } catch (e) { next(e); } });
router.patch('/templates/:id', authorize('ADMIN', 'MANAGER'), async (req, res, next) => { try { sendSuccess(res, await service.updateTemplate(req.params.id, createTemplate.partial().parse(req.body), req.user.id)); } catch (e) { next(e); } });
router.get('/customers/:customerId', async (req, res, next) => { try { sendSuccess(res, await service.getCustomerCards(req.params.customerId)); } catch (e) { next(e); } });
router.post('/:id/redeem', async (req, res, next) => { try { sendSuccess(res, await service.redeem(req.params.id, req.user.id), 'Đổi thưởng thành công'); } catch (e) { next(e); } });

module.exports = router;
