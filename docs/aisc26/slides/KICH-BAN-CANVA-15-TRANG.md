# Kịch bản nói và thao tác demo — Canva 15 trang

Bản trình chiếu: https://www.canva.com/design/DAHX9gkWvGM/C_zBSmtlgvmJUxLhG_XYow/edit

Đối chiếu nội dung Canva, ghi chú người trình bày và mã giao diện ngày 21/10/2026. Đây là kịch bản để người trình bày thực hiện; chưa phải biên bản một lần demo đã chạy thành công. Thời lượng dự kiến 12–15 phút, cần diễn tập để chốt.

## Chuẩn bị trước buổi trình bày

Mở sẵn các cửa sổ sau và dùng Alt + Tab để chuyển:

1. Canva, ở trang 1. Bấm **Thuyết trình / Present**, chọn chế độ trình chiếu có sẵn trên tài khoản. Dùng phím mũi tên để chuyển trang. Nếu dùng hai màn hình, kiểm tra màn hình khán giả trước.
2. Trình duyệt ERP, đã đăng nhập tenant demo, ở **Trợ lý KD → Đề xuất nhập** (`/smart-guide`). Dùng tài khoản có quyền duyệt mua hàng và xem sổ kế toán. Chuẩn bị sẵn một SKU có NCC, giá vốn hợp lệ và còn cần nhập; không học thuộc tổng số dòng trong bảng.
3. Excel mở `C:\CRM\OMNI-AGENT\data\aisc26\skus\labels\label-sheet.csv`. Đây là 120 tình huống đầu vào, không phải 120 nhãn đã hoàn tất. Chỉ đọc, không lưu đè khi trình bày.
4. Excel mở `C:\CRM\OMNI-AGENT\docs\aisc26\notes\sku-eval-cases.csv`. Đây là 60 ca kiểm định có dự đoán đã lưu. Dùng Ctrl + F tìm theo mã ca.
5. Trình soạn thảo mở `C:\CRM\OMNI-AGENT\docs\aisc26\notes\sku-eval-last-run.json`. Đặt con trỏ sẵn ở khối `test`, phóng chữ để khán giả đọc được.

Nên diễn tập trên tenant demo riêng. Tạo PO và nhập kho làm thay đổi dữ liệu, nên không bấm lặp lại để chữa việc chuyển cửa sổ nhầm. Ghi lại mã PO, GRN và bút toán của lần demo. Nếu cần chuẩn bị lại dữ liệu, dùng quy trình snapshot/restore của dự án trước/sau buổi demo; kịch bản này không tự chạy các lệnh đó.

### Các điểm cần sửa trên slide trước khi chốt

- Trang 2 đang mở bằng bài toán ghép SKU, còn demo là đề xuất nhập. Kịch bản dưới giới thiệu rõ hai phần để khán giả không chờ màn đọc PDF. Nếu muốn tập trung hoàn toàn vào demo nhập hàng, đổi nội dung trang 2 thành “Khi nào cần nhập và nên nhập bao nhiêu?”.
- Trang 3 ghi 9/10 nhập dư, trong khi bản ghi chi tiết `notes/labeling-and-interview-status.md` ghi 10/10 nhập dư, 9/10 hết hàng. Cần xác nhận bảng khảo sát gốc trước khi nói tỷ lệ này. Lời nói dưới chỉ nêu có tình trạng nhập dư.
- 149.000đ là trung vị sẵn sàng chi của 10 cửa hàng; 160.000đ là trung vị phí hiện trả trong nhóm 5 cửa hàng có trả phí theo bản ghi chi tiết. Chú thích rõ hai nhóm, không suy ra giá sản phẩm rẻ hơn POS.
- Trang 10: kết quả 0,8972/0,8515 là theo mã chấm hiện tại. Mã đang tính dự đoán tự động ở ca thiếu nhãn là FP. Với chủ ý để nhãn trống cho AI đề xuất, cần tách nhóm này khỏi đánh giá có đáp án trước khi dùng F1 làm kết luận chất lượng. Kịch bản giữ số lưu sẵn và nói rõ giới hạn, chưa sửa cách chấm hay chạy lại.
- Trang 11 ghi “7 trong 8 ca” có vấn đề nhãn. Đây là nhận định rà soát nội bộ, chưa phải kết luận của người gán độc lập. Nên đổi thành “Phát hiện nghi vấn nhãn khi rà soát các ca không khớp”.

## Trang 1 — ADUU: Nền tảng quản trị bán lẻ tích hợp trợ lý AI

**Thời gian:** 30–40 giây. **Màn hình:** Canva trang 1. Không mở phần mềm ngay.

**Nói:**

> Kính chào Quý Thầy Cô và Hội đồng. Nhóm chúng tôi giới thiệu Aduu, nền tảng kết nối dữ liệu bán hàng, tồn kho, mua hàng và kế toán cho doanh nghiệp bán lẻ nhỏ và vừa.
>
> Trong phần trình bày hôm nay, tôi tập trung vào một quyết định cụ thể: cửa hàng cần nhập thêm mặt hàng nào, mua bao nhiêu và người quản lý kiểm soát quyết định đó như thế nào.
>
> Tôi sẽ trình diễn luồng đề xuất nhập hàng trên phần mềm. Sau đó, tôi trình bày một đánh giá riêng về khả năng khớp tên hàng với mã sản phẩm, cùng những giới hạn của kết quả đo hiện tại.

**Chuyển:** bấm mũi tên phải một lần.

## Trang 2 — Bài toán: Đơn hàng cần đúng mã sản phẩm

**Thời gian:** 40–50 giây. **Màn hình:** Canva trang 2.

**Nói:**

> Trước hết, dữ liệu hàng hóa phải chỉ đúng sản phẩm. Tên do nhà cung cấp ghi trong tin nhắn hoặc tài liệu có thể khác tên cửa hàng lưu trong phần mềm.
>
> Ví dụ minh họa, cùng một loại hàng có bản màu đỏ và màu hồng. Nếu nhân viên chọn nhầm mã, số lượng có thể ghi vào sai sản phẩm. Tồn kho trên hệ thống khi đó không còn phản ánh đúng hàng thực tế.
>
> Đó là lý do chúng tôi nghiên cứu chức năng ghép tên hàng với mã sản phẩm. Phần này sẽ có phép đánh giá riêng ở cuối bài. Còn demo ngay sau đây bắt đầu khi mã hàng đã xác định, để xem hệ thống hỗ trợ quyết định nhập thêm như thế nào.

**Nhấn:** câu cuối giải thích ranh giới hai phần. Không nói demo sẽ đọc PDF, nhận dạng ảnh hoặc tự nhập dữ liệu từ tin nhắn.

## Trang 3 — Khảo sát 10 cửa hàng bán lẻ

**Thời gian:** 45–55 giây. **Màn hình:** Canva trang 3.

**Nói:**

> Trong mẫu khảo sát 10 cửa hàng của nhóm, các cửa hàng sử dụng sổ, Excel hoặc POS để đối chiếu tồn kho. Khảo sát cũng ghi nhận tình trạng nhập dư. Khi hàng chưa bán được, vốn vẫn nằm trong kho, nên quyết định mua thêm có ảnh hưởng trực tiếp đến dòng tiền của chủ shop.
>
> Một yêu cầu được ghi nhận ở cả 10 phiếu là chủ quán phải được duyệt trước khi đặt đơn. Nhóm đưa yêu cầu đó vào sản phẩm bằng bước xem xét và phê duyệt trước khi tạo đơn mua.
>
> Mức sẵn sàng chi trung vị được ghi nhận là 149 nghìn đồng mỗi tháng. Đây là tín hiệu về ngân sách trong mẫu khảo sát, chưa phải doanh thu hay bằng chứng rằng khách hàng đã mua sản phẩm.
>
> Sau đây tôi chuyển sang phần mềm để minh họa một đề xuất cụ thể.

**Chú ý cho người trình bày:** xác nhận và sửa tỷ lệ nhập dư trước buổi trình bày. Không đọc số đang mâu thuẫn trên slide. Nếu bị hỏi về 160.000đ, trả lời đây là trung vị của nhóm 5 cửa hàng có trả phí, khác mẫu tính WTP.

## Trang 4 — Tạo đề xuất nhập hàng

**Thời gian:** 50–70 giây. **Thao tác:** hiện trang 4 vài giây, sau đó Alt + Tab sang ERP. Từ đây đến hết trang 8 có thể giữ nguyên cửa sổ ERP để demo liền mạch, không cần quay về slide sau mỗi nút.

1. Mở menu **Trợ lý KD** → tab **Đề xuất nhập**.
2. Chỉ một dòng đã chuẩn bị: tên hàng, tồn hiện tại, lượng đề xuất và NCC.
3. Đọc số thực tế trên dòng đó. Không dùng mặc định số 105/7/98 trong tài liệu cũ.
4. Bấm **Tạo đề xuất** một lần. Phần mềm chuyển sang **Duyệt đề xuất nhập** (`/agent-approvals`).

**Nói trước khi bấm:**

> Đây là danh sách những mặt hàng hệ thống đang gợi ý bổ sung. Tôi chọn dòng này vì đã có nhà cung cấp và có dữ liệu để xem xét mua hàng. Các con số tôi đang chỉ là số đang hiển thị của lần demo này.
>
> Nếu một mã chưa có nhà cung cấp, nút tạo đề xuất bị khóa. Người dùng phải bổ sung thông tin đó trước.

**Nói sau khi thẻ đề xuất xuất hiện:**

> Tôi vừa mở một đề xuất để xem xét. Ở đây có số lượng gợi ý, đơn giá, nhà cung cấp và các căn cứ tính toán. Bước này chưa phải là xác nhận mua hàng.

**Chỉ vào ATP/ROP nếu được hỏi:** ATP là lượng khả dụng để đáp ứng nhu cầu; ROP là mốc đặt lại. Đọc lead time đúng nhãn “ước lượng” hoặc “đo được” đang hiện. Không biến giá trị ước lượng thành dữ liệu đã quan sát.

## Trang 5 — AI giải thích đề xuất

**Thời gian:** 50–70 giây. **Màn hình:** giữ thẻ đề xuất ERP.

1. Đọc lượng gợi ý. Trong ô **Số lượng bạn quyết định nhập**, nhập số nguyên dương bạn chọn. Để demo đơn giản, chọn đúng lượng gợi ý sau khi kiểm tra.
2. Chỉ tổng tiền theo số lượng vừa nhập.
3. Bấm **AI Giải thích và Soạn tin NCC** một lần.
4. Chờ kết quả; chỉ phần giải thích, tin nhắn, nhãn nguồn và hàng rào số.

**Nói trong khi nhập số:**

> Số lượng ở trên là gợi ý tham khảo. Tôi nhập số lượng mình quyết định mua vào ô này. Tin nhắn và đơn mua sẽ sử dụng số lượng người duyệt đã chọn.

**Nói trong lúc chờ:**

> Ở bước này, AI hỗ trợ viết lời giải thích và soạn tin nhắn cho nhà cung cấp. Các số lượng và số tiền phải bám dữ liệu đầu vào, phần kiểm tra số bên dưới dùng để đối chiếu nội dung sinh ra.

**Khi có kết quả:**

> Đây là phần giải thích; bên dưới là tin nhắn đặt hàng để người dùng đọc và sao chép. Nhãn ở đây ghi rõ nguồn nội dung.

- Nếu hiện **nguồn: LLM**: “Lần này phần giải thích được sinh từ LLM.”
- Nếu hiện **nguồn: mẫu (LLM không khả dụng)**: “Lần này hệ thống dùng mẫu dự phòng. Tôi báo rõ trạng thái này, nên phần đang xem chưa chứng minh lời giải thích được LLM sinh trực tiếp.”

**Nhấn:** “Tin nhắn mới được soạn, chưa gửi cho nhà cung cấp.” Không gọi thao tác này là đã gửi tin.

## Trang 6 — Nội dung đổi số bị chặn

**Thời gian:** 40–50 giây. **Màn hình:** ERP, cùng thẻ đề xuất.

1. Nếu đã có khối giải thích, bấm **Chạy lại test chốt chặn**. Nếu chưa có khối, nút tên **Test Chốt chặn AI sửa số**.
2. Chỉ mẫu văn bản bị sửa số và kết quả hàng rào hiển thị.
3. Bấm **Chạy lại chế độ thường**, chờ kết quả thường trước khi tiếp tục.

**Nói trước khi bấm:**

> Tôi sẽ chủ động đưa một lỗi vào nội dung để thử bộ kiểm tra. Đây là phép thử có chủ đích, không phải tuyên bố rằng AI vừa tự mắc lỗi trong lần gọi trước.

**Nói khi thấy kết quả:**

> Ở đây có số gốc và số đã bị sửa trong mẫu thử. Hàng rào phát hiện sai lệch và bác nội dung đó, giao diện hiển thị kết quả cùng nội dung chuẩn.
>
> Phép thử này cho thấy trường hợp sai số đang trình diễn được phát hiện. Nó chưa chứng minh hệ thống xử lý được mọi kiểu sai của AI.

Không nói “PO chắc chắn bị chặn bởi nút test này”. Nút đang minh họa kiểm tra nội dung; bước duyệt có các kiểm tra riêng.

## Trang 7 — Người dùng quyết định mua

**Thời gian:** 45–60 giây. **Màn hình:** ERP.

1. Kiểm tra ô **Số lượng bạn quyết định nhập** còn đúng giá trị đã chọn, xem tổng tiền và NCC.
2. Bấm **Duyệt** một lần, chờ phản hồi.
3. Nếu xuất hiện bảng chênh lệch dữ liệu, đọc các giá trị trước/sau. Chỉ khi xuất hiện ô **Tôi xem diff ở trên và vẫn mua đúng số lượng này**, và bạn đã xem xét, mới tick rồi duyệt lại.
4. Chỉ hộp thông báo **Đã tạo PO ...**. Ghi/chụp lại mã PO để tìm đúng ở bước sau.

**Nói trước khi duyệt:**

> Tôi kiểm tra lại số lượng đã chọn, nhà cung cấp và tổng tiền. Sau đó tôi bấm Duyệt để xác nhận quyết định mua trong luồng này.

**Nói sau khi có mã PO:**

> Phần mềm đã tạo đơn mua mang mã đang hiển thị. Mã này giúp tôi đối chiếu tiếp ở màn mua hàng. Đến đây mới có đơn mua; hàng chưa được ghi nhận là đã nhập kho.

**Nếu dữ liệu đổi:** “Hệ thống tính lại và phát hiện dữ liệu đã thay đổi. Tôi cần xem mức chênh lệch trước khi quyết định tiếp.” Không xem checkbox là thủ tục bắt buộc trong mọi lần duyệt.

## Trang 8 — Theo dõi đến bút toán nhập kho

**Thời gian:** 2–3 phút. **Màn hình:** ERP.

### A. Mở đúng đơn mua

1. Menu **Kế toán & Tài chính → Mua hàng** (`/purchase-orders`).
2. Mở PO có đúng mã vừa tạo. So tên hàng, số lượng và đơn giá.
3. Nếu trạng thái chờ duyệt, dùng tài khoản có quyền và bấm **Duyệt**. Nếu đang Nháp, bấm **Gửi duyệt**, rồi duyệt theo quy trình hiện ra. Không gọi các trạng thái này là đã duyệt thành công.
4. Khi PO là **APPROVED**, bấm **Gửi NCC** để chuyển trạng thái đơn. Thao tác này không phải bằng chứng nhà cung cấp ngoài đời đã nhận email/Zalo.

**Nói:**

> Đây là cùng đơn mua vừa tạo, đối chiếu bằng mã PO. Tôi chuyển đơn theo quy trình mua hàng. Tiếp theo tôi mô phỏng việc nhà cung cấp giao hàng để kiểm tra ghi nhận kho và kế toán trên dữ liệu demo.

### B. Ghi nhận nhận hàng

5. Khi PO là **ORDERED**, bấm **Tạo GRN**.
6. Tại màn **Phiếu nhận hàng (GRN)**, nếu hộp tạo chưa mở, bấm nút tạo trên đầu trang. Chọn đúng PO, chọn **Kho nhận**.
7. Nhập **SL nhận** cho dòng sản phẩm. Với kịch bản nhận đủ một đợt, chọn số còn phải nhận của PO, sau đó bấm **Tạo GRN**.
8. Tìm phiếu vừa tạo, bấm **QC**. Nhập **Đạt** bằng lượng nhận và **Lỗi** bằng 0 cho tình huống minh họa hàng đạt, bấm **Xác nhận QC**.
9. Khi phiếu ở trạng thái **Đã QC**, bấm **Nhập kho**, đọc hộp xác nhận rồi bấm **Nhập kho** trong hộp. Chờ trạng thái **Đã nhập kho / POSTED**.
10. Ghi lại mã GRN. Không tạo phiếu lần hai nếu chỉ cần làm mới danh sách.

**Nói khi tạo GRN:**

> Đơn mua thể hiện lượng đặt, còn phiếu nhận thể hiện lượng thực nhận. Tôi ghi nhận một đợt giao hàng đạt chất lượng trong tình huống demo. Khi xác nhận nhập kho thành công, phiếu chuyển sang trạng thái đã nhập kho.

**Nhánh rút gọn nếu đã diễn tập:** có thể dùng **Nhận nhanh** trên chi tiết PO để ghi nhận nhanh GRN. Chọn một nhánh; không chạy cả Nhận nhanh lẫn tạo GRN thủ công cho cùng lượng hàng.

### C. Đối chiếu bút toán

11. Mở **Sổ kế toán** (`/journal`), tìm bút toán liên quan đúng phiếu/đơn qua nguồn, diễn giải và thời gian. Mở rộng dòng bằng nút mở rộng bên trái để thấy các dòng tài khoản. Dùng mã liên kết hoặc diễn giải chứng từ để đối chiếu, không chọn chỉ vì cùng số tiền.
12. Chỉ mã bút toán, dòng **Nợ 156**, **Có 331** nếu đúng kết quả thực tế đang hiện.

**Nói:**

> Đây là bút toán liên quan đến phiếu nhận hàng vừa xử lý. Nợ 156 thể hiện giá trị hàng hóa tăng; Có 331 thể hiện công nợ phải trả nhà cung cấp. Tôi đang đối chiếu được từ đơn mua đến phiếu nhận và các dòng kế toán của giao dịch đó.

Nếu có dòng thuế 1331, chỉ giải thích khi thực sự có trên chứng từ. Không gọi một bút toán nhiều dòng là “hai bút toán”. Không khẳng định đã thanh toán tiền vì Có 331 là ghi nhận công nợ.

**Chuyển sang đánh giá:** Alt + Tab về Canva, đến đúng trang 9. Nếu Canva vẫn ở trang 4, chuyển lần lượt đến trang 9 trước khi bắt đầu nói, tránh đọc nhầm số trang.

## Trang 9 — Thiết kế đánh giá ghép SKU

**Thời gian:** 60–80 giây, gồm xem file.

**Nói trên Canva:**

> Phần vừa rồi minh họa luồng đề xuất nhập hàng và người dùng duyệt trước khi tạo đơn mua.
>
> Tiếp theo, tôi trình bày một phép đánh giá riêng của chức năng khớp tên hàng với mã sản phẩm. Phép đo này trả lời câu hỏi: khi nhận một tên hàng bên ngoài, hệ thống chọn mã nào, và kết quả đó có khớp với nhãn người gán hay không?

**Bấm:** Alt + Tab sang Excel mở `label-sheet.csv`. Chỉ các cột `pair_id`, `external_name`, các cột ứng viên và `label_sku`.

**Nói:**

> Bộ này có 120 tình huống. Mỗi dòng có tên đầu vào, các SKU ứng viên và cột nhãn đối chiếu. Hiện có 107 dòng có nhãn; 13 dòng tôi để trống để hệ thống tự đề xuất mã rồi xem xét riêng.
>
> Nhãn đối chiếu và mã AI dự đoán là hai cột có vai trò khác nhau. Với dòng chưa có nhãn, hệ thống vẫn có thể đề xuất, nhưng chúng tôi chưa chấm đúng sai cho dự đoán đó bằng một đáp án độc lập.
>
> Bộ dữ liệu chia sẵn 60 ca phát triển và 60 ca kiểm định. Tập kiểm định có 56 ca có nhãn. Hiện chưa hoàn tất người gán thứ hai nên chưa đo được mức đồng thuận giữa hai người gán.

**Bấm:** Alt + Tab về Canva trang 9, sau đó trang 10. Không dùng câu “120 nhãn tay đã hoàn tất”.

## Trang 10 — Kết quả so sánh ghép SKU

**Thời gian:** 60–75 giây. **Màn hình:** Canva trang 10.

**Chỉ:** hàng **Chỉ công thức**: F1 0,8515, chuyển người 13,33%; hàng **Công thức kết hợp LLM**: F1 0,8972, chuyển người 1,67%. Đọc theo tên phương pháp, không đọc theo thứ tự văn bản trích xuất.

**Nói:**

> Chúng tôi chạy hai phương pháp trên cùng tập kiểm định: chỉ công thức và công thức kết hợp LLM.
>
> Kết quả lưu hiện tại ghi F1 lần lượt là 0,8515 và 0,8972. Số ca chuyển người xem xét giảm từ 8 trên 60 xuống 1 trên 60.
>
> Tuy nhiên, cả hai phương pháp đều có 48 dự đoán khớp nhãn trên 56 ca có nhãn. Vì vậy, không thể đọc mức tăng F1 thành việc hệ thống chọn đúng thêm mã hàng.
>
> Chúng tôi cũng phát hiện cách chấm hiện tại đang tính dự đoán ở ca thiếu nhãn vào nhóm bị phạt. Nhóm ca cố ý để AI đề xuất cần được tách rõ khi đánh giá. Các điểm trên slide là số lưu theo cách chấm hiện tại, chưa phải kết luận cuối về chất lượng khớp mã.

Không nói “F1 là độ chính xác 89,72%”, không nói “5 lần giống hệt nhau trên mọi model”. Bản JSON hiện đối chiếu được một lần UIT, model `gemma-4-26b`, ngày 16/10/2026.

## Trang 11 — Rà soát từng ca phát hiện vấn đề về nhãn

**Thời gian:** 80–110 giây. **Bấm:** Alt + Tab sang `sku-eval-cases.csv` trong Excel.

Giữ các cột nhìn thấy được: `pair_id`, `external_name`, `pred_sku`, `via`, `label_sku_dung`, `ket_qua`. Có thể chuẩn bị bản xem riêng trước buổi trình bày, nhưng giữ file gốc nguyên vẹn.

### Ca có nhãn, dự đoán khớp

**Ctrl + F → `SKU-082` → tìm → đóng hộp tìm.**

> Tên đầu vào là đồng hồ Bakelike màu hồng có thêm phần chữ “chuyên sỉ”. Hệ thống đi qua LLM, chọn mã 22728. Nhãn hiện tại cũng là 22728, nên ca này được ghi là khớp nhãn.

### Ca để AI tự đề xuất

**Ctrl + F → `SKU-079`.**

> Ca này có tên ALARM BAKELIKE RED. Hệ thống đề xuất mã 22727, nhưng cột nhãn đang trống. Kết quả từng ca ghi rõ CHƯA CÓ NHÃN. Tôi có thể xem hệ thống đã chọn gì, còn muốn biết chọn đúng không thì cần kiểm tra độc lập.

### Ca khớp nhãn thất bại và có nghi vấn nhãn

**Ctrl + F → `SKU-084`.** Chỉ tên đầu vào, mã dự đoán 22727 và nhãn 22728. Chỉ tên RED/PINK trong các cột ứng viên.

> Ở đây tên đầu vào ghi RED, tức màu đỏ. Hệ thống chọn mã sản phẩm màu đỏ, nhưng nhãn hiện tại lại là màu hồng. Phép so sánh máy đánh dấu không khớp nhãn.
>
> Đây là lý do chúng tôi mở từng ca: có trường hợp cần kiểm tra lại chính nhãn đối chiếu. Rà soát nội bộ chưa thay thế được người gán độc lập, nên chúng tôi chưa kết luận tất cả các ca không khớp đều là lỗi của người gán.

**Về Canva trang 11, chỉ 48/56:**

> Con số 85,71% ở đây là tỷ lệ khớp bộ nhãn hiện tại. Chúng tôi chưa dùng nó làm kết luận về độ chính xác thực tế của sản phẩm.

## Trang 12 — Chỉ số có nguồn đối chiếu

**Thời gian:** 40–55 giây. **Màn hình:** Canva trang 12, rồi mở JSON đã chuẩn bị.

**Bấm:** Alt + Tab sang `sku-eval-last-run.json`. Dùng Ctrl + F lần lượt tìm `runId`, `"test"`, `"f1"` nếu cần. Không sửa file. Chỉ khối `test`, tránh nhầm với `dev`.

**Nói:**

> Đây là file kết quả tổng hợp của lần chạy lưu được. File ghi thời gian, model, cách chia dữ liệu và kết quả của hai phương pháp trên tập kiểm định.
>
> File CSV vừa mở cho phép truy xuống từng tình huống. Bộ nhãn cho biết đáp án đối chiếu nằm ở đâu. Như vậy người kiểm tra có thể lần từ chỉ số tổng hợp về dữ liệu của từng ca.
>
> Những nguồn này phục vụ phép đo ghép SKU. Chúng không thay thế bằng chứng khảo sát cửa hàng hoặc chứng từ của phần demo nhập hàng.

**Nếu hỏi cách chạy:** mã đánh giá ở `C:\CRM\OMNI-AGENT\scripts\llm\eval-sku-match.js`; chạy từ thư mục dự án bằng `npm run llm:eval -- --mode live`. Lệnh gọi mô hình thật và ghi đè kết quả JSON/CSV. Chỉ chạy trước buổi trình bày khi đã chuẩn bị cấu hình và lưu bản kết quả cũ; không cần mở terminal trên sân khấu.

**Chuyển:** quay lại Canva, đến trang 13.

## Trang 13 — Những bước cần hoàn thành

**Thời gian:** 40–50 giây. **Màn hình:** Canva trang 13.

**Nói:**

> Có ba phần việc nhóm cần hoàn tất trước khi đưa ra kết luận mạnh hơn.
>
> Thứ nhất là bổ sung người gán nhãn độc lập và phân xử những ca bất đồng. Đồng thời phải xử lý rõ nhóm thiếu nhãn trong cách chấm.
>
> Thứ hai là thử nghiệm sử dụng với mục tiêu 6 người, để quan sát người dùng có hiểu đề xuất và thao tác duyệt được hay không.
>
> Thứ ba là phỏng vấn sâu với mục tiêu 3 đến 5 cửa hàng, để làm rõ cách quyết định nhập hàng và điều kiện họ chấp nhận sử dụng.
>
> Đây là các bước cần thêm bằng chứng thực tế. Demo hôm nay chưa chứng minh mức giảm nhập dư hoặc mức tiết kiệm thời gian tại cửa hàng.

Nếu được hỏi đã có bao nhiêu người dùng thử, trả lời đúng tiến độ nhóm xác nhận, không biến mục tiêu 6 người thành kết quả đã có.

## Trang 14 — Nhóm mong nhận phản hồi

**Thời gian:** 25–35 giây. **Màn hình:** Canva trang 14.

**Nói:**

> Qua phần demo, nhóm muốn làm rõ cách người quản lý xem đề xuất, chọn số lượng và theo dõi giao dịch đến chứng từ kế toán.
>
> Chúng tôi mong Hội đồng góp ý hai điểm: bằng chứng hiện tại còn thiếu gì để tin cậy quy trình đề xuất nhập hàng, và nhóm nên ưu tiên phép thử nào trước khi triển khai thực tế.

## Trang 15 — Cảm ơn

**Thời gian:** 10–15 giây. **Màn hình:** Canva trang 15.

**Nói:**

> Nhóm OmniAgent xin cảm ơn Quý Thầy Cô và Hội đồng đã lắng nghe. Chúng tôi xin tiếp nhận câu hỏi và có thể mở lại giao dịch hoặc từng ca đánh giá để đối chiếu.

Dừng nói, nhìn Hội đồng. Giữ nguyên trang cảm ơn đến khi có câu hỏi.

## Khi demo không diễn ra như dự kiến

| Tình huống | Thao tác | Câu nói |
|---|---|---|
| AI chờ lâu hoặc báo lỗi | Chờ phản hồi, không bấm liên tục; đọc trạng thái thật. Nếu chưa xong, chuyển sang phần khác và quay lại một lần | “Lời giải thích chưa trả về trong lần gọi này. Tôi tiếp tục phần kiểm tra số và quyết định của người dùng.” |
| Hiện nguồn mẫu | Chỉ đúng nhãn nguồn | “Đây là mẫu dự phòng khi LLM không khả dụng.” |
| Tạo đề xuất báo SKU không còn cần nhập | Chọn SKU khác đã kiểm tra, còn đủ điều kiện | “Tồn kho đã thay đổi nên đề xuất này không còn cần thiết. Tôi chuyển sang một mặt hàng vẫn cần bổ sung.” |
| Không có dòng đủ điều kiện | Dừng phần tạo mới; chỉ mở đề xuất/chứng từ chuẩn bị trước nếu có và nói rõ | “Hiện chưa có dòng đủ điều kiện tạo mới. Tôi mở giao dịch đã chuẩn bị để giải thích luồng.” |
| Duyệt xong nhưng PO chưa tạo | Chỉ trạng thái; nếu có, bấm **Thử lại tạo PO** một lần | “Hệ thống ghi nhận quyết định nhưng chưa tạo được PO. Tôi thử lại theo nút của giao diện và kiểm tra kết quả.” |
| Không thấy nút Tạo GRN | Xem đúng trạng thái PO và quyền; hoàn tất bước duyệt/Gửi NCC phù hợp | “Đơn cần hoàn tất bước trước trong quy trình rồi mới tạo phiếu nhận.” |
| Chưa thấy bút toán của GRN mới | Làm mới, kiểm tra kỳ lọc và đúng nguồn. Nếu vẫn không có, báo thật | “Tôi chưa đối chiếu được bút toán của phiếu này trong lần demo. Tôi chưa kết luận phần ghi sổ đã thành công.” |
| Bị hỏi AI có tự gắn nhãn không | Mở SKU-079, phân biệt cột dự đoán và nhãn | “AI có thể đề xuất mã. Muốn đánh giá đúng sai, chúng tôi cần đáp án đối chiếu độc lập.” |
| Bị hỏi F1 tăng có nghĩa chọn đúng hơn không | Mở khối `test` trong JSON | “Chưa thể kết luận như vậy. Cả hai có 48/56 dự đoán khớp nhãn, còn số ca chuyển người khác nhau và cách chấm ca thiếu nhãn cần được xử lý.” |

## Nhớ nhanh thứ tự cửa sổ

**Canva 1–3 → ERP liên tục cho nội dung 4–8 → Canva 9 → CSV 120 tình huống → Canva 10 → CSV 60 kết quả khi nói trang 11 → Canva 12 + JSON → Canva 13–15.**

Không cần thực hiện lại toàn bộ demo khi Hội đồng hỏi một chi tiết. Mở đúng giao dịch hoặc đúng mã ca cần đối chiếu.
