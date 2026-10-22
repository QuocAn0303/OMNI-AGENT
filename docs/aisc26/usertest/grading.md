# Chấm quyết định tay (P4) — bằng cùng bộ mô phỏng với backtest

**P4 là gì:** theo `03-evaluation-protocol.md` S9, baseline thứ tư của giao thức là
**"người quyết định tay"**. Ở bài thử người dùng, P4 chính là **số lượng người thử viết
tay** cho từng SKU. Việc của tệp này: chấm số đó **bằng đúng bộ mô phỏng đã dùng cho
backtest T10**, không tự chế chỉ số mới.

## 1. Một kịch bản, ba biến thể, một hàm mô phỏng

Hàm dùng: `scripts/backtest/lib/simulate.js` — **cùng tệp** mà `npm run backtest` và
`npm run backtest:exp2` dùng. Không có bản mô phỏng riêng cho bài thử.

Với mỗi SKU của bộ đang chấm:

| Biến thể | Chính sách đặt hàng |
|---|---|
| **MANUAL** | đặt **đúng số** người thử chọn, **một lần** tại ngày 0. Những ngày sau không đặt. |
| **REF** | **hệ thống**: rà soát **hằng ngày**, đặt `max(0, ROP − vị thế)` — đúng công thức sản phẩm (`ROP = nhu_cầu/ngày × LT + tồn kho an toàn`). |
| **NONE** | không đặt gì. |

Tham số chung: `nDays` = 14, `leadTimeDays` = lead time của SKU tại as-of,
`initialAtp` = ATP + hàng đang trên đường, `costPerUnit` = giá vốn,
`positionMode = withOnOrder`, `packMultiple = 1`.

## 2. Chân trời nhu cầu — và vì sao nó có nhìn trước

Chân trời là **14 ngày lịch gần nhất (trong cửa sổ lịch sử tính tới as-of) của chính
SKU đó**, điền 0 cho ngày không bán. Nằm trong `sku-sets.json` →
`grading.horizonBySku`.

- **Ưu:** cùng một kịch bản cho mọi người thử ⇒ số mới so sánh được; không phụ thuộc
  vào thời điểm họ làm bài.
- **Nhược — phải nói thẳng:** chân trời nằm **trong quá khứ**, ta đã biết trước nó. Vì
  vậy đây **không phải dự báo** và **không** đo "hệ thống có đoán đúng không"; nó chỉ đo
  *"với một kịch bản đã biết trước, quyết định của hệ thống và quyết định của người
  khác nhau thế nào"*.

## 3. Bất lợi của hệ thống — không được giấu

REF được rà soát **14 lần** (mỗi ngày), MANUAL chỉ **một lần**. Ở mô phỏng tồn kho,
rà soát nhiều lần hơn thì tự động có lợi. Phép so này **không** công bằng về thuật toán;
nó cố ý so **"một quy trình có người chạy hằng ngày"** với **"một quyết định tắt"**.

Vì vậy khi báo cáo:
1. Nói rõ sự bất lợi này **trước** khi nói kết quả.
2. Không dùng kết quả này để nói "công thức ROP tốt hơn người làm tay" — đó là kết luận
   sai, và `03-evaluation-results.md` mục 1 đã ghi rõ chỉ số chính thí nghiệm 1 thưởng
   cho việc bán ít (bán ít hơn 9,5%, mất bán nhiều hơn 31,5%, fill rate 69,51% so với
   76,81%).
3. Kết quả hợp lệ để nói: **"mức lệch giữa số người chọn và số hệ thống đề xuất"**,
   **"thời gian làm bài"**, **"họ có theo đề xuất không"** — ba cái này không cần mô
   phỏng để có nghĩa.

## 4. Chỉ số in ra

Mỗi phiếu (một người thử × một điều kiện), cộng lại trên 20 SKU:

| Chỉ số | Nguồn | Nhãn |
|---|---|---|
| Đơn vị mất bán | `sim.lostUnits` | MÔ PHỎNG |
| Giá trị tồn trung bình | `sim.avgValue` (TB ATP × giá vốn) | MÔ PHỎNG, tiền **sterling** |
| `\|số lượng − số hệ thống\|` | trừ trực tiếp, không mô phỏng | MÔ PHỎNG |
| Tỉ lệ TAY / HỆ THỐNG | `manual_qty / orderQty` | MÔ PHỲNG |

Báo cáo **chỉ** trung vị + khoảng min–max. Dưới 5 người thử: không phần trăm, không
p-value, **không nói "có ý nghĩa thống kê"**.

## 5. Chạy

```bash
# chấm thật
npm run usertest:summarize -- \
  --tasks docs/aisc26/usertest/results/tasks.csv \
  --decisions docs/aisc26/usertest/results/decisions.csv

# chấm thử bằng bộ SAMPLE (số bịa) — chỉ để kiểm tra đường chấm
npm run usertest:summarize -- --sample
```

Kịch bản phải khớp `sha256` ghi trong `sku-sets.md`. Nếu kịch bản được sinh lại sau khi
đã thu kết quả thì **phải chấm lại từ đầu** — số cũ không còn đúng nghĩa.
