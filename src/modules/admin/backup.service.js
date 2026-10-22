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

/**
 * Dò đường dẫn `pg_dump` / `pg_restore`.
 *
 * VÌ SAO CẦN: `execFile('pg_dump')` chỉ chạy được khi thư mục `bin` của PostgreSQL
 * nằm trong PATH. Trên Windows, cài PostgreSQL kiểu mặc định KHÔNG thêm `bin` vào
 * PATH → `spawn pg_dump ENOENT`. Trước đây lỗi này làm cron "Daily backup" (02:00)
 * ném lỗi mỗi đêm trên máy dev, và backup im lặng không tạo ra.
 *
 * Thứ tự dò:
 *   1. Biến môi trường `PG_DUMP_PATH` / `PG_RESTORE_PATH` (nếu admin đặt).
 *   2. Gọi tên lệnh trần — để Linux/Docker dùng bản trong PATH.
 *   3. Các thư mục cài đặt phổ biến trên Windows.
 *
 * @param {string} tool 'pg_dump' | 'pg_restore'
 * @returns {string} lệnh để truyền cho execFile
 */
const resolvePgTool = (tool) => {
  const explicitEnv = tool === 'pg_dump' ? process.env.PG_DUMP_PATH : process.env.PG_RESTORE_PATH;
  if (explicitEnv && fs.existsSync(explicitEnv)) return explicitEnv;

  const isWindows = process.platform === 'win32';
  const bin = isWindows ? '.exe' : '';
  const candidates = isWindows
    ? [
        'C:\\Program Files\\PostgreSQL\\18\\bin',
        'C:\\Program Files\\PostgreSQL\\17\\bin',
        'C:\\Program Files\\PostgreSQL\\16\\bin',
        'C:\\Program Files\\PostgreSQL\\15\\bin',
      ]
    : ['/usr/lib/postgresql/17/bin', '/usr/lib/postgresql/16/bin', '/usr/local/pgsql/bin', '/usr/bin'];
  for (const dir of candidates) {
    const full = path.join(dir, `${tool}${bin}`);
    if (fs.existsSync(full)) return full;
  }
  // Không tìm thấy → trả tên lệnh trần để phát sinh lỗi có thông báo rõ ràng.
  return tool;
};

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

  await execFileAsync(resolvePgTool('pg_dump'), [
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

  // `tenantId` truyền `null` TƯỜNG MINH: `AdminBackup` là bảng NỀN TẢNG (không có
  // `tenantId`), người chạy backup có thể là `SUPER_ADMIN` đa tenant ⇒ không thể gán
  // một tenant duy nhất mà không bịa dữ liệu. Xem ngoại lệ có điều kiện trong
  // `scripts/lib/tenant-null-exceptions.js`.
  auditService.log({ userId, tenantId: null, action: 'CREATE_BACKUP', entity: 'AdminBackup', entityId: record.id, after: { filename, sizeBytes: stats.size, encrypted: true } });
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
    await execFileAsync(resolvePgTool('pg_restore'), [
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

module.exports = { create, list, restore, resolvePgTool };
