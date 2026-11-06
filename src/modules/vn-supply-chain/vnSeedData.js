'use strict';

const path = require('node:path');
const { createCatalog } = require('./data/catalog');
const { generateTwoMonthOperationsLog } = require('./services/operations.service');
const { auditInventory } = require('./services/inventory-audit.service');
const { saveSnapshot } = require('./data/snapshot.repository');

function buildVnSeedData(options = {}) {
  const catalog = createCatalog();
  const operations = generateTwoMonthOperationsLog(options);
  const audit = auditInventory(catalog, operations);
  return { catalog, operations, audit };
}

function seedVnSupplyChain(options = {}, directory = path.join(__dirname, 'data', 'generated')) {
  const dataset = buildVnSeedData(options);
  return { ...saveSnapshot(directory, dataset), dataset };
}

if (require.main === module) {
  try {
    if (process.argv.length > 2) throw new Error('CLI dùng cấu hình mặc định; dùng API JS để truyền startDate/seed');
    const result = seedVnSupplyChain();
    process.stdout.write(JSON.stringify({ filePath: result.filePath, changed: result.changed, audit: result.dataset.audit }) + '\n');
  } catch (error) {
    process.stderr.write(error.message + '\n');
    process.exitCode = 1;
  }
}
module.exports = { buildVnSeedData, seedVnSupplyChain, createCatalog, generateTwoMonthOperationsLog, auditInventory };
