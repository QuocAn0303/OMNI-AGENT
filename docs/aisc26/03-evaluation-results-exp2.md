<!-- SINH TỰ ĐỘNG bởi `npm run backtest:exp2` — phần bảng KHÔNG sửa tay. -->
<!-- run_id: BT2-20261003065054 · commit mã: 60a2d84 -->

# THÍ NGHIỆM 2 — post-hoc, khám phá: hàm mục tiêu có ràng buộc dịch vụ

> **Nhãn bắt buộc: "Thí nghiệm 2 — post-hoc, khám phá".** Đăng ký SAU khi đã
> thấy kết quả thí nghiệm 1 (`03-evaluation-protocol.md` §13.2, commit đăng ký
> trước lần chạy). **Không** dùng để sửa hay rút lại kết luận của thí nghiệm 1.
> Mọi chỉ số tồn kho dưới đây vẫn là **MÔ PHỎNG** (dataset không có tồn kho,
> lead time quan sát được, kênh bán, giá vốn thật).

```
Nguồn dữ liệu : CÔNG KHAI — daily_sku.csv · sha256 82f068efa759e9d024bfef6ff51a5b507559c8d2a79410a09dbc9bd60983e33f
Khoảng thời gian: 2009-12-01 → 2011-12-09 (739 ngày)
Cỡ mẫu       : 500 SKU dùng được / 500 SKU trong tệp
Cửa sổ trượt : 3 (test = 2011-11, 2011-10, 2011-09)
Lead time     : 3/7/14 · nhánh censored: A,B · positionMode: withOnOrder,atpOnly
Ràng buộc    : fillRate(tập giữa) >= 95% · chọn z/DOC nhỏ nhất đạt ràng buộc
Dải khớp DV  : ±2 điểm phần trăm theo từng SKU
Bootstrap    : seed 20261003 · 1000 lần · đơn vị resample = SKU (S7)
run_id        : BT2-20261003065054
Commit mã     : 60a2d84
Commit giao thức: 69a7ba2 (§13.2)
Lệnh chạy lại : npm run backtest:exp2
```

## Lead time 7 ngày · nhánh censored A · ngưỡng so `ATP + onOrder` — **bảng chính**

| Phương án | Cấu hình chọn (tập giữa) | fillRate(tập giữa) | Ràng buộc 95% khả thi? | Fill rate (kiểm định) | **Giá trị tồn TB / SKU** | Chi phí chuẩn hoá / đơn vị | Đơn vị mất bán | PO/100 rà soát |
|---|---|---|---|---|---|---|---|---|
| P1 | P1(DOC=28), P1(DOC=28), P1(DOC=28) | 88.66% | **KHÔNG** | 85.42% | 1072.8683 | 4.7816 | 157855 | 5.0 |
| P2 | P2(z=0.95), P2(z=0.95), P2(z=0.95) | 80.29% | **KHÔNG** | 75.67% | 343.3138 | 2.5940 | 267300 | 13.2 |
| P3 | P3(z=0.95,a=0.1), P3(z=0.95,a=0.1), P3(z=0.95,a=0.1) | 80.65% | **KHÔNG** | 76.13% | 371.3909 | 2.7192 | 261753 | 12.3 |
| P4 | P4(DOC=28), P4(DOC=28), P4(DOC=28) | 85.35% | **KHÔNG** | 81.63% | 506.9873 | 3.1693 | 199240 | 57.5 |

### Giá trị tồn trung bình ở cùng mức dịch vụ (§13.2.3 — khớp ±2 điểm phần trăm theo SKU)

| So sánh | Chênh lệch TB tồn (a − b) | CI 95% | CI có chứa 0? | SKU tồn thấp hơn/cao hơn/hoà | Tỉ lệ thắng | n khớp | loại | Đủ bằng chứng (>55% + CI loại 0)? |
|---|---|---|---|---|---|---|---|---|
| P2 vs P1 | -954.6309 | [-1209.9490, -752.9210] | không | 131/0/1 | 99.24% | 132 | 367 | **CÓ** |
| P2 vs P4 | -195.3868 | [-257.2884, -144.9323] | không | 137/16/1 | 88.96% | 154 | 345 | **CÓ** |
| P3 vs P1 | -901.0280 | [-1151.7021, -700.2012] | không | 124/4/1 | 96.12% | 129 | 370 | **CÓ** |
| P3 vs P4 | -178.1946 | [-243.8028, -119.5923] | không | 128/21/1 | 85.33% | 150 | 349 | **CÓ** |

## Lead time 7 ngày · nhánh censored B · ngưỡng so `ATP + onOrder`

| Phương án | Cấu hình chọn (tập giữa) | fillRate(tập giữa) | Ràng buộc 95% khả thi? | Fill rate (kiểm định) | **Giá trị tồn TB / SKU** | Chi phí chuẩn hoá / đơn vị | Đơn vị mất bán | PO/100 rà soát |
|---|---|---|---|---|---|---|---|---|
| P1 | P1(DOC=28), P1(DOC=28), P1(DOC=28) | 88.62% | **KHÔNG** | 85.33% | 1055.5857 | 4.7158 | 158771 | 5.0 |
| P2 | P2(z=0.95), P2(z=0.95), P2(z=0.95) | 79.63% | **KHÔNG** | 74.91% | 335.1896 | 2.5884 | 275615 | 13.2 |
| P3 | P3(z=0.95,a=0.1), P3(z=0.95,a=0.1), P3(z=0.95,a=0.1) | 79.98% | **KHÔNG** | 75.36% | 366.2797 | 2.7216 | 270426 | 12.3 |
| P4 | P4(DOC=28), P4(DOC=28), P4(DOC=28) | 85.27% | **KHÔNG** | 81.44% | 499.7582 | 3.1410 | 201252 | 57.4 |

### Giá trị tồn trung bình ở cùng mức dịch vụ (§13.2.3 — khớp ±2 điểm phần trăm theo SKU)

| So sánh | Chênh lệch TB tồn (a − b) | CI 95% | CI có chứa 0? | SKU tồn thấp hơn/cao hơn/hoà | Tỉ lệ thắng | n khớp | loại | Đủ bằng chứng (>55% + CI loại 0)? |
|---|---|---|---|---|---|---|---|---|
| P2 vs P1 | -981.8072 | [-1232.7209, -747.3467] | không | 122/0/1 | 99.19% | 123 | 376 | **CÓ** |
| P2 vs P4 | -201.4127 | [-261.7156, -144.8089] | không | 127/16/1 | 88.19% | 144 | 355 | **CÓ** |
| P3 vs P1 | -877.5923 | [-1153.4689, -665.9160] | không | 110/4/1 | 95.65% | 115 | 384 | **CÓ** |
| P3 vs P4 | -176.4729 | [-246.7571, -114.5026] | không | 109/19/1 | 84.50% | 129 | 370 | **CÓ** |

## Frontier — MỌI cấu hình trên tập kiểm định (LT=7, nhánh A, ATP + onOrder)

Bảng bắt buộc: tồn trung bình và mức dịch vụ đánh đổi với nhau, không được giấu đường biên.

| Phương án | Cấu hình | Fill rate | **Giá trị tồn TB / SKU** | Chi phí chuẩn hoá | Đơn vị mất bán | PO/100 rà soát | Được chọn? |
|---|---|---|---|---|---|---|---|
| P1 | P1(DOC=7) | 64.01% | 235.2213 | 2.4316 | 397173 | 6.7 |  |
| P1 | P1(DOC=14) | 77.34% | 442.3699 | 2.9135 | 247241 | 6.6 |  |
| P1 | P1(DOC=21) | 82.97% | 735.0528 | 3.7953 | 184765 | 5.8 |  |
| P1 | P1(DOC=28) | 85.42% | 1072.8683 | 4.7816 | 157855 | 5.0 | ✔ |
| P2 | P2(z=0.8) | 70.17% | 269.9670 | 2.4372 | 328249 | 10.5 |  |
| P2 | P2(z=0.85) | 71.40% | 283.6851 | 2.4832 | 314770 | 11.0 |  |
| P2 | P2(z=0.9) | 72.93% | 303.4024 | 2.5344 | 297533 | 11.6 |  |
| P2 | P2(z=0.95) | 75.67% | 343.3138 | 2.5940 | 267300 | 13.2 | ✔ |
| P3 | P3(z=0.8,a=0.1) | 71.24% | 300.0375 | 2.5533 | 316098 | 10.4 |  |
| P3 | P3(z=0.85,a=0.1) | 72.47% | 314.6609 | 2.5875 | 302411 | 10.9 |  |
| P3 | P3(z=0.9,a=0.1) | 73.88% | 336.2784 | 2.6547 | 286687 | 11.4 |  |
| P3 | P3(z=0.95,a=0.1) | 76.13% | 371.3909 | 2.7192 | 261753 | 12.3 | ✔ |
| P4 | P4(DOC=7) | 56.52% | 174.1165 | 2.1971 | 480378 | 34.8 |  |
| P4 | P4(DOC=14) | 70.40% | 246.4927 | 2.2701 | 324657 | 50.7 |  |
| P4 | P4(DOC=21) | 77.82% | 367.0176 | 2.6612 | 241678 | 56.3 |  |
| P4 | P4(DOC=28) | 81.63% | 506.9873 | 3.1693 | 199240 | 57.5 | ✔ |

## Lead time 3 ngày (độ nhạy — S4) · nhánh A · ATP + onOrder

| Phương án | Cấu hình chọn | fillRate(tập giữa) | Ràng buộc khả thi? | Fill rate (kiểm định) | **Giá trị tồn TB / SKU** | Đơn vị mất bán |
|---|---|---|---|---|---|---|
| P1 | P1(DOC=28), P1(DOC=28), P1(DOC=28) | 92.86% | **KHÔNG** | 90.50% | 1292.1746 | 102815 |
| P2 | P2(z=0.95), P2(z=0.95), P2(z=0.95) | 79.96% | **KHÔNG** | 75.96% | 278.7512 | 263692 |
| P3 | P3(z=0.95,a=0.1), P3(z=0.95,a=0.1), P3(z=0.95,a=0.1) | 80.59% | **KHÔNG** | 76.88% | 298.1484 | 253245 |
| P4 | P4(DOC=28), P4(DOC=28), P4(DOC=28) | 89.95% | **KHÔNG** | 87.35% | 652.0955 | 136458 |

## Lead time 14 ngày (độ nhạy — S4) · nhánh A · ATP + onOrder

| Phương án | Cấu hình chọn | fillRate(tập giữa) | Ràng buộc khả thi? | Fill rate (kiểm định) | **Giá trị tồn TB / SKU** | Đơn vị mất bán |
|---|---|---|---|---|---|---|
| P1 | P1(DOC=28), P1(DOC=28), P1(DOC=28) | 78.18% | **KHÔNG** | 71.87% | 822.8187 | 311927 |
| P2 | P2(z=0.95), P2(z=0.95), P2(z=0.95) | 74.22% | **KHÔNG** | 67.68% | 390.2732 | 358029 |
| P3 | P3(z=0.95,a=0.1), P3(z=0.95,a=0.1), P3(z=0.95,a=0.1) | 74.72% | **KHÔNG** | 68.18% | 418.8547 | 352196 |
| P4 | P4(DOC=28), P4(DOC=28), P4(DOC=28) | 74.07% | **KHÔNG** | 67.24% | 364.1077 | 362622 |

## Ghi chú bắt buộc

1. **post-hoc, khám phá.** Mọi bảng trên được đăng ký sau khi đã thấy kết quả
   thí nghiệm 1, nên không được trình bày như một thí nghiệm tiền đăng ký.
2. **Ràng buộc 95% khả thi hay không** — cột "Ràng buộc 95% khả thi?". Nếu là
   `KHÔNG` thì mọi so sánh "ở cùng mức dịch vụ" ở đây là so ở mức dịch vụ
   **thấp nhất có thể**, KHÔNG phải 95% (protocol §13.2.4 mục 4).
3. Không được nói "ROP tốt hơn" trừ khi CI 95% **loại 0** *và* tỉ lệ SKU thắng
   **> 55%** (§13.2.4).
4. Kết quả thí nghiệm 1 **không bị sửa**. So sánh cạnh nhau nằm trong phần tay
   của `03-evaluation-results.md`.
