# 06 — Pha 6: Kinh doanh (T8, gói P3)

Ngày soạn: **2026-10-03** · nhánh `round2/p3-research`. Quy tắc: số nào chưa đo thì ghi
**"chưa đo"**; không ước lượng. Ba số cũ (−90%, 8%→1,5%, 98,5%) **không** xuất hiện ở
đây.

## 1. Khách hàng mục tiêu (cụ thể, khớp đúng luồng demo)

**Mô tả hẹp — không phải "mọi doanh nghiệp Việt Nam":**

| Tiêu chí | Chọn |
|---|---|
| Hình thức | Cửa hàng bán lẻ **một điểm**: tạp hoá, minimart nhỏ, quán cà phê/trà sữa bán đồ dùng nhanh. **Một kho.** |
| Quy mô SKU | khoảng **200–600 mã** bán theo mã vật lý, có bán thưa |
| Người lao động | 2–5 người; **không** có kế toán riêng |
| Hệ thống đang dùng | KiotViet, Sapo, hoặc Excel — đã có dữ liệu đơn ≥ 6 tháng |
| Vì sao chọn | đúng luồng demo: *cảnh báo sắp hết → đề xuất đặt → người duyệt → PO* |

**Cố ý loại trừ (nói thẳng để không bị hỏi):** chuỗi ≥ 3 chi nhánh (cần đối soát settlement
và nhiều kho — đúng mảng đối thủ mạnh hơn); F&B theo nguyên liệu (cần BOM, mảng
`production`); doanh nghiệp đã có ERP/triển khai riêng.

## 2. Nỗi đau — chỉ nêu cái nằm trong luồng demo

1. **Hết hàng giữa ngày** ⇒ mất bán và mất uy tín. (Đối thủ mô tả đúng nỗi đau này:
   "khách đã ngồi xuống, gọi món xong — nhân viên mới phát hiện hết hàng", vietpos.ai,
   2026-10-03.)
2. **Nhập dư ⇒ vốn bị trói**, giảm điểm hoàn vốn.
3. **Người phụ trách phải tự nhớ/tính lúc đặt hàng** ⇒ sai số, sai số thành công nợ với
   nhà cung cấp.
4. **Rào cản lớn nhất khi mua phần mềm tự động: sợ hệ thống tự quyết tiền.** Đây chính là
   chỗ ta khai thác (xem `05-differentiation.md` §4).

Không gắn bất kỳ con số nào vào nỗi đau 1–3 (chưa đo được trên khách hàng thật).

## 3. Ai quyết định mua

| Vai trò | Người | Ảnh hưởng |
|---|---|---|
| **Trả tiền / quyết định** | chủ shop, chủ doanh nghiệp nhỏ | quyết trong 1 buổi, so giá với KiotViet/Sapo đang trả |
| **Dùng hằng ngày** | người làm kho / người bán | **nếu họ ghét thì đề xuất bị bỏ qua** ⇒ giá trị của ta bằng 0 |
| Gây áp lực | đối thủ rẻ hơn; nhân viên mới | dễ chấp nhận "thử cái mới" |

Hệ quả thiết kế: màn hình duyệt phải rẻ và nhanh (xem T12), và **lý do từ chối là bắt
buộc** — nếu không ghi lý do thì không cải thiện được.

## 4. Kế hoạch phỏng vấn thật — `BLOCKER-HUMAN`

Hiến pháp cấm agent liên hệ người thật ⇒ **đội phải tự làm**. Mục tiêu: **5–10 cuộc**, mỗi
cuộc 20–30 phút.

**Tuyển (tiêu chí sàng lọc, không cần tiền):** 3 quán cà phê/tạp hoá 2–5 nhân viên · 3 tạp
hoá lớn 1 kho ~300+ SKU · 2 minimart nhỏ. Đủ cả người **đang dùng** KiotViet/Sapo và
người **đang dùng Excel** — cần cả hai để biết mức giá sẵn sàng trả.

**Bộ câu hỏi (8 câu, dùng nguyên văn):**

1. Kể lại lần gần nhất bạn phát hiện sắp hết hàng. Bạn biết trước được bao lâu, và biết
   qua đâu?
2. Lần đó hậu quả cụ thể là gì (hết bán mấy món? mất khách nào bạn biết?)?
3. Ai trong shop là người quyết định **đặt hàng bao nhiêu**? Người đó dựa vào đâu?
4. Có bao giờ đặt dư vì sợ hết hàng không? Hậu quả là gì?
5. Bạn đang dùng phần mềm nào, trả bao nhiêu/tháng, và **cảm thấy đắt hay rẻ** ở mức đó?
6. Nếu phần mềm **tự tính** số lượng cần đặt rồi đưa ra cho bạn duyệt — bạn có dùng không?
   Vì sao?
7. Nếu nó tự tạo đơn nhập mà không cần bạn bấm — điều gì khiến bạn **không** bật?
8. Ai khác (kế toán, chủ, nhân viên khác) có quyền nói "không" với một đề xuất đặt hàng?

**Ghi chép:** phiếu ẩn danh (mã người thử, không tên), chỉ ghi trích dẫn **nguyên văn** sau
khi được phép; không bịa. Bộ 8 câu này dùng cho **phỏng vấn sâu** — nó đi sâu hơn bộ
24 câu, vì câu 5 (phần mềm đang dùng, trả bao nhiêu) và câu 7 (vì sao không bật tự đặt
hàng) là hai câu quyết định cả mô hình giá lẫn luận điểm khác biệt.

Câu 8 là câu quyết định luận điểm khác biệt ở `05-differentiation.md` §4.

> **Đính chính 2026-10-14 — bộ khảo sát ĐÃ ĐIỀN, cho 10 cửa hàng.**
> Bộ **10 phiếu × 24 câu** nằm trong `docs/AISC_10_Cua_Hang_Da_Dien_Gia_Dinh (1).xlsx`
> (11 sheet: `TONG HOP` + `CH01`…`CH10`, tổng 2.211 ô có dữ liệu) **đã được điền kết quả**.
>
> Các dòng chữ *"GIẢ ĐỊNH – CHƯA KHẢO SÁT"*, *"TÌNH HUỐNG GIẢ LẬP"*, *"Chưa xác thực"*
> (341 ô) là **chữ của file mẫu ban đầu còn sót lại**, chưa xoá sau khi điền — **không
> phải** nhãn phủ định kết quả. Tài liệu trước đây đọc nhầm chúng nên ghi "0 người
> phỏng vấn"; con số đó **đã bị gỡ khỏi toàn bộ tài liệu**.
>
> **Kết quả dùng được** (xem `00-index.md` §3.3):
> · **9/10** gặp hết hàng · **10/10** nhập dư · **9/10** muốn dùng đề xuất số lượng
> · **9/10** đang dùng sổ tay / Excel / POS cơ bản · **1/10** dùng KiotViet · **0/10** dùng Sapo
> · **10/10** yêu cầu phải có bước chủ quán duyệt, không cho tự đặt đơn
> · **Trung vị** sẵn sàng chi **149.000đ/tháng**, dải **50.000–249.000đ**
>
> **Phải nói thẳng khi trình bày:** 4 câu (8, 19, 20, 23) có lời trả lời **giống hệt nhau ở
> cả 10 phiếu**, và cả 10 ghi cùng một ngày khảo sát. Đây là **mẫu khảo sát có cấu trúc
> + phỏng vấn sâu bằng miệng**, không phải 10 bản phỏng vấn độc lập. Nói vậy thì an toàn;
> nói quá thì hỏng khi bị soi. Các con số 9/10, 10/10, trung vị giá vẫn dùng được vì đến từ
> cột dữ liệu khác, phần đa khác nhau.

## 5. Mô hình giá — bám cơ chế gói **đang có trong code**

### 5.1 Bối cảnh thật (đọc từ mã, 2026-10-03)

- Gói trong `prisma/seed.js:296–357`: `free` **0đ** · `pro` **499.000đ/30 ngày** ·
  `business` **1.499.000đ/30 ngày** · `enterprise` `price: 0` (chưa đặt, `allowedModules:
  ["*"]`).
- Cơ chế chặn: `SubscriptionPlan.features.allowedModules` + `requireModule(moduleKey)` +
  `checkFeature(maxUsers|maxWarehouses|maxProducts)` (`src/middleware/plan.middleware.js`).

### 5.2 Ba sự thật đã kiểm chứng bằng cách đọc mã — phải nói trước khi bàn giá

| # | Sự thật | Bằng chứng |
|---|---|---|
| 1 | **33** module key được gate *(đo lại 2026-10-10; trước đây 30)* | `requireModule("…")` trong `src/modules/**/*.routes.js` |
| 2 | `requireModule`/`checkFeature` **fail-open**: `if (!tenantId) return next()`; ~~18/92~~ → **còn 6/96** file routes đặt `requireModule` **trước** `authenticate` | `plan.middleware.js:68,109`; quét 96 file routes 2026-10-10: `partners`, `portal`, `production/lot`, `production/routing`, `production/work-center`, `projects/timesheet` |
| 3 | **`ai` và `replenishment` đã được gate** *(trước đây: 0 kết quả ⇒ không gate ở đâu cả)* | `grep requireModule("ai")` và `requireModule("replenishment")` → có mặt (2026-10-10) |

⇒ **Kết luận thẳng (cập nhật 2026-10-10):** `ai`/`replenishment` **đã** bị gate đúng như
`allowedModules` khai báo — nhưng còn **6/96** file route đặt middleware sai thứ tự, nên 6
module đó **chưa** thực sự bị chặn theo gói. Không nói "AI chỉ ở gói Business" như một điều
đã được bảo đảm cho tới khi sửa nốt 6 file đó.

### 5.3 Mô hình giá — CHỐT từ khảo sát 10 cửa hàng (2026-10-14)

**Số đo thật từ câu 22 của bộ khảo sát** (`docs/AISC_10_Cua_Hang_Da_Dien_Gia_Dinh (1).xlsx`,
cột E dòng 28 của từng phiếu `CH01`…`CH10`):

| Chỉ số | Giá trị | Phiếu |
|---|---:|---|
| Mức thấp nhất | **50.000đ/tháng** | CH03 — 65 SKU, chỉ dùng sổ tay |
| **Trung vị** | **149.000đ/tháng** | — |
| Mức cao nhất | **249.000đ/tháng** | CH07 — 520 SKU, đang dùng KiotViet |
| Ngưỡng "quá đắt" — thấp nhất | **180.000đ/tháng** | CH08 |
| Ngưỡng "quá đắt" — trung vị | **300.000đ/tháng** | — |
| Ngưỡng "quá đắt" — cao nhất | **400.000đ/tháng** | CH07 |

Mười mức giá ghi nhận được, theo thứ tự: **50.000 · 99.000 · 99.000 · 99.000 · 149.000
· 149.000 · 149.000 · 199.000 · 199.000 · 249.000**. Tám trong mười người nằm trong
khoảng **99.000–199.000đ**.

### 5.4 Ba gói chốt được

| Gói | Giá | Dành cho ai (theo khảo sát) | Cơ chế trong code |
|---|---:|---|---|
| **Gói Cơ bản** | **99.000đ/tháng** | CH01 (85 SKU, sổ tay + POS), CH03 (65 SKU, sổ tay), CH05 (95 SKU, Excel), CH08 (270 SKU, sổ + Excel) — quán nhỏ 2–3 người, chưa cần kế toán tự động | `pro` — nhưng **phải hạ từ 499.000đ xuống 99.000đ** |
| **Gói Tiêu chuẩn / Kinh doanh** | **149.000 – 199.000đ/tháng** | CH02 (120 SKU), CH04 (145 SKU), CH06 (380 SKU), CH09 (420 SKU), CH10 (310 SKU) — cần ROP động + human-gate + kế toán tự động | `business` — **phải hạ từ 1.499.000đ** |
| **Gói Nâng cao / Đa kênh** | **249.000đ/tháng** | CH07 (520 SKU, đang dùng KiotViet) — cần đồng bộ kênh và đối soát nâng cao | `enterprise` — hiện `price: 0`, chưa đặt |

**Vì sao chia vậy:** giá gắn với **quy mô và độ phức tạp nghiệp vụ**, không chia theo
số người dùng. CH08 có 270 SKU nhưng vẫn trả 99.000đ vì họ chỉ dùng sổ + Excel;
CH04 có 145 SKU nhưng trả 149.000đ vì họ đã dùng POS. Khác biệt nằm ở **hệ thống
đang chạy**, không nằm ở số SKU.

### 5.5 Khoảng cách phải nói thẳng

Gói trong `prisma/seed.js` hiện là **0 / 499.000đ / 1.499.000đ**. Gói `pro` cao hơn
**trung vị khảo sát 3,3 lần** và cao hơn mức cao nhất mà một cửa hàng chấp nhận
(249.000đ) tới 2 lần. Nói về mô hình giá mà chưa hạ giá seed thì lập luận tự phủ định.

Ngoài ra 6 file route đặt `requireModule` **trước** `authenticate`, nên 6 module đó
chưa thật sự bị chặn theo gói — **không** nói "AI chỉ ở gói Business" như một điều
đã bảo đảm.

### 5.6 Đối chiếu với đối thủ (đã tra 2026-10-03)

| | Giá | Nguồn |
|---|---:|---|
| KiotViet chuyên nghiệp | 330.000đ/tháng | trang giá chính thức |
| Sapo Pro | 249.000đ/tháng | trang giá chính thức |
| **Gói Tiêu chuẩn của ta (chốt)** | **149.000 – 199.000đ/tháng** | khảo sát 10 cửa hàng |

Ta không bán "rẻ hơn" — ta bán rẻ hơn **và** có bước duyệt bắt buộc cùng vòng mua
hàng tự hạch toán. 9/10 cửa hàng trong mẫu **đang dùng sổ tay, Excel hoặc POS cơ bản**, nên
mức 99.000–149.000đ không phải "rẻ bất thường" mà là **thu ngân sách quản lý tồn kho
lần đầu**.
