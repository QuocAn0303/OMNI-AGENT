/**
 * orchestrator/checkpointer.ts — Nơi lưu checkpoint của đồ thị.
 *
 * ============================================================================
 * VÌ SAO `thread_id` PHẢI GHÉP tenantId
 * ============================================================================
 * Checkpoint chứa TOÀN BỘ trạng thái run: câu hỏi, actor, kết quả từng agent.
 * Nếu hai tenant dùng chung `runId` mà `thread_id` chỉ là `runId`, tenant B đọc
 * được trạng thái của tenant A qua `Command({ resume })`. Vì vậy `threadConfig`
 * là ĐƯỜNG DUY NHẤT được phép dựng config, và luôn ghép
 * `${tenantId}:${runId}`.
 *
 * Dev/unit test: `MemorySaver` (mất khi process chết — đúng ý đồ).
 * Production: `USE_PG_CHECKPOINTER=1` → `PostgresSaver` (schema riêng
 * `agent_checkpoints`), để run sống qua restart và resume được từ instance khác.
 *
 * Package này KHÔNG dùng Prisma; `pg` chỉ xuất hiện ở tệp này, chỉ để chứa
 * checkpoint — không có đường nào đọc bảng nghiệp vụ.
 */
import { MemorySaver, type BaseCheckpointSaver } from '@langchain/langgraph';

import type { AuthContext } from '../contracts/types';

export type CheckpointerKind = 'memory' | 'postgres';

export interface CheckpointerHandle {
  saver: BaseCheckpointSaver;
  kind: CheckpointerKind;
  /** Tạo bảng/schema cần thiết (MemorySaver: no-op). */
  setup: () => Promise<void>;
  /** Đóng kết nối (MemorySaver: no-op). */
  close: () => Promise<void>;
}

export interface CreateCheckpointerOptions {
  preferPostgres?: boolean;
  connectionString?: string;
  schema?: string;
}

/** Tên schema phải là định danh SQL hợp lệ — nó được nội suy vào `search_path`. */
const SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const DEFAULT_CHECKPOINT_SCHEMA = 'agent_checkpoints';

/**
 * Checkpoint mặc định cho dev/unit test/eval.
 *
 * `USE_PG_CHECKPOINTER=1` mới dùng Postgres; thiếu `pg` hoặc
 * `@langchain/langgraph-checkpoint-postgres` thì NÉM ngay lúc tạo (không âm thầm
 * rơi về memory — rơi ngầm sẽ khiến resume "mất trí" trong production).
 */
export const createCheckpointer = async (
  options: CreateCheckpointerOptions = {},
): Promise<CheckpointerHandle> => {
  const env = process.env;
  const usePostgres = options.preferPostgres ?? env.USE_PG_CHECKPOINTER === '1';

  if (!usePostgres) {
    return {
      saver: new MemorySaver(),
      kind: 'memory',
      setup: async () => undefined,
      close: async () => undefined,
    };
  }

  const schema = options.schema || env.AGENT_CHECKPOINT_SCHEMA || DEFAULT_CHECKPOINT_SCHEMA;
  if (!SAFE_IDENTIFIER.test(schema)) {
    throw new Error(`AGENT_CHECKPOINT_SCHEMA không hợp lệ: ${schema}`);
  }

  const connectionString =
    options.connectionString || env.AGENT_CHECKPOINT_DATABASE_URL || env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('USE_PG_CHECKPOINTER=1 nhưng thiếu DATABASE_URL để mở checkpoint store');
  }

  // `require` động: hai gói này là tuỳ chọn, chỉ cần khi bật Postgres.
  let checkpointModule: {
    PostgresSaver: new (pool: unknown, config?: { schema?: string }) => BaseCheckpointSaver & {
      setup?: () => Promise<void>;
    };
  };
  let pgModule: { Pool: new (config: { connectionString: string }) => { end: () => Promise<void> } };

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    checkpointModule = require('@langchain/langgraph-checkpoint-postgres');
  } catch {
    throw new Error(
      'Thiếu @langchain/langgraph-checkpoint-postgres — cài đặt hoặc bỏ USE_PG_CHECKPOINTER=1',
    );
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    pgModule = require('pg');
  } catch {
    throw new Error('Thiếu gói `pg` — cài đặt hoặc bỏ USE_PG_CHECKPOINTER=1');
  }

  const pool = new pgModule.Pool({ connectionString });
  const saver = new checkpointModule.PostgresSaver(pool, { schema });

  return {
    saver,
    kind: 'postgres',
    setup: async () => {
      // `setup()` chỉ tạo bảng checkpoint TRONG schema đã cấu hình.
      if (typeof (saver as { setup?: () => Promise<void> }).setup === 'function') {
        await (saver as { setup: () => Promise<void> }).setup();
      }
    },
    close: async () => {
      await pool.end();
    },
  };
};

/**
 * Config BẮT BUỘC cho mọi lần gọi đồ thị.
 *
 * Không nhận chuỗi `thread_id` thô từ bên ngoài: ghép tại đây để không ai vô tình
 * bỏ `tenantId` và làm rò checkpoint giữa các tenant.
 */
export const threadConfig = (
  ctx: Pick<AuthContext, 'tenantId' | 'runId'>,
): { configurable: { thread_id: string } } => {
  if (!ctx?.runId) throw new Error('threadConfig: thiếu runId');
  return { configurable: { thread_id: `${ctx.tenantId || 'platform'}:${ctx.runId}` } };
};
