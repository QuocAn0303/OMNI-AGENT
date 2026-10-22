# Định dạng tệp xuất đơn sàn — nguồn + mức độ tin cậy

**Ngày kiểm: 2026-10-03.** Mục đích: T9 yêu cầu bộ sinh tệp xuất đơn *theo định dạng
Shopee*. Đây là ghi chú nguồn cho `scripts/dataset/gen-marketplace-orders.js`.

## Kết luận ngắn

**Shopee KHÔNG công khai đặc tả chính thức** cho tệp xuất đơn của người bán (Seller
Centre). Trang hỗ trợ chính thức không có trang schema/machine-readable. Vì vậy bộ
sinh ghi nhãn:

> **ĐỊNH DẠNG GIẢ ĐỊNH** — tên cột lấy từ tài liệu bên thứ ba, **không** khẳng
> định trùng giao diện thật, và **không** dùng để tuyên bố tương thích với hệ
> thống Shopee.

Nếu sau này đội có tài khoản Seller Centre thật, tải một tệp xuất thật rồi đối
chiếu lại tệp này và cập nhật. Không tự sửa tên cột cho "giống hơn" theo trí nhớ.

## Nguồn đã đọc

| # | Nguồn | URL | Ngày | Mức độ |
|---|---|---|---|---|
| 1 | ChatExcel — "How to Analyze Shopee and Lazada Order Exports" (liệt kê tên cột tiếng Anh của tệp xuất Shopee: `Order ID`, `Order Status`, `Return / Refund Status`, `Order Creation Date`, `Product Name`, `Variation Name`, `SKU Reference No.`, `Original Price`, `Deal Price`, `Quantity`, `Product Subtotal`, `Seller Voucher`, `Shopee Voucher`, `Buyer Paid Shipping Fee`, `Grand Total`, `Username (Buyer)`) | https://www.chatexcel.co/guides/analyze-shopee-lazada-orders | 2026-10-03 | Bên thứ ba, **không** phải tài liệu Shopee |
| 2 | Adverity — trường dữ liệu Shopee (tên trường API: `order_sn`, `item_list`, `model_quantity_purchased`, `model_discounted_price`, `original_price`, `total_amount`, `buyer_username`…) | https://docs.adverity.com/reference/connectors/connector-shopee.html | 2026-10-03 | Bên thứ ba, mô tả **API nội bộ** chứ không phải tệp xuất CSV |
| 3 | saucevn/onecsv — mapper Shopee (tiếng Việt: `Mã đơn`, `Ngày tạo`, `SKU`, `Tên sản phẩm`, `Số lượng`, `Đơn giá`…) | https://github.com/saucevn/onecsv | 2026-10-03 | Mã nguồn mở, giải thích bộ tên cột tiếng Việt |

## Ba điểm đã đọc được và dùng vào thiết kế

1. **Một dòng = một dòng hàng** (một đơn 3 mã ⇒ 3 dòng cùng `Order ID`); cột cấp
   đơn như `Grand Total` lặp lại ở mọi dòng ⇒ **cộng `Grand Total` sẽ đếm thừa**.
   Bộ sinh vì vậy ghi `Grand Total` lặp lại đúng như vậy, đồng thời tách
   `marketplace_orders_truth.csv` để có tổng đúng khi kiểm.
2. **`Quantity` là số lượng thật** (khác hẳn Lazada là một dòng = một đơn vị).
3. **Không có cột tồn kho, lead time, chi phí sàn trong tệp xuất** ⇒ mọi thứ suy
   ra từ đó đều là MÔ PHỎNG.

## Phần bắt buộc phải ghi khi dùng tệp sinh ra

- Toàn bộ tệp là **MÔ PHỎNG**; mã đơn có tiền tố `MOPHONG-`.
- **Không** rút bất kỳ chỉ số hiệu quả kinh doanh nào (tỉ lệ khớp SKU, tốc độ,
  độ chính xác) từ tệp này mà không gắn nhãn "trên dữ liệu tự tạo".