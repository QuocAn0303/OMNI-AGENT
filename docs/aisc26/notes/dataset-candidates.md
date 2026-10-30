# Ghi chú T6 — ứng viên dataset (đọc thật, có bằng chứng)

Ngày khảo sát: **2026-10-03** · Nhánh: `round2/p2-data` · Trạng thái: **ĐÃ CHỌN**
(NGUỒN: `docs/aisc26/02-data.md`)

Tiêu chí chốt (từ `NIGHT-PROMPT.md` T6): SKU × ngày · có giá · **≥ 18 tháng** · có SKU bán
thưa · giấy phép cho phép · không PII · 50–500 SKU sau lọc.

Hạn mức gói: tối đa 8 lần `fetch`. Đã dùng **1** (trang dataset UCI 502, để đọc giấy phép).
Các URL khác kiểm bằng HTTP HEAD / API metadata (không tính vào hạn mức đọc trang).

---

## 1. Bảng so sánh

| Ứng viên | Nguồn chính thức | Mở thật bằng cách nào | ≥18 tháng | Có giá | SKU bán thưa | Giấy phép | PII | Số SKU | Kết luận |
|---|---|---|---|---|---|---|---|---|---|
| **UCI Online Retail II** (uci_id **502**) | https://archive.ics.uci.edu/dataset/502/online+retail+ii | **Tải thật** 43,51 MB → sha256 `572e3627…67bfb` → đọc 1.067.371 dòng, dựng 166.578 dòng SKU×ngày | ✅ **25 tháng** (2009-12-01 → 2011-12-09) | ✅ `Price` + `unit_price_median` | ✅ 38/500 SKU (7,6%) bán <10 ngày/90 ngày | ✅ **CC BY 4.0** (đã đọc) | ✅ cột `Customer ID`/`Country` bị bỏ khi dựng | ✅ **500** | **CHỌN** |
| UCI Online Retail (uci_id 352) | https://archive.ics.uci.edu/dataset/352/online+retail | Đọc trang + metadata API | ❌ **12,3 tháng** (2010-12-01 → 2011-12-09) | ✅ | ✅ | ✅ CC BY 4.0 | ✅ | ~3.900 | **LOẠI** — chỉ 12 tháng, vi phạm tiêu chí ≥18 tháng |
| Brazilian E-Commerce (Olist) | https://www.kaggle.com/datasets/olistbr/brazilian-ecommerce | **Thử tải thật** 5 URL gốc (S3 công khai) → **404**; chỉ còn Kaggle (cần tài khoản) | ✅ 26 tháng | ✅ | ✅ | ⚠️ Kaggle Open Database | ⚠️ có tọa độ khách | 30.000+ | **BLOCKER-HUMAN** — đủ tiêu chí nhưng tải không tự động được |
| M5 (Walmart) | https://www.kaggle.com/c/m5-forecasting-accuracy | **CHƯA mở** (cần tài khoản Kaggle + chấp nhận điều khoản cuộc thi) | ✅ 3 năm | ✅ | ✅ | ✅ CC BY 4.0 | ✅ | 30.304 | **LOẠI (chưa xác minh)** — dữ liệu không công khai tải vô điều kiện |

---

## 2. Bằng chứng cụ thể

### 2.1. UCI Online Retail II — ứng viên được chọn

Metadata chính thức (đọc từ trang UCI 502, ngày 2026-10-03):

- Tên: *Online Retail II* · Người hiến: Daqing Chen · Ngày hiến: 20/09/2019
- Mô tả: *"contains all the transactions occurring for a UK-based and registered,
  non-store online retail between 01/12/2009 and 09/12/2011"* · abstract: *"A real online
  retail transaction data set of two years."*
- `# Instances: 1067371` — **khớp đúng** số dòng script đọc được (1.067.371).
- Tệp: `online_retail_II.xlsx`, 43,5 MB. File tải về: 45.622.418 byte,
  sha256 `572e36277c2390fbfde10664750731e0a86f55e33470d91919085f0408e67bfb`.
- **Giấy phép (đã đọc nguyên văn):** *"This dataset is licensed under a Creative Commons
  Attribution 4.0 International (CC BY 4.0) license. This allows for the sharing and
  adaptation of the datasets for any purpose, provided that the appropriate credit is given."*
- Trích dẫn bắt buộc: `Chen, D. (2012). Online Retail II [Dataset]. UCI Machine Learning
  Repository. https://doi.org/10.24432/C5CG6D`

Lưu ý kỹ thuật phát hiện khi đọc thật: tệp có **2 sheet** (`Year 2009-2010`,
`Year 2010-2011`) vì vượt giới hạn 1.048.576 dòng của Excel — script phải đọc **cả hai**,
đọc một sheet sẽ mất một nửa dữ liệu. Tên cột thực tế trong tệp là `Invoice`, `Price`
(mô tả UCI ghi `InvoiceNo`, `UnitPrice`) — script bám theo tệp, không theo mô tả.

### 2.2. UCI Online Retail (352) — loại vì thiếu thời gian

Trang UCI ghi rõ khoảng `01/12/2010 → 09/12/2011` ⇒ **12,3 tháng**. Tệp tải được
(22,6 MB) nhưng vi phạm tiêu chí ≥18 tháng. Không dùng làm nguồn chính.

### 2.3. Olist — đủ tiêu chí nhưng tải tự động không được

Năm URL bucket S3 công khai trả **404** (đã kiểm 2026-10-03):
`olist_orders_dataset.csv`, `olist_order_items_dataset.csv`,
`olist_products_dataset.csv`, `olist_sellers_dataset.csv`, và chính thư mục gốc.
⇒ Bucket đã bị xoá/siết quyền. Chỉ còn Kaggle (cần đăng nhập).

Đây là ứng viên **duy nhất** tìm được thỏa mọi tiêu chí mà vẫn là dữ liệu thật dài hơn
25 tháng ⇒ ghi thành **BLOCKER-HUMAN** (xem `02-data.md` §7).

### 2.4. M5 — chưa mở, ghi rõ để không tính nhầm

Không tải được vô điều kiện (Kaggle + điều khoản cuộc thi). Ghi "chưa xác minh" chứ không
ghi "đã loại vì dữ liệu kém" — hai việc khác nhau.

---

## 3. Số liệu đo được sau bộ lọc (nguồn: `data/dataset/dataset-summary.json`)

| Đại lượng | Giá trị |
|---|---|
| Dòng đọc | 1.067.371 |
| Bỏ hóa đơn hủy (`Invoice` bắt đầu "C") | 19.494 |
| Bỏ dòng `Quantity ≤ 0` hoặc `Price ≤ 0` | 6.207 |
| Bỏ mã phiên hàng (POST, DOT, M…) | 4.793 |
| Dòng giữ | 1.036.877 |
| SKU trong tập gốc | 4.707 |
| SKU sau L3 (≥30 đơn vị) | 4.165 |
| **SKU sau L4 (chọn cuối)** | **500** |
| Dòng SKU × ngày | 166.578 |
| Khoảng ngày | 2009-12-01 → 2011-12-09 (**25 tháng**) |
| Tổng số đơn vị | 7.079.225 |
| Tổng doanh thu | 10.489.858,71 (sterling, giá niêm yết) |
| SKU bán thưa (<10 ngày bán/90 ngày) | 38 (**7,6%**) |
| Đơn vị trung bình/SKU | 14.158 |

## 4. Sự kiện + URL + ngày (để điền phụ lục báo cáo)

| Sự kiện | URL | Ngày truy cập |
|---|---|---|
| Trang dataset UCI 502 + giấy phép CC BY 4.0 + số dòng 1.067.371 | https://archive.ics.uci.edu/dataset/502/online+retail+ii | 2026-10-03 |
| Tệp tải (sha256 `572e3627…67bfb`) | https://archive.ics.uci.edu/static/public/502/online+retail+ii.zip | 2026-10-03 |
| Trang dataset UCI 352 (loại vì 12 tháng) | https://archive.ics.uci.edu/dataset/352/online+retail | 2026-10-03 |
| Olist trên Kaggle (BLOCKER-HUMAN) | https://www.kaggle.com/datasets/olistbr/brazilian-ecommerce | 2026-10-03 |