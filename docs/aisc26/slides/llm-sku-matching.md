# AISC'26 — Nội dung slide: đo LLM khớp mã hàng

> **Nguyên tắc khi trình bày:** chỉ đưa lên slide những số có trong
> `docs/aisc26/notes/sku-eval-last-run.json` và `sku-eval-cases.csv`. Mọi khẳng
> định dưới đây đều kiểm được bằng lệnh, không ước lượng.
> Lệnh sinh lại: `npm run llm:eval -- --mode live`

---

## Slide 1 — Vấn đề: nhập hàng bằng tên, không phải mã

Chủ shop có tên hàng viết tay trên tem, PDF, tin nhắn. ERP cần mã hàng.

Khoảng cách giữa hai thứ đó là **thời gian nhân viên ngồi tra cức từng dòng**.

Đã khảo sát **10 cửa hàng thật** (10/10 dùng sổ, Excel hoặc POS để đối chiếu;
1/10 dùng phần mềm quản lý). Đây là bài toán thật, không phải bài toán giả định.

---

## Slide 2 — Cách làm: hai tầng, công thức trước, LLM sau

```
tên trên tem  →  [ khớp mờ ]  →  [ LLM chọn ]  →  [ người duyệt ]
                điểm 0,62–0,86      ≤ 8 ca / 60      confidence < 0,85
                    ↓
                điểm ≥ 0,86 → ghi thẳng, KHÔNG gọi LLM
```

Điểm cốt lõi: **LLM chỉ được hỏi ở dải mơ hồ.** Ở ngoài dải đó dùng công thức —
nhanh, miễn phí, và không tốn lời gọi nào.

Ngưỡng chốt trước khi đo: tự ghi 0,86 · xem lại 0,62 · đưa người 0,85.

---

## Slide 3 — Bộ đo

| | |
|---|---|
| Số cặp | 120 (107 có nhãn) |
| Tách | 60 kiểm định / 60 phát triển — tách trước khi đo, không trộn |
| Nhãn | Người gán tay, gán mù, không sửa sau khi đo |
| Bằng chứng | Từng ca ghi ra CSV: tên, 5 ứng viên, điểm công thức, LLM chọn, nhãn, kết quả |

**Không dùng tổng P/R/F1 làm con số chính.** Bảng từng ca mới là bằng chứng —
và nó đã phát hiện ra điều mà P/R/F1 giấu.

---

## Slide 4 — Kết quả: LLM KHÔNG làm tăng độ đúng

| Chỉ số | Chỉ công thức | Có LLM |
|---|---:|---:|
| **Độ chính xác thô (48/56 ca có nhãn)** | **85,71 %** | **85,71 %** |
| Ca tự ghi sai — ghi sai DB âm thầm | 7 | 8 |
| Ca phải chuyển người duyệt | 13,33 % | **1,67 %** |

**Đọc đúng:** độ đúng y hệt. Cái thay đổi là **ai phải xác nhận**.

Đây là con số không bịa được và cũng không đẹp. Nói ra thành tín hiệu
trung thực: ta tối ưu **giảm gánh nặng cho người**, chứ chưa tối ưu độ đúng.

> ⚠️ **Con số 48/56 này đang đo trên một tập nhãn có lỗi.** Kiểm tra từng ca cho
> thấy **7 trong 8 lỗi là người gán sai, không phải hệ thống sai** (slide 6).
> Nghĩa là 48/56 là **mức thấp của độ đúng thật**, không phải mức cao. Chưa sửa
> nhãn thì chưa được công bố con số độ đúng nào.

---

## Slide 5 — Chỗ thắng đo được, không suy ra từ F1

**CI95 của chênh lệch F1 = [0,0008 ; 0,0969] — không chứa 0.**

Đo **5 lần**, không trích một số đơn lẻ:

| Lần | F1 | Chuyển người | Độ đúng thô | CI95 |
|---|---:|---:|---:|---|
| 1 | 0,8972 | 1,67 % | 48/56 | [0,0008 ; 0,0969] |
| 2 | 0,8972 | 1,67 % | 48/56 | [0,0008 ; 0,0969] |
| 3 | 0,8972 | 1,67 % | 48/56 | [0,0008 ; 0,0969] |
| 4 | 0,8972 | 1,67 % | 48/56 | [0,0008 ; 0,0969] |
| 5 | 0,8972 | 1,67 % | 48/56 | [0,0008 ; 0,0969] |

**5/5 lần y hệt nhau.** Trên Gemini `3.5-flash-lite` cùng bộ ca này dao động
F1 0,8654–0,8868 và **CI95 luôn chứa 0** — tức con số trình bày ở đây là số ta
đo được lại được, không phải số may rủi.

Phần cải thiện nhìn thấy được là **số ca phải chuyển người giảm từ 13,33 % xuống 1,67 %** —
đo trực tiếp, không cần suy ra từ F1.

---

## Slide 6 — Kiểm tra từng ca, và phát hiện lớn nhất: lỗi nằm ở NHÃN

Ta không dừng ở P/R/F1. Bảng từng ca cho phép mở ra từng lỗi và đối chiếu
**tên sản phẩm hệ thống chọn** với **tên sản phẩm người gán chọn**.

Trong 8 ca bị đánh dấu SAI:

| Kết luận | Số ca |
|---|---:|
| **Hệ thống đúng, người gán sai** | **7** |
| Hệ thống sai, người gán đúng | **0** |
| Không rõ | 1 |

Bằng chứng — chỉ cần đọc tên:

| Ca | Tên trên sàn | Hệ thống chọn | Người gán chọn |
|---|---|---|---|
| SKU-084 | `ALARM CLOCK BAKELIKE RED` | `ALARM CLOCK BAKELIKE RED` **(trùng khít)** | `ALARM CLOCK BAKELIKE PINK` |
| SKU-104 | `ASSORTED COLOURS SILK FAN` | `ASSORTED COLOURS SILK FAN` **(trùng khít)** | `ASSORTED FLOWER COLOUR "LEIS"` |
| SKU-112 | `Area Patrolled Metal Sign` | `AREA PATROLLED METAL SIGN` **(trùng khít)** | `TOILET METAL SIGN` |
| SKU-119 | `BAG 250g SWIRLY MARBLES (VN)` | `BAG 250g SWIRLY MARBLES` **(trùng khít)** | `JUMBO BAG APPLES` |

**Không có ca nào hệ thống sai mà nhãn đúng.**

Hệ quả, nói thẳng:

1. **85,71 % là mức thấp của độ đúng thật**, không phải mức cao. Sửa nhãn thì
   con số này lên, không xuống.
2. **Ta không sửa nhãn rồi báo lại** — làm vậy là bịa kết quả. Nhãn phải do
   **người thứ hai gán độc lập** rồi người thứ ba phân xử.
3. **Cohen κ không còn là xa xỉ.** Nó thiết kế để bắt đúng loại lỗi này: hai người
   cùng gán, lệch nhau thì lộ ra. Một người gán thì κ = null, và đó là câu trả lời
   đúng chứ không phải thiếu sót.

> Đây cũng là câu trả lời sẵn có cho câu hỏi khó nhất của ban giám khảo vòng 1:
> *"chỉ số của các bạn lấy từ đâu?"* — Câu trả lời không phải một con số, mà là
> **quy trình kiểm tra được chuỗi số đó.**

---

## Slide 7 — Hai điều nữa phải nói mặt ngược

**1. Sai nhiều hơn, chỉ kín hơn.** Ca tự ghi sai tăng **7 → 8**. Một ca vốn được
chuyển người duyệt giờ bị ghi thẳng vào DB. Người dùng ít việc hơn, nhưng dữ liệu
bẩn hơn trước. Chỉ số này **giữ nguyên ý nghĩa** vì nó không phụ thuộc nhãn đúng
hay sai — nó đo hành vi hệ thống.

**2. Recall = 1,0 là ảo.** Công thức chấm tính ca trả sai vào `false positive`,
không tính vào recall. Hệ thống trả sai 8 ca mà vẫn có recall hoàn hảo nếu
không đưa ca nào ra người. **Đây là lý do slide 4 dùng độ chính xác thô** và
**slide 6 dùng đối chiếu tay từng ca.**

---

## Slide 8 — Ba model khác hàng, một kết luận

Cùng bộ 60 ca kiểm định, cùng một bộ nhãn:

| Model | Đường truy cập | Hạn mức | 1 lần đo | F1 |
|---|---|---|---:|---:|
| Gemini `3.5-flash-lite` | Google AI Studio | **20 lần/ngày** | 44–119 giây | 0,8654–0,8868 |
| Ollama `gemma4:31b-cloud` | 9router → Ollama đám mây | Không giới hạn | 21 giây | 0,8972 |
| **UIT `gemma-4-26b`** | Máy chủ trường | Không giới hạn | **17 giây** | **0,8972** |
| *(đo đối chiếu)* chỉ công thức | — | — | — | 0,8515 |

**UIT 5/5 lần cho kết quả giống hệt nhau**, tới cả CI95. Gemini dao động và
CI95 luôn chứa 0.

**Ba model khác hàng cho ra cùng một kết quả.** Không phải ngẫu nhiên: tám ca
duy nhất được hỏi LLM đều đủ rõ, và cả ba model trả lời như nhau.

> **Chọn model không phải nút cần siết.** Chỗ cần sửa là **cổng chuyển câu hỏi** —
> nhưng **chưa được sửa**, vì chưa sửa được cho tới khi có nhãn đúng (slide 6).
> Tinh chỉnh ngưỡng trên một tập nhãn hỏng là tối ưu vào sai chỗ.

**Vì sao chọn UIT:** không giới hạn, nhanh nhất (725–800 ms mỗi lời gọi), và
tái lập được. Chi phí mỗi ca kiểm định: **102,9 token**.

---

## Slide 10 — Ba việc chưa làm được, và vì sao

| Việc | Vì sao chưa làm |
|---|---|
| **Sửa nhãn sai** + **Cohen κ** | Cần **hai người thật** gán độc lập rồi người thứ ba phân xử. Một người thì κ không có nghĩa. **Đây là việc số 1.** |
| 6 người dùng thử | Cần người thật, bộ dụng cụ đã sẵn |
| Phỏng vấn sâu 3–5 cửa hàng | Cần người thật, bộ 8 câu đã soạn |

**Không có cái nào trong ba cái này làm bằng code.** Và không cái nào được
thay bằng con số bịa ra.

---

## Slide 11 — Việc tiếp theo

1. **Người gán thứ hai** → có κ, và phân xử lại 7 ca nhãn sai ở slide 6.
   Đây là việc **chặn** mọi con số độ đúng khác.
2. Chỉ sau đó mới tinh chỉnh cổng chuyển câu hỏi và đo lại — tinh chỉnh trên
   tập nhãn hỏng là tối ưu vào sai chỗ.
3. 6 người thử + phỏng vấn sâu
4. Chốt giá gói theo **phủ WTP thực tế** từ khảo sát (10 quán), không theo giá
   đề xuất ban đầu

---

## Ghi chú dành cho người trình bày

- **Không đưa lên slide dòng "recall = 1,0"** mà không kèm giải thích slide 7.
- **Không công bố độ chính xác nào cho tới khi có κ.** 85,71 % đang đo trên tập
  nhãn mà chính ta biết là sai 7 ca. Sửa nhãn rồi báo lại = bịa kết quả.
- **Nói thẳng 7 → 8 ca tự ghi sai.** Giấu thì giám khảo hỏi là lộ.
- **Chủ động nêu slide 6 trước khi giám khảo hỏi.** Tự phát hiện lỗi trong dữ
  liệu của chính mình và nói ra là điểm cộng; để giám khảo phát hiện thì mất
  điểm. Đây cũng là câu trả lời sẵn cho *"chỉ số của các bạn lấy từ đâu?"*.
- **Không trích một con số F1 đơn lẻ.** Báo 0,8972 với UIT (5/5 lần giống nhau)
  và nói rõ nó đo trên nhãn chưa kiểm.
- **Không bịa thêm câu trả lời khảo sát.** Câu 8/19/20/23 là câu hỏi mở, mọi quán
  trả lời giống nhau vì dạng gợi ý có danh mục — dùng được ở mức "10/10 đồng ý",
  không dùng được ở mức tần suất từ.
- **Giá WTP trung vị 149.000đ thấp hơn trung vị đang trả 160.000đ.** Đây là điểm
  yếu phải nói trước: không bán bằng lập luận "rẻ hơn POS", vì 5/10 quán đang
  trả 110.000–250.000đ cho POS.
