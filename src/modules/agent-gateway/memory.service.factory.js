/**
 * modules/agent-gateway/memory.service.factory.js — lõi dịch vụ bộ nhớ (UC-007).
 *
 * Tách khỏi `memory.service.js` để unit test của `agents/` dựng được service với
 * Prisma giả in-memory, KHÔNG cần DB/backend. Production dùng đúng factory này
 * với Prisma thật (`memory.service.js`).
 *
 * Bất biến:
 * - Mọi `where` đọc memory đều có `tenantId` + phạm vi nhìn thấy + TTL + supersede.
 * - Ghi/sửa/xoá kiểm quyền TRƯỚC khi chạm DB.
 * - PII + ranh giới nghiệp vụ chạy trên create/update/import.
 * - Supersede cũ → mới trong MỘT transaction, version +1.
 */

const { randomUUID } = require('crypto');

const ApiError = require('../../utils/apiError');
const core = require('./memory-core');
const compaction = require('./memory-compaction');

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;
const MAX_CONTENT_LENGTH = 20_000;
const MAX_IMPORT_ITEMS = 200;

const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const parsePositiveInt = (value, fallback, max = Number.MAX_SAFE_INTEGER) => {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) return fallback;
  return parsed;
};

const asOptionalString = (value) => {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
};

const tenantOf = (actor = {}) => {
  const tenantId = asOptionalString(actor.tenantId);
  if (!tenantId) {
    throw new ApiError(403, 'Không xác định được tenant của người dùng', {
      code: 'MEMORY_TENANT_REQUIRED',
    });
  }
  return tenantId;
};

const requireActor = (actor = {}) => {
  const userId = asOptionalString(actor.userId);
  if (!userId) throw new ApiError(401, 'Chưa xác thực tài khoản');
  return { ...actor, userId, tenantId: tenantOf(actor) };
};

const assertPiiFree = (content) => {
  const pii = core.evaluatePii(content);
  if (pii.blocked) {
    throw new ApiError(422, 'Không được lưu dữ liệu cá nhân nhạy cảm vào bộ nhớ dài hạn', {
      code: 'PII_FORBIDDEN',
      categories: pii.categories,
      categoryLabels: pii.categoryLabels,
    });
  }
};

const assertWithinMemoryBoundary = (content) => {
  const boundary = core.evaluateBoundary(content);
  if (boundary.blocked) {
    throw new ApiError(
      422,
      'Bộ nhớ không được ghi đè quy tắc nghiệp vụ (giá, hạn mức, tồn kho, RBAC, SOP)',
      {
        code: 'MEMORY_BOUNDARY_FORBIDDEN',
        categories: boundary.categories,
        categoryLabels: boundary.categoryLabels,
      },
    );
  }
};

const assertMemoryContentSafe = (content) => {
  assertPiiFree(content);
  assertWithinMemoryBoundary(content);
};

const normalizeExpiresAt = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw new ApiError(400, 'expiresAt không hợp lệ', { code: 'MEMORY_EXPIRES_AT_INVALID' });
  }
  return date;
};

const normalizeContent = (value) => {
  const content = String(value ?? '').trim();
  if (!content) {
    throw new ApiError(400, 'content là bắt buộc', { code: 'MEMORY_CONTENT_REQUIRED' });
  }
  if (content.length > MAX_CONTENT_LENGTH) {
    throw new ApiError(400, `content vượt quá ${MAX_CONTENT_LENGTH} ký tự`, {
      code: 'MEMORY_CONTENT_TOO_LONG',
    });
  }
  return content;
};

const prepareWrite = ({ input = {}, actor = {} } = {}) => {
  const content = normalizeContent(input.content);
  assertMemoryContentSafe(content);

  const memoryKey = core.normalizeMemoryKey(input.memoryKey ?? input.topic ?? input.key);
  if (!memoryKey) {
    throw new ApiError(400, 'memoryKey là bắt buộc', { code: 'MEMORY_KEY_REQUIRED' });
  }

  const { scope, department, userId } = core.resolveScopeFields({ actor, input });
  if (!scope) {
    throw new ApiError(400, 'scope phải là company, department hoặc user', {
      code: 'MEMORY_SCOPE_INVALID',
    });
  }

  const permission = core.evaluateWritePermission({ actor, scope, department });
  if (!permission.allowed) {
    throw new ApiError(permission.status, permission.reason, { code: permission.code });
  }

  return {
    tenantId: tenantOf(actor),
    scope,
    department,
    userId,
    memoryKey,
    content,
    sourceMessageId: asOptionalString(input.sourceMessageId),
    expiresAt: normalizeExpiresAt(input.expiresAt),
    createdById: actor.userId,
  };
};

/**
 * @param {{prisma: object, now?: () => Date}} deps
 */
const createMemoryService = ({ prisma, now = () => new Date() } = {}) => {
  if (!prisma) throw new Error('createMemoryService: thiếu prisma');

  const activeWhere = (fields) => ({
    tenantId: fields.tenantId,
    scope: fields.scope,
    department: fields.department,
    userId: fields.userId,
    memoryKey: fields.memoryKey,
    supersededAt: null,
  });

  const createMemoryWithClient = async (tx, prepared) => {
    const existing = await tx.agentMemory.findFirst({
      where: activeWhere(prepared),
      orderBy: { version: 'desc' },
    });

    const nextId = randomUUID();
    const plan = core.buildSupersedePlan({ existing, nextId, now: now() });

    // Đánh dấu bản cũ TRƯỚC khi tạo bản mới: partial unique index yêu cầu đúng
    // một bản `supersededAt IS NULL` cho mỗi khoá.
    if (plan.supersede) {
      await tx.agentMemory.update({
        where: { id: plan.supersede.id },
        data: plan.supersede.data,
      });
    }

    return tx.agentMemory.create({
      data: {
        id: plan.nextId,
        tenantId: prepared.tenantId,
        scope: prepared.scope,
        department: prepared.department,
        userId: prepared.userId,
        memoryKey: prepared.memoryKey,
        content: prepared.content,
        sourceMessageId: prepared.sourceMessageId,
        createdById: prepared.createdById,
        version: plan.version,
        expiresAt: prepared.expiresAt,
      },
    });
  };

  const createMemory = async ({ input = {}, actor = {} } = {}) => {
    const authActor = requireActor(actor);
    const prepared = prepareWrite({ input, actor: authActor });
    return prisma.$transaction(
      (tx) => createMemoryWithClient(tx, prepared),
      { isolationLevel: 'Serializable' },
    );
  };

  const importMemories = async ({ items, actor = {} } = {}) => {
    const authActor = requireActor(actor);
    if (!Array.isArray(items) || items.length === 0) {
      throw new ApiError(400, 'items phải là mảng không rỗng', { code: 'MEMORY_IMPORT_EMPTY' });
    }
    if (items.length > MAX_IMPORT_ITEMS) {
      throw new ApiError(400, `Chỉ nhập tối đa ${MAX_IMPORT_ITEMS} bản ghi mỗi lần`, {
        code: 'MEMORY_IMPORT_TOO_LARGE',
      });
    }

    // Chuẩn hoá + kiểm PII/quyền cho TOÀN BỘ trước khi mở transaction. Một dòng
    // vi phạm ⇒ 422 và KHÔNG dòng nào được ghi.
    const prepared = items.map((item, index) => {
      if (!isRecord(item)) {
        throw new ApiError(400, `items[${index}] không phải object`, {
          code: 'MEMORY_IMPORT_INVALID',
        });
      }
      return prepareWrite({ input: item, actor: authActor });
    });

    const created = await prisma.$transaction(
      async (tx) => {
        const rows = [];
        for (const item of prepared) {
          rows.push(await createMemoryWithClient(tx, item));
        }
        return rows;
      },
      { isolationLevel: 'Serializable' },
    );

    return { items: created, count: created.length };
  };

  const loadContextMemories = async ({ actor = {}, query = {} } = {}) => {
    const authActor = requireActor(actor);
    const at = now();

    const where = core.buildVisibilityWhere({
      tenantId: authActor.tenantId,
      actor: authActor,
      now: at,
    });

    if (query.scope !== undefined && query.scope !== null && query.scope !== '') {
      const scope = core.normalizeScope(query.scope);
      if (!scope) {
        throw new ApiError(400, 'scope không hợp lệ', { code: 'MEMORY_SCOPE_INVALID' });
      }
      where.scope = scope;
    }

    if (query.memoryKey !== undefined && query.memoryKey !== null && query.memoryKey !== '') {
      where.memoryKey = core.normalizeMemoryKey(query.memoryKey);
    }

    const q = asOptionalString(query.q);
    if (q) where.content = { contains: q, mode: 'insensitive' };

    const page = parsePositiveInt(query.page, 1);
    const limit = parsePositiveInt(query.limit, DEFAULT_LIMIT, MAX_LIMIT);

    const [items, total] = await Promise.all([
      prisma.agentMemory.findMany({
        where,
        orderBy: [{ scope: 'asc' }, { updatedAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          scope: true,
          department: true,
          userId: true,
          memoryKey: true,
          content: true,
          version: true,
          sourceMessageId: true,
          createdById: true,
          expiresAt: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.agentMemory.count({ where }),
    ]);

    return {
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / limit),
      },
      filters: { scope: where.scope ?? null, memoryKey: where.memoryKey ?? null, q },
    };
  };

  const findMemory = async ({ id, actor }) => {
    const authActor = requireActor(actor);
    const memory = await prisma.agentMemory.findFirst({ where: { id: String(id) } });
    if (!memory) throw new ApiError(404, 'Không tìm thấy bộ nhớ', { code: 'MEMORY_NOT_FOUND' });
    if (String(memory.tenantId) !== String(authActor.tenantId)) {
      throw new ApiError(404, 'Không tìm thấy bộ nhớ', { code: 'MEMORY_NOT_FOUND' });
    }
    return memory;
  };

  const updateMemory = async ({ id, input = {}, actor = {} } = {}) => {
    const authActor = requireActor(actor);
    const existing = await findMemory({ id, actor: authActor });

    const permission = core.evaluateModifyPermission({ actor: authActor, memory: existing });
    if (!permission.allowed) {
      throw new ApiError(permission.status, permission.reason, { code: permission.code });
    }

    if (input.scope !== undefined && core.normalizeScope(input.scope) !== existing.scope) {
      throw new ApiError(400, 'Không được đổi scope của bộ nhớ', {
        code: 'MEMORY_SCOPE_IMMUTABLE',
      });
    }
    if (input.userId !== undefined && String(input.userId ?? '') !== String(existing.userId ?? '')) {
      throw new ApiError(403, 'Không được đổi chủ sở hữu bộ nhớ', {
        code: 'MEMORY_OWNER_IMMUTABLE',
      });
    }
    if (
      input.department !== undefined
      && core.normalizeCode(input.department) !== core.normalizeCode(existing.department)
    ) {
      throw new ApiError(403, 'Không được đổi phòng ban của bộ nhớ', {
        code: 'MEMORY_DEPARTMENT_IMMUTABLE',
      });
    }

    const data = {};

    if (input.content !== undefined) {
      const content = normalizeContent(input.content);
      assertMemoryContentSafe(content);
      data.content = content;
    }

    if (input.memoryKey !== undefined || input.topic !== undefined || input.key !== undefined) {
      const memoryKey = core.normalizeMemoryKey(input.memoryKey ?? input.topic ?? input.key);
      if (!memoryKey) {
        throw new ApiError(400, 'memoryKey là bắt buộc', { code: 'MEMORY_KEY_REQUIRED' });
      }
      data.memoryKey = memoryKey;
    }

    if (input.expiresAt !== undefined) data.expiresAt = normalizeExpiresAt(input.expiresAt);
    if (input.sourceMessageId !== undefined) {
      data.sourceMessageId = asOptionalString(input.sourceMessageId);
    }

    if (!Object.keys(data).length) {
      throw new ApiError(400, 'Không có trường nào để cập nhật', { code: 'MEMORY_UPDATE_EMPTY' });
    }

    if (data.memoryKey && data.memoryKey !== existing.memoryKey) {
      const conflict = await prisma.agentMemory.findFirst({
        where: {
          tenantId: authActor.tenantId,
          scope: existing.scope,
          department: existing.department ?? null,
          userId: existing.userId ?? null,
          memoryKey: data.memoryKey,
          supersededAt: null,
          id: { not: existing.id },
        },
      });
      if (conflict) {
        throw new ApiError(409, 'Đã có bộ nhớ đang hiệu lực với memoryKey này', {
          code: 'MEMORY_KEY_CONFLICT',
        });
      }
    }

    return prisma.agentMemory.update({ where: { id: existing.id }, data });
  };

  const deleteMemory = async ({ id, actor = {} } = {}) => {
    const authActor = requireActor(actor);
    const existing = await findMemory({ id, actor: authActor });

    const permission = core.evaluateModifyPermission({ actor: authActor, memory: existing });
    if (!permission.allowed) {
      throw new ApiError(permission.status, permission.reason, { code: permission.code });
    }

    await prisma.agentMemory.delete({ where: { id: existing.id } });
    return { id: existing.id, deleted: true };
  };

  const loadSession = async ({ id, actor }) => {
    const authActor = requireActor(actor);
    const session = await prisma.agentSession.findFirst({
      where: { OR: [{ id: String(id) }, { sessionCode: String(id) }] },
    });
    if (!session) {
      throw new ApiError(404, 'Không tìm thấy phiên agent', { code: 'AGENT_SESSION_NOT_FOUND' });
    }
    if (
      String(session.userId) !== String(authActor.userId)
      && !core.isPrivilegedActor(authActor)
    ) {
      throw new ApiError(403, 'Không có quyền truy cập phiên của người khác', {
        code: 'AGENT_SESSION_FORBIDDEN',
      });
    }
    if (session.tenantId && String(session.tenantId) !== String(authActor.tenantId)) {
      throw new ApiError(404, 'Không tìm thấy phiên agent', { code: 'AGENT_SESSION_NOT_FOUND' });
    }
    return session;
  };

  const collectDocIdentifiers = (payload, depth = 0) => {
    const output = {};
    if (!isRecord(payload) || depth > 2) return output;

    for (const field of ['poNumber', 'invoiceNumber', 'quoteNumber']) {
      const value = asOptionalString(payload[field]);
      if (value) output[field] = value;
    }
    for (const value of Object.values(payload)) {
      if (isRecord(value)) Object.assign(output, collectDocIdentifiers(value, depth + 1));
    }
    return output;
  };

  const collectOpenGates = async ({ sessionId }) => {
    const rows = await prisma.agentHumanGate.findMany({
      where: { sessionId, status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
    });

    return (rows || []).map((row) => ({
      gateId: row.id,
      actionType: row.actionType ?? null,
      summary: row.actionSummary ?? null,
      status: row.status ?? 'PENDING',
      ...collectDocIdentifiers(row.actionPayload),
    }));
  };

  const readCheckpoint = (session, openGates) => {
    const snapshot = isRecord(session.contextSnapshot) ? session.contextSnapshot : {};
    return {
      sessionId: session.id,
      summary: snapshot.checkpointSummary ?? null,
      updatedAt: snapshot.checkpointUpdatedAt ?? null,
      compaction: snapshot.compaction ?? null,
      openGates,
    };
  };

  const getSessionCheckpoint = async ({ id, actor = {} } = {}) => {
    const authActor = requireActor(actor);
    const session = await loadSession({ id, actor: authActor });
    const openGates = await collectOpenGates({ sessionId: session.id });
    return readCheckpoint(session, openGates);
  };

  const saveSessionCheckpoint = async ({
    id,
    summary,
    actor = {},
    expectedOpenGates = null,
  } = {}) => {
    const authActor = requireActor(actor);
    const session = await loadSession({ id, actor: authActor });
    const openGates = await collectOpenGates({ sessionId: session.id });
    const expected = compaction.mergeOpenGates(
      openGates,
      Array.isArray(expectedOpenGates) ? expectedOpenGates : [],
    );

    let validated;
    try {
      validated = compaction.assertValidCompactionSummary(summary, { openGates: expected });
    } catch (error) {
      if (error && error.code === 'COMPACTION_INCOMPLETE') {
        throw new ApiError(422, error.message, {
          code: 'COMPACTION_INCOMPLETE',
          ...error.details,
        });
      }
      throw error;
    }

    const snapshot = isRecord(session.contextSnapshot) ? { ...session.contextSnapshot } : {};
    const at = now();
    snapshot.checkpointSummary = JSON.parse(JSON.stringify(validated));
    snapshot.checkpointUpdatedAt = at.toISOString();
    snapshot.compaction = {
      sections: compaction.CHECKPOINT_SECTIONS.length,
      openGateCount: expected.length,
      validatedAt: at.toISOString(),
    };

    const updated = await prisma.agentSession.update({
      where: { id: session.id },
      data: { contextSnapshot: snapshot },
    });

    return readCheckpoint(updated ?? { ...session, contextSnapshot: snapshot }, openGates);
  };

  return {
    createMemory,
    importMemories,
    loadContextMemories,
    updateMemory,
    deleteMemory,
    getSessionCheckpoint,
    saveSessionCheckpoint,
    // Xuất để test/route dùng lại đúng luật, không dựng bản sao.
    activeWhere,
    collectOpenGates,
  };
};

module.exports = {
  createMemoryService,
  MAX_CONTENT_LENGTH,
  MAX_IMPORT_ITEMS,
  DEFAULT_LIMIT,
  MAX_LIMIT,
};
