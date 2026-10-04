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

---

## Cap nhat 2026-10-03 (phien P6 - T11 + T12 XONG)

**RESUME HERE - goi tiep theo: P7 (T13 LlmUsageLog, T14 hai vai tro LLM).**

Da xong ca T11 va T12. Commit moi theo thu tu: `bc0d17f` (T11 + import A4/A5 +
D-015), `e0e4d8a` (T12 frontend + contract test) - xem `git log --oneline -3`.

### 1. T11 - Luong demo end-to-end (DONE-VERIFIED, DB that) - 10/10

`scripts/demo/demo-flow.js` la **THU VIEN DUNG CHUNG**: ca `npm run smoke:demo-flow`
(khang dinh) va `npm run demo:run` (trinh dien khong can giao dien) deu goi
`runDemoFlow()` - mot duong ma duy nhat, gi nua "ban nghiem thu" va "ban trinh
dien" khong the lech nhau.

7 buoc, tat ca la **duong ma san pham that** (unit test + contract test cam
`prisma.order.create` / `agentHumanGate.create` / `purchaseOrder.create` tay):
chon SKU (cong thuc) -> `orderService.create` (tru kho that) ->
`EVENT_HANDLERS.LOW_STOCK` (dung handler ma pg_notify goi) -> `revalidate` CHUA
duyet (bang chung `freshness`) -> `updateMany` PENDING->APPROVED + `executeGate` ->
"dung MOT PO" -> goi lai `suggest` de chung minh `onOrder` chan trung.

Smoke 10/10 tren DB that. D7 kiem **rac that**: `captureTenantCounts` doc tat ca
139 bang scoped truoc/sau moi lan chay; ca 2 lan lien tiep deu **0 bang thay doi**.

### 2. Phat hien lon nhat cua P6 (da sua, co bang chung)

**Nhanh "lead time do duoc" CHET AM THAM.** `calcLeadTime` doc `receipts[i].poDate`
nhung `loadLeadTimeReceipts` tra `{ date, receivedAt }` => `poDate` luon undefined
=> **MOI** don hang deu rut vao nhanh "chua du mau, dung mac dinh 7 ngay". Unit
test van xanh vi test chi truyen tay dung hinh dang `poDate`. Chi phat hien khi
chay luong tren DB that (truoc khi sua: 20/20 SKU `leadTimeEstimated = true`).
Sua o ham nap du lieu, KHONG doi ham toan. Chi tiet: D-015.

**Khong co du lieu thi khong co duong chay.** Tap xuat nam 2011 =>
`loadReplenishmentInput` doc 28 ngay theo `Date.now()` => **0 don 28 ngay** =>
khong SKU nao "can nhap" => luong demo khong the chay. Giai phap: neo ngay
(**A4**) + PO tien su + GRN POSTED de co NCC va lead time do duoc (**A5**).
Chi tiet: D-013, D-014.

### 3. Data demo da nap lai (chi tenant `omni-demo-mo-phong`)

`npm run data:import -- --reset --apply --days 34 --max-orders 6000`:
**5.282 don / 10.423 dong / 1.000 khach an danh / 500 SKU**, cua so ERP
2026-08-31 -> 2026-10-03 (A4), **3 PO tien su + 3 GRN POSTED** cho 20 SKU ton thap
(A5, lead time do duoc 7 ngay). `smoke:import-demo` **9/9**; `tenant-null --scan`
MO COI-TENANT 0 / TRUNG 0.

Dump truoc khi ghi (ngoai repo):
`aduu-dev-before-p6-demo-anchor-20261003-173757.dump` (0,99 MB).

**Tenant thuc khong doi:** `candory-scent` 82 don / 158 dong / 89.862.000 VND.

### 4. T12 - Giao dien duyet toi thieu (DONE-VERIFIED)

`SmartApprovalCard.jsx` **dung lai** + sua cho dung chu ky T12: bat buoc ly do khi
tu choi (modal, nut Disable khi rong), hien thi **tuoi de xuat** (vang > 6h),
**diff** khi DRIFT_BLOCK + checkbox `acknowledgeDrift` co chu dich, canh bao
DRIFT_WARN, hien thi `missingCost`, canh bao **trang thai lo lung** (APPROVED nhung
`resultRef` null) + nut thu lai, va **ma PO sau khi duyet**. Trang moi
`pages/AgentApprovals.jsx` + route `/agent-approvals` (ADMIN/MANAGER) + menu.

Sua them 1 thu can de xem duoc diff: `agent.gate.exec.js` nem loi 409 **khong co
`details`** => `error.middleware.js` chi chuyen `status` + `message` => UI **khong
bao gio thay `diff`**. Nay la gioi han cua ha tang ke thua, da nem them
`details: { code, drift, missingCost, diff }` (giu nguyen top-level de khong pha
unit test).

### 5. Ket qua kiem chung P6

| Lenh | Ket qua | Loai |
|---|---|---|
| `npm run smoke:demo-flow` | **10/10**, 2 lan lien tiep 0 rac | **DB that** |
| `npm run demo:run` | chay trọn, in 6 buoc + "bo qua co chu dich" | **DB that** |
| `npm run smoke:import-demo` | **9/9** | **DB that** |
| `npm run smoke:po-gate` | **24/24** | **DB that** |
| `npx jest` | **4071/4076 pass** (72 suite, 5 skip) | mock |
| `npx jest tests/demo-flow-contract` | 12/12 | mock |
| `frontend npm run lint` | **0 error** (61 warning co san) | — |
| `frontend npm run build` | **built in 762ms**, 218 entry PWA | — |
| `npm run check:modules` | 203 module | — |
| `npm run tenant:null -- --scan` | MO COI 0 / TRUNG 0 | **DB that** |
| `npm run check:humangate` | **FAIL - backend khong chay** | can backend |

### 6. Bi gioi han da biet (noi thang, khong giau)

1. **HTTP chua kiem chung o P6**: `check:humangate` can backend dang chay. Phan
   HTTP cua luong demo **chua** co bang chung o phien nay (T11 kiem `executeGate`
   truc tiep dung thu tu route). Phai chay `npm run check:humangate` khi backend
   chay truoc buoi trinh bay.
2. **Buoc 3 bo qua `pg_notify`/LISTEN** (can server nen) - gọi thang handler.
3. **`/api/agent/human-gates` chi tra PENDING** => trang thai "lo lung" **khong
   doc duoc tu API**; trang hien thi ro la chua co duong doc (can endpoint
   theo trang thai - de giai sau).
4. `order.service.create` goi `autoIssue` hoa don dien tu; local khong cau hinh
   VNPT nen log loi - **khong** chan luong.

### 7. Tiep theo - GÓI P7

> **DONG BANG TINH NANG SAU P6** (theo `NIGHT-PROMPT.md` muc 3): tu day chi sua
> loi, do luong, tai lieu. Khong them tinh nang moi.

- **T13** migration `LlmUsageLog` (duy nhat duoc phep), them vao
  `TENANT_SCOPED_MODELS`, ghi token tu `usageMetadata` o `config/llm.js`.
- **T14** khop SKU lai + giai thich de xuat/soan tin nhan NCC; **co mau giai thiep
  khong-LLM** lam duong lui va mac dinh khi LLM tat/429/503. Chi chay `live` neu
  **co** bien moi truong key (khong doc gia tri).
- P6 de lai 1 viec con: chay `check:humangate` khi backend chay (xem muc 6.1).

Dump/ghi chu ky thuc cua P6: `docs/aisc26/DECISIONS.md` D-013, D-014, D-015.

---

## Cap nhat 2026-10-03 (phien P7 - T13 + T14 XONG)

**RESUME HERE - gói tiếp theo: P8 (T15 bộ công cụ 6 người thử, T16 kịch bản demo,
T17 dàn ý + QA, T18 chốt + báo cáo sáng).**

Commit moi theo thu tu: `f4c6c13` (T13), `5806795` (T14 + sua loi P6). Xem
`git log --oneline -3`.

### 1. T13 - `LlmUsageLog` (DONE-VERIFIED, DB that)

Migration chờ **trước khi chạy**: `npx prisma migrate status` → 29 migration, **0
chờ**, schema khớp. Dung 1 migration **additive** duy nhat:
`20261003190000_llm_usage_log` (CREATE TABLE + 3 index, khong ALTER/DROP/backfill).
`prisma/schema.prisma` model `LlmUsageLog` (tenantId, task, provider, model, mode,
promptTokens, completionTokens, totalTokens, latencyMs, succeeded, createdAt).
Dang ky `TENANT_SCOPED_MODELS` ngay tai migration do (D-016: khong FK toi `tenants`,
giong `AgentHumanGate`; `tenantId` NULL van ghi duoc).

`src/config/llm.js`: doc `json.usageMetadata.{promptTokenCount,candidatesTokenCount,
totalTokenCount}` (truoc do **bo qua hoan toan**), giu `getLastUsage()`, ghi **1 dong
`LlmUsageLog` moi lan goi logic** ke ca that bai. Loi ghi chi `logger.error` - do la
**so do**, khong phai luong nghiep vu; vi vay moi chung minh ve bang nay la **smoke
tren DB that**, khong phai unit test.

### 2. T14 - Hai vai tro (DONE-VERIFIED code + DB that; **chua do LLM that**)

**Duong LLM duy nhat:** `src/config/llm-policy.js` (moi vai tro goi qua day,
khong ai `require` thang provider).

- **Mac dinh la KHONG-LLM.** `resolveMode()` tra `'off'` troi khi co key; `LLM_DISABLED=1`
  thang moi thu. Che do `live` / `record` / `replay`. `replay` **khong doi key**
  (D-018) va khong goi mang. `throttle` mac dinh 1200 ms, `backoff` nhan doi khi
  429/503, tran 30 s. `assertPublicDataOnly()` chan du lieu that o live/record.
- **Vai tro 1** `src/modules/import/sku-matcher.hybrid.js`: giu nguyen `sku-matcher.js`
  va nguong da ky. LLM **CHI** goi o ca mo ho `[0,62; 0,86)`. Ca de: khong goi LLM.
  Ca duoi nguong: **khong** goi LLM, vao hang doi kem ly do. JSON + Zod, `sku` phai
  nam trong ung vien (LLM bia ma => coi nhu khong khop). `confidence < 0,85` =>
  chuyen nguoi xac nhan.
- **Vai tro 2** `src/modules/replenishment/proposal-explain.llm.js`: LLM chi nhan
  **so da tinh san** (`buildPayload` la hop dong). `assertNumbersUnchanged()` quet moi
  con so trong output; so la => loai + dung mau (co test LLM nhan doi so luong).
  `vendorMessage` **chi soan**: `sent=false`, `requiresHumanSend=true`, khong import
  SMS/Zalo/email. Luon kem `source` + `notice` de khong gia von la LLM viet.
- **Noi vao luong demo:** `demo-flow.js` them buoc `explain-proposal` ⇒ bang chung
  "che do khong-LLM chay tron luong demo" la **do duoc**, khong phai khai bao.

### 3. Harness + bo nhan (san dung ngay)

- `npm run llm:eval` (S10): tach dev/test tinh dinh (seed `20261003`), P/R/F1 tai
  nguong **0,85**, `fallbackRate`, ms/cap, bootstrap F1(hybrid - fuzzy) 1000 lan,
  Cohen kappa, **bat buoc** doi chung baseline fuzzy tren cung bo nhan.
  **Khong co nhan tay ⇒ in `BLOCKER-HUMAN`, tu choi ra so.**
- `npm run llm:eval -- --simulated`: chay may, nhan **MO PHONG**, khong cong bo.
- `npm run llm:labels` ⇒ `data/aisc26/skus/labels/label-sheet.csv` (**120 cap**, cot
  `label_*` **DE TRONG**), `truth.simulated.csv` (chi doi chieu sau), huong dan
  `docs/aisc26/notes/sku-labeling-guide.md`.
- `npm run llm:policy`: in che do + **co/khong** co key (khong in gia tri).
- `npm run smoke:llm-usage`: replay tren **DB that**, 9/9, **khong can key**.

### 4. Phat hien cua P7 (de sua hoac de noi thang)

1. **Ro rac THAT cua chinh P6** da tim va sua: `cleanup()` demo-flow bo qua
   `journal_posting_errors` ⇒ moi lan chay luong **+1 dong**, smoke FAIL. Bay 2 lan
   lien tiep = 0 rac.
2. **`replay` vo hieu khi khong co key** (D-018) - duong lui bien thanh duong chet.
   Bat boi smoke, **khong** bat boi doc code.
3. **Khoa ban ghi phu thuoc `model`** lam mat toan bo ban ghi khi doi `LLM_MODEL`
   (D-017).
4. **Tran tri cua viec thu hep ung vien:** ung vien cho LLM la **top-K theo diem
   fuzzy**, nen khi dap an ngoai top-5 thi LLM **khong the** dung. Co ca nhu vay o
   bo MO PHONG. Phai noi thang khi trinh bay.
5. `CSV` doc bang `split(',')` cat cut ten hang (D-019) - tach `scripts/lib/csv.js`.

### 5. Kiem chung P7 (2026-10-03)

| Lenh | Ket qua | Loai |
|---|---|---|
| `npm run smoke:demo-flow` (LLM **tat**) | **12/12**, 2 lan lien tiep 0 rac | **DB that** |
| `npm run smoke:llm-usage` (replay) | **9/9**, khong can key | **DB that** |
| `npm run check:tenant` | 11/11 + 4/4 + 4/4 PASS | **DB that** |
| `npm run tenant:null -- --scan` | MO COI 0 / TRUNG 0 / NULL 125 (ngoai le) | **DB that** |
| `npx jest` | **4092/4097** pass (73 suite, 5 skip) | mock |
| `npm run check:modules` | 203 module | — |
| `npm run llm:eval` (khong nhan tay) | BLOCKER-HUMAN, tu choi ra so | — |
| `npm run llm:eval -- --simulated` | chay tron; token/cap = **CHUA DO** | may tinh + doc |
| `candory-scent` | 82 don / 158 dong / 89.862.000 VND — **khong doi** | **DB that** |

### 6. Han muc Gemini: **KHONG ghi con so** (D-020)

3 lan `fetch` toi `ai.google.dev` deu **transport error**. Da dung cong cu tim kiem
de doc trang chinh thuc: chi ghi **chieu do** (RPM/TPM/RPD, theo project, RPD reset
luc nua Pacific) + **dieu khoan du lieu**: Free tier **"Used to improve our products
= YES"** ⇒ chan gui du lieu that. Trang chinh thuc noi han muc phai xem trong AI
Studio ⇒ khong ghi so. Chi tiet + BLOCKER-HUMAN: `docs/aisc26/notes/gemini-free-tier.md`.

### 7. Con lai cho P8 (khong phai lam lai)

1. **T15** `docs/aisc26/usertest/` — chua co gi (moi co `usertest/` trong yeu cau P8).
2. **T16/T17** kich ban demo + dan y + QA — chua viet.
3. **T18** chay lai toan bo, quet secret, hoan tat `MORNING-REPORT.md`.
4. P6 de lai: `npm run check:humangate` (can backend dang chay).
5. **Khong duoc** cong bo so LLM khi chua chay `live`: hien ghi **"chua do"**.

---

## Cap nhat 2026-10-04 (phien P8 - T15, T16, T17, T18 XONG)

**RESUME HERE - Vong 2 DA KET THUC. Khong con viec nao cua agent. Viec tiep theo
thuoc ve NGUOI: doc trang dau `MORNING-REPORT.md` roi chay theo `FILL-IN.md`.**

Commit moi theo thu tu: `4194ce1` (endpoint by-status), `26096f3` (T15 bo cong cu nguoi
thu), `91e82de` (T16+T17), `45ddc4b` (FILL-IN.md) + commit bao cao (xem `git log -3`).
Nhanh van la `round2/p0-hardening`. **KHONG day remote.**

### 1. Tinh nang da dong bang - chi them MOT thay doi ma nho

`GET /api/agent/human-gates/by-status?status=&pendingResult=&limit=` trong
`src/modules/ai/agent.routes.js`. Chi doc, `authorize('ADMIN','MANAGER')`, whitelist
status (sai => 400), `take` kem 1..200, cach ly tenant boi Prisma extension
(`AgentHumanGate` co san trong `TENANT_SCOPED_MODELS`; route KHONG tu gan `tenantId` -
co test khang dinh). 10 test moi trong `tests/agent-humangate.route.test.js` =>
**24/24**; Swagger **116/116**. D-021. Ly do: `GET /human-gates` co tinh chi tra
`PENDING` nen trang thai lo lung (APPROVED + `resultRef` NULL) doc khong duoc tu API
(P6 muc 6.3 ton doc). **Khong them tinh nang khac.**

### 2. T15 - Bo cong cu 6 nguoi thu (DONE-UNVERIFIED: san xong, chua co ai thu)

`docs/aisc26/usertest/`: README, `task-script.md` (chu doc nguyen van), `moderator-guide.md`
(counterbalance AB/BA 3+3), `consent-form.md` (an danh), `timer-sheet.md`,
`decision-sheet.md`, `sku-sets.md` + `sku-sets.json`, `grading.md`, `results/*.template.csv`,
`sample/` (nhan **SAMPLE**). Script: `scripts/usertest/build-scenario.js` (chi doc),
`print-sheets.js`, `summarize-results.js`; npm `usertest:scenario`, `usertest:summarize`.

- **Hai bo SKU tuong duong**: 20/20, **trung ma SKU = 0**, Σ `orderQty` **5.243 vs 5.462**
  (lech 4%), nhu cau/ngay 16,01 vs 16,65, `orderQty` trai **19..491** o ca hai bo. Cach
  chia: loc dai tinh huong tap hoa nho (D-022) + lay mau **cach deu theo phan bo** roi
  chia xen ke. `sha256 sku-sets.json` ghi trong `sku-sets.md`.
- **Cham P4 bang `scripts/backtest/lib/simulate.js`** - CUNG bo mo phong voi backtest T10.
  Ba bien the: `MANUAL` (mot lan tai ngay 0) / `REF` (ra soat hang ngay, `max(0, ROP - vị the)`)
  / `NONE`. Bat loi da ghi: **REF duoc 14 lan ra soat, MANUAL mot lan** - la so "quy trinh"
  voi "mot quyet dinh", khong phai so hai thuat toan (D-023).
- **Quy tac bat buoc co trong script**: `n < 5` => in canh bao chi bao trung vi + khoang
  min-max; **khong** co duong tinh p-value; moi dong output co nhan pham vi.
- **Da chay thu bang du lieu mau**: `npm run usertest:summarize -- --make-sample` (3 nguoi
  gia, 6 dong task, 120 dong quyet dinh) roi `--sample` => chay tron, in nhan **SAMPLE** +
  canh bao `n = 3 < 5`. Bai SAMPLE **khong** duoc trich ra bao cao.
- Chay thu kich ban tren DB that: `usertest:scenario` doc 500 SKU, 231 ung vien du dieu kien.

### 3. T16/T17 - Trinh bay (DONE-UNVERIFIED: viet xong, chua dien tap tren may trinh bay)

`04-demo-script.md` (kich ban 5 phut theo phut-giay, ai noi gi, man hinh nao; checklist 30
phut; phuong an du phong A `demo:run` / B `check:humangate` / C ban in-snapshot /
D **che do khong-LLM la mac dinh**; kich ban 90 giay) · `07-pitch-outline.md` (10 slide,
co ghi chu noi, **co slide "KHONG lam gi o Vong 2"** va **slide han che da biet**, nhan
UCI **CC BY 4.0** tren slide du lieu) · `07-qa-prep.md` (**16 cau**).

**Quy tac noi dung da ap dung:** KHONG noi "ROP tot hon"; so thieu nghiem 1 duoc ke kem
(ban it hon **9,5%**, mat ban nhieu hon **31,5%**, fill **69,51% vs 76,81%**); chi noi
"o cung muc dich vu, ROP troi it von hon" (thi nghiem 2, **post-hoc**, rang buoc 95%
**khong kha thi**, toi da **88,66%**); KHONG noi "chinh xac hon KiotViet/Sapo"; luận điểm
khác biệt = **cong duyet bat buoc + sai so do duoc**; LLM / nguoi thu / phong van ghi
**"CHUA CO DU LIEU"**.

### 4. FILL-IN.md (moi)

Moi cho can nguoi dien sau, moi muc co **tệp · vị trí · nguồn số liệu · lệnh**: nhan SKU
tay (120 cap), LLM `live`, 6 nguoi thu, 5–10 phong van, gia PA/PB/PC, thieu khoa ngoai
`tenants`, duyet CC BY 4.0, thieu nghiem 3, mat khau DB trong repo, trien khai hotfix.

### 5. Phat hien lon nhat cua P8 (da sua, co bang chung)

**Rac cua mot lan chay bi do lam hong script khac.** 3 `purchase_orders` DRAFT
(`PO-20261003-0004/0005/0006`, note `[gate:...]`, gate APPROVED tuong ung, tao
10:58–11:02 UTC 2026-10-03) lam bo sinh ma PO dem trung => `smoke:po-gate` **FAIL 21/24**
voi `Unique constraint failed ("poCode")`. Da don bang
`docs/aisc26/one-off/cleanup-p8-demo-po-residue.js` (dump truoc, dry-run mac dinh,
`EXPECTED` co dinh, COUNT lai ngay truoc khi ghi, mot transaction) => **24/24** sau đó.
Dump: `aduu-dev-before-p8-po-residue-20261004-013531.dump` (1,3 MB, ngoai repo).

**Tu dau cam:** phiên này **tu gay** mot lan FAIL khi chay **song song** `smoke:po-gate`
va `smoke:demo-flow` (cung tao ma PO trong ngay) - dung la nguyên nhan goc cua 3 dong
rac kia. Bai hoc: chay script ghi du lieu **tuan tu**, va dung moi tien trinh nen truoc.

### 6. Kiem chung P8 (2026-10-04, chay TUAN TU)

| Lenh | Ket qua | Loai |
|---|---|---|
| `npx jest` | **4102/4107 pass** (73 suite, 5 skip) | mock |
| `npm run check:modules` | 203 module | — |
| `npm run check:swagger` | 116/116 | tinh |
| `npm run check:tenant` | 11/11 + 4/4 + 4/4 | **DB that** |
| `node scripts/check-tenant-aidocs.js` | 12/12 | **DB that** |
| `npm run tenant:null -- --scan` | MO COI **0** · TRUNG **0** · NULL 125 (ngoai le) | **DB that** |
| `npm run smoke:po-gate` | **24/24** (sau khi don rac) | **DB that** |
| `npm run smoke:demo-flow` | **12/12**, don lan 1 va 2 deu 0 bang thay doi | **DB that** |
| `npm run smoke:llm-usage` | 9/9 (replay) | **DB that** |
| `npm run check:humangate` | **TAT CA PASS** (backend that 4000, **da tat**) | **HTTP that** |
| `npm run demo:run` | 6 khoi, 0 bang thay doi, 3.089 ms | **DB that** |
| `npm run usertest:scenario` | 20/20 + 20/20, trung ma = 0 | **DB that** |
| `npm run usertest:summarize -- --sample` | chay tron, nhan SAMPLE, canh bao n<5 | may tinh |
| `npm run llm:eval -- --mode live` | **BLOCKER-HUMAN** (chua co nhan tay) | — |
| `frontend npm run lint` | **0 error** (61 warning co san) | — |
| `frontend npm run build` | built, 218 entry PWA | — |

### 7. Quet secret / du lieu that (sach, co bang chung)

0 tep `.env`/khoa duoc track (chi `.env.example`); 0 mau khoa that (`sk-`, `AIza`, khoi
PEM) trong noi dung track; 0 so CCCD; email chi la tai khoan seed da co san.
**Phat hien khong phai cua P8:** mat khau DB local `uit` nam trong `README.md:177` va
`docker-compose.yml:10` - da co tu truoc; dua vao `BLOCKED-HUMAN` H8 de nguoi quyet
(D-025), **khong** tu sua. Khong con tien trinh nen (`Get-Process node` = 0 sau khi tat
backend).

### 8. Tu cham muc 11 cua NIGHT-PROMPT (trung thuc)

| Muc | Trang thai | Bang chung |
|---|---|---|
| `check:tenant` PASS; hai tenant thu khong doi du lieu | **DONE-VERIFIED** | 11/11+4/4+4/4; `candory-scent` 82 don / 158 dong / 89.862.000 VND khong doi |
| Hotfix cach ly tenant san trien khai doc lap | **PARTIAL-HUMAN** | runbook + 2 goi review co; **D7 chua day remote** ( dieu kien deploy chua xac minh) |
| `smoke:po-gate` / `smoke:demo-flow` / `check:humangate` xanh; `demo:run` chay | **DONE-VERIFIED** | 24/24 · 12/12 · TAT CA PASS · 3.089 ms |
| Giao thuc backtest commit **truoc** lan chay dau; ket qua co CI, 3 lead time, nhan | **DONE-VERIFIED** | `1f1a402` truoc `BT-20261003045045`; CI + LT 3/7/14 + nhan "MO PHONG" |
| `05-differentiation.md` + `06-business.md` co nguon hoac nhan "chua xac minh" | **DONE-VERIFIED** | `[MO]/[TRICH]` + URL + ngay; 3 muc `[CHUA XAC MINH]` |
| Che do khong-LLM chay tron luong demo; so LLM chi co neu da chay that | **DONE-VERIFIED** | `smoke:demo-flow` 12/12 voi LLM tat; moi noi ghi "**chua do**" |
| Bo cong cu nguoi thu + phieu gan nhan san | **PARTIAL** | bo cong cu **san** (`usertest/`); **phieu gan nhan 120 cap van de trong** => chua co so do |
| Kich ban demo + dan y + QA co han che that | **DONE-UNVERIFIED** | `04-demo-script.md`, `07-pitch-outline.md`, `07-qa-prep.md` (16 cau) — **chua dien tap tren may trinh bay** |
| Khong tien trinh nen; khong secret/du lieu that trong commit; `STATE.md` + `MORNING-REPORT.md` moi nhat da commit | **DONE-VERIFIED** | node = 0; quet sach; commit cuoi gom ca hai tep |

**Truc tiep cho 3 muc FAIL:** (1) `llm:eval` **tu choi** chay khi chua co nhan tay — dung
theo hien phap, khong phai loi; (2) thieu khoa ngoai `tenants` o 135/140 bang la **han
che da biet** chua sua (ngoai pham vi); (3) so LLM = "chua do" o **moi** noi.

---

## Cap nhat 2026-10-04 (phien P9 - sua bug chan cua thi, chua day remote)

**RESUME HERE - Vong 2 dang chay trong `round2/p0-hardening`.** Phien nay khong
them tinh nang ngoai pham vi; chi sua nhung loi lam CODE KHONG HOAT DONG tren san
khuau, va day len GitHub.

### 1. Xac minh LLM THAT (mo khoa H2 mot phan)

`GEMINI_API_KEY` trong `.env` **trong** (dat 2026-10-04). `npm run check:llm`:
provider `gemini`, model `gemini-3.8-flash` **co that trong danh sach 61 model**,
va **1 request that tra loi duoc** ("Quan-ly"). Bai "chua xac minh ten model co
ton tai that khong" (F7) **da duoc dong** bang bang chung, khong phai doan.

`npm run llm:eval` van **tu choi chay** — ly do khac: thieu **nhan tay** 120 cap
(FILL-IN A1), khong phai thieu key. Do la dung theo hien phap.

### 2. Paywall fail-open — DA VA (F8/B1)

`requireModule` doc `req.user.tenantId`; `plan.middleware.js:109` `if (!tenantId)
return next()` ⇒ dat `requireModule` truoc `authenticate` là **vô hiệu hoàn toàn**.

- **16 file route** chuyen sang `router.use(authenticate, requireModule("x"))`.
- `authenticate` **idempotent** (`req.authVerified`) de `router-level` + `per-route`
  khong ton 2 query user.
- `ai` + `replenishment` **da duoc gate** (truoc do khong gate o dau ca).
- **`tests/plan-gate-order.contract.test.js`** (5 test) — doc source, tim moi
  `requireModule` dang truoc `authenticate`, co allowlist 2 route cong khai
  (`delivery/:id/track`, `portal` — xac thuc OTP khong co `req.user`).

### 3. ROP co route HTTP lan dau tien (quan trong nhat)

`replenishment` (54 unit test + backtest + human-gate) **khong co route nao** — chi
chay qua CDC `LOW_STOCK` va cron. **Them** `src/modules/replenishment/replenishment.routes.js`:

| Endpoint | Tac dung |
|---|---|
| `GET /suggestions` | SKU duoi ROP + so de xuat (read-only) |
| `GET /products/:id/preview` | xem truoc 1 SKU, khong ghi bang nao |
| `POST /products/:id/propose` | TAO `AgentHumanGate` PENDING that |

`previewForProduct` (moi trong `replenishment.suggest.js`) dung CHUNG
`loadReplenishmentInput` + `planReplenishment` voi duong ghi ⇒ so xem truoc va so
ghi vao gate la mot.

### 4. Bug "thay khach thay khong dung thu" — DA VA

`GET /smart-guide/reorder` la man hinh **duoc mo** cua khach, nhung no tu tinh
bang cong thuc rieng `(minStock*2 - qty)*1.2` voi nguong **`10` hard-code** (bieu
thuc `prisma.inventory.fields?.minStock ? undefined : 10` luon ra 10). Cung du
lieu, hai ket qua khac nhau. Nay `getReorderSuggestions` da chuyen sang engine ROP
(cot ten truong cho frontend giu nguyen, them `rop`/`leadTimeDays`/`leadTimeEstimated`).
`summary.engine = "replenishment/planReplenishment"` de chung minh.

### 5. Demo KHONG CHAY DUOC tren may — da giai

Tenant demo co user mat khau `khong-dang-nhap-duoc` + **khong co subscription** ⇒
(1) khong dang nhap duoc, (2) gate module se chan. Tenant CANDORY thi 20 SKU, khong
SKU nao duoi ROP ⇒ man hinh nhap hang **trong**.

`scripts/demo/ensure-demo-login.js` + `npm run demo:login -- --apply` (idempotent,
dry-run mac dinh): bat mat khau + `emailVerified`, tao subscription ACTIVE `business`,
va bo sung `replenishment` vao `allowedModules` cua plan. **Khong** sua
`data:import` (co ky vong teardown nghiem ngat) va **khong** dung tenant CANDORY.

### 6. Bug nho khac

| Viec | Truoc | Sau |
|---|---|---|
| `purchase.service.js` | `PO_APPROVE_THRESHOLD = 50_000_000` hard-code **vs** `create()` doc `companySettings` | mot nguon duy nhat |
| `hr.service.js:49` | bcrypt hard-code `10` | doc `BCRYPT_ROUNDS` (mac dinh 12) |
| `crostonDemandPerDay` | nhan `alpha = 0.1` roi **bo qua** | `alpha` tuy chon co nghia; ham san pham khong truyen ⇒ **so tinh toan khong doi** |
| `db-agent` patterns | `'po'` khop "ao **po**lo", `'don'` khop "**don** gia" | ho tro RegExp; `resolveIntent` phan biet string vs regex |
| 7 cho `logger.error(msg, obj)` | winston splat ⇒ in `{"0":"\\n","1":"I",...}` khong doc duoc | noi vao template |

### 7. Kiem chung P9 (2026-10-04, chay TUAN TU)

| Lenh | Ket qua | Loai |
|---|---|---|
| `npx jest` | **4109/4114 pass** (74 suite, 5 skip) — +7 test moi | mock |
| `npm run check:modules` | **204 module** | — |
| `npm run check:swagger` | **117/117** khoi | tinh |
| `npm run smoke:po-gate` | **24/24** | **DB that** |
| `npm run smoke:demo-flow` | **12/12** | **DB that** |
| `npm run check:llm` | 1 request that OK | **LLM that** |
| HTTP that (server gioi han ~60s, tu tat) | login demo -> `/replenishment/suggestions` 200 (5 dong) -> `/smart-guide/reorder` 200 (**130 dong**) -> `status=BOGUS` 400 | **HTTP that** |

Khong con tien trinh nen sau moi lan chay (`Get-Process node` = 0).

### 8. Con lai (khong lam trong phien nay)

- **A1 nhan tay 120 cap** → van la thu tu chay mau cho **MOI so ve AI**.
- Portal + `delivery/:id/track` **van khong gate duoc** theo goi (khong co `req.user`).
- `enterprise` `price: 0` ⇒ hien "Mien phi" tren trang gia (can sua hien thi, khong sua seed).
- 135/140 bang scoped chua co FK toi `tenants`; `db:agent` viet 1 loi in khong doc duoc.