# Phân tích từng ca — LLM trả lời ĐÚNG hay SAI

**Ngày:** 2026-10-15 · **Mô hình:** `gemini-3.5-flash-lite` · **mode:** `live`
**Dữ liệu thô:** [`sku-eval-cases.csv`](./sku-eval-cases.csv) — 60 cặp kiểm định, mỗi dòng một ca.

> **Vì sao tài liệu này tồn tại.** Tổng P/R/F1 cho biết *điểm số*, không cho biết
> *sai ở đâu và sai vì sao*. Giám khảo hỏi "chỉ số lấy từ đâu" thì phải mở được từng ca.
> Lệnh sinh lại: `npm run llm:eval -- --mode live`.

---

## 1. Kết quả bốn dòng

| | Dùng được để so | Đúng | Sai |
|---|---:|---:|---:|
| **Chỉ công thức** tự động áp dụng | 50 | **43** | **7** |
| **LLM** tự quyết định áp dụng | 5 | **4** | **1** |

Ngoài ra: 1 ca LLM chọn mã nhưng bộ dữ liệu **chưa có nhãn** để so (SKU-079) — không tính
vào đúng, cũng không tính vào sai.

**LLM đúng 4/5 = 80%** trên những ca nó tự quyết định và có nhãn đối chiếu.

---

## 2. Ca LLM trả lời sai — và nghi vấn nhãn, chứ không phải lỗi AI

**SKU-117 — `"BAG 125g SWIRLY MARBLES - HANG MOI"`**

| | Mã | Tên trong danh mục |
|---|---|---|
| LLM chọn | **21703** | BAG 125g SWIRLY MARBLES |
| Nhân đúng | **21704** | BAG **250g** SWIRLY MARBLES |

Nhìn ba ca cùng họ:

| Ca | Tên trên sàn | Nhân của người A |
|---|---|---|
| SKU-116 | `BAG 125g SWIRLY` | 21703 (125g) |
| SKU-117 | `BAG 125g SWIRLY MARBLES - HANG MOI` | **21704 (250g)** |
| SKU-118 | `BAG 125g SWIRLY MARBLES - SALE` | **21704 (250g)** |

Tên sàn của cả ba đều ghi **125g**. Người gán đánh 116 là 125g nhưng đánh 117 và 118 là
250g — **thiếu nhất quán với chính mình** trên cùng một mã thứ "125g". LLM chọn 21703
(125g), khớp với SKU-116 và khớp với chữ "125g" trong tên.

> **Kết luận:** đây nhiều khả năng là **lỗi gán nhãn**, không phải lỗi AI. Nhưng chưa ai
> kiểm chứng được — người gán B và người phân xử phải quyết. **Tới lúc đó số liệu P/R/F1
> ở trên chưa chắc đúng**, vì nó đang lấy một nhãn có vẻ sai làm chuẩn.
>
> Việc này cũng cho thấy vì sao **Cohen κ là cần thiết chứ không phải xa xỉ**: một lần
> gán không đủ làm chuẩn.

---

## 3. Phát hiện lớn nhất: LLM không thấy phần lớn lỗi

Trong 8 ca mà công thức trả lời sai, **7 ca LLM chưa từng được hỏi**:

| Ca | Công thức đoán | Điểm tin cậy | LLM có được hỏi? |
|---|---|---:|---|
| SKU-084 | 22727 | **1,0000** | Không |
| SKU-086 | 22727 | 0,9356 | Không |
| SKU-104 | 15036 | **1,0000** | Không |
| SKU-106 | 15036 | 0,8988 | Không |
| SKU-112 | 82582 | **1,0000** | Không |
| SKU-117 | 21703 | 0,8586 | Có |
| SKU-118 | 21703 | 0,9129 | Không |
| SKU-119 | 21704 | 0,9447 | Không |

Công thức **tự tin và sai**: 4 ca điểm tuyệt đối 1,0000. Ngưỡng chuyển câu hỏi cho LLM
lấy theo điểm tin cậy, nên những ca sai nhất lại là những ca **không bao giờ** được hỏi.

LLM chỉ được hỏi **8/60 ca (13,3%)**. Nó không thể sửa 7 lỗi kia — không phải vì nó
trả lời sai, mà vì nó **chưa từng nhìn thấy chúng**.

> **Đây là hạn chế kiến trúc, không phải hạn chế của mô hình.** Muốn LLM sửa lỗi thì phải
> cho nó nhìn thấy chỗ nghi ngờ. Hướng sửa: hạ ngưỡng chuyển câu hỏi, hoặc thêm một quy
> tắc bắt buộc hỏi LLM khi có nhiều ứng viên cùng họ sản phẩm (ví dụ `ALARM CLOCK`
> khác màu, `BAG 125g/250g` khác trọng lượng).
>
> **Đây là việc cần làm tiếp, chưa làm** — nó nằm ngoài phạm vi lượt sửa lỗi này.

---

## 4. Đọc đúng con số tổng

Số đo trên slide phải nói kèm hai điều, nếu không là nói sai:

1. **Cải thiện F1 chưa chứng minh được.** CI95 vẫn chứa 0 ở mọi lần chạy.
2. **Phần cải thiện nhìn thấy được nằm ở chỗ khác:** số ca phải chuyển người xác nhận giảm
   từ 13,33% xuống 3,33–6,67%. Cái này đo trực tiếp, không suy ra từ F1.

Còn phần chính xác thì bảng §1 trả lời thẳng: **trên 5 ca có thể kiểm, LLM đúng 4.**