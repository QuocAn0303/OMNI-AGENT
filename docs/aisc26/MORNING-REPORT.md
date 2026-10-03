# BÁO CÁO SÁNG — phiên tự hành qua đêm

Phạm vi số liệu: **DB phát triển cục bộ, 2 tenant thật** (`CANDORY SCENT`,
`Á đù`). **Môi trường thật/staging chưa từng được quét.**

---

## 1. Tóm tắt trung thực

| Trạng thái | Số việc | Việc cụ thể |
|---|---|---|
| **DONE-VERIFIED** | **7** | T0, T1a, T1b, T2, T4 (một phần), D-003 (dọn rác), test `settings.service` |
| **DONE-UNVERIFIED** | 1 | Swagger chưa sửa (chưa tới) |
| **BLOCKED-HUMAN** | 2 | chạy `live` LLM (thiếu key), triển khai hotfix lên môi trường thật |
| **SKIPPED (hết giờ)** | 10 | T3, T5–T12, T16–T18 |

**Kết quả đáng chú ý nhất đêm nay:** `check:tenant` chuyển từ **FAIL** sang
**PASS toàn bộ**, và phát hiện được một lỗi mã **xảy ra được ở môi trường thật**
(không phải chỉ ở test).

### Ba việc đội phải làm đầu tiên

1. **Đọc `AI-HANDOVER.md`** — bản tóm tắt để AI/người khác tiếp tục.
2. **Đọc `review-hotfix-tenant.md`** khi có, rồi triển khai hotfix `ai_documents`
   + cách ly tenant lên môi trường thật theo `runbook-tenant-null.md`.
3. **Đặt `GEMINI_API_KEY`** rồi chạy `npm run check:llm` để mở đường cho phần LLM.

---

## 2. Việc con người bắt buộc (BLOCKED-HUMAN)

| # | Việc | Bước cụ thể | Thời gian |
|---|---|---|---|
| H1 | **Đặt key Gemini** | đặt vào `.env` → `npm run check:llm` | 5 phút |
| H2 | **Triển khai hotfix lên môi trường thật** | sao lưu DB → dựng staging từ bản sao DB thật → **thử khởi động** (fail-fast metadata có thể chặn) → triển khai hotfix → `node scripts/tenant-null.js --scan --allow-remote` → `--backfill` (dry-run) → `--apply` trong khung bảo trì → `--scan` lại → `npm run check:tenant` | 2–3 giờ |
| H3 | **Tuyển và chạy 6 người thử** | `usertest/` chưa tạo (T15 chưa tới) — chưa thể chạy | — |
| H4 | **Gán nhãn khớp SKU** | chưa có phiếu CSV (T14 chưa tới) | — |
| H5 | **Chọn & tải dataset** | T6 chưa tới; `check` internet chưa làm | — |

**Cảnh báo H2:** hotfix có **fail-fast lúc khởi động**. Nếu metadata môi trường
thật lệch so với local, backend **sẽ không khởi động**. Bắt buộc thử trên staging
trước. **Không có công tắc tắt** — đó là chủ ý.

---

## 3. Rủi ro lớn nhất còn lại (xếp hạng)

1. **Chưa có dữ liệu thật.** Mọi đánh giá hiệu tại là công khai/tổng hợp/mô phỏng.
   Dataset công khai không có tồn kho/lead time/kênh ⇒ **không được tuyên bố hiệu
   quả "đa kênh"**.
2. **Chưa sửa giao thức S1–S12.** Chạy backtest trước khi sửa là tự phá giá trị
   của phép đo.
3. **134/139 bảng scoped chưa có khoá ngoại tới `tenants`.** Xoá tenant âm thầm
   làm mồ côi dữ liệu con — đã gây ra 297 dòng mồ côi trên DB local.
4. **Script kiểm thử vẫn có thể rò dữ liệu.** Đêm nay phát hiện thêm 2 tenant
   (`ISO A`/`ISO B`) do `check-tenant-isolation.js` rò. Đã có lệnh dọn theo tiền
   tố, nhưng **các script sinh tenant chưa được sửa để tự dọn sạch**.
5. **A′ không nguyên tử** — để lại trạng thái lơ lửng; cần nói thẳng khi vấn đáp.

---

## 4. Điều quan trọng cần biết trước khi lên trình bày

- Lỗi cách ly tenant **có thật ở mã**: ghi lồng sinh `tenantId = NULL`, bằng
  chứng 84/242 dòng `order_items` trên DB phát triển, mà unit test mock không thấy.
  **Nhưng toàn bộ dữ liệu bị ảnh hưởng là dữ liệu kiểm thử**; tenant thật duy
  nhất **không bị mất dữ liệu** (82 đơn / 158 dòng / 89.862.000 VND, không đổi
  qua mọi lần dọn). **Môi trường thật chưa quét** nên không khẳng định gì về nó.
- Ngưỡng drift (`QTY_DRIFT_TOL` 25%, `COST_DRIFT_TOL` 10%) là **mặc định chưa
  hiệu chỉnh**, không có căn cứ thực nghiệm.
- **Chưa có kết quả backtest nào.** Không được nói "hiệu quả tăng X%" khi chưa
  chạy.

---

## 5. Phụ lục

### 5.1 Bảng trạng thái T0–T18

| # | Việc | Trạng thái | Commit / bằng chứng |
|---|---|---|---|
| T0 | Khởi động, baseline | **DONE-VERIFIED** | sổ dưới |
| T1a | 124 `audit_logs` NULL | **DONE-VERIFIED** | `3e4ba86` |
| T1b | 36 dòng `company_settings` + đọc xác định + mặc định 5tr | **DONE-VERIFIED** | `e701ad1` |
| T2 | `ai_documents` không ghi đè tenant khác | **DONE-VERIFIED** | `c7b5fe0` |
| T3 | D6 (`MISSING_COST`, hiệu năng `checkAutoReorder`, test `COST_DRIFT`) | **SKIPPED** (hết giờ) | — |
| T4 | Runbook, gói review, Swagger, D7 | **DONE-UNVERIFIED một phần**: `DECISIONS.md` + `cleanup-test-residue.js` đã có; runbook/review/Swagger/D7 **chưa** | `3e4ba86` |
| T5–T12 | Giao thức S1–S12, dataset, Pha 5, Pha 6, nạp dữ liệu, backtest, demo flow, frontend | **SKIPPED** (hết giờ) | — |
| T13–T15 | `LlmUsageLog`, LLM, bộ người thử | **SKIPPED** | — |
| T16–T18 | Kịch bản demo, pitch, QA | **SKIPPED** | — |

### 5.2 Sổ kiểm chứng

| Lệnh | Kết quả | DB thật / mock |
|---|---|---|
| `npx jest` | **4003 pass / 4008** (68 suites, 5 pending) | mock |
| `npm run smoke:po-gate` | **18/18**, teardown tự chứng minh sạch | **DB thật** |
| `npm run check:tenant-isolation` | 11/11 | **DB thật** |
| `npm run check:tenant-gaps` | 4/4 | **DB thật** |
| `npm run check:tenant:null` | **4/4 PASS** (trước đêm: FAIL) | **DB thật** |
| `npm run check-tenant-aidocs` | **12/12** (trước đêm: 9/9) | **DB thật** |
| `npm run check:modules` | 203 module, không export undefined | — |
| `npm run check:humangate` | chưa chạy đêm nay (cần backend) | **HTTP thật** |
| `npm run cleanup-test-residue` | 0 tenant rác sau dọn | **DB thật** |
| Migration chờ trước `db:migrate:deploy` | **không có** (chưa tạo migration nào đêm nay) | — |

### 5.3 Phát hiện quan trọng đêm nay

1. **Lỗi mã thật: `settings.service.getOrCreate()` là race read-then-write.**
   Bảng `company_settings` thiết kế 1-1 nhưng **không có UNIQUE(tenantId)**;
   hai request song song cùng thấy "chưa có" rồi cùng tạo. Vì
   `findFirst()` không `orderBy` mà `poApprovalThreshold` quyết định PO có cần
   duyệt tài chính lần hai, **hành vi nghiệp vụ phụ thuộc thứ tự vật lý của heap**.
   Đây là lỗi có thể xảy ra trên môi trường thật, không chỉ trong test.
2. **124 `audit_logs` NULL không phải "user đã xoá".** Khôi phục dump ra DB tạm
   `aduu_dev_snapshot` và tra `userId`: **cả 124 dòng đều có `userId = NULL`** —
   là nhật ký hệ thống không có chủ, không phải log của user bị xoá. Không có
   nguồn để suy `tenantId` ⇒ không có gì để xoá.
3. **`check-tenant-isolation.js` rò tenant** (`ISO A`/`ISO B`) — làm sai tiền đề
   "còn đúng 2 tenant". Đã dọn và đã có lệnh dọn theo tiền tố.
4. **Chốt chặn snapshot chặn oan một lần**: lần `--apply` đầu cho `company_settings`
   rollback vì bảng đó nằm trong snapshot dù đó chính là bảng được phép sửa. Đã
   sửa để loại bảng chủ định sửa khỏi so sánh và báo delta riêng.

### 5.4 Dữ liệu: trước → sau

| Chỉ số (DB local) | Trước đêm | Sau đêm |
|---|---|---|
| Số tenant | 4 (2 rác) | **2** |
| Dòng `tenantId` mồ côi | 0 | **0** |
| `company_settings` của CANDORY | 36 dòng | **1 dòng** |
| `check:tenant` | FAIL | **PASS** |
| CANDORY SCENT: đơn / dòng hàng / tiền | 82 / 158 / 89.862.000 | **không đổi** |

### 5.5 Sao lưu (ngoài repo)

`C:\Users\lengu\AppData\Local\Temp\opencode\erp-backups\`
- `aduu-dev-before-residue-cleanup-20261002-202352.dump`
- `aduu-dev-before-prefix-cleanup-20261002-231049.dump`
- `aduu-dev-before-settings-dedup-20261002-231730.dump`
- `company_settings-backup-CANDORY-2026-10-02161658.json` (35 dòng bị xoá)

### 5.6 Quyết định tự động

Xem `DECISIONS.md`: D-001 (phân loại `audit_logs`), D-002 (ngoại lệ có điều kiện
+ trần thay vì danh sách bảng), D-003 (lệnh dọn rác theo tiền tố), D-004 (không
sửa logic test để làm xanh), D-006 (`poApprovalThreshold` NULL/≤0 → mặc định
5.000.000), D-007 (`getOrCreate` đọc xác định **và** tự hội tụ về một dòng).

### 5.7 Nhánh và tài liệu

Nhánh `round2/p0-hardening` (`hotfix/tenant-nested-write` giữ nguyên).
**Chưa đẩy remote** — D7 đã chạy nhưng **không đẩy**: điều kiện "deploy chỉ chạy
từ `main`" **không xác minh được** trong repo, quét secret thì sạch. Đã tạo
`git bundle` ngoài repo thay thế (xem D-009).

Tài liệu: `docs/aisc26/` — `AI-HANDOVER.md` (**đọc file này trước**),
`STATE.md`, `DECISIONS.md`, `MORNING-REPORT.md`, `corrections.md`,
`runbook-tenant-null.md`, `review-hotfix-tenant.md`, `review-p0-3.md`,
`00-scope.md`, `00b-gate-design.md`, `01-llm-role.md`,
`03-evaluation-protocol.md`, `one-off/`.

---

## Phụ lục P1 — phiên tự hành 2026-10-03 (bậc 0, hoàn tất)

### P1.1 — Teardown dùng chung + bắt rò thật

| Việc | Kết quả |
|---|---|
| `scripts/lib/teardown.js` | `captureBaseline` (chụp mồ côi-tenant theo bảng TRƯỚC khi seed) + `verifyTeardown` (2 điều kiện: còn dòng của tenant thử / bảng nào tăng mồ côi) + `runWithTeardown` |
| Áp dụng cho | `smoke-po-gate`, `check-tenant-isolation`, `check-tenant-gaps`, `check-tenant-aidocs`, `smoke-crm-phase4-{campaign,hierarchy,send}` (+ `assertLocalDb` cho 3 script CRM trước đây **không có**) |
| **Phát hiện đáng chú ý** | `verifyTeardown` bắt được **rò thật chưa ai biết**: `smoke-crm-phase4-hierarchy` rò **6** dòng `audit_logs`, `smoke-crm-phase4-send` rò **2** dòng, **mỗi lần chạy**. Nguyên nhân: `audit_logs` không có FK tới `tenants` nên xoá tenant không kéo log. Đã sửa gốc (xoá `auditLog` trước tenant). Xác nhận rò có **trước P1** bằng `git stash` chạy lại bản HEAD (vẫn rò 6 dòng). |
| Dọn 22 dòng rác do chính 2 lần chạy đó để lại | `docs/aisc26/one-off/cleanup-orphan-auditlogs.js` — dry-run mặc định, `COUNT` chạy lại ngay trước khi ghi (lệch ⇒ hủy toàn bộ), một transaction. Dump trước: `aduu-dev-before-orphan-auditlog-cleanup-20261003-085447.dump` |
| Tiêu chí "2 lần liên tiếp, 0 rác tăng thêm" | **ĐẠT** — chạy 2× mỗi script, `TỔNG MỒ CÔI-TENANT = 0` sau mỗi vòng |
| Snapshot 2 tenant thật | **GIỐNG HẸT** — `CANDORY SCENT` 82 đơn / 158 dòng / 89.862.000 VND / 201 audit log |
| Commit | `af96079` |

### P1.2 — Truy nguồn 124 `audit_logs` NULL

Lệnh: `SELECT action, entity, count(*) FROM audit_logs WHERE "tenantId" IS NULL GROUP BY 1,2`
→ **đúng 4 nhóm**, tất cả `userId = NULL`:

| action | entity | n | Kết luận |
|---|---|---|---|
| `CREATE_ADMIN_CAMPAIGN` | AdminCampaign | 36 | **Bản nền tảng** — `AdminCampaign` không có `tenantId`; KHÔNG thể gán, đúng thiết kế |
| `SEND_ADMIN_CAMPAIGN` | AdminCampaign | 36 | Như trên |
| `REGISTER` | Tenant | 26 | **Lỗi mã** — đăng ký chạy ngoài tenant context dù tenant vừa tạo |
| `VERIFY_EMAIL` | User | 26 | **Lỗi mã** — verify bằng token, không có context |

Đã sửa `audit.service.log` nhận `tenantId` tường minh + 2 call site truyền tường
minh (có test 5/5). Ngoại lệ chuyển từ "trần số lượng" sang **"điều kiện theo
`action`"**, cap vẫn 124 làm lưới an toàn. Commit `3b0fba6`.

### P1.3 — T3 / D6 (giá vốn + hiệu năng auto-reorder)

- `classifyUnitCost()` phân biệt **thiếu** với **bằng 0** ở mọi chuyển đổi số
  (`null`/`""`/`NaN`/**≤ 0**). Cờ `missingCost` đi từ `plan` → gate payload →
  executor.
- `evaluateProposalFreshness` có thêm trạng thái `MISSING_COST`; `executeGate` trả
  **409 `MISSING_COST`** (`acknowledgeDrift` **không** mở đường này — thiếu dữ liệu
  thì không có gì để so).
- Đường thoát khỏi trạng thái lơ lửng: nếu đề xuất sinh lúc **chưa có giá vốn** và
  người dùng đã bổ sung, PO dùng **giá mới** (`costSubstituted`, có ghi audit).
- `checkAutoReorder`: `AUTO_REORDER_DELAY_MS` + `AUTO_REORDER_DEDUPE_WINDOW_MS`
  (debounce theo cặp tenant+SKU, hằng số có tên) — có test chứng minh **không**
  chặn tenant khác.
- **Sửa hiểu biết quan trọng (đo được):** `products.costPrice` là `NOT NULL`
  (kiểm bằng `information_schema.columns`), nên trạng thái "thiếu" thật sự gặp
  được là **0**, không phải NULL. Smoke dùng 0.
- Test `COST_DRIFT`: có ca **vừa vượt** (11% > 10% ⇒ `DRIFT_BLOCK`) và **vừa dưới**
  (9% ⇒ `DRIFT_WARN`) — chứng minh ngưỡng là so sánh tương đối.
- Smoke `MISSING_COST` thêm vào `smoke:po-gate`: **24/24** trên DB thật (kịch bản 11).
- Commit `7a5df5d`.

### P1.4 — T4 phần còn lại

- Sửa **4 khối `@swagger` YAML không hợp lệ** (ghi trong T4 là 1, thực tế 4:
  `analytics.routes.js`, `crm/dashboard`, `crm/deals`, `crm/hierarchy`) — nguyên nhân
  giống nhau: `description` không nháy quanh chứa `[]`, `+`, `{ }`. Thêm
  `npm run check:swagger` chặn hồi quy (trước: **4/115 hỏng**, sau: **0/115**).
  Xác nhận `/api-docs` phục vụ được: `GET /api-docs/swagger-ui-init.js` → HTTP 200,
  185 KB, **có** `/api/analytics/customer-insights` và `/api/crm/hierarchy`.
  Commit `1cd1956`.
- Viết `review-hotfix-tenant.md` và `review-p0-3.md`.
- **D7:** quét secret **sạch**; điều kiện "deploy chỉ chạy từ `main`" **không xác
  minh được** ⇒ **không đẩy**, tạo `git bundle` (11,04 MB, 2 nhánh) ngoài repo.
  Chi tiết ở D-009.

### Sổ kiểm chứng P1

| Lệnh | Kết quả | Loại |
|---|---|---|
| `npx jest` | 4023 pass / 4028 (5 skip), 69 suite | mock |
| `npm run check:modules` | 203 module, không export `undefined` | tĩnh |
| `npm run check:swagger` | 115/115 khối YAML hợp lệ | tĩnh |
| `npm run smoke:po-gate` | **24/24** (11 kịch bản, có MISSING_COST) | **DB thật** |
| `npm run check:tenant` | 11/11 + 4/4 + 4/4 PASS | **DB thật** |
| `npm run check-tenant-aidocs` | 12/12 | **DB thật** |
| `node scripts/tenant-null.js --scan` | MỒ CÔI **0**; TRÙNG 1-1 **0**; NULL 125 (124+1 ngoại lệ) | **DB thật** |
| `smoke-crm-phase4-{hierarchy,send,campaign}` ×2 | residue **0** sau mỗi vòng | **DB thật** |
| `GET /api-docs/swagger-ui-init.js` | HTTP 200, 185 KB | **HTTP thật** |

### Lỗi có sẵn KHÔNG do P1 (phát hiện lúc xác minh, chưa sửa — ngoài phạm vi gói)

`smoke-crm-phase4-hierarchy` **35 pass / 1 fail** ở khẳng định cache cây quản lý
("boss KHÔNG còn bậc dưới → null"). Đã xác nhận lỗi này có **ở HEAD** (chạy bản
không có bản vá của P1 vẫn đỏ) ⇒ **không** phải do P1 gây ra. Để nguyên, ghi
BLOCKED cho gói sau vì sửa nó là sửa logic cache ngoài phạm vi P1.

---

## Phu luc P4 - phien tu hanh 2026-10-03 (T9: nap du lieu + khop SKU khong-LLM)

### 5.2p So kiem chung (chi them, khong sua dong cu)

| Lenh | Ket qua | Loai | Thoi diem |
|---|---|---|---|
| `npm run dataset:names` | 500 dong, sha256 `df175a83...`, 0 SKU fallback | may tinh | 2026-10-03 |
| `npm run dataset:marketplace` | 5.573 don / 11.085 dong; chay lai ra CUNG sha256 `bb8e2069...` | may tinh | 2026-10-03 |
| `npm run data:import` (dry-run mac dinh) | 1.075 don / 2.134 dong; 50 don giu lai cho nguoi xac nhan | may tinh + doc | 2026-10-03 |
| `npm run data:import -- --apply --days 7` | 1.025 don / 2.020 dong / 958 khach ghi | **DB that** | 2026-10-03 |
| `npm run data:import -- --apply --days 7` (LAN 2) | 0 don moi, 1.025 bo qua => IDEMPOTENT | **DB that** | 2026-10-03 |
| `npm run tenant:null -- --scan` | MO COI-TENANT **0**, TRUNG 0 (125 NULL la ngoai le da ky) | **DB that** | 2026-10-03 |
| `npm run smoke:import-demo` | **9/9** | **DB that** | 2026-10-03 |
| `npx jest tests/sku-matcher.test.js` | 15/15 | mock | 2026-10-03 |

### 5.3p Phat hien dang chu y (P4)

1. **Do chinh xac phai la 100%, va do la 50,32% o lan do o - do la loi cua phong do,
   khong phai cua bo khop.** Nguyen do: so dap an theo "SKU dau tien cua don" thay
   vi SKU cua **dung dong hang** (mot don co nhieu dong, moi dong mot SKU khac nhau).
   Bai "do" (K5/K9) gio doi danh dap an theo **chi so dong** vi `.truth.csv` duoc
   sinh cung thu tu voi tep xuat.
2. **Idempotent khong duoc sua bang upsert mac dinh.** `user.email`,
   `warehouse.code`, `vendor.code` la UNIQUE **toan cuc**; chi upsert san pham
   van vo lop 2. Da dung **id tat dinh** cho moi ban ghi cha.
3. **Don con dong hang chua du tin cay van duoc ghi vao DB** (loi that cua
   `import-erp-demo.js`): bao cao "1.025/1.075" nhung thao tac ghi lay ca 1.075.
   Da chuyen sang `planToWrite` va kiem lai bang smoke K4/K5.
4. **Co phien khac chay cung DB local** (3 tien trinh node, tep P5 dang sua). DB
   hien co 2.452 don tren tenant demo (nhieu hon 1.025 cua phien nay) do cac phien
   khac chay import voi cua so khac - K4 xac nhan **khong co don nao ngoai tep xuat**,
   nen khong phai du lieu hong. **Phien nay KHONG chay `--reset`** cho khi cac
   phien khac dung tenant demo.
5. Doc 45 MB xlsx bang ExcelJS can `--max-old-space-size=8192`; mac dinh se OOM
   (da gap mot lan). Da danh vao `npm run dataset:names`.

### 5.6p Quyet dinh tu dong (P4)

D-010 don chua du tin cay thi khong nap vao hang doi xac nhan · D-011 `minStock` /
ton dau ky la gia dinh mo phong A1 · D-012 tach `sku_names.csv` thay vi sua
`build-daily-sku.js` (chi tiet trong `DECISIONS.md`).

### Vi?c con nguoi lam

| Vi?c | Vì sao | Buoc |
|---|---|---|
| **Xac nhan 50 don trong `sku-review-queue.csv`** | Khong tu quyet theo D-010 | mo file, sua `product_name`/`input_sku`, chay lai `npm run data:import -- --apply` |
| Tai mot tep xuat that cua Shopee | De khop xac minh dinh dang gia dinh | bo vao `data/dataset/marketplace/`, doi dinh dang, ghi lai nguon + ngay |
| Chon nguon >=18 thang **co gia von that** | Con ngai cho chi so gia von | xem BLOCKER-HUMAN cua `02-data.md` 7 |

---

## Phụ lục P7 — phiên tự hành 2026-10-03 (T13 + T14)

### Sổ kiểm chứng P7 (chỉ thêm, không sửa dòng cũ)

| Lệnh | Kết quả | Loại | Thời điểm |
|---|---|---|---|
| `npx prisma migrate status` (trước khi thêm) | 29 migration, **không có migration chờ**, schema đã khớp | đọc | 2026-10-03 |
| `npm run db:migrate:deploy` | `20261003190000_llm_usage_log` áp dụng thành công, Prisma Client sinh lại | **DB thật** | 2026-10-03 |
| `npm run check:tenant` | 11/11 + 4/4 + **4/4 PASS** | **DB thật** | 2026-10-03 |
| `npm run tenant:null -- --scan` | MỒ CÔI **0** · TRÙNG **0** · NULL 125 (ngoại lệ đã ký) | **DB thật** | 2026-10-03 |
| `npm run smoke:demo-flow` (LLM **tắt**) | **12/12** (10 cũ + 2 khẳng định T14), 2 lần liên tiếp 0 rác | **DB thật** | 2026-10-03 |
| `npm run smoke:llm-usage` (chế độ `replay`, **không cần key**) | **9/9** | **DB thật** | 2026-10-03 |
| `npm run llm:eval -- --simulated` | harness chạy trọn; P=R=F1=0,6154/0,80/0,6957 ở nhãn **MÔ PHỎNG**; `token/cặp = CHƯA ĐO` | máy tính + đọc DB | 2026-10-03 |
| `npm run llm:eval` (nhãn tay) | **BLOCKER-HUMAN** — in hướng dẫn, không ra số (đúng S10) | — | 2026-10-03 |
| `npx jest` | **4092/4097 pass** (73 suite, 5 skip) | mock | 2026-10-03 |
| `npm run check:modules` | 203 module load được | — | 2026-10-03 |

### Phát hiện đáng chú ý (P7)

1. **Rò dữ liệu trong luồng demo của chính P6 (đo được, đã sửa).** `smoke:demo-flow`
   FAIL vì `journal_posting_errors` **+1 mỗi lần chạy**: `order.service.create` gọi
   autopost, thất bại thì ghi dòng để retry chứ không ném lỗi, mà `cleanup()` của P6
   không xoá bảng này. Sau khi bổ sung: 2 lần liên tiếp đều **0 bảng thay đổi**.
2. **`replay` vốn không chạy được khi không có key** — `callTask` kiểm tra
   `isConfigured()` trước khi xét mode. Đường lui biến thành đường chết. Đã sửa
   (D-018); test chốt hồi quy.
3. **Khoá bản ghi phụ thuộc `model`** làm mất toàn bộ bản ghi khi đổi `LLM_MODEL`
   (D-017). Bắt bởi smoke, không bắt bởi đọc code.
4. **Trần trí của việc thu hẹp ứng viên:** ứng viên cho LLM là **top-K theo điểm
   fuzzy**, nên khi đáp án không nằm trong top-5 thì LLM **không thể** đúng, dù
   LLM có giỏi đến đâu. Ở lần chạy mô phỏng có cặp đúng nằm ngoài top-5. Đây là
   giới hạn kiến trúc đã biết, phải nói thẳng khi trình bày: LLM được phép phá
   thế, không được vượt thế.
5. **CSV đọc bằng `split(',')` cắt cụt tên hàng** (D-019) — cùng loại lỗi P4.

### BLOCKER-HUMAN của P7

| # | Việc | Bước | Lệnh | Thời gian |
|---|---|---|---|---|
| 1 | **Gán nhãn khớp SKU** (2 người, 120 cặp) | Đọc hướng dẫn, mỗi người điền cột của mình, đối chiếu, người thứ 3 phân xử | `npm run llm:labels` → `npm run llm:eval` | ~2 giờ (2 người) |
| 2 | **Chạy đo LLM thật** | Đặt key, xem hạn mức thật trong AI Studio, rồi chạy `live` | xem `notes/gemini-free-tier.md` §5 | ~30 phút |
| 3 | **`check:humangate`** (còn tồn tọt từ P6) | Khởi động backend rồi chạy | `npm run check:humangate` | ~10 phút |
