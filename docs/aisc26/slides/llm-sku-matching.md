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

---

## Slide 5 — Chỗ thắng đo được, không suy ra từ F1

**CI95 của chênh lệch F1 = [0,0008 ; 0,0969] — không chứa 0.**

| Lần chạy | F1 | Chuyển người | CI95 có chứa 0 |
|---|---:|---:|---|
| Chỉ công thức | 0,8515 | 13,33 % | — |
| Có LLM (Ollama `gemma4:31b-cloud`) | 0,8972 | 1,67 % | **không** |
| Có LLM (Gemini `3.5-flash-lite`, 5 lần) | 0,8654–0,8868 | 3,33–6,67 % | **luôn chứa** |

Phần cải thiện nhìn thấy được là **số ca phải chuyển người giảm từ 13,33 % xuống 1,67 %** —
đo trực tiếp, không cần suy ra từ F1.

---

## Slide 6 — Nhưng vẫn phải nói mặt ngược

Ba điều mà nếu giấu thì giám khảo hỏi là lộ:

**1. Sai nhiều hơn, chỉ kín hơn.** Ca tự ghi sai tăng 7 → 8. Một ca vốn được
chuyển người duyệt giờ bị ghi thẳng vào DB. Người dùng ít việc hơn, dữ liệu
bẩn hơn trước.

**2. Recall = 1,0 là ảo.** Công thức chấm tính ca trả sai vào `false positive`,
không tính vào recall. Hệ thống trả sai 8 ca mà vẫn có recall hoàn hảo nếu
không đưa ca nào ra người. **Đây là lý do slide 4 dùng độ chính xác thô.**

**3. Chưa đo được độ tin cậy của nhãn.** Cohen κ = chưa có, vì mới có một người
gán. κ chỉ có nghĩa khi hai người thật gán độc lập. Việc này **không làm bằng
code** — cần người.

---

## Slide 7 — Vì sao LLM không sửa được phần lớn lỗi

Trong 8 ca sai, **7 ca LLM chưa từng được hỏi**:

| Ca | Công thức đoán | Điểm tin cậy | Có hỏi LLM? |
|---|---|---:|---|
| SKU-084 | 22727 | **1,0000** | Không |
| SKU-104 | 15036 | **1,0000** | Không |
| SKU-112 | 82582 | **1,0000** | Không |
| SKU-086 / 106 / 118 / 119 | — | 0,89 – 0,94 | Không |

Công thức **tự tin và sai**. Ngưỡng chuyển câu hỏi dựa trên điểm tin cậy của
công thức, nên **ca sai nhất lại là ca không bao giờ được hỏi**.

LLM chỉ được hỏi 8/60 ca. Trên 6 ca có nhãn để đối chiếu: **đúng 5, sai 1 (83,3 %)**.

> Đây là **hạn chế kiến trúc, không phải hạn chế của mô hình.** Muốn LLM sửa lỗi
> thì phải cho nó nhìn thấy chỗ nghi ngờ. Hướng sửa: hạ ngưỡng chuyển câu hỏi,
> hoặc bắt buộc hỏi LLM khi có nhiều ứng viên cùng họ sản phẩm.

---

## Slide 8 — Ca sai duy nhất của LLM: nghi vấn là nhãn, không phải AI

**SKU-117 — `"BAG 125g SWIRLY MARBLES - HANG MOI"`**

| | Mã | Tên trong danh mục |
|---|---|---|
| LLM chọn | 21703 | BAG **125g** SWIRLY MARBLES |
| Nhân | 21704 | BAG **250g** SWIRLY MARBLES |

Ba ca cùng họ, tên đều ghi **125g**:

| Ca | Nhân của người A |
|---|---|
| SKU-116 `BAG 125g SWIRLY` | 21703 (125g) |
| SKU-117 `…- HANG MOI` | **21704 (250g)** |
| SKU-118 `…- SALE` | **21704 (250g)** |

Người gán **không nhất quán với chính mình** trên cùng mã thứ "125g".

> **Kết luận trung thực:** nhiều khả năng là **lỗi gán nhãn**. Nhưng chưa ai kiểm
> chứng được. Cho đến khi người gán B và người phân xử quyết, **một phần trong số
> đo đang lấy một nhãn có vẻ sai làm chuẩn** — và đây cũng là lý do κ là cần
> thiết chứ không phải xa xỉ.

---

## Slide 9 — Vì sao dùng model miễn phí

| | Gemini `3.5-flash-lite` | Ollama `gemma4:31b-cloud` |
|---|---|---|
| Hạn mức | **20 lần/ngày** | Không giới hạn |
| Thời gian một lần đo | 44 – 119 giây | **21 giây** |
| Độ đúng thô | 85,5 % | **85,7 %** |

Giới hạn 20 lần/ngày khiến **không thể đo lặp lại** — mà đo lặp lại mới là
cách duy nhất biết con số có ổn không. Model miễn phí đổi lấy khả năng chạy
5 lần, 10 lần, và báo cáo một **khoảng** thay vì một con số đơn lẻ.

Chi phí mỗi ca kiểm định: **99,8 token**.

---

## Slide 10 — Ba việc chưa làm được, và vì sao

| Việc | Vì sao chưa làm |
|---|---|
| Cohen κ | Cần **hai người thật** gán độc lập. Một người thì κ không có nghĩa. |
| 6 người dùng thử | Cần người thật, bộ dụng cụ đã sẵn |
| Phỏng vấn sâu 3–5 cửa hàng | Cần người thật, bộ 8 câu đã soạn |

**Không có cái nào trong ba cái này làm bằng code.** Và không cái nào được
thay bằng con số bịa ra.

---

## Slide 11 — Việc tiếp theo

1. Hạ ngưỡng chuyển câu hỏi / bắt buộc hỏi LLM khi nhiều ứng viên cùng họ
   → đây là cách **giảm 7 lỗi LLM chưa từng thấy**
2. Người gán thứ hai → có κ, và phân xử lại các ca bất thường như SKU-117
3. 6 người thử + phỏng vấn sâu
4. Chốt giá gói theo **phủ WTP thực tế** từ khảo sát (10 quán), không theo giá
   đề xuất ban đầu

---

## Ghi chú dành cho người trình bày

- **Không đưa lên slide dòng "recall = 1,0"** mà không kèm giải thích slide 6.
- **Nói thẳng 7 → 8 ca tự ghi sai.** Giấu thì giám khảo hỏi là lộ.
- **Không trích một con số F1 đơn lẻ.** Báo khoảng 0,8654–0,8868 (Gemini) và
  nói rõ CI95 có chứa 0.
- **Không bịa thêm câu trả lời khảo sát.** Câu 8/19/20/23 là câu hỏi mở, mọi quán
  trả lời giống nhau vì dạng gợi ý có danh mục — dùng được ở mức "10/10 đồng ý",
  không dùng được ở mức tần suất từ.
- **Giá WTP trung vị 149.000đ thấp hơn trung vị đang trả 160.000đ.** Đây là điểm
  yếu phải nói trước: không bán bằng lập luận "rẻ hơn POS", vì 5/10 quán đang
  trả 110.000–250.000đ cho POS.
