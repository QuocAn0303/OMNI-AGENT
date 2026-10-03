# STATE-P2 — gói P2 (T5, T6) · chế độ song song

Ngày: **2026-10-03** · Nhánh: **`round2/p2-data`** · Worktree: **`D:\aduu-p2`**
Cơ sở: `round2/p0-hardening` @ `1f1a402` (đã fast-forward để có commit giao thức T5).

> Chế độ song song: **không** sửa `STATE.md`, `DECISIONS.md`, `MORNING-REPORT.md`.
> Trạng thái gói nằm ở file này; quyết định ở `DECISIONS-P2.md`.

## RESUME HERE

**P2 đã XONG cả T5 và T6.** Việc kế tiếp của nhánh `round2/p2-data` là **P3 (T7, T8)**
nhưng P3 đang chạy ở worktree khác (`D:\aduu-p3`, nhánh `round2/p3-research`) — không
làm trùng. Việc còn lại thuộc nhánh chính: **P1 (T3/D6, T4 còn lại)** rồi hợp nhất.

| Việc | Trạng thái | Bằng chứng |
|---|---|---|
| **T5** — sửa giao thức S1–S12, một commit, trước mọi backtest | **DONE-VERIFIED** | commit `1f1a402` (nhánh gốc `round2/p0-hardening`, đã có trong `round2/p2-data`); kiểm chứng "chưa có lần chạy nào": `package.json` không có script `backtest`, `Get-ChildItem -Recurse -Include *backtest*,*dataset*` trên `scripts/ tests/ src/` → 0 tệp |
| **T6** — chọn dataset + sha256 + `02-data.md` | **DONE-VERIFIED** | dataset **UCI Online Retail II (uci_id 502)**, sha256 `572e3627…67bfb`; số đo thật trong `02-data.md` §3 và `data/dataset/dataset-summary.json` |
| T6 — phương án dự phòng (dữ liệu tổng hợp TỔNG HỢP) | **SKIPPED** | không cần: tải thật được dataset công khai có giấy phép |
| Olist (26 tháng) | **BLOCKER-HUMAN** | URL S3 404 từ 2026-10-03, chỉ còn Kaggle — xem `02-data.md` §7 |

## Nhánh + commit

| Nhánh | Commit | Nội dung |
|---|---|---|
| `round2/p2-data` (worktree `D:\aduu-p2`) | xem `git log --oneline -2` | T5 (kế thừa `1f1a402`) + script dataset + `02-data.md` + `notes/dataset-candidates.md` |
| `round2/p0-hardening` | `1f1a402` | commit T5 |

## Số đã ký (đừng tự đổi)

- sha256 tệp gốc: `572e36277c2390fbfde10664750731e0a86f55e33470d91919085f0408e67bfb`
- sha256 `daily_sku.csv`: `82f068efa759e9d024bfef6ff51a5b507559c8d2a79410a09dbc9bd60983e33f`
- Giấy phép: **CC BY 4.0**, trích dẫn `Chen, D. (2012). Online Retail II, DOI 10.24432/C5CG6D`
- Bộ lọc L1–L4 (`02-data.md` §4): bỏ hủy/≤0, mã `^\d{5,7}[A-Z]*$`, ≥30 đơn vị, tối đa 500 SKU (400 nặng + 100 nhẹ)
- Seed bootstrap của giao thức: `20261003` (S7); số cửa sổ tối thiểu 3 (S6)

## Kiểm chứng đã chạy ở gói này

| Lệnh | Kết quả | Loại |
|---|---|---|
| `node scripts/dataset/fetch-online-retail-ii.js` | sha256 khớp, bỏ qua tải (idempotent) | **mạng thật** |
| `node scripts/dataset/build-daily-sku.js` | 1.067.371 dòng đọc → 166.578 dòng SKU×ngày, 500 SKU, 25 tháng, 7,6% SKU bán thưa | **tệp dữ liệu thật** |
| `webfetch` trang UCI 502 | giấy phép CC BY 4.0 đọc thật; UCI ghi 1.067.371 dòng — khớp số đo | **nguồn thật** |

Không chạy test/Jest ở gói này: **không sửa mã ứng dụng**, chỉ thêm script dữ liệu độc lập
và tài liệu. (Constitution yêu cầu `npm test` sau *thay đổi mã*; ở đây không có mã ứng dụng
bị đụng — nếu gói sau muốn an toàn thì chạy `npm test` ở repo chính.)

## Phát hiện đáng chú ý cho người đọc sau

1. Tệp `online_retail_II.xlsx` có **2 sheet** (`Year 2009-2010`, `Year 2010-2011`) vì vượt
   giới hạn dòng của Excel — đọc một sheet là **mất một nửa dữ liệu**.
2. Tên cột trong tệp là `Invoice`/`Price`, khác mô tả UCI (`InvoiceNo`/`UnitPrice`).
3. ExcelJS trong `package.json` là bản **3.10.0** và **không** có `StreamReader`;
   `WorkbookReader` của bản này **không** phải async-iterable. Cách đọc 45 MB/1,07 triệu
   dòng đã dùng và chạy ổn định: `await wb.xlsx.readFile(...)` (48–53 giây).
4. Worktree mới **không có `node_modules`**; chạy được bằng
   `$env:NODE_PATH="D:\erp-system\node_modules"`. Không cài thêm gói.
5. `data/dataset/` đã thêm vào `.gitignore` — tệp 45 MB không được commit.
6. S3 công khai của Olist **đã chết** (404). Đừng lập kế hoạch dựa vào nó.

## Việc người cần làm

1. Hợp nhất `round2/p2-data` vào nhánh chính (chưa merge, chưa push) — **không push `main`**.
2. Nếu đội đòi nguồn >25 tháng hoặc giá vốn thật: tải Olist/Favorita trên Kaggle, bỏ vào
   `data/dataset/raw/`, chạy lại `build-daily-sku.js`, cập nhật sha256 trong
   `02-data.md` §1 **và** `DECISIONS-P2.md` D-P2-01.
3. Xác nhận CC BY 4.0 đủ cho mục đích trình bày (`02-data.md` §7).