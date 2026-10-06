# Phase 2 (AN.2 / R2) — Webhook lead + Hồ sơ 360 độ

DoD của R2: *"Postman trả 200 và tạo đúng 1 Lead; mở khách bất kỳ thấy đủ giao dịch
+ tương tác + ticket + 2 chỉ số"*. Tài liệu này ghi lại cái đã kiểm chứng và lệnh
tái lập.

## 1. Trạng thái

| Hạng mục | Kết quả | Bằng chứng |
|---|---|---|
| Webhook trả 200/201 và tạo **đúng 1 lead** | ✅ | `npm run check:an2` — 16/16 kiểm tra OK |
| Hồ sơ 360 đủ 4 khối | ✅ | cùng lệnh trên, mở khách thật trong tenant Phase 1 |

## 2. Chạy lại

```bash
npm run dev                    # backend phải đang chạy
npm run seed:phase1:apply      # dữ liệu mẫu (nếu chưa có)
npm run check:an2              # 16 kiểm tra, tự dọn dẹp
npm run check:an2 -- --keep    # giữ lead + API key để mở UI xem
```

Script đi đúng đường người dùng đi (HTTP thật, không gọi service nội bộ):
`login → POST /webhook/crm-lead-key → bắn webhook → GET /customers/:id/full`.

## 3. Webhook — 5 lớp bảo vệ, mỗi lớp một kiểm tra

| Lớp | Cơ chế | Kiểm tra |
|---|---|---|
| 1 | `X-Tenant-Key` không hợp lệ → 401 | `Webhook không X-Tenant-Key bị từ chối 401` |
| 2 | Payload sai schema → 400 (Zod) | `leadSchema` ở `webhook-lead.routes.js` |
| 3 | `Idempotency-Key` trùng trong 24h → **200** + `duplicate:true`, cùng `leadId` | 3 kiểm tra |
| 4 | Trùng `mobileNo` trong tenant (thiếu key) → dùng lead cũ, ghi timeline | `3 lần gọi … chỉ tạo đúng 2 lead` |
| 5 | `@@unique([mobileNo, tenantId])` ở tầng DB — chặn race 2 request song song | migration `20261002100000_crm_lead_unique_mobile_email` |

Kết quả thật khi chạy: 4 lần POST (2 lần cùng `Idempotency-Key`, 2 lần không key
cùng một SĐT) → **đúng 2 lead**, tức mỗi SĐT một lead.

## 4. Hồ sơ 360 — bốn khối DoD yêu cầu

`GET /api/customers/:id/full` trả:

| Khối | Nguồn dữ liệu |
|---|---|
| **Giao dịch** | `recentOrders` + `debts` + `loyaltyTxs` |
| **Tương tác** | `communications` — `CrmCommunication` (CALL/EMAIL/MEETING/ZALO/WHATSAPP/SYSTEM) |
| **Ticket** | `tasks` — `CustomerTask` (công việc CSKH) |
| **2 chỉ số** | `metrics.rfm` (phân khúc + R/F/M) và `metrics.value` (CLV dự báo + xác suất rời bỏ) |

Thêm `metrics.totals` (đếm đơn / doanh thu / ticket đang mở) và `crm`
(contact / deal / lead gắn với khách).

### Điểm kỹ thuật quan trọng: tương tác không nằm trực tiếp trên khách

`CrmCommunication` **không có `customerId`**. Đường liên kết thật là:

```
CrmCommunication ──leadId──▶ CrmLead ──contactId──▶ CrmContact ──customerId──▶ Customer
                  ──dealId──▶ CrmDeal ──────────────────customerId────────────▶ Customer
                  ─contactId▶ CrmContact ───────────────customerId────────────▶ Customer
```

Vì vậy `getCustomer360()` phải gom 3 đường rồi mới hỏi timeline
(`customer.service.js`). Hệ quả trực tiếp cho dữ liệu mẫu: **không có
`crm_contacts` thì timeline của mọi khách đều rỗng** — đó là lý do Phase 1 bổ
sung 320 contact dù bảng này không nằm trong danh sách 9 bảng kiểm chứng.

### `rfm` top-level giữ lại

`metrics.rfm` là cấu trúc mới, nhưng `rfm` ở top-level **không bị bỏ** (trỏ cùng
object) để không phá client cũ. Có test ghim điều này.

### Không đoán bừa chỉ số

Khách có `< 2 đơn COMPLETED` thì `clv-forecast.service.js` trả `null`. Hồ sơ 360
hiển thị `"Chưa đủ dữ liệu"` + `metrics.value.insufficientData = true`, **không**
hiện `0đ` — tránh hiểu nhầm là khách không có giá trị.

## 5. Thay đổi trong Phase 2

| File | Thay đổi |
|---|---|
| `src/modules/customers/customer.service.js` | `getCustomer360()` thêm `communications`, `tasks`, `crm`, `metrics` |
| `frontend/src/pages/CustomerDetail.jsx` | Card "Phân khúc RFM", "CLV dự báo + churn", "Tương tác & ticket"; tab Tương tác tách 2 khối: tương tác CRM + ghi chú nội bộ |
| `prisma/seed_phase1_crm.js` | Thêm 320 `crm_contacts`; 55% lead gắn contact của khách |
| `tests/customer-360.service.test.js` | 8 test mới ghim 4 khối + 3 đường liên kết + trường hợp thiếu dữ liệu |
| `tests/customer.service.test.js` | Bổ sung mock cho các model mới |
| `scripts/check-an2-webhook-lead.js` | 16 kiểm tra qua HTTP thật, tự dọn dẹp |

Không thêm cột mới, không thêm migration.

## 6. Gate

- `npm test` → 79 suite / 4175 test pass
- `npm run check:modules` → 204/204
- `npm run check:an2` → 16/16
- `npx eslint src/pages/CustomerDetail.jsx` → 0 lỗi (1 cảnh báo cũ về `useEffect` dependency)
