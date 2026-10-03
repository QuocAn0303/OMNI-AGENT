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

---

## D-009 D7: KHÔNG đẩy 2 nhánh lên remote; dùng `git bundle` (điều kiện không xác minh được)

**Bối cảnh (D7):** "đẩy CHỈ `round2/p0-hardening` và `hotfix/tenant-nested-write`
nếu deploy chỉ chạy từ `main` và quét secret sạch; không thỏa thì `git bundle`".
Repo có 3 remote: `origin` (gitlab aduu), `github` (QuocAn0303/OMNI-AGENT),
`erp-system` (đường dẫn cục bộ).

**Quét secret — PASS.** 70 file thay đổi so với `main`: quét
`(api_key|secret|password|token)[:=] "…16+ ký tự"` ra **8 điều kiện**, tất cả đều
là placeholder `"*-test-not-a-real-hash"` của script kiểm chứng; `.env.example` chỉ
thêm giá trị rỗng. Không có secret thật.

**Điều kiện 1 — "deploy chỉ chạy từ `main`": KHÔNG XÁC MINH ĐƯỢC.** Trong repo
không tồn tại cấu hình CI/CD nào gắn nhánh (không có file pipeline ở root;
`.travis.yml` tồn tại ở thư mục con, không phải của backend). Không có bằng
chứng nào cho thấy deploy lấy từ `main` hay từ nhánh nào.

**Lựa chọn:** không đẩy. Tạo `git bundle` ngoài repo thay thế.

**Lý do:** đẩy lên remote là hành động không đảo ngược được (xoá remote xong
commit đã push vẫn còn ở phía đối phương), và mặt tiêu chuẩn của hiến pháp là
"không tạo repo công khai / không liên hệ". Khi không chạm minh điều kiện của
chính lệnh D7, chọn phương án đảo ngược được thì dù. Bundle giữ nguyên toàn bộ
lịch sử và 2 nhánh: đội cần đẩy lên remote chỉ cần `git bundle verify` rồi
`git fetch <bundle> <nhánh>`.

**Bundle (bản CUỐI, dùng bản này):**
`C:\Users\lengu\AppData\Local\Temp\opencode\erp-bundles\aduu-round2-final-20261003-093927.bundle`
(11,05 MB), kiểm chứng bằng `git bundle list-heads`:
- `f887d44 refs/heads/round2/p0-hardening`
- `959ab30 refs/heads/hotfix/tenant-nested-write`

Bản đầu `aduu-round2-20261003-093557.bundle` **đã cũ** (chỉ tới `1cd1956`) — bỏ.

**Cách đảo ngược / làm tiếp:** `git push <remote> round2/p0-hardening` khi đội xác
nhận deploy lấy từ `main` và xác nhận đúng remote nào.

## D-010 - Don con dong hang chua du tin cay thi KHONG nap, cho vao hang doi xac nhan (P4 / T9)

**Boi canh.** Khop SKU khong-LLM tra 3 trang thai. Don nao co MOT dong hang
chua dat AUTO_ACCEPT thi khong con dinh nghia day du.

**Phuong an da can nhac.**
1. Van nap don, bo qua dong hang chua khop. - Sai: Grand Total trong tep xuat van
   ghi tron, don trong ERP se thieu dong hang va bao cao lech.
2. Nap het, gan SKU gan nhat. - Sai: ghi sai du lieu khong ai biet.
3. Giu nguyen don trong DB o trang thai cho xem xet. - Can bang moi (can cot
   trang thai + API), vuot pham vi P4 va nguyen tac "khong co chuc nang moi".

**Chon.** Phuong an 3-*nhe*: KHONG nap don do; ghi ra
`data/dataset/sku-review-queue.csv` (co dong, diem, ly do, 3 ung vien tot nhat)
de nguoi xac nhan roi nap lai. Khong co cho nao trong ma tu quyet.

**Ly do.** Sai mot lan khongiem thi ghi am tham du lieu sai vao ERP; mat mot don
thi con kha phat hien.

**Cach dao nguoc.** --days / --max-orders cua
`scripts/dataset/import-erp-demo.js`; xac nhan xong thi chay lai `--apply`.

## D-011 - minStock va ton dau ky la GIA DINH mo phong, tach bang mo dong A1 (P4 / T9)

**Boi canh.** Dataset UCI khong co cot ton kho (02-data.md 6.1), nhung khong co
`minStock` thi `replenishment.calc` khong chay duoc va khong co tinh huong
"sap het hang" de trinh dien.

**Phuong an da can nhac.**
1. Bo qua `minStock` (de mac dinh 10). - Sai: khong tach duoc.
2. Dung mot hang so bat bien. - Sai: khong co gi de lich la tu du lieu.
3. `minStock` = p90 luong ban/ngay cua chinh SKU do (tinh tu `daily_sku.csv`),
   ton dau ky = 3 x p50, va 1/4 SKU co y int thap hon `minStock`.

**Chon.** Phuong an 3. Nhan A1 trong `02-data.md` 9.2; ten san pham kem
chu "MO PHONG"; `--reset` xoa sach duoc.

**Ly do.** Tinh duoc tu chinh dataset (khong bia), lai tien de luong demo P6 co
444 SKU duoi `minStock` (do bang lenh, co nhan pham vi).

**Cach dao nguoc.** Do lai bang tham so p50/p90 va `LOW_STOCK_EVERY`; hoac bo
`minStock` khi co du lieu ton kho that.

## D-012 - Tach `sku_names.csv` thay vi sua `build-daily-sku.js` (P4 / T9)

**Boi canh.** T9 can khop SKU theo TEN hang, nhung `build-daily-sku.js` co y bo
cot `Description`; va `daily_sku.csv` da co sha256 da ky trong `02-data.md` 1.

**Cach dao nguoc.** Gop vao mot file khi can; sha256 cua `daily_sku.csv` khong doi.

---

## Ghi chuc ky thuat cua P4 (khong phai quyet dinh, chi de khong phai do lai)

- `sku-matcher.js` chuan hoa chi TEN chua hang, KHONG tron ma hang vao. Khi
  tron, hai ma khac nhau cung ten khong bao gio dat diem tuyet doi, chi so
  diem giua hai ma gan nht - xau hon.
- Dung vong lap `for` + `continue` lam lech so dem: `continue` bo qua buoc
  nhay chi so, nen mot lo bi dem lai nhieu lan (`skippedOrders` chay toi
  142575 cho 1025 don). Dung `while` co buoc tuong minh.
- Do chinh xac `AUTO_ACCEPT` phai la **100%**, dung la 100% moi tinh la "dat".
  50,32% o lan do o dau chi do la **loi cua phong do**: so dap an theo
  "SKU dau tien cua don" thay vi SKU cua dung dong hang.

---

## D-013 - Neo ngay cua so du lieu (A4) + PO "tien su" cho demo (A5) (P6 / T11)

**Boi canh.** Tap xuat san co ngay nam 2011 (UCI Online Retail II). Ham
`loadReplenishmentInput` doc 28 ngay gan nhat theo `Date.now()` => sau khi P4 nap,
tenant demo co **0 don COMPLETED trong 28 ngay** (do bang lenh: 2452 don, tuoi
2011-11-10 den 2011-12-09). Khuc "canh bao het hang -> de xuat" viet bang cong
thuc nen **khong SKU nao co nhu cau** => luong demo T11 khong the chay.

**Phuong an da can nhac.**
1. Ghi nho "as-of": them tham so `now` vao `loadReplenishmentInput` va
   `recomputeCurrent`, cho phep chay luong demo "tai thoi diem 2011-12-09".
   *Khong sua du lieu, nhung la them khai niem moi vao duong san pham va phai
   truyen `now` xuyen qua ca `revalidate`.*
2. Dich ca cua so tap xuat ve cuoi ngay hom nay (mac dinh moi cua
   `import-erp-demo.js`), giu nguyen khoang cach giua cac ngay va so don/ngay.

**Chon.** Phuong an 2, va ghi ro la **gia dinh mo phong A4** trong
`02-data.md` 9.2 + dau file n nap. `--anchor keep` giu ngay goc 2011 ( dung de
truy vet dataset), `--anchor YYYY-MM-DD` ghim mot ngay ( tat dinh hoan toan).

**Ly do.** Khong them khai niem "as-of clock" vao duong san pham; ma n ap van
giu nguyen tinh idempotent (`orderCode` la `@unique`, `update: {}` nen chay lai
khong doi `createdAt`).

**Cach dao nguoc.** `node scripts/dataset/import-erp-demo.js --reset --apply
--anchor keep` (hoac doi tham so `anchor` trong `parseArgs`).

## D-014 - Phai co PO "tien su" + GRN POSTED de chay duoc luong demo (A5) (P6 / T11)

**Boi canh.** `suggestForProduct` lay NCC tu **PO gan nhat cua SKU do** va co y
khong bia NCC (`return { needVendor: true }`). Tenant demo nạp xong co 0 PO =>
moi SKU deu rut vao nhanh `needVendor` => khong bao gio co de xuat. Them vao do:
`calcLeadTime` chi dung lead time **do duoc** khi co >= `LEAD_TIME_MIN_SAMPLES` (3)
lan nhan hang.

**Chon.** `import-erp-demo.js` them **3 vong PO (RECEIVED) + GRN (POSTED)** cho 20
SKU ton thap nhat, lech 7 ngay, o -75/-60/-45 ngay (ngoai cua so 34 ngay ban
hang de khong cong nham vao lich su ban). Day la **gia dinh A5**, khong sua
du lieu gi, va PO nay **khong** lam thay doi ton (ton van theo A1).

**Ly do.** Khong sua `replenishment.suggest.js` de tu chon NCC (vi do la quyet
dinh co chu dich, xem D-007); va khong ha `LEAD_TIME_MIN_SAMPLES` xuong 1 (lam
cham viec "chua du mau thi noi thang").

**Cach dao nguoc.** `HISTORY_PO_ROUNDS = []` (xoa khoi `import-erp-demo.js`),
hoac bo A5 khi co du lieu NCC that tu ERP cua doanh nghiep that.

## D-015 - Sua nhanh "lead time do duoc" chet am tham trong `loadLeadTimeReceipts` (P6 / T11)

**Boi canh.** `calcLeadTime` doc `receipts[i].poDate` + `.receivedAt`; ham nap
du lieu tra `{ date, receivedAt }` => `poDate` luon `undefined` => moi gap bi
loc => **LUON** rơi vao nhanh "chua du mau, dung mac dinh 7 ngay". Unit test van
xanh vi test chi truyen tay dung hinh dang `poDate`. Phat hien khi chay thu
luong demo tren DB that (truoc khi sua: 20/20 SKU `leadTimeEstimated = true`).

**Chon.** Do lai o ham nap du lieu (`{ poDate: po.date, receivedAt: po.receivedAt }`),
khong doi `calcLeadTime` — hop dong cua ham toan la `poDate`, moi noi goi khac
(backtest, test) deu theo ten do.

**Bang chung.** Sau khi sua: 18/20 SKU co `leadTimeEstimated = false`,
`sampleSize = 3`, lead time 7 ngay. `npx jest tests/replenishment` 154/154;
`npm run smoke:po-gate` 24/24.
