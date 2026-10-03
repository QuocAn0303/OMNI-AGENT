# 02 — Dữ liệu

**Ngày:** 2026-10-03 · **Nhánh:** `round2/p2-data` · **Gói:** P2 / T6
**Nhãn phạm vi dữ liệu:** **CÔNG KHAI** (không phải dữ liệu khách hàng thật của bất kỳ
doanh nghiệp nào; cũng không phải dữ liệu từ hệ thống ERP của dự án).

> Mọi chỉ số tồn kho suy ra từ dataset này là **MÔ PHỎNG** — xem §6.

---

## 1. Dataset đã chọn

| Mục | Nội dung |
|---|---|
| Tên | **Online Retail II** |
| Nguồn chính thức | https://archive.ics.uci.edu/dataset/502/online+retail+ii |
| Mã UCI | `uci_id = 502` |
| Tệp tải | https://archive.ics.uci.edu/static/public/502/online+retail+ii.zip |
| Người hiến / năm | Daqing Chen / 2012 (ngày hiến lên UCI: 20/09/2019) |
| Trích dẫn bắt buộc | `Chen, D. (2012). Online Retail II [Dataset]. UCI Machine Learning Repository. https://doi.org/10.24432/C5CG6D` |
| **Giấy phép (đã đọc)** | **CC BY 4.0** — *"This allows for the sharing and adaptation of the datasets for any purpose, provided that the appropriate credit is given."* |
| Kích thước tệp | 45.622.418 byte (43,51 MiB) |
| **sha256 tệp gốc** | `572e36277c2390fbfde10664750731e0a86f55e33470d91919085f0408e67bfb` |
| sha256 bảng SKU×ngày đã dựng | `82f068efa759e9d024bfef6ff51a5b507559c8d2a79410a09dbc9bd60983e33f` |
| Khoảng thời gian | **2009-12-01 → 2011-12-09 = 25 tháng** |
| Bối cảnh | Cửa hàng bán lẻ trực tuyến của Anh, bán quà tặng "all-occasion"; nhiều khách là bán buôn/sỉ |

**Vì sao chọn:** đây là ứng viên duy nhất thỏa **mọi** tiêu chí mà tải được **không cần
đăng nhập**, có **giấy phép cho phép dùng và biến đổi**, và có **sha256** kiểm chứng được.
Chi tiết 3 ứng viên còn lại: `notes/dataset-candidates.md`.

---

## 2. Đối chiếu tiêu chí (từ `NIGHT-PROMPT.md` T6)

| Tiêu chí | Yêu cầu | Thực tế | Kết quả |
|---|---|---|---|
| SKU × ngày | bắt buộc | 166.578 dòng SKU×ngày, 604 ngày có bán | ✅ |
| Có giá | bắt buộc | `unit_price_median` + `revenue` mỗi ngày (sterling) | ✅ |
| ≥ 18 tháng | bắt buộc | **25 tháng** | ✅ |
| Có SKU bán thưa | bắt buộc | 38/500 SKU (7,6%) bán <10 ngày trong 90 ngày | ✅ |
| Giấy phép cho phép | bắt buộc | CC BY 4.0, đã đọc trên trang nguồn | ✅ |
| Không PII | bắt buộc | cột `Customer ID`, `Country` **bị bỏ khi dựng**; xem §5 | ✅ |
| 50–500 SKU sau lọc | bắt buộc | **500** | ✅ |

---

## 3. Cách tái tạo (2 lệnh, không cần tài khoản)

```bash
node scripts/dataset/fetch-online-retail-ii.js   # tải + kiểm sha256 (idempotent)
# giải nén để có tệp xlsx (script không tự giải nén):
#   PowerShell: Expand-Archive data\dataset\raw\online_retail_ii.zip -DestinationPath data\dataset\raw -Force
#   Linux/macOS: unzip -o data/dataset/raw/online_retail_ii.zip -d data/dataset/raw
node scripts/dataset/build-daily-sku.js          # dựng daily_sku.csv + dataset-summary.json
```

Lệnh tải **tự dừng** nếu sha256 lệch hoặc tệp nhỏ hơn 40 MiB — không tự sửa giá trị
sha256 mong muốn (theo hiến pháp `NIGHT-PROMPT.md` §3).

Thư mục `data/dataset/` đã nằm trong `.gitignore` ⇒ tệp dữ liệu 45 MB **không** được
commit. Chỉ mã + tài liệu + sha256 được commit.

> **Ghi chú môi trường (worktree song song):** worktree của gói P2 không có
> `node_modules` riêng. Lệnh đã chạy với
> `$env:NODE_PATH="<repo chính>\node_modules"` — chỉ dùng `exceljs` vốn đã có trong
> `package.json`, **không** cài thêm gói.

---

## 4. Bộ lọc áp dụng (chốt trước khi xem số liệu)

| Mã | Quy tắc | Số dòng/SKU bị loại |
|---|---|---|
| L1 | Bỏ hóa đơn hủy (`Invoice` bắt đầu "C") và dòng `Quantity ≤ 0` hoặc `Price ≤ 0` | 19.494 + 6.207 dòng |
| L2 | Chỉ giữ mã hàng khớp `^\d{5,7}[A-Z]*$` (loại mã phiên hàng POST, DOT, M, D, B, C2, BDC, PADS…) | 4.793 dòng |
| L3 | SKU tổng < 30 đơn vị trong toàn kỳ ⇒ loại (không đủ tín hiệu cho `d_ref`) | 4.707 → 4.165 SKU |
| L4 | Nếu > 500 SKU: 400 SKU nhiều đơn vị nhất + 100 SKU ít đơn vị nhất còn lại; hoà thì theo `StockCode` tăng dần | 4.165 → **500 SKU** |

**Vì sao L4 giữ cả SKU ít đơn vị:** tiêu chí của gói yêu cầu "có SKU bán thưa"; nếu chỉ
lấy 500 SKU nhiều nhất thì mất đúng đặc tính cần kiểm chứng. Lọc này **tất định** (cùng
tệp đầu vào ⇒ cùng kết quả), nên chạy lại vẫn ra cùng con số.

## 5. Cấu trúc bảng đã dựng

`data/dataset/daily_sku.csv` (UTF-8, không BOM, phân cách dấu phẩy, thứ tự
`sku` tăng dần rồi `date` tăng dần):

| Cột | Ý nghĩa |
|---|---|
| `date` | ngày `YYYY-MM-DD` |
| `sku` | mã hàng (`StockCode`) |
| `units` | số lượng bán trong ngày |
| `revenue` | doanh thu = `Σ units × price` trong ngày |
| `unit_price_median` | giá đơn vị trung vị trong ngày (sterling) |
| `orders` | số hóa đơn khác nhau chứa SKU đó trong ngày |

**Không có cột nào chứa PII.** Cột `Customer ID` và `Country` của tệp gốc **không** được
đọc vào bảng đầu ra. Cột `Description` (tên hàng, dạng văn bản tự do) cũng bị bỏ vì
chứa chuỗi tự do không cần cho mô hình.

## 6. Giới hạn phải nói thẳng

1. **Không có tồn kho.** Dataset không biết còn hàng hay hết hàng ⇒ mọi ngày "hết hàng"
   trong backtest là **mô phỏng** theo `03-evaluation-protocol.md` §2.3 và §4.
2. **Không có lead time thật.** Lead time 3/7/14 ngày là **giả định cấu hình trước**, không
   phải dữ liệu quan sát.
3. **Không có kênh bán.** Chỉ một nhà bán ⇒ **không** tuyên bố hiệu quả "đa kênh".
4. **Không có chi phí mua/giá vốn.** Mọi chống chỉ số dùng **giá niêm yết** làm giá vốn —
   ghi rõ là giả định, không phải giá vốn thật.
5. **Không có dữ liệu người quyết định tay.** Nhánh "người quyết định tay" (P5 trong giao
   thức) là **hành vi quan sát trong dữ liệu**, không phải người thật; thời gian thao tác
   phải lấy từ người thử.
6. **Một doanh nghiệp, một quốc gia, một mặt hàng (quà tặng).** Kết luận chỉ phải phát
   biểu "trên tập dữ liệu này".
7. **Chỉ 25 tháng.** Đủ cho 3 cửa sổ trượt của S6 nhưng **không** đủ để khẳng định mùa vụ
   dài hạn. Số cửa sổ thực tế sẽ ghi kèm khi chạy.
8. **Giá niêm yết theo nước Anh (sterling), không quy đổi.** Không suy ra gì về giá ở Việt Nam.

## 7. BLOCKER-HUMAN (không tự quyết được)

| Việc | Vì sao chỉ người làm được | URL | Ngày kiểm |
|---|---|---|---|
| Nếu đội **bắt buộc** nguồn ≥18 tháng **có giá vốn thật** ⇒ tải Olist (26 tháng) hoặc Favorita (24 tháng) rồi bỏ vào `data/dataset/raw/` rồi chạy lại `build-daily-sku.js` | Cả hai chỉ còn trên Kaggle (cần đăng nhập + chấp nhận điều khoản). URL S3 công khai của Olist **đã trả 404** từ 2026-10-03. | https://www.kaggle.com/datasets/olistbr/brazilian-ecommerce | 2026-10-03 |
| Xác nhận CC BY 4.0 là giấy phép **đủ** cho mục đích trình bày dự án (có dùng thương mại hóa sau này không) | Quyết định pháp lý/tiếp cận sản phẩm, không phải kỹ thuật. | https://creativecommons.org/licenses/by/4.0/ | 2026-10-03 |

Không có blocker nào chặn T9/T10: bảng SKU×ngày đã sẵn sàng và có sha256.

## 8. Sẵn sàng cho gói sau

| Việc sau | Cần gì từ tài liệu này |
|---|---|
| T9 — nạp vào ERP demo | `daily_sku.csv` + bộ lọc §4 + quy tắc "cột PII không được nạp" |
| T10 — backtest | 25 tháng, 500 SKU, 166.578 dòng; chạy 3 cửa sổ trượt S6, lead time 3/7/14 S4, censored nhánh A/B S3 |
| T10 — kết luận | Mọi bảng số phải ghi nhãn **CÔNG KHAI / MÔ PHỎNG (tồn kho, lead time, kênh)** |

---

## 9. Bổ sung gói P4 (T9) — nạp vào ERP + khớp SKU không-LLM

**Ngày:** 2026-10-03 · **Nhánh:** `round2/p0-hardening` · **Gói:** P4 / T9
**Nhãn phạm vi:** catalog + tồn + khách + đơn trong ERP demo là **MÔ PHỎNG**
(dựng từ dataset CÔNG KHAI ở §1, không phải dữ liệu khách hàng/doanh nghiệp nào).

### 9.1 Tệp sinh thêm

| Tệp | Nội dung | sha256 |
|---|---|---|
| `data/dataset/sku_names.csv` | 500 SKU → tên hàng thật trong tệp gốc (`Description`, chọn theo mode) | `df175a831c2123b56eed6958cba3a16dedc881b44233e28fa5c23cb6c667a442` |
| `data/dataset/marketplace/orders_2011-11-06_2011-12-09.csv` | 5.573 đơn / 11.085 dòng hàng **MÔ PHỎNG**, định dạng **giả định** | `bb8e2069af361ed03b1415c82c5a323915b202b590909b6cfd86d4b974c9bbf6` |
| `….truth.csv` | đáp án SKU sinh cùng lúc (không tồn tại trong tệp xuất thật) | — |
| `…/MANIFEST.json` | nhãn MÔ PHỎNG + phân bố nhiễu + sha256 | — |
| `data/dataset/sku-review-queue.csv` | hàng đợi "cần người xác nhận" | — |

Vì sao thêm `sku_names.csv`: `build-daily-sku.js` **cố ý** bỏ cột `Description` (văn
bản tự do). T9 lại cần khớp SKU theo tên ⇒ tách riêng một tệp tên, **không** sửa
`build-daily-sku.js` (sửa sẽ đổi sha256 `daily_sku.csv` đã ghi ở §1). Chi tiết quy
tắc lấy tên (N1–N5) nằm trong đầu `scripts/dataset/build-sku-names.js`.

**Lệnh cần thêm 1 tham số:** `npm run dataset:names` ( `--max-old-space-size=8192`).
Đọc 45 MB xlsx bằng ExcelJS cần heap đó; thiếu thì Node OOM.

Định dạng tệp xuất sàn: **ĐỊNH DẠNG GIẢ ĐỊNH** — Shopee không công khai đặc tả.
Nguồn + URL + ngày + mức độ tin cậy: `notes/marketplace-format.md`.

### 9.2 Ba giả định khi nạp (không đo được từ dataset)

| Mã | Giả định | Vì sao |
|---|---|---|
| A1 | `minStock` = p90 lượng bán/ngày (làm tròn lên, ≥1); tồn đầu kỳ = 3 × p50; cứ mỗi 4 SKU đặt tồn = ⌊minStock/2⌋ | dataset **không có tồn kho** (§6.1). Phần "mỗi 4 SKU tồn thấp" là để luồng demo có tình huống sắp hết hàng |
| A2 | `costPrice = price` (giá niêm yết) | dataset **không có giá vốn** (§6.4) |
| A3 | `currency = GBP`, `exchangeRate = 1`, **không** quy đổi | giá là của nước Anh (§6.8) |

### 9.3 Tenant demo

`slug = omni-demo-mo-phong`, tên có chữ **MÔ PHỎNG**. 500 sản phẩm, 1 kho, 1 NCC,
1 category, 2.500 giao dịch tồn đầu kỳ. Xoá sạch bằng
`npm run data:import -- --reset --apply` (đúng thứ tự phụ thuộc, một transaction).

### 9.4 Khớp SKU không-LLM

`src/modules/import/sku-matcher.js`: trigram Dice + Levenshtein chuẩn hoá + cosine
TF-IDF, ghép trọng số `0.45/0.25/0.30`. Ngưỡng tên hằng số `AUTO_ACCEPT_SCORE =
0.86`, `REVIEW_SCORE = 0.62`, `MIN_SCORE_MARGIN = 0.05` (hạng 1 và 2 gần nhau thì
đẩy xem lại dù điểm cao). **Đơn nào còn dòng hàng chưa đủ tin cậy thì KHÔNG nhập**
và được ghi ra `sku-review-queue.csv` — không tự quyết ở bất kỳ đâu trong mã.

### 9.5 Số đo (ngày 2026-10-03) — **trên dữ liệu tự tạo, KHÔNG phải sàn thật**

| Số | Giá trị | Cách đo |
|---|---|---|
| Dòng hàng trong tệp xuất | 11.085 | đếm dòng CSV |
| Dòng bị CỐ Ý giấu mã | 2.177 (19,6%) | cột `SKU Reference No.` rỗng |
| `AUTO_ACCEPT` | 10.790 | `SkuMatcher.match` |
| `NEEDS_REVIEW` | 292 | idem |
| `NO_MATCH` | 3 | idem |
| **Độ chính xác `AUTO_ACCEPT`** | **100,00%** (sai 0) | so với `.truth.csv` |
| Độ bao phộ nếu `REVIEW` đều đúng | 99,97% | idem |

**Không** suy ra gì từ các số này về dữ liệu sàn thật: tệp là do chính bộ sinh tạo
ra. Số đo thật về tỉ lệ khớp SKU phải chờ `S10` trên tệp thật của đội.

### 9.6 Kiểm chứng

`npm run smoke:import-demo` — 9/9 trên **DB thật**: 0 mồ côi-tenant ở 139 bảng
scoped; 0 dòng hàng trỏ sản phẩm tenant khác; 0 đơn ngoài tệp xuất; dòng hàng
khớp đúng SKU/số lượng/giá; tập SKU = 500 = dataset; có 444 SKU dưới `minStock`;
`candory-scent` giữ nguyên 82 đơn / 158 dòng / 89.862.000 VND.