# notes/competitors.md — ghi chép nghiên cứu đối thủ (P3 / T7)

Ngày tra cứu: **2026-10-03** (mọi dòng dưới đây chỉ đúng tại ngày này).
Nhãn bằng chứng dùng xuyên suốt:

- **[MỞ]** — tôi đã mở trực tiếp trang bằng công cụ fetch, đọc được nội dung.
- **[TRÍCH]** — nội dung lấy từ **kết quả tìm kiếm** trên trang chính thức (search engine đọc
  thay), **tôi chưa mở trang**. Phải mở lại trước khi trích ra slide.
- **[CHƯA XÁC MINH]** — chỉ thấy ở nguồn thứ ba, không kiểm chứng được.

Không ghi lại nội dung trang; chỉ ghi sự kiện cần dùng.

---

## 1. KiotViet — https://www.kiotviet.vn/phi-dich-vu — [MỞ]

Bảng phí **ngành bán lẻ** (ghi đúng như trang, không suy diễn):

| Gói | Giá/tháng | Chi nhánh | Kho | Tài khoản |
|---|---|---|---|---|
| Hỗ trợ | 270.000đ | 1 | không có | tối đa 3 |
| Chuyên nghiệp | 330.000đ | +270.000đ/chi nhánh | +150.000đ/kho | không giới hạn |
| Cao cấp | 490.000đ | +375.000đ/chi nhánh | +150.000đ/kho | không giới hạn |

- Banner trang: "chỉ từ **8.000đ/ngày**".
- Kho (mọi gói): "Xuất/ nhập/ kiểm/ chuyển", "Quản lý Giá vốn hàng hóa", "Quản lý Nhà
  cung cấp" — nhập hàng theo NCC, lịch sử nhập hàng, công nợ & thanh toán với NCC.
- Nhóm "Dự báo & Cảnh báo" trong bảng tính năng: **Dự báo doanh thu, Dự báo tiêu thụ,
  Cảnh báo tồn kho**.
- "Phân tích kinh doanh thông minh"; ở gói **Cao cấp** ghi rõ "Phân tích kinh doanh
  thông minh **với AI**" (ngành bán lẻ; ở ngành sức khỏe làm đẹp thì "với AI" ở gói
  Chuyên nghiệp).
- Ngành ăn uống: tích hợp **ShopeeFood, GrabFood** (gói Cao cấp, ghi "Mới"); gói Cao cấp
  ngành ăn uống ghi "dự báo doanh thu / dự báo tiêu thụ" có "với AI".
- HĐĐT: 5.000 (Hỗ trợ) / 20.000 (Chuyên nghiệp) / 50.000 hóa đơn **mỗi chi nhánh mỗi
  năm** (Cao cấp); chữ ký số và "phần mềm kế toán hộ kinh doanh" ghi **Mới, Miễn phí**
  ở cả ba gói.
- **Public API chỉ ở gói Cao cấp.**
- **KHÔNG tìm thấy** trên trang: tính năng gợi ý **số lượng** đặt hàng, đề xuất tạo PO,
  hay cổng duyệt đề xuất. Nhãn: *chưa tìm thấy trên trang phí dịch vụ* — chưa phủ định
  được vì chưa đọc tài liệu khác (help/wiki). **Chỉ nói được "không thấy ở đây".**

## 2. Sapo — https://www.sapo.vn/bang-gia.html — [TRÍCH]

| Gói | Giá/tháng | Giới hạn chính |
|---|---|---|
| StartUp | 170.000đ | 1 kênh bán, 3 nhân viên |
| Pro | 249.000đ | 1 cửa hàng (+200.000đ/cửa hàng), 5 gian hàng, 5 trang, không giới hạn NV |
| Omni | 449.000đ | 2 cửa hàng (+200.000đ), 10 gian hàng, 10 trang |
| Advanced | 600.000đ | 2 cửa hàng, 15 trang, Open API cơ bản |
| Growth | 999.000đ | chuỗi cửa hàng |
| Enterprise | liên hệ | tùy biến, triển khai tận nơi |

- Dùng thử **7 ngày**. Phí khởi tạo **miễn phí cho khách mua mới** (ghi rõ mức 1–3
  triệu tùy gói).
- AI hiện diện: "Chat đa kênh và tư vấn chốt đơn bằng AI" (Pro+); Enterprise có
  "Chatbot AI thông minh trả lời tự động theo tình huống"; **Sapo Automate** (workflow
  automation) 250.000đ/tháng; Đăng bán đa sàn 100.000đ/tháng.
- Kho: sổ kho, tồn kho, xuất nhập tồn, kiểm hàng; nhập hàng từ NCC tạo đơn đặt hàng →
  phiếu nhập kho.
- Blog Sapo (https://www.sapo.vn/blog/phan-mem-quan-ly-xuat-nhap-kho, đăng 2026-03-11,
  [TRÍCH]): mô tả tính năng "**Cảnh báo tồn kho tối thiểu và tự động đề xuất nhập hàng**"
  — cơ chế được mô tả là **đặt ngưỡng tối thiểu rồi cảnh báo**, không nói có tính
  lượng đặt theo dự báo/lead time. Enterprise có "gợi ý điều chuyển hàng" giữa chi
  nhánh theo tốc độ bán.
- Tự công bố: "230.000+ nhà bán hàng".

## 3. VietPOS.AI — https://vietpos.ai/ — [MỞ]

Gần ta nhất về mặt *định vị* (POS + ERP + AI agent, multi-tenant). Chi tiết đáng chú ý:

- **Bảng giá trên trang: Miễn phí 0đ / Pro 99.000đ/tháng / Agent 199.000đ/tháng /
  Enterprise liên hệ.** Cùng trang lại có một đoạn văn ghi "4 gói pricing từ
  170k/tháng (Cơ bản) đến 490k/tháng (VIP)" ⇒ **trang tự mâu thuẫn về giá**; lấy bảng
  giá 99k/199k, và ghi nhận mâu thuẫn này như một dấu hiệu cần thận trọng khi trích.
- **4 agent đang chạy (live)**: Doanh thu (mỗi 30 phút), **Kho hàng (mỗi 6 giờ, "dự
  báo hết trong 3–7 ngày tới dựa trên tốc độ bán thực tế")**, Công nợ (12 giờ, soạn
  tin nhắn theo mức 7/15/30 ngày), Báo cáo (8h/20h).
- **"Sắp ra mắt" (chưa có): Agent Nhân viên, Agent Khuyến mãi giờ vàng, và
  "Agent Đề xuất nhập hàng".** ⇒ đối thủ gần nhất **chưa có** luồng đề xuất đặt hàng.
- Chatbot demo có câu "Bạn có muốn tôi **soạn** đơn nhập không?" — nói *soạn*, không nói
  tự tạo PO.
- Kiến trúc: "**1 KH = 1 PostgreSQL DB riêng**", 350+ API mở, Socket.IO realtime.
- Công bố chi phí AI: bot Telegram 36 tools "~$0.02/KH/tháng". Dùng thử 14 ngày.

## 4. CMBcoreSeller — https://cmbcore.com/phan-mem-ban-hang-da-kenh — [TRÍCH]

- Trọng tâm: **đa kênh sàn** (TikTok Shop/Shopee/Lazada) + đối soát settlement, AI
  chốt đơn chat Facebook.
- Trang có mục "**Dự báo & đề xuất nhập hàng — Đang chạy**": "Nhìn tốc độ bán 30 ngày
  so với tồn và hàng đang về, tự đề xuất nhập đúng lượng"; "Cảnh báo SKU sắp hết: còn 8
  ngày là hết, nhập 200 cái"; "**Tạo đơn mua hàng (PO) tự chia theo nhà cung cấp**".
- **Không thấy** cổng duyệt/người duyệt trong những gì đã đọc.
- **Giá: [CHƯA XÁC MINH]** — trang không có bảng giá rõ cho CMBcoreSeller (nguồn thứ ba
  unikorn.vn nói "100% free" cho đăng ký; không đủ tin cậy để đưa vào tài liệu).

## 5. Analy (F&B trà sữa) — https://analy.co/tinh-nang-quan-ly-kho-nguyen-vat-lieu-gia-von/ — [TRÍCH], đăng 2024-12-13

- "Đề xuất nhập hàng" theo **tỷ lệ so với SL nhập mỗi ngày**: ví dụ SL 10kg/ngày, còn
  2kg ⇒ đề xuất nhập 8kg. ⇒ **luật tỷ lệ**, không dự báo, không lead time.

---

## Kết luận nghiên cứu (điều làm đổi luận điểm khác biệt)

1. "Có AI gợi ý đặt hàng" **KHÔNG còn là khác biệt**: CMBcore đã tuyên bố tính năng
   này đang chạy (chưa mở trang xác minh), Sapo mô tả "tự động đề xuất nhập hàng" theo
   ngưỡng. KiotViet có dự báo tiêu thụ + cảnh báo tồn kho.
2. Thứ **chưa ai chứng minh được** trong những gì đã đọc: **đề xuất có cổng duyệt bắt
   buộc + sai số đo được trên backtest công khai**. Đây mới là chỗ đứng được.
3. Đối thủ mạnh hơn ta ở: hệ sinh thái sàn/vận chuyển/HĐĐT, số khách, thiết bị POS,
   template ngành. Phải nói thẳng.