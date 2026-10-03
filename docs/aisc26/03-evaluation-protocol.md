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

**Ngoại lệ duy nhất được phép, và nó không phải "sửa":** thêm một **thí nghiệm mới**
(hàm mục tiêu mới) sau khi đã thấy kết quả thí nghiệm 1 — ghi ở **§13.2**, tiền-đăng
ký, commit trước khi chạy, mang nhãn post-hoc, và **không** đụng vào kết quả thí
nghiệm 1.

Ngoài ra, đính chính cùng đợt: `LlmUsageLog` là **migration riêng** (T13), không "gộp
vào P0-3" như bản 2026-10-02 ghi.

---

## 13.1. Diễn giải chốt TRƯỚC lần chạy đầu (khi giao thức còn chưa nói rõ)

Bảng này ghi lại **mọi điểm mà giao thức trên để ngỏ**, và cách đã chốt. Tất cả
được viết **trước** khi có bất kỳ `run_id` nào; bằng chứng: `notes/backtest-runs.md`
chỉ có các dòng `smoke`/`kiểm thúc` được ghi rõ là không phải lần chạy giao thức.

| Mã | Điểm giao thức để ngỏ | Chốt | Vì sao |
|---|---|---|---|
| **D-P5-01** | §5.1 viết `Σ y_thực` nhưng không nói `y_thực` là nhu cầu chung hay số đơn vị **do chính phương án đó bán được** | Mẫu số = **số đơn vị phương án đó thực sự bán được** | Chỉ số tên là "chi phí chuẩn hoá **mỗi đơn**". Nếu dùng mẫu số chung, phương án bán ít sẽ được thưởng vì mẫu số không đổi — đó là lỗi thiết kế chỉ số, không phải kết quả. **Hệ quả bắt buộc phải báo:** chỉ số này thiên về phương án bán ít, nên bảng **số tuyệt đối** (tổng chi phí, đơn vị bán, đơn vị mất bán, tồn dư) và **fill rate** phải đi kèm, không được bỏ. |
| **D-P5-02** | §3.1 yêu cầu ≥ 3 cửa sổ nhưng không nói cửa sổ nào | `test` = **3 tháng lịch đầy đủ gần nhất**; `mid` = tháng liền trước; `train` = mọi ngày trước đó | Cách duy nhất tất định, không cần biết trước kết quả. Tháng thiếu ngày (tháng đầu và tháng cuối kỳ) bị loại. |
| **D-P5-03** | §1 ghi "TB 28 ngày" cho P2/P3 nhưng §2.1 nói `d_ref`/`σ` tính trên **toàn bộ** tập quan sát | `d_ref` **và** `σ` lấy trên **28 ngày cuối của tập quan sát**; cờ censored xác định bằng **2 lượt cố định** (lượt 1 coi mọi ngày không censored; lượt 2 dùng cờ thật của lượt 1) | Nếu lấy cả tập quan sát thì "28 ngày" là vô nghĩa, và tập quan sát phình theo cửa sổ ⇒ P2/P3 ở các cửa sổ khác nhau không cùng hệ thống. Số vòng lặp phải chốt trước, nếu không kết quả phụ thuộc thứ tự cập nhật. |
| **D-P5-04** | §2.1 định nghĩa `ATP` = tồn cuối ngày trước; mã sản phẩm lại dùng `ATP + onOrder` (`replenishment.calc.js:668`) | Chạy **cả hai**: bảng chính dùng `ATP + onOrder` (khớp mã sản phẩm), bảng độ nhạy dùng `ATP` thuần | Nếu chỉ so ATP thì mọi phương án đặt tối đa mỗi ngày trong suốt `LT` ngày và phép so sánh trở nên vô nghĩa. Số `z` cho tồn đầu kỳ = **1,645** (mức phục vụ 0,95 — mặc định sản phẩm), `LT = 7` như §2.3, và **giống nhau cho mọi phương án / lead time / nhánh**. |
| **D-P5-05** | §3.3 lưới P3 có `alpha ∈ {0,1;0,2;0,3}` | Backtest dùng Croston với **alpha tường minh**; KHÔNG dùng `crostonDemandPerDay` của sản phẩm | Hàm đó **nhận tham số `alpha` nhưng không dùng** — nó tự suy `a = 1/(k+1)` từ dữ liệu. Dùng nó thì ba "cấu hình" cho ra một kết quả và P3 không được đo đúng nghĩa. Đây là **lỗi tiềm ẩn của mã sản phẩm**, chưa sửa (ngoài phạm vi T10), ghi vào backlog. |
| **D-P5-06** | §3.3 cho P3 **12** cấu hình, §6 bắt "tối đa 4 cấu hình, ngân sách bằng nhau" | P3 chỉ lưới `serviceLevel` (4 cấu hình), `alpha` cố định **0,1** | §6 (S2) là ràng buộc ngân sách, §3.3 (S12) chỉ là danh sách tham số. P1 có đúng 1 cấu hình vì không có tham số. |
| **D-P5-07** | Tệp CSV chỉ có dòng cho ngày có bán: 604/739 ngày | Trục ngày = **lịch đầy đủ 739 ngày**; 135 ngày không có dòng = 0 đơn vị bán | Rolling-origin cần trục ngày liên tục, và "không ghi nhận bán" là cách đọc không bịa thêm dữ liệu. Nếu một số ngày đó là ngày cửa hàng đóng thì `d_ref` thấp đi — nhưng **áp dụng như nhau cho mọi phương án** nên không đổi kết luận so sánh. |
| **D-P5-08** | §7 nói bootstrap theo SKU nhưng không nói gộp cửa sổ thế nào | Mỗi SKU = **một hàng** sau khi cộng dồn `totalCost`/`sold` của cửa sổ nào có SKU đó; căn theo **tên SKU**, không theo chỉ số | Cửa sổ có thể loại SKU khác nhau (giá vốn tính trên tập quan sát riêng — D-P5-09). Căn theo chỉ số sẽ lệch hàng và ra số sai mà vẫn trông hợp lệ. |
| **D-P5-09** | §5.1 cần "giá vốn hàng vừa nhập" nhưng dataset **không có** giá vốn | Giá vốn 1 đơn vị = **trung vị `unit_price_median` của SKU trên tập quan sát của cửa sổ đó** (không dùng cả kỳ) | Đây là **giả định**, không phải giá vốn thật — `02-data.md` §6.4 đã ghi. Tính trên tập quan sát riêng để giá của tháng kiểm định không lọt ngược vào mô phỏng. Dùng chung một giá cho cả hàng nhập, hàng tồn dư và hàng mất bán để ba thành phần của chỉ số chính cùng một cơ sở. |
| **D-P5-10** | §1 liệt kê **P5** = "hành vi quan sát (mua thực tế trong dataset)" | **SKIPPED** — UCI Online Retail II chỉ có bán ra, **không có** phiếu mua/PO/GRN | Không có dữ liệu thì không có hành vi để quan sát. Bịa nhánh "người quyết định tay" từ dữ liệu bán là vi phạm hiến pháp `NIGHT-PROMPT.md` §3 ("không dùng dữ liệu bịa rồi gọi là thật"). Ghi `SKIPPED` kèm lý do. |
| **D-P5-11** | §4.2 nói SKU "bán thưa và ít dữ liệu" thì loại, nhưng không đặt ngưỡng | **Không loại SKU nào thêm** ngoài bộ lọc L1–L4 của `02-data.md` §4 và điều kiện "có giá niêm yết trong tập quan sát của cửa sổ" | Loại SKU sau khi biết mô hình sai trên SKU đó là hành vi bị cấm ở §10 mục 2. Ngưỡng loại phải chốt **trước**; ở lần chạy này không cần ngưỡng nào. Số SKU bị loại vì không đủ điều kiện được ghi trong bảng kết quả. |

Ngoài ra, để lưới tinh chỉnh của §3.3 chạy được, `Z_BY_SERVICE_LEVEL` trong
`src/modules/replenishment/replenishment.calc.js` **bổ sung thêm** hai mức
`0.80 → 0,842` và `0.85 → 1,036`. Đây là thay đổi **cộng thêm**, không đổi hành vi
của bất kỳ mức nào đang tồn tại; nếu không bổ sung thì backtest sẽ phải tự chế
bảng z riêng — tức mã backtest và mã sản phẩm dùng hai nguồn số cho cùng một khái
niệm, đúng cái lỗi mà `docs/aisc26/01-llm-role.md` cấm.

---

## 13.2. Phụ lục đăng ký TRƯỚC lần chạy thí nghiệm 2 (khám phá, post-hoc)

> **Nhãn bắt buộc:** mọi bảng, mọi câu kết luận sinh ra từ mục này phải mang nhãn
> **"Thí nghiệm 2 — post-hoc, khám phá"**. Không được trộn vào kết luận của thí
> nghiệm 1. Xem §13.2.5.

### 13.2.0. Vì sao có mục này, và vì sao nó là post-hoc

Thí nghiệm 1 (`run_id` `BT-20261003045045`, commit `43db39b`) cho ra một kết quả mà
chính báo cáo của nó đã gọi là **xấu**: hàm mục tiêu §5.1 (mẫu số = số đơn vị phương
án đó bán được) **không có sàn dịch vụ**, nên nó thưởng cho việc bán ít — bộ tinh chỉnh
chọn `z = 0.80`, mức phục vụ thấp nhất trong lưới, ở **cả 3 cửa sổ**.

Vì vậy câu hỏi *"ở mức phục vụ nào thì ROP hơn ngưỡng cố định?"* **chưa được trả lời**.

**Sự thật phải nói trước:** mục này được viết **sau khi đã thấy kết quả thí nghiệm 1**.
Theo §10 mục 1, đổi hàm mục tiêu của thí nghiệm 1 rồi chạy lại và báo như thể đó là
thí nghiệm cùng điều kiện là **vi phạm giao thức**. Nên cách làm đúng ở đây là:

1. **Thí nghiệm 1 giữ nguyên**, kết quả giữ nguyên, không sửa một số nào.
2. Thí nghiệm 2 là **một thí nghiệm mới**, có hàm mục tiêu mới, được **tiền-đăng ký
   bằng chính mục này** rồi **commit** trước khi chạy.
3. Báo **cả hai cạnh nhau**, và **không** dùng kết quả thí nghiệm 2 để định nghĩa lại
   kết luận của thí nghiệm 1.

### 13.2.1. Hàm mục tiêu có ràng buộc dịch vụ

Ràng buộc chốt trước, áp dụng **giống hệt** cho **mọi** phương án:

```
MIN_FILL_RATE = 0.95                      ← sàn dịch vụ, chốt trước
feasible(c)   := fillRate_mid(c) >= MIN_FILL_RATE
c*            := c có z nhỏ nhất trong tập feasible      (P1/P4: DOC nhỏ nhất)
                 nếu nhiều cùng z → chi phí chuẩn hoá nhỏ hơn → đơn giản hơn → thứ tự lưới
```

- `fillRate_mid(c)` = `bán thực tế / nhu cầu hiệu chỉnh` trên **tập giữa (mid)** —
  cùng định nghĩa §5.2, chỉ khác tập. **Tập kiểm định không được chạm khi chọn `c*`.**
- "z nhỏ nhất" nghĩa là **mức phục vụ thấp nhất vẫn thoả ràng buộc** — đây đúng là
  ý của "ràng buộc dịch vụ": không mua thừa hơn mức dịch vụ đòi hỏi.

**Quy tắc dự phòng khi ràng buộc không khả thi** (chốt trước, không để sau tính):

```
nếu không cấu hình nào feasible:
   chọn c* = fillRate_mid CAO NHẤT
            → nếu hoà: chi phí chuẩn hoá nhỏ hơn → đơn giản hơn → thứ tự lưới
   đánh dấu constraintInfeasible = true  và PHẢI báo ở báo cáo
```

Không được nới `MIN_FILL_RATE`, không được thêm mức `z` ngoài lưới, không được đổi
sang hàm mục tiêu cũ — nếu ràng buộc không khả thi thì **đó là kết quả**, và kết quả
đó phải được báo.

### 13.2.2. Lưới tinh chỉnh và ngân sách (S2 giữ nguyên)

| Phương án | Lưới ở thí nghiệm 2 | Số cấu hình | Khác gì so với thí nghiệm 1 |
|---|---|---|---|
| **P1** | `DOC ∈ {7, 14, 21, 28}` | 4 | **Khác** — thí nghiệm 1 khoá `DOC_P1 = 14` (§2.2, hằng số) |
| **P2** | `serviceLevel ∈ {0.80, 0.85, 0.90, 0.95}` | 4 | không |
| **P3** | `serviceLevel` như trên, `alpha = 0.1` cố định (D-P5-06) | 4 | không |
| **P4** | `DOC ∈ {7, 14, 21, 28}` | 4 | không |

- **S2 giữ nguyên:** cùng tập giữa, **4 cấu hình mỗi phương án** (ngân sách bằng nhau),
  cùng một hàm ràng buộc, cùng luật hoà (đơn giản hơn: `P1 < P4 < P2 < P3`).
- **Vì sao P1 được mở lưới:** `DOC_P1 = 14` là hằng số, tức P1 **không thể** "tune
  dưới ràng buộc"; so hai phương án ở hai mức dịch vụ khác nhau thì vô nghĩa. Cấu
  hình `DOC = 14` của lưới mới **chính là P1 của thí nghiệm 1**, nên không mất liên
  hệ với kết quả cũ. Đây là **điểm duy nhất** thí nghiệm 2 chủ động lệch khỏi §2.2,
  ghi rõ ở đây trước khi chạy.
- P5 vẫn `SKIPPED` với lý do của D-P5-10; lưới P5 không tồn tại.

### 13.2.3. Chỉ số so sánh: giá trị tồn trung bình **ở cùng mức dịch vụ**

Chỉ số chính của thí nghiệm 2 **không** phải §5.1 (vẫn báo §5.1 để so cạnh nhau), mà là:

```
Giá trị tồn trung bình (TB) = Σ_t (ATP_t × giá_vốn) / (số ngày × số SKU)   trên tập kiểm định
```

"**Ở cùng mức dịch vụ**" được thực hiện bằng **khớp dịch vụ theo từng SKU**, chốt trước:

1. Với mỗi SKU tính `fillRate_sku(p) = bán(p) / nhu cầu_thực_tế(sku)` trên tập
   kiểm định (cùng cách gộp SKU như D-P5-08).
2. **Dải khớp:** giữ SKU mà `|fillRate_sku(P2) − fillRate_sku(P1)| <= 0.02`
   (2 điểm phần trăm), và tương tự cho mọi cặp `P3 vs P1`.
3. Trên **đúng tập SKU đã khớp**, so `giá trị tồn TB` của hai phương án.
4. **Bootstrap theo SKU** (S7: seed `20261003`, 1000 lần, đơn vị resample = SKU) trên
   đúng tập SKU đã khớp. Báo `n` của tập khớp và số SKU bị loại vì lệch dịch vụ.

Bổ sung (bắt buộc, để không giấu đường biên): bảng **frontier** với **mọi** cấu hình
của mọi phương án trên tập kiểm định, mỗi dòng = `{cấu hình, fill rate, giá trị tồn TB}`.

### 13.2.4. Luật kết luận

1. Không được nói **"ROP tốt hơn"** trong thí nghiệm 2 trừ khi **cả hai** điều kiện của
   S7 đạt: **CI 95% của hiệu số không chứa 0** *và* **tỉ lệ SKU thắng > 55%**.
2. Nếu một điều kiện không đạt ⇒ ghi đúng chữ **"chưa đủ bằng chứng"**.
3. Mọi kết luận của thí nghiệm 2 phải kèm nhãn **post-hoc, khám phá**; kết luận
   thí nghiệm 1 **không được sửa, không được ghi đè, không được rút lại**.
4. Nếu `constraintInfeasible = true` ở bất kỳ cửa sổ nào ⇒ phải nói rõ ở phần kết
   luận rằng ràng buộc 95% **không đạt được bằng lưới hiện có**, và mọi so sánh "ở
   cùng mức dịch vụ" lúc đó là so ở mức dịch vụ **thấp nhất có thể**, không phải 95%.

### 13.2.5. Đính chính cùng đợt (không ảnh hưởng kết quả)

1. **§1 trích sai dòng mã.** §1 ghi công thức P1 "đúng công thức đang chạy ở
   `automation.service.js:49,209`". Ở **HEAD hiện tại** hai dòng đó **không còn** công
   thức đó: dòng 49 là hằng số `AUTO_REORDER_DEDUPE_WINDOW_MS`, dòng 209 nằm trong
   `debtAutoCollection`. P0-4 đã thay ngưỡng cố định bằng ROP qua `planReplenishment`.
   **Hệ quả phải nói khi trình bày:** "hiện trạng" trong mã **đã là ROP**; P1 của
   giao thức là một ngưỡng cố định **không còn tồn tại trong mã sản phẩm**, nên
   thí nghiệm này trả lời *"ROP so với một cách làm cũ đã bị thay"*, **không** trả
   lời *"ROP so với cách đang chạy hôm nay"*. Không sửa §1 ở đây để giữ nguyên
   lịch sử tài liệu.
2. **Backlog lỗi mã sản phẩm.** `crostonDemandPerDay(qtySeries, alpha)`
   (`src/modules/replenishment/replenishment.calc.js:256`) **nhận tham số `alpha`
   nhưng không dùng** — nó tự suy `a = 1/(k+1)` từ dữ liệu (dòng 260) rồi trả về
   `alpha` đã làm tròn, nên người gọi tưởng mình đang truyền tham số. Vì vậy thí
   nghiệm 1 và 2 đều **không** dùng hàm này cho P3 (D-P5-05): dùng nó thì 3 "cấu
   hình" `alpha` cho ra **một** kết quả và P3 không được đo đúng nghĩa. **Ghi
   backlog, sửa ở gói sau kèm test** — không sửa ở T10 vì đổi hành vi đang chạy.

### 13.2.6. Lệnh và bằng chứng "đăng ký trước"

```bash
# kiểm thức đường ống — KHÔNG phải lần chạy giao thức, KHÔNG ghi sổ
node scripts/backtest/run.js --experiment=2 --slice=test --log=false \
  --lead-times=7 --branches=A --windows=1

# lần chạy giao thức duy nhất — ghi sổ S11
npm run backtest -- --experiment=2 --slice=test
```

Bằng chứng đăng ký trước: mục §13.2 này nằm trong commit **trước** mọi dòng sổ S11 có
`experiment=2`; `git log --oneline -- docs/aisc26/03-evaluation-protocol.md` cho thấy
nó. Kết quả thí nghiệm 2 ghi vào `03-evaluation-results-exp2.md` (sinh tự động) và
được đối chiếu cạnh thí nghiệm 1 trong phần tay của `03-evaluation-results.md`, kèm
nhãn post-hoc.

---

## 14. Trạng thái

| Mục | Trạng thái |
|---|---|
| Giao thức S1–S12 | ✅ **Đã commit trước khi chạy** (xem §13) |
| **Thí nghiệm 2 (post-hoc, khám phá)** | ✅ **Đã tiền-đăng ký ở §13.2**, commit trước lần chạy — **không** thay kết quả thí nghiệm 1 |
| Nguồn dữ liệu | ✅ Đã chọn ở T6 — xem `02-data.md` |
| Script backtest | ⏸ Chưa viết (T10) |
| Người thử thời gian thao tác | ⛔ `[CHỜ ĐỘI ĐIỀN: tên/số người]` |
| Bộ nhãn khớp SKU | ⛔ Chưa tạo (T14) |
| `LlmUsageLog` | ⛔ Chưa có — migration riêng (T13) |

**Không chạy backtest nào cho đến khi script tồn tại và đọc được nguồn dữ liệu.** Chạy
tay một phép tính rồi điền kết quả vào đây là vi phạm giao thức.