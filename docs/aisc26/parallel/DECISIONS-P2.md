# DECISIONS-P2 — quyết định tự quyết trong gói P2 (chế độ song song)

Theo `NIGHT-PROMPT.md` §4: ghi bối cảnh, phương án đã cân nhắc, lựa chọn, lý do, cách đảo
ngược. Không sửa `DECISIONS.md` của nhánh chính (chế độ song song).

---

## D-P2-01 — Chọn UCI Online Retail II (502) thay vì chờ dataset ≥18 tháng "hoàn hảo"

- **Bối cảnh:** T6 yêu cầu SKU×ngày, có giá, ≥18 tháng, có SKU bán thưa, giấy phép cho
  phép, không PII, 50–500 SKU. Ba ứng viên phổ biến nhất ngoài UCI đều **không tải tự động
  được**: Olist (S3 công khai trả **404** từ 2026-10-03, chỉ còn Kaggle), Favorita và M5
  (Kaggle + điều khoản cuộc thi).
- **Phương án đã cân nhắc:**
  1. (a) UCI Online Retail II 502 — đủ mọi tiêu chí, tải không cần đăng nhập, có sha256.
  2. (b) UCI Online Retail 352 — chỉ 12,3 tháng ⇒ vi phạm tiêu chí ≥18 tháng.
  3. (c) Dừng, ghi BLOCKER-HUMAN, chờ người tải Kaggle giúp.
  4. (d) Bộ sinh dữ liệu tổng hợp có seed (phương án dự phòng của T6), nhãn TỔNG HỢP.
- **Lựa chọn:** **(a)** UCI Online Retail II (502), đo thật = **25 tháng**, 500 SKU,
  7,6% SKU bán thưa, CC BY 4.0.
- **Lý do:** (b) vi phạm tiêu chí; (c) chặn cả T9 lẫn T10 và vi phạm tinh thần "không đứng
  chờ" của §4; (d) tốn công tạo dữ liệu giả khi đã có dữ liệu thật hợp lệ. (a) là lựa
  chọn **bảo thủ nhất vẫn tiến được**, và mọi hạn chế đều ghi thẳng vào `02-data.md` §6.
- **Cách đảo ngược:** bỏ tệp ra `data/dataset/raw/`, tải Olist/Favorita vào cùng chỗ,
  chạy lại `node scripts/dataset/build-daily-sku.js` (cùng bộ lọc L1–L4), cập nhật sha256
  + số đo trong `02-data.md` §1/§3 và ghi quyết định thay thế ở đây. T10 **chưa chạy** nên
  không mất kết quả nào.

## D-P2-02 — Chọn 500 SKU gồm 400 "nặng" + 100 "nhẹ" thay vì 500 SKU nặng nhất

- **Bối cảnh:** tiêu chí T6 vừa đòi "có SKU bán thưa" vừa đòi 50–500 SKU sau lọc. Lọc
  theo tổng đơn vị giảm từ 4.165 xuống 500 sẽ **xoá hết** SKU bán thưa — tức là xoá đúng
  thứ cần kiểm chứng.
- **Phương án đã cân nhắc:** (a) 500 SKU nhiều đơn vị nhất; (b) 400 nặng + 100 nhẹ nhất;
  (c) giữ toàn bộ 4.165 SKU (vi phạm trần 500).
- **Lựa chọn:** **(b)**, thứ tự tất định (hoà thì theo `StockCode` tăng dần).
- **Lý do:** giữ được đặc tính SKU thưa vốn là một tiêu chí chấm điểm, vẫn nằm trong
  trần 500, và tái lập được y hệt.
- **Cách đảo ngược:** sửa hằng `TOP_HEAVY`/`MAX_SKU` trong `scripts/dataset/build-daily-sku.js`
  rồi chạy lại; không có bước nào phụ thuộc kết quả cũ.

## D-P2-03 — Bỏ cột `Description` (tên hàng dạng văn bản tự do)

- **Bối cảnh:** cột `Description` là chuỗi văn bản tự do, không cần cho ROP/SS/EOQ.
- **Lựa chọn:** không đọa vào bảng đầu ra. Cùng lý do với việc bỏ `Customer ID`/`Country`
  (giữ dữ liệu đầu ra không chứa PII và không chứa chuỗi tự do).
- **Cách đảo ngược:** thêm cột vào script; không ảnh hưởng kết quả mô hình.

## D-P2-04 — Bộ sinh tổng hợp có seed (phương án dự phòng của T6) = SKIPPED

- **Bối cảnh:** T6 dự phòng bộ sinh tổng hợp nhãn TỔNG HỢP khi không tải được dataset.
- **Lựa chọn:** **không dùng** — tải được dataset công khai thật.
- **Lý do:** dùng dữ liệu thật công khai mạnh hơn dữ liệu tự sinh; nhãn "CÔNG KHAI" trung
  thực hơn "TỔNG HỢP".
- **Cách đảo ngược:** xem `notes/dataset-candidates.md`; nếu đội đổi ý kiến, bộ sinh tổng
  hợp chỉ cần một script riêng, không đụng bảng đã dựng.

## D-P2-05 — Ghi trạng thái vào `parallel/`, không sửa `STATE.md`

- **Bối cảnh:** chế độ song song (P2 và P3 chạy cùng lúc) cấm sửa `STATE.md`,
  `DECISIONS.md`, `MORNING-REPORT.md` để không đụng nhau.
- **Lựa chọn:** mọi ghi chú nằm ở `docs/aisc26/parallel/STATE-P2.md` và `DECISIONS-P2.md`;
  `notes/dataset-candidates.md` và `02-data.md` là tài liệu của gói nên vẫn nằm ở vị trí
  chuẩn để gói sau dùng được.
- **Cách đảo ngược:** khi hợp nhất, người điều phối chép phần RESUME HERE của
  `parallel/STATE-P2.md` vào `STATE.md`.