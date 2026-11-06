'use strict';

module.exports = {
  ...require('./vnSeedData'),
  ...require('./services/logistics.service'),
  // Lazy load: data/CLI consumers do not initialize auth, Prisma or Express.
  createRouter: (...args) => require('./routes/vn-supply-chain.routes')(...args),
};
