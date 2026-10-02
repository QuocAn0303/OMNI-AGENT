# DECISIONS — quyết định tự động khi không có ai trả lời

Ghi lại **mọi** quyết định agent tự đưa ra khi không có người trả lời. Mỗi mục:
bối cảnh → phương án đã cân nhắc → lựa chọn → lý do → cách đảo ngược.

---

## D-001 · Phân loại 124 dòng `audit_logs` NULL không rõ chủ

**Bối cảnh (Mốc 10, mục 2.1):** `check:tenant` FAIL vì 124 dòng `audit_logs` có
`tenantId IS NULL` và `userId` trỏ tới user không còn tồn tại. Được yêu cầu: dùng
bằng chứng từ dump để tách thành (a) thuộc 9 user rác đã xoá → xoá; (b) thuộc tài
khoản nền tảng → CỐ Ý; (c) còn lại → giữ và khai báo ngoại lệ tường minh trong
mã, có trần = số quan sát, `check:tenant` PASS kèm cảnh báo.

**Phương án đã cân nhắc:**
1. Chấp nhận FAIL vĩnh viễn.
2. Xếp hết sang CỐ Ý.
3. Xoá toàn bộ 124.
4. Khôi phục dump → tra `userId` → xoá đúng nhóm (a), giữ (b)(c) với ngoại lệ
   tường minh.

**Lựa chọn:** phương án 4.

**Lý do:** là phương án duy nhất vừa làm `check:tenant` xanh vừa **không** bịa
dữ liệu và không xoá nhầm. Phương án 2 là làm số xanh giả; phương án 3 xoá nhật
ký không có căn cứ; phương án 1 giữ gate đỏ vĩnh viễn.

**Cách đảo ngược:** `git revert` commit; dữ liệu bị xoá chỉ là audit log của user
đã bị xoá ở Mốc 10, và còn bản `pg_dump` trước đó.

---

## D-002 · Dùng ngoại lệ tường minh có trần thay vì mở rộng danh sách bảng

**Bối cảnh:** `audit_logs` NULL còn lại thuộc user không còn tồn tại. Nguyên nhân
gốc là **audit log sống lâu hơn user** — đây là đặc tính hợp lệ của nhật ký, không
phải dữ liệu hỏng.

**Phương án đã cân nhắc:**
1. Thêm `audit_logs` vào `INTENTIONAL_NULL` (cho phép NULL vô điều kiện).
2. Khai báo ngoại lệ **có điều kiện + trần số quan sát**, ghi rõ ngày và lý do.

**Lựa chọn:** phương án 2.

**Lý do:** phương án 1 biến một sự cố dữ liệu thành quy tắc vĩnh viễn — lần sau
ghi `tenantId` sai ở `audit_logs` cũng không ai phát hiện. Phương án 2 giữ được
khả năng phát hiện: chỉ khi số dòng **vượt trần đã ghi** thì mới báo.

**Cách đảo ngược:** sửa hằng số trong `scripts/check-tenant-null.js` và
`scripts/tenant-null.js` (trần và điều kiện nằm cạnh nhau, có chú thích).

---

## D-003 · Dọn 2 tenant `ISO A`/`ISO B` rò từ script kiểm thử

**Bối cảnh:** sau khi dọn Mốc 10 còn đúng 2 tenant thật, nhưng kiểm tra lại thấy
**4 tenant** — thêm `ISO A` và `ISO B` do `scripts/check-tenant-isolation.js` tạo
ra và **không xoá được** (nhiều khả năng bị chặn bởi khoá ngoại `RESTRICT`).

**Phương án đã cân nhắc:**
1. Bỏ qua, ghi vào báo cáo.
2. Xoá thủ công bằng SQL.
3. Viết **lệnh dọn rác theo tiền tố** (`scripts/cleanup-test-residue.js`) dùng
   chung cho mọi script smoke/check, rồi dùng nó để dọn.

**Lựa chọn:** phương án 3.

**Lý do:** đây đúng là việc T4 yêu cầu, và rò tenant đã làm sai tiền đề của T1
("còn lại đúng 2 tenant"). Viết một lần dùng cho mọi script là hơn vá từng chỗ.
Sau khi có lệnh này, **phải sửa thêm** các script sinh tenant để chúng tự dọn
sạch — nếu không thì lần chạy sau lại rò tiếp (đã xảy ra đúng như vậy với
`smoke:po-gate` ở Mốc 10).

**Cách đảo ngược:** `git revert`; dữ liệu xoá chỉ là dữ liệu kiểm thử, có dump.

---

## D-004 · Không tự sửa `expect` để làm test xanh

**Bối cảnh:** có test cũ khẳng định hành vi `minStock` đã bị thay.

**Lựa chọn:** sửa test theo **hợp đồng mới**, ghi rõ trong báo cáo.

**Lý do:** hiến pháp cấm ghi "xong" khi không có bằng chứng. Đổi hợp đồng mà giữ
test cũ là sai; sửa logic test để xanh là gian lận.
