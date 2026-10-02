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
sửa logic test để làm xanh).

### 5.7 Nhánh và tài liệu

Nhánh `round2/p0-hardening` (`hotfix/tenant-nested-write` giữ nguyên).
**Chưa đẩy remote** — D7 chưa chạy (cần đội xác nhận remote).

Tài liệu: `docs/aisc26/` — `AI-HANDOVER.md` (**đọc file này trước**),
`STATE.md`, `DECISIONS.md`, `MORNING-REPORT.md`, `corrections.md`,
`runbook-tenant-null.md`, `00-scope.md`, `00b-gate-design.md`, `01-llm-role.md`,
`03-evaluation-protocol.md`, `one-off/`.
