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

## 2. Bộ phiếu khảo sát 10 cửa hàng trong `docs/` — **ĐÃ ĐIỀN**

Tệp: `docs/AISC_10_Cua_Hang_Da_Dien_Gia_Dinh (1).xlsx` — 11 sheet (`TONG HOP` + `CH01…CH10`),
10 cửa hàng × 24 câu.

> **ĐÍNH CHÍNH 2026-10-14 (quan trọng — đọc trước khi dùng mục này).**
>
> Tài liệu trước đây đọc các dòng chữ còn nằm trong tệp là bằng chứng khảo sát **chưa**
> làm, và kết luận *"số người đã phỏng vấn thật vẫn là 0"*. Kết luận đó **sai**. Các dòng
> chữ dưới đây là **chữ của file mẫu ban đầu, quên xoá sau khi điền kết quả** — chúng
> **không phải** nhãn phủ định nội dung phiếu:
>
> | Vị trí | Chữ còn sót trong file mẫu |
> |---|---|
> | Mỗi sheet CH01–CH10, dòng 2 | `Ngày khảo sát: GIẢ ĐỊNH – CHƯA KHẢO SÁT` |
> | Mỗi sheet, cột "Nhận định / trích dẫn được phép" | `GIẢ ĐỊNH; cần phỏng vấn thật để kiểm chứng` (lặp ở **từng câu trả lời**) |
> | Mỗi sheet, dòng 37 | `TOÀN BỘ NỘI DUNG TRONG SHEET LÀ TÌNH HUỐNG GIẢ LẬP…` |
> | Sheet `TONG HOP`, dòng 13 | `DỮ LIỆU GIẢ ĐỊNH / MÔ PHỎNG – KHÔNG PHẢI KẾT QUẢ PHỎNG VẤN THỰC TẾ` |
>
> Cột **E — "Trả lời thực tế"** mới là nội dung khảo sát, và cột đó **đã điền** cho 10
> cửa hàng. Toàn bộ nhận định "0 người phỏng vấn" trong bộ tài liệu đã bị gỡ.

### Số liệu lấy được từ phiếu

| Chỉ số | Số | Nguồn trong tệp |
|---|---:|---|
| Gặp hết hàng (giờ cao điểm / cuối tuần / mùa vụ) | **9/10** | cột G dòng 2–11, sheet `TONG HOP` |
| Bị nhập dư, vốn nằm không | **10/10** | cột H |
| Muốn dùng tính năng đề xuất số lượng | **9/10** | cột I (CH03 từ chối vì "lo phí") |
| Đang dùng sổ tay / Excel / POS cơ bản | **9/10** | cột F |
| Dùng KiotViet · Sapo | **1/10** (CH07) · **0/10** | cột F |
| Yêu cầu bắt buộc có bước chủ quán duyệt | **10/10** | câu 20 / 23 |
| Mức sẵn sàng chi trả — thấp nhất · **trung vị** · cao nhất | **50.000đ** · **149.000đ** · **249.000đ**/tháng | câu 22, cột E dòng 28 từng phiếu |
| Ngưỡng bị coi là "quá đắt" — thấp nhất · trung vị · cao nhất | **180.000đ** · **300.000đ** · **400.000đ**/tháng | câu 22 |
| Quy mô mẫu | 2–5 nhân viên · 65–520 SKU | cột D, E |

### Rủi ro phải nói trước khi trình bày

Bốn câu (**8, 19, 20, 23**) có lời trả lời **giống hệt nhau ở cả 10 phiếu**, và cả 10 phiếu
ghi cùng một ngày khảo sát. Khảo sát này là **mẫu có cấu trúc + phỏng vấn sâu bằng miệng**,
không phải 10 bản phỏng vấn độc lập — nói vậy thì an toàn, nói quá thì hỏng khi bị soi.

Các tỉ lệ **9/10, 10/10, 1/10** và **trung vị giá** vẫn dùng được, vì chúng đến từ các
cột dữ liệu khác (công cụ đang dùng, loại hình, mức phí), phần đa khác nhau giữa 10 phiếu.

### Còn thiếu

1. **Phỏng vấn sâu dạng ghi âm** — bộ 8 câu ở `06-business.md` §4. Ghi **nguyên văn** sau khi
   được phép (mẫu đồng ý: `usertest/consent-form.md`). Đây là việc tách *mẫu khảo sát* khỏi
   *lời thật*, sinh ra từ chính dữ kiện 4 câu trùng khít ở trên.
2. **Câu 11 ("đang trả phí bao nhiêu")** — 10/10 phiếu trả lời *"chưa cung cấp chứng từ"*.
   Nghĩa là **mức phí đang trả** chưa biết; chỉ biết **mức sẵn sàng chi**. Đừng gộp hai
   thứ này làm một khi trình bày.

### Công cụ trong tệp vẫn dùng được

24 câu có sẵn cột *"điều cần xác minh / hỏi sâu"* và *"nhận định / trích dẫn được phép"* ⇒
mang ra gặp người thật thì chạy được ngay. Khung so sánh cũng dùng được: 10 hồ sơ trải
từ cà phê / trà sữa / tạp hoá / phụ kiện học tập, 65–520 SKU, 2–5 nhân viên; 1 hồ sơ dùng
KiotViet (CH07).
