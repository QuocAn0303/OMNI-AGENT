# Phase 1 (AN.1 / R1) — Môi trường, phân quyền, schema, dữ liệu mẫu

Tài liệu này ghi lại **cái đã kiểm chứng được** cho hạng mục R1, kèm lệnh tái lập
để người khác tự chạy lại và thấy đúng số liệu đó.

## 1. Ba hạng mục của R1 và trạng thái

| Hạng mục | Yêu cầu | Trạng thái | Bằng chứng |
|---|---|---|---|
| Môi trường | Backend chạy, kết nối DB | ✅ đạt | `npx prisma migrate status` → up to date (30/30 migration); `/api/health` → `status: ok`; `npm run check:modules` → 204/204 module |
| Phân quyền | 3 người đăng nhập đúng role | ✅ đạt | `P1.admin` / `P1.manager` / `P1.cashier` đăng nhập thật qua `POST /api/auth/login`, trả đúng `role` + JWT |
| Dữ liệu mẫu | ≥ 300 dòng mỗi bảng | ✅ đạt | `npm run verify:phase1` → 9/9 bảng đạt |
| Tên field đã chốt | Không còn đổi tên cột | ✅ đạt | [`field-freeze.md`](./field-freeze.md) — 212 cột của 9 bảng, sinh từ schema thật |

## 2. Vì sao có một tenant riêng `crm-phase1-demo`

Dữ liệu mẫu **không** trộn vào dữ liệu thật:

- `candory-scent` — shop thật (đơn đã ký, không đụng).
- `omni-demo-mo-phong` — tenant MÔ PHỎNG đang phục vụ đồ án AISC26 (không đụng).
- `crm-phase1-demo` — tenant dùng để trình diễn R1→R4, xoá sạch được bằng một lệnh.

## 3. Tái lập

```bash
npm run seed:phase1            # xem kế hoạch (dry-run, KHÔNG ghi)
npm run seed:phase1:apply      # nạp dữ liệu mẫu (chạy ~5 giây)
npm run verify:phase1          # in bảng số dòng, exit 1 nếu bảng nào < 300

npm run seed:phase1:reset      # XOÁ SẠCH tenant Phase 1 rồi nạp lại từ đầu
```

Script có `assertLocalDb` nên từ chối chạy nếu `DATABASE_URL` không trỏ localhost
hoặc `NODE_ENV=production`.

## 4. Tài khoản trình diễn

| Vai trò | Email | Mật khẩu |
|---|---|---|
| ADMIN | `P1.admin@crm.local` | `123456` |
| MANAGER | `P1.manager@crm.local` | `123456` |
| CASHIER | `P1.cashier@crm.local` | `123456` |

Gói cướng gán là `enterprise` (`allowedModules = ["*"]`) nên các endpoint CRM /
segments / marketing / analytics ở phase sau không bị `plan.middleware` chặn.

## 5. Dữ liệu mẫu được cố ý phân bố, không ngẫu nhiên thuần

PRNG có seed cố định (`20261004`) nên **hai người chạy đều ra cùng một bộ dữ liệu**
— cần thiết khi so số liệu giữa các buổi trình bày.

- Lịch sử đơn trải đều 12 tháng; **~30% khách "ngủ đông"** (đơn cuối cách hôm nay
  > 120 ngày) ⇒ phân khúc RFM `At-Risk` và cảnh báo churn có dữ liệu thật ở
  Phase 3–4, không phải bảng toàn khách mới.
- `paymentStatus` khớp với số payment: `PAID` → 1 payment, `PARTIAL` → 1 payment
  thiếu một nửa, `UNPAID`/`CANCELLED` → không có payment. `customers.totalSpent`
  được cộng dồn đúng bằng tổng tiền thực thanh toán.
- Tên/SĐT/địa chỉ là dữ liệu **mô phỏng kiểu Việt Nam**, không phải PII thật.
  Email kết thúc bằng `.local` (tên miền không tồn tại) để không gửi nhầm email.

## 6. Kết quả kiểm chứng (đo 04/10/2026)

```
products              sản phẩm              320   OK
customers             khách hàng            320   OK
orders                đơn hàng              696   OK
order_items           chi tiết đơn         1427   OK
payments              thanh toán             641   OK
crm_leads             lead                  320   OK
crm_deals             deal                  320   OK
crm_communications    tương tác             320   OK
customer_tasks        công việc CSKH        320   OK
```

Phân bố: đơn `COMPLETED 629 / SHIPPING 39 / CANCELLED 28`;
lead `NEW 77 · CONTACTED 100 · QUALIFIED 70 · CONVERTED 51 · DEAD 22`;
deal `ONGOING 184 · WON 83 · LOST 53`.

## 7. Cố ý KHÔNG seed

| Bảng | Lý do |
|---|---|
| `churn_alerts` | Phải do `churn-automation.service.js` tự sinh — đó mới là bằng chứng cho AN.4 ("khách churn cao nhận voucher không bấm tay"). Seed tay thì mất ý nghĩa. |
| `saved_reports` | 10 báo cáo R-01…R-10 được cấu hình ở `report-builder/default-reports.seed.js`, nạp ở Phase 3. |
| `customer_notes`, `customer_tags`, `customer_segments`, `crm_pipeline_stages` | Dữ liệu cấu hình nhỏ, để phase sau sinh đúng lúc cần. |

## 8. Ngoài phạm vi Phase 1

- Không thêm cột mới nào. `prisma/schema.prisma` không bị sửa bởi phase này.
- `payments` của các tenant khác không bị đụng; chỉ tenant Phase 1 có payment
  khớp với đơn.
- Không có bảng nào bị xoá ngoài tenant `crm-phase1-demo`.
