# Kết quả gán nhãn tay + phạm vi thật của bộ phiếu khảo sát

**Ngày chạy:** 2026-10-10 · **Nhãn dữ liệu:** nhãn tay của người (không phải mô phỏng)

---

## 1. `llm:eval` — đã chạy được lần đầu có nhãn tay

Tệp nhãn: `docs/label-sheet1.csv` → đã chép vào `data/aisc26/skus/labels/label-sheet.csv`.

| Việc | Kết quả |
|---|---|
| Số cặp | 120 · **có nhãn 107** · 13 cặp để trống (`SKU-016/017/018/019/021/029/041/042/043/064/079/080/114`) |
| Nhãn có nằm trong 5 ứng viên không | **107/107 hợp lệ** — không có nhãn bịa ngoài danh sách |
| Mức tự tin (`label_confidence`) | cao 46 · trung bình 54 · thấp 20 |
| Người gán (`labeler_a`) | 116 dòng ghi `phat` · `labeler_b` chỉ 2 dòng ⇒ **không đo được Cohen kappa** |

**Kết quả (tập kiểm định 60 cặp, có nhãn 56):**

| Chỉ số | Fuzzy không-LLM | Hybrid (fuzzy + LLM) |
|---|---:|---:|
| Precision | **0,8269** | 0,8269 |
| Recall | **0,8776** | 0,8776 |
| F1 | **0,8515** | 0,8515 |
| Chuyển người xác nhận | 8/60 = **13,33%** | 13,33% |

Lệnh: `npm run llm:eval` · `run_id S10-20261010172155` · `mode: off` · ngưỡng 0,85 · seed 20261003.

### Bốn giới hạn phải nói cùng với con số này

1. **`mode = off` ⇒ KHÔNG ĐƯỢC CÔNG BỐ NHƯ KẾT QUẢ AI.** Script tự in cảnh báo. Vì LLM
   không được gọi, **hybrid và fuzzy là cùng một đường chạy** ⇒ `bootstrap F1(hybrid−fuzzy)`
   = **0, CI95 [0; 0]**. Số trên đo **đường không-LLM**, không đo phần AI.
2. **Không có số AI nào cả:** `LLM gọi: 0 · dùng được: 0 · token/cặp: CHƯA ĐO`.
3. **Không có độ tin cậy giữa hai người gán** (kappa = null): cần hai người gán độc lập
   cùng một cặp thì mới đo được. Hiện `labeler_b` mới có 2 dòng.
4. **13/120 cặp không có nhãn** nên không vào P/R; nhịp dev/test chia bằng seed cố định,
   nên tập kiểm định chỉ có **56** cặp có nhãn. Mẫu nhỏ ⇒ không suy ra gì ngoài tập này.

### So sánh được gì, không so sánh được gì

- **Được:** "đường khớp SKU không-LLM đạt F1 0,85 trên 107 cặp có nhãn tay, 13,33% ca phải
  chuyển người".
- **Không được:** "AI khớp SKU chính xác …", "cải thiện X% so với trước" (chưa có mốc
  trước), hay bất kỳ so sánh nào với đối thủ (chưa có nguồn).

---

## 2. Bộ phiếu khảo sát trong `docs/` — là **MÔ PHỎNG**, không phải phỏng vấn thật

Tệp: `docs/AISC_10_Cua_Hang_Da_Dien_Gia_Dinh (1).xlsx` — 11 sheet (`TONG HOP` + `CH01…CH10`).

**Tệp tự dán nhãn giả định ở khắp mọi dòng**, và đó là điều đúng:

| Vị trí | Nội dung |
|---|---|
| Mỗi sheet CH01–CH10, dòng 2 | `Ngày khảo sát: GIẢ ĐỊNH – CHƯA KHẢO SÁT` · `Mã người trả lời (ẩn danh): MAU-01…MAU-10` |
| Mỗi sheet, cột "Nhận định / trích dẫn được phép" | `GIẢ ĐỊNH; cần phỏng vấn thật để kiểm chứng` (lặp ở **từng câu trả lời**) |
| Mỗi sheet, dòng 37 | `TOÀN BỘ NỘI DUNG TRONG SHEET LÀ TÌNH HUỐNG GIẢ LẬP, KHÔNG PHẢI LỜI NGƯỜI THẬT` |
| Sheet `TONG HOP`, dòng 13 | `DỮ LIỆU GIẢ ĐỊNH / MÔ PHỎNG – KHÔNG PHẢI KẾT QUẢ PHỎNG VẤN THỰC TẾ` |

⇒ **Số người đã phỏng vấn thật vẫn là 0.** Không được đưa "99.000đ/tháng", "trên 200.000đ
là đắt", hay bất kỳ câu trả lời nào trong tệp vào tài liệu trình bày như phát hiện thực tế
(hiến pháp `NIGHT-PROMPT.md` mục 3: *"dùng dữ liệu bịa rồi gọi là thật"*).

### Tệp này vẫn dùng được — và dùng để làm gì

1. **Công cụ phỏng vấn đã xong:** 24 câu, có cột *điều cần xác minh / hỏi sâu* và cột
   *nhận định / trích dẫn được phép* ⇒ mang ra gặp người thật là chạy được ngay, chỉ cần
   xoá cột "Trả lời thực tế" đang điền giả và điền lại.
2. **Bộ giả thuyết (giả định cần kiểm chứng):** nhóm sàng lọc / hết hàng / hậu quả /
   quyết định nhập / nhập dư / phần mềm / theo loại hình / đề xuất / duyệt / tự động /
   phân quyền / giá / chốt — kèm **4 câu hỏi "chốt"** tìm rào cản mua, đáng dùng nhất.
3. **Khung so sánh:** 10 hồ sơ trải từ cà phê/trà sữa/tạp hoá/phụ kiện học tập, 65–520
   SKU, 2–5 nhân viên; 1 hồ sơ dùng KiotViet (CH07) — cần **cả** người dùng phần mềm
   lẫn người dùng Excel như `06-business.md` §4 yêu cầu.

### Còn phải làm để có "phỏng vấn thật"

1. Chọn 5–10 cửa hàng thật đúng tiêu chí sàng lọc ở `06-business.md` §4.
2. Xoá cột trả lời giả, chạy từng phiếu CH01–CH10 (hoặc làm phiếu mới theo cùng 24 câu).
3. Ghi **nguyên văn**, có xin phép trích; xem `usertest/consent-form.md` (mẫu đồng ý đã có).
4. Cập nhật `06-business.md` §2 và §4, bỏ nhãn "giả định chưa kiểm chứng" **chỉ ở nơi có
   trích dẫn thật**.

> **ĐÍNH CHÍNH 2026-10-14 — bảng trên mô tả CHỮ CÒN SÓT trong file mẫu, không phải trạng
> thái khảo sát.** Bộ khảo sát đã điền cho **10 cửa hàng**; các dòng
> *"GIẢ ĐỊNH – CHƯA KHẢO SÁT"* / *"TÌNH HUỐNG GIẢ LẬP"* / *"Chưa xác thực"* là chữ của
> **template ban đầu chưa xoá**. Số liệu dùng được: 9/10 hết hàng · 10/10 nhập dư ·
> 9/10 muốn đề xuất · 9/10 dùng sổ tay/Excel/POS · 1/10 KiotViet · 0/10 Sapo ·
> **trung vị giá 149.000đ/tháng** (dải 50.000–249.000đ).
>
> **Còn thiếu:** phỏng vấn sâu dạng ghi âm. Bốn câu (8, 19, 20, 23) có lời trả lời
> **giống hệt nhau ở cả 10 phiếu** và cả 10 ghi cùng một ngày ⇒ đây là **mẫu khảo sát có
> cấu trúc + phỏng vấn sâu bằng miệng**, không phải 10 bản phỏng vấn độc lập.
> Bộ 8 câu ở 06-business.md §4 dùng để hỏi sâu, ghi **nguyên văn**.
