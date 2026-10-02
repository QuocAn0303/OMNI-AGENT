# 03 — Giao thức đánh giá (backtest)

**Ngày:** 2026-10-02 · **Nhánh:** `round2/p0-hardening`
**Trạng thái:** **CHỐT TRƯỚC KHI CHẠY.** Tài liệu này được commit *trước* mọi lần chạy backtest, và **không sửa sau khi thấy số**.

> **Vì sao chốt trước:** giám khảo sẽ hỏi *"bạn có chỉnh để đẹp không?"*. Câu trả lời mạnh nhất là: *"Giao thức commit trước, kèm mốc commit trong báo cáo. Sau khi thấy số chúng tôi không sửa gì; nếu có sửa, commit sau cùng bản diff đã được merge trước đó."*

**Nguồn dữ liệu:** `[CHỜ ĐỘI ĐIỀN]` — xem `00-scope.md` §5.2.
Quy tắc áp dụng: hết hạn mà chưa có dữ liệu thật ⇒ dùng **dataset công khai**, dán nhãn rõ trên mọi slide.

---

## 1. Câu hỏi cần trả lời

> **Với một shop bán lẻ nhiều kênh, liệu phép tính ROP + đề xuất đặt hàng tự động có tốt hơn việc chủ shop tự nhập tay không — và tốt hơn mức tồn tối thiểu cố định (`minStock`) không?**

Ba phương án so sánh. Không có phương án nào được thêm sau khi thấy số.

| Mã | Phương án | Mô tả |
|---|---|---|
| **P1** | `minStock` cố định (baseline hiện trạng) | Đặt lại khi `ATP ≤ minStock` (ngưỡng tĩnh), số lượng = `max(1, (minStock*2 − ATP) * 1.2)`. Đây là **hiện trạng** của `automation.service.js:49,209` |
| **P2** | Trung bình trượt + ROP | `demandPerDay` = trung bình 28 ngày (đã hiệu chỉnh censored), `ROP = d×LT + SS`, `(R,S)` chu kỳ rà soát 7 ngày |
| **P3** | MA 28 ngày, nhưng SKU thưa dùng Croston | Như P2 nhưng chọn phương pháp theo mật độ bán |

**Không** đưa thêm baseline "chủ shop tự nhập tay" vào bảng điểm chính nếu không có dữ liệu nhập tay. Không có dữ liệu ⇒ không có baseline đó.

---

## 2. Cách chia dữ liệu theo thời gian

**Không** chia ngẫu nhiên — chia theo trục thời gian, vì bài toán là dự báo.

| Tập | Khoảng | Dùng để |
|---|---|---|
| **Huấn luyện / quan sát** | Từ đầu đến hết tháng **T−2** | Tính `demandPerDay`, `sigmaDaily`, `leadTime` |
| **Bộ tham số giữa** | Tháng **T−1** | Chọn `serviceLevel`, `QTY_DRIFT_TOL`… **không** dùng để báo cáo |
| **Kiểm định (out-of-sample)** | Tháng **T** | **Mọi con số công bố đều lấy ở đây** |

Với dữ liệu < 3 tháng: chia 60% / 20% / 20% theo thời gian, và **ghi rõ** rằng mẫu nhỏ.

> **Quy tắc cứng:** con số nào lấy từ tập quan sát hoặc tập giữa mà lại đưa ra slide → sai. Backtest phải viết script chặn việc này: mọi hàm báo cáo nhận `slice: 'test'` và refuse nếu không phải.

---

## 3. Xử lý ngày hết hàng (censored demand)

Đây là điểm quyết định độ trung thực của kết quả. Không xử lý thì mô hình **tự báo cáo mình giỏi**.

### 3.1. Vì sao quan trọng

Ngày hết hàng, doanh số = 0 **không phải nhu cầu = 0**. Nếu lấy trung bình cộng thẳng, mô hình học "hàng này bán chậm" đúng lúc hàng hết ⇒ đặt thiếu ⇒ hết hàng tiếp. Vòng lặp tệ hơn hệ thống không có mô hình.

### 3.2. Quy tắc (chốt trước khi chạy)

| Vấn đề | Quy tắc |
|---|---|
| Đánh dấu ngày censored | `ATP cuối ngày ≤ 0` **hoặc** ngày nằm trong khoảng thiếu hàng do PO chưa tới |
| Hiệu chỉnh | Ngày censored: `demand = max(bán thực tế, TB các ngày không censored)` |
| Báo cáo | Công bố `censoredDayRatio` **bắt buộc**. Tỉ lệ > 30% ⇒ kết luận phải nói rõ độ tin cậy thấp |
| SKU bán thưa | `< 10` ngày có bán trong 90 ngày ⇒ Croston (`calc.js` tự chọn) |
| Ước lượng mất doanh thu do hết hàng | **Không** dùng "số bán bị mất = TB" một cách tự do. Nếu công bố, phải nêu rõ giả định và khoảng |

### 3.3. Đánh giá riêng chất lượng dữ liệu

Báo cáo `censoredDayRatio` và `sparseSkuRatio` cho từng SKU trước khi đánh giá mô hình. SKU có `sparseSkuRatio` cao và ít dữ liệu được **loại khỏi tập đánh giá** — và phải nói số lượng bị loại.

---

## 4. Chỉ số — định nghĩa chính xác trước khi chạy

### 4.1. Chỉ số chính: WAPE theo SKU

```
WAPE = Σ|y_thực − y_dự_báo| / Σ y_thực        (trên tập kiểm định, tất cả SKU gộp lại)
```

Báo **kèm theo**: số SKU, tổng số lần bán, và **kèm WAPE của từng baseline**. Chỉ số không có baseline vô nghĩa.

Chọn WAPE vì MAPE trả về lỗi vô hạn khi `y_thực = 0` — với dữ liệu bán lẻ có nhiều ngày bán 0 thì MAPE hỏng. **MAPE chỉ báo thêm** trên tập SKU có `y_thực > 0`, nếu báo thì phải nói rõ đã loại bao nhiêu SKU.

### 4.2. Chỉ số nghiệp vụ (mô phỏng, giả định phải nêu)

| Chỉ số | Công thức | Giả định phải ghi |
|---|---|---|
| **Ngày hết hàng mô phỏng** | Số ngày có `ATP ≤ 0` trong mô phỏng | Nhu cầu trong ngày hết hàng = nhu cầu hiệu chỉnh |
| **Doanh thu mất** | `Σ (nhu_cầu ẩn − bán thực tế)` × giá trong ngày `ATP ≤ 0` | Giả định mỗi đơn trung bình bằng đơn vị; giá dùng giá niêm yết |
| **Giá trị tồn dư cuối kỳ** | `Σ (tồn cuối × giá vốn)` | Không tính hàng hết hạn/hàng chết |
| **Tổng chi phí** | Giá vốn mua + giá vốn tồn dư | **Không** tính chi phí cơ hội hay tỷ lệ lỗi |

**Điểm phải nói thẳng:** "ngày hết hàng mô phỏng" là mô phỏng, không phải quan sát thật. Ngày hết hàng thật là quan sát; ngày hết hàng **có thể đã xảy ra** nhưng bị ghi nhận sai thì không sửa được. Không được bán con số mô phỏng như số quan sát.

### 4.3. Chỉ số cần đo trên người thật — không thay bằng mô phỏng

**Thời gian thao tác.** Chỉ số này **không** lấy từ dataset công khai được.

| | Quy trình cũ | Quy trình mới |
|---|---|---|
| Bấm giờ | Chủ shop tự nhập số lượng nhập | Chủ shop duyệt đề xuất có sẵn |
| Cỡ mẫu | `[ĐỘI ĐIỀN: số người]` | |
| Cách đo | Bấm giờ từng bước, có người quan sát | |

Nếu cỡ mẫu < 5 người ⇒ **không công bố phần trăm**, chỉ công bố thời gian trung vị và khoảng. Mẫu 3 người không đủ để nói "giảm 90%".

---

## 5. Chi phí LLM

Không đo được bằng mô phỏng — phải từ token thật.

| Số cần công bố | Công thức |
|---|---|
| Token/ngày/tenant | `Σ prompt + completion tokens` từ `LlmUsageLog` ÷ số ngày ÷ số tenant |
| Chi phí/ngày/tenant | token × đơn giá **theo đơn giá nhà cung cấp tại ngày đo** |
| Chi phí/tháng/tenant | × 30 |

Điều kiện: phải có `LlmUsageLog` (gộp vào migration P0-3) và **phải chạy `live` với Gemini**, không dùng số từ `replay`.

**Nếu chưa đo được:** ghi *"chưa đo"* trên slide. **Tuyệt đối không ước lượng rồi đưa ra slide** — đây đúng là loại con số không có căn cứ mà ban tổ chức đã chỉ ra ở Vòng 1.

---

## 6. Chống "chỉnh cho đẹp"

Ba hành động bị cấm sau khi đã thấy số:

1. Đổi công thức/tham số rồi chạy lại và báo kết quả mới **mà không** báo cả kết quả cũ.
2. Loại SKU sau khi biết mô hình sai trên SKU đó.
3. Đổi tập kiểm định hoặc cách chia dữ liệu.

Nếu thực sự cần sửa gì sau khi thấy số: mô tả lý do, báo **cả hai kết quả**, và ghi vào báo cáo là *"phát hiện sau backtest, đã sửa"*.

---

## 7. Định dạng kết quả

Mỗi bảng kết quả phải kèm:

```
Nguồn dữ liệu : [thật / công khai — nêu tên + URL + ngày truy cập]
Khoảng thời gian: [từ] → [đến]
Cỡ mẫu       : [số SKU], [tổng số đơn], [số kênh]
censoredDayRatio: [x]%      sparseSkuRatio: [y]%
Tập đánh giá  : tháng T (out-of-sample)
Lệnh chạy lại : npm run backtest -- --slice=test --as-of=YYYY-MM-DD
Commit giao thức: <hash>   ← commit của file này
```

Lệnh phải **chạy lại được từ sạch** và cho ra cùng kết quả.

---

## 8. Rủi ro đã biết của chính giao thức này

| Rủi ro | Giảm bằng cách nào |
|---|---|
| Dataset công khai không giống hành vi shop Việt | Ghi rõ trên slide; không suy rộng kết luận ra thị trường |
| Một lần chia 60/20/20 nhạy cảm với cách chia | Báo cáo thêm kết quả trên **hai** cách chia khác nhau; nếu kết luận đổi chiều ⇒ nói thẳng là chưa vững |
| Backtest không mô phỏng được việc người duyệt chậm, người duyệt từ chối | Ghi vào giả định; có thể chạy phân tích độ nhạy với độ trễ duyệt 0h / 8h / 24h |
| Chỉ 1 tenant ⇒ kết quả không đại diện | Nêu rõ; không nói "cho doanh nghiệp Việt Nam", chỉ nói "trên tập dữ liệu này" |

---

## 9. Trạng thái

| Mục | Trạng thái |
|---|---|
| Giao thức | ✅ **Đã commit trước khi chạy** |
| Script backtest | ⏸ Chưa viết (không phụ thuộc nguồn dữ liệu) |
| Nguồn dữ liệu | ⛔ `[CHỜ ĐỘI ĐIỀN]` |
| Người thử thời gian thao tác | ⛔ `[CHỜ ĐỘI ĐIỀN]` |
| `LlmUsageLog` | ⛔ Chưa có — cần migration ở P0-3 |

**Không chạy backtest nào cho đến khi script tồn tại và đọc được nguồn dữ liệu.** Chạy tay một phép tính rồi điền kết quả vào đây là vi phạm giao thức.