# 04 — Kịch bản trình diễn 7 phút (một luồng, đóng trọn tới sổ cái)

**Ngày:** 2026-10-14 · **Nhánh:** `round2/p0-hardening`

> **ĐÍNH CHÍNH 2026-10-14 — viết lại toàn bộ.** Bản cũ (2026-10-03) mô tả luồng
> **dừng ở "tạo đơn nhập"**, trong khi đề tài tên là *"Tối ưu hóa Tồn kho và Chuỗi
> cung ứng"*. Nay kịch bản đi trọn **9 bước**, từ đơn bán đến bút toán, và có thêm
> khoảnh khắc **AI diễn thích + chốt chặn số** — thứ trả lời trực tiếp câu "vai trò
> LLM ở đâu".

> **Nhãn dữ liệu xuyên suốt:** dữ liệu trên màn hình là **MÔ PHỎNG**, dựng từ
> **UCI Online Retail II (CC BY 4.0)** — xem `02-data.md`. Giá tính bằng **sterling của
> tệp dữ liệu**, **không** quy đổi. **Không** phải dữ liệu khách hàng thật.
> **Không** được nói "khách hàng của chúng tôi", "shop của họ", "tiết kiệm được X%".

**Hai người:** **A** thuyết trình (đứng, nói), **B** thao tác (ngồi cạnh máy).
Nếu chỉ một người: A nói, A thao tác, nhưng **phải** nói trước khi bấm: *"Tôi sẽ bấm
một cái, xem màn hình."*

---

## 0. Trước khi lên sân khấu (30 phút) — checklist bắt buộc

Chạy hết, **thấy xanh hết** mới lên. Không có "chạy thử lúc lên".

```bash
# 0. DB local + migration
npx prisma migrate status          # 0 migration chờ
npm run tenant:null -- --scan      # MỒ CÔI-TENANT 0 · TRÙNG 0

# 1. Dữ liệu demo đủ dùng
npm run data:import -- --reset --apply --days 34 --max-orders 6000
npm run demo:setup                  # PO+GRN lịch sử cho nhóm "hero" ⇒ lead time ĐO ĐƯỢC
npm run smoke:import-demo

# 1b. BẬT ĐĂNG NHẬP cho tenant MÔ PHỎNG
npm run demo:login -- --apply       # in ra email + mật khẩu dùng cho bước đăng nhập

# 1c. KIỂM CHỨNG TRƯỚC KHI LÊN — 25/25 là xem được
npm run demo:check                  # chạy luồng 2 lần + phủ bước 7 + chốt chặn LLM

# 2. Luồng demo chạy được, chạy lại nhiều lần không rác
npm run smoke:demo-flow            # 17/17

# 3. HÂM NÓNG — LẦN ĐẦU CHẠY CHẬM 20 LẦN
npm run demo:run                    # in 6 khối, chạy 2-3 giây khi đã ấm

# 4. HTTP thật (cần backend đang chạy ở cổng 4000)
npm run check:humangate            # 11/11

# 5. LLM: mặc định là KHÔNG dùng LLM
npm run llm:policy                 # chỉ in chế độ + có/không key, KHÔNG in key

# 6. Giao diện
cd frontend && npm run lint && npm run build && cd ..
```

| Mục | Đạt | Cách kiểm | Nếu hỏng |
|---|:---:|---|---|
| PostgreSQL local chạy | ☐ | `npm run tenant:null -- --scan` | dừng cài lại Postgres |
| 0 migration chờ | ☐ | `npx prisma migrate status` | `npx prisma migrate deploy` (**không** `db:migrate`) |
| Tenant demo có 500 SKU + đơn bán | ☐ | trang `/products` | `npm run data:import -- --reset --apply …` |
| **`demo:check` 25/25** | ☐ | lệnh trên | đọc phần FAIL, **không trình bày** |
| `smoke:demo-flow` 17/17 | ☐ | lệnh trên | đọc `STATE.md` giả định A4/A5 |
| `check:humangate` 11/11 | ☐ | cần `npm run dev` | xem mục dự phòng B |
| LLM **tắt** (mặc định) | ☐ | `npm run llm:policy` | không cần làm gì thêm |
| Đăng nhập được vào tenant demo | ☐ | `/login` bằng tài khoản `demo:login` in ra | `npm run demo:login -- --apply` |
| **Đã chạy `demo:run` 1 lần để hâm nóng** | ☐ | xem mục 4 | — |
| Mở sẵn 5 tab: `/smart-guide`, `/pos`, `/agent-approvals`, `/purchase-orders`, `/grn` | ☐ | trình duyệt | — |
| Có bản in dự phòng | ☐ | `npm run demo:run > %TEMP%\demo.txt` | — |

---

## 1. Kịch bản 7 phút

| Giờ | Màn hình | Nói gì | Thao tác |
|---|---|---|---|
| 0:00–0:30 | — (đứng) | A: *"Đây là **một quy trình** đi trọn từ cảnh báo đến sổ cái: cảnh báo sắp hết hàng → hệ thống tính số lượng cần đặt → **người duyệt** → tạo đơn nhập → nhập kho → hạch bút toán. Mọi số trên màn hình là **dữ liệu mô phỏng** từ tập UCI Online Retail II, giấy phép CC BY 4.0; tiền tính bằng sterling của tệp đó."* | — |
| 0:30–1:00 | tab `/smart-guide` | A: *"Ba chỗ tôi muốn nói trước. Một: **số lượng đặt do công thức quyết định, không phải AI**. Hai: **không có AI thì luồng vẫn chạy trọn** — hôm nay tôi tắt AI. Ba: **không ai bỏ qua được bước duyệt**; không duyệt thì không tồn tại đơn nhập nào."* | B giữ tab |
| 1:00–1:50 | tab `/pos` | A: *"Tôi bán vài cái để tồn rơi."* | **B** chọn SKU, bấm thanh toán |
| 1:50–2:30 | tab `/agent-approvals` | A: *"Hệ thống vừa sinh một đề xuất. Nhìn bốn thứ: **tồn khả dụng**, **điểm đặt lại ROP**, **số ngày còn đủ bán**, **số lượng đề xuất** — và **cờ nguồn thời gian nhập hàng**: `MEASURED` nghĩa là lấy từ lịch sử PO→GRN thật, không phải mặc định."* | **B** bấm **Duyệt** |
| 2:30–3:00 | tab `/purchase-orders` | A: *"Đây là đơn nhập, tạo **đúng một cái**, có ghi ai duyệt, lúc nào, ghi chú gì."* | B mở PO |
| 3:00–3:40 | tab `/grn` | A: *"Đơn mua chưa phải hàng. Giờ nhận kho: tôi nhận **một phần** — phần còn lại phải giao nốt, hệ thống tự nhớ. QC đạt, rồi **ghi sổ cái**."* | **B** bấm **Ghi sổ cái (post)** |
| 3:40–4:10 | tab `/accounting` | A: *"Và đây là bút toán: **Nợ 156 tồn kho + Nợ 1331 công nợ phải trả = Có 331 công nợ phải có**. Trước 2026-10-12 hệ thống của chúng tôi nhận kho chỉ cộng tồn, **không** ghi bút toán — chúng tôi tự tìm ra bằng lệnh kiểm tra của chính mình: **39 đơn mua đã nhận hàng mà không có dòng bút toán nào**. Nay bằng 0."* | B mở sổ cái |
| 4:10–5:00 | quay lại `/agent-approvals` | A: *"Giờ tới phần AI. AI ở đây làm **đúng hai việc**, cả hai đều là việc công thức không làm được."* Bấm **AI Giải thích và Soạn tin NCC**. *"Đây là lời giải thích cho anh/chị, và đây là tin nhắn đặt hàng gửi nhà cung cấp. Hệ thống **chỉ soạn, không gửi**."* | **B** bấm nút, đọc ra |
| 5:00–5:30 | — | A: *"Và đây là phần tôi muốn anh/chị nhìn kỹ."* Bấm **Test Chốt chặn AI sửa số**. *"Tôi cố tình để AI sửa số lượng. Nó bị chặn: số cũ … ra số mới …, hệ thống báo số mới không có trong khối số của công thức, bác bỏ văn bản, và dùng lại số chuẩn. **Ranh giới này không phải lời hứa — nó là đoạn mã này** [`assertNumbersUnchanged`], và `demo:check` kiểm cả sai số nhỏ từng một đơn vị."* | **B** bấm nút |
| 5:30–6:10 | — | A: *"Chúng tôi không bán câu 'AI chính xác hơn'. Chúng tôi bán: **đề xuất có cổng duyệt bắt buộc, chặn lệch số liệu, và sai số đo được bằng backtest công khai**."* *"Thí nghiệm 1 — kể cả phần xấu: chỉ số chính ưu tiên ROP hơn ngưỡng cố định, **nhưng** cái đổi lại là bán ít hơn 9,5%, mất bán nhiều hơn 31,5%. Chúng tôi **không** kết luận 'ROP tốt hơn'."* | — |
| 6:10–6:40 | — | A: *"Về thị trường: chúng tôi khảo sát 10 cửa hàng. **9/10** gặp hết hàng, **10/10** bị nhập dư đọng vốn, và **9/10** đang dùng sổ tay hoặc Excel — trong đó người duy nhất dùng phần mềm chuyên nghiệp vẫn bị chênh lệch tồn và nhập dư theo đợt. Mức họ sẵn sàng chi: trung vị **149 nghìn/tháng**."* | — |
| 6:40–7:00 | — | A: *"Còn hai ô chúng tôi **chưa có dữ liệu**: số token LLM chạy hàng ngày và thời gian người dùng. Tôi ghi 'chưa có dữ liệu' thay vì điền số."* | — |

---

## 2. Diễn tập (bắt buộc 2 lần)

1. Chạy `npm run demo:check` — phải **25/25**.
2. Chạy trọn kịch bản **một lần không màn hình** (`npm run demo:run`) để hâm nóng.
3. Chạy lại `npm run demo:check`. Lần đầu nạp cây module cần ~27 s; lần sau **~2,4 s**.
   Không có bước hâm nóng này thì bước `create-order` sẽ đứng **19 giây** trên sân khấu.

---

## 3. Nếu hỏi "số kia lấy ra sao?"

| Câu hỏi | Trả lời |
|---|---|
| Số lượng đề xuất | `planReplenishment` — ROP = `nhu cầu/ngày × (leadTime + an toàn)`. Xem `replenishment.calc.js` |
| Lead time lấy ở đâu | Từ lịch sử **PO → GRN thật**. Trước đây nhánh này **chết âm thầm**: 0/20 PO đo được, tất cả rơi về mặc định 7 ngày |
| Vì sao có cờ "ước lượng"? | Vì không đủ lịch sử nhập cho SKU đó. Hệ thống **nói thẳng** thay vì giả vờ biết |
| Tin nhắn NCC ai viết? | AI viết **lời**; số do công thức cho. Không có hàm gửi nào trong đường này — người dùng tự gửi |
| AI có thể tự đặt hàng? | **Không.** Mọi hành động ghi đều qua thẻ chờ duyệt. Không có đường vòng |

---

## 4. Phương án dự phòng

### A. `npm run demo:run` — không cần giao diện (~3 giây)

In 6 khối: SKU → đơn bán → công thức → duyệt → **đóng vòng (GRN → bút toán → công nợ)** →
chống trùng. Dùng khi giao diện chết.

### B. `npm run check:humangate` — chứng minh phần HTTP

Chạy vòng đời gate qua HTTP thật: CASHIER hỏi dữ liệu nhạy cảm → bị chặn → tạo gate
PENDING → ADMIN duyệt.

### C. Chế độ không-LLM — **mặc định, không phải dự phòng**

`npm run llm:policy` xác nhận. Khi LLM tắt, bước 8 vẫn chạy và **ghi rõ nhãn
"mẫu"**; không giả vờ là LLM viết.

### D. Bản in/snapshot dự phòng

```powershell
npm run demo:run > "$env:TEMP\demo.txt"
```

---

## 5. Kịch bản thay thế 90 giây (khi bị cắt thời gian)

1. `/agent-approvals` — bấm **Duyệt**, chỉ vào cờ `MEASURED` của lead time.
2. `/grn` — nhận một phần rồi **Ghi sổ cái**.
3. Quay lại `/agent-approvals` — bấm **Test Chốt chặn AI sửa số**.
4. Kết: *"39 đơn mua không vào sổ cái, chúng tôi tự tìm ra và đã sửa."*

---

## 6. Những gì KHÔNG được nói

| Không nói | Vì sao |
|---|---|
| "Chúng tôi phỏng vấn 10 chủ cửa hàng **độc lập**" | Nói đúng hơn: *mẫu khảo sát 24 câu đã điền cho 10 cửa hàng + phỏng vấn sâu*. Bốn câu (8, 19, 20, 23) trùng khít 10/10 |
| "Tiết kiệm được X%" | Không có căn cứ |
| "AI chính xác hơn" | Hybrid hơn fuzzy +0,0113 F1 nhưng **CI95 [0; 0,0379] vẫn chứa 0** |
| "Hết hàng từ 8% xuống 1,5%" | Đã gỡ khỏi mọi tài liệu |
| "ROP tốt hơn" | Thí nghiệm 1: ROP **mất bán nhiều hơn 31,5%** |
| "Khách hàng của chúng tôi" | Dữ liệu là mô phỏng |
| Nhắc tới giá gói cũ 499k/1.499k | Đã lệch khảo sát 3,3 lần — xem `06-business.md` §5.5 |
