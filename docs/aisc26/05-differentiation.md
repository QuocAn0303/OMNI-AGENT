# 05 — Pha 5: Khác biệt với KiotViet / Sapo (T7, gói P3)

Ngày tra cứu: **2026-10-03**. Mọi nhận định về đối thủ gắn URL + ngày; nguồn thẳng chi tiết
nằm ở [`notes/competitors.md`](notes/competitors.md). Không có bằng chứng thì ghi
"chưa xác minh".

**Phạm vi so sánh: đúng một luồng demo của Vòng 2** — *cảnh báo sắp hết hàng → đề xuất đặt
hàng (kèm số lượng) → người có quyền duyệt → tạo PO*. Không so sánh POS, sàn TMĐT,
hóa đơn điện tử, chấm công — ở những mảng đó đối thủ mạnh hơn ta rõ ràng và ta không
tranh.

---

## 1. Đối thủ trong tầm ngắm (và vì sao)

| # | Đối thủ | Vì sao đưa vào | Nhãn bằng chứng |
|---|---|---|---|
| 1 | **KiotViet** | Bảng giá + tính năng kho/cảnh báo/dự báo nổi tiếng nhất | [MỞ] https://www.kiotviet.vn/phi-dich-vu (2026-10-03) |
| 2 | **Sapo** | Đối thủ trực tiếp về đa kênh + có mô tả "tự động đề xuất nhập hàng" | [TRÍCH] https://www.sapo.vn/bang-gia.html + blog 2026-03-11 (2026-10-03) |
| 3 | **VietPOS.AI** | Định vị gần ta nhất: POS+ERP+AI agent, multi-tenant, agent tự cảnh báo | [MỞ] https://vietpos.ai/ (2026-10-03) |
| 4 | **CMBcoreSeller** | Đã tuyên bố "đề xuất nhập hàng AI" + "tạo PO tự chia theo NCC" | [TRÍCH] https://cmbcore.com/phan-mem-ban-hang-da-kenh (2026-10-03) |
| — | Analy (F&B) | Tham chiếu cơ chế "đề xuất nhập" theo tỷ lệ SL/ngày | [TRÍCH] https://analy.co/tinh-nang-quan-ly-kho-nguyen-vat-lieu-gia-von/ (2024-12-13) |

## 2. Ma trận trung thực — trên đúng luồng demo

Legend: **✅** = có bằng chứng đọc được · **◐** = có một phần / nói chưa rõ phạm vi ·
**❌** = không tìm thấy trong nguồn đã đọc (**không** đồng nghĩa chắc chắn là không có) ·
**—** = đối thủ không công bố, ta chưa xác minh được.

| Bước trong luồng | KiotViet | Sapo | VietPOS.AI | CMBcoreSeller | **OmniAgent (ta)** |
|---|---|---|---|---|---|
| Cảnh báo tồn kho / sắp hết | ✅ "Cảnh báo tồn kho", "Dự báo tiêu thụ" | ◐ cảnh báo ngưỡng tối thiểu | ✅ agent Kho hàng, dự báo 3–7 ngày | ✅ cảnh báo "còn 8 ngày là hết" | ✅ cảnh báo tồn + tuổi đề xuất |
| **Tính được số lượng cần đặt** | ❌ không thấy | ◐ "đề xuất nhập" theo ngưỡng (blog) | ❌ agent "Đề xuất nhập hàng" **sắp ra mắt** | ◐ "tốc độ bán 30 ngày, tự đề xuất đúng lượng" | ✅ công thức (ATP/ROP) + **lead time đo từ lịch sử PO→GRN thật**, có cờ nguồn |
| **Đề xuất có người duyệt bắt buộc** | ❌ không thấy | ❌ không thấy | ❌ agent tự cảnh báo, chỉ "bấm Gửi" cho tin nhắn nợ | ❌ PO tự chia theo NCC (không thấy cổng duyệt) | ✅ **human-gate**: không duyệt thì không có PO (`smoke:po-gate` **24/24** DB thật) |
| **Chặn khi số liệu lệch / không đủ** | — | — | — | — | ✅ `DRIFT_BLOCK` (chặn) + `DRIFT_WARN` + `409 MISSING_COST` |
| **Chống tạo PO trùng** | — | — | — | — | ✅ khóa nguyên tử theo đơn (`onOrder`) |
| **Ghi log ai duyệt, số nào** | — | — | — | — | ✅ `AuditLog` + `decidedById/decidedAt/decidedNote` |
| **AI viết lời nhưng không đổi số** | — | — | — | — | ✅ `assertNumbersUnchanged` — bắt được cả sai số **+1**; chế độ biểu diễn trên UI |
| **Nhập kho tự hạch vào sổ cái kép** | — | — | — | — | ✅ Nợ 156 + Nợ 1331 = Có 331 + cộng công nợ NCC (`check:accounting`: 57/57, 0 thiếu) |
| **Đo được sai số của đề xuất** | ❌ không thấy | ❌ không thấy | ❌ không thấy | ❌ không thấy | ◐ **giao thức đã viết, backtest CHƯA chạy** (P2/P5) |
| Chi phí LLM trên luồng này | — | — | công bố "~$0.02/KH/tháng" cho bot Telegram | — | ✅ **0đ**: số lượng do công thức quyết định, LLM chỉ giải thích/soạn tin (có đường lui không-LLM). Đo thật: **616 token/lần gọi** |
| Nhập dữ liệu hàng loạt có sẵn | ✅ | ✅ | ✅ (import Excel) | ✅ | ◐ có `import`, **chưa nạp được lịch sử đơn** (F4 trong `00-scope.md`) |

> **Ba dòng `—` ở nhóm "AI viết lời nhưng không đổi số", "Nhập kho tự hạch sổ cái" và
> "Chặn khi số liệu lệch" là kết luận CHỈ DỰA TRÊN THÔNG TIN ĐỐI THỦ CÔNG BỐ** — ta
> chưa tạo tài khoản dùng thử nào (xem §5). Nói đúng câu này thay vì nói họ không có.

## 3. Chỗ **đối thủ tốt hơn ta** — nói thẳng

1. **Phủ ngành và thiết bị.** KiotViet có mẫu ngành sẵn, máy POS, máy in, HĐĐT, chữ ký
   số, Public API (chỉ gói Cao cấp). Ta demo **một luồng, một nhóm SKU nhỏ**.
2. **Số khách và độ tin cậy thương hiệu.** Sapo tự công bố 230.000+ khách; KiotViet là
   thương hiệu dẫn đầu. Ta là dự án thi đại, **không có khách hàng thật nào**.
3. **Kênh sàn & vận chuyển đã tích hợp.** KiotViet/Sapo đồng bộ Shopee/TikTok/Lazada,
   Sapo có Sapo Automate. Luồng demo của ta lấy đơn từ **tệp xuất mô phỏng**, không
   phải tích hợp thời gian thực ⇒ **không được nói "đa kênh"**.
4. **Đã có người tuyên bố tính năng đề xuất nhập trước ta.** CMBcore ghi rõ "Đang
   chạy"; VietPOS.AI đã có agent dự báo tồn. Ta không được dùng "có AI đề xuất đặt
   hàng" làm luận điểm khác biệt.
5. **Hạ tầng đa tenant khác hẳn.** VietPOS.AI công bố "1 KH = 1 PostgreSQL DB riêng"
   (tách DB vật lý); ta cách ly bằng scoping cấp truy vấn + AsyncLocalStorage. Hai mô
   hình khác nhau, không so được bằng điểm số.
6. **Gating theo gói: đã quét lại toàn bộ, không còn file sai thứ tự** *(đo lại
   2026-10-14)*. Trước đây **18/92** file route đặt `requireModule` **trước**
   `authenticate`, mà `requireModule` **fail-open** khi chưa có `req.user`
   (`src/middleware/plan.middleware.js:109`). Nay quét 96 file route: **0** file sai
   thứ tự. Cụ thể:
   - `partners`, `production/lot`, `production/routing`, `production/work-center`,
     `projects/timesheet` — đã ở dạng đúng `router.use(authenticate, requireModule(...))`.
   - `portal` — **không sửa được theo cách kia**, vì mọi route trong file là route
     **KHÁCH HÀNG** (`/otp/*` đăng nhập OTP, còn lại `withCustomer` — token phiên
     khách, không phải JWT nhân viên). `requireModule` đọc `req.user?.tenantId` rồi
     `return next()` ⇒ trên các route này nó **luôn chạy tiếp, không chặn được gì**.
     Đã **xoá** middleware chết này và ghi chú lý do tại chỗ, thay vì thêm
     `authenticate` — thêm `authenticate` sẽ làm hỏng portal: khách không có JWT
     nhân viên nên không đăng nhập được vào chính cổng xem đơn của mình.
     Gói được kiểm ở phía chủ shop khi bật/tắt portal, không phải ở phía khách.

   ⇒ **Được nói:** `ai` + `replenishment` được gate, và toàn bộ 96 file route đã
   quét lại, không còn file nào đặt sai thứ tự.
   ⇒ **Không** nói "AI chỉ ở gói Business" như một điều đã bảo đảm tuyệt đối —
   phần khách hàng của portal cố ý không gate ở tầng HTTP.

## 4. Chốt **một** luận điểm khác biệt bảo vệ được

> **Ta bán "đề xuất đặt hàng mà không ai có thể bỏ qua bước duyệt, và sai số đo được
> bằng backtest công khai" — không bán "AI thông minh".**

Vì sao luận điểm này đứng được:

- **Có bằng chứng lệnh hôm nay:** `npm run smoke:po-gate` = **24/24 trên DB thật**
  (đề xuất không có duyệt ⇒ không có PO; có duyệt ⇒ đúng một PO); `check:tenant` PASS;
  `check:modules` 212.
- **Đối thủ không có bằng chứng tương đương trong những gì đã đọc:** không tìm thấy cổng
  duyệt, chặn lệch số liệu, hay chỉ số sai số ở cả bốn đối thủ (dòng tương ứng là ❌, và
  ghi rõ ❌ = *không tìm thấy*, không phải *chắc chắn không có*).
- **Hợp với rủi ro mà khách thật sợ:** người ta sợ hệ thống tự quyết tiền. Đây là nỗi
  đau có thể kiểm chứng bằng phỏng vấn (xem `06-business.md`).

**Điều kiện để luận điểm này còn đứng được sau ngày mai:** phải có `03-evaluation-results.md`
(có CI, ba kịch bản lead time, nhãn dữ liệu) và kết quả người thử. Trước khi có, **không
được nói "chính xác hơn KiotViet/Sapo"** — hiện trạng là **chưa đo**, và nói vậy là sai.

## 5. Hạn chế của chính tài liệu này (để đội biết trước khi trích)

- Tìm kiếm trả về nhiều blog nguồn thứ ba với giá **mâu thuẫn nhau** (ví dụ KiotViet 200k /
  270k / 330k / 490k / 800k tùy trang). Tài liệu này chỉ dùng số lấy từ **trang chính thức**
  và ghi nhãn [MỞ]/[TRÍCH]; **không** dùng số từ blog để so sánh giá.
- **Không tạo tài khoản dùng thử nào** ⇒ mọi khẳng định về tính năng của đối thủ là **từ
  trang công bố của họ**, không phải từ trải nghiệm dùng thật. Ba dòng `—` ở §2 vì lý do này.
- **[CHƯA XÁC MINH]** (còn đúng, chưa đóng được): giá CMBcoreSeller; hệ thống nội bộ duyệt PO
  của KiotViet/Sapo; tài liệu kỹ thuật/help/wiki của cả bốn (chỉ đọc trang giá + trang chủ).
  → Việc này đòi hỏi đọc tài khoản trả phí hoặc liên hệ nhà cung cấp, tốn hơn một buổi tra cứu.

## 6. Bằng chứng khảo sát thực tế — tại sao luận điểm §4 đứng được

Khảo sát 10 cửa hàng (`docs/AISC_10_Cua_Hang_Da_Dien_Gia_Dinh (1).xlsx`) cho một dữ
kiện quyết định: **9/10 đang dùng sổ tay, Excel hoặc POS cơ bản** — chưa ai dùng phần mềm
quản lý tồn kho chuyên nghiệp, trừ **1/10 dùng KiotViet (CH07)**. Và người dùng KiotViet
đó vẫn báo đúng hai tổng hợp của ngành: *chênh lệch tồn thực tế* và *nhập dư theo đợt*.

| Nhóm | Kết quả |
|---|---|
| Gặp hết hàng (giờ cao điểm / cuối tuần / mùa vụ) | **9/10** |
| Nhập dư, vốn nằm không | **10/10** |
| Muốn dùng tính năng đề xuất số lượng | **9/10** (1 người từ chối vì "lo phí") |
| Đang dùng sổ tay / Excel / POS cơ bản | **9/10** |
| Dùng KiotViet · Sapo | **1/10** · **0/10** |
| Yêu cầu bắt buộc có bước chủ quán duyệt, không cho tự đặt | **10/10** |

**Hai kết luận trực tiếp từ bảng này:**

1. **Khoảng trống không nằm ở "có phần mềm quản lý tồn kho hay không"** — KiotViet đã
   làm được, nhưng khách dùng nó vẫn bị đúng hai lỗi ta đo được. Vì vậy luận điểm §4
   **không** được bán là "ta có tính năng mà họ không có".
2. **Yêu cầu bắt buộc có bước duyệt là 10/10, không phải suy đoán.** Câu trả lời chung:
   *"lo tự đặt quá nhiều, chọn nhầm nhà cung cấp, tăng chi phí"*. Đó chính là human-gate.

> ⚠️ **Phải nói thẳng:** 4 câu (8, 19, 20, 23) có lời trả lời **giống hệt nhau ở cả 10
> phiếu**, và cả 10 ghi cùng một ngày khảo sát. Đây là **mẫu khảo sát có cấu trúc + phỏng
> vấn sâu bằng miệng**, không phải 10 bản phỏng vấn độc lập. Các con số 9/10, 10/10, 1/10
> vẫn dùng được vì đến từ các cột dữ liệu khác (công cụ, loại hình), phần đa khác nhau.
