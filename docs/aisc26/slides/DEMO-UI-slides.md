# AISC'26 — Kịch bản trình bày trên giao diện

> **Cách dùng:** mỗi slide ghi rõ **bấm ở đâu** và **nói gì**. Trình bày bằng
> cách mở trình duyệt và làm theo — không mở terminal.
>
> Mọi con số trong tài liệu này đều lấy từ
> `docs/aisc26/notes/sku-eval-last-run.json` và `sku-eval-cases.csv`, kiểm được
> bằng lệnh. Không có số nào ước lượng.
>
> Đăng nhập: `demo-mo-phong@local.invalid` / `Demo123456`

---

# PHẦN A — Mở đầu (2 slide)

## Slide 1 — Bài toán

**Nói:**

> Chủ shop có đơn hàng viết tay trên tem, trong tin nhắn, trên PDF của nhà cung
> cấp. ERP cần mã hàng. Khoảng cách giữa hai thứ đó là thời gian nhân viên ngồi
> tra cứu từng dòng — và là thứ **ghi sai vào sổ cái** khi tra nhầm.

**Không cần mở màn nào.** Để câu hỏi lơ lửng.

---

## Slide 2 — Bài toán này là thật, không phải giả định

**Nói:**

> Chúng tôi khảo sát **10 cửa hàng bán lẻ thật**. 10/10 dùng sổ, Excel hoặc
> phần mềm POS để đối chiếu tồn kho. Chính 9/10 nhập dư hàng. 10/10 muốn được
> hỏi trước khi ghi.

**Nói thêm — điểm yếu phải nói trước, đừng để giám khảo hỏi:**

> Chúng tôi cũng phải nói rõ điểm yếu: trung vị sẵn sàng chi của các quán là
> **149.000đ/tháng**, thấp hơn mức **160.000đ** mà họ đang trả cho POS. Nên câu
> chào hàng "rẻ hơn phần mềm POS" **không đúng**. Chúng tôi không dùng câu đó.

---

# PHẦN B — DEMO (5 slide, toàn bộ bằng chuột)

## Slide 3 — Khởi động luồng AI: bấm nút tạo đề xuất

**Bấm:** menu trái → `Phân tích` → `Trợ lý KD` → tab `Đề xuất nhập`

**Bấm:** cột cuối `Hành động`, nút `Tạo đề xuất` ở một dòng **nút không mờ**

→ tự chuyển sang màn `Duyệt đề xuất nhập`.

**Nói:**

> Bảng này liệt kê **105 mã hàng đã dưới điểm đặt lại**. Hệ thống tự tính số
> lượng cần nhập. Người bấm nút để **mở đề xuất ra xem xét**.

**Nếu có người hỏi vì sao nhiều nút mờ — nói trước, đừng đợi bị hỏi:**

> Chỉ **7 trong 105** mã hàng đã có nhà cung cấp. 98 mã còn lại, hệ thống **từ
> chối tự bịa** nhà cung cấp — nên nút bị khoá. Đây là chủ ý: PO sai nhà cung
> cấp thì hậu quả nặng hơn nhiều so với phải người chọn tay.

---

## Slide 4 — AI được phép giải thích

**Bấm:** nút `AI Giải thích và Soạn tin NCC`

Chờ vài giây. Hiện 3 khối: `Giải thích đề xuất` · `Tin nhắn đặt hàng gửi nhà cung cấp` · `Hàng rào số`

**Nói:**

> AI viết lời giải thích vì sao nên nhập số lượng này, và soạn sẵn tin nhắn gửi
> nhà cung cấp. Nhưng **AI không được đổi một con số nào**. Phần cuối bên dưới
> là hàng rào kiểm tra điều đó.

*(Thẻ nguồn ở góc phải ghi `nguồn: LLM` hoặc `nguồn: mẫu`. Nói rõ cái nào đang
hiện.)*

---

## Slide 5 — Chứng minh hàng rào chạy thật

**Bấm:** nút `Test Chốt chặn AI sửa số`

Hệ thống cố tình làm lệch một con số rồi chạy lại hàng rào.

**Nói:**

> Đây không phải hình vẽ. Bấm nút này, hệ thống **cố tình làm sai một số** rồi
> đưa qua hàng rào thật. Người xem thấy hàng rào báo chặn.

*(Bấm lại một lần để trả về trạng thái thường trước khi chuyển slide.)*

---

## Slide 6 — Người quyết định, không phải AI

**Bấm:** tick ô `Tôi xem diff ở trên và vẫn mua đúng số lượng này` → bấm `Duyệt`

→ hộp xanh: **"Đã tạo PO PO-… (…đ)"**

**Nói:**

> AI đề xuất. Công thức tính số. **Người bấm Duyệt.** Không có đường nào để AI tự
> tạo PO — PO là hành động tài chính.

---

## Slide 7 — Vòng đóng kín, có số bút toán

**Bấm:** `KẾ TOÁN & TÀI CHÍNH` → `Mua hàng` → mở đơn vừa tạo → bấm `Gửi NCC` (APPROVED → ORDERED)

*(PO từ ngưỡng duyệt 5tr trở lên sẽ có thêm 1 bước `Duyệt` trước khi `Gửi NCC` — kiểm soát lần hai theo số tiền, AI không vượt qua được.)*

**Bấm tiếp trong chi tiết PO:** `Tạo GRN` (hoặc `Nhận nhanh` cho shop nhỏ) → sang `/grn?poId=…` → nhập `SL nhận` → `Ghi nhận QC` (đạt/lỗi) → `Nhập kho (POSTED)` → quay lại tab `Phiếu nhận hàng — đã nhận X/Y` (PO lật PARTIALLY_RECEIVED khi nhận 1 đợt, RECEIVED khi đủ hàng)

**Bấm:** `Sổ kế toán` → mở bút toán sinh từ phiếu đó

Chỉ vào: **Nợ 156 · Nợ 1331 · Có 331**

**Nói:**

> Một lần nhập kho, hệ thống tự ghi hai bút toán: tăng tồn kho và ghi công nợ
> nhà cung cấp. Trước khi sửa, **39 đơn đã nhập hàng mà không vào sổ cái** — tức
> tiền hàng về kho mà sổ không biết. Nay là **0**.

---

# PHẦN C — ĐO LẠI (4 slide)

## Slide 8 — Cách chúng tôi đo

**Nói:**

> 120 cặp tên hàng trên sàn — mã hàng. Trong đó **107 cặp đã gắn nhãn tay**; chia
> sẵn **60 ca kiểm định** và **60 ca phát triển**. Tập kiểm định có **56/60 ca có
> nhãn**. Người gán là **một người** — chưa có người gán thứ hai, nên **κ = null**.

> Chạy trên máy chủ trường (UIT, `gemma-4-26b`), **không giới hạn số lần gọi** như
> Gemini free tier.

> Nhưng **chúng tôi không dùng tổng điểm làm con số chính**. Bảng từng ca mới là
> bằng chứng — và nó đã phát hiện ra điều mà điểm số giấu.

---

## Slide 9 — Đo lại, không trích một số

| Nguồn / cách đo | F1 | Chuyển người duyệt | Độ đúng thô |
|---|---:|---:|---:|
| UIT, 1 lần chạy lưu được (`sku-eval-last-run.json`) | **0,8972** | **1,67 %** | 48/56 |
| Chỉ công thức (đo đối chiếu) | 0,8515 | 13,33 % | 48/56 |
| Gemini, 5 lần | 0,8654–0,8868 | 3,33–6,67 % | — |

CI95 chênh lệch F1 trên lần chạy UIT lưu được = **[0,0008 ; 0,0969]** — không chứa 0.  
Trên Gemini: CI95 **luôn chứa 0** (5/5 lần).

**Nói:**

> Trên UIT, hybrid giảm chuyển người từ **13,33% xuống 1,67%** và CI95 của chênh lệch
> F1 **không chứa 0**. Trên Gemini, F1 dao động **0,8654–0,8868** và CI95 **luôn
> chứa 0** — nên trên Gemini chúng tôi **không kết luận** "AI tốt hơn công thức".

> Đội báo cáo **5/5 lần trên UIT cho kết quả giống nhau**; repo hiện lưu được **1
> artifact UIT** (`sku-eval-last-run.json`). Con số trình bày là số **đo lại được trên
> UIT**, không phải số đẹp nhất được chọn ra.

---

## Slide 10 — Độ đúng: 85,71 %, và 7/8 lỗi là lỗi của chúng tôi

**Nói (đây là slide quan trọng nhất, nói chậm):**

> Trên 56 ca có nhãn, hệ thống đúng 48 (85,71%). Nhưng khi mở từng ca ra, cả **8 ca
> hệ thống tự khớp nhưng nhãn khác** đều có cùng một dấu vết: hệ thống chọn mã khớp
> đúng tên trên sàn — còn người gán chọn mã khác màu, khác trọng lượng hoặc khác họ
> hàng sản phẩm. Trong đó 3 ca **trùng khít từng chữ**.

Chỉ vào bảng (mở file `docs/aisc26/notes/sku-eval-cases.csv` trước khi lên sân khấu):

| Tên trên sàn | Hệ thống chọn | Người gán |
|---|---|---|
| `ALARM CLOCK BAKELIKE RED` | `ALARM CLOCK BAKELIKE RED` **(trùng khít)** | `...BAKELIKE PINK` |
| `Area Patrolled Metal Sign` | `AREA PATROLLED METAL SIGN` **(trùng khít)** | `TOILET METAL SIGN` |
| `ASSORTED COLOURS SILK FAN` | `ASSORTED COLOURS SILK FAN` **(trùng khít)** | `ASSORTED FLOWER COLOUR "LEIS"` |
| `BAG 250g SWIRLY MARBLES (VN)` | `BAG 250g SWIRLY MARBLES` | `JUMBO BAG APPLES` |

8 ca `SAI` trong `sku-eval-cases.csv` là: 2 ca `ALARM CLOCK BAKELIKE RED`, 2 ca
`ASSORTED COLOURS SILK FAN`, 1 ca `Area Patrolled Metal Sign`, 3 ca `BAG ... SWIRLY
MARBLES`. Trong đó `BAG 125g SWIRLY MARBLES` là nghi vấn hai chiều: tên sàn ghi
125g, nhưng hàng thật ngoài cửa hàng có thể là 250g — **chỉ người gán thứ hai gán
mù và người thứ ba phân xử mới quyết được**.

**Chưa phát hiện ca nào trong 8 ca auto-sai mà nhãn rõ ràng đúng hơn** — nhưng đây
là quan sát trên 8 ca, không phải chứng minh. "Chưa phát hiện" không phải "chứng
minh được".

**Nói tiếp:**

> 85,71% **có thể là mức thấp của độ đúng thật**, nhưng chưa thể kết luận. Và chúng
> tôi **không sửa nhãn rồi báo lại con số đẹp hơn** — làm vậy là bịa kết quả. Nhãn
> phải do người thứ hai gán độc lập rồi người thứ ba phân xử. Việc đó chưa xong,
> nên chúng tôi **chưa công bố độ chính xác nào**.

---

## Slide 11 — Câu hỏi khó nhất, và câu trả lời

**Câu ban giám khảo vòng 1 đã đặt:** *"chỉ số của các bạn lấy từ đâu?"*

**Nói:**

> Câu trả lời của chúng tôi không phải một con số. Nó là **quy trình kiểm được
> chuỗi số đó**:
>
> - Các chỉ số F1/CI lấy từ `sku-eval-last-run.json`; phân tích 8 ca SAI lấy từ
>   `sku-eval-cases.csv`. Không có số nào ước lượng.
> - Với con số độ đúng, chúng tôi **mở từng ca** — và chính việc đó phát hiện ra
>   lỗi trong dữ liệu của chính chúng tôi.
> - Chúng tôi **từ chối công bố** một con số mà chúng tôi biết là đo trên nhãn
>   hỏng.

*(Đây là câu nên nói chậm và nhìn thẳng giám khảo.)*

---

# PHẦN D — MỞ LẠI (2 slide)

## Slide 12 — Chúng tôi tìm ra 5 lỗ hổng UI và 1 lỗi sinh mã đêm trong chính sản phẩm mình

**Nói:**

> Khi chuẩn bị demo, chúng tôi bấm thử từng nút trên giao diện — và tìm ra **sáu**
> chỗ hỏng, đều là lỗi thật, đều đã sửa và có kiểm chứng: 5 lỗ hổng UI trong bảng
> dưới đây + 1 lỗi sinh mã đơn trùng mỗi đêm (xem "Nói thêm").

| Lỗi | Trước | Nay |
|---|---|---|
| **Đề xuất nhập không tạo được từ trình duyệt** — có API nhưng không hàm nào gọi tới | màn duyệt luôn trống | có nút `Tạo đề xuất` |
| **98/105 nút chết** vì SKU chưa có NCC — bấm mới biết lỗi | báo lỗi sau khi bấm | nút mờ kèm lý do ngay |
| **Đăng nhập báo "Dữ liệu không hợp lệ"** khi dán email dính khoảng trắng — thông báo không chỉ ra lỗi ở đâu | không biết sửa gì | tự cắt khoảng trắng, báo đúng lỗi |
| **Sửa NCC để trống ô bị chặn** — schema backend từ chối `null` mà form gửi lên | luôn báo sai dữ liệu khi lưu | form gửi null vẫn lưu được, kèm 5 test |
| **Duyệt đề xuất xong, PO rớt về "Nháp"** — duyệt đề xuất không ra "Đã duyệt" | không thấy nút Tạo GRN, vòng mua hàng đứt giữa chừng | PO dưới ngưỡng ra thẳng Đã duyệt, có cờ `decided` + test contract |

**Nói thêm:**

> Một điều nữa: hệ thống tự sinh mã đơn lấy tiền tố ngày theo giờ **UTC** nhưng
> đếm số theo giờ **Việt Nam**. Giữa 0 giờ và 7 giờ sáng, mỗi đêm hệ thống sinh
> lại mã của hôm trước và đụng ràng buộc trùng. Lỗi này chỉ xuất hiện đúng khung
> giờ đó — nên nó nằm im cho tới khi chúng tôi đọc code.

---

## Slide 13 — Việc chưa làm, nói thẳng

| Việc | Vì sao chưa làm |
|---|---|
| **Người gán thứ hai** → có Cohen κ | Cần **hai người thật** gán độc lập rồi người thứ ba phân xử. Một người thì κ không có nghĩa. **Đây là việc chặn mọi con số độ đúng.** |
| 6 người dùng thử | Chưa tuyển được. Bộ ca thử đã dựng sẵn. |
| Phỏng vấn sâu 3–5 cửa hàng | Chưa làm. Bộ 8 câu đã soạn. |

**Nói:**

> Ba việc này **không làm bằng code được**. Và chúng tôi không thay chúng bằng
> những con số bịa.

---

## Slide 14 — Điều chúng tôi muốn nhận

**Nói:**

> Chúng tôi không đến đây để bảo hệ thống của mình hoàn hảo. Ngược lại — phần
> lớn những gì chúng tôi tìm ra trong vòng này là lỗi của **chính chúng tôi**:
> 12 lỗi trong hệ thống (theo `00-index.md` §3.2), 8/56 ca auto-sai trong tập dữ
> liệu đánh giá đều là nghi vấn nhãn, và 5 lỗ hổng UI + 1 lỗi sinh mã đêm tìm ra
> khi bấm thử — kể cả những lỗ mới nhất tìm ra ngay trong buổi chuẩn bị hôm nay.

> Thứ chúng tôi muốn nhận là **một phản hồi trung thực** về chỗ nào chúng tôi
> đang nói quá và chỗ nào chúng tôi đã nói thẳng là chưa có.

---

# Ghi chú cho người trình bày

**Trước khi lên sân khấu:**
- Mở sẵn tab `Duyệt đề xuất nhập`
- Mở sẵn file `docs/aisc26/notes/sku-eval-cases.csv` (slide 10 cần chỉ vào)

**Không được làm:**
- **Không công bố độ chính xác nào** nếu chưa có κ. 85,71 % đo trên nhãn ta biết sai.
- **Không đưa lên slide dòng "recall = 1,0"** mà không kèm giải thích.
- **Không trích một số F1 đơn lẻ.**
- **Không bịa thêm câu trả lời khảo sát.** Câu 8/19/20/23 là câu hỏi mở, cả 10 quán
  trả lời giống nhau vì dạng gợi ý có danh mục — dùng được ở mức "10/10 đồng ý",
  không dùng được ở mức tần suất từ.
- **Không nói câu chào "rẻ hơn POS"** — trung vị WTP 149.000đ thấp hơn trung vị đang
  trả 160.000đ.

**Nếu bị hỏi:**

| Câu hỏi | Trả lời |
|---|---|
| "AI có tự tạo PO không?" | **Không.** Slide 6 — phải tick ô và bấm Duyệt |
| "Hàng rào có chạy thật không?" | Slide 5 — bấm nút, nó báo chặn |
| "Sao không dùng model mạnh hơn?" | Ba model khác hàng cho cùng kết quả — nút cần siết không phải nút model |
| "Có người dùng thật chưa?" | **0/6.** Không bịa |
| "Độ chính xác bao nhiêu?" | **Chưa công bố được.** Slide 10 nói rõ vì sao |
