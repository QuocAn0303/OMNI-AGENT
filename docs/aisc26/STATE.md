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

---

## Cap nhat 2026-10-03 (phien P4 — T9 XONG)

**RESUME HERE — gói tiếp theo: P5 (T10 backtest). LƯU Ý: đang có phiên khác chạy
P5 song song trong cùng thư mục — đọc `git log`/`git status` trước khi làm lại.**

P2 (T5,T6) va P3 (T7,T8) da merge vao nhanh (`4a9fac0`, `977a40b`) truoc khi phien
nay bat dau. P4 lam 3 viec cua T9, tat ca **DONE-VERIFIED tren DB that**.

### 1. Script nap `scripts/dataset/import-erp-demo.js` (DONE-VERIFIED)

- `assertLocalDb`, **dry-run la mac dinh**, `--apply` moi ghi, `--reset` xoa dung
  thu tu phu thuoc trong MOT transaction.
- Ghi trong `runWithTenant`; san pham/ton upsert theo **id tat dinh**; don co
  `orderCode = Order ID` cua tep xuat (`@unique`) => chay lai khong nhan ban.
  Do la bang chung: lan 2 bao **0 don moi / 1.025 bo qua**.
- Tenant demo `omni-demo-mo-phong` (ten co chu MO PHONG): 500 san pham, 1 kho,
  1 NCC, 2.500 giao dich ton dau ky. DB hien co **2.452 don / 4.874 dong** (nhieu
  hon vi cac phien khac cung nap vao cung tenant).
- Ba gia dinh A1/A2/A3 (minStock p90, ton = 3 x p50, GBP khong quy doi) ghi o
  `02-data.md` §9.2. Khong do duoc tu dataset — phai noi ra.

### 2. Tep xuat don mo phong `gen-marketplace-orders.js` (DONE-VERIFIED)

5.573 don / 11.085 dong, seed co dinh => chay lai ra **CUNG sha256**
(`bb8e2069...`). Dinh dang **GIA DINH** (Shopee khong cong khai dac ta) — nguon +
URL + ngay o `notes/marketplace-format.md`. Co `.truth.csv` va `MANIFEST.json`
(manifest ghi ro "cong Grand Total se dem thua").

### 3. Khop SKU khong LLM `src/modules/import/sku-matcher.js` (DONE-VERIFIED)

trigram Dice + Levenshtein chuan hoa + cosine TF-IDF. Nguong ten hang so:
`AUTO_ACCEPT 0.86` · `REVIEW 0.62` · `MIN_SCORE_MARGIN 0.05`. Unit test 15/15.
`data/dataset/sku-review-queue.csv` la **hang doi "can nguoi xac nhan"**; don nao
con dong chua du tin cay thi **KHONG nap** (D-010).

### Kiem chung P4 (2026-10-03)

| Lenh | Ket qua | Loai |
|---|---|---|
| `npm run smoke:import-demo` | **9/9** | **DB that** |
| `npm run data:import -- --apply --days 7` (x2) | 1.025 don / 0 don moi lan 2 | **DB that** |
| `npm run tenant:null -- --scan` | MO COI-TENANT **0** · TRUNG 0 | **DB that** |
| `npx jest` | **4058/4063** pass (71 suite, 5 skip) | mock |
| `npx jest tests/sku-matcher.test.js` | 15/15 | mock |

Smoke 9 kiem chat, trong do: 0 don ngoai tep xuat, 0 dong hang troi san pham tenant
khac (chung minh nested write giu cach ly), tap SKU 500 = 500, **444 SKU duoi
`minStock`** (tien de cho P6), `candory-scent` giu nguyen 82 don / 158 dong /
89.862.000 VND.

### Phat hien dang chu y (P4)

1. **Buoc do sai hon thuật toan.** Do chinh xac `AUTO_ACCEPT` do ra **50,32%** o
   lan chay dau — do la loi cua **phong do**: dap an lay theo "SKU dau tien cua
   don" thay vi SKU cua **dung dong hang**. Sua bang cach ghep `.truth.csv` theo
   **chi so dong** => 100,00%. Bai nay da ghi vao smoke nen khong quay lai.
2. `upsert` mac dinh KHONG du lam idempotent: `user.email`, `warehouse.code`,
   `vendor.code` UNIQUE **toan cuc**. Phai dat **id tat dinh** cho moi ban ghi cha.
3. `for` + `continue` lam lech so dem (`skippedOrders` 142575 cho 1025 don) — phai
   dung `while` co buoc tuong minh.

### Ranh gioi giua cac phien (PHAI TON TRONG khi lam tiep)

Co **phien khac dang chay P5** trong cung thu muc (3 tien trinh node; sua
`scripts/backtest/*`, `docs/aisc26/notes/backtest-runs.*`, tao
`03-evaluation-results.md`). Phien nay **khong** chay `--reset` tenant demo de
khong pha du lieu cua ho. Khi nghiên cứu `03-evaluation-results.md` phai đọc
trước khi sua. Thay đổi cua phien khac **KHONG** commit.

### Tiep theo

1. **P5 (T10)** — `scripts/backtest/` **đã có sẵn** do phien kia lam; phien sau
   **KHONG viet lai**, chi chay + bo sung theo giao thuc S1–S12 da commit
   (`1f1a402`) va ghi `03-evaluation-results.md` kem CI + 3 kich ban lead time.
2. **P6 (T11, T12)** — tien de da co: tenant demo da nap 500 SKU + 2.452 don +
   **444 SKU duoi `minStock`**.
3. **P7 (T13, T14)** — `LlmUsageLog` va duong khop SKU lai (fuzzy xu ly ca de,
   LLM chi ca mo ho, nguoi xac nhan ca do tin cay thap).

---

## Cap nhat 2026-10-03 (phien P5b — THI NGHIEM 2, post-hoc)

**RESUME HERE — gói tiếp theo van la P6 (T11 demo end-to-end + T12 giao dien duyet).
P5b xong, khong con viec nao cua T10.**

### Da lam (dung 1 lan chay giao thuc)

1. **`69a7ba2`** — them `§13.2` vao `03-evaluation-protocol.md`: dang ky **truoc**
   thí nghiệm 2 (post-hoc, kham pha). Ham muc tieu co **rang buoc fillRate(mid) >= 95%**,
   chon `z`/`DOC` **nho nhat** dat rang buoc, quy tac du phong khi khong kha thi; P1 mo
   luoi `DOC ∈ {7,14,21,28}` (diem lech duy nhat so voi §2.2); so sanh **gia tri ton
   trung binh o cung muc dich vu** (khop ±2 diem pham tram theo SKU) + bootstrap S7;
   luat ket luan: khong noi "ROP tot hon" tru khi CI loai 0 **va** ty le thang > 55%.
2. **`60a2d84`** — ma thí nghiệm 2: `scripts/backtest/run-exp2.js` (tach rieng, **khong
   bao gio ghi de** `03-evaluation-results.md`), `constrainedGrid` + `pickConstrained`
   (policies), `avgAtp/avgValue` (simulate), `matchedServiceBootstrap` (metrics),
   script npm `backtest:exp2`. Cac thay doi la **bo sung**, khong doi hanh vi T10.
3. **Kiem chung truoc khi chay**: chay lai thí nghiệm 1 bang `--log=false` → **moi so
   tong/mua ban/ton du giong het** (849.998 / 769.199 / 781.436 / 617.035).
4. **Mot lan chay duy nhat**: `BT2-20261003065054` (mã `60a2d84`, giao thức `69a7ba2`),
   ghi so S11 (`backtest-runs.md` + `.jsonl`) va bang sinh tu dong vao
   `03-evaluation-results-exp2.md`. Ket qua thí nghiệm 1 **khong sua mot so nao**.

### Ket qua thí nghiệm 2 (nhan post-hoc, khong thay ket luan thí nghiệm 1)

- **Rang buoc 95% KHONG kha thi** voi ca 4 phuong an, o ca 3 cua so / ca 2 nhanh / ca
  3 lead time. Cao nhat `fillRate(mid) = 88,66%`. Quy tac du phong da chot: moi phuong
  an chon muc dich vu cao nhat trong luoi (P1 `DOC=28`, P2/P3 `z=0,95`, P4 `DOC=28`).
- **O cung muc dich vu, ROP troi it von hon** P1: chenh −954,63/ngày trên tap SKU khop
  (n = **132/500**), CI 95% [−1.209,95; −752,92] **loai 0**, **99,24%** SKU thang. Giu
  dung o nhanh B (−981,81) va o LT = 14. P3 (Croston) **khong** vuot P2.
- **Khong noi "ROP tot hon"**: ket luan chi dung trong pham vi thí nghiem 2, **co nhan
  post-hoc**, va cau hoi "o 95% thi sao" **van chua duoc tra loi** (can luoi rong hon,
  phai tien dang ky moi — xem §5.7 cua bao cao).
- Phat hien dang ghi them: frontier cho thay **nguong co dinh khong phai phuong an tiet
  kiem von** — P1 tu `DOC=14` (77,34%) len `DOC=28` (85,42%) phai nhan ton gap **2,4 lan**.

### Dinh chinh + backlog da ghi (trong `§13.2.5`)

1. Protocol §1 trich `automation.service.js:49,209` **da loi thoi** (dòng 49 =
   `AUTO_REORDER_DEDUPE_WINDOW_MS`, dòng 209 trong `debtAutoCollection`; P0-4 da thay
   bang ROP qua `planReplenishment`) ⇒ "hien trang" trong ma **da la ROP**; P1 la nguong
   co dinh **khong con ton tai trong ma san pham**.
2. Backlog: `crostonDemandPerDay` (`replenishment.calc.js:256`) **nhan `alpha` nhung khong
   dung** (tu suy `a = 1/(k+1)` o dong 260). Ca hai thí nghiem deu khong dung ham nay cho
   P3. **Sua o goi sau kem test** — khong sua trong T10.

### Kiem chung P5b (2026-10-03)

| Lenh | Ket qua | Loai |
|---|---|---|
| `npm run backtest:exp2` | `BT2-20261003065054` | du lieu cong khai, **khong DB** |
| `node scripts/backtest/run.js --slice=test --log=false` | moi so **giong het** thí nghiem 1 | idem |
| `npx jest tests/backtest-simulate.test.js` | 20/20 | mock |
| `npx jest` | **4058/4063 pass** (71 suite, 5 skip) | mock |

Khong cham DB, khong cham backend, khong dung cong 4000. Commit: `69a7ba2`, `60a2d84`,
+ commit ket qua (xem `git log --oneline -3`).

### Con lai cho nguoi quyet (BLOCKED-HUMAN)

1. Duyet **CC BY 4.0** cho muc dich trinh bay.
2. Co chay **thí nghiem 3 tien dang ky** voi luoi rong hon (`z` toi 0,99, `DOC` toi 42)
   de tra loi cau hoi "o >= 95% thi ROP so voi nguong co dinh the nao" hay khong.
