const router = require('express').Router()
const prisma = require('../../config/prisma')
const { authenticate, authorize } = require('../../middleware/auth.middleware')
const { success } = require('../../utils/response')

router.use(authenticate, authorize('SUPER_ADMIN'))

router.get('/tenants', async (req, res, next) => {
  try {
    const tenants = await prisma.tenant.findMany({
      include: { _count: { select: { users: true } } },
      orderBy: { createdAt: 'desc' },
    })
    success(res, tenants)
  } catch (err) { next(err) }
})

router.get('/tenants/:id', async (req, res, next) => {
  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { users: true } }, users: { select: { id: true, email: true, fullName: true, role: true, isActive: true } } },
    })
    if (!tenant) return next({ status: 404, message: 'Tenant not found' })
    success(res, tenant)
  } catch (err) { next(err) }
})

router.put('/tenants/:id', async (req, res, next) => {
  try {
    const { plan, isActive } = req.body
    const data = {}
    if (plan !== undefined) data.plan = plan
    if (isActive !== undefined) data.isActive = isActive
    const tenant = await prisma.tenant.update({ where: { id: req.params.id }, data })
    success(res, tenant)
  } catch (err) { next(err) }
})

router.get('/stats', async (req, res, next) => {
  try {
    const [total, active, free, pro, enterprise] = await Promise.all([
      prisma.tenant.count(),
      prisma.tenant.count({ where: { isActive: true } }),
      prisma.tenant.count({ where: { plan: 'free' } }),
      prisma.tenant.count({ where: { plan: 'pro' } }),
      prisma.tenant.count({ where: { plan: 'enterprise' } }),
    ])
    success(res, { total, active, free, pro, enterprise })
  } catch (err) { next(err) }
})

module.exports = router
