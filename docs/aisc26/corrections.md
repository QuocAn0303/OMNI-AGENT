# Đính chính

Nhật ký các phát biểu đã sai và nguyên nhân sai. Mục đích: không ai dùng lại
con số cũ, và nếu lỗi lặp lại thì thấy ngay.

Nguyên tắc đã duyệt: **mọi số tác động dữ liệu phải chỉ tính trên tenant còn
tồn tại và ghi nhãn phạm vi.**

---

## C1. "+47% doanh thu" — sai (2026-10-02, Mốc 6)

**Đã nói:** backfill làm doanh thu nhìn thấy tăng từ 89.862.000 lên 131.862.000
VND (+42.000.000, **+47%**), SKU có nhu cầu 20 → 23, tổng số lượng 464 → 884.

**Đúng:** trên tenant **còn tồn tại**, không thay đổi gì.

| Chỉ số (chỉ tenant còn tồn tại) | Trước | Sau |
|---|---|---|
| Doanh thu nhìn thấy | 89.862.000 | 89.862.000 |
| `order_items` nhìn thấy | 158 | 158 |

Tenant demo `CANDORY SCENT`: 82 đơn, 158 dòng hàng, 89.862.000 VND — không đổi.

**Nguyên nhân:** tôi đếm cả đơn hàng **mồ côi** — 84 `order_items` thuộc các đơn
mà `tenantId` trỏ tới tenant **đã bị xoá**, nên chúng không thuộc tenant nào.
Không có nhãn phạm vi ⇒ dễ đọc nhầm thành thiệt hại dữ liệu khách hàng.

---

## C2. "gần một nửa doanh thu không hiện ra trong báo cáo" — sai (2026-10-02)

Là cách diễn đạt khác của C1, sai cùng lý do. **Không** có phát biệu nào trong
tài liệu được track nào nói rằng mất một nửa doanh thu.

Cách nói đúng: *lỗi ghi lồng làm `tenantId = NULL` là lỗi thật ở mã; trên DB
phát triển nó ảnh hưởng 84/242 dòng `order_items`, nhưng toàn bộ là dữ liệu kiểm
thử; tenant thật duy nhất không bị mất dữ liệu; môi trường thật chưa quét.*

---

## C3. "9 user rác trôi nổi" — sai (2026-10-02, Mốc 6)

**Đã nói:** 9 user có `tenantId IS NULL` là rác do script thất bại, không có
dữ liệu tham chiếu.

**Đúng:** chúng tham chiếu tới **86 đơn hàng** mang `tenantId` khác NULL và **9
dòng `admin_campaign_recipients`**.

**Nguyên nhân:** script dọn do tôi viết chỉ lọc `tenantId IS NULL` mà **không rà
tham chiếu tới** trước khi kết luận "rác trôi nổi". Chính sự thiếu kiểm tra đó
là lỗi; nó đã được sửa (script nay dừng toàn bộ khi gặp tham chiếu ngoài danh
sách cho phép).

---

## C4. Phép đo nhóm D (36 warehouses, 69 audit_logs) — lỗi thời (2026-10-02, Mốc 8–9)

**Đã ký:** 36 / 69, tổng mồ côi 281, tổng nhóm D 111.

**Đúng (Mốc 10 ký lại):** 40 / 81, tổng 297, nhóm D 127.

**Nguyên nhân:** chính script `smoke:po-gate.js` **rò dữ liệu trong lúc đo** —
teardown thiếu `warehouse` và `audit_log`, mà 134/139 bảng scoped không có khoá
ngoại tới `tenants` nên xoá tenant vẫn thành công và dữ liệu con thành mồ côi.
Bằng chứng: `audit_logs` mồ côi 69 → 77 → 81 trong lúc sửa, rồi **đứng yên 81**
sau hai lần smoke liên tiếp khi đã vá.

**Bài học áp dụng:** đo lại số liệu ngay trước lúc ghi, và **chạy smoke đã vá
trước khi đo** — nếu không số sẽ bị chính công cụ đo làm bẩn.

---

## C5. "8 tenant DBG" — sai (2026-10-02, Mốc 8)

**Đã nói:** 8 tenant rác `DBG`.

**Đúng:** **7** tenant (tổng 9 tenant gồm 7 `DBG` + `CANDORY SCENT` + `Á đù`).

**Nguyên nhân:** đọc từ một bảng liệt kê bị cắt bớt dòng thay vì chạy `COUNT`.

**Quy tắc mới:** mọi con số đưa vào kỳ vọng phải lấy từ truy vấn `COUNT` chạy
lại, không đọc từ danh sách hiển thị.
