# Review pack — HOTFIX CÁCH LY TENANT (`hotfix/tenant-nested-write`)

> Mục đích: đội đọc được **một mình** trong ~10 phút trước khi quyết định triển
> khai lên môi trường thật, mà không phải đọc code và tự suy.
>
> Nguyên tắc của pack này: **mọi nhận định đều kèm lệnh đã chạy và kết quả thật.**
> Ô nào "chưa đo" thì ghi "chưa đo", không điền số cho đẹp.

---

## 1. Hotfix này sửa cái gì (một câu)

Khi ghi dữ liệu **lồng** (ví dụ `order.create({ data: { items: { create: [...] } } })`),
Prisma extension chỉ gắn `tenantId` vào dòng ngoài cùng ⇒ **dòng con sinh ra
`tenantId = NULL`**, và vì extension cũng lọc `where.tenantId` khi đọc nên chính
dòng vừa ghi **biến mất khỏi tầm nhìn của tenant đã tạo ra nó**. Đó là dạng rò
dữ liệu tệ nhất: dữ liệu tồn tại nhưng không ai đọc được, và báo cáo "tồn kho"
sai.

## 2. Vì sao phải tách thành nhánh riêng

Bản vá nằm ở `src/config/prisma.js` — tầng mà **mọi** truy vấn của hệ thống đi
qua. Nếu gộp vào nhánh chính thì mọi thay đổi khác (tính năng mới, backtest,
giao diện) đều bị chặn cùng lúc với một bản vá khẩn cấp. Tách nhánh để:

1. review riêng phần rủi ro (mục 5);
2. triển khai/hồi quy **độc lập** với phần còn lại;
3. nếu bản vá có vấn đề thì `git revert` một commit, không phải revert cả nhánh.

**Kịch bản hồi quy = triển khai lại phiên bản trước đó.** Tuyệt đối không thêm
công tắc tắt fail-fast tenant (xem mục 6).

## 3. Nội dung nhánh

| Commit | Nội dung |
|---|---|
| `8eb320f` | `withNestedTenant()` cho mọi ghi lồng + fail-fast khi không tìm thấy `tenantId` + 3004 test + SQL thô `ai_documents` + `scripts/tenant-null.js` + `check-tenant-null.js` + runbook |
| `959ab30` | `ai_documents`: `ON CONFLICT ... DO UPDATE ... WHERE ai_documents.tenant_id = EXCLUDED.tenant_id` (không ghi đè tài liệu của tenant khác) + sửa `check-tenant-aidocs.js` |

Chi tiết lịch sử: `git log --oneline main..hotfix/tenant-nested-write`.

## 4. Bằng chứng đã chạy (mọi dòng đều từ DB thật hoặc đã ghi rõ)

| Lệnh | Kết quả | Loại |
|---|---|---|
| `npx jest tests/tenant-nested-write.contract.test.js` | PASS (lớp test: A đối chiếu schema, B Prisma validator thật, C/D guard tĩnh) | mock + validator thật |
| `npm run check:tenant-isolation` | 11/11 | **DB thật** |
| `npm run check:tenant-gaps` | 4/4 | **DB thật** |
| `npm run check:tenant:null` | 4/4 PASS (ngoại lệ 124 `audit_logs` + 1 `users` được khai báo tường minh) | **DB thật** |
| `npm run check-tenant-aidocs` | 12/12 | **DB thật** |
| `npm run smoke:po-gate` | 24/24 (kịch bản 11 = MISSING_COST mới, 2026-10-03) | **DB thật** |
| `node scripts/tenant-null.js --scan` | MỒ CÔI-TENANT **0**; TRÙNG 1-1 **0** | **DB thật** |
| `npm run check:swagger` | 115/115 khối `@swagger` parse được | tĩnh |

Snapshot 2 tenant thật (`CANDORY SCENT`, `Á đù`) trước/sau mọi lần ghi dữ liệu:
**GIỐNG HẸT** — `CANDORY SCENT`: 82 đơn / 158 dòng hàng / 89.862.000 VND / 201 audit log.

## 5. Rủi ro đã biết (nói thẳng, không giấu)

1. **`withNestedTenant` là đệ quy trên cấu trúc `data`.** Rủi ro thật là bỏ sót
   một dạng ghi lồng mới (ví dụ `createManyAndReturn` lồng sâu, hoặc quan hệ tự
   tham chiếu). Đã phủ: `create`, `createMany`, `createManyAndReturn`, `connectOrCreate`,
   `upsert`, `update.data`; test C/D chặn hồi quy khi thêm khái niệm mới.
2. **134/139 bảng scoped KHÔNG có khoá ngoại tới `tenants`.** Xoá tenant không
   kéo theo dữ liệu con ⇒ phải dọn thủ công (đã có `cleanup-test-residue.js`).
   Đây là **backlog đã biết**, không phải lỗi của hotfix.
3. **Không có `UNIQUE(tenantId)` trên bảng 1-1** (`company_settings`). Đã giảm
   thiểu bằng đọc xác định + tự hội tụ về một dòng; dứt điểm cần migration.
4. **Trạng thái lơ lửng của gate** (`APPROVED` nhưng `resultRef = null`) là cố ý có
   và có đường thoát (`retryExecution`), nhưng UI phải hiện cảnh báo — phần giao
   diện nằm ở T12.
5. **Chưa đo trên môi trường thật.** Mọi bằng chứng trên chạy trên DB local của
   dự án. Chưa có lần chạy nào trên staging/production.

## 6. Điều KHÔNG được làm

- Không thêm biến môi trường kiểu `SKIP_TENANT_CHECK=1` để "cho qua cho nhanh".
- Không sửa migration đã áp dụng. Nếu cần thêm `UNIQUE`, ghi backlog và triển
  khai thành migration mới sau khi dọn dữ liệu.
- Không hạ `check:tenant` xuống mức "chỉ cảnh báo" để xanh. Đỏ là đúng khi đỏ.

## 7. Trước khi triển khai (checklist người dùng)

```bash
# 1. Sao lưu (bắt buộc, xem runbook-tenant-null.md mục "Thứ tự bắt buộc")
pg_dump -Fc -f aduu-prod-before-tenant-hotfix-$(date +%F-%H%M).dump

# 2. Chạy thử trên bản sao DB thật (staging hoặc bản restore từ dump)
node scripts/tenant-null.js --scan            # chỉ đọc, transaction READ ONLY
npx prisma migrate deploy                     # KHÔNG dùng db:migrate

# 3. Lên môi trường thật
node scripts/tenant-null.js --scan            # trước: ghi lại số
npm run check:tenant
node scripts/tenant-null.js --backfill        # dry-run, xem kế hoạch
node scripts/tenant-null.js --backfill --apply
node scripts/tenant-null.js --scan            # sau: kỳ vọng 0
```

## 8. Địa chỉ tài liệu liên quan

- `docs/aisc26/runbook-tenant-null.md` — quy trình đầy đủ, gồm kế hoạch hoàn tác.
- `docs/aisc26/STATE.md` — trạng thái và số đã ký.
- `docs/aisc26/DECISIONS.md` — D-003 (hotfix tách nhánh), D-008 (ngoại lệ audit).
- `tests/tenant-nested-write.contract.test.js` — bằng chứng ở dạng chạy được.