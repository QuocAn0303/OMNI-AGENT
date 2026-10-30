# PHIẾU CHỌN SỐ LƯỢNG ĐẶT — in ra giấy, điền tay

**Mã người thử:** `P___`  **Bộ SKU:** `___`  **Điều kiện:** ☐ 1 (không hệ thống) ☐ 2 (có hệ thống)

**Cách điền:** với **từng** món, viết **số lượng bạn sẽ đặt hôm nay**. Nếu cho rằng
không cần đặt, viết **0**. Ô trống = người thử không kịp làm tới ⇒ **để trống**, đừng
điền 0 thay.

| # | SKU | Tên | Tồn khả dụng | Bình quân bán/ngày | Thời gian nhận | Giá vốn | *(chỉ ở điều kiện 2)* Hệ thống đề xuất | **BẠN CHỌN ĐẶT** |
|---|---|---|---:|---:|---:|---:|---:|---:|
| 1 |  |  |  |  |  |  |  |  |
| 2 |  |  |  |  |  |  |  |  |
| 3 |  |  |  |  |  |  |  |  |
| 4 |  |  |  |  |  |  |  |  |
| 5 |  |  |  |  |  |  |  |  |
| 6 |  |  |  |  |  |  |  |  |
| 7 |  |  |  |  |  |  |  |  |
| 8 |  |  |  |  |  |  |  |  |
| 9 |  |  |  |  |  |  |  |  |
| 10 |  |  |  |  |  |  |  |  |
| 11 |  |  |  |  |  |  |  |  |
| 12 |  |  |  |  |  |  |  |  |
| 13 |  |  |  |  |  |  |  |  |
| 14 |  |  |  |  |  |  |  |  |
| 15 |  |  |  |  |  |  |  |  |
| 16 |  |  |  |  |  |  |  |  |
| 17 |  |  |  |  |  |  |  |  |
| 18 |  |  |  |  |  |  |  |  |
| 19 |  |  |  |  |  |  |  |  |
| 20 |  |  |  |  |  |  |  |  |

**Ghi chú của người thử (nếu họ muốn nói thêm):**

```
_________________________________________________________________
_________________________________________________________________
```

---

## Sau phiên — chép vào CSV

Mỗi dòng `decisions.csv`:

```
participant_id,set_key,sku,manual_qty,note
P01,A,23843,120,
```

- `set_key` = bộ SKU **đã in** cho phiên đó (`A` hoặc `B`), **không** phải bộ có cột
  đề xuất.
- Ô trống trên giấy ⇒ **không** tạo dòng CSV cho SKU đó (script tự bỏ qua).
- **Không** sửa số của người thử, kể cả khi có vẻ sai. Sai là dữ liệu.
