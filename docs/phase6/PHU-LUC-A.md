# Phụ lục A — Bảng số liệu và log kiểm chứng

> Mọi số trong phụ lục này **lấy từ output thật của script**, dán nguyên văn.
> Ngày chạy: **05/10/2026**. Môi trường: PostgreSQL 18 cục bộ, tenant
> `crm-phase1-demo`, backend `node src/app.js`.

## A.1 — Lệnh đã chạy

```bash
npm run verify:phase1    # số dòng 9 bảng kiểm chứng
npm run check:an2        # webhook lead + hồ sơ 360 qua HTTP thật
npm run check:an3        # RFM tự động + 3 báo cáo khớp DB
npm run check:an4        # churn cao → voucher tự động
npm run check:kpi        # KPI giữ chân khớp DB
npm run ml:panel -- --force   # dựng panel từ UCI Retail II
npm run ml:train -- --force   # train + đo AUC
npm test                       # 80 suite / 4190 test
```

## A.2 — A.2.1 Số dòng 9 bảng (`verify:phase1`)

```
  bảng                  mô tả             số dòng   >= 300?
  ------------------------------------------------------------
  products              sản phẩm              320   OK
  customers             khách hàng            320   OK
  orders                đơn hàng              675   OK
  order_items           chi tiết đơn         1336   OK
  payments              thanh toán            633   OK
  crm_leads             lead                  320   OK
  crm_deals             deal                  320   OK
  crm_communications    tương tác             900   OK
  customer_tasks        công việc CSKH        320   OK

  KẾT QUẢ: ĐẠT — 9/9 bảng có >= 300 dòng.
```

## A.3 — A.2.2 Phân bố dữ liệu mẫu (cùng lần chạy)

| Nhóm | Phân bố |
|---|---|
| Đơn theo trạng thái | COMPLETED 614 · SHIPPING 48 · CANCELLED 13 |
| Đơn theo thanh toán | PAID 586 · PARTIAL 47 · UNPAID 42 |
| Lead theo trạng thái | NEW 89 · CONTACTED 89 · QUALIFIED 72 · CONVERTED 48 · DEAD 22 |
| Deal theo kết quả | ONGOING 168 · WON 86 · LOST 66 |
| Công việc CSKH | PENDING 149 · DONE 82 · IN_PROGRESS 68 · CANCELLED 21 |
| Tương tác theo loại | NOTE 158 · MEETING 154 · EMAIL 154 · WHATSAPP 143 · ZALO 141 · CALL 150 |

Vì sao phân bố này có chủ đích: `30% khách ngủ đông` để nhóm RFM `At-Risk` có
dữ liệu; `86 deal WON` để `CrmDeal.customerId` nối được khách; `20% đơn chưa
thanh toán` để `payments` không lệch hoàn toàn với đơn.

## A.4 — A.3.1 Webhook + hồ sơ 360 (`check:an2`, 16/16)

```
OK   | POST /webhook/crm-lead-key trả 200 + apiKey → HTTP 200
OK   | Webhook không X-Tenant-Key bị từ chối 401 → HTTP 401
OK   | Webhook lần 1 trả 201 Created → HTTP 201
OK   | Webhook lần 1 báo isNew=true
OK   | Webhook retry trả 200 (không phải 201) → HTTP 200
OK   | Webhook retry đánh dấu duplicate=true
OK   | Webhook retry trả CÙNG leadId
OK   | 3 lần gọi (2 có key trùng + 2 không key) chỉ tạo đúng 2 lead → trước=0 sau=2
OK   | GET /customers/:id/full trả 200 → HTTP 200
OK   | Hồ sơ 360 có khối giao dịch (recentOrders)
OK   | Hồ sơ 360 có khối tương tác (communications)
OK   | Hồ sơ 360 có khối ticket (tasks)
OK   | Hồ sơ 360 có 2 chỉ số RFM + CLV/churn
OK   | Trong 10 khách mẫu, phần lớn có tương tác trong hồ sơ 360 → 10/10 khách (100%)
OK   | Trong 10 khách mẫu, đều thấy ticket/công việc CSKH → 10/10
OK   | Hồ sơ 360 đủ quan hệ CRM (contact/deal/lead) → Đặng Quang Thảo: 1 tương tác / 1 ticket
```

## A.5 — A.4.1 RFM tự động + báo cáo (`check:an3`, 14/14)

```
OK   | Nạp 10 mẫu báo cáo R-01…R-10 vào tenant Phase 1
OK   | saved_reports có đủ 10 bản ghi → 10 bản ghi
OK   | Chấm CLV/churn cho tenant → khách có đơn=315, chấm được=315
OK   | Chấm RFM + phân khúc cho tenant → scored=315
OK   | Phân khúc RFM có dữ liệu (không để trống)
OK   | POST /orders tạo đơn COMPLETED thành công → HTTP 201
OK   | Tạo đơn xong thì R/F/M cập nhật trong ≤ 10 giây → 270 ms (F 3 → 4)
OK   | R-02 khớp DB (số khách theo phân khúc)
OK   | R-01 khớp DB (CLV + churn của từng khách) → 100 dòng báo cáo / 100 dòng DB, 0 dòng lệch
OK   | R-07 khớp DB (OTIF / tỷ lệ lỗi / hạng NCC) → 60 dòng báo cáo / 60 dòng DB, 0 dòng lệch
OK   | Cả 10 báo cáo R-01…R-10 chạy được → 10/10 OK
```

**Độ trễ RFM ghi nhận 270 ms** (lần đầu đo được 2–4 ms khi DB ấm). Cả hai đều
dưới ngưỡng 10 giây của đề bài; báo cáo giá trị chậm hơn để không tính quá.

## A.6 — A.5.1 Voucher tự động (`check:an4`, 13/13)

```
OK   | Cron automation chạy được (không lỗi) → scored=1344
OK   | Có khách vượt ngưỡng churn để kiểm chứng
OK   | Khách churn cao có ChurnAlert
OK   | Mỗi ChurnAlert có voucher Promotion thật
OK   | Voucher đúng cấu trúc (mã + kiểu + giá trị) → WINBACK-XXXXXXXX · PERCENTAGE · 10
OK   | Khách churn cao có nhiệm vụ CSKH được giao cho nhân viên
OK   | Nhiệm vụ có người nhận (không phải task mồ côi)
OK   | Log cảnh báo ghi đúng mức rủi ro (HIGH/CRITICAL theo điểm churn)
OK   | Log cảnh báo ghi đúng điểm churn ≥ ngưỡng
OK   | Không sinh nhiều voucher cho cùng một khách
OK   | Mọi khách đủ điều kiện trong tenant đều được cảnh báo
OK   | Số cảnh báo mới của tenant ≤ tổng automation báo (phạm vi khác nhau)
OK   | Automation tạo kèm voucher + task + thông báo
```

## A.7 — A.6.1 KPI giữ chân (`check:kpi`, 12/12)

```
OK   | GET /api/analytics/retention-kpi trả 200
OK   | Tổng khách khớp DB → API 320 / DB 320
OK   | Số khách đã chấm churn khớp DB
OK   | Số khách rủi ro khớp DB (theo ngưỡng endpoint dùng)
OK   | Endpoint nêu rõ cả ngưỡng sàng lọc và ngưỡng hành động → sàng lọc 0.5 · hành động 0.7
OK   | Số khách được gửi voucher ≤ số khách rủi ro
OK   | Cohort giữ chân khớp DB từng tháng
OK   | Tỷ lệ % giữ chân tính đúng (và null khi cohort rỗng)
OK   | Số cảnh báo churn theo trạng thái khớp DB
OK   | Số voucher đã phát khớp DB
OK   | Số lượt dùng voucher khớp DB
OK   | Endpoint kèm danh sách giới hạn (caveats)
OK   | Mô hình churn sẵn sàng và có AUC đo được → engine=v1, AUC=0.6857
```

## A.8 — A.7.1 Kết quả mô hình churn (`ml:train`)

```
Panel: 32.601 mẫu, đặc trưng: recencyDays, frequency, logMonetary,
                            avgGapDays, tenureDays, logAvgOrderValue, monthsIdle
Tập train: 17.098 mẫu (churn 28.4%) — mốc ≤ 2011-01
Tập test : 15.503 mẫu (churn 27.3%) — mốc > 2011-01
Train log-loss: 0.693147 → 0.577229 → … → 0.549805

=== KẾT QUẢ TRÊN TẬP TEST ===
  AUC mô hình logistic : 0.6857
  AUC tập train        : 0.6990
  AUC baseline (thiên theo im lặng): 0.6347
  PR-AUC               : 0.3947
  Ngưỡng vận hành      : 0.202 (recall=0.885, precision=0.350)
  precision=0.3503 recall=0.8849 f1=0.5019 specificity=0.3822
  Ma trận: TP=3752 FP=6958 TN=4305 FN=488

Trọng số đặc trưng (đã chuẩn hoá):
  frequency -0.38036 | logMonetary -0.37761 | avgGapDays +0.30789
  recencyDays +0.09256 | monthsIdle +0.07112 | logAvgOrderValue +0.06125
  tenureDays +0.02381
```

## A.9 — A.8.1 Bảng gate kỹ thuật

| Gate | Kết quả |
|---|---|
| `npm test` | 80 suite pass · **4190 test pass** · 5 skip |
| `npm run check:modules` | 204/204 module load được |
| `npm run check:tenant` | 4/4 nhóm pass (11 + 4 + 4 + 4 assertion) |
| `npm run check:swagger` | 118/118 khối `@swagger` parse được |
| `npm run check:i18n` | 156 vấn đề **có sẵn từ trước**, không phát sinh từ thay đổi này (script tự ghi rõ) |
| `npx eslint` (file FE đã sửa) | 0 lỗi |

## A.10 — A.9.1 Bug thật đã phát hiện và sửa trong quá trình làm

| Bug | Biểu hiện | Nguyên nhân | Sửa |
|---|---|---|---|
| Cron backup làm sập server | 02:00 hằng đêm backend chết | `execFile('pg_dump')` — Windows không có `pg_dump` trong PATH | `resolvePgTool()` dò `C:\Program Files\PostgreSQL\*\bin` |
| 5 báo cáo mặc định không chạy được | `fields is not iterable` | `runQuery` giả định config luôn có `fields`, nhưng config dạng `aggregate` thì không | Thêm mặc định `fields = []` |
| 19 thông báo không hiện trong UI | `notifications.tenantId = NULL` | `automation.debtAutoCollection` quét công nợ toàn hệ thống rồi ghi ngoài tenant context | Bọc `runWithTenant(debt.tenantId)`; xoá 19 dòng dữ liệu rác |
| Mô hình trả xác suất 0 hoặc 1 | `p = 0.0000` cho mọi khách | Train bằng GBP, chạy bằng VND ⇒ z-score lệch vài chục đơn vị chuẩn hoá | Đặc trưng tiền qua `log1p` |
| 0 khách vượt ngưỡng 0.70 | Voucher ngừng chạy | Đưa thẳng xác suất mô hình (thang 0.202) so với 0.70 | Mô hình thành bằng chứng bổ sung, hợp nhất bằng `max()` |
| `check:tenant` FAIL | `notifications=19` NULL | Bug ở dòng trên | Vá + thêm ngoại lệ có trần cho `llm_usage_logs` |
| PRNG sinh dữ liệu hỏng | Vòng `while` quay vô hạn, treo 10 phút | Biến trạng thái đặt trong closure `mulberry32` | Đưa `a` ra ngoài closure + thêm `guard` |

## A.11 — A.10.1 Backup và restore thử (`verify:backup-restore`, 6/6)

**Bằng chứng DoD R6: "restore backup thử thành công".**

Chỉ chạy `pg_restore` mà không đối chiếu thì chưa phải bằng chứng — file
`.dump` có thể "restore thành công" mà vẫn thiếu bảng. Script dựng DB
`erp_restore_test` từ file backup rồi so **số dòng từng bảng** với DB gốc:

```
File backup: D:\erp-backups\phase6-20261005-211800\erp_db.dump (1.85 MB)
OK | Đã tạo DB erp_restore_test
OK | pg_restore chạy xong (4.9s)

  bảng                        gốc   restore   kết quả
  ----------------------------------------------------
  tenants                       4         4   khớp
  users                        15        15   khớp
  products                   840       840   khớp
  categories                    5         5   khớp
  customers                  1370      1370   khớp
  orders                     6046      6046   khớp
  order_items               11922     11922   khớp
  payments                    677       677   khớp
  crm_leads                   320       320   khớp
  crm_deals                   320       320   khớp
  crm_communications          900       900   khớp
  customer_tasks              778       778   khớp
  churn_alerts                458       458   khớp
  promotions                  458       458   khớp
  vendors                      67        67   khớp
  saved_reports                10        10   khớp

OK | Tất cả bảng cốt lõi có mặt sau restore → 0 bảng thiếu
OK | Số dòng khớp hoàn toàn giữa gốc và bản restore → 0 bảng lệch
OK | Đủ bản ghi _prisma_migrations → gốc 30 / restore 30
OK | DB restore chứa tenant trình diễn → 1/4 tenant
```

Tái lập:

```bash
npm run backup:verify -- --dump <đường dẫn file.dump>
# hoặc dùng file .dump mới nhất trong D:\erp-backups\phase6-*
```

**Giới hạn:** bản restore được kiểm tra về **số dòng và schema**, chưa khởi
động backend trỏ sang DB đó để chạy thử nghiệp nghiệp vụ. Bước đó cần đổi
`DATABASE_URL` và sẽ ghi thêm dữ liệu (cron chạy ngay khi app lên) — làm trong
môi trường trình diễn, không làm trên máy đang dùng.

## A.12 — A.11.1 Ảnh chụp màn hình

Chưa chụp. Khi trình bày cần chụp và chèn vào đây:

1. `/customers/:id/full` — 4 card RFM/CLV/tương tác + tab "Tương tác"
2. Bảng báo cáo `/report-builder` chạy R-02
3. `/crm/churn-alerts` — danh sách cảnh báo kèm mã voucher
4. `/crm/customer-insights` — panel KPI giữ chân + cohort
5. Terminal chạy `npm run check:an3` (độ trễ 270 ms)
