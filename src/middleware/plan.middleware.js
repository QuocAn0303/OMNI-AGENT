const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

const planLimits = {
  free: { warehouses: 1, products: 100, users: 2 },
  pro: { warehouses: 3, products: Infinity, users: 10 },
  enterprise: { warehouses: Infinity, products: Infinity, users: Infinity },
}

const checkPlanLimit = (resource) => async (req, res, next) => {
  try {
    if (req.user?.role === 'SUPER_ADMIN') return next()

    const tenantId = req.tenantId || req.user?.tenantId
    if (!tenantId) return next()

    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } })
    if (!tenant) return next({ status: 403, message: 'Tenant không tồn tại' })

    const limits = planLimits[tenant.plan] || planLimits.free
    const limit = limits[resource]
    if (!limit || limit === Infinity) return next()

    const modelMap = { warehouses: 'warehouse', products: 'product', users: 'user' }
    const model = modelMap[resource]
    if (!model) return next()

    const currentCount = await prisma[model].count({
      where: model === 'user' ? { tenantId } : {},
    })

    if (currentCount >= limit) {
      return next({
        status: 403,
        message: `Gói ${tenant.plan.toUpperCase()} chỉ hỗ trợ tối đa ${limit} ${resource}. Vui lòng nâng cấp.`,
      })
    }

    next()
  } catch (err) {
    next(err)
  }
}

module.exports = { checkPlanLimit, planLimits }
