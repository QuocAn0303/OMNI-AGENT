# Bộ SAMPLE — để thử script, KHÔNG phải kết quả thật

## Cảnh báo

> **Mọi số trong thư mục này là SAMPLE (bịa).** Không phải người thử, không phải kết
> quả đo. **Không được** trích ra báo cáo, slide, hay câu trả lời giám khảo.
> `summarize-results.js` in cảnh báo này ở đầu bảng khi chạy `--sample`.

## Sinh lại

```bash
npm run usertest:summarize -- --make-sample
npm run usertest:summarize -- --sample
```

- `tasks.sample.csv` — **3** người thử giả (`S01`…`S03`), 6 dòng (3 người × 2 điều
  kiện), nhóm `AB`/`BA` xen kẽ. Chọn **3** người có chủ đích để kịch bản cảnh báo
  "n < 5" chạy đúng — dưới 5 người thử chỉ được báo trung vị + khoảng.
- `decisions.sample.csv` — 120 dòng (6 phiếu × 20 SKU), số lượng bịa theo công thức
  `orderQty × (0,6 nếu SKU bán nhanh | 1,4 nếu bán chậm) × nhiễu nhỏ` để có biến thiên.

## Bộ này kiểm tra được những gì

1. Đọc CSV đúng chuẩn RFC 4180 (tên hàng có dấu phẩy và nháy kép).
2. Cảnh báo `n < 5` hiện ra.
3. Chấm P4 chạy được: `MANUAL` / `REF` / `NONE` trên `scripts/backtest/lib/simulate.js`.
4. Tính chênh lệch theo từng SKU và so trong cùng một người.
5. Cột `note` mang nhãn `SAMPLE` không lẫn vào dữ liệu thật.

## Bộ này **không** kiểm tra được

- Không có giá trị nghiệm thu nào (số bịa).
- Không thay thế được bài thử thật ở `../results/`.
