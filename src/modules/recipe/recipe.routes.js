/**
 * modules/recipe/recipe.routes.js
 */

/**
 * @swagger
 * /api/recipe:
 *   get:
 *     summary: Danh sách công thức món
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: OK }
 *
 * /api/recipe/cogs:
 *   get:
 *     summary: Báo cáo giá vốn món (cost of goods sold)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: OK }
 *
 * /api/recipe/{productId}:
 *   get:
 *     summary: Chi tiết công thức cho sản phẩm
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: productId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: OK }
 *   post:
 *     summary: Tạo/cập nhật công thức (ADMIN, MANAGER)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: productId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: OK }
 *
 * /api/recipe/waste:
 *   post:
 *     summary: Ghi nhận hao hụt/đổ bỏ nguyên liệu
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Created }
 */
const router = require('express').Router();
const { authenticate, authorize } = require('../../middleware/auth.middleware');
const { sendSuccess } = require('../../utils/response');
const { upsertRecipe, logWaste } = require('./recipe.validation');
const service = require('./recipe.service');

router.use(authenticate);

router.get('/', async (req, res, next) => { try { sendSuccess(res, await service.listRecipes()); } catch (e) { next(e); } });
router.get('/cogs', async (req, res, next) => { try { sendSuccess(res, await service.getCogsReport()); } catch (e) { next(e); } });
router.get('/:productId', async (req, res, next) => { try { sendSuccess(res, await service.getRecipe(req.params.productId)); } catch (e) { next(e); } });
router.post('/:productId', authorize('ADMIN', 'MANAGER'), async (req, res, next) => {
  try { sendSuccess(res, await service.upsertRecipe(req.params.productId, upsertRecipe.parse(req.body), req.user.id), 'Lưu recipe thành công'); } catch (e) { next(e); }
});
router.post('/waste', async (req, res, next) => {
  try { sendSuccess(res, await service.logWaste({ ...logWaste.parse(req.body), userId: req.user.id }), null, 201); } catch (e) { next(e); }
});

module.exports = router;
