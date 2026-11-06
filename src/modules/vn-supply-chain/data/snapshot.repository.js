'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { z } = require('zod');

/** One atomic snapshot replaces the entire demo scenario; no append or live DB writes. */
function saveSnapshot(directory, dataset) {
  z.string().min(1).refine(value => !value.includes('\0'), 'Đường dẫn không hợp lệ').parse(directory);
  const serialized = JSON.stringify(dataset, null, 2) + '\n';
  const root = path.resolve(directory);
  fs.mkdirSync(root, { recursive: true });
  const filePath = path.join(root, 'vn-seed.json');
  const lockPath = path.join(root, '.vn-seed.lock');
  // Exclusive creation prevents competing writers; a stale lock is reported, never stolen.
  const lock = fs.openSync(lockPath, 'wx');
  const temporaryPath = path.join(root, '.vn-seed-' + crypto.randomUUID() + '.tmp');
  try {
    if (fs.existsSync(filePath) && fs.readFileSync(filePath, 'utf8') === serialized) {
      return { changed: false, filePath };
    }
    const temporary = fs.openSync(temporaryPath, 'wx');
    try {
      fs.writeFileSync(temporary, serialized, 'utf8');
      fs.fsyncSync(temporary);
    } finally {
      fs.closeSync(temporary);
    }
    fs.renameSync(temporaryPath, filePath);
    return { changed: true, filePath };
  } finally {
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
    fs.closeSync(lock);
    fs.unlinkSync(lockPath);
  }
}
module.exports = { saveSnapshot };
