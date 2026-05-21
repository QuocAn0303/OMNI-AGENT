const tenantMiddleware = (req, res, next) => {
  if (req.user?.role === 'SUPER_ADMIN') {
    return next()
  }

  const tenantId = req.user?.tenantId
  if (!tenantId) {
    return next({ status: 403, message: 'Tenant not found' })
  }

  req.tenantId = tenantId
  next()
}

module.exports = { tenantMiddleware }
