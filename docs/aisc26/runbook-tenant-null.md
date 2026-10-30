# Runbook: vá `tenantId IS NULL` trên môi trường thật

Tài liệu này dành cho **con người** chạy trên staging/production.
Agent **không** chạy các bước ghi trên môi trường ngoài máy cục bộ.

## Vì sao phải làm

Trước hotfix, Prisma extension chỉ gắn `tenantId` vào `data` cấp ngoài cùng.
Với `order.create({ data: { items: { create: [...] } } })` thì dòng `OrderItem`
sinh ra có `tenantId = NULL`, trong khi **mọi** truy vấn đọc đều lọc `tenantId`.

Hệ quả: dữ liệu vừa ghi xong **vô hình** với chính tenant của nó — báo cáo
doanh thu, đề xuất nhập hàng, mọi thống kê đều thiếu.

Đo trên DB phát triển (đã backfill xong):

| Chỉ số | Trước | Sau | Chênh lệch |
|---|---|---|---|
| `order_items` nhìn thấy được | 158 | 242 | +84 |
| Doanh thu nhìn thấy được | 89.862.000 | 131.862.000 | **+42.000.000 (+47%)** |
| Số SKU có nhu cầu | 20 | 23 | +3 |
| Tổng số lượng bán | 464 | 884 | +90% |

## Thứ tự bắt buộc

> **Đảo thứ tự sẽ sinh thêm NULL.** Phải triển khai hotfix **trước**, rồi mới vá dữ liệu.

1. **Sao lưu DB.**
2. **Triển khai hotfix** (nhánh `hotfix/tenant-nested-write`) — lúc này dữ liệu NULL
   vẫn còn nguyên, nhưng hệ thống **không ghi thêm** dòng NULL nữa.
3. `node scripts/tenant-null.js --scan` (chỉ đọc).
4. `node scripts/tenant-null.js --backfill` (dry-run) — **đọc kỹ câu SQL và số dòng.**
5. Chạy câu `UPDATE` trong **khung bảo trì** (không có giao dịch người dùng).
6. `node scripts/tenant-null.js --scan` lại.
7. `npm run check:tenant`.

## Các lệnh

```bash
# 1. Sao lưu (PostgreSQL 18 ví dụ)
pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
  --format=custom --file="/tmp/erp-before-tenant-backfill-$(date +%Y%m%d-%H%M%S).dump"

# 2. Triển khai hotfix (xem nhánh hotfix/tenant-nested-write)

# 3. Quét — chỉ đọc, chạy trong transaction READ ONLY
node scripts/tenant-null.js --scan --allow-remote

# 4. Xem kế hoạch vá — KHÔNG ghi gì
node scripts/tenant-null.js --backfill --allow-remote

# 5. Ghi — chạy câu SQL in ra ở bước 4, trong khung bảo trì
#    (đừng dùng --apply: script cố tình chặn ghi trên DB không cục bộ)

# 6. Quét lại — kỳ vọng 0 ở mọi bảng có bảng cha xác định được
node scripts/tenant-null.js --scan --allow-remote

# 7. Kiểm tra cách ly tenant
npm run check:tenant
```

## Bảng nào sẽ về 0, bảng nào sẽ không

Script **không đoán**. Ba trường hợp được xử lý khác nhau:

| Trường hợp | Ví dụ | Kết quả |
|---|---|---|
| Cha duy nhất có `tenantId` | `order_items.tenantId` ← `orders` | Về 0 |
| Nhiều cha, **các cha thống nhất** | `order_items` ← `orders` + `products` (2 cha cho cùng 1 tenant) | Về 0 |
| Không xác định được cha | `users.tenantId` ← `tenants` (bảng cha **không mang** `tenantId`) | **Không vá**, liệt kê ra |

Với bảng "không xác định được cha", script in ra danh sách và số dòng.
**Người xử lý phải quyết định tay** — agent không được đoán.

### Hai trường hợp dễ gặp, cần biết trước

- **`users.tenantId IS NULL` là hợp lệ với tài khoản cấp nền tảng.**
  `SUPER_OMEGA_ULTRA_ADMIN` cố ý không thuộc tenant nào (đi vòng qua cách ly
  tenant). Vì vậy **không** được ép `NOT NULL` cho `users.tenantId` nếu chưa tách
  riêng cột này.
- **`company_settings` là bảng 1-1 theo tenant** và không có khóa ngoại tới
  `tenants`. Dòng NULL ở đây không suy được từ bảng cha nào.

## Sau khi vá: dữ liệu số sẽ khác

Các báo cáo và đề xuất nhập hàng **sẽ thay đổi số liệu** vì trước đây thiếu dữ
liệu. Nêu điều này trước khi so số trước/sau, và ghi lại bảng so sánh cho từng
tenant vào biên bản triển khai. Đây là câu trả lời trung thực nếu giám khảo hỏi về
chất lượng dữ liệu.

## Nếu có bảng mới phát sinh NULL

1. Chạy `node scripts/tenant-null.js --scan --allow-remote` để xác định bảng.
2. Nếu bảng mới có `tenantId` mà **chưa** khai báo trong `TENANT_SCOPED_MODELS`
   (`src/config/prisma.js`): đó là lỗi — extension sẽ ghi nhưng không bao giờ
   đọc lọc được. Sửa khai báo rồi deploy, không vá dữ liệu trước.
3. Chạy lại `npm run check:tenant` — hiện đã có kiểm tra NULL, sẽ báo đỏ.

## Lệnh kiểm tra hằng ngày

`npm run check:tenant` hiện gồm bước quét NULL trên chính DB đang chạy.
Đây là hàng rào phát hiện sớm — đừng chỉ vào runbook.
