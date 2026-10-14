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

## 2. Bộ phiếu khảo sát 10 cửa hàng trong `docs/`

Tệp: `docs/AISC_10_Cua_Hang_Da_Dien_Gia_Dinh (1).xlsx` — 11 sheet (`TONG HOP` + `CH01…CH10`),
10 cửa hàng × 24 câu.

### Phương pháp

Khảo sát thực địa **05–09/10/2026** tại TP.HCM theo phương pháp **bảng hỏi bán cấu
trúc (semi-structured survey)**: 24 câu gồm câu hỏi tình huống ("kể lại lần gần nhất",
"khi đó anh/chị biết trước bao lâu") và câu hỏi thu thập dữ liệu định lượng (số SKU,
nhân viên, số nhà cung cấp, mức phí). Phiếu ẩn danh theo mã `CH01`…`CH10`,
**đồng ý ghi nhận ẩn danh phục vụ nghiên cứu AISC'26** (ghi ở ô F4 từng phiếu).

### Số liệu lấy được

| Chỉ số | Số | Nguồn trong tệp |
|---|---:|---|
| Gặp hết hàng (giờ cao điểm / cuối tuần / mùa vụ) | **9/10** | cột G, sheet `TONG HOP` |
| Bị nhập dư, vốn nằm không | **10/10** | cột H |
| Muốn dùng tính năng đề xuất số lượng | **9/10** | cột I (CH03 từ chối vì "lo phí") |
| Đang dùng sổ tay / Excel / POS cơ bản | **9/10** | cột F |
| Dùng KiotViet · Sapo | **1/10** (CH07) · **0/10** | cột F |
| Yêu cầu bắt buộc có bước chủ quán duyệt | **10/10** | câu 20 / 23 |
| Quy mô mẫu | 2–5 nhân viên · 65–520 SKU | cột D, E |

**Câu 22 — mức sẵn sàng chi trả (WTP).** Đây là con số dùng để định giá gói:

| Mức | Số cửa hàng | Phiếu |
|---|---:|---|
| 50.000đ/tháng | 1 | CH03 |
| 99.000đ/tháng | 3 | CH01, CH05, CH08 |
| 149.000đ/tháng | 3 | CH02, CH04, CH10 |
| 199.000đ/tháng | 2 | CH06, CH09 |
| 249.000đ/tháng | 1 | CH07 |
| **Trung vị** | **149.000đ/tháng** | dải 50.000–249.000đ |
| Ngưỡng "quá đắt" — trung vị | 300.000đ/tháng | dải 180.000–400.000đ |

**Câu 11 — chi phí phần mềm ĐANG TRẢ.** Phân biệt rõ với câu 22, đây là tiền họ
chi ra hôm nay chứ không phải tiền họ sẵn sàng chi:

| Nhóm | Số | Mức đang trả |
|---|---:|---|
| Đang trả phí phần mềm | **5/10** | 110.000đ (CH01) · 150.000đ (CH02) · 160.000đ (CH10) · 180.000đ (CH04) · 250.000đ (CH07) |
| Không trả phí riêng | **5/10** | CH03, CH05, CH06, CH08, CH09 — chỉ sổ tay/Excel |

> **Hai kết luận thương mại đọc ra từ bảng trên, và cả hai đều nghiêng về phía ta:**
> 
> 1. **5/10 cửa hàng đang trả tiền cho POS** (110.000–250.000đ) — trong khi vẫn phải
>    xuất Excel kiểm tay mỗi tối. Đây là ngân sách sẵn có, không phải ngân sách cần xin.
> 2. **CH07 đang trả 250.000đ/tháng cho KiotViet mà vẫn lệch tồn kệ vs kho và thiếu
>    hạch toán công nợ khi NCC giao nhiều đợt.** Đối thủ đã có mặt ở đúng chỗ khách
>    hàng không trả tiền cho quản lý tồn kho.

> **Mặt đối lập phải nói thẳng:** trung vị WTP (149.000đ) **thấp hơn** mức trung vị
> của nhóm đang trả phí (160.000đ). Nghĩa là ở mức giá trung vị, sản phẩm phải **cho
> thấy giá trị rõ** chứ không thể chỉ "rẻ ngang tiền POS". Và với CH03 (WTP 50.000đ)
> thì không thể bán được — đó là giới hạn phân khúc, không phải lỗi chiến lược.

### Câu hỏi trả lời giống nhau giữa các phiếu

Bốn câu (**8, 19, 20, 23**) có **cùng một cách diễn đạt** ở cả 10 phiếu. Đây là đặc
điểm cần lưu ý khi đọc báo cáo: bốn câu đó được hỏi theo **dạng gợi ý có danh mục**
("Người đó dựa vào số bán, tồn kho, kinh nghiệm hay nhà cung cấp?"), nên các phiếu
ghi nhận theo cùng một khung. Vì vậy:

- **Dùng được:** số phiếu đồng ý với từng phương án (ví dụ 10/10 nêu rõ cần duyệt
  trước khi đặt) — đó là đồng thuận về ý, đo được trên 10 người.
- **Không nên dùng:** tần suất của từng cụm từ trong lời thoại của bốn câu này,
  vì lời thoại không độc lập.

Các câu còn lại — nhất là **4, 5, 6, 9, 13, 14, 15, 24** (tình huống cụ thể) — có
lời trả lời **riêng cho từng cửa hàng**, và đó là phần đáng dùng nhất.

### Còn thiếu

1. **Phỏng vấn sâu dạng ghi âm** — bộ 8 câu ở `06-business.md` §4, ghi **nguyên văn**
   sau khi được phép (mẫu đồng ý: `usertest/consent-form.md`).
2. **Mẫu lớn hơn và nhiều ngành hơn** — mẫu hiện gồm 3 cà phê, 2 trà sữa, 3 tạp hóa,
   2 phụ kiện – VPP, tất cả quy mô nhỏ tại TP.HCM.
