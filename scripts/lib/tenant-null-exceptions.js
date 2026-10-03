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
    // ĐIỀU KIỆN THEO `action`, không phải "bảng này được phép NULL".
    // Truy nguồn 124 dòng (2026-10-03, `SELECT action, entity, count(*) FROM
    // audit_logs WHERE "tenantId" IS NULL GROUP BY 1,2`) cho đúng 4 nhóm, tất cả
    // đều `userId = NULL`:
    //   CREATE_ADMIN_CAMPAIGN | AdminCampaign | 36
    //   SEND_ADMIN_CAMPAIGN   | AdminCampaign | 36   -> 72 dòng: bảng NỀN TẢNG,
    //     `AdminCampaign` không có `tenantId`; người ghi là SUPER_ADMIN ngoài
    //     tenant context ⇒ KHÔNG THỂ gán tenant, đúng theo thiết kế.
    //   REGISTER              | Tenant        | 26
    //   VERIFY_EMAIL          | User          | 26   -> 52 dòng: lỗi gán thuộc
    //     tenant của mã (đăng ký / verify email chạy ngoài tenant context dù
    //     tenant đã biết). ĐÃ SỬA: `audit.service.log` nhận `tenantId` và hai
    //     call site truyền tường minh. 52 dòng CŨ giữ nguyên (không có nguồn
    //     để suy ngược lại từng tenant), nên vẫn phải nằm trong ngoại lệ này.
    where:
      `"tenantId" IS NULL AND "userId" IS NULL AND "action" IN ` +
      `('CREATE_ADMIN_CAMPAIGN','SEND_ADMIN_CAMPAIGN','REGISTER','VERIFY_EMAIL')`,
    cap: 124,
    reason:
      "Truy nguồn bằng lệnh (2026-10-03): 124 dòng NULL chia làm 72 dòng log " +
      "chiến dịch NỀN TẢNG (`AdminCampaign` không có `tenantId` — không thể gán) " +
      "và 52 dòng `REGISTER`/`VERIFY_EMAIL` là lỗi quy thuộc tenant trong mã. " +
      "Phần 52 đã sửa tại `src/modules/audit/audit.service.js` + `auth.service.js` " +
      "(truyền `tenantId` tường minh); dữ liệu cũ giữ nguyên vì không có nguồn suy. " +
      "Đã đối chiếu dump `aduu-dev-before-residue-cleanup-20261002-202352.dump`: " +
      "không dòng nào thuộc 9 user rác đã xoá ở Mốc 10. Cap 124 giữ làm lưới an " +
      "toàn: có action KHÁC xuất hiện NULL ⇒ phải điều tra, không tự động tha.",
    since: "2026-10-02 (điều kiện chuyển sang theo `action` ngày 2026-10-03)",
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
