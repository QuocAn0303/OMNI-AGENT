---

## D-005 · `orderBy` của `findCanonical` phải có hai khoá (P1, Mốc 11)

**Bối cảnh:** bản vá "đọc xác định" dùng `orderBy: { createdAt: 'asc' }`. Đội yêu cầu
thêm khoá thứ hai.

**Lựa chọn:** `orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]`.

**Lý do:** nếu chỉ có `createdAt`, Postgres không bảo đảm thứ tự giữa hai dòng có
cùng giá trị `createdAt` (độ chính xác mili-giây, và nhiều bản ghi được ghi trong
cùng một transaction). Khi đó `findCanonical` có thể trả về **hai dòng khác nhau ở
hai lần gọi khác nhau** — tức là quay lại đúng trạng thái không xác định mà bản vá
này sinh ra để chữa. `id` là khoá duy nhất nên ổn định, và kết hợp với `createdAt`
thì thứ tự hoàn toàn xác định.

**Cách đảo ngược:** bỏ khoá `{ id: 'asc' }` trong `CANONICAL_ORDER`
(`src/modules/settings/settings.service.js`) và sửa lại một khẳng định trong
`tests/settings.service.contract.test.js`.

---

## D-006 · `poApprovalThreshold` NULL hoặc ≤ 0 là "chưa đặt", không phải "0" (P1, Mốc 11)

**Bối cảnh:** cả 36 dòng `company_settings` của tenant demo đều có
`poApprovalThreshold = NULL`. Cần chốt rõ NULL được hiểu thế nào, vì ngưỡng này
quyết định PO có cần duyệt tài chính lần hai hay không.

**Phương án đã cân nhắc:**
1. NULL = 0 ⇒ mọi PO đều không cần duyệt thêm.
2. NULL = không xác định ⇒ ném lỗi.
3. NULL = chưa đặt ⇒ dùng mặc định dương.

**Lựa chọn:** phương án 3, mặc định **5.000.000**.

**Lý do:** phương án 1 là fail-open — một cấu hình chưa điền sẽ âm thầm bỏ qua lớp
duyệt thứ hai, đúng thứ ta vừa tốn công dựng lại. Phương án 2 làm chết luồng tạo PO
vì thiếu cấu hình. Phương án 3 giữ hành vi *bảo thủ* mặc định, và **vẫn cho phép
"mọi PO đều cần duyệt"** bằng cách đặt một giá trị dương nhỏ — đây là điểm quan
trọng cần nói rõ khi vấn đáp.

**Cách đảo ngược:** đổi `DEFAULT_PO_APPROVAL_THRESHOLD` hoặc điều kiện `n > 0` trong
`settings.service.getPoApprovalThreshold()`.

---

## D-007 · Chấp nhận "tự hội tụ về một dòng", nhưng đọc xác định mới là bản vá chính

**Bối cảnh:** `getOrCreate()` trước đây là race read-then-write. Đã sửa bằng cách:
đọc có `orderBy` + tự xoá dòng thừa nếu vừa tạo.

**Điều chỉnh từ đội:** "đọc xác định là bản vá chính; tự xoá dòng thừa chỉ là phụ."

**Lựa chọn:** giữ cả hai, nhưng ghi rõ vai trò.

**Lý do:** `orderBy` **ngăn** việc đọc không xác định — đó là lỗi gây ra hành vi
sai. Tự xoá dòng thừa **chữa** dữ liệu trùng đã có và giảm rủi ro khi có nhiều
tiến trình. Bỏ phần tự xoá sẽ để dữ liệu trùng tồn lại mà không có cơ chế tự
thu dọn. Giữ cả hai là phương án **đảo ngược được** và không nới quyền nào.

**Rủi ro đã biết và không xử lý ở Vòng 2:** hai tiến trình có thể cùng tạo và cùng
xoá, kết quả vẫn hội tụ về một dòng nhưng có thể xoá nhầm dòng của tiến trình kia.
Cách chữa dứt điểm là `UNIQUE(tenantId)` — **cần migration**, đã ghi backlog, và sẽ
thất bại trên môi trường đang có dữ liệu trùng nên phải dọn trước ở môi trường thật.

**Cách đảo ngược:** bỏ khối `if (canonical && canonical.id !== created.id)` trong
`settings.service.getOrCreate()`.


---

## D-008 Truy nguon 124 `audit_logs` NULL: sua 52 dong do LOI MA, giu 72 dong BAN THIEN KE

**Boi canh (do bang lenh, 2026-10-03):** `SELECT action, entity, count(*) FROM audit_logs WHERE "tenantId" IS NULL GROUP BY 1,2` tra ve DUNG 4 nhom, tat ca deu `userId = NULL`:
`CREATE_ADMIN_CAMPAIGN|AdminCampaign` 36, `SEND_ADMIN_CAMPAIGN|AdminCampaign` 36, `REGISTER|Tenant` 26, `VERIFY_EMAIL|User` 26 = 124.

**Phuong an da can nhac:**
1. Giu nguyen ngoai le "tran so luong" (trang thai hien tai).
2. Sua ma: cho `audit.service.log` nhan `tenantId` tieu minh.
3. Backfill 52 dong cu bang cach doan tenant tu `entityId` (user/tenant id trong `afterJson`).

**Lua chon:** **(2) + (3) KHONG lam**; ngoai le doi tu "tran so luong" sang **"dieu kien theo `action`"**, van giu cap 124.

**Ly do:** 72 dong log chien dich **nen tang** (`AdminCampaign` khong co `tenantId`; nguoi ghi la SUPER_ADMIN ngoai tenant context) — KHONG THEM gan tenant, dung thiet ke. 52 dong `REGISTER`/`VERIFY_EMAIL` la **loi quy thuoc tenant trong ma**: hai luong nay chay ngoai tenant context (getTenantId() = null) du tenant da biet. Sua (2) la sua nguyen nhan, kiem chung duoc bang unit test; (3) se **doan** tenant tu du lieu JSON — trai hieu "chi dung so da do duoc", nen khong lam. Do lai ngoai le theo `action` lam phat hien "action KHAC bi NULL" ngay thay vi chi dem tong.

**Cach dao nguoc:** bo tham so `tenantId` khoi `audit.service.log` va hai call site trong `auth.service.js`; khoi ngoai le trong `scripts/lib/tenant-null-exceptions.js` tro lai dieu kien `"userId" IS NULL`. 52 dong du lieu cu KHONG bi dung vao.
