# 08 — Vấn đáp theo góc nhìn giám khảo (ngôn ngữ kinh tế)

**Ngày:** 2026-10-04 · **Bổ sung cho `07-qa-prep.md`** (bản đó viết theo góc nhìn kỹ thuật,
dành cho câu hỏi về công thức và mã nguồn). Tài liệu này viết cho câu hỏi của người
**đánh giá bài toán kinh doanh**: giám khảo phản biện về giá trị bài toán, phạm vi,
độ tin cậy của số liệu, rủi ro vận hành và mô hình tiền.

**Nguyên tắc đã dùng xuyên suốt (giữ nguyên từ Vòng 1):**

- Không có số thì nói **"chúng tôi chưa có dữ liệu"**. Câu đó không bị trừ điểm; bịa số thì
  bị trừ toàn bộ bài.
- **Mọi số trên sàn khấu đều là MÔ PHỎNG** (dữ liệu công khai UCI, hoặc dữ liệu mô phỏng
  trong hệ thống). Nói trước, không đợi bị hỏi.
- **Chúng tôi không có khách hàng thật, không có doanh thu thật.** Chủ động thừa nhận.

---

## PHẦN A — MƯỜI CÂU CHẮC CHẮN BỊ HỎI (diễn tập phần này trước)

### A1. "90% giảm thao tác, giảm hết hàng từ 8% xuống 1,5%, độ chính xác 98,5% — các số này lấy ở đâu?"

> **Trả lời thẳng: ba con số đó chúng tôi gỡ khỏi slide.**
>
> Chúng tôi đã viết chúng ở Vòng 1 và **không tìm được căn cứ đo được** cho chúng. Bảy
> mươi nhóm sinh viên hay bị hỏi thế này, và câu trả lời ít nhất là **"con số này là giả
> định, chúng tôi chưa đo được"** — nói vậy còn được tính là hiểu bài. Nói thế này thì
> mất điểm.
>
> Cái chúng tôi **thật sự đo được**, tôi xin nói ngay cả khi nó xấu: trên dữ liệu mô phỏng
> 500 SKU, cách tính của chúng tôi **bán ít đi hơn 9,5%** và **mất bán nhiều hơn 31,5%**
> so với cách tính ngưỡng cố định mà shop hay dùng; tỉ lệ lấp đủ đơn khách là **69,51%
> so với 76,81%**. Nói cách khác, bài toán "cứ bán bằng công thức ROP cho an toàn" thắng
> chúng tôi trên phép đo đầu tiên. Chúng tôi giữ kết quả này lại và nói về nó trước, vì
> một bài toán tồn kho mà đo lên là thua thì không đáng tin.
>
> Cái chúng tôi đã làm đúng là **giao thức đo**, không phải con số: chúng tôi viết ra
> trước khi chạy cách chia dữ liệu, cách tính sai số, cách xử lý ngày hết hàng, và kết
> luận đó ghi kèm đánh đổi của nó. Thí nghiệm thứ hai thì có nhãn **post-hoc**, tức là
> biết kết quả mới đặt câu hỏi — chúng tôi ghi rõ như vậy trên slide, không giấu.
>
> **"Chúng tôi chưa có dữ liệu người dùng thật. Bộ công cụ đo đã dựng xong — kịch bản,
> phiếu bấm giờ, bảng chấm — chưa chạy vì cần người thật."**

⛔ Cấm: đổi tên con số ("giảm 91% thành giảm ~90%"), hoặc nói "theo nghiên cứu của bọn em".

---

### A2. "AI ở đâu trong sản phẩm? Tôi thấy phần lớn là công thức."

> **Đúng, và chúng tôi nói thẳng phần lớn là công thức — đó là chủ ý.**
>
> Quyết định "mua bao nhiêu, mua khi nào" là quyết định tiền. Ở quyết định tiền, công
> thức có tính kiểm tra được và trả lại cùng một kết quả mỗi lần; AI thì không. Nên toàn
> bộ phần tính toán trong sản phẩm của chúng tôi là công thức thuần, không đọc mạng, chạy
> lại cho ra đúng số cũ. **AI không được phép chạm vào bất kỳ con số nào** — và đây không
> chỉ là quy ước, chúng tôi có bài kiểm tra tự động: nếu câu trả lời của AI làm lệch bất kỳ
> con số nào, câu đó bị loại và hệ thống dùng bản mẫu cố định.
>
> AI đảm nhiệm đúng hai chỗ mà công thức làm không được:
>
> 1. **Đối chiếu tên hàng.** Khi chủ shop bán trên sàn, tên trong file của sàn là
>    "áo polo nam cổ trụ đen" còn trong phần mềm là "AP-NAM-COTRU". Hai bên giống nhau
>    nhưng không trùng nhau. Công thức so chuỗi sẽ hoặc trượt, hoặc khớp nhầm sang một mã
>    khác — chúng tôi đã tái hiện được trường hợp khớp nhầm. AI chỉ được hỏi **khi nằm
>    trong vùng mờ**, tức là công thức không chắc chắn; chắc rồi thì không gọi AI, không
>    chắn thì chuyển cho người xác nhận.
> 2. **Viết lời giải thích và soạn tin nhắn cho nhà cung cấp.** Người duyệt cần biết
>    "vì sao đề xuất mua 400 cái" và cần một tin nhắn gửi NCC. AI viết phần văn bản đó
>    và **không được gửi đi** — người dùng phải bấm gửi.
>
> Nếu tắt hết AI, luồng chính vẫn chạy trọn, chỉ là phần khớp tên hàng và phần văn bản
> rơi về bản mẫu. Đây là thiết kế cố ý: **sản phẩm không được phụ thuộc vào việc mua dịch
> vụ AI của bên thứ ba.**

⛔ Cấm: nói "AI giúp tối ưu tồn kho", "AI dự báo nhu cầu" (công thức mới dự báo nhu cầu,
AI không).

---

### A3. "Nhóm 3 người, phạm vi này có làm nổi không? Có gì bị bỏ?"

> **Có. Chúng tôi đã bỏ, và việc bỏ đó là chủ đích.**
>
> Hệ thống chúng tôi có hơn 150 bảng dữ liệu, gần 60 module: POS, kê toán, sản xuất,
> nhân sự, chấm công, hóa đơn điện tử, sàn thương mại, cửa hàng của khách hàng… Phần đó có
> người khác làm tốt hơn chúng tôi rất nhiều. Nếu ba người cố ôm hết thì bài sẽ không có
> gì để trình bày.
>
> Vòng 2 chúng tôi **đóng băng phạm vi** ở đúng một luồng: *sắp hết hàng → tính nên mua
> bao nhiêu → người duyệt → đơn nhập có thực*. Mọi thứ ngoài luồng đó chúng tôi ghi là
> "không làm ở vòng này" và in lên một slide riêng, chứ giấu.
>
> **Cái chúng tôi tự hào nhất ở Vòng 2 là cái mà đã mất 8 vòng:** không có đường nào tự tạo
> đơn nhập. Không có người duyệt thì đơn nhậng đó không tồn tại — kể cả khi hệ thống gợi ý
> rất gấp. Với người chủ shop, đây mới là thứ quyết định họ có dám bật AI hay không: một
> gợi ý sai thì họ chịu thiệt, còn một hóa đơn mua nhầm là mất tiền thật.
>
> Thứ chúng tôi **chưa làm** và nói thẳng: chưa có khách hàng thật, chưa tích hợp sàn
> thời gian thực, chưa đo được chi phí vận hành hằng tháng cho một khách.

---

### A4. "Khác gì KiotViet và Sapo? Họ cũng có cảnh báo tồn kho."

> **Hơn một nơi khác lắm, ở những chỗ họ thắng — tôi nói trước cho khỏi họ bắt tại.**
>
> Ở bán hàng tại quầy, kết nối sàn, hóa đơn điện tử, độ phủ khách hàng và độ tin cậy
> thương hiệu: họ thắng, không có gì phải bàn. Một nhóm sinh viên đem ra "quản lý kho tốt
> hơn thị trường" thì tự bắn vào chân mình.
>
> Chỗ chúng tôi khác, hẹp thôi: **ở một luồng duy nhất — đề xuất mua hàng — bắt buộc có
> người duyệt trước khi sinh ra tiền.**
>
> - Không có cổng duyệt thì đơn nhập không được tạo. Đây là quy tắc trong hệ thống, và
>   chúng tôi kiểm tra tự động bằng 24 phép thử trên cơ sở dữ liệu thật.
> - Khi người duyệt bấm duyệt, hệ thống **tính lại từ đầu** chứ không tin con số lúc đề
>   xuất. Trong lúc chờ duyệt, nếu bán thêm hàng thì con số đề xuất cũ. Hệ thống phát
>   hiện và chặn, kèm bảng chỉ ra chênh lệch bao nhiêu, thay vì im lặng dùng số cũ.
> - Sai số thì **đo được** trên tập dữ liệu công khai, công bố kết quả — kể cả khi kết
>   quả là thua.
>
> Về giá bán và độ chín xác khớp tên hàng: chúng tôi **chưa có bằng chứng** để nói là
> hơn họ. Chúng tôi không nói.

⛔ Cấm: "chính xác hơn KiotViet/Sapo", "thay thế KiotViet", "đa kênh" (xem B7).

---

### A5. "Người dùng có an toàn không? Nếu AI tính sai thì sao?"

> **An toàn ở đây là vấn đề tiền, không phải vấn đề công nghệ — nên tôi trả lời bằng tiền.**
>
> Ba câu hỏi tôi tự đặt ra và trả lời được:
>
> **1. Mất tiền khi hệ thống sai?** Không có đường nào tự tiêu tiền. Hệ thống không tự đặt
> hàng, không tự trả tiền, không tự thay đổi giá bán. Nó chỉ đề xuất, và người duyệt là
> người bấm nút. Nếu người duyệt không bấm thì tiền không đi.
>
> **2. Người duyệt có đủ thông tin để quyết định không?** Trên thẻ duyệt, chúng tôi hiện
> nguyên cơ của con số: tồn hiện có, đang có hàng trên đường, điểm đặt lại, tồn kho an
> toàn, tốc độ bán, thời gian chờ hàng — và thời gian chờ hàng đó là **số đo thật hay số
> ước lượng, ghi rõ ngay trên thẻ**. Có một chỗ chúng tôi cố ý dùng thời gian ước lượng
> phải nói thẳng: shop chưa từng nhập hàng qua hệ thống thì chưa có số đo, lúc đó chúng
> tôi dùng mặc định 7 ngày và **đánh dấu là ước lượng**, không giấu.
>
> **3. Sai thì phát hiện và sửa được không?** Mọi lần nhập hàng, sửa tồn, duyệt đơn đều ghi
> nhật ký: ai, lúc nào, số trước, số sau. Nếu người dùng thấy kết quả lạ thì tra được ra
> đúng thao tác nào. Trường hợp duyệt xong mà hệ thống tạo đơn nhập lỗi, hệ thống **tự
> nhận ra trạng thái "đã duyệt nhưng chưa xong"** và có nút thử lại thay vì để treo im.
>
> **Những chỗ chúng tôi chưa làm được, nói trước cho khỏi bị phát hiện muộn:** dữ liệu của
> mỗi khách tách biệt ở tầng ứng dụng và có kiểm tra tự động, nhưng **chưa** ràng buộc cứng
> ở tầng cơ sở dữ liệu cho tất cả bảng; và phần cổng khách hàng tự phục vụ chưa kiểm tra
> theo gói dịch vụ.

---

### A6. "Ai là khách hàng của các bạn? Cụ thể."

> **Chủ doanh nghiệp bán lẻ và ăn uống, quy mô 1–30 nhân sự, bán trên nhiều kênh mà
> đơn vị nằm rải rác.**
>
> Chúng tôi chọn nhóm này vì một lý do rất cụ thể: **họ là nhóm bị thiệt hại rõ nhất khi
> tồn kho sai, mà lại ít có khả năng thuê người quản lý kho.** Hàng của họ bán ở ba nơi
> nhưng thống kê tồn chỉ nằm ở một nơi, nên chủ shop thường ra quyết định "mua thêm" bằng
> cảm tính: hết mặc hàng bán được thì mua, còn hàng bán chậm thì đứng ngoài, và tệp nhất
> là hàng tồn nằm im vốn đã mất tiền rồi lại mua thêm vốn đã chôn.
>
> Người quyết mua là chủ shop. Người dùng hằng ngày là người làm kho — và nếu người này
> không chịu xem đề xuất thì giá trị của sản phẩm bằng không. Đây là lý do luồng của chúng
> tôi ngắn, một màn hình, dùng được trong 30 giây.

⛔ Chưa có phỏng vấn thật nào — nếu bị hỏi "các bạn có khách hàng nào nói gì", trả lời
"chúng tôi chưa phỏng vấn được ai, đây là giả định đã ghi rõ".

---

### A7. "Bao nhiêu tiền? ROI cho chủ shop thế nào?"

> **Chúng tôi chốt mức giá sau khi có phỏng vấn, chưa chốt — và tôi nói lý do vì sao chưa.**
>
> Ba phương án đang cân:
> - **Bán theo gói có sẵn** (miễn phí / 499.000 / 1.499.000 đồng một tháng). Chạy được ngay,
>   không cần làm gì thêm. Nhưng thẳng thắn: 499.000 là mức **khó cạnh tranh**, vì KiotViet
>   chuyên nghiệp 330.000 và Sapo Pro 249.000 mà họ cho nhiều tính năng hơn chúng tôi.
> - **Gói riêng cho chức năng đề xuất đặt hàng**, tính theo số lần đề xuất. Cách này khớp
>   giá trị nhất nhưng chúng tôi **chưa có số đo giá trị** nên **không dám hứa mức giá**.
> - **Bán kèm trong gói doanh nghiệp**, bán "quy trình duyệt có kiểm soát" thay vì bán
>   "AI". Cách này hợp lý nhất với một nhóm sinh viên: bán kết quả kiểm soát, không bán chữ AI.
>
> Về ROI chủ shop: chúng tôi **chưa có số**. Cái chúng tôi có là đơn giá bình quân trong
> dữ liệu mẫu khoảng 1,1 triệu đồng — nhưng đó là dữ liệu demo của hệ thống, không phải
> thị trường, nên chúng tôi không suy ra con số nào từ nó.
>
> Cách nói về AI mà chúng tôi dùng: **"chúng tôi chưa đo được chi phí AI mỗi tháng, và số
> lượng nó quyết định do công thức tính trước, nên phần AI không nằm trên đường quyết
> định của chủ shop."** Không được nói "AI chi phí 0 đồng".

---

### A8. "Số liệu của các bạn lấy từ đâu? Có phải dữ liệu khách hàng thật không?"

> **Không. Và chúng tôi không trình bày như thật.**
>
> Tập dữ liệu gốc là **UCI Online Retail II — bộ dữ liệu công khai, giấy phép CC BY 4.0**,
> có 500 mã hàng và dải 25 tháng bán hàng. Nhưng tệp gốc **không có** số tồn kho, **không
> có** thời gian nhập hàng quan sát được, **không có** kênh bán, **không có** giá vốn. Ba
> thứ đó chính là mấy thứ quyết định quyết định đề xuất mua bao nhiêu. Vì vậy **mọi chỉ số
> tồn kho chúng tôi đưa ra là mô phỏng**, và giá vốn là giả định. Giá trong tệp tính bằng
> bộ tiền Anh, chúng tôi không quy đổi.
>
> Trong hệ thống đang chạy là dữ liệu của một tenant đặt tên "mô phỏng", tự dọn sau mỗi
> lần chạy. Chúng tôi **không có khách hàng thật, không có doanh thu thật**, con số tiền
> hàng chục triệu đồng mà bạn có thể thấy là tổng của dữ liệu thử, không phải doanh thu.

---

### A9. "Nếu hệ thống chạy sai, ai chịu trách nhiệm? Rủi ro pháp lý thì sao?"

> **Người duyệt chịu trách nhiệm về quyết định tiền; nhà cung cấp hệ thống chịu trách nhiệm
> về việc hiện đủ thông tin để quyết định đó.** Hai việc khác nhau, và chúng tôi tách bạch.
>
> Với dữ liệu: mỗi khách chỉ thấy dữ liệu của mình, có kiểm tra bằng bộ thử tự động riêng,
> và chúng tôi vừa bắt và sửa một lỗi thật là dữ liệu của một khách có thể bị ghi đè bởi
> luồng của khách khác.
>
> Phần chúng tôi **chưa làm** và nói trước: chưa ràng buộc khóa ngoại ở tầng cơ sở dữ liệu cho
> toàn bộ bảng; hệ thống chưa được chạy trên môi trường thật; và chưa có bộ kết nối sàn
> chạy thời gian thực nên dữ liệu kênh bán là **tệp xuất nhập vào**, không phải kết nối
> sống. Ba điều đó là ranh giới của bài, không phải lỗi đã che.

---

### A10. "Ba người, mấy tháng, làm sao bảo trì được và mở rộng?"

> **Đây là điểm chúng tôi yếu, và chúng tôi trả lời thẳng thay vì vay mượn câu trả lời.**
>
> Cái có được: phần lõi là công thức thuần, chạy không cần mạng, sai thì sửa và chạy lại là
> ra — không phụ thuộc nhà cung cấp AI nào. Phần chính sách duyệt được kiểm tra bằng bộ thử
> tự động, nên khi có ai đó thêm một đường mới mà bỏ qua kiểm tra thì bộ thử đỏ.
>
> Cái chưa có: đội ba người không giữ được một hệ thống lớn lâu dài. Chúng tôi không tính
> đường bảo trì dài hạn vào kết quả bài này. Cách đúng để tiếp tục là thu hẹp, giữ một
> luồng và một mức giá, không nhân bản ra nhiều ngành.

---

## PHẦN B — CÂU HỎI THEO TỪNG NHÓM

### B1. Bài toán có giá trị không?

| Câu hỏi | Trả lời ngắn |
|---|---|
| "Tồn kho đa kênh có đáng giải không, hay đây là bài toán có sẵn?" | Có, và chúng tôi chọn vì thiệt hại đo được: hàng bán ở nhiều nơi nhưng thống kê tồn chỉ có một chỗ ⇒ chủ shop quyết định mua bằng cảm tính. Hệ quả là hai lỗi ngược nhau: **hết hàng bán được** (mất doanh thu + mất khách) và **tồn nằm im** (vốn chôn thêm). Cái thứ hai ít được nói to nhưng nguy hiểm hơn. |
| "Chủ shop họ đang xử lý bằng gì?" | Phần lớn bằng cảm tính và mô hình Excel. Chúng tôi **chưa khảo sát được** bao nhiêu shop thật — đây là giả định, ghi rõ trong tài liệu. |
| "Ai bị thiệt nhất?" | Chủ shop vừa bán nhiều kênh vừa không có người quản kho chuyên trách. Không phải chuỗi lớn — họ đã có hệ thống riêng. |
| "Bài toán này còn đáng làm sau 3 năm không?" | Cái bền vững là **quy trình duyệt có kiểm soát**, không phải công thức ROP — công thức ai cũng có. Đây là lý do chúng tôi dồn vào luồng duyệt. |

### B2. Phạm vi

| Câu hỏi | Trả lời ngắn |
|---|---|
| "Sao không làm hết tính năng?" | Không cạnh tranh được với hãng lớn ở POS và kế toán; đó là tiền của họ, không phải của ba người. |
| "Còn chức năng nào các bạn để dở?" | Đa kênh thời gian thực, POS, hóa đơn điện tử, cửa hàng khách hàng, sản xuất, nhân sự — in lên một slide riêng, ghi rõ "không làm ở vòng này". |
| "Nếu thêm một ngành nữa thì sao?" | Chúng tôi đã thử một giả định phụ (các mặt hàng khác nhau về tần suất bán, xử lý khác nhau) và **không** thu được kết luận từ dữ liệu mô phỏng — nên không dám khẳng định. |
| "Các bạn có phụ thuộc bên thứ ba không?" | Có một: dịch vụ AI. Nhưng luồng chính **tắt AI vẫn chạy**; và số tiền AI tiêu chưa phải thứ quyết định có dùng hay không. |

### B3. Độ tin cậy của số liệu (nhóm nhạy cảm nhất)

| Câu hỏi | Trả lời ngắn |
|---|---|
| "Các con số này do ai kiểm chứng?" | Chúng tôi tự đo và **tự nói ra kết quả xấu**. Cách chúng tôi kiểm chứng là giao thức đo viết ra trước lần chạy đầu, có thể bạn đọc lại và tự chạy theo. |
| "Số 98,5% chính xác lấy ở đâu?" | **Chúng tôi chưa có số nào như vậy và cũng không chạy ra số đó.** Để đo độ chính xác khớp tên hàng thì phải có người gán tay. Chúng tôi đã sinh sẵn 120 cặp chờ gán nhãn và **cố tình để chương trình từ chối chạy** khi chưa có nhãn — vì kết quả tự chấm điểm cho chính nó là vô nghĩa. |
| "Nếu kết quả thua thì sao, sao dám trình bày?" | Vì trình bày kết quả thua có kèm cách sửa còn hơn trình bày kết quả thắng không có căn cứ. Chúng tôi nói kết quả thua ngay slide thứ hai, rồi nói cả điểm mạnh. |
| "Bao nhiêu phần trăm là mô phỏng?" | **100%** phần tồn kho. Nói thẳng con số này. |
| "Có thử trên dữ liệu thật của khách nào chưa?" | Chưa. Và nói trước lý do: chưa phỏng vấn được chủ shop nào, dữ liệu của họ nằm trong sổ cái. |

### B4. Vai trò của AI

| Câu hỏi | Trả lời ngắn |
|---|---|
| "Bỏ AI thì còn gì?" | Còn phần cốt lõi: công thức, cổng duyệt, kiểm tra lại lúc duyệt. Tắt AI thì mất đúng hai thứ: đối chiếu tên hàng khó và phần văn bản giải thích. |
| "AI có quyết định tiền không?" | Không. Không có chỗ nào AI chạm vào số tiền hoặc số lượng; có bài kiểm tra tự động chặn. |
| "AI có tự gửi tin nhắn cho nhà cung cấp không?" | Không. AI soạn, người dùng bấm gửi. |
| "Chi phí AI mỗi tháng bao nhiêu?" | **Chưa đo.** Chúng tôi đã cài bộ đếm lượng dùng và đo được, nhưng chưa chạy trên dữ liệu thật nên chưa có con số. Không nói "0 đồng". |
| "Có lợi thế gì so với dùng ChatGPT bình thường?" | Không dùng trực tiếp. ChatGPT không biết tồn kho, không biết chủ shop quyết định gì, và không có cổng duyệt. AI của chúng tôi chỉ làm việc mà nó có dữ liệu và có người duyệt. |

### B5. An toàn (chi tiết)

| Câu hỏi | Trả lời ngắn |
|---|---|
| "Đề xuất sai thì chủ shop mất bao nhiêu?" | Nếu họ bấm duyệt thì mất bằng số tiền đơn nhập đó — đó là rủi ro kinh doanh thật, không phải rủi ro hệ thống. Vì vậy chúng tôi đặt mọi cảnh báo sai lệch lên ngay thẻ duyệt, và **tự chặn** khi chênh lạc quá mức cho phép. |
| "Nếu hệ thống gặp lỗi giữa chừng thì sao?" | Người duyệt thấy trạng thái "đã duyệt nhưng chưa xong" và có nút thử lại. Trước khi sửa, chúng tôi đã tái hiện tình huống này. |
| "Dữ liệu của khách A lọ sang khách B được không?" | Không ở tầng ứng dụng, và có bộ thử riêng. Chúng tôi **đã tìm ra một lỗi thật** là dữ liệu tài liệu của một khách có thể bị ghi đè bởi luồng của khách khác, và đã sửa. Cái chưa có: khóa ngoại cứng ở tầng cơ sở dữ liệu. |
| "Nhân viên có xem được giá vốn của người khác không?" | Có phân quyền theo vai trò; các thao tác duyệt giới hạn ở quản lý. |
| "Hệ thống có tự sửa số liệu sai không?" | Không có đường nào tự sửa tồn kho hay giá vốn. Nhập hàng và đơn nhập đều qua người. |

### B6. Khác biệt với đối thủ

| Câu hỏi | Trả lời ngắn |
|---|---|
| "KiotViet có cảnh báo tồn không?" | Có, chúng tôi đã tra và ghi nguồn. Họ có cảnh báo; khác ở chỗ **cảnh báo có bắt buộc người duyệt và tự kiểm lại lúc duyệt hay không** — đó là chỗ chúng tôi dựng và đo được. |
| "Sapo có làm đơn hàng gợi ý không?" | Chúng tôi chưa xác minh được vì chỉ đọc được tài liệu công khai. Ghi "chưa xác minh", **không** đoán. |
| "Bao nhiêu tiền một năm?" | Giá niêm yết trong hệ thống: 0 / 499.000 / 1.499.000 đồng một tháng. Riêng gói doanh nghiệp có giá ghi 0 vì nó là gói "liên hệ" — chúng tôi đang sửa cái hiển thị này. |
| "Họ có phần mềm kế toán, các bạn có không?" | Có phần kế toán và báo cáo thuế, nhưng chúng tôi không cạnh tranh ở đó. |

### B7. Đa kênh — câu hỏi bắt buộc phải trả lời thẳng

| Câu hỏi | Trả lời ngắn |
|---|---|
| "Đề tài là đa kênh, vậy kênh của các bạn ở đâu?" | **Chúng tôi chỉ làm một phần.** Hiện là lấy đơn hàng từ tệp xuất của sàn rồi nhập vào; **chưa** có kết nối thời gian thực, **chưa** có tên chung kho giữa các kênh. Chúng tôi không dùng chữ "đa kênh" trên slide vì chưa xứng. Nếu phải nói đúng bài toán mình đang giải: **"chốt đặt hàng dựa trên bán ra thay vì trên cảm tính"**. |
| "Vậy bài toán có còn đúng không?" | Đúng ở chỗ cốt lõi: tồn kho và đơn hàng nằm ở nhiều nơi, số tồn thì không. Kết nối thời gian thực là việc làm tiếp, không phải việc đã làm. |
| "Có dữ liệu của sàn thật không?" | Không. Định dạng tệp làm theo đặc tả mà chúng tôi tự chốt lại và **ghi rõ là giả định**, không phải bản xuất thật từ sàn. |

### B8. Kinh doanh

| Câu hỏi | Trả lời ngắn |
|---|---|
| "Chủ shop tốn bao lâu để dùng?" | Một màn hình, dùng trong 30 giây cho việc duyệt đề xuất. Đây là điều chúng tôi chưa đo được bằng thử nghiệm người dùng — bộ thử đã sẵn sàng, chưa chạy. |
| "Họ bỏ hệ thống cũ bao lâu?" | Không đòi họ bỏ. Luồng của chúng tôi nằm cuối, chỉ cần đúng một màn hình. |
| "Rủi ro khi các bạn hết tiền?" | Chưa có câu trả lời về vận hành dài hạn. Thẳng thắn: bài này chứng minh một luồng, không chứng minh một công ty. |
| "Doanh thu của các bạn hiện tại?" | **Không có.** Chưa khách nào trả tiền. Con số tiền trong hệ thống là dữ liệu thử. |

### B9. Khi bị chất vấn nặng

| Tình huống | Cách xử lý |
|---|---|
| Giám khảo dẫn lại "ROP tốt hơn" của chính slide cũ | "Đúng là câu đó của Vòng 1. Phép đo của chúng tôi **không** chứng minh nó, nên chúng tôi đã gỡ. Cái chúng tôi khẳng định được là: ở cùng mức phục vụ, cách tính của chúng tôi giữ vốn tốt hơn — và đó là thí nghiệm thứ hai, **khai phá sau khi đã thấy kết quả**, nên chúng tôi ghi rõ là post-hoc." |
| "Sao không có khách thật?" | "Vì chúng tôi tạo dữ liệu thật cần nhiều tháng và nhiều chủ shop đồng ý. Thay vì giả vờ, chúng tôi chọn bộ dữ liệu công khai và ghi rõ hạn chế. Việc còn thiếu là bài thử người dùng — bộ công cụ đã xong." |
| "Chứng minh đi, không nói." | Chạy luồng thật trên máy: đề xuất → duyệt → đơn nhập có thực; rồi chỉ ra bộ thử 24 phép và 12 phép trên cơ sở dữ liệu thật. Đây là lúc **không nói**, để họ tự thấy. |
| "Chỗ nào dễ hỏng?" | Nêu thật hai chỗ: chưa ràng buộc khóa ngoại ở tầng cơ sở dữ liệu, và cổng khách hàng chưa kiểm tra gói. Nêu trước còn hơn bị phát hiện. |
| Im lặng / không biết | "Chúng tôi chưa có dữ liệu ở chỗ này." Không đoán. |

---

## PHẦN C — NĂM CÂU KHÔNG ĐƯỢC NÓI

1. ❌ **"ROP tốt hơn"** — phép đo của chính nhóm không ủng hộ.
2. ❌ **"Chính xác hơn KiotViet/Sapo"**, "thay thế", "đa kênh" — chưa có bằng chứng.
3. ❌ **"AI chi phí 0 đồng"** — số đúng là *chưa đo*.
4. ❌ **"Khách hàng của chúng tôi"**, "tiết kiệm X%" — chưa có khách nào.
5. ❌ **Số 98,5% / 90% / 8%→1,5%** dưới bất kỳ hình thức nào, kể cả "khoảng", "ước tính".

---

## PHẦN D — BẢN TRƯỚC GIỜ TRÌNH BÀY (đọc lướt, không đọc thành lời)

- Mở đầu bằng: **mọi số trên màn hình là mô phỏng, dữ liệu công khai, chúng tôi chưa có
  khách hàng thật.**
- Nói kết quả xấu **trước** kết quả tốt — đừng đợi bị hỏi.
- Mỗi con số khi nói ra, phải trả lời được **"lấy ở đâu, ai kiểm"** trong một câu.
- Chuẩn bị sẵn **một câu mở đầu cho mỗi nhóm B1–B8** để không phải nghĩ dưới ánh đèn.
- Trả lời ngắn: **3 câu là đủ.** Rồi im, để giám khảo hỏi tiếp.
- Khi bị hỏi thứ chưa có: **"chúng tôi chưa có dữ liệu ở chỗ này"** — câu này được
  tính là trả lời đúng, không phải câu nói né.