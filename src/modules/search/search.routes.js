const router = require('express').Router();
const { authenticate } = require('../../middleware/auth.middleware');
const { sendSuccess } = require('../../utils/response');
const prisma = require('../../config/prisma');

router.get('/', authenticate, async (req, res, next) => {
  try {
    const { q } = req.query;
    if (!q || q.length < 2) return sendSuccess(res, { products: [], orders: [], customers: [] });

    const [products, orders, customers] = await Promise.all([
      prisma.product.findMany({
        where: { isActive: true, OR: [{ name: { contains: q } }, { sku: { contains: q } }] },
        select: { id: true, name: true, sku: true, price: true },
        take: 5,
      }),
      prisma.order.findMany({
        where: { orderCode: { contains: q } },
        select: { id: true, orderCode: true, total: true, status: true },
        take: 5,
      }),
      prisma.customer.findMany({
        where: { OR: [{ name: { contains: q } }, { phone: { contains: q } }, { email: { contains: q } }] },
        select: { id: true, name: true, phone: true, email: true },
        take: 5,
      }),
    ]);

    sendSuccess(res, { products, orders, customers });
  } catch (e) { next(e); }
});

module.exports = router;
