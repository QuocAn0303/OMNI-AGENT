# STATE — tiến độ AISC26 (Space Bunny)

Cập nhật sau mỗi việc xong để phiên sau không mất ngữ cảnh.

## Nhánh và hash

| Nhánh | Commit gần nhất | Nội dung |
|---|---|---|
| `round2/p0-hardening` (đang làm) | xem `git log --oneline -3` | P0-1/P0-2/P0-3, hotfix tenant, công cụ dữ liệu, dọn rác |
| `hotfix/tenant-nested-write` | `8eb320f`, `959ab30` | ghi lồng extension Prisma + fail-fast + 3004 test; SQL thô `ai_documents` |

**Chưa đẩy remote. Không bao giờ đẩy `main`.**

## Tiến độ theo bảng mục 6 của Mốc 10 (Phần 2)

| # | Việc | Trạng thái |
|---|---|---|
| 1 | Ký xong nhóm D + dọn dữ liệu local | **XONG** |
| 2 | 1.3 — 36 dòng `company_settings` của CANDORY | chưa |
| 3 | `ai_documents` không ghi đè của tenant khác | chưa |
| 4 | `corrections.md` + sửa tài liệu | **MỘT NỬA** (đã tạo `corrections.md`; chưa rà/sửa tài liệu khác) |
| 5 | Dọn rác theo tiền tố, runbook, gói review | chưa (đã có `verifyTeardown`) |
| 6 | D6 (`MISSING_COST`, hiệu năng `checkAutoReorder`, test `COST_DRIFT`) | chưa |
| 7 | Commit tài liệu + Swagger + đẩy nhánh (D7) | chưa |
| 8 | Sửa giao thức S1–S12 | chưa — **trước mọi backtest** |
| 9 | Chọn dataset + sha256 → `02-data.md` | chưa |
| 10–18 | Pha 5, Pha 6, backtest, frontend, `LlmUsageLog`, LLM, người thử, demo, pitch | chưa |

## Kết quả #1 (dọn dữ liệu local, Mốc 10)

Dump trước khi ghi: `C:\Users\lengu\AppData\Local\Temp\opencode\erp-backups\aduu-dev-before-residue-cleanup-20261002-202352.dump` (0,57 MB, ngoài repo).

Dry-run **14/14 khớp**, phép trừ `297 − (86 + 84) = 127` đúng. `--apply` trong
một transaction. Snapshot 2 tenant thật trước/sau: **GIỐNG HỆT**.

Đã xoá: 84 `order_items` + 86 `orders` + 9 `admin_campaign_recipients` + 1 chiến
dịch "E2E Free User Promo" + 9 user + 38 `company_settings` NULL + 40
`warehouses` + 3 `products` + 3 `categories` + 81 `audit_logs` (mồ côi) + 3 user +
4 `categories` + 5 `vendors` + 7 tenant `DBG`.

### Trạng thái DB local sau khi dọn

- **Tenant còn lại: đúng 2** — `CANDORY SCENT`, `Á đù`.
- `CANDORY SCENT`: 82 đơn, 158 dòng hàng, **89.862.000 VND — không đổi**.
- `MỒ CÔI-TENANT`: **0**.
- `users` NULL: **1** (`super_omega_ultra_admin@gmail.com` — CỐ Ý, cố tình).
- `company_settings`: 36 dòng, NULL = 0, **TRÙNG 1-1 = 1** (CANDORY) — chờ #2.
- `audit_logs` NULL: **124**, **không còn user nào sở hữu** ⇒ "không rõ chủ" ⇒
  **không xoá, liệt kê** (theo Mốc 9). Vì vậy `check:tenant` **FAIL** — đây là
  trạng thái đúng, không phải hồi quy.
- Vẫn còn **134/139 bảng scoped không có khoá ngoại tới `tenants`** (backlog).

## Các con số đã ký (đừng tự đổi)

`docs/aisc26/one-off/cleanup-dev-residue.js` → `EXPECTED`, nguồn
`quyet-dinh-moc-10` (2026-10-02): nhóm A `9/86/84/9`; nhóm B `7/3/3/4/5`;
nhóm C `38`; nhóm D `40/81/3/3`; tổng mồ côi `297`; tổng nhóm D `127`.
`--apply` chỉ chạy khi `COUNT` chạy lại khớp đúng; lệch là hủy toàn bộ.

## Kiểm chứng gần nhất

| Lệnh | Kết quả | Loại |
|---|---|---|
| `npx jest` | 3992/3997 pass (67 suites) | mock |
| `npm run smoke:po-gate` | 18/18, teardown tự chứng minh sạch | **DB thật** |
| `npm run check:tenant-isolation` | 11/11 | **DB thật** |
| `npm run check:tenant-gaps` | 4/4 | **DB thật** |
| `npm run check:tenant:null` | **FAIL** (124 `audit_logs` không rõ chủ + 1 TRÙNG 1-1) | **DB thật** |
| `npm run check-tenant-aidocs` | 9/9 | **DB thật** |
| `npm run check:modules` | 203 module | — |
| `npm run check:humangate` | 11/11 (cần backend + DB, chạy lần trước) | **HTTP thật** |

## Dựng lại môi trường

```bash
# Postgres local phải chạy; .env trỏ DATABASE_URL localhost
npm install
npx prisma migrate deploy     # KHÔNG dùng db:migrate
npm run db:seed               # TRUNCATE — chỉ khi DB trống
npm test
npm run check:modules
npm run check:tenant          # gồm cả check-tenant-null (đang FAIL có chủ đích)
npm run smoke:po-gate
```

## Ghi chú cho phiên sau

- Luôn **dừng mọi tiến trình nền** trước khi chạy script ghi dữ liệu
  (`Get-Process node | Stop-Process -Force`) — Mốc 10 yêu cầu.
- PowerShell hay hỏng file tiếng Việt khi dùng `-replace`/`Set-Content`.
  Dùng thẻ `edit`/`write` cho file nhiều dấu.
- Khi dùng ~70% ngữ cảnh: dừng việc mới, cập nhật file này, commit, báo hash.
