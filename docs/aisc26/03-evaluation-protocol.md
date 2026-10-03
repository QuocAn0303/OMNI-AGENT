# 03 — Giao thức đánh giá (backtest)

**Ngày soạn:** 2026-10-02 · **Sửa theo S1–S12:** 2026-10-03 · **Nhánh:** `round2/p0-hardening`
**Trạng thái:** **CHỐT TRƯỚC KHI CHẠY.** Tài liệu này được commit *trước* mọi lần chạy
backtest, và **không sửa sau khi thấy số** (xem §10).

> **Vì sao chốt trước:** giám khảo sẽ hỏi *"bạn có chỉnh để đẹp không?"*. Câu trả lời
> mạnh nhất là: *"Giao thức commit trước, kèm mốc commit trong báo cáo. Sau khi thấy số
> chúng tôi không sửa gì; nếu có sửa, commit sau cùng bản diff đã được merge trước đó."*

> **Chưa có lần chạy nào.** Tại thời điểm sửa này `package.json` **không có** script
> `backtest`, `scripts/` không có tệp backtest nào, `docs/aisc26/notes/` chưa tồn tại.
> Việc sửa S1–S12 vì thế **không phụ thuộc vào bất kỳ con số nào** — đã kiểm chứng bằng
> `Select-String package.json` và `Get-ChildItem -Recurse -Include *backtest*`.

**Nguồn dữ liệu:** xem `02-data.md` (đã chọn ở T6, có sha256). Quy tắc áp dụng: hết
hạn mà chưa có dữ liệu thật của khách hàng ⇒ dùng **dataset công khai**, dán nhãn rõ
trên mọi slide và trong mọi bảng kết quả.

**Bảng mã điều khoản:** S1–S12 là 12 điểm giám khảo nêu đích danh. Mỗi mục dưới đây ghi
rõ **mã S nào được áp dụng ở đâu** để đối chiếu một lần là xong.

---

## 1. Câu hỏi cần trả lời

> **Với một shop bán lẻ, liệu phép tính ROP + đề xuất đặt hàng tự động có tốt hơn việc
> dùng một ngưỡng tồn tối thiểu cố định không?**

Phương án so sánh (bảng điểm chính). **Không thêm phương án sau khi thấy số.**

| Mã | Phương án | Mô tả |
|---|---|---|
| **P1** | `minStock` cố định (hiện trạng) | Đặt lại khi `ATP ≤ minStock`, số lượng = `max(1, (minStock*2 − ATP) * 1.2)` — đúng công thức đang chạy ở `automation.service.js:49,209` |
| **P2** | Trung bình trượt + ROP | `demandPerDay` = TB 28 ngày (đã hiệu chỉnh censored), `ROP = d×LT + SS`, rà soát `(R,S)` chu kỳ 7 ngày |
| **P3** | MA 28 ngày, SKU thưa dùng Croston | Như P2 nhưng chọn phương pháp theo mật độ bán |
| **P4** | Days-of-cover cố định | Đặt khi `ATP ≤ S`, đặt đủ về `S = DOC × d_ref` (`DOC` là tham số duy nhất, xem S1) |
| **P5** | Hành vi quan sát (mua thực tế trong dataset) | Nhánh "người quyết định tay" — xem **S9**, gồm cả giới hạn của nó |

**Còn về "chủ shop tự nhập tay":** theo **S9**, nhánh P5 là **hành vi quan sát được
ghi trong dataset**, **không phải** người thật trong phòng thí nghiệm. Người thật chỉ
xuất hiện ở phép đo thời gian thao tác (§5.3), với thiết kế **counterbalance**.

---

## 2. Định nghĩa các phương án (S1, S4)

Định nghĩa chính xác trước khi chạy, để script và slide nói cùng một thứ.

### 2.1. Ký hiệu

| Ký hiệu | Nghĩa |
|---|---|
| `ATP` | tồn khả dụng đầu ngày = tồn cuối ngày trước |
| `d_ref` | nhu cầu/ngày tham chiếu, tính **chỉ trên tập quan sát**, đã hiệu chỉnh censored theo S3 |
| `LT` | lead time (ngày) — chạy cả 3/7/14 (S4) |
| `σ` | độ lệch chuẩn nhu cầu ngày trên tập quan sát |
| `SS` | safety stock = `z(serviceLevel) × σ × √LT` |

### 2.2. S1 — luật đặt `minStock` cho P1 + baseline days-of-cover

P1 là "hiện trạng" nhưng **hiện trạng không tái lập được** nếu không có dữ liệu
người dùng đặt `minStock` tay. Vì vậy P1 được chạy bằng **luật đặt trước**, không
chọn tay theo SKU (chọn tay theo SKU là loại tinh chỉnh sau khi thấy số):

```
minStock_P1 = ceil(DOC_P1 × d_ref)        với DOC_P1 = 14 ngày (hằng số, mọi SKU)
số lượng đặt = max(1, ceil((2 × minStock_P1 − ATP) × 1.2))     ← giữ nguyên công thức hiện trạng
```

- `DOC_P1 = 14` là **hằng số chốt trước**, không nằm trong lưới tinh chỉnh.
- SKU có `d_ref = 0` ⇒ `minStock = 0` ⇒ **P1 không bao giờ đặt hàng cho SKU đó**. Ghi rõ
  số SKU như vậy; **không** âm thầm loại chúng khỏi tập đánh giá.
- Nếu sau này có dữ liệu `minStock` thật của một tenant, chạy thêm biến thể
  `P1-thật` và báo **cả hai**; đến lúc đó `P1` ở trên ghi `SKIPPED-vì-thiếu-dữ-liệu`.

**Baseline days-of-cover (P4)** là phương án tối giản: không học gì trong ngày, chỉ giữ
một số ngày phủ cố định:

```
S_P4 = DOC × d_ref        (DOC ∈ lưới tinh chỉnh, xem S2)
đặt khi ATP ≤ S_P4 ; số lượng = ceil(S_P4 − ATP)
```

### 2.3. S4 — đặc tả mô phỏng (chốt, áp dụng cho **mọi** phương án)

| Điểm | Quy tắc chốt |
|---|---|
| **Tồn đầu kỳ** | Mọi phương án bắt đầu **cùng một** `ATP` cho từng SKU: `ceil(SS(d_ref, σ, LT=7) + d_ref×7)` tính trên tập quan sát. Không cho phương án nào có "nước đầu" riêng. |
| **Rà soát cuối ngày** | Mỗi ngày `t`: 00:00 cập nhật ATP; **rà soát lúc cuối ngày**; đơn đặt ngày `t` tới nơi **cuối ngày `t+LT`** (với `LT=0` không xảy ra vì `LT ≥ 3`). |
| **Lead time** | Chạy **cả 3, 7 và 14 ngày**, **báo cả ba**. Bảng chính pre-registered dùng `LT=7`; `LT=3` và `LT=14` là kiểm tra độ nhạy, không dùng để chọn phương án. |
| **Thiếu hàng = mất bán** | Nhu cầu vượt ATP bị **ghi nhận là mất bán**, không ghi nợ. Doanh thu mất = `nhu cầu ẩn − bán thực tế` × **giá niêm yết trong ngày đó**. |
| **Làm tròn** | Mọi số lượng đặt và tồn **làm tròn lên** số nguyên (`ceil`). Không dùng số thực. |
| **Không MOQ** | Không mô phỏng MOQ, không bao/thaù, không giảm giá theo số lượng. |
| **NCC 100% tin cậy** | Không giao thiếu, không trễ so với `LT`, không huỷ đơn. |
| **Duyệt của người** | Mô phỏng giả định duyệt tức thì (độ trễ 0h). Độ trễ 0h/8h/24h là **phân tích độ nhạy pre-registered**, không phải tiêu chí chọn. |
| **Kênh** | Một kho, một cửa hàng, một kênh. **Không** tuyên bố hiệu quả "đa kênh". |

---

## 3. Chia dữ liệu theo thời gian (S2, S6, S12)

**Không** chia ngẫu nhiên — bài toán là dự báo.

### 3.1. Rolling-origin, tối thiểu 3 cửa sổ (S6)

| Vùng | Khoảng | Dùng để |
|---|---|---|
| **Quan sát (train)** | Từ đầu đến hết tháng trước cửa sổ gần nhất | `d_ref`, `σ`, `α` của Croston, quy tắc censored |
| **Giữa (mid)** | Tháng kế tiếp | Tinh chỉnh tham số duy nhất (S2) |
| **Kiểm định (test)** | Tháng ngay sau đó | **Mọi con số công bố** |

- **Số cửa sổ: tối thiểu 3.** Ba cửa sổ trượt dần, mỗi cửa sổ dựng lại tham số từ
  đầu (không cộng dồn tham số từ cửa sổ trước).
- Chỉ số chính (S5) = **trung bình qua các cửa sổ**; báo kèm từng cửa sổ.
- Nếu dữ liệu chỉ đủ **N < 3** cửa sổ ⇒ ghi rõ "chỉ đủ N cửa sổ" như một **hạn chế**;
  **không** âm thầm giảm bớt tiêu chí.

### 3.2. Quy tắc cứng của tập dữ liệu

> Con số nào lấy từ tập quan sát hoặc tập giữa mà lại đưa ra slide ⇒ **sai**. Script
> phải chặn: mọi hàm báo cáo nhận `slice: 'test'` và **refuse** nếu tham số khác.

### 3.3. S12 — lưới tinh chỉnh không chứa ngưỡng drift

Lưới tinh chỉnh **chỉ** gồm:

| Phương án | Tham số được tinh chỉnh | Lưới |
|---|---|---|
| P2 | `serviceLevel` (qua `z`) | `0.80, 0.85, 0.90, 0.95` |
| P3 | `serviceLevel` + `alpha` của Croston | như trên, `alpha ∈ {0.1, 0.2, 0.3}` |
| P4 | `DOC` | `7, 14, 21, 28` |

**`QTY_DRIFT_TOL` (25%) và `COST_DRIFT_TOL` (10%) bị loại khỏi lưới** (S12). Đây là hằng
số sản phẩm/phòng an toàn, **chưa hiệu chỉnh, không có căn cứ thực nghiệm** — giữ cố
định và ghi đúng nhãn đó; tune chúng trong backtest là tự dệ ra tiêu chuẩn.

---

## 4. Xử lý ngày hết hàng (censored demand) — S3, hai nhánh

Ngày hết hàng, doanh số = 0 **không phải nhu cầu = 0**. Không xử lý thì mô hình **tự
báo cáo mình giỏi**.

### 4.1. Hai nhánh bắt buộc (S3)

| Nhánh | Cách xử lý ngày censored | Vai trò |
|---|---|---|
| **A — hiệu chỉnh** | `demand = max(bán thực tế, TB các ngày không censored)` | **Nhánh chính**, pre-registered |
| **B — loại ngày** | Xoá hẳn ngày censored khỏi mẫu tính `d_ref`, `σ`, `α` | **Nhánh kiểm tra độ nhạy** |

**Cả hai nhánh đều phải chạy và đều phải báo.** Quy tắc bất di bất dịch:

- **Không** chọn nhánh theo kết quả. Nhánh A là nhánh công bố; nhánh B chỉ để kiểm tra.
- Nếu **kết luận đổi chiều** giữa hai nhánh ⇒ kết luận cuối phải viết
  *"chưa vững — phụ thuộc cách xử lý ngày hết hàng"*, kèm cả hai bảng.

### 4.2. Quy tắc đánh dấu và báo cáo

| Vấn đề | Quy tắc |
|---|---|
| Đánh dấu ngày censored | `ATP cuối ngày ≤ 0` **hoặc** ngày nằm trong khoảng thiếu hàng do PO chưa tới |
| Báo cáo | Công bố `censoredDayRatio` **bắt buộc**. Tỉ lệ > 30% ⇒ kết luận phải nói rõ độ tin cậy thấp |
| SKU bán thưa | `< 10` ngày có bán trong 90 ngày ⇒ Croston (`calc.js` tự chọn) |
| Ước lượng mất doanh thu | **Không** dùng "số bán bị mất = TB" một cách tự do. Nếu công bố, phải nêu rõ giả định và khoảng |
| Loại SKU | SKU có `sparseSkuRatio` cao và ít dữ liệu được **loại khỏi tập đánh giá** — và phải nói **số lượng bị loại**; quy tắc loại chốt trước khi chạy |

---

## 5. Chỉ số — định nghĩa chính xác trước khi chạy

### 5.1. S5 — một chỉ số chính, gắn thẳng với đánh đổi

**Chỉ số chính (duy nhất, dùng để kết luận):**

```
Chi phí chuẩn hoá mỗi đơn = ( giá vốn hàng vừa nhập
                           + giá trị tồn dư cuối kỳ
                           + giá trị mất bán do hết hàng )
                          / Σ y_thực            ← đơn vị: đồng / đơn
```

Vì sao là chỉ số này: nó **gộp đúng cái đánh đổi** đang cần trả lời — mua nhiều thì
hết hàng ít nhưng tồn dư và vốn bị trói; mua ít thì ngược lại. Chỉ số chính phải là
**một con số duy nhất có đơn vị tiền**, không phải hai chỉ số đặt cạnh nhau để người
đọc tự cân.

Quy tắc kết luận:

1. Thắng = chi phí chuẩn hoá thấp hơn, **và** khoảng tin cậy 95% (S7) của hiệu số so
   với từng baseline **không chứa 0**.
2. Hai khoảng tin cậy chồng nhau ⇒ kết luận là **"không phân biệt được ở cỡ mẫu này"**,
   không chọn thắng bừa.
3. **Doanh thu không được dùng làm chỉ số chính**: nhu cầu cố định thì doanh thu gần
   như không đổi theo chính sách, nên nó chỉ phạt việc nhập dư mà không đo được gì.

### 5.2. Chỉ số phụ (báo cáo, **không** dùng để chọn)

| Chỉ số | Công thức | Ghi chú |
|---|---|---|
| **WAPE theo SKU** | `Σ|y_thực − y_dự_báo| / Σ y_thực` (tập kiểm định, gộp SKU) | Báo kèm số SKU, số lần bán, và WAPE của từng baseline. Chọn WAPE vì MAPE hỏng khi `y=0`; MAPE chỉ báo thêm trên SKU có `y>0` và phải nói đã loại bao nhiêu SKU |
| **Ngày hết hàng mô phỏng** | Số ngày có `ATP ≤ 0` trong mô phỏng | **Mô phỏng**, không phải quan sát |
| **Doanh thu mất** | `Σ (nhu cầu ẩn − bán thực tế)` × giá trong ngày `ATP ≤ 0` | Giả định mỗi đơn trung bình bằng 1 đơn vị |
| **Giá trị tồn dư cuối kỳ** | `Σ (tồn cuối × giá vốn)` | Không tính hàng hết hạn/hàng chết |
| **Số đơn đặt / số lần rà soát** | đếm trong mô phỏng | Đo gánh nặng vận hành cho người duyệt |
| **Fill rate** | `bán thực tế / nhu cầu hiệu chỉnh` | |

### 5.3. S9 — phép đo thời gian thao tác (không thay bằng mô phỏng)

Chỉ số này **không** lấy được từ dataset công khai.

| | Quy trình cũ | Quy trình mới |
|---|---|---|
| Bấm giờ | Chủ shop tự nhập số lượng nhập | Chủ shop duyệt đề xuất có sẵn |
| Cỡ mẫu | `[ĐỘI ĐIỀN: số người]` | |
| Cách đo | Bấm giờ từng bước, có người quan sát | |

**Counterbalance (S9):**

1. Thứ tự hiển thị **luân phiên và cân bằng**: nửa đầu người thử gặp *cũ → mới*, nửa
   còn lại gặp *mới → cũ*; phân bổ theo bảng cân bằng (AB/BA), **không** ngẫu nhiên
   không kiểm soát.
2. Cùng một danh sách nhiệm vụ, cùng độ khó, cho mọi người thử; chỉ đổi thứ tự quy trình.
3. Người quan sát **mù** với điều kiện đo (không biết người thử đang ở nhánh nào).
4. Ghi `condition_order` vào phiếu từng người thử; báo cáo cả **hai thứ tự** riêng.

Nếu cỡ mẫu < 5 người ⇒ **không công bố phần trăm**, chỉ công bố thời gian trung vị và
khoảng min–max. Mẫu 3 người không đủ để nói "giảm 90%".

### 5.4. Chi phí LLM

Không đo được bằng mô phỏng — phải từ token thật.

| Số cần công bố | Công thức |
|---|---|
| Token/ngày/tenant | `Σ prompt + completion tokens` từ `LlmUsageLog` ÷ số ngày ÷ số tenant |
| Chi phí/ngày/tenant | token × đơn giá **theo đơn giá nhà cung cấp tại ngày đo** |
| Chi phí/tháng/tenant | × 30 |

Điều kiện: phải có bảng `LlmUsageLog` (migration **riêng**, T13) và phải chạy `live`
với Gemini, **không** dùng số từ `replay`. **Nếu chưa đo được:** ghi *"chưa đo"*.
**Tuyệt đối không ước lượng rồi đưa ra slide.**

---

## 6. Kế hoạch tinh chỉnh (S2)

**S2 — mọi baseline tune trên cùng tập giữa, cùng ngân sách.**

| Quy tắc | Nội dung |
|---|---|
| Tập | **Chỉ** tập giữa (mid). Tập kiểm định **không** được chạm vào khi tinh chỉnh. |
| Ngân sách | **Bằng nhau**: mỗi phương án được thử **tối đa 4 cấu hình** trên lưới ở §3.3; tổng số lần chạy mô phỏng trên tập giữa **bằng nhau** giữa các phương án. |
| Hàm mục tiêu | **Cùng một hàm**: chỉ số chính ở §5.1, tính trên tập giữa. |
| Hoà | Ưu tiên cấu hình **đơn giản hơn** theo thứ tự cố định: `P1 < P4 < P2 < P3`. |
| Đóng băng | Cấu hình thắng được ghi lại kèm **hash tham số** trong `notes/backtest-runs.md` **trước** lần chạy đầu tiên trên tập kiểm định. |
| Cấm | Không thêm lưới sau khi đã thấy số kiểm định. Thêm lưới ⇒ báo cả kết quả cũ. |

---

## 7. Ngữ cảnh thống kê (S7)

**S7 — bootstrap theo SKU, cho hiệu số và cho số SKU thắng/thua.**

| Mục | Quy tắc chốt |
|---|---|
| Đơn vị resample | **SKU** (cluster bootstrap), **không** resample theo ngày hay theo dòng |
| Số lần resample | 1000 |
| Hạt giống | `20261003` cố định trong mã, để chạy lại cho cùng kết quả |
| Khoảng tin cậy | 95% phân vị của **hiệu số** (phương án − baseline) trên chỉ số chính |
| Chiến lược thắng | Đếm SKU thắng / thua / hoà giữa phương án và từng baseline, **cùng** quy trình bootstrap |
| Ngưỡng kết luận | Chỉ nói "tốt hơn" khi **cả hai**: khoảng tin cậy của hiệu số **không chứa 0** **và** tỉ lệ SKU thắng **> 55%**. Nếu không ⇒ nói "chưa đủ bằng chứng". |

**Độ nhạy (pre-registered, không dùng để chọn):** thời điểm rà soát, độ trễ duyệt
0h/8h/24h, ngưỡng chấp nhận độ lệch.

---

## 8. Baseline dự báo (S8)

**S8 — phải có `naive` và `seasonal-naive`.**

| Mã | Công thức (chốt trước) |
|---|---|
| `naive` | `ŷ(t) = y(t−1)` |
| `seasonal-naive` | `ŷ(t) = y(t−7)` — chu kỳ tuần, chốt trước vì dữ liệu bán lẻ có mẫu tuần |

Quy tắc:

1. Hai baseline này **không đặt hàng** — chúng chỉ đo chất lượng dự báo, so trên cùng
   tập kiểm định và cùng WAPE của §5.2.
2. Trong báo cáo phải ghi rõ: chúng là **baseline dự báo**, **không phải** phương án
   chính sách tồn kho; không được so chúng với bảng "chính sách" như hai đối thủ cùng
   loại.
3. Nếu WAPE của `P2/P3` **thua** cả `naive`/`seasonal-naive` thì kết luận phải nói thẳng
   điều đó — đây là kết quả có thể xảy ra và phải báo, không được bỏ dòng.

---

## 9. Đánh giá khớp SKU (S10)

Khớp SKU giữa file kênh và ERP là một bài **có thể đo riêng**; đo nó bằng bộ nhãn
tay mù, không bằng cảm giác.

| Mục | Quy tắc chốt |
|---|---|
| Bộ nhãn | **≥ 100 cặp** do **2 người** gán độc lập, mù với kết quả mô hình; đo đồng thuận bằng **Cohen's κ**; bất đồng ⇒ người thứ 3 phân xử. Nếu κ < 0,6 thì nhãn chưa đủ tin cậy ⇒ báo điểm đó kèm cảnh báo. |
| Chỉ số | precision@k, recall@k ở **ngưỡng điểm tin cậy chốt trước = 0,85**; tỉ lệ "dưới ngưỡng ⇒ chuyển người" (`fallbackRate`); thời gian xử lý 1 cặp. |
| Bắt buộc có đối chứng | **Baseline fuzzy không-LLM** (Levenshtein/token-set + ngưỡng) trên **cùng bộ nhãn**. Không có đối chứng thì không được tuyên bố LLM "khớp tốt hơn". |
| Kết luận | Chỉ nói "LLM khớp tốt hơn" khi khoảng tin cậy bootstrap (**theo cặp**, seed `20261003`, 1000 lần) của chênh lệch **không chứa 0**. |
| Cỡ mẫu nhỏ | `n < 100` ⇒ chỉ báo **số đếm**, không báo phần trăm. |

`fallbackRate` là một **chi phí vận hành thật** (người phải ngồi xử lý), nên luôn được
báo cùng độ chính xác, không báo riêng.

---

## 10. Chống "chỉnh cho đẹp" (S11)

Ba hành động bị cấm sau khi đã thấy số:

1. Đổi công thức/tham số rồi chạy lại và báo kết quả mới **mà không** báo cả kết quả cũ.
2. Loại SKU sau khi biết mô hình sai trên SKU đó.
3. Đổi tập kiểm định hoặc cách chia dữ liệu.

**S11 — sổ ghi mọi lần chạy.** Mỗi lần chạy (kể cả lần chạy lại, kể cả lần bị bỏ) phải
thêm **một dòng** vào `docs/aisc26/notes/backtest-runs.md` và một dòng JSON vào
`docs/aisc26/notes/backtest-runs.jsonl`, gồm:

```
run_id | thời điểm | commit mã + commit giao thức | tên dataset + sha256 | lệnh đã chạy
| hash tham số | seed | slice | kết quả các chỉ số | ghi chú (re-run sau thay đổi gì?)
```

- **Không xoá dòng nào.** Lần chạy bị thay thế được đánh dấu `superseded` nhưng vẫn giữ.
- Bảng kết quả trong báo cáo phải dẫn `run_id` của lần chạy sinh ra nó.

Nếu thực sự cần sửa gì sau khi thấy số: mô tả lý do, báo **cả hai kết quả**, ghi vào
báo cáo *"phát hiện sau backtest, đã sửa"*, và nêu rõ ảnh hưởng tới kết luận.

---

## 11. Định dạng kết quả

Mỗi bảng kết quả phải kèm:

```
Nguồn dữ liệu : [thật / công khai — tên + URL + ngày truy cập + sha256]
Khoảng thời gian: [từ] → [đến]
Cỡ mẫu       : [số SKU], [tổng số đơn], [số kênh]
censoredDayRatio: [x]%      sparseSkuRatio: [y]%      nhánh censored: [A/B/cả hai]
Số cửa sổ trượt: [n]        lead time: [3/7/14]
Tập đánh giá  : các cửa sổ out-of-sample
Lệnh chạy lại : npm run backtest -- --slice=test --as-of=YYYY-MM-DD
run_id        : <id trong notes/backtest-runs.md>
Commit giao thức: <hash>   ← commit của file này
```

Lệnh phải **chạy lại được từ sạch** và cho ra cùng kết quả (seed cố định ở S7).

---

## 12. Rủi ro đã biết của chính giao thức này

| Rủi ro | Giảm bằng cách nào |
|---|---|
| Dataset công khai không giống hành vi shop Việt | Ghi rõ trên slide; không suy rộng kết luận ra thị trường |
| Dataset công khai không có tồn kho/lead time/kênh | Mọi chỉ số tồn kho là **MÔ PHỎNG** theo §2.3; không tuyên bố hiệu quả "đa kênh" |
| Số cửa sổ trượt ít (3 cửa sổ, 1 dataset) | Báo rõ số cửa sổ; kết luận giới hạn ở "trên tập dữ liệu này" |
| Nhánh P5 là hành vi quan sát, không phải người thật | Ghi rõ trên mọi bảng; thời gian thao tác chỉ lấy từ người thử ở §5.3 |
| Ngưỡng drift chưa hiệu chỉnh | Không nằm trong lưới tinh chỉnh (S12); ghi nhãn "mặc định, chưa căn cứ" |
| Cỡ mẫu SKU nhỏ ⇒ CI rộng | Báo CI, không kết luận thắng khi CI chồng (S7) |
| Chỉ 1 tenant ⇒ kết quả không đại diện | Nêu rõ; không nói "cho doanh nghiệp Việt Nam", chỉ nói "trên tập dữ liệu này" |

---

## 13. Lịch sử sửa đổi trước lần chạy đầu

| Ngày | Thay đổi | Mã | Bằng chứng rằng chưa có lần chạy nào |
|---|---|---|---|
| 2026-10-02 | Soạn bản đầu | — | `package.json` không có script `backtest` |
| 2026-10-03 | Luật đặt `minStock` cho P1 + thêm baseline days-of-cover (P4) | **S1** | `Get-ChildItem -Recurse -Include *backtest*,*dataset*` trên `scripts/`, `tests/`, `src/` → **0 tệp** |
| 2026-10-03 | Tách lưới tinh chỉnh, mọi baseline cùng tập giữa + cùng ngân sách 4 cấu hình, cùng hàm mục tiêu, đóng băng hash tham số | **S2** | chưa có `notes/backtest-runs.md` |
| 2026-10-03 | Censored thành **hai nhánh A/B**, báo cả hai, không chọn nhánh theo kết quả | **S3** | chưa có số liệu nào để "chọn theo kết quả" |
| 2026-10-03 | Đặc tả mô phỏng đầy đủ: tồn đầu kỳ chung, rà soát cuối ngày, lead time 3/7/14 báo cả ba, thiếu hàng = mất bán, làm tròn lên, không MOQ, NCC 100% tin cậy, một kênh | **S4** | — |
| 2026-10-03 | Một chỉ số chính duy nhất có đơn vị tiền (`chi phí chuẩn hoá mỗi đơn`), khóa luật kết luận theo CI; doanh thu bị cấm làm chỉ số chính | **S5** | — |
| 2026-10-03 | Rolling-origin **≥ 3 cửa sổ**, mỗi cửa sổ dựng lại tham số từ đầu | **S6** | — |
| 2026-10-03 | Bootstrap **theo SKU**, 1000 lần, seed `20261003`, kèm đếm SKU thắng/thua; ngưỡng kết luận 55% | **S7** | — |
| 2026-10-03 | Thêm baseline `naive` và `seasonal-naive`, ghi rõ chúng không đặt hàng | **S8** | — |
| 2026-10-03 | Thêm nhánh P5 "hành vi quan sát" và **counterbalance** cho phép đo thời gian thao tác (AB/BA, người quan sát mù) | **S9** | — |
| 2026-10-03 | Đặc tả đo khớp SKU: bộ nhãn ≥ 100 cặp, 2 người gán + Cohen's κ, ngưỡng 0,85, baseline fuzzy không-LLM bắt buộc, CI bootstrap theo cặp | **S10** | — |
| 2026-10-03 | Bắt buộc sổ ghi mọi lần chạy (`backtest-runs.md` + `.jsonl`), cấm xoá dòng | **S11** | tệp sổ chưa tồn tại → chưa có lần chạy nào |
| 2026-10-03 | Gỡ `QTY_DRIFT_TOL` (và `COST_DRIFT_TOL`) khỏi tham số tinh chỉnh; giữ hằng số, ghi nhãn "chưa hiệu chỉnh" | **S12** | — |

**Sửa sau khi đã có `run_id` đầu tiên = vi phạm giao thức.** Mọi sửa đổi từ đây trở đi
phải kèm: mô tả lý do, `run_id` cũ, `run_id` mới, và **cả hai kết quả**.

Ngoài ra, đính chính cùng đợt: `LlmUsageLog` là **migration riêng** (T13), không "gộp
vào P0-3" như bản 2026-10-02 ghi.

---

## 14. Trạng thái

| Mục | Trạng thái |
|---|---|
| Giao thức S1–S12 | ✅ **Đã commit trước khi chạy** (xem §13) |
| Nguồn dữ liệu | ✅ Đã chọn ở T6 — xem `02-data.md` |
| Script backtest | ⏸ Chưa viết (T10) |
| Người thử thời gian thao tác | ⛔ `[CHỜ ĐỘI ĐIỀN: tên/số người]` |
| Bộ nhãn khớp SKU | ⛔ Chưa tạo (T14) |
| `LlmUsageLog` | ⛔ Chưa có — migration riêng (T13) |

**Không chạy backtest nào cho đến khi script tồn tại và đọc được nguồn dữ liệu.** Chạy
tay một phép tính rồi điền kết quả vào đây là vi phạm giao thức.