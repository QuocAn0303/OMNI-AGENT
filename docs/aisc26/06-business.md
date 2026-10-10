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
khi được phép; không bịa. **Hiện trạng: chưa phỏng vấn ai** ⇒ mọi phát biểu trong §2 là
**giả định chưa kiểm chứng**, và tài liệu phải ghi nhãn đó.

Câu 8 là câu quyết định luận điểm khác biệt ở `05-differentiation.md` §4.

> **Cập nhật 2026-10-10 — đã có công cụ, chưa có người thật.** Bộ **10 phiếu × 24 câu**
> nằm trong `docs/AISC_10_Cua_Hang_Da_Dien_Gia_Dien (1).xlsx`, có sẵn cột "điều cần xác
> minh / hỏi sâu" và cột "nhận định / trích dẫn được phép". **Nhưng mọi câu trả lời trong
> tệp là GIẢ ĐỊNH** (tệp tự ghi ở từng dòng: *"GIẢ ĐỊNH – CHƯA KHẢO SÁT"*, *"TOÀN BỘ NỘI
> DUNG TRONG SHEET LÀ TÌNH HUỐNG GIẢ LẬP"*) ⇒ **số người phỏng vấn thật vẫn là 0**, và
> **không** đưa con số như "99.000đ/tháng" hay "trên 200.000đ là đắt" vào tài liệu trình
> bày. Cách dùng lại: xoá cột *"Trả lời thực tế"* rồi điền lại với người thật. Chi tiết:
> `notes/labeling-and-interview-status.md` §2.

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

### 5.3 Ba phương án giá

| PA | Cách bán | Bám cơ chế nào | Cần làm trước khi bán |
|---|---|---|---|
| **PA — Giữ gói sẵn có** | `free` / `pro` 499k / `business` 1.499k; luồng đặt hàng nằm trong `purchase-orders` (**đã** được gate, có trong gói `free`) | không cần mã mới | Không cần gì. Nhưng 499k **khó** cạnh tranh khi KiotViet chuyên nghiệp 330k và Sapo Pro 249k (đã tra 2026-10-03) mà họ cho nhiều tính năng hơn. |
| **PB — Gói riêng "Đề xuất đặt hàng"** (theo số đề xuất/đơn nhập) | khớp giá trị: khách trả theo số lần hệ thống đề xuất | cần `SubscriptionPlan` mới + `TenantSubscription` dạng add-on + gate mới | Gate `replenishment`; bảng giá; UI. **Chưa đo được giá trị** ⇒ **chưa chốt được mức giá**. |
| **PC — Nhúng trong `business`, bán "quy trình duyệt có kiểm soát"** | tính giá theo công sức triển khai/giám sát thay vì theo số user | thêm `"ai"`, `"replenishment"` vào `allowedModules` của `business` | Sửa thứ tự middleware ở **18 file**; gate `ai`/`replenishment`; chốt KPI (số PO/duyệt, tỉ lệ drift chặn) |

**Chọn tạm: PA + PC**, để PB sau khi có phỏng vấn. Lý do: PA không cần mã mới (có thể chạy
thử với khách ngay), PC hợp với luận điểm bán *quy trình*; PB là phương án giá theo
dùng — không có số đo giá trị nên **không được hứa**.

**Mức giá tham chiếu (đã tra 2026-10-03, nguồn ở `notes/competitors.md`):**
KiotViet 270k/330k/490k · Sapo 170k/249k/449k/600k/999k · VietPOS.AI 0/99k/199k.
⇒ `pro` 499k của ta **nằm trong ngang thị trường**, nhưng ta **thiếu** POS bán tại cửa hàng,
đồng bộ sàn TMĐT, HĐĐT mà họ có. Khách sẽ hỏi đúng câu đó; câu trả lời phải là *"chúng tôi
không bán POS"*, không vòng vo.

## 6. Kinh tế đơn vị — chỉ số đo thật, còn lại ghi "chưa đo"

| Chỉ số | Công thức / cách đo | Trạng thái | Nhãn phạm vi |
|---|---|---|---|
| Giá trị đơn hàng TB | `89.862.000 VND ÷ 82 đơn` = **≈ 1.095.878 VND/đơn** | **ĐÃ ĐO** | **DB local thật**, 1 tenant mẫu (`CANDORY SCENT`), dữ liệu demo. **Không** suy ra thị trường. |
| Số dòng/đơn | `158 ÷ 82` = **≈ 1,92** | **ĐÃ ĐO** | như trên |
| Giá gói | `free 0` · `pro 499.000` · `business 1.499.000` VND/tháng | **ĐÃ ĐO** | `prisma/seed.js` (giá niêm yết trong mã) |
| ARPU | thu ÷ khách trả tiền | **chưa đo** | chưa có khách hàng trả tiền |
| LTV / CAC / thời gian hoàn vốn / biên gộp | — | **chưa đo** | chưa có chi phí marketing, chưa có churn |
| Chi phí LLM/ngày/tenant | token × đơn giá nhà cung cấp tại ngày đo | **chưa đo** | `LlmUsageLog` chưa có (T13/P7). Số "~$0,02/KH/tháng" của VietPOS.AI là **số của họ**, không phải của ta |
| Chi phí hạ tầng/tenant/tháng | — | **chưa đo** | chưa tách được |
| Giá trị tiết kiệm cho khách (đủ để trả phí) | từ backtest | **chưa đo** | ngay cả khi có, đó là **MÔ PHỎNG** (§2.3 của `03-evaluation-protocol.md`) |

**Cấm:** suy đơn vị kinh tế từ dữ liệu demo của 1 tenant; nói "tiết kiệm X%" khi chưa đo.

## 7. Việc phải làm tiếp (không làm được bằng agent)

1. **`BLOCKER-HUMAN` — 5–10 phỏng vấn** theo bộ câu hỏi §4; bắt buộc trước khi chốt mức giá
   PB, và trước khi trình bày §2 là sự thật.
2. **Sửa paywall trước khi bán gói**: 18 file đặt `requireModule` trước `authenticate` +
   gate `ai`/`replenishment`. Không sửa thì mọi giá niêm yết ở §5.1 là bất khả thi.
3. **Đặt key Gemini** rồi chạy `live` (P7) — nếu không có, mọi con số chi phí LLM ghi
   "chưa đo".
4. **Chốt PA/PB/PC** sau khi có phỏng vấn; ghi vào `DECISIONS` chung.

**Giới hạn của chính tài liệu này:** mọi nhận định về nhu cầu khách hàng ở §1–§4 là
**giả định chưa kiểm chứng**; §5.2 là sự thật đọc từ mã; §6 tách rõ đo được / chưa đo.