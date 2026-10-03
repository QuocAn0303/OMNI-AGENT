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


---

## Cap nhat dem 2026-10-02 (phien tu hanh qua dem)

**RESUME HERE — viec tiep theo: T3 (D6).**

Da xong T0, T1a, T1b, T2. Commit moi: 3e4ba86, e701ad1, c7b5fe0.
- check:tenant PASS toan bo (truoc do FAIL).
- Phat hien loi MA THAT: settings.service.getOrCreate() la race read-then-write,
  company_settings thieu UNIQUE(tenantId) => hanh vi nguong duyet PO khong xac dinh.
  Da sua bang orderBy + hoi tu ve mot dong.
- 124 audit_logs NULL: ca 124 deu co userId = NULL (log he thong khong chu), khong co
  gi de xoa; khai bao ngoai le co dieu kien + tran 124.
- ai_documents: da cam ghi de tai lieu cua tenant khac.

**Tiep theo theo thu tu: T3 (D6) -> T4 (runbook + review + Swagger + D7) -> T5
(giao thuc S1-S12) -> T6 (dataset) -> T7 (Pha 5) -> T8 (Pha 6) -> T9 (nap
du lieu) -> T10 (backtest) -> T11 (smoke demo flow) -> T12 (frontend) -> T13..T18.**

Chi tiet va bang chung: docs/aisc26/MORNING-REPORT.md, DECISIONS.md,
AI-HANDOVER.md.

Ket qua hien tai: jest 4003/4008 | smoke:po-gate 18/18 | check:tenant PASS |
check-tenant-aidocs 12/12 | check:modules 203 | 0 tenant rac | 0 dong mo coi |
company_settings CANDORY = 1 dong | CANDORY 82 don / 158 dong / 89.862.000 VND (khong doi)

---

## Cap nhat 2026-10-03 (phien P1 — BUC 0 HOAN TAT)

**RESUME HERE — viec tiep theo: GÓI P2 (T5 giao thuc S1-S12, roi T6 dataset).**

Da xong P1 (4/4 muc). Commit moi theo thu tu: `af96079`, `3b0fba6`, `7a5df5d`,
`1cd1956`. **Khong con viec nao cua BUC 0.**

### 1. P1.1 — teardown dung chung (DONE-VERIFIED, DB that)

`scripts/lib/teardown.js`: `captureBaseline` + `verifyTeardown` + `runWithTeardown`.
Da ap dung cho 7 script (`smoke-po-gate`, `check-tenant-isolation`,
`check-tenant-gaps`, `check-tenant-aidocs`, `smoke-crm-phase4-{campaign,hierarchy,
send}`; 3 script CRM trước day KHONG co `assertLocalDb` — da them).

**Bat duoc rac THAT chua ai biet:** `smoke-crm-phase4-hierarchy` ro 6 dong
`audit_logs`, `smoke-crm-phase4-send` ro 2 dong, **moi lan chay**. Nguyen nhan:
`audit_logs` khong co FK toi `tenants` => xoa tenant khong keo log. Da sua goc.
**Bang chung rac co TRUOC P1:** `git stash` chay lai ban HEAD van ro 6 dong.
Dong 22 dong rac do 2 lan chay do de lai bang
`docs/aisc26/one-off/cleanup-orphan-auditlogs.js` (dry-run mac dinh, COUNT chay lai
truoc khi ghi, 1 transaction). Dump truoc:
`aduu-dev-before-orphan-auditlog-cleanup-20261003-085447.dump` (0,55 MB, ngoai repo).

Tieu chi "2 lan lien tiep, 0 rac tang them": **DAT**.

### 2. P1.2 — truy nguon 124 `audit_logs` NULL (DONE-VERIFIED, DB that)

Dung 4 nhom `action`, tat ca `userId = NULL`:
`CREATE_ADMIN_CAMPAIGN|AdminCampaign` 36 + `SEND_ADMIN_CAMPAIGN|AdminCampaign` 36
= **72 dong ban nen tang** (khong co `tenantId` — dung thiet ke);
`REGISTER|Tenant` 26 + `VERIFY_EMAIL|User` 26 = **52 dong LOI MA** (chay ngoai
tenant context du tenant da biet) — da sua `audit.service.log` + 2 call site.
Ngoai le doi sang **dieu kien theo `action`**, cap van 124. Chi tiet: D-008.

### 3. P1.3 — T3 / D6 (DONE-VERIFIED, DB that)

`classifyUnitCost` (thieu vs bang 0) -> co `missingCost` -> gate payload ->
`executeGate` tra **409 `MISSING_COST`**; `acknowledgeDrift` KHONG mo duong nay.
Duong thoat khoi trang thai lo lung: neu de xuat sinh luc chua co gia von va nguoi
dung da bo sung, PO dung **gia moi** (`costSubstituted`, co audit).
`checkAutoReorder` co `AUTO_REORDER_DELAY_MS` + debounce `(tenant, SKU)`.
Smoke `MISSING_COST` = kich ban 11.

**HIEU BIET SAI DA SUA (do duoc):** `products.costPrice` la `NOT NULL` — trang
thai "thieu" that su gap duoc la **0**, khong phai NULL.

### 4. P1.4 — T4 con lai (DONE-VERIFIED / PARTIAL-HUMAN)

- Swagger: sua **4** khoi `@swagger` YAML hong (T4 ghi 1, thuc te 4 file). Them
  `npm run check:swagger`: **4/115 hong -> 0/115**. `/api-docs` xac nhan phuc vu
  duoc: `GET /api-docs/swagger-ui-init.js` HTTP 200, 185 KB, co ca 2 path vua sua.
- Viet `review-hotfix-tenant.md` + `review-p0-3.md`.
- **D7: KHONG day remote** (dieu kien "deploy chi chay tu main" khong xac minh duoc;
  quet secret SACH). Da tao `git bundle` 11,04 MB o
  `C:\Users\lengu\AppData\Local\Temp\opencode\erp-bundles\aduu-round2-20261003-093557.bundle`
  chua 2 nhanh. Chi tiet: D-009.

### Kiểm chứng P1 (2026-10-03)

| Lệnh | Kết quả | Loại |
|---|---|---|
| `npx jest` | 4023/4028 pass (69 suite, 5 skip) | mock |
| `npm run smoke:po-gate` | **24/24** | **DB thật** |
| `npm run check:tenant` | 11/11 + 4/4 + 4/4 | **DB thật** |
| `npm run check-tenant-aidocs` | 12/12 | **DB thật** |
| `npm run check:modules` | 203 module | — |
| `npm run check:swagger` | 115/115 | tĩnh |
| `tenant-null.js --scan` | MỒ CÔI 0 · TRÙNG 0 · NULL 125 (ngoại lệ) | **DB thật** |

### Lỗi có sẵn, KHÔNG do P1 (BLOCKED, để nguyên)

`smoke-crm-phase4-hierarchy` 35 pass / **1 fail**: khẳng định cache cây quản lý.
Đã xác nhận đỏ **ở HEAD** ⇒ không phải do P1. Sửa nó là sửa logic cache, ngoài
phạm vi P1.

### Tiep theo — GÓI P2

> **LƯU Ý (quan trọng, quan sát lúc 09:40):** trong lúc P1 chạy, một phiên khác
> trong **cùng worktree** đã commit `1f1a402` — "sửa giao thức backtest theo S1–S12
> TRƯỚC lần chạy đầu". Nội dung `03-evaluation-protocol.md` hiện có §13 "Lịch sử
> sửa đổi trước lần chạy đầu" và §14 "Trạng thái". Có worktree riêng cho
> `round2/p2-data` (`D:/aduu-p2`) và `round2/p3-research` (`D:/aduu-p3`) — nhiều
> phiên đang chạy song song. **Phiên sau phải `git log` kiểm tra lại trước khi làm
> lại T5.**

1. **T5** — commit `1f1a402` **đã có** trong lịch sử nhánh. P2 chỉ cần **xác nhận
   lại** nó đủ S1–S12 và có "Lịch sử sửa đổi trước lần chạy đầu"; không viết lại.
2. **T6** — chọn dataset (tối đa 8 lần fetch; ghi `notes/dataset-candidates.md`),
   script tải + sha256, viết `02-data.md`. Không tải được thì dùng bộ sinh tổng
   hợp có seed, ghi nhãn **TỔNG HỢP** + `BLOCKER-HUMAN`.
3. Bundle D-009 **đã cũ**: dùng `aduu-round2-final-20261003-093927.bundle`
   (đầu `f887d44`).
