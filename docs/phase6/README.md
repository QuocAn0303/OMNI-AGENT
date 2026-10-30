# Phase 6 (AN.6 / R6) — Tài liệu kỹ thuật, backup, chuẩn bị hỏi đáp

| Hạng mục | Trạng thái |
|---|---|
| Mục 3.1 — mô hình churn | ✅ [`3.1-churn-model.md`](./3.1-churn-model.md) |
| Mục 3.2 — RFM | ✅ [`3.2-rfm.md`](./3.2-rfm.md) |
| Mục 3.5 — tự động hoá voucher | ✅ [`3.5-automation-voucher.md`](./3.5-automation-voucher.md) |
| Phụ lục A — bảng số liệu | ✅ [`PHU-LUC-A.md`](./PHU-LUC-A.md) |
| Backup + **restore thử** | ✅ 16/16 bảng khớp hoàn toàn (Phụ lục A §A.11) |
| Chuẩn bị hỏi đáp | ⚠️ [`QA.md`](./QA.md) — **tài liệu đã có, nhưng phần luyện tập cần người thật** |

## Chưa làm được — cần người thật

Phần này tôi **không tự làm thay được**, cần đội ngũ thực hiện:

1. **Luyện Q&A kỹ thuật** — `QA.md` có 20+ câu hỏi dạng giảng viên hỏi kèm trả lời và
   bằng chứng. Việc còn lại là **đọc và trả lời lại bằng lời của mình**, phản xạ trước khi
   bị hỏi thật.
2. **Demo 2 lần liên tiếp không lỗi** — cần chạy thử trên máy trình diễn, có người thao tác.
3. **Ảnh chụp màn hình** cho Phụ lục A §A.12 (danh sách 5 ảnh đã ghi sẵn).

## Lệnh tái lập toàn bộ

```bash
npm run seed:phase1:apply     # dữ liệu mẫu (5 giây, tất định)
npm run verify:phase1        # 9 bảng ≥ 300 dòng
npm run check:an2            # webhook + hồ sơ 360 (16 kiểm tra)
npm run check:an3            # RFM realtime + 3 báo cáo khớp DB (14 kiểm tra)
npm run check:an4            # voucher tự động (13 kiểm tra)
npm run check:kpi            # KPI giữ chân khớp DB (12 kiểm tra)
npm run backup:verify        # restore thử, so số dòng từng bảng (6 kiểm tra)
npm test                     # 4190 unit test
```

Backend phải đang chạy cho `check:an2/3/4` và `check:kpi` (chúng gọi HTTP thật).

## Tài khoản trình diễn

| Vai trò | Email | Mật khẩu |
|---|---|---|
| ADMIN | `P1.admin@crm.local` | `123456` |
| MANAGER | `P1.manager@crm.local` | `123456` |
| CASHIER | `P1.cashier@crm.local` | `123456` |

Tenant: `crm-phase1-demo`. **Không dùng những tài khoản này cho dữ liệu thật** — mật khẩu
cố ý để dễ nhớ trên máy trình diễn, đúng như `prisma/seed.js`.

## Ba con số để mở đầu phần trình bày

| Con số | Nguồn |
|---|---|
| **AUC 0,6857** (đề yêu cầu ≥ 0,65; công thức cũ 0,6347) | `npm run ml:train` |
| **270 ms** để phân khúc RFM đổi sau khi tạo đơn (yêu cầu "vài giây") | `npm run check:an3` |
| **100%** khách mẫu có đủ tương tác + ticket trong hồ sơ 360 | `npm run check:an2` |

## Nói thẳng trước khi bị hỏi

Sáu giới hạn nằm ở [`QA.md`](./QA.md) §D — đọc trước buổi trình bày. Tóm tắt: dữ liệu
huấn luyện là bán lẻ quốc tế chứ không phải Việt Nam; chưa đo được hiệu quả win-back;
voucher 10% là hằng số; chưa benchmark mô hình khác; ảnh chụp màn hình chưa có.
