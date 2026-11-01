/**
 * modules/agent-gateway/memory.service.js — bộ nhớ dài hạn, production binding.
 *
 * Logic nằm ở `memory.service.factory.js` (Prisma injectable). Tệp này chỉ gắn
 * Prisma thật đã được tenant-scope và re-export factory để test `agents/` dựng
 * service in-memory mà không cần DB.
 */
const prisma = require('../../config/prisma');
const {
  createMemoryService,
  MAX_CONTENT_LENGTH,
  MAX_IMPORT_ITEMS,
  DEFAULT_LIMIT,
  MAX_LIMIT,
} = require('./memory.service.factory');

const service = createMemoryService({ prisma });

module.exports = {
  ...service,
  createMemoryService,
  MAX_CONTENT_LENGTH,
  MAX_IMPORT_ITEMS,
  DEFAULT_LIMIT,
  MAX_LIMIT,
};
