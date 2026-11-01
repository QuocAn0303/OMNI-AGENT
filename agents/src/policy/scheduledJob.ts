/**
 * policy/scheduledJob.ts — Chạy tool của một job định kỳ dưới ĐÚNG quyền người tạo.
 *
 * ============================================================================
 * HAI RÀNG BUỘC
 * ============================================================================
 * 1. Job chỉ chạy được với actor là NGƯỜI TẠO JOB. Nếu scheduler dựng lại actor
 *    từ `job.createdByUserId` rồi gán role hiện tại của người đó, việc đổi role
 *    sau khi tạo job sẽ âm thầm nâng quyền cho job cũ. Ở đây actor phải khớp
 *    `createdByUserId`; lệch ⇒ `job_actor_mismatch`, không chạy.
 * 2. `job_id` + `report_period` đi vào MỌI audit + trace qua `withToolGuard`.
 *    Không có hai trường này thì không truy được job nào đã tạo lịch mới hoặc đọc
 *    tài nguyên ngoài quyền người tạo.
 *
 * Việc chặn `cron.create`/`hr.salary` KHÔNG nằm ở đây — nó nằm ở policy
 * (`authorizeTool`, default-deny) mà `withToolGuard` gọi trước handler.
 */
import type { AuthContext } from '../contracts/types';
import { withToolGuard, type ToolDefinition, type ToolGuardDeps } from './toolWrapper';

export interface ScheduledJob {
  jobId: string;
  reportPeriod: string;
  /** User đã tạo job — actor chạy job phải là chính người này. */
  createdByUserId: string;
  /**
   * Ảnh chụp role/phòng ban TẠI THỜI ĐIỂM TẠO JOB. Có mặt thì actor chạy job
   * phải khớp cả hai — đổi role sau khi tạo không được nâng quyền cho job cũ.
   */
  createdByRole?: string;
  createdByDepartment?: string | null;
}

export class ScheduledJobError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(`Job định kỳ bị từ chối (code: ${code})`);
    this.name = 'ScheduledJobError';
    this.code = code;
  }
}

export const assertJobActor = (actor: AuthContext, job: ScheduledJob): void => {
  if (!job?.jobId || !job?.reportPeriod) throw new ScheduledJobError('job_context_missing');
  if (!job.createdByUserId) throw new ScheduledJobError('job_creator_missing');
  if (!actor?.userId || actor.userId !== job.createdByUserId) {
    throw new ScheduledJobError('job_actor_mismatch');
  }
  if (job.createdByRole && job.createdByRole !== actor.role) {
    throw new ScheduledJobError('job_actor_mismatch');
  }
  if (job.createdByDepartment != null && job.createdByDepartment !== actor.department) {
    throw new ScheduledJobError('job_actor_mismatch');
  }
};

/**
 * Chạy một tool của job. `args` để cuối để caller thường chỉ cần truyền deps.
 */
export const runScheduledJobTool = async <
  TArgs extends Record<string, unknown> = Record<string, unknown>,
  TResult = unknown,
>(
  actor: AuthContext,
  job: ScheduledJob,
  tool: Omit<ToolDefinition, 'jobId' | 'reportPeriod'>,
  handler: (ctx: AuthContext, args: TArgs) => Promise<TResult> | TResult,
  deps: ToolGuardDeps = {},
  args: TArgs = {} as TArgs,
): Promise<TResult> => {
  assertJobActor(actor, job);

  const guarded = withToolGuard<TArgs, TResult>(
    { ...tool, jobId: job.jobId, reportPeriod: job.reportPeriod },
    handler,
    deps,
  );

  return guarded(actor, args);
};
