<!-- SINH TỰ ĐỘNG bởi `npm run backtest` — phần bảng KHÔNG sửa tay. -->
<!-- run_id: BT-20261003045340 · commit mã: 43db39b -->
<!-- PHAN-TAY-BAT-DAU -->
# T10 — Backtest và mô phỏng tồn kho: kết quả lần chạy đầu

```
Nguồn dữ liệu : CÔNG KHAI — UCI Online Retail II (CC BY 4.0)
                 data/dataset/daily_sku.csv, sha256 82f068ef…83e33f
                 ngày truy cập 2026-10-03
Khoảng thời gian: 2009-12-01 → 2011-12-09 (739 ngày lịch)
Cỡ mẫu       : 500 SKU dùng được, 0 SKU bị loại vì thiếu giá niêm yết, 1 kênh
censoredDayRatio: 17,15% (P1) … 30,38% (P4)      sparseSkuRatio: 14,63%
Số cửa sổ trượt: 3 (test = 2011-11, 2011-10, 2011-09)      lead time: 3/7/14
Tập đánh giá  : 3 cửa sổ out-of-sample, trung bình qua các cửa sổ
Lệnh chạy lại : npm run backtest -- --slice=test
run_id        : BT-20261003045045
Commit giao thức: 1f1a402 (S1–S12) + 43db39b (§13.1, 11 điểm diễn giải)
Commit mã      : 43db39b
```

**Nhãn phạm vi:** mọi chỉ số tồn kho dưới đây là **MÔ PHỎNG**. Dataset không có
tồn kho, không có lead time quan sát được, không có kênh bán, không có giá vốn.
Giá tính bằng **sterling**, không quy đổi. Kết luận chỉ phát biểu **trên tập dữ
liệu này**, không suy ra thị trường Việt Nam.

## 1. Kết luận — nói thẳng cả kết quả xấu

**Có một kết luận đứng vững, và nó không phải kết luận dễ nghe nhất.**

> **ROP có tốt hơn ngưỡng `minStock` cố định (P1) trên chỉ số chính đã chốt trước.**
> P2 thắng P1: hiệu số **−0,4973**, CI 95% **[−0,6172; −0,3982]** (không chứa 0),
> SKU thắng 377/471 = **80,04%** (> 55%). P3 thắng P1 tương tự: −0,4390,
> [−0,5559; −0,3273], 75,16%. Giữ đúng ở **cả ba lead time** (3/7/14) và ở **cả hai
> nhánh censored** (A và B). Đây là so sánh bền nhất trong toàn bộ thí nghiệm.

**Nhưng ba điều phải nói ngay sau đó, nếu không thì kết luận trên là gây hiểu sai:**

1. **Chỉ số chính đã chốt trước không có "sàn dịch vụ", nên nó thưởng cho việc bán
   ít.** Bằng chứng mạnh nhất nằm ngay trong bảng tinh chỉnh: ở **cả 3 cửa sổ**,
   bộ tinh chỉnh chọn `z = 0,80` cho P2/P3 — tức **mức phục vụ thấp nhất** trong lưới.
   Một bộ tinh chỉnh bình thường sẽ không chọn mức phục vụ thấp nhất. Số tuyệt đối nói
   rõ: P2 bán **769.199** đơn vị, P1 bán **849.998** (−9,5%), trong khi đơn vị mất bán
   tăng từ 256.558 lên **337.357** (+31,5%) và fill rate tụt từ 76,81% xuống
   **69,51%**. Tức P2 "rẻ hơn" phần lớn là vì **bán ít hơn và mất bán nhiều hơn**.
2. **Vì vậy chưa được tuyên bố "ROP tốt hơn cho chủ shop".** Chưa có thí nghiệm nào ở
   đây trả lời "ở mức phục vụ nào thì ROP hơn" — vì giao thức đã chốt một hàm mục tiêu
   không ràng buộc dịch vụ. Đây là **hạn chế của thiết kế thí nghiệm**, không phải lỗi
   của mô hình. Cách sửa đúng là **tiền-đăng ký** một hàm mục tiêu có ràng buộc (ví dụ
   tối thiểu 95% fill rate) rồi chạy lại như một thí nghiệm MỚI, giữ nguyên kết quả
   này. **Ta không sửa gì ở đây** (§10 mục 1).
3. **P4 (days-of-cover) đạt chỉ số chính tốt nhất, và tệ hơn P2/P3 trên mọi chỉ số
   vận hành.** P4 đạt 2,3505 nhưng fill rate chỉ 55,76%, mất bán 489.521 đơn vị,
   35,2 PO/100 lần rà soát. Chi phí chuẩn hoá thấp nhất **không** đồng nghĩa phương
   án tốt nhất — và cột "Số PO / 100 lần rà soát" chính là gánh nặng vận hành mà
   `03-evaluation-protocol.md` §5.2 yêu cầu đo.

## 2. Phát hiện khác, gồm cả phần xấu

| # | Phát hiện | Bằng chứng | Ý nghĩa |
|---|---|---|---|
| 1 | **P5 SKIPPED** | UCI Online Retail II chỉ có bán ra, không có phiếu mua/PO/GRN | Nhánh "người quyết định tay" **không chạy được**. Không bịa. D-P5-10. |
| 2 | **Kết luận P2-vs-P4 ĐỔI CHIỀU giữa hai nhánh censored** | Nhánh A: P4 thắng, CI [0,1200; 0,3334] không chứa 0. Nhánh B: P2−P4 = −0,0196, CI **[−0,1080; 0,0675] CÓ 0** | Theo §4.1 phải ghi: **"chưa vững — phụ thuộc cách xử lý ngày hết hàng"**. Không được chọn nhánh. |
| 3 | **WAPE > 100% cho mọi mô hình**, kể cả baseline | P1 103,63% · P2 104,00% · P3 103,97% · P4 104,34% · naive 130,55% · seasonal-naive 117,22% | WAPE > 100% là **khả thi** với chuỗi bán ngày có nhiều ngày 0: Σ\|y−d_ref\| có thể vượt Σy. Không phải lỗi tính — đã có test. Nhưng nó nói thẳng: **dự báo nhu cầu theo ngày của bộ này rất yếu**; MAPE vẫn không dùng được vì `y = 0` ở phần lớn ngày. |
| 4 | Dự báo nhu cầu **thắng** cả hai baseline dự báo | P2/P3/P4 ≈ 104% < seasonal-naive 117,22% < naive 130,55% | Kết quả **tích cực** và bền: ước lượng nhu cầu 28 ngày + hiệu chỉnh censored tốt hơn `y(t−1)` và `y(t−7)` trên dữ liệu này. |
| 5 | **Đọc §2.1 theo chữ làm số thay đổi cả một đơn vị** | `atpOnly`: P1 = 17,66, P2 = 9,71 (với `withOnOrder`: 3,09 và 2,58) | Ngưỡng so ATP thuần ⇒ mọi phương án đặt tối đa mỗi ngày trong `LT` ngày ⇒ tồn dư lớn. Vì vậy **cả hai cách đọc đều được báo** (D-P5-04). Kết luận P2>P1 không đổi, nhưng độ lớn hiệu số thay đổi 16 lần. |
| 6 | Lead time 14 ngày làm **P2 và P1 gần như bằng nhau** | LT=14: P1 3,3400 vs P2 3,1650 (chênh 5,2%) | Ở lead time dài, hiệu quả của ROP so với ngưỡng cố định **thu hẹp rõ**. Không nói chung "ROP hơn" mà không kèm lead time. |
| 7 | `sparseSkuRatio` = 14,63% | 73/500 SKU | Croston (P3) có chỗ dùng, và P3 **không** thắng P2 ở đây (2,6649 > 2,5796). Nói thẳng: **chưa chứng minh được Croston ăn nhằm hơn trên tập này**. |
| 8 | 27 SKU không dùng được cho đối chiếu từng SKU | `n = 471`, loại 27 | 27 SKU bán được 0 đơn vị dưới ít nhất một phương án ⇒ không chia được chỉ số chuẩn hoá. Đã báo, không giấu. |

## 3. Hạn chế phải ghi lên slide

1. **Mô phỏng, không phải quan sát.** Không có tồn kho/lead time/kênh trong dataset.
   "Ngày hết hàng" là kết quả của chính mô phỏng, không phải thứ đã đo.
2. **Giá vốn là giả định** — trung vị giá niêm yết trên tập quan sát (D-P5-09). Không
   phải giá vốn thật của bất kỳ doanh nghiệp nào.
3. **Một nhà bán, một quốc gia, một mặt hàng (quà tặng), 25 tháng.** Không đủ để khẳng
   định mùa vụ dài hạn.
4. **3 cửa sổ, 1 dataset.** Theo §12: kết luận giới hạn ở "trên tập dữ liệu này".
5. **135/739 ngày (18,27%) không ghi nhận bán.** Nếu là ngày cửa hàng đóng thì `d_ref`
   thấp đi — áp dụng như nhau cho mọi phương án nên không đổi kết luận so sánh (D-P5-07).
6. **Chỉ số chính có xu hướng thưởng bán ít** — xem §1. Đây là hạn chế lớn nhất.
7. **Chi phí LLM: chưa đo.** `LlmUsageLog` chưa có (T13). Không ước lượng.
8. **Chưa có đo thời gian thao tác.** Cần người thử (§5.3), chưa chạy.

## 4. Trạng thái các việc của T10

| Việc | Trạng thái |
|---|---|
| Mô phỏng tồn kho theo 8 quy tắc S4 + **test tính tay** | DONE-VERIFIED — `tests/backtest-simulate.test.js` 20/20 |
| Script `npm run backtest` + sổ `backtest-runs.md`/`.jsonl` (S11) | DONE-VERIFIED |
| Chặn `slice != test` cho mọi hàm báo cáo (§3.2) | DONE-VERIFIED — `assertSlice` |
| Bootstrap theo SKU, seed `20261003`, 1000 lần (S7) | DONE-VERIFIED |
| 3 lead time 3/7/14, 2 nhánh censored A/B, 2 cách đọc ngưỡng, 3 cửa sổ | DONE-VERIFIED |
| Baseline `naive` + `seasonal-naive` (S8) | DONE-VERIFIED |
| **P5 — hành vi quan sát** | **SKIPPED** — dataset không có dữ liệu mua (D-P5-10) |
| Chạy lại từ sạch cho cùng kết quả | DONE-VERIFIED — `BT-20261003045340` chạy lại từ sạch, **mọi bảng giống hệt** `BT-20261003045045` (chỉ khác dòng `run_id`) |
| Thí nghiệm có ràng buộc mức dịch vụ | **CHƯA LÀM** — cần tiền-đăng ký rồi chạy như thí nghiệm mới |
<!-- PHAN-TAY-KET-THUC -->
- sparseSkuRatio: 14.63% (SKU có < 10 ngày có bán trong 28 ngày trước cửa sổ)

# Kết quả backtest (sinh tự động — `npm run backtest`)

- Nguồn dữ liệu: `daily_sku.csv` · sha256 `82f068efa759e9d024bfef6ff51a5b507559c8d2a79410a09dbc9bd60983e33f`
- Khoảng thời gian: 2009-12-01 → 2011-12-09 (739 ngày)
- Cỡ mẫu: 500 SKU dùng được / 500 SKU trong tệp (loại 0 SKU không có giá niêm yết)
- Ngày không ghi nhận bán: 135/739 (18.27%) — xem `03-evaluation-protocol.md` §13, D-P5-07
- Cửa sổ trượt: 3 (test = 2011-11, 2011-10, 2011-09)
- Lead time: 3/7/14 · nhánh censored: A,B · positionMode: withOnOrder,atpOnly
- Seed bootstrap: 20261003 · số lần resample: 1000
- censoredDayRatio và số SKU bán được 0 đơn vị: xem bảng bootstrap + bảng chính (định dạng §11 của `03-evaluation-protocol.md`)
- **Mọi chỉ số tồn kho là MÔ PHỎNG** (dataset không có tồn kho/lead time/kênh).

## Chỉ số chính S5 — lead time 7 ngày, nhánh censored A, ngưỡng so `ATP + onOrder` (bảng chính)

| Phương án | Cấu hình chọn (tập giữa) | Chi phí chuẩn hoá / đơn vị (TB 3 cửa sổ) | WAPE | Ngày hết hàng (mô phỏng) | Fill rate | Số PO / 100 lần rà soát |
|---|---|---|---|---|---|---|
| P1 | P1(DOC=14), P1(DOC=14), P1(DOC=14) | 3.0905 | 103.63% | 17.15% | 76.81% | 6.4 |
| P2 | P2(z=0.8), P2(z=0.8), P2(z=0.8) | 2.5796 | 104.00% | 21.17% | 69.51% | 10.2 |
| P3 | P3(z=0.8,a=0.1), P3(z=0.8,a=0.1), P3(z=0.8,a=0.1) | 2.6649 | 103.97% | 20.61% | 70.62% | 10.1 |
| P4 | P4(DOC=7), P4(DOC=7), P4(DOC=7) | 2.3505 | 104.34% | 30.38% | 55.76% | 34.9 |

### Số tuyệt đối (để đọc chỉ số chính)

| Phương án | Tổng chi phí (tuyệt đối) | Đơn vị đã bán | Đơn vị mất bán | Doanh thu mất bán | Giá trị tồn dư cuối kỳ |
|---|---|---|---|---|---|
| P1 | 2604870 | 849998 | 256558 | 422689 | 750032 |
| P2 | 1975584 | 769199 | 337357 | 551688 | 435389 |
| P3 | 2066277 | 781436 | 325120 | 532296 | 480736 |
| P4 | 1451593 | 617035 | 489521 | 791587 | 173394 |

### Bootstrap theo SKU (S7)

| So sánh | Hiệu số (phương án − baseline) | CI 95% | CI có chứa 0? | SKU thắng/thua/hoà | Tỉ lệ thắng | Đủ bằng chứng (>55%)? |
|---|---|---|---|---|---|---|
| P2 vs P1 | -0.4973 | [-0.6172, -0.3982] | không | 377/89/5 (n=471, loại 27) | 80.04% | CÓ |
| P2 vs P4 | 0.2188 | [0.1200, 0.3334] | không | 167/299/5 (n=471, loại 27) | 35.46% | KHÔNG |
| P3 vs P1 | -0.4390 | [-0.5559, -0.3273] | không | 354/114/3 (n=471, loại 27) | 75.16% | CÓ |
| P3 vs P4 | 0.2771 | [0.1603, 0.4157] | không | 155/313/3 (n=471, loại 27) | 32.91% | KHÔNG |

### Chất lượng dự báo — WAPE (S8)

| Mô hình | Công thức | WAPE (TB 3 cửa sổ) |
|---|---|---|
| P1 (chính sách tồn kho) | ŷ = d_ref | 103.63% |
| P2 (chính sách tồn kho) | ŷ = d_ref | 104.00% |
| P3 (chính sách tồn kho) | ŷ = d_ref | 103.97% |
| P4 (chính sách tồn kho) | ŷ = d_ref | 104.34% |
| naive (baseline dự báo, **không** đặt hàng) | y(t-1) | 130.55% |
| seasonal-naive (baseline dự báo, **không** đặt hàng) | y(t-7) | 117.22% |

## Nhánh censored B (kiểm tra độ nhạy — S3)

| Phương án | Cấu hình chọn (tập giữa) | Chi phí chuẩn hoá / đơn vị (TB 3 cửa sổ) | WAPE | Ngày hết hàng (mô phỏng) | Fill rate | Số PO / 100 lần rà soát |
|---|---|---|---|---|---|---|
| P1 | P1(DOC=14), P1(DOC=14), P1(DOC=14) | 2.9722 | 100.85% | 18.03% | 75.35% | 6.4 |
| P2 | P2(z=0.8), P2(z=0.85), P2(z=0.8) | 2.5005 | 99.62% | 22.69% | 66.86% | 10.3 |
| P3 | P3(z=0.8,a=0.1), P3(z=0.85,a=0.1), P3(z=0.8,a=0.1) | 2.6105 | 100.01% | 21.76% | 68.37% | 10.2 |
| P4 | P4(DOC=7), P4(DOC=14), P4(DOC=7) | 2.5136 | 97.34% | 32.24% | 53.20% | 33.5 |

### Bootstrap (nhánh B)

| So sánh | Hiệu số (phương án − baseline) | CI 95% | CI có chứa 0? | SKU thắng/thua/hoà | Tỉ lệ thắng | Đủ bằng chứng (>55%)? |
|---|---|---|---|---|---|---|
| P2 vs P1 | -0.4612 | [-0.5776, -0.3647] | không | 362/102/7 (n=471, loại 27) | 76.86% | CÓ |
| P2 vs P4 | -0.0196 | [-0.1080, 0.0675] | CÓ | 222/243/6 (n=471, loại 27) | 47.13% | KHÔNG |
| P3 vs P1 | -0.3731 | [-0.4985, -0.2632] | không | 331/137/3 (n=471, loại 27) | 70.28% | CÓ |
| P3 vs P4 | 0.0686 | [-0.0333, 0.1724] | CÓ | 188/279/4 (n=471, loại 27) | 39.92% | KHÔNG |

## Độ nhạy: ngưỡng so ATP thuần (đọc §2.1 theo chữ) thay vì ATP + onOrder

| Phương án | Cấu hình chọn (tập giữa) | Chi phí chuẩn hoá / đơn vị (TB 3 cửa sổ) | WAPE | Ngày hết hàng (mô phỏng) | Fill rate | Số PO / 100 lần rà soát |
|---|---|---|---|---|---|---|
| P1 | P1(DOC=14), P1(DOC=14), P1(DOC=14) | 17.6585 | 103.63% | 11.30% | 86.61% | 24.1 |
| P2 | P2(z=0.95), P2(z=0.8), P2(z=0.8) | 9.7055 | 103.60% | 12.29% | 84.57% | 26.3 |
| P3 | P3(z=0.8,a=0.1), P3(z=0.8,a=0.1), P3(z=0.8,a=0.1) | 10.4258 | 103.80% | 12.75% | 83.53% | 25.9 |
| P4 | P4(DOC=7), P4(DOC=7), P4(DOC=7) | 4.5281 | 104.24% | 18.60% | 73.62% | 32.5 |

### Bootstrap (atpOnly)

| So sánh | Hiệu số (phương án − baseline) | CI 95% | CI có chứa 0? | SKU thắng/thua/hoà | Tỉ lệ thắng | Đủ bằng chứng (>55%)? |
|---|---|---|---|---|---|---|
| P2 vs P1 | -7.8934 | [-9.0259, -6.8318] | không | 449/17/5 (n=471, loại 27) | 95.33% | CÓ |
| P2 vs P4 | 5.1113 | [4.4393, 5.8929] | không | 21/446/4 (n=471, loại 27) | 4.46% | KHÔNG |
| P3 vs P1 | -7.3334 | [-8.5271, -6.2297] | không | 439/29/3 (n=471, loại 27) | 93.21% | CÓ |
| P3 vs P4 | 5.6712 | [4.9379, 6.5524] | không | 12/456/3 (n=471, loại 27) | 2.55% | KHÔNG |

## Lead time 3 ngày (kiểm tra độ nhạy — S4)

| Phương án | Cấu hình chọn (tập giữa) | Chi phí chuẩn hoá / đơn vị (TB 3 cửa sổ) | WAPE | Ngày hết hàng (mô phỏng) | Fill rate | Số PO / 100 lần rà soát |
|---|---|---|---|---|---|---|
| P1 | P1(DOC=14), P1(DOC=14), P1(DOC=14) | 3.0588 | 103.28% | 10.61% | 85.19% | 7.2 |
| P2 | P2(z=0.8), P2(z=0.8), P2(z=0.8) | 2.2048 | 103.70% | 18.43% | 71.73% | 9.0 |
| P3 | P3(z=0.8,a=0.1), P3(z=0.8,a=0.1), P3(z=0.8,a=0.1) | 2.2652 | 103.69% | 17.60% | 72.87% | 9.0 |
| P4 | P4(DOC=7), P4(DOC=7), P4(DOC=7) | 2.0920 | 103.52% | 19.97% | 67.27% | 40.1 |

## Lead time 14 ngày (kiểm tra độ nhạy — S4)

| Phương án | Cấu hình chọn (tập giữa) | Chi phí chuẩn hoá / đơn vị (TB 3 cửa sổ) | WAPE | Ngày hết hàng (mô phỏng) | Fill rate | Số PO / 100 lần rà soát |
|---|---|---|---|---|---|---|
| P1 | P1(DOC=14), P1(DOC=14), P1(DOC=14) | 3.3400 | 105.73% | 28.76% | 61.78% | 5.0 |
| P2 | P2(z=0.8), P2(z=0.8), P2(z=0.8) | 3.1650 | 105.07% | 26.31% | 63.18% | 10.4 |
| P3 | P3(z=0.8,a=0.1), P3(z=0.8,a=0.1), P3(z=0.8,a=0.1) | 3.3018 | 105.28% | 25.96% | 63.67% | 10.1 |
| P4 | P4(DOC=7), P4(DOC=14), P4(DOC=14) | 2.7556 | 106.13% | 35.81% | 50.38% | 35.2 |
