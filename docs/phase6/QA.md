# Chuẩn bị hỏi đáp — dự án CRM (AN.1 → AN.6)

> Tài liệu này **tôi không tự luyện được** — cần người thật đọc và trả lời lại.
> Mỗi câu ghi rõ: trả lời ngắn (để nói) + bằng chứng (để mở ra cho hội đồng xem)
> + câu hỏi phản công mà hội đồng dễ hỏi nhất.

## Cách dùng

- Trả lời **ngắn, thẳng, không vòng vo**. Nếu chưa biết: **"chúng tôi chưa có dữ liệu đo"** — hơn là bịa.
- Mọi con số trong tài liệu này **lấy từ script chạy thật**, không gõ tay.
- Nếu bị hỏi về thứ chưa kiểm chứng được, nói thẳng là chưa kiểm chứng.

---

## A. Về mô hình dự đoán churn

### A1. "AUC của mô hình là bao nhiêu? So với đề bài thế nào?"

> **0,6857** trên tập kiểm thử 15.503 mẫu. Đề bài yêu cầu ≥ 0,65 — đạt. Điểm tham chiếu
> quan trọng hơn: công thức đang chạy trước đó được **0,6347** trên chính tập đó, tức
> mô hình hơn **0,051**.

**Bằng chứng:** `npm run ml:train --force` → `data/dataset/churn/churn-logreg-metrics.json`

**Phản công dễ gặp:** "Con số đó có ý nghĩa không, hay chỉ là số đẹp?"
> Đây là giới hạn thật và chúng tôi nói trước: dữ liệu là bán lẻ quốc tế (GBP), chưa phải
> Việt Nam; khách là mã thay thế. Nó chứng minh **phương pháp** đo được, không chứng minh
> con số dự báo cho một cửa hàng Việt Nam cụ thể.

---

### A2. "Tại sao không tách tập ngẫu nhiên mà tách theo thời gian?"

> Vì cùng một khách xuất hiện ở nhiều mốc tháng. Tách ngẫu nhiên sẽ để cùng một khách có
> mặt ở cả tập train và tập test — mô hình nhớ được "khách này hay rời bỏ" từ chính dữ liệu
> của họ. AUC lúc đó **nói dối**.

**Bằng chứng:** `docs/phase6/3.1-churn-model.md` §4 — mốc ≤ 2011-01 vào train (17.098 mẫu),
mốc > 2011-01 vào test (15.503 mẫu).

**Phản công:** "Vậy có bị rò rỉ không, mô hình có thấy trước tương lai không?"
> Không thấy trước tương lai. Nhưng **cùng một khách vẫn có thể xuất hiện ở nhiều mẫu
> trong cùng một tập** — giới hạn này chúng tôi ghi thẳng ở §8 mục 3.1, không giấu.

---

### A3. "Ba đặc trưng quan trọng nhất là gì? Nó có hợp lý không?"

> `frequency −0,380` · `logMonetary −0,378` · `avgGapDays +0,308`. Đọc là: **mua càng
> thường xuyên, chi càng nhiều, mua càng đều đặn thì càng ở lại; im lặng càng lâu thì càng
> dễ rời bỏ.** Hợp lý: khách mua thường xuyên là khách đã quen quy trình và còn nhu cầu.

---

### A4. "Vì sao ngưỡng vận hành là 0,202 mà không phải 0,5?"

> Vì 0,5 không có ý nghĩa nghiệp vụ. Chúng tôi chọn ngưỡng theo chi phí: quét các ngưỡng,
> giữ ngưỡng có **precision ≥ 0,35**, trong đó lấy ngưỡng recall cao nhất ⇒ **0,202**.
> Đọc là: *cứ gửi 3 voucher thì hơn 1 khách thực sự sắp rời bỏ, bắt được 88,5% số khách
> sắp rời bỏ.*

**Cách chọn sai đã thử và bỏ:** tối đa hoá recall thuần cho ra ngưỡng 0,117 — recall 0,99
nhưng precision 0,31, tức gửi voucher cho 2/3 khách không hề sắp rời bỏ. Voucher là chi
phí thật nên vậy là lỗ.

---

### A5. "Hệ thống dùng ngưỡng 0,70, còn mô hình 0,202. Hai con số này có mâu thuẫn không?"

> Không, vì chúng khác thang đo, và chúng tôi ghi rõ trong hệ thống:
> - **Ngưỡng mô hình 0,202**: xác suất churn trong 90 ngày theo thang của mô hình.
> - **Ngưỡng hành động 0,70**: quy tắc nghiệp vụ — khách ≥ 0,70 mới tạo cảnh báo + voucher.
> - **Ngưỡng sàng lọc 0,50**: danh sách theo dõi trong analytics, không kích hoạt gì.
>
> Mô hình là **bằng chứng bổ sung**: dưới ngưỡng mô hình thì không nâng cảnh báo; trên ngưỡng
> thì nâng lên 0,70–0,85; hệ thống lấy `max(công thức, mô hình)`.
>
> **Chúng tôi đã thử đưa thẳng xác suất mô hình vào so với 0,70 và nó làm 0 khách nào vượt
> ngưỡng — voucher ngừng chạy.** Đó là lý do thiết kế lại thành hợp nhất.

**Câu hỏi khó nhất dự kiến:** "Vậy có phải mô hình chỉ để trang trí, công thức vẫn là thứ
quyết định?"
> Công thức quyết định ở những khách nó đã cảnh báo; mô hình quyết định ở những khách công
> thức bỏ sót. Chúng tôi chưa đo riêng "mô hình bắt được thêm bao nhiêu khách" — đó là câu
> hỏi chúng tôi đặt ra cho bước tiếp theo.

---

### A6. "Đọc Customer ID của tệp gốc có vi phạm quy tắc dữ liệu của nhóm không?"

> Quy tắc ghi ở `docs/aisc26/02-data.md` §5 là: cột `Customer ID` **không được đọc vào bảng
> đầu ra**. Chúng tôi đọc nó **chỉ trong RAM của script** để gom lịch sử theo khách — vì
> churn là khái niệm của khách, không phải của SKU — và mọi bản ghi xuất ra dùng mã thay thế
> liên tục `KH-00001`. Quyết định này được nhóm thống nhất trước khi làm.

**Phản công:** "Bảng đầu ra của AISC26 có an toàn không?"
> An toàn — script `build-churn-panel.js` không bao giờ ghi `CustomerID` ra file. Kiểm tra
> được bằng cách mở `data/dataset/churn/panel.csv`: cột đầu tiên là `customer`, giá trị là
> `KH-00001`.

---

### A7. "PR-AUC chỉ 0,39 trong khi AUC 0,69. Giải thích thế nào?"

> Vì dữ liệu lệch: chỉ 28% mẫu là churn. ROC-AUC không quan tâm tỷ lệ nhãn nên nhìn "đẹp"
> hơn; PR-AUC phản ánh đúng chất lượng phân loại thực tế. Nói thẳng: **ở ngưỡng vận hành,
> độ chính xác là 35%, không phải 69%** — và chúng tôi không gọi đó là "dự đoán chính xác".

---

### A8. "Có thử mô hình khác (random forest, XGBoost) chưa? Vì sao chọn logistic?"

> Chọn logistic vì ba lý do thực dụng: (1) trọng số đọc được nên giải thích được với người
> không rành ML; (2) không thêm dependency — máy không có `scikit-learn` và dự án không dùng
> Python cho phần chạy thật; (3) với 7 đặc trưng và 32.601 mẫu, mô hình phức tạp hơn khó
> tránh học vẹt hơn là tăng độ chính xác thật. **Chúng tôi chưa benchmark so với XGBoost** —
> đây là hướng mở rộng có thật.

---

## B. Về RFM và tự động hoá

### B1. "Chứng minh segment đổi nhanh bằng cách nào?"

> Tạo đơn thật qua HTTP (`POST /api/orders` với `status=COMPLETED`), rồi poll
> `customers.rfmFrequency` mỗi 250 ms. Đo được **270 ms** (lần đầu đo được 2–4 ms khi DB
> ấm). Không gọi service nội bộ để giả lập — đi đúng đường người dùng đi.

**Bằng chứng:** `npm run check:an3`

---

### B2. "RFM và mô hình churn khác nhau thế nào? Có phải hai thứ thừa không?"

> Khác câu hỏi. RFM trả lời *"khách này có đáng chăm sóc không"* (phân vị + luật if/else),
> mô hình trả lời *"khách này có rời bỏ trong 90 ngày không"* (học từ dữ liệu). Hai tín hiệu
> trùng nhau nhiều nhưng không bằng nhau: một khách At-RFM có thể chưa vượt ngưỡng churn, và
> một khách mua ít nhưng im lặng rất lâu có thể churn cao. Dùng cùng nhau.

---

### B3. "Voucher 10% được tính như thế nào? Có lỗi không?"

> Hiện là **hằng số 10% viết trong code**, chưa so với giá trị khách. Với khách CLV 200
> triệu thì 10% là 20 triệu — chúng tôi **biết đây là giới hạn** và ghi ở §6 mục 3.5. Chưa
> có dữ liệu chi phí voucher thật để tối ưu theo tiền.

---

### B4. "Làm sao biết chiến dịch win-back có hiệu quả?"

> **Hiện chưa biết — và đây là câu trả lời trung thực.** `ChurnAlert.status` mới được cập
> nhật `RETAINED`/`LOST` ở lần chạy kế tiếp của automation, tức phải chờ ít nhất một vòng
> cron sau khi nhân viên xử lý xong. Tỷ lệ sử dụng voucher hiện là 0 vì chưa có người thật
> dùng mã. KPI `resolvedRate` có sẵn để đo, nhưng **số hiện tại là 0 và không được báo là
> "hiệu quả = 0%"**.

---

## C. Về dữ liệu và môi trường

### C1. "Dữ liệu mẫu lấy ở đâu? Có phải dữ liệu khách hàng thật không?"

> Không. Toàn bộ dữ liệu tenant `crm-phase1-demo` do script sinh ra với PRNG seed cố định,
> họ tên/SĐT/địa chỉ theo mẫu Việt Nam, email kết thúc bằng `.local` (tên miền không tồn
> tại). Nguồn duy nhất lấy từ tệp thật là **UCI Online Retail II** (CC BY 4.0), dùng để huấn
> luyện mô hình.

---

### C2. "Vì sao 30% khách lại 'im lặng'?"

> Cố ý. Nếu mọi khách đều mua gần đây thì phân khúc `At-Risk` sẽ rỗng, RFM chỉ được
> chứng minh là "chạy được" chứ không phải "phân biệt được". Dữ liệu phải có tình huống cần
> xử lý thì demo mới có ý nghĩa.

---

### C3. "Số liệu khác nhau giữa các lần chạy là do chạy lại seed à?"

> Không. PRNG có seed cố định (`20261004`) nên **hai người chạy đều ra cùng một bộ dữ liệu** —
> cần thiết khi so báo cáo giữa các buổi trình diễn. Số đơn hơi đổi giữa các lần bạn
> thấy là do tôi sửa dữ liệu mẫu trong lúc làm (thêm tương tác gắn contact, đổi số lượng),
> không phải do không tất định.

---

### C4. "Môi trường đã kiểm tra chưa?"

> Có, bằng 9 gate, chạy ở `docs/phase6/PHU-LUC-A.md` §A.9: 4190 unit test pass ·
> 204/204 module load · kiểm tra cách ly tenant pass · 118/118 khối Swagger parse ·
> 5 script kiểm chứng nghiệp vụ qua HTTP thật. Ngoài ra phát hiện và sửa **7 bug thật**
> (bảng §A.10), trong đó 2 bug làm hệ thống hỏng nặt: cron backup làm sập server mỗi đêm và
> 5 báo cáo mặc định không chạy được.

---

## D. Những câu nên tự chủ động nói trước

Nêu giới hạn **trước khi bị hỏi** — hội đồng đánh giá cao việc nhóm tự biết giới hạn:

1. Dữ liệu huấn luyện là bán lẻ quốc tế, **chưa phải Việt Nam** → số liệu cho phương pháp,
   không phải cho cửa hàng cụ thể.
2. **Chưa đo** hiệu quả win-back (`resolvedRate = 0`) vì automation chưa chạy đủ một vòng.
3. Voucher 10% là **hằng số**, chưa tối ưu theo giá trị khách.
4. Cùng một khách có thể xuất hiện ở nhiều mẫu trong cùng tập — tách theo thời gian chỉ hạn
   chế rò rỉ theo thời gian, không loại hết.
5. Chưa benchmark với XGBoost/random forest.
6. Chưa chụp ảnh màn hình (Phụ lục A §A.12 ghi rõ cần chụp gì).

---

## E. Câu hỏi hội đồng dễ hỏi nhất — chuẩn bị sẵn câu trả lời

| Câu hỏi | Trả lời ngắn |
|---|---|
| "Sao dùng UCI mà không dùng dữ liệu khách hàng của shop?" | Dữ liệu shop chưa đủ lịch sử để gắn nhãn churn (cần ít nhất 2 năm và hàng nghìn khách). UCI có 24 tháng, 5.881 khách, 1 triệu dòng — dùng để *huấn luyện và kiểm chứng phương pháp* trước. |
| "AUC 0,69 có đủ tốt để dùng thật không?" | Chưa để gửi hàng loạt. Nhưng để *xếp hạng rủi ro* thì được — ta dùng nó như một tín hiệu bổ sung, và mọi khách vẫn qua kiểm tra của nhân viên trước khi gửi voucher. |
| "Nếu mô hình sai thì sao?" | Nó không quyết định một mình: `max(công thức, mô hình)`, thiếu dữ liệu thì rơi về công thức, và voucher luôn đi qua nhiệm vụ của nhân viên. Sai thì tốn tiền voucher, không mất khách ngay. |
| "Khách có phản đối bị chấm điểm không?" | Dữ liệu mẫu dùng mã thay thế, hệ thống chưa chạy trên dữ liệu khách thật. Khi chạy thật sẽ cần thông báo và cơ sở pháp lý về xử lý dữ liệu hành vi mua. |
| "Sao không dùng `CustomerID` thật?" | Có cân nhắc. Dùng mã thay thế để dữ liệu mẫu không mang định danh người thật; mô hình học được quan hệ giữa hành vi mua và rời bỏ, không cần biết khách là ai. |
