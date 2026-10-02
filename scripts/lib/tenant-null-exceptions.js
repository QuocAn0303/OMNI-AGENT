/**
 * scripts/lib/tenant-null-exceptions.js — Ngoại lệ TƯỜNG MINH cho `tenantId IS NULL`
 *
 * VÌ SAO CẦN
 * `check:tenant` phải đỏ khi có `tenantId = NULL` ở bất kỳ bảng nào — đó là
 * chốt chặn phát hiện lỗi cách ly tenant. Nhưng có những trường hợp NULL là
 * **đúng theo thiết kế**, và những trường hợp dữ liệu hỏng không thể sửa được
 * vì không còn nguồn để suy. Khi đó phải **khai báo tường minh có điều kiện và
 * có trần**, không bao giờ đơn giản là "cho phép NULL".
 *
 * MỖI ngoại lệ bắt buộc có:
 *   - điều kiện SQL cụ thể (không phải "bảng này được phép NULL")
 *   - trần số dòng tối đa, bằng số ĐÃ QUAN SÁT
 *   - lý do và ngày ghi nhận
 * Khi số dòng thực tế VƯỢT trần ⇒ báo động, vì đó là dữ liệu mới sinh chứ không
 * phải ngoại lệ cũ.
 */

/** @type {Array<{table: string, where: string, cap: number, reason: string, since: string}>} */
const EXPLICIT_EXCEPTIONS = [
  {
    table: "users",
    where: `"tenantId" IS NULL AND role::text = 'SUPER_OMEGA_ULTRA_ADMIN'`,
    cap: 1,
    reason:
      "Tài khoản cấp nền tảng cố ý không thuộc tenant nào (đi vòng qua cách ly tenant). " +
      "Đây là lý do users.tenantId KHÔNG được ép NOT NULL ở Vòng 2.",
    since: "2026-10-02",
  },
  {
    table: "audit_logs",
    where: `"tenantId" IS NULL AND "userId" IS NULL`,
    cap: 124,
    reason:
      "Nhật ký hệ thống không gắn user (audit log phát sinh ngoài ngữ cảnh người dùng). " +
      "Đã khôi phục dump aduu-dev-before-residue-cleanup-20261002-202352.dump để truy " +
      "userId: CẢ 124 dòng đều có userId = NULL — tức KHÔNG phải user đã xoá mà là log " +
      "không có chủ, nên không có nguồn để suy tenantId. Đã đối chiếu: không dòng nào thuộc " +
      "9 user rác đã xoá ở Mốc 10. Giữ nguyên, không xoá. Nếu số dòng vượt trần này thì là " +
      "dữ liệu mới sinh ⇒ phải điều tra, không tự động tha.",
    since: "2026-10-02",
  },
];

/** Ngoại lệ áp dụng cho một bảng, hoặc null. */
const exceptionFor = (table) => EXPLICIT_EXCEPTIONS.find((e) => e.table === table) || null;

/**
 * Với một bảng, trả về số dòng NULL đã được ngoại lệ **bao phủ** và số dòng
 * NULL **vượt trần** (phải báo động).
 *
 * @returns {{covered: number, overCap: number, exception: object|null}}
 */
const classifyNullRows = async (client, schema, table, totalNull) => {
  const ex = exceptionFor(table);
  if (!ex || totalNull === 0) return { covered: 0, overCap: 0, exception: ex };
  const r = (
    await client.$queryRawUnsafe(
      `SELECT count(*)::int AS n FROM "${schema}"."${table}" WHERE ${ex.where}`,
    )
  )[0];
  const covered = r.n;
  const overCap = Math.max(0, covered - ex.cap);
  return { covered, overCap, exception: ex };
};

module.exports = { EXPLICIT_EXCEPTIONS, exceptionFor, classifyNullRows };
