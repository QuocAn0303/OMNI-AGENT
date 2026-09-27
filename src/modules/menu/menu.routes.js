/**
 * modules/menu/menu.routes.js — Routes cho menu F&B (modifier, variant, combo, happy hour)
 *
 * Routes:
 * - GET/POST /api/menu/modifier-groups
 * - PATCH/DELETE /api/menu/modifier-groups/:id
 * - POST /api/menu/modifier-groups/:id/options
 * - PATCH/DELETE /api/menu/modifier-options/:id
 * - GET/POST /api/menu/variants
 * - PATCH/DELETE /api/menu/variants/:id
 * - GET/POST /api/menu/combos
 * - GET/PATCH/DELETE /api/menu/combos/:id
 * - GET/POST /api/menu/happy-hours
 * - PATCH/DELETE /api/menu/happy-hours/:id
 */

/**
 * @swagger
 * /api/menu/modifier-groups:
 *   get:
 *     summary: Danh sách nhóm modifier (tuỳ chọn cho sản phẩm)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: productId
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: OK }
 *   post:
 *     summary: Tạo nhóm modifier (ADMIN, MANAGER)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Created }
 *
 * /api/menu/modifier-groups/{id}:
 *   patch:
 *     summary: Cập nhật nhóm modifier (ADMIN, MANAGER)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: OK }
 *   delete:
 *     summary: Xoá nhóm modifier (ADMIN, MANAGER)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: OK }
 *
 * /api/menu/modifier-groups/{id}/options:
 *   post:
 *     summary: Tạo tuỳ chọn thuộc nhóm modifier (ADMIN, MANAGER)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       201: { description: Created }
 *
 * /api/menu/modifier-options/{id}:
 *   patch:
 *     summary: Cập nhật tuỳ chọn (ADMIN, MANAGER)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: OK }
 *   delete:
 *     summary: Xoá tuỳ chọn (ADMIN, MANAGER)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: OK }
 *
 * /api/menu/variants:
 *   get:
 *     summary: Danh sách biến thể sản phẩm
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: productId
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: OK }
 *   post:
 *     summary: Tạo biến thể (ADMIN, MANAGER)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Created }
 *
 * /api/menu/variants/{id}:
 *   patch:
 *     summary: Cập nhật biến thể (ADMIN, MANAGER)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: OK }
 *   delete:
 *     summary: Xoá biến thể (ADMIN, MANAGER)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: OK }
 *
 * /api/menu/combos:
 *   get:
 *     summary: Danh sách combo
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: OK }
 *   post:
 *     summary: Tạo combo (ADMIN, MANAGER)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Created }
 *
 * /api/menu/combos/{id}:
 *   get:
 *     summary: Chi tiết combo
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: OK }
 *   patch:
 *     summary: Cập nhật combo (ADMIN, MANAGER)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: OK }
 *   delete:
 *     summary: Xoá combo (ADMIN, MANAGER)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: OK }
 *
 * /api/menu/happy-hours:
 *   get:
 *     summary: Danh sách khuyến mãi giờ vàng
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: OK }
 *   post:
 *     summary: Tạo khuyến mãi giờ vàng (ADMIN, MANAGER)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Created }
 *
 * /api/menu/happy-hours/{id}:
 *   patch:
 *     summary: Cập nhật khuyến mãi giờ vàng (ADMIN, MANAGER)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: OK }
 *   delete:
 *     summary: Xoá khuyến mãi giờ vàng (ADMIN, MANAGER)
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
const service = require('./menu.service');
const v = require('./menu.validation');

router.use(authenticate);

// ----- MODIFIER GROUPS -----
router.get('/modifier-groups', async (req, res, next) => {
  try { sendSuccess(res, await service.listModifierGroups(req.query.productId)); }
  catch (e) { next(e); }
});
router.post('/modifier-groups', authorize('ADMIN', 'MANAGER'), async (req, res, next) => {
  try { sendSuccess(res, await service.createModifierGroup(v.modifierGroupCreate.parse(req.body), req.user.id), 'Tạo nhóm modifier thành công', 201); }
  catch (e) { next(e); }
});
router.patch('/modifier-groups/:id', authorize('ADMIN', 'MANAGER'), async (req, res, next) => {
  try { sendSuccess(res, await service.updateModifierGroup(req.params.id, v.modifierGroupUpdate.parse(req.body), req.user.id)); }
  catch (e) { next(e); }
});
router.delete('/modifier-groups/:id', authorize('ADMIN', 'MANAGER'), async (req, res, next) => {
  try { sendSuccess(res, await service.deleteModifierGroup(req.params.id, req.user.id)); }
  catch (e) { next(e); }
});

// ----- MODIFIER OPTIONS -----
router.post('/modifier-groups/:id/options', authorize('ADMIN', 'MANAGER'), async (req, res, next) => {
  try { sendSuccess(res, await service.createModifierOption(req.params.id, v.modifierOptionCreate.parse(req.body), req.user.id), 'Tạo tùy chọn thành công', 201); }
  catch (e) { next(e); }
});
router.patch('/modifier-options/:id', authorize('ADMIN', 'MANAGER'), async (req, res, next) => {
  try { sendSuccess(res, await service.updateModifierOption(req.params.id, v.modifierOptionUpdate.parse(req.body), req.user.id)); }
  catch (e) { next(e); }
});
router.delete('/modifier-options/:id', authorize('ADMIN', 'MANAGER'), async (req, res, next) => {
  try { sendSuccess(res, await service.deleteModifierOption(req.params.id, req.user.id)); }
  catch (e) { next(e); }
});

// ----- VARIANTS -----
router.get('/variants', async (req, res, next) => {
  try { sendSuccess(res, await service.listVariants(req.query.productId)); }
  catch (e) { next(e); }
});
router.post('/variants', authorize('ADMIN', 'MANAGER'), async (req, res, next) => {
  try {
    const parsed = v.variantCreate.parse(req.body);
    sendSuccess(res, await service.createVariant(parsed.productId, parsed, req.user.id), 'Tạo biến thể thành công', 201);
  } catch (e) { next(e); }
});
router.patch('/variants/:id', authorize('ADMIN', 'MANAGER'), async (req, res, next) => {
  try { sendSuccess(res, await service.updateVariant(req.params.id, v.variantUpdate.parse(req.body), req.user.id)); }
  catch (e) { next(e); }
});
router.delete('/variants/:id', authorize('ADMIN', 'MANAGER'), async (req, res, next) => {
  try { sendSuccess(res, await service.deleteVariant(req.params.id, req.user.id)); }
  catch (e) { next(e); }
});

// ----- COMBOS -----
router.get('/combos', async (req, res, next) => {
  try { sendSuccess(res, await service.listCombos()); }
  catch (e) { next(e); }
});
router.post('/combos', authorize('ADMIN', 'MANAGER'), async (req, res, next) => {
  try { sendSuccess(res, await service.createCombo(v.comboCreate.parse(req.body), req.user.id), 'Tạo combo thành công', 201); }
  catch (e) { next(e); }
});
router.get('/combos/:id', async (req, res, next) => {
  try { sendSuccess(res, await service.getCombo(req.params.id)); }
  catch (e) { next(e); }
});
router.patch('/combos/:id', authorize('ADMIN', 'MANAGER'), async (req, res, next) => {
  try { sendSuccess(res, await service.updateCombo(req.params.id, v.comboUpdate.parse(req.body), req.user.id)); }
  catch (e) { next(e); }
});
router.delete('/combos/:id', authorize('ADMIN', 'MANAGER'), async (req, res, next) => {
  try { sendSuccess(res, await service.deleteCombo(req.params.id, req.user.id)); }
  catch (e) { next(e); }
});

// ----- HAPPY HOURS -----
router.get('/happy-hours', async (req, res, next) => {
  try { sendSuccess(res, await service.listHappyHours()); }
  catch (e) { next(e); }
});
router.post('/happy-hours', authorize('ADMIN', 'MANAGER'), async (req, res, next) => {
  try { sendSuccess(res, await service.createHappyHour(v.happyHourCreate.parse(req.body), req.user.id), 'Tạo khuyến mãi giờ vàng thành công', 201); }
  catch (e) { next(e); }
});
router.patch('/happy-hours/:id', authorize('ADMIN', 'MANAGER'), async (req, res, next) => {
  try { sendSuccess(res, await service.updateHappyHour(req.params.id, v.happyHourUpdate.parse(req.body), req.user.id)); }
  catch (e) { next(e); }
});
router.delete('/happy-hours/:id', authorize('ADMIN', 'MANAGER'), async (req, res, next) => {
  try { sendSuccess(res, await service.deleteHappyHour(req.params.id, req.user.id)); }
  catch (e) { next(e); }
});

module.exports = router;
