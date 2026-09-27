const { execFile } = require('child_process');
const util = require('util');
const fs = require('fs');
const path = require('path');
const prisma = require('../../config/prisma');
const auditService = require('../audit/audit.service');
const logger = require('../../utils/logger');
const { encryptFile, decryptFile } = require('../../utils/crypto');

const execFileAsync = util.promisify(execFile);
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(process.cwd(), 'backups');

const ensureDir = () => {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
};

// Security: backup file được mã hóa AES-256-GCM (dùng ENCRYPTION_KEY — xem utils/crypto.js)
const create = async (userId) => {
  ensureDir();
  const filename = `erp_backup_${Date.now()}.dump.enc`;
  const filepath = path.join(BACKUP_DIR, filename);
  const plainPath = filepath.replace(/\.enc$/, '');
  const dbUrl = new URL(process.env.DATABASE_URL);
  const dbName = dbUrl.pathname.replace('/', '');

  await execFileAsync('pg_dump', [
    '-h', dbUrl.hostname,
    '-p', dbUrl.port || '5432',
    '-U', dbUrl.username,
    '-F', 'c',
    '-f', plainPath,
    dbName,
  ], { env: { ...process.env, PGPASSWORD: dbUrl.password } });

  try {
    await encryptFile(plainPath, filepath);
  } finally {
    // Luôn xóa bản dump chưa mã hóa sau khi mã hóa (kể cả khi mã hóa thất bại)
    fs.promises.unlink(plainPath).catch(() => {});
  }

  const stats = fs.statSync(filepath);
  const record = await prisma.adminBackup.create({
    data: {
      filename,
      filepath,
      sizeBytes: stats.size,
      createdById: userId,
    },
  });

  auditService.log({ userId, action: 'CREATE_BACKUP', entity: 'AdminBackup', entityId: record.id, after: { filename, sizeBytes: stats.size, encrypted: true } });
  return record;
};

const list = async () => {
  return prisma.adminBackup.findMany({ orderBy: { createdAt: 'desc' } });
};

const restore = async (id, userId) => {
  const backup = await prisma.adminBackup.findUnique({ where: { id } });
  if (!backup) throw { status: 404, message: 'Không tìm thấy bản backup' };
  if (!fs.existsSync(backup.filepath)) throw { status: 400, message: 'File backup không tồn tại trên ổ đĩa' };

  const dbUrl = new URL(process.env.DATABASE_URL);
  const dbName = dbUrl.pathname.replace('/', '');

  // Giải mã (streaming) sang file tạm nếu là backup đã mã hóa; giữ nguyên nếu là file cũ chưa mã hóa
  const plainPath = backup.filepath.endsWith('.enc')
    ? backup.filepath.replace(/\.enc$/, `.restore_${Date.now()}.tmp`)
    : backup.filepath;
  let tmpCreated = false;
  if (backup.filepath.endsWith('.enc')) {
    await decryptFile(backup.filepath, plainPath);
    tmpCreated = true;
  }

  try {
    await execFileAsync('pg_restore', [
      '-h', dbUrl.hostname,
      '-p', dbUrl.port || '5432',
      '-U', dbUrl.username,
      '-d', dbName,
      '--clean',
      '--if-exists',
      plainPath,
    ], { env: { ...process.env, PGPASSWORD: dbUrl.password } });

    auditService.log({ userId, action: 'RESTORE_BACKUP', entity: 'AdminBackup', entityId: id, before: { filename: backup.filename } });
    return { message: 'Khôi phục thành công' };
  } finally {
    // Xóa file dump tạm đã giải mã ngay sau khi restore (không để plaintext tồn tại trên đĩa)
    if (tmpCreated) fs.promises.unlink(plainPath).catch(() => {});
  }
};

module.exports = { create, list, restore };
